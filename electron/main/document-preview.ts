import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { app } from 'electron'
import { unzipSync } from 'fflate'
import { paths } from './paths'
import type {
  DocumentKind,
  DocumentPageImage,
  DocumentPreview,
  DocumentPreviewPage
} from '../shared/types'

/**
 * 第二十一阶段：文档预览（先做 PDF）。
 * 第二十二阶段：补 DOCX 文本抽取 + PDF 单页位图渲染。
 * 第二十三阶段：补 PPTX / XLSX 文本抽取（复用同一套 zip + XML 路径）。
 * 第二十四阶段：XLSX 日期还原（读 styles.xml 的 numberFormat，序列号 → 日期）。
 * 第二十五阶段：XLSX 照搬 Excel 显示样式（日期/数字统一按 formatCode 渲染）+ DOCX 表格转 Markdown。
 *
 * 设计约束（本阶段）：
 *   - **只读**：只读文件库里已有的文件，不写回、不改用户数据；
 *   - **本地**：不外发任何内容，不联网（解析/渲染全在本进程完成）；
 *   - **Office 纯 JS**：fflate 解 zip，**只解需要的条目**（不解图片/媒体，避免 zip 炸弹）；
 *   - **PDF 位图用 @napi-rs/canvas**（N-API，ABI 稳定，Electron 可直接加载）；
 *     位图只给界面试用，agent 仍然读文本（不把 base64 灌进模型上下文）。
 *
 * 抽取出来的文字会做 NFKC 归一化：PDF 的 ToUnicode 常把「色」映射成康熙部首「⾊」，
 * 归一化后才是人能读、agent 能用的文本。
 */

const PDF_MAGIC = '%PDF-'
const ZIP_MAGIC = 'PK\u0003\u0004'
const DOCX_ENTRY = 'word/document.xml'
const PPTX_PRESENTATION_ENTRY = 'ppt/presentation.xml'
const XLSX_WORKBOOK_ENTRY = 'xl/workbook.xml'
/** 单文件上限（超过就不预览，避免把超大文件读进内存） */
const MAX_FILE_BYTES = 64 * 1024 * 1024
/** 单个 zip 条目解压后的上限（防 zip 炸弹：只要需要的条目，且每个条目也有上限） */
const MAX_ENTRY_BYTES = 16 * 1024 * 1024
/** 最多抽多少页 */
const MAX_PAGES = 200
/** 最多抽多少字 */
const MAX_CHARS = 200_000
/** 位图渲染缩放范围 */
const MIN_SCALE = 0.5
const MAX_SCALE = 3

/** 文件库根目录（文件库 = <state>/file-library/files 下的平铺文件） */
function libraryRoot(): string {
  return path.join(paths.fileLibraryDir(), 'files')
}

/**
 * 路径守卫：只允许文件库根目录内的文件。
 * 比 library.readFile 的 startsWith 更严（用 path.relative 判越界），
 * 并且比一次真实路径（防符号链接绕出去）。
 */
export function resolveLibraryFile(filePath: string): string {
  const root = path.resolve(libraryRoot())
  const resolved = path.resolve(filePath)
  const rel = path.relative(root, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('路径越界：只允许访问文件库内的文件')
  // 符号链接逃逸：真实路径必须仍在根目录内
  try {
    const realRoot = fs.realpathSync(root)
    const real = fs.realpathSync(resolved)
    const realRel = path.relative(realRoot, real)
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) throw new Error('路径越界：只允许访问文件库内的文件')
  } catch (e) {
    if (e instanceof Error && /路径越界/.test(e.message)) throw e
    /* 根目录或文件不存在 → 后面按「文件不存在」处理 */
  }
  return resolved
}

/** 读 fd 的一段（越界自动截短） */
function readAt(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(Math.max(0, length))
  const n = fs.readSync(fd, buf, 0, buf.length, position)
  return n === buf.length ? buf : buf.subarray(0, n)
}

/**
 * 列 zip 的中央目录条目名（不解压、不读正文）。
 *
 * 为什么不用「探头部/尾部找子串」：条目名散落在 zip 里，靠子串匹配会
 *   ①误判（压缩数据里碰巧出现同样的字节）；
 *   ②漏判（条目在文件中部时，头尾都探不到）。
 * 中央目录（EOCD 指向）里一定列着全部条目名，读它最准也最省（只读目录，不碰正文）。
 */
function listZipEntryNames(filePath: string): string[] {
  let fd = -1
  try {
    fd = fs.openSync(filePath, 'r')
    const size = fs.fstatSync(fd).size
    const tailLen = Math.min(size, 64 * 1024)
    const tail = readAt(fd, size - tailLen, tailLen)
    // EOCD（PK\x05\x06）可能有 comment → 从后往前找最后一个
    let eocd = -1
    for (let i = tail.length - 4; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
        eocd = i
        break
      }
    }
    if (eocd < 0 || eocd + 22 > tail.length) return []
    const cdSize = tail.readUInt32LE(eocd + 12)
    const cdOffset = tail.readUInt32LE(eocd + 16)
    if (cdSize === 0 || cdOffset + cdSize > size) return []
    const cd = readAt(fd, cdOffset, cdSize)
    const names: string[] = []
    let p = 0
    // 中央目录文件头：文件名长度 @28、扩展长度 @30、注释长度 @32、文件名 @46
    while (p + 46 <= cd.length) {
      if (cd[p] !== 0x50 || cd[p + 1] !== 0x4b || cd[p + 2] !== 0x01 || cd[p + 3] !== 0x02) break
      const nameLen = cd.readUInt16LE(p + 28)
      const extraLen = cd.readUInt16LE(p + 30)
      const commentLen = cd.readUInt16LE(p + 32)
      names.push(cd.subarray(p + 46, p + 46 + nameLen).toString('utf8'))
      p += 46 + nameLen + extraLen + commentLen
    }
    return names
  } catch {
    return []
  } finally {
    if (fd >= 0) {
      try {
        fs.closeSync(fd)
      } catch {
        /* 忽略 */
      }
    }
  }
}

/** zip 里是什么 Office 文档（按中央目录条目名判定） */
function detectZipDocumentKind(filePath: string): DocumentKind {
  const names = listZipEntryNames(filePath)
  if (names.length > 0) {
    if (names.includes(DOCX_ENTRY)) return 'docx'
    if (names.includes(PPTX_PRESENTATION_ENTRY)) return 'pptx'
    if (names.includes(XLSX_WORKBOOK_ENTRY)) return 'xlsx'
    return 'other'
  }
  // 回退：中央目录读不出来（少见）→ 探头部/尾部找标记条目名
  try {
    const fd = fs.openSync(filePath, 'r')
    try {
      const size = fs.fstatSync(fd).size
      const probeLen = Math.min(size, 128 * 1024)
      const probe = Buffer.concat([
        readAt(fd, 0, probeLen),
        readAt(fd, Math.max(0, size - probeLen), probeLen)
      ])
      if (probe.includes(DOCX_ENTRY)) return 'docx'
      if (probe.includes(PPTX_PRESENTATION_ENTRY)) return 'pptx'
      if (probe.includes(XLSX_WORKBOOK_ENTRY)) return 'xlsx'
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    /* 读不了就当「其他」 */
  }
  return 'other'
}

/**
 * 按文件头判定文档类型：
 *   - `%PDF-` → pdf；
 *   - zip 头 `PK\x03\x04` → 看中央目录里的条目名：
 *     `word/document.xml` → docx，`ppt/presentation.xml` → pptx，`xl/workbook.xml` → xlsx；
 *   - 其余 → other。
 */
export function detectDocumentKind(filePath: string): DocumentKind {
  try {
    const fd = fs.openSync(filePath, 'r')
    try {
      const size = fs.fstatSync(fd).size
      const head = readAt(fd, 0, Math.min(5, size))
      if (head.toString('latin1') === PDF_MAGIC) return 'pdf'
      if (head.length >= 4 && head.subarray(0, 4).toString('latin1') === ZIP_MAGIC) {
        return detectZipDocumentKind(filePath)
      }
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    /* 读不了就当「其他」 */
  }
  return 'other'
}

/* ------------------------------ pdfjs 加载 ------------------------------ */

interface PdfTextItem {
  str?: string
  hasEOL?: boolean
}
interface PdfViewport {
  width: number
  height: number
}
interface PdfPage {
  getTextContent(): Promise<{ items: unknown[] }>
  getViewport(opts: { scale: number }): PdfViewport
  render(opts: unknown): { promise: Promise<void> }
}
interface PdfDocument {
  numPages: number
  getPage(n: number): Promise<PdfPage>
}
interface PdfjsModule {
  getDocument(opts: unknown): { promise: Promise<PdfDocument> }
}

let pdfjsCache: PdfjsModule | null = null

/**
 * 加载 pdfjs-dist 的 legacy 构建。
 * 为什么用 createRequire 而不是 import()：主进程产物是 CJS，
 * 打包器会把 import() 改写成 require()，而 pdfjs 只发 ESM（.mjs）→ require 会炸。
 * Electron 的 Node 24 支持 require(ESM)（pdfjs 无顶层 await，已实测）。
 */
function loadPdfjs(): PdfjsModule {
  if (pdfjsCache) return pdfjsCache
  const req = createRequire(path.join(app.getAppPath(), 'ecclaw-pdfjs-anchor.cjs'))
  pdfjsCache = req('pdfjs-dist/legacy/build/pdf.mjs') as PdfjsModule
  return pdfjsCache
}

/* ------------------------------ canvas 加载 ------------------------------ */

interface Canvas2D {
  [key: string]: unknown
}
interface CanvasHandle {
  width: number
  height: number
  getContext(type: '2d'): Canvas2D
  toBuffer(type: 'image/png'): Buffer
}
interface CanvasModule {
  createCanvas(width: number, height: number): CanvasHandle
  DOMMatrix: unknown
  ImageData: unknown
  Path2D: unknown
}

let canvasCache: CanvasModule | null = null

/**
 * 加载 @napi-rs/canvas 并补齐 pdfjs 在 Node 侧渲染依赖的 Web API。
 * 只在真正要渲染位图时加载（文本预览不需要原生依赖）。
 */
function loadCanvas(): CanvasModule {
  if (canvasCache) return canvasCache
  const req = createRequire(path.join(app.getAppPath(), 'ecclaw-pdfjs-anchor.cjs'))
  const mod = req('@napi-rs/canvas') as CanvasModule
  const g = globalThis as unknown as Record<string, unknown>
  g.DOMMatrix = g.DOMMatrix ?? mod.DOMMatrix
  g.ImageData = g.ImageData ?? mod.ImageData
  g.Path2D = g.Path2D ?? mod.Path2D
  canvasCache = mod
  return mod
}

/** pdfjs 的文本项 → 可读文本（按 hasEOL 换行 + NFKC 归一化） */
function itemsToText(items: unknown[]): string {
  let out = ''
  for (const item of items as PdfTextItem[]) {
    if (typeof item.str === 'string') out += item.str
    if (item.hasEOL) out += '\n'
  }
  return normalizeText(out)
}

/** 统一清洗：NFKC + 行尾/空白归一化 */
function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* ------------------------------ DOCX 抽取 ------------------------------ */

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 段落 → 文本：保留 w:t 内容、制表符、换行 */
function docxParagraphText(paragraph: string): string {
  const out: string[] = []
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\s*\/>/g
  for (const m of paragraph.matchAll(re)) {
    if (m[1] !== undefined) out.push(decodeXmlEntities(m[1]))
    else if (m[2] === 'tab') out.push('\t')
    else out.push('\n')
  }
  return out.join('')
}

/** DOCX 的结构容器标签：只有这四种标签的嵌套会影响「直接子级」判定 */
const DOCX_CONTAINER_TAGS = 'w:tbl|w:tr|w:tc|w:p'

/** DOCX 结构元素（只取结构容器，w:r / w:t 等叶子不建节点） */
interface DocxElement {
  /** 标签名，如 w:tbl */
  tag: string
  /** 内部 XML */
  body: string
}

/**
 * 深度感知地取 content 里 wanted 的**直接子元素**（按文档顺序）。
 *
 * 为什么不能用非贪婪正则：`<w:tc>…</w:tc>` 会在**内层**单元格的 `</w:tc>` 提前收尾，
 * 表格一旦嵌套，外层的行列位就全错。这里按容器标签做栈式配对，同名嵌套不会打断匹配。
 * 只跟踪 w:tbl / w:tr / w:tc / w:p 四种容器，其余标签（w:r / w:t / w:sdt …）不参与层级判定。
 */
function docxChildElements(content: string, wanted: string[]): DocxElement[] {
  const want = new Set(wanted)
  const out: DocxElement[] = []
  const tokenRe = new RegExp(`<(/?)(${DOCX_CONTAINER_TAGS})(?:\\s[^>]*?)?(/?)>`, 'g')
  const stack: string[] = []
  let curTag = ''
  let curStart = 0
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(content)) !== null) {
    const closing = m[1] === '/'
    const tag = m[2]
    const selfClosing = m[3] === '/'
    if (closing) {
      // 闭标签：与栈顶配对才出栈（异常 XML 的错配闭标签直接忽略，不猜）
      if (stack.length > 0 && stack[stack.length - 1] === tag) {
        const popped = stack.pop() as string
        if (stack.length === 0 && popped === curTag) {
          out.push({ tag: popped, body: content.slice(curStart, m.index) })
          curTag = ''
        }
      }
      continue
    }
    if (selfClosing) {
      // 自闭合（如 <w:p/>）没有内容，按空子元素记
      if (stack.length === 0 && want.has(tag)) out.push({ tag, body: '' })
      continue
    }
    if (stack.length === 0 && want.has(tag)) {
      curTag = tag
      curStart = m.index + m[0].length
    }
    stack.push(tag)
  }
  return out
}

/**
 * 表格单元格 → 文本
 * - 自身段落：多段用空格连接（沿用既有口径）；
 * - 内嵌表格：每行占一行，行内各列用 ` | ` 连接（渲染时转义成 `\|`，仍落在同一个外层格子里）。
 */
function docxCellText(cell: DocxElement): string {
  const lines: string[] = []
  const own: string[] = []
  const flush = (): void => {
    if (own.length > 0) {
      lines.push(own.join(' '))
      own.length = 0
    }
  }
  for (const child of docxChildElements(cell.body, ['w:p', 'w:tbl'])) {
    if (child.tag === 'w:p') {
      const t = docxParagraphText(child.body).trim()
      if (t) own.push(t)
    } else {
      flush()
      for (const row of docxChildElements(child.body, ['w:tr'])) {
        const cells = docxChildElements(row.body, ['w:tc']).map((c) => docxCellText(c))
        if (cells.length > 0) lines.push(cells.join(' | '))
      }
    }
  }
  flush()
  return lines.join('\n')
}

/** Markdown 单元格转义：竖线要转义、换行变 <br> */
function markdownCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
}

/** 单格横向合并跨的列数上限（防畸形文件把表格撑爆） */
const MAX_GRID_SPAN = 32

/** 单元格自身的横向跨度：只认紧跟在 <w:tc> 后的 tcPr，嵌套表格的 tcPr 不参与 */
function docxCellSpan(cell: DocxElement): number {
  const props = cell.body.match(/^\s*(<w:tcPr(?:\s[^>]*)?>[\s\S]*?<\/w:tcPr>)/)?.[1] ?? ''
  const raw = Number(props.match(/<w:gridSpan\b[^>]*?\bw:val="(\d+)"/)?.[1] ?? 1)
  if (!Number.isFinite(raw) || raw < 1) return 1
  return Math.min(Math.floor(raw), MAX_GRID_SPAN)
}

/**
 * word 表格 → Markdown 表格（首行作表头，缺的列补空）
 *
 * Markdown 表格没有 colspan / rowspan，合并单元格的表示口径：
 * - 横向 `w:gridSpan="N"`：内容只放首格，其余 N-1 格补空，后续列位因此与其它行对齐；
 * - 纵向 `w:vMerge`：restart 格照常输出，续格通常无内容 → 输出空格（内容留在起始行）；
 *   续格若自带文本也照常输出，不丢数据（fail-safe）。
 *
 * 单元格里的内嵌表格：Markdown 无法再套一层管道表，按行摊平进所在格子
 * （每行一行、行内列以 ` \| ` 分隔），位置与内容都不丢。
 */
function docxTableMarkdown(tableXml: string): string {
  const rows: string[][] = []
  for (const row of docxChildElements(tableXml, ['w:tr'])) {
    const cells: string[] = []
    for (const cell of docxChildElements(row.body, ['w:tc'])) {
      const span = docxCellSpan(cell)
      cells.push(markdownCell(docxCellText(cell)))
      for (let i = 1; i < span; i++) cells.push('')
    }
    if (cells.length > 0) rows.push(cells)
  }
  if (rows.length === 0) return ''
  const cols = Math.max(...rows.map((r) => r.length))
  const line = (cells: string[]): string => {
    const padded = [...cells]
    while (padded.length < cols) padded.push('')
    return `| ${padded.join(' | ')} |`
  }
  const out = [line(rows[0]), `| ${Array(cols).fill('---').join(' | ')} |`]
  for (const row of rows.slice(1)) out.push(line(row))
  return out.join('\n')
}

/** word/document.xml → 纯文本（正文段落 + 表格转 Markdown 表格） */
function extractDocxText(xml: string): string {
  const blocks: string[] = []
  // 深度感知地按文档顺序取正文里的段落与表格（表格里的段落归表格，不再重复抽）
  for (const block of docxChildElements(xml, ['w:p', 'w:tbl'])) {
    if (block.tag === 'w:tbl') {
      const table = docxTableMarkdown(block.body)
      if (table) blocks.push(table)
    } else {
      const text = docxParagraphText(block.body).trim()
      if (text) blocks.push(text)
    }
  }
  return normalizeText(blocks.join('\n'))
}

/** 解出 zip 里需要的条目（只解这些条目，且每个条目有解压上限 → 拒 zip 炸弹） */
function readZipEntries(filePath: string, match: (name: string) => boolean): Record<string, Uint8Array> {
  const data = new Uint8Array(fs.readFileSync(filePath))
  return unzipSync(data, { filter: (f) => match(f.name) && f.originalSize <= MAX_ENTRY_BYTES })
}

/** 解出 DOCX 的正文 XML（只解 word/document.xml，拒绝 zip 炸弹） */
function readDocxXml(filePath: string): string {
  const files = readZipEntries(filePath, (n) => n === DOCX_ENTRY)
  const entry = files[DOCX_ENTRY]
  if (!entry) throw new Error(`缺少 ${DOCX_ENTRY}，不是有效的 DOCX 文件`)
  return new TextDecoder('utf-8').decode(entry)
}

/* ------------------------------ PPTX / XLSX 抽取 ------------------------------ */

const PPTX_PRESENTATION_RELS = 'ppt/_rels/presentation.xml.rels'
const PPTX_SLIDE_RE = /^ppt\/slides\/slide\d+\.xml$/
const XLSX_WORKBOOK_RELS = 'xl/_rels/workbook.xml.rels'
const XLSX_SHARED_STRINGS_ENTRY = 'xl/sharedStrings.xml'
const XLSX_STYLES_ENTRY = 'xl/styles.xml'
const XLSX_SHEET_RE = /^xl\/worksheets\/sheet\d+\.xml$/

/** 解码 zip 条目为 UTF-8 文本 */
function decodeEntry(entry: Uint8Array | undefined): string {
  if (!entry) return ''
  return new TextDecoder('utf-8').decode(entry)
}

/**
 * rels 关系表 → Id → Target。
 * （ppt/presentation.xml 里只有 r:id，真实路径在 rels 里）
 */
function parseRels(xml: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of xml.matchAll(/<Relationship\s[^>]*\/>/g)) {
    const id = /\bId="([^"]*)"/.exec(m[0])?.[1]
    const target = /\bTarget="([^"]*)"/.exec(m[0])?.[1]
    if (id && target) map.set(id, target)
  }
  return map
}

/** 把 rels 里的相对 Target 拼成 zip 内绝对路径（处理 ../ 与前导 /） */
function resolveRelTarget(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const stack: string[] = []
  for (const part of (baseDir ? `${baseDir}/${target}` : target).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

/** PPTX 一段文字（<a:p>）里的全部 run */
function pptxParagraphText(paragraph: string): string {
  const out: string[] = []
  const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\s*\/>/g
  for (const m of paragraph.matchAll(re)) {
    if (m[1] !== undefined) out.push(decodeXmlEntities(m[1]))
    else out.push('\n')
  }
  return out.join('')
}

/** PPTX 一页（slideN.xml）里的文字：每段一行 */
function pptxSlideText(xml: string): string {
  const lines: string[] = []
  for (const m of xml.matchAll(/<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g)) {
    const text = pptxParagraphText(m[0]).trim()
    if (text) lines.push(text)
  }
  return lines.join('\n')
}

/** slideN.xml 的序号（用于兜底排序） */
function slideNo(name: string): number {
  return Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0)
}

/**
 * PPTX → 纯文本。
 * 顺序优先按 `ppt/presentation.xml` 的 sldIdLst（那是真实放映顺序），
 * 读不到再退回按 slideN.xml 的编号排。
 */
export function extractPptxText(filePath: string): string {
  const entries = readZipEntries(
    filePath,
    (n) => n === PPTX_PRESENTATION_ENTRY || n === PPTX_PRESENTATION_RELS || PPTX_SLIDE_RE.test(n)
  )
  const slideNames = Object.keys(entries).filter((n) => PPTX_SLIDE_RE.test(n))
  if (slideNames.length === 0) throw new Error('没有找到幻灯片（ppt/slides/*.xml）')

  let ordered = slideNames.slice().sort((a, b) => slideNo(a) - slideNo(b))
  const pres = decodeEntry(entries[PPTX_PRESENTATION_ENTRY])
  const relsXml = decodeEntry(entries[PPTX_PRESENTATION_RELS])
  if (pres && relsXml) {
    const rels = parseRels(relsXml)
    const ids: string[] = []
    for (const m of pres.matchAll(/<p:sldId\s[^>]*\/>/g)) {
      const rid = /\br:id="([^"]*)"/.exec(m[0])?.[1]
      if (rid) ids.push(rid)
    }
    const targets = ids
      .map((id) => rels.get(id))
      .filter((t): t is string => !!t)
      .map((t) => resolveRelTarget('ppt', t))
    if (targets.length > 0 && targets.every((t) => slideNames.includes(t))) ordered = targets
  }

  const blocks: string[] = []
  ordered.forEach((name, i) => {
    blocks.push(`[幻灯片 ${i + 1}]\n${pptxSlideText(decodeEntry(entries[name]))}`)
  })
  return normalizeText(blocks.join('\n\n'))
}

/** XLSX 的 sharedStrings：`<si>` 一条，`<t>` 多段要拼起来 */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  const re = /<si(?:\s[^>]*)?\/>|<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g
  for (const m of xml.matchAll(re)) {
    if (m[1] === undefined) {
      out.push('')
      continue
    }
    let text = ''
    for (const t of m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += decodeXmlEntities(t[1])
    out.push(text)
  }
  return out
}

/** 单元格引用 `B7` → 列号 1（0 起） */
function colFromRef(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? ''
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** 取 `<v>` 里的原始值 */
function cellRawValue(inner: string): string {
  const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1]
  return v === undefined ? '' : decodeXmlEntities(v)
}

/* ------------------------------ XLSX 数字格式渲染 ------------------------------ */

/**
 * 内置 numFmtId → 格式码。
 * 日期/时间与普通数字都在这里，统一交给同一套「格式码 → 显示文本」渲染器；
 * 没列的（0=General）保持单元格原值。
 */
const BUILTIN_NUM_FMT_CODES: Record<number, string> = {
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  37: '#,##0;(#,##0)',
  38: '#,##0;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  48: '##0.0E+0',
  49: '@',
  14: 'm/d/yy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yy h:mm',
  27: 'yyyy"年"m"月"',
  28: 'm"月"d"日"',
  29: 'm"月"d"日"',
  30: 'm-d-yy',
  31: 'yyyy"年"m"月"d"日"',
  32: 'h"时"mm"分"',
  33: 'h"时"mm"分"ss"秒"',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mm:ss.0',
  50: 'yyyy"年"m"月"',
  51: 'm"月"d"日"',
  52: 'm"月"d"日"',
  53: 'm-d-yy',
  54: 'yyyy"年"m"月"d"日"',
  55: 'h"时"mm"分"',
  56: 'h"时"mm"分"ss"秒"'
}

/* ------------------------------ XLSX 颜色 ------------------------------ */

/** rgb 的 RRGGBB → 常见中文色名；其它颜色输出 `#RRGGBB`（不猜近似色） */
const BASE_COLOR_NAMES: Record<string, string> = {
  'FF0000': '红',
  '00FF00': '绿',
  '0000FF': '蓝',
  'FFFF00': '黄',
  'FF00FF': '品红',
  '00FFFF': '青',
  '000000': '黑',
  'FFFFFF': '白'
}

/** 格式码里的具名颜色（`[Red]` 等） */
const NAMED_FORMAT_COLORS: Record<string, string> = {
  black: '黑',
  blue: '蓝',
  cyan: '青',
  green: '绿',
  magenta: '品红',
  red: '红',
  white: '白',
  yellow: '黄'
}

/** OOXML 颜色值（AARRGGBB / RRGGBB）→ RRGGBB；认不出返回 null */
function normalizeRgb(value: string | undefined): string | null {
  if (!value) return null
  const hex = value.trim().replace(/^#/, '').toUpperCase()
  if (!/^(?:[0-9A-F]{6}|[0-9A-F]{8})$/.test(hex)) return null
  return hex.length === 8 ? hex.slice(2) : hex
}

function colorLabel(rgb: string): string {
  return BASE_COLOR_NAMES[rgb] ?? `#${rgb}`
}

/** 一段 XML 里第一个带 rgb 的 `<color>`（字体色 / dxf 字体色） */
function firstRgbColor(xml: string): string | null {
  return normalizeRgb(/<color\b[^>]*\brgb="([^"]+)"/.exec(xml)?.[1])
}

/** dxf 填充色：`fgColor` 优先，退回 `bgColor`（两者都不是 `<color>` 标签） */
function firstFillRgb(xml: string): string | null {
  const fg = /<fgColor\b[^>]*\brgb="([^"]+)"/.exec(xml)?.[1]
  const bg = /<bgColor\b[^>]*\brgb="([^"]+)"/.exec(xml)?.[1]
  return normalizeRgb(fg) ?? normalizeRgb(bg)
}

/** `<fonts>` → 每个 font 的显式字体色；黑色（默认前景色）与 theme/indexed 色一律不报 */
function parseFontColors(xml: string): Array<string | null> {
  const block = /<fonts(?:\s[^>]*)?>([\s\S]*?)<\/fonts>/.exec(xml)?.[1] ?? ''
  const out: Array<string | null> = []
  for (const m of block.matchAll(/<font(?:\s[^>]*)?\/>|<font(?:\s[^>]*)?>([\s\S]*?)<\/font>/g)) {
    const rgb = firstRgbColor(m[1] ?? '')
    out.push(rgb === null || rgb === '000000' ? null : colorLabel(rgb))
  }
  return out
}

/** `<fills>` → 每个 fill 的可见底色（只认显式 rgb；none / 白色 / theme 不报） */
function parseFillColors(xml: string): Array<string | null> {
  const block = /<fills(?:\s[^>]*)?>([\s\S]*?)<\/fills>/.exec(xml)?.[1] ?? ''
  const out: Array<string | null> = []
  for (const m of block.matchAll(/<fill(?:\s[^>]*)?\/>|<fill(?:\s[^>]*)?>([\s\S]*?)<\/fill>/g)) {
    const inner = m[1] ?? ''
    const patternTag = /<patternFill\b[^>]*>/.exec(inner)?.[0] ?? ''
    const patternType = /\bpatternType="([^"]+)"/.exec(patternTag)?.[1] ?? 'none'
    if (patternType === 'none') {
      out.push(null)
      continue
    }
    const patternInner = /<patternFill\b[^>]*>([\s\S]*?)<\/patternFill>/.exec(inner)?.[1] ?? ''
    const fg = /<fgColor\b[^>]*\brgb="([^"]+)"/.exec(patternInner)?.[1]
    const bg = /<bgColor\b[^>]*\brgb="([^"]+)"/.exec(patternInner)?.[1]
    // solid 的可见色在 fgColor（bgColor 常是 indexed=64 自动色）；其它图案退到 bgColor
    const rgb = normalizeRgb(patternType === 'solid' ? fg : (bg ?? fg))
    out.push(rgb === null || rgb === 'FFFFFF' ? null : colorLabel(rgb))
  }
  return out
}

/** 条件格式的 dxf（差异格式）：字体色 / 底色 */
interface XlsxDxfColors {
  font: string | null
  fill: string | null
}

function parseDxfs(xml: string): XlsxDxfColors[] {
  const block = /<dxfs(?:\s[^>]*)?>([\s\S]*?)<\/dxfs>/.exec(xml)?.[1] ?? ''
  const out: XlsxDxfColors[] = []
  for (const m of block.matchAll(/<dxf(?:\s[^>]*)?\/>|<dxf(?:\s[^>]*)?>([\s\S]*?)<\/dxf>/g)) {
    const inner = m[1] ?? ''
    const fontBlock = /<font(?:\s[^>]*)?>([\s\S]*?)<\/font>/.exec(inner)?.[1] ?? ''
    const fillBlock = /<fill(?:\s[^>]*)?>([\s\S]*?)<\/fill>/.exec(inner)?.[1] ?? ''
    const fontRgb = firstRgbColor(fontBlock)
    const fillRgb = firstFillRgb(fillBlock)
    out.push({
      font: fontRgb === null ? null : colorLabel(fontRgb),
      fill: fillRgb === null || fillRgb === 'FFFFFF' ? null : colorLabel(fillRgb)
    })
  }
  return out
}

/**
 * 解析 xl/styles.xml：
 *   - numFmts：自定义格式码（id ≥ 164）；
 *   - cellXfs：第 i 个 `<xf>` 的 numFmtId / fontId / fillId（单元格 `s="i"` 就指向第 i 个 xf）；
 *   - fonts / fills：静态字体色与底色；
 *   - dxfs：条件格式的差异格式（字体色 / 底色）。
 */
interface XlsxStyles {
  numFmtCodes: Map<number, string>
  cellXfFmtIds: number[]
  cellXfFontIds: number[]
  cellXfFillIds: number[]
  fontColors: Array<string | null>
  fillColors: Array<string | null>
  dxfs: XlsxDxfColors[]
}

function parseXlsxStyles(xml: string): XlsxStyles {
  const numFmtCodes = new Map<number, string>()
  for (const m of xml.matchAll(/<numFmt\s[^>]*\/>/g)) {
    const id = Number(/\bnumFmtId="(\d+)"/.exec(m[0])?.[1])
    const code = /\bformatCode="([^"]*)"/.exec(m[0])?.[1]
    if (Number.isFinite(id) && code !== undefined) numFmtCodes.set(id, decodeXmlEntities(code))
  }
  const cellXfFmtIds: number[] = []
  const cellXfFontIds: number[] = []
  const cellXfFillIds: number[] = []
  const cellXfs = /<cellXfs(?:\s[^>]*)?>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? ''
  for (const m of cellXfs.matchAll(/<xf(?:\s[^>]*)?\/>|<xf(?:\s[^>]*)?>([\s\S]*?)<\/xf>/g)) {
    const id = Number(/\bnumFmtId="(\d+)"/.exec(m[0])?.[1] ?? '0')
    cellXfFmtIds.push(Number.isFinite(id) ? id : 0)
    const fontId = Number(/\bfontId="(\d+)"/.exec(m[0])?.[1] ?? '0')
    cellXfFontIds.push(Number.isFinite(fontId) ? fontId : 0)
    const fillId = Number(/\bfillId="(\d+)"/.exec(m[0])?.[1] ?? '0')
    cellXfFillIds.push(Number.isFinite(fillId) ? fillId : 0)
  }
  return {
    numFmtCodes,
    cellXfFmtIds,
    cellXfFontIds,
    cellXfFillIds,
    fontColors: parseFontColors(xml),
    fillColors: parseFillColors(xml),
    dxfs: parseDxfs(xml)
  }
}

/** 单元格样式索引 → 静态字体色 / 底色（null = 默认，不输出） */
function staticCellColors(styles: XlsxStyles, styleIdx: number): { font: string | null; fill: string | null } {
  const fontId = styles.cellXfFontIds[styleIdx] ?? 0
  const fillId = styles.cellXfFillIds[styleIdx] ?? 0
  return {
    font: styles.fontColors[fontId] ?? null,
    fill: styles.fillColors[fillId] ?? null
  }
}

/** 格式段里的颜色标记（`[Red]` / `[Color10]`）→ 色名；没有返回 null */
function sectionColorName(section: string): string | null {
  for (const m of section.matchAll(/\[([^\]]*)\]/g)) {
    const inner = (m[1] ?? '').trim()
    const named = NAMED_FORMAT_COLORS[inner.toLowerCase()]
    if (named) return named
    const indexed = /^color\s*(\d+)$/i.exec(inner)
    if (indexed) return `Color${Number(indexed[1])}`
  }
  return null
}

/** 颜色信息附在单元格文本后（只在有颜色时出现，不改变无颜色单元格的既有输出） */
function colorMarker(font: string | null, fill: string | null): string {
  const parts: string[] = []
  if (font) parts.push(`颜色:${font}`)
  if (fill) parts.push(`底色:${fill}`)
  return parts.length > 0 ? ` [${parts.join(';')}]` : ''
}

/* ------------------------------ XLSX 条件格式 ------------------------------ */

interface XlsxCellRange {
  c1: number
  c2: number
  r1: number
  r2: number
}

interface XlsxCfRule {
  ranges: XlsxCellRange[]
  type: string
  operator: string
  text: string
  formulas: string[]
  dxfId: number
  stopIfTrue: boolean
  priority: number
}

function parseCellPosition(ref: string): { col: number; row: number } | null {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref.trim())
  if (!m) return null
  const row = Number(m[2])
  if (!Number.isFinite(row) || row <= 0) return null
  return { col: colFromRef(m[1] ?? ''), row }
}

function parseSqref(sqref: string): XlsxCellRange[] {
  const out: XlsxCellRange[] = []
  for (const token of sqref.trim().split(/\s+/)) {
    if (!token) continue
    const [startRef, endRef] = token.split(':')
    const start = parseCellPosition(startRef ?? '')
    if (!start) continue
    const end = endRef ? parseCellPosition(endRef) : start
    if (!end) continue
    out.push({
      c1: Math.min(start.col, end.col),
      c2: Math.max(start.col, end.col),
      r1: Math.min(start.row, end.row),
      r2: Math.max(start.row, end.row)
    })
  }
  return out
}

/** 工作表里的 `<conditionalFormatting>` → 规则清单（只收带 dxfId 的；图形类规则本阶段不处理） */
function parseConditionalFormatting(xml: string): XlsxCfRule[] {
  const out: XlsxCfRule[] = []
  for (const block of xml.matchAll(/<conditionalFormatting\b([^>]*)>([\s\S]*?)<\/conditionalFormatting>/g)) {
    const ranges = parseSqref(/\bsqref="([^"]*)"/.exec(block[1] ?? '')?.[1] ?? '')
    if (ranges.length === 0) continue
    for (const rm of (block[2] ?? '').matchAll(/<cfRule\b([^>]*?)(?:\/>|>([\s\S]*?)<\/cfRule>)/g)) {
      const attrs = rm[1] ?? ''
      const dxfId = Number(/\bdxfId="(\d+)"/.exec(attrs)?.[1])
      if (!Number.isFinite(dxfId)) continue
      const formulas: string[] = []
      for (const fm of (rm[2] ?? '').matchAll(/<formula(?:\s[^>]*)?>([\s\S]*?)<\/formula>/g)) {
        formulas.push(decodeXmlEntities(fm[1] ?? '').trim())
      }
      out.push({
        ranges,
        type: /\btype="([^"]*)"/.exec(attrs)?.[1] ?? '',
        operator: /\boperator="([^"]*)"/.exec(attrs)?.[1] ?? '',
        text: decodeXmlEntities(/\btext="([^"]*)"/.exec(attrs)?.[1] ?? ''),
        formulas,
        dxfId,
        stopIfTrue: /\bstopIfTrue="(?:1|true)"/i.test(attrs),
        priority: Number(/\bpriority="(\d+)"/.exec(attrs)?.[1] ?? '0')
      })
    }
  }
  return out
}

function cfFormulaValue(formula: string): string {
  const text = formula.trim()
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/""/g, '"')
  }
  return text
}

/** 只支持确定性强的规则类型；图形类（colorScale/dataBar/iconSet）与表达式一律跳过（fail-safe） */
function matchCfRule(rule: XlsxCfRule, text: string, num: number | null): boolean {
  const lower = text.toLowerCase()
  switch (rule.type) {
    case 'cellIs': {
      const a = cfFormulaValue(rule.formulas[0] ?? '')
      const numA = Number(a)
      const hasNumA = a !== '' && Number.isFinite(numA)
      const cmp = num !== null && hasNumA
      switch (rule.operator) {
        case 'greaterThan': return cmp && (num as number) > numA
        case 'greaterThanOrEqual': return cmp && (num as number) >= numA
        case 'lessThan': return cmp && (num as number) < numA
        case 'lessThanOrEqual': return cmp && (num as number) <= numA
        case 'between':
        case 'notBetween': {
          const b = cfFormulaValue(rule.formulas[1] ?? '')
          const numB = Number(b)
          if (!cmp || b === '' || !Number.isFinite(numB)) return false
          const lo = Math.min(numA, numB)
          const hi = Math.max(numA, numB)
          const inside = (num as number) >= lo && (num as number) <= hi
          return rule.operator === 'between' ? inside : !inside
        }
        case 'equal':
          return cmp ? (num as number) === numA : text === a
        case 'notEqual':
          return cmp ? (num as number) !== numA : text !== a
        default:
          return false
      }
    }
    case 'containsText':
      return rule.text !== '' && lower.includes(rule.text.toLowerCase())
    case 'notContainsText':
      return rule.text !== '' && !lower.includes(rule.text.toLowerCase())
    case 'beginsWith':
      return rule.text !== '' && lower.startsWith(rule.text.toLowerCase())
    case 'endsWith':
      return rule.text !== '' && lower.endsWith(rule.text.toLowerCase())
    default:
      return false
  }
}

/** 命中规则 → 字体色 / 底色（按 priority 升序；stopIfTrue 截断） */
function conditionalColors(
  rules: XlsxCfRule[],
  styles: XlsxStyles,
  row: number,
  col: number,
  text: string,
  num: number | null
): { font: string | null; fill: string | null } {
  let font: string | null = null
  let fill: string | null = null
  const ordered = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.ranges.some((r) => row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2))
    .sort((x, y) => x.rule.priority - y.rule.priority || x.index - y.index)
  for (const { rule } of ordered) {
    if (!matchCfRule(rule, text, num)) continue
    const dxf = styles.dxfs[rule.dxfId]
    if (dxf) {
      if (font === null) font = dxf.font
      if (fill === null) fill = dxf.fill
    }
    if (rule.stopIfTrue) break
  }
  return { font, fill }
}

/** 按分号切格式段（引号 / 转义 / 方括号里的分号不算分隔） */
function splitFormatSections(code: string): string[] {
  const out: string[] = []
  let cur = ''
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    if (ch === '"') {
      const end = code.indexOf('"', i + 1)
      const stop = end < 0 ? code.length : end + 1
      cur += code.slice(i, stop)
      i = stop
      continue
    }
    if (ch === '\\' || ch === '_' || ch === '*') {
      cur += code.slice(i, i + 2)
      i += 2
      continue
    }
    if (ch === '[') {
      const end = code.indexOf(']', i)
      const stop = end < 0 ? code.length : end + 1
      cur += code.slice(i, stop)
      i = stop
      continue
    }
    if (ch === ';') {
      out.push(cur)
      cur = ''
      i++
      continue
    }
    cur += ch
    i++
  }
  out.push(cur)
  return out
}

type DateTokenType = 'y' | 'm' | 'd' | 'h' | 's' | 'ampm' | 'ap' | 'eh' | 'em' | 'es' | 'literal'

interface DateToken {
  type: DateTokenType
  text: string
  count: number
}

/** 格式码 → token 流（引号/转义/宽度/填充都先摊平；方括号只认时长与货币符号） */
function tokenizeDateCode(section: string): DateToken[] {
  const tokens: DateToken[] = []
  let i = 0
  while (i < section.length) {
    const ch = section[i]
    if (ch === '"') {
      const end = section.indexOf('"', i + 1)
      const stop = end < 0 ? section.length : end + 1
      tokens.push({ type: 'literal', text: section.slice(i + 1, stop - 1).replace(/""/g, '"'), count: 0 })
      i = stop
      continue
    }
    if (ch === '\\') {
      tokens.push({ type: 'literal', text: section[i + 1] ?? '', count: 0 })
      i += 2
      continue
    }
    if (ch === '_') {
      tokens.push({ type: 'literal', text: ' ', count: 0 })
      i += 2
      continue
    }
    if (ch === '*') {
      i += 2
      continue
    }
    if (ch === '[') {
      const end = section.indexOf(']', i)
      const inner = end < 0 ? '' : section.slice(i + 1, end)
      const elapsed = /^([hms])\1*$/i.exec(inner)
      if (elapsed) {
        const unit = elapsed[1].toLowerCase()
        tokens.push({ type: unit === 'h' ? 'eh' : unit === 'm' ? 'em' : 'es', text: inner, count: inner.length })
      } else {
        const currency = /^\$([^\]-]*)/.exec(inner)?.[1]
        if (currency) tokens.push({ type: 'literal', text: currency, count: 0 })
      }
      i = end < 0 ? section.length : end + 1
      continue
    }
    if (ch === 'a' || ch === 'A') {
      const rest = section.slice(i)
      const m = /^(AM\/PM|A\/P)/i.exec(rest)
      if (m) {
        tokens.push({ type: m[1].length === 5 ? 'ampm' : 'ap', text: m[1], count: 1 })
        i += m[1].length
        continue
      }
    }
    const lower = ch.toLowerCase()
    if (lower === 'y' || lower === 'm' || lower === 'd' || lower === 'h' || lower === 's') {
      let j = i
      while (j < section.length && section[j].toLowerCase() === lower) j++
      tokens.push({ type: lower, text: section.slice(i, j), count: j - i })
      i = j
      continue
    }
    tokens.push({ type: 'literal', text: ch, count: 0 })
    i++
  }
  return tokens
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
const WEEK_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEK_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** 判断一段格式码是不是日期/时间（含 [h] 时长） */
function isDateFormat(code: string): DateToken[] | null {
  const section = splitFormatSections(code)[0] ?? ''
  const tokens = tokenizeDateCode(section)
  const hasDateToken = tokens.some(
    (t) => t.type === 'y' || t.type === 'm' || t.type === 'd' || t.type === 'h' || t.type === 's' ||
      t.type === 'eh' || t.type === 'em' || t.type === 'es' || t.type === 'ampm' || t.type === 'ap'
  )
  return hasDateToken ? tokens : null
}

/**
 * 日期格式码 → 显示文本（照搬 Excel 的显示样式）。
 *   - 支持 y/yy/yyyy、m/mm/mmm/mmmm、d/dd/ddd/dddd、h/hh、s/ss、AM/PM、A/P；
 *   - m 的月/分歧义看最近的日期 token：前面是 h、后面是 s → 分钟，否则月份；
 *   - [h]/[m]/[s] → 已用时长（序列号 × 24h 起算）；
 *   - 月名/星期名固定用英文，不依赖系统 locale（可复现）。
 */
function renderDateCode(serial: number, p: SerialParts, tokens: DateToken[]): string {
  const pad = (n: number, width: number): string => String(n).padStart(width, '0')
  const ampmToken = tokens.find((t) => t.type === 'ampm' || t.type === 'ap')
  const use12h = ampmToken !== undefined
  const hour12 = p.hh % 12 === 0 ? 12 : p.hh % 12
  const isMinuteAt = (k: number): boolean => {
    let prev: DateToken | null = null
    for (let j = k - 1; j >= 0; j--) {
      if (tokens[j].type !== 'literal') {
        prev = tokens[j]
        break
      }
    }
    let next: DateToken | null = null
    for (let j = k + 1; j < tokens.length; j++) {
      if (tokens[j].type !== 'literal') {
        next = tokens[j]
        break
      }
    }
    return prev?.type === 'h' || prev?.type === 'eh' || next?.type === 's'
  }
  const totalSec = Math.round(serial * 86_400)
  let out = ''
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]
    switch (t.type) {
      case 'literal':
        out += t.text
        break
      case 'y':
        out += t.count === 2 ? pad(p.y % 100, 2) : String(p.y)
        break
      case 'm':
        if (isMinuteAt(k)) out += t.count === 1 ? String(p.mi) : pad(p.mi, 2)
        else if (t.count >= 5) out += MONTH_LONG[p.mo - 1].slice(0, 1)
        else if (t.count === 4) out += MONTH_LONG[p.mo - 1]
        else if (t.count === 3) out += MONTH_SHORT[p.mo - 1]
        else out += t.count === 1 ? String(p.mo) : pad(p.mo, 2)
        break
      case 'd': {
        const weekday = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()
        if (t.count >= 4) out += WEEK_LONG[weekday]
        else if (t.count === 3) out += WEEK_SHORT[weekday]
        else out += t.count === 1 ? String(p.d) : pad(p.d, 2)
        break
      }
      case 'h':
        out += t.count === 1 ? String(use12h ? hour12 : p.hh) : pad(use12h ? hour12 : p.hh, 2)
        break
      case 's':
        out += t.count === 1 ? String(p.ss) : pad(p.ss, 2)
        break
      case 'ampm':
        out += p.hh < 12 ? t.text.slice(0, 2).toUpperCase() : t.text.slice(3).toUpperCase()
        break
      case 'ap':
        out += p.hh < 12 ? 'A' : 'P'
        break
      case 'eh':
        out += pad(Math.floor(totalSec / 3600), t.count)
        break
      case 'em':
        out += pad(Math.floor(totalSec / 60), t.count)
        break
      case 'es':
        out += pad(totalSec, t.count)
        break
    }
  }
  return out
}

/** 数字格式码里的一个数值占位段 */
interface NumberPattern {
  prefix: string
  suffix: string
  intPattern: string
  decPattern: string
  percent: number
  scale: number
  grouping: boolean
  autoMinus: boolean
}

/**
 * 格式段 → 数值占位段（前置/后置字面量、小数位、千分位、百分比、缩进千位）。
 * 不支持的（科学计数法、分数、文本 @）返回 null → 调用方保留原值。
 */
function parseNumberPattern(section: string, autoMinus: boolean): NumberPattern | null {
  let flat = ''
  let i = 0
  while (i < section.length) {
    const ch = section[i]
    if (ch === '"') {
      const end = section.indexOf('"', i + 1)
      const stop = end < 0 ? section.length : end + 1
      flat += section.slice(i + 1, stop - 1)
      i = stop
      continue
    }
    if (ch === '\\') {
      flat += section[i + 1] ?? ''
      i += 2
      continue
    }
    if (ch === '_') {
      flat += ' '
      i += 2
      continue
    }
    if (ch === '*') {
      i += 2
      continue
    }
    if (ch === '[') {
      const end = section.indexOf(']', i)
      const inner = end < 0 ? '' : section.slice(i + 1, end)
      const currency = /^\$([^\]-]*)/.exec(inner)?.[1]
      if (currency) flat += currency
      i = end < 0 ? section.length : end + 1
      continue
    }
    flat += ch
    i++
  }
  if (/[Ee][+-]/i.test(flat) || flat.includes('/') || flat.includes('@')) return null

  const core = /[#0?][#0?,]*(?:\.[#0?]+)?/.exec(flat)
  if (!core) return null
  const prefix = flat.slice(0, core.index)
  const suffix = flat.slice(core.index + core[0].length)
  let intPattern = core[0]
  let decPattern = ''
  const dot = intPattern.indexOf('.')
  if (dot >= 0) {
    decPattern = intPattern.slice(dot + 1)
    intPattern = intPattern.slice(0, dot)
  }
  const scaleCommas = intPattern.length - intPattern.replace(/,+$/, '').length
  intPattern = intPattern.slice(0, intPattern.length - scaleCommas)
  const grouping = intPattern.includes(',')
  intPattern = intPattern.replace(/,/g, '')
  if (!/[#0?]/.test(intPattern + decPattern)) return null
  return {
    prefix,
    suffix,
    intPattern,
    decPattern,
    percent: (flat.match(/%/g) ?? []).length,
    scale: scaleCommas,
    grouping,
    autoMinus
  }
}

/** 按数值正负/零选格式段（第 1/2/3 段；没有对应段时退回第 1 段） */
function pickFormatSection(code: string, num: number): string {
  const sections = splitFormatSections(code)
  if (num < 0) return sections.length >= 2 ? sections[1] ?? '' : sections[0] ?? ''
  if (num === 0) return sections.length >= 3 ? sections[2] ?? '' : sections[0] ?? ''
  return sections[0] ?? ''
}

/** 数字格式码 → 显示文本（0.00 / #,##0 / 0% / 货币 → 照搬 Excel；不支持则 null） */
function renderNumberCode(num: number, code: string): string | null {
  const sections = splitFormatSections(code)
  const section = pickFormatSection(code, num)
  let value = num
  let autoMinus = false
  if (num < 0) {
    value = Math.abs(num)
    autoMinus = sections.length < 2
  }
  const pattern = parseNumberPattern(section, autoMinus)
  if (!pattern) return null

  value = (value / Math.pow(1000, pattern.scale)) * Math.pow(100, pattern.percent)
  const decimals = pattern.decPattern.length
  const fixed = value.toFixed(decimals)
  let intPart = fixed.split('.')[0] ?? ''
  let fracPart = decimals > 0 ? fixed.split('.')[1] ?? '' : ''

  // 可选小数位：`#` 去掉尾零，`?` 去掉后补空格
  for (let k = fracPart.length - 1; k >= 0; k--) {
    const spec = pattern.decPattern[k]
    if (spec === '0') break
    if (fracPart[k] !== '0') break
    fracPart = fracPart.slice(0, k) + (spec === '?' ? ' ' : '')
  }
  fracPart = fracPart.replace(/ +$/, '')

  const minInt = (pattern.intPattern.match(/0/g) ?? []).length
  intPart = intPart.padStart(minInt, '0')
  if (pattern.grouping && intPart.length > 3) {
    const sign = intPart.startsWith('-') ? '-' : ''
    const digits = sign ? intPart.slice(1) : intPart
    intPart = sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }

  const body = fracPart ? `${intPart}.${fracPart}` : intPart
  return `${pattern.autoMinus ? '-' : ''}${pattern.prefix}${body}${pattern.suffix}`
}

/** 数值单元格：按样式格式码渲染；识别不了就保留原值 */
function renderNumericCell(raw: string, code: string, date1904: boolean): string {
  const num = Number(raw)
  if (!Number.isFinite(num)) return raw
  const dateTokens = isDateFormat(code)
  if (dateTokens) {
    const parts = excelSerialToParts(num, date1904)
    return parts ? renderDateCode(num, parts, dateTokens) : raw
  }
  return renderNumberCode(num, code) ?? raw
}

/** 单元格样式索引 → 格式码（null = General / 未识别） */
function resolveFormatCode(styles: XlsxStyles, styleIdx: number): string | null {
  const numFmtId = styles.cellXfFmtIds[styleIdx] ?? 0
  const code = styles.numFmtCodes.get(numFmtId) ?? BUILTIN_NUM_FMT_CODES[numFmtId]
  if (code === undefined || code === 'General') return null
  return code
}

/** Excel 序列号 → 日历字段 */
interface SerialParts {
  y: number
  mo: number
  d: number
  hh: number
  mi: number
  ss: number
}

const MS_PER_DAY = 86_400_000

/**
 * Excel 序列号 → 日期。
 *   - 1900 历元（默认）：1899-12-31 + 天数；Excel 塞了个不存在的 1900-02-29，所以号 ≥ 61 要减 1 天；
 *   - 1904 历元（workbookPr@date1904="1"）：1904-01-01 + 天数（号 0 = 1904-01-01）；
 *   - 号 60 在 1900 历元里就是那个假的 1900-02-29 → 按字面输出。
 */
function excelSerialToParts(serial: number, date1904: boolean): SerialParts | null {
  if (!Number.isFinite(serial)) return null
  const whole = Math.floor(serial)
  let totalSec = Math.round((serial - whole) * 86_400)
  let dayShift = 0
  if (totalSec >= 86_400) {
    totalSec -= 86_400
    dayShift = 1
  }
  const hh = Math.floor(totalSec / 3600)
  const mi = Math.floor((totalSec % 3600) / 60)
  const ss = totalSec % 60

  if (!date1904 && whole === 60) return { y: 1900, mo: 2, d: 29, hh, mi, ss }

  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31)
  const days = (date1904 ? whole : whole < 60 ? whole : whole - 1) + dayShift
  const dt = new Date(base + days * MS_PER_DAY)
  return {
    y: dt.getUTCFullYear(),
    mo: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
    hh,
    mi,
    ss
  }
}

/** 一个工作表的行 → 单元格文本（按列号定位，缺的列补空；有颜色时文本后附 `[颜色:…]`） */
function parseXlsxSheet(xml: string, shared: string[], styles: XlsxStyles, date1904: boolean): string[] {
  interface Cell {
    col: number
    value: string
    font: string | null
    fill: string | null
  }
  const rows: Array<{ row: number; cells: Cell[] }> = []
  const fmtCache = new Map<number, string | null>()
  const fmtOf = (styleIdx: number): string | null => {
    if (!fmtCache.has(styleIdx)) fmtCache.set(styleIdx, resolveFormatCode(styles, styleIdx))
    return fmtCache.get(styleIdx) ?? null
  }
  const cfRules = parseConditionalFormatting(xml)

  let autoRow = 0
  for (const rm of xml.matchAll(/<row(?:\s[^>]*)?\/>|<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const tag = rm[0]
    const explicitRow = Number(/\br="(\d+)"/.exec(tag)?.[1] ?? 0)
    const rowNo = explicitRow > 0 ? explicitRow : autoRow + 1
    autoRow = rowNo
    const inner = rm[1] ?? ''
    const cells: Cell[] = []
    let autoCol = 0
    for (const cm of inner.matchAll(/<c\s[^>]*\/>|<c\s[^>]*>([\s\S]*?)<\/c>/g)) {
      const cellTag = cm[0]
      const cellInner = cm[1] ?? ''
      const ref = /\br="([A-Z]+\d+)"/.exec(cellTag)?.[1]
      const type = /\bt="([^"]*)"/.exec(cellTag)?.[1] ?? 'n'
      const styleIdx = Number(/\bs="(\d+)"/.exec(cellTag)?.[1] ?? '0')
      const col = ref ? colFromRef(ref) : autoCol
      autoCol = col + 1

      let value = ''
      let num: number | null = null
      let sectionColor: string | null = null
      if (type === 's') {
        const idx = Number(cellRawValue(cellInner))
        value = shared[idx] ?? ''
      } else if (type === 'inlineStr') {
        const is = /<is(?:\s[^>]*)?>([\s\S]*?)<\/is>/.exec(cellInner)?.[1] ?? ''
        for (const t of is.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) value += decodeXmlEntities(t[1])
      } else if (type === 'b') {
        value = cellRawValue(cellInner) === '1' ? 'TRUE' : 'FALSE'
      } else {
        value = cellRawValue(cellInner)
        // 数值单元格按样式格式码渲染（日期还原 / 0.00 / 千分位 / 百分比…）
        if (type === 'n' && value.trim() !== '') {
          const parsed = Number(value)
          if (Number.isFinite(parsed)) num = parsed
          const code = fmtOf(styleIdx)
          if (code) {
            value = renderNumericCell(value, code, date1904)
            if (num !== null) sectionColor = sectionColorName(pickFormatSection(code, num))
          }
        }
      }
      // 文本单元格的颜色在第 4 个格式段（`[Blue]@` 之类）
      if (sectionColor === null && (type === 's' || type === 'inlineStr' || type === 'str')) {
        const code = fmtOf(styleIdx)
        if (code) {
          const sections = splitFormatSections(code)
          if (sections.length >= 4) sectionColor = sectionColorName(sections[3] ?? '')
        }
      }

      if (value === '') {
        cells.push({ col, value, font: null, fill: null })
        continue
      }
      // 优先级：条件格式 > 格式段颜色 > 静态字体色；底色来自条件格式或静态填充
      const cf = conditionalColors(cfRules, styles, rowNo, col, value, num)
      const staticColors = staticCellColors(styles, styleIdx)
      cells.push({
        col,
        value,
        font: cf.font ?? sectionColor ?? staticColors.font,
        fill: cf.fill ?? staticColors.fill
      })
    }
    rows.push({ row: rowNo, cells })
  }

  const out: string[] = []
  for (const r of rows.sort((a, b) => a.row - b.row)) {
    const filled = r.cells.filter((c) => c.value !== '').sort((a, b) => a.col - b.col)
    if (filled.length === 0) continue
    const parts: string[] = []
    let expect = filled[0].col
    for (const c of filled) {
      while (expect < c.col) {
        parts.push('')
        expect++
      }
      parts.push(c.value + colorMarker(c.font, c.fill))
      expect = c.col + 1
    }
    while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
    out.push(parts.join(' | '))
  }
  return out
}

/**
 * XLSX → 纯文本。
 * 工作表顺序按 `xl/workbook.xml` 的 `<sheets>`（表名在这里），工作表正文在 rels 指向的 worksheet 里。
 * 单元格值分三类：`t="s"` 走 sharedStrings、`t="inlineStr"` 走内联字符串、其余是 `<v>` 里的原始值。
 * 日期还原：单元格 `s="i"` → `xl/styles.xml` 的 cellXfs[i] → numFmtId → 是日期/时间格式就把序列号转成日期。
 */
export function extractXlsxText(filePath: string): string {
  const entries = readZipEntries(
    filePath,
    (n) =>
      n === XLSX_WORKBOOK_ENTRY ||
      n === XLSX_WORKBOOK_RELS ||
      n === XLSX_SHARED_STRINGS_ENTRY ||
      n === XLSX_STYLES_ENTRY ||
      XLSX_SHEET_RE.test(n)
  )
  const workbook = decodeEntry(entries[XLSX_WORKBOOK_ENTRY])
  if (!workbook) throw new Error(`缺少 ${XLSX_WORKBOOK_ENTRY}，不是有效的 XLSX 文件`)

  const shared = parseSharedStrings(decodeEntry(entries[XLSX_SHARED_STRINGS_ENTRY]))
  const rels = parseRels(decodeEntry(entries[XLSX_WORKBOOK_RELS]))
  const styles = parseXlsxStyles(decodeEntry(entries[XLSX_STYLES_ENTRY]))
  const date1904 = /<workbookPr[^>]*\bdate1904="(?:1|true)"/i.test(workbook)

  const sheets: Array<{ name: string; path: string }> = []
  for (const m of workbook.matchAll(/<sheet\s[^>]*\/>/g)) {
    const tag = m[0]
    const name = /\bname="([^"]*)"/.exec(tag)?.[1] ?? ''
    const rid = /\br:id="([^"]*)"/.exec(tag)?.[1]
    const target = rid ? rels.get(rid) : undefined
    if (!target) continue
    const sheetPath = resolveRelTarget('xl', target)
    if (!XLSX_SHEET_RE.test(sheetPath)) continue
    sheets.push({ name: decodeXmlEntities(name), path: sheetPath })
  }
  // 兜底：workbook.xml 读不出表清单 → 直接按 worksheets 目录里的文件名排
  if (sheets.length === 0) {
    for (const name of Object.keys(entries).filter((n) => XLSX_SHEET_RE.test(n)).sort()) {
      sheets.push({ name: name.replace(/^xl\/worksheets\//, '').replace(/\.xml$/, ''), path: name })
    }
  }
  if (sheets.length === 0) throw new Error('没有找到工作表（xl/worksheets/*.xml）')

  const blocks: string[] = []
  for (const sheet of sheets) {
    const rows = parseXlsxSheet(decodeEntry(entries[sheet.path]), shared, styles, date1904)
    if (rows.length === 0) continue
    blocks.push(`[工作表 ${sheet.name}]\n${rows.join('\n')}`)
  }
  return normalizeText(blocks.join('\n\n'))
}

/* ------------------------------ 对外接口 ------------------------------ */

/** 文件库文档清单（给 agent 用：先知道有哪些文件，再点名预览） */
export interface DocumentListItem {
  name: string
  path: string
  size: number
  modifiedAt: string
  kind: DocumentKind
}

export function listDocuments(): DocumentListItem[] {
  const dir = libraryRoot()
  if (!fs.existsSync(dir)) return []
  const out: DocumentListItem[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const full = path.join(dir, entry.name)
    const stat = fs.statSync(full)
    out.push({
      name: entry.name,
      path: full,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      kind: detectDocumentKind(full)
    })
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

/** 在文件库里按文件名找（精确名优先，其次忽略大小写；同名取最近修改的） */
function findByName(name: string): string {
  const items = listDocuments()
  const exact = items.find((i) => i.name === name)
  const hit = exact ?? items.find((i) => i.name.toLowerCase() === name.toLowerCase())
  if (!hit) throw new Error(`文件库里没有这个文件：${name}`)
  return hit.path
}

/** 解析 path/name 入参（二选一） */
function resolveInputPath(input: { path?: string; name?: string }): string {
  const rawPath = input.path?.trim() ? input.path.trim() : input.name?.trim() ? findByName(input.name.trim()) : ''
  if (!rawPath) throw new Error('缺少参数：path 或 name')
  const resolved = resolveLibraryFile(rawPath)
  if (!fs.existsSync(resolved)) throw new Error(`文件不存在：${path.basename(resolved)}`)
  return resolved
}

export interface DocumentPreviewInput {
  path?: string
  name?: string
  maxPages?: number
  maxChars?: number
}

/**
 * 预览一个文档（PDF / DOCX / PPTX / XLSX；其余类型明确告知，不猜）。
 * 出错也不抛：把原因写进 error 字段，界面与 agent 都能读到人话。
 */
export async function previewDocument(input: DocumentPreviewInput): Promise<DocumentPreview> {
  const resolved = resolveInputPath(input)
  const stat = fs.statSync(resolved)

  const base: DocumentPreview = {
    kind: detectDocumentKind(resolved),
    name: path.basename(resolved),
    path: resolved,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    pageCount: null,
    pages: [],
    text: '',
    truncated: false,
    error: null
  }

  const maxChars = Math.max(1, Math.min(input.maxChars ?? MAX_CHARS, MAX_CHARS))

  // Office 三兄弟（DOCX / PPTX / XLSX）都是「zip + XML」，解出文本即可
  if (base.kind === 'docx' || base.kind === 'pptx' || base.kind === 'xlsx') {
    const label = base.kind.toUpperCase()
    if (stat.size > MAX_FILE_BYTES) {
      return { ...base, error: `文件过大（${stat.size} B），超过 ${MAX_FILE_BYTES} B 上限，不做预览` }
    }
    try {
      const text =
        base.kind === 'docx'
          ? extractDocxText(readDocxXml(resolved))
          : base.kind === 'pptx'
            ? extractPptxText(resolved)
            : extractXlsxText(resolved)
      if (!text) return { ...base, error: `${label} 里没有可抽取的文字` }
      const truncated = text.length > maxChars
      return {
        ...base,
        text: truncated ? text.slice(0, maxChars) : text,
        truncated,
        error: null
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
      return { ...base, error: `${label} 解析失败：${msg.slice(0, 200)}` }
    }
  }

  if (base.kind !== 'pdf') {
    return { ...base, error: '暂只支持 PDF / DOCX / PPTX / XLSX 预览（其他格式请用文件列表里的文本读取）' }
  }
  if (stat.size > MAX_FILE_BYTES) {
    return { ...base, error: `文件过大（${stat.size} B），超过 ${MAX_FILE_BYTES} B 上限，不做预览` }
  }

  const maxPages = Math.max(1, Math.min(input.maxPages ?? MAX_PAGES, MAX_PAGES))

  try {
    const pdfjs = loadPdfjs()
    const data = new Uint8Array(fs.readFileSync(resolved))
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise
    const pages: DocumentPreviewPage[] = []
    let chars = 0
    let truncated = false
    const take = Math.min(doc.numPages, maxPages)
    for (let i = 1; i <= take; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const text = itemsToText(content.items)
      pages.push({ page: i, text })
      chars += text.length
      if (chars >= maxChars) {
        truncated = true
        break
      }
    }
    if (doc.numPages > take) truncated = true
    return {
      ...base,
      pageCount: doc.numPages,
      pages,
      text: pages.map((p) => p.text).join('\n\n'),
      truncated,
      error: null
    }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    const reason = /password|encrypt/i.test(msg) ? 'PDF 已加密，需要密码才能预览' : `PDF 解析失败：${msg.slice(0, 200)}`
    return { ...base, error: reason }
  }
}

/* ------------------------------ PDF 位图渲染 ------------------------------ */

export interface DocumentPageImageInput {
  path?: string
  name?: string
  page?: number
  scale?: number
}

/**
 * 把 PDF 的某一页渲染成 PNG data URL（只给界面看；agent 读文本即可）。
 * 出错直接抛（调用方是 IPC/界面，不是 agent），由界面显示原因。
 */
export async function renderDocumentPage(input: DocumentPageImageInput): Promise<DocumentPageImage> {
  const resolved = resolveInputPath(input)
  const stat = fs.statSync(resolved)
  if (detectDocumentKind(resolved) !== 'pdf') throw new Error('只有 PDF 支持位图预览')
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`文件过大（${stat.size} B），超过 ${MAX_FILE_BYTES} B 上限，不渲染`)
  }

  const canvasMod = loadCanvas()
  const pdfjs = loadPdfjs()
  const data = new Uint8Array(fs.readFileSync(resolved))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise
  const pageNo = Math.max(1, Math.min(Math.floor(input.page ?? 1), doc.numPages))
  const scale = Math.max(MIN_SCALE, Math.min(input.scale ?? 1.5, MAX_SCALE))

  const page = await doc.getPage(pageNo)
  const viewport = page.getViewport({ scale })
  const canvas = canvasMod.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const ctx = canvas.getContext('2d')
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  const png = canvas.toBuffer('image/png')
  return {
    page: pageNo,
    width: canvas.width,
    height: canvas.height,
    dataUrl: `data:image/png;base64,${png.toString('base64')}`
  }
}