import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { app } from 'electron'
import { unzipSync } from 'fflate'
import { paths } from './paths'
import type {
  DocumentKind,
  DocumentOutlineNode,
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
 * 第三十阶段：PDF 多页缩略图（按目标宽度归一渲染）+ 渲染参数（page / scale）暴露到界面。
 * 第三十一阶段：PDF 目录（书签）解析 + 可指定页码范围抽取（startPage / endPage）。
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
/** 缩略图默认目标宽度（像素）：比 scale 更贴近「导航条」的语义 */
const THUMB_WIDTH = 132
/** 缩略图宽度上下限 */
const MIN_THUMB_WIDTH = 48
const MAX_THUMB_WIDTH = 400
/** 一次最多渲染多少张缩略图（防止一次渲染几十页把主进程卡住） */
const MAX_THUMBS = 24
/** 目录最大层数（畸形文件里可能有自引用 → 限深） */
const MAX_OUTLINE_DEPTH = 8

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
  /** 页内注释（链接 / 便笺 / 表单域）；pdfjs 有，别的实现可能没有 → 可选 + 运行时兜底 */
  getAnnotations?(): Promise<PdfAnnotation[]>
}
interface PdfOutlineItem {
  title?: string
  dest?: unknown
  items?: PdfOutlineItem[]
}
/** PDF 注释（pdfjs getAnnotations 的返回项，只取用得到的字段） */
interface PdfAnnotation {
  subtype?: string
  /** 外部链接目标 */
  url?: string
  /** 注释正文 */
  contentsObj?: { str?: string }
  /** 注释作者 */
  titleObj?: { str?: string }
  /** 表单域字段名 */
  fieldName?: string
  /** 表单域已填值 */
  fieldValue?: string
  /** 内部跳转目标 */
  dest?: unknown
}
interface PdfDocument {
  numPages: number
  getPage(n: number): Promise<PdfPage>
  /** 目录（书签）；pdfjs 有，别的实现可能没有 → 用可选方法 + 运行时兜底 */
  getOutline?(): Promise<PdfOutlineItem[] | null>
  /** 命名目标 → 目标数组 */
  getDestination?(id: string): Promise<unknown>
  /** 页面引用 → 0 起的页序号 */
  getPageIndex?(ref: unknown): Promise<number>
  /** 文档元数据（Info 字典）；pdfjs 有 → 可选 + 运行时兜底 */
  getMetadata?(): Promise<{ info?: Record<string, unknown> }>
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
  fillStyle: string
  fillRect(x: number, y: number, w: number, h: number): void
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

/* ---------------------- DOCX 结构：标题 / 列表 / 富文本 / 页眉脚注 ---------------------- */

const DOCX_STYLES_ENTRY = 'word/styles.xml'
const DOCX_NUMBERING_ENTRY = 'word/numbering.xml'
const DOCX_FOOTNOTES_ENTRY = 'word/footnotes.xml'
/** 尾注部件（与 footnotes.xml 同构，w:endnote 换 w:footnote） */
const DOCX_ENDNOTES_ENTRY = 'word/endnotes.xml'
const DOCX_HEADER_RE = /^word\/header\d*\.xml$/
const DOCX_FOOTER_RE = /^word\/footer\d*\.xml$/
const DOCX_RELS_ENTRY = 'word/_rels/document.xml.rels'
const DOCX_COMMENTS_ENTRY = 'word/comments.xml'
/** 批注扩展部件：记录批注之间的回复关系（paraId → paraIdParent） */
const DOCX_COMMENTS_EXTENDED_ENTRY = 'word/commentsExtended.xml'
/** 图表部件（word/charts/chartN.xml） */
const DOCX_CHART_RE = /^word\/charts\/chart\d*\.xml$/
/** SmartArt 数据部件（word/diagrams/dataN.xml） */
const DOCX_DIAGRAM_RE = /^word\/diagrams\/data\d*\.xml$/

/** OOXML 三兄弟共用的文档属性部件（DOCX / XLSX / PPTX 位置相同） */
const DOC_CORE_PROPS_ENTRY = 'docProps/core.xml'
/** app.xml：应用 / 公司 / 页数 / 字数（三格式位置相同） */
const DOC_APP_PROPS_ENTRY = 'docProps/app.xml'
/** custom.xml：用户自定义属性（三格式位置相同） */
const DOC_CUSTOM_PROPS_ENTRY = 'docProps/custom.xml'

/** core.xml 里对阅读有用的元数据（空字段不输出） */
interface DocCoreProps {
  title: string
  creator: string
  lastModifiedBy: string
  modified: string
}

/**
 * 解析 `docProps/core.xml`。
 * XML 前缀可以任意绑定，`dc:` / `cp:` / `dcterms:` 只是惯例，
 * 所以只认本地名（`<任意前缀:title>`），不硬编码前缀。
 */
function parseCoreProps(xml: string): DocCoreProps {
  const pick = (local: string): string => {
    const re = new RegExp(
      `<(?:[\\w.-]+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${local}>`
    )
    return decodeXmlEntities(re.exec(xml)?.[1] ?? '').trim()
  }
  return {
    title: pick('title'),
    creator: pick('creator'),
    lastModifiedBy: pick('lastModifiedBy'),
    modified: pick('modified')
  }
}

/** `docProps/app.xml` 里对阅读有用的字段（空字段不输出） */
interface DocAppProps {
  application: string
  company: string
  pages: string
  words: string
}

/** `docProps/custom.xml` 的一条自定义属性 */
interface DocCustomProp {
  name: string
  value: string
}

/**
 * 解析 `docProps/app.xml`。
 * 与 core.xml 一样按**本地名**匹配（前缀可任意绑定）；只取有阅读价值的字段。
 */
function parseAppProps(xml: string): DocAppProps {
  const pick = (local: string): string => {
    const re = new RegExp(
      `<(?:[\\w.-]+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${local}>`
    )
    return decodeXmlEntities(re.exec(xml)?.[1] ?? '').trim()
  }
  return {
    application: pick('Application'),
    company: pick('Company'),
    pages: pick('Pages'),
    words: pick('Words')
  }
}

/**
 * 解析 `docProps/custom.xml`：`<property name="…">` + 任意 `vt:*` 值。
 * 值为多段（如 `vt:vector`）时按出现顺序拼成 `a, b`；空名或空值跳过。
 */
function parseCustomProps(xml: string): DocCustomProp[] {
  const out: DocCustomProp[] = []
  for (const m of xml.matchAll(
    /<(?:[\w.-]+:)?property\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?property>/g
  )) {
    const name = decodeXmlEntities(/\bname="([^"]*)"/.exec(m[1])?.[1] ?? '').trim()
    const value = decodeXmlEntities(
      m[2].replace(/<\/(?:[\w.-]+:)?(?:lpstr|lpwstr|bstr)\s*>/g, ', ').replace(/<[^>]+>/g, '')
    )
      .trim()
      .replace(/,\s*$/, '')
    if (name && value) out.push({ name, value })
  }
  return out
}

/**
 * docProps 家族 → 置顶行：core + app 合成一行 `[文档信息]`，custom 单独一行 `[自定义属性]`。
 * 空字段逐个省略；全部为空返回空数组（不出噪音行）。
 */
function docPropsLines(coreXml: string, appXml: string, customXml: string): string[] {
  const props = parseCoreProps(coreXml)
  const app = parseAppProps(appXml)
  const parts: string[] = []
  if (props.title) parts.push(`标题: ${props.title}`)
  if (props.creator) parts.push(`作者: ${props.creator}`)
  if (props.lastModifiedBy) parts.push(`修改人: ${props.lastModifiedBy}`)
  if (props.modified) parts.push(`修改时间: ${props.modified}`)
  if (app.application) parts.push(`应用: ${app.application}`)
  if (app.company) parts.push(`公司: ${app.company}`)
  if (app.pages) parts.push(`页数: ${app.pages}`)
  if (app.words) parts.push(`字数: ${app.words}`)
  const lines: string[] = []
  if (parts.length > 0) lines.push(`[文档信息] ${parts.join(' · ')}`)
  const custom = parseCustomProps(customXml)
  if (custom.length > 0) {
    lines.push(`[自定义属性] ${custom.map((p) => `${p.name}: ${p.value}`).join(' · ')}`)
  }
  return lines
}

/** DOCX 要抽的部件：正文 + 样式 + 编号 + 脚注尾注 + 页眉页脚 + 超链接关系 + 批注（含回复链）+ 文档属性 */
interface DocxParts {
  document: string
  styles: string
  numbering: string
  footnotes: string
  endnotes: string
  headers: string[]
  footers: string[]
  rels: string
  comments: string
  /** 批注回复的线程结构（可缺失） */
  commentsExtended: string
  /** 图形部件（图表 / SmartArt）：zip 内路径 → xml */
  graphics: Record<string, string>
  coreProps: string
  appProps: string
  customProps: string
}

/** 缩进哨兵：归一化会把连续空格压成一个，所以先用哨兵占位，最后再还原成空格 */
const DOCX_INDENT = '\u0000'

interface DocxStyleInfo {
  name: string
  /** 标题级别（1~9）；不是标题为 null */
  headingLevel: number | null
}

/** 样式名 → 标题级别：认「heading 1」「标题 1」（Word 中文版样式名） */
function headingLevelFromStyleName(name: string): number | null {
  const m = /^(?:heading|标题)\s*(\d{1,2})$/i.exec(name.trim())
  if (!m) return null
  const lv = Number(m[1])
  return lv >= 1 && lv <= 9 ? lv : null
}

/** styles.xml → styleId → { 名称, 标题级别 } */
function parseDocxStyles(xml: string): Map<string, DocxStyleInfo> {
  const map = new Map<string, DocxStyleInfo>()
  if (!xml) return map
  for (const m of xml.matchAll(/<w:style\b[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const styleId = /\bw:styleId="([^"]*)"/.exec(m[0])?.[1] ?? ''
    if (!styleId) continue
    const body = m[1]
    const name = decodeXmlEntities(/\bw:name\b[^>]*\bw:val="([^"]*)"/.exec(body)?.[1] ?? '')
    const outline = Number(/<w:outlineLvl\b[^>]*\bw:val="(\d+)"/.exec(body)?.[1] ?? Number.NaN)
    const level = Number.isFinite(outline) ? outline + 1 : headingLevelFromStyleName(name)
    map.set(styleId, { name, headingLevel: level })
  }
  return map
}

interface DocxNumLevel {
  numFmt: string
  lvlText: string
  start: number
}

interface DocxNumbering {
  /** numId → abstractNumId */
  nums: Map<string, string>
  /** abstractNumId → ilvl → 级别定义 */
  levels: Map<string, Map<number, DocxNumLevel>>
}

/** numbering.xml → 编号定义 */
function parseDocxNumbering(xml: string): DocxNumbering {
  const nums = new Map<string, string>()
  const levels = new Map<string, Map<number, DocxNumLevel>>()
  if (!xml) return { nums, levels }
  for (const m of xml.matchAll(/<w:abstractNum\b[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const absId = /\bw:abstractNumId="([^"]*)"/.exec(m[0])?.[1] ?? ''
    if (!absId) continue
    const lv = new Map<number, DocxNumLevel>()
    for (const lm of m[1].matchAll(/<w:lvl\b[^>]*>([\s\S]*?)<\/w:lvl>/g)) {
      const ilvl = Number(/\bw:ilvl="(\d+)"/.exec(lm[0])?.[1] ?? Number.NaN)
      if (!Number.isFinite(ilvl)) continue
      const body = lm[1]
      const start = Number(/\bw:start\b[^>]*\bw:val="(\d+)"/.exec(body)?.[1] ?? '1')
      lv.set(ilvl, {
        numFmt: /\bw:numFmt\b[^>]*\bw:val="([^"]*)"/.exec(body)?.[1] ?? 'decimal',
        lvlText: decodeXmlEntities(/\bw:lvlText\b[^>]*\bw:val="([^"]*)"/.exec(body)?.[1] ?? ''),
        start: Number.isFinite(start) && start > 0 ? start : 1
      })
    }
    levels.set(absId, lv)
  }
  for (const m of xml.matchAll(/<w:num\b[^>]*>([\s\S]*?)<\/w:num>/g)) {
    const numId = /\bw:numId="([^"]*)"/.exec(m[0])?.[1] ?? ''
    const absId = /\bw:abstractNumId\b[^>]*\bw:val="([^"]*)"/.exec(m[1])?.[1] ?? ''
    if (numId && absId) nums.set(numId, absId)
  }
  return { nums, levels }
}

/** 26 → z，27 → aa */
function toAlpha(value: number): string {
  let n = Math.max(1, Math.floor(value))
  let out = ''
  while (n > 0) {
    const rest = (n - 1) % 26
    out = String.fromCharCode(65 + rest) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

const ROMAN_TABLE: Array<[number, string]> = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
]

/** 4 → iv（罗马数字上限 3999） */
function toRoman(value: number): string {
  let n = Math.floor(value)
  if (!Number.isFinite(n) || n < 1 || n > 3999) return String(value)
  let out = ''
  for (const [num, sym] of ROMAN_TABLE) {
    while (n >= num) {
      out += sym
      n -= num
    }
  }
  return out
}

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** 中文数字（1~9999），用于 chineseCounting 一类的编号格式 */
function toChineseNumber(value: number): string {
  const n = Math.floor(value)
  if (!Number.isFinite(n) || n < 1) return String(value)
  if (n < 10) return CN_DIGITS[n]
  if (n < 20) return '十' + (n % 10 ? CN_DIGITS[n % 10] : '')
  if (n < 100) {
    const t = Math.floor(n / 10)
    const o = n % 10
    return CN_DIGITS[t] + '十' + (o ? CN_DIGITS[o] : '')
  }
  if (n < 1000) {
    const h = Math.floor(n / 100)
    const rest = n % 100
    if (rest === 0) return CN_DIGITS[h] + '百'
    return CN_DIGITS[h] + '百' + (rest < 10 ? '零' + CN_DIGITS[rest] : toChineseNumber(rest))
  }
  const k = Math.floor(n / 1000)
  const rest = n % 1000
  if (rest === 0) return CN_DIGITS[k] + '千'
  return CN_DIGITS[k] + '千' + (rest < 100 ? '零' + toChineseNumber(rest) : toChineseNumber(rest))
}

/** 编号格式 → 编号文本 */
function formatListNumber(value: number, numFmt: string): string {
  switch (numFmt) {
    case 'lowerLetter':
      return toAlpha(value).toLowerCase()
    case 'upperLetter':
      return toAlpha(value)
    case 'lowerRoman':
      return toRoman(value).toLowerCase()
    case 'upperRoman':
      return toRoman(value)
    case 'chineseCounting':
    case 'chineseCountingThousand':
    case 'ideographTraditional':
      return toChineseNumber(value)
    case 'none':
      return ''
    default:
      return String(value)
  }
}

/** 渲染一个列表项的编号文本（按 lvlText 模板替换 %1/%2…），并推进该 numId 的计数器 */
function docxListLabel(
  numbering: DocxNumbering,
  numId: string,
  ilvl: number,
  counters: Map<string, number[]>
): string {
  const absId = numbering.nums.get(numId)
  const lvls = absId ? numbering.levels.get(absId) : undefined
  const lvl = lvls?.get(ilvl)
  if (!lvl) return ''
  const cs = counters.get(numId) ?? []
  while (cs.length < ilvl) cs.push(0)
  // 本级 +1（首次从 start 开始），更深层级清零
  cs[ilvl] = (cs[ilvl] ?? lvl.start - 1) + 1
  cs.length = ilvl + 1
  counters.set(numId, cs)
  const template = lvl.lvlText || (lvl.numFmt === 'bullet' ? '•' : '%1.')
  if (lvl.numFmt === 'bullet') return template
  return template.replace(/%(\d)/g, (_m, d: string) => {
    const idx = Number(d) - 1
    const fmt = lvls?.get(idx)?.numFmt ?? 'decimal'
    return formatListNumber(cs[idx] ?? 0, fmt)
  })
}

interface DocxParaProps {
  headingLevel: number | null
  numId: string
  ilvl: number
}

/** 段落属性：标题级别 / 列表编号（只看段落自己的 pPr） */
function docxParagraphProps(paragraph: string, styles: Map<string, DocxStyleInfo>): DocxParaProps {
  const pPr = /<w:pPr(?:\s[^>]*)?>([\s\S]*?)<\/w:pPr>/.exec(paragraph)?.[1] ?? ''
  const styleId = /\bw:pStyle\b[^>]*\bw:val="([^"]*)"/.exec(pPr)?.[1] ?? ''
  let headingLevel = styles.get(styleId)?.headingLevel ?? null
  if (headingLevel === null) {
    const outline = Number(/<w:outlineLvl\b[^>]*\bw:val="(\d+)"/.exec(pPr)?.[1] ?? Number.NaN)
    if (Number.isFinite(outline)) headingLevel = outline + 1
  }
  const numId = /\bw:numId\b[^>]*\bw:val="([^"]*)"/.exec(pPr)?.[1] ?? ''
  const ilvl = Number(/\bw:ilvl\b[^>]*\bw:val="(\d+)"/.exec(pPr)?.[1] ?? '0')
  return { headingLevel, numId, ilvl: Number.isFinite(ilvl) && ilvl > 0 ? ilvl : 0 }
}

interface DocxRun {
  text: string
  bold: boolean
  italic: boolean
}

/** rPr 里某个开关是否打开（`<w:b/>` 开、`<w:b w:val="0"/>` 关） */
function docxToggleOn(rPr: string, tag: string): boolean {
  const m = new RegExp(`<${tag}((?:\\s[^>]*?)?)(/?)>`).exec(rPr)
  if (!m) return false
  const val = /\bw:val="([^"]*)"/.exec(m[1] ?? '')?.[1]
  if (val === undefined) return true
  return val !== '0' && val !== 'false' && val !== 'off'
}

/** 图片（wp:docPr）的替代文字：descr 优先、title 兜底；都空不输出（name 是「图片 N」这类噪音） */
function docxImageAlt(attrs: string): string {
  const pick = (name: string): string =>
    decodeXmlEntities(
      new RegExp(`(?:[\\w.-]+:)?${name}="([^"]*)"`).exec(attrs)?.[1] ?? ''
    ).trim()
  return pick('descr') || pick('title')
}

/** 段落里的 run（按文档顺序）：文本 + 粗体/斜体标记 + 脚注/尾注引用角标 + 图片替代文字 */
function docxRuns(
  paragraph: string,
  footnoteNumbers: Map<string, number>,
  endnoteNumbers: Map<string, number>
): DocxRun[] {
  const runs: DocxRun[] = []
  const re = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g
  for (const m of paragraph.matchAll(re)) {
    const body = m[1]
    const rPr = /<w:rPr(?:\s[^>]*)?>([\s\S]*?)<\/w:rPr>/.exec(body)?.[1] ?? ''
    const bold = docxToggleOn(rPr, 'w:b')
    const italic = docxToggleOn(rPr, 'w:i')
    let text = ''
    const inner =
      /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\s*\/>|<w:footnoteReference\b[^>]*\bw:id="(\d+)"[^>]*\/>|<w:endnoteReference\b[^>]*\bw:id="(\d+)"[^>]*\/>|<wp:docPr\b([^>]*)>/g
    for (const t of body.matchAll(inner)) {
      if (t[1] !== undefined) text += decodeXmlEntities(t[1])
      else if (t[2] === 'tab') text += '\t'
      else if (t[2] !== undefined) text += '\n'
      else if (t[3] !== undefined) {
        const num = footnoteNumbers.get(t[3])
        if (num) text += `[${num}]`
      } else if (t[4] !== undefined) {
        const num = endnoteNumbers.get(t[4])
        if (num) text += `[${num}]`
      } else {
        // alt 优先 wp:docPr（descr→title）；都空退读 pic:cNvPr@descr（WPS/LibreOffice 常见写法）
        let alt = docxImageAlt(t[5] ?? '')
        if (!alt) {
          const m = /<(?:[\w.-]+:)?cNvPr\b([^>]*)>/.exec(body)
          if (m) alt = decodeXmlEntities(/\bdescr="([^"]*)"/.exec(m[1] ?? '')?.[1] ?? '').trim()
        }
        if (alt) text += `[图片: ${alt}]`
      }
    }
    runs.push({ text, bold, italic })
  }
  return runs
}

/** run 序列 → 文本（粗体 `**x**`、斜体 `*x*`、粗斜体 `***x***`） */
function docxRunsText(runs: DocxRun[]): string {
  const parts: string[] = []
  let i = 0
  while (i < runs.length) {
    const head = runs[i]
    let text = head.text
    let j = i + 1
    while (j < runs.length && runs[j].bold === head.bold && runs[j].italic === head.italic) {
      text += runs[j].text
      j++
    }
    if (text) {
      if (head.bold && head.italic) parts.push(`***${text}***`)
      else if (head.bold) parts.push(`**${text}**`)
      else if (head.italic) parts.push(`*${text}*`)
      else parts.push(text)
    }
    i = j
  }
  return parts.join('')
}

/** DOCX 渲染上下文（样式表 / 编号表 / 计数器 / 脚注尾注序号 / 超链接 / 批注与回复链） */
interface DocxRenderCtx {
  styles: Map<string, DocxStyleInfo>
  numbering: DocxNumbering
  counters: Map<string, number[]>
  footnoteNumbers: Map<string, number>
  endnoteNumbers: Map<string, number>
  /** r:id → 超链接目标（外部 URL 或锚点） */
  hyperlinks: Map<string, string>
  /** 批注 id → {作者, 正文, 首段 paraId} */
  comments: Map<string, { author: string; text: string; paraId: string }>
  /** 根批注 id → 后代的回复 id（按 comments.xml 文档顺序，多级已摊平） */
  commentThread: Map<string, string[]>
  /** 作为回复存在的批注 id（跟根批注一起输出，不单独再出） */
  commentReplyIds: Set<string>
  /** r:id → 图表 / SmartArt 标记（如 `[图表: …]`） */
  graphics: Map<string, string>
}

/**
 * 段落 → 文本。
 * structure=true 时带结构标记：标题 `#`~`######`、列表项编号（真实多级编号 + 缩进）。
 */
function renderDocxParagraph(
  paragraph: string,
  ctx: DocxRenderCtx,
  structure: boolean
): string {
  const props = docxParagraphProps(paragraph, ctx.styles)
  const text = docxRunsText(docxRuns(paragraph, ctx.footnoteNumbers, ctx.endnoteNumbers))
  const extras = docxExtras(paragraph, ctx)
  if (!text.trim()) return extras.trim()
  if (!structure) return text.trim() + extras
  let prefix = ''
  if (props.headingLevel !== null) {
    prefix = '#'.repeat(Math.min(props.headingLevel, 6)) + ' '
  } else if (props.numId) {
    const label = docxListLabel(ctx.numbering, props.numId, props.ilvl, ctx.counters)
    if (label) prefix = DOCX_INDENT.repeat(2 * props.ilvl) + label + ' '
  }
  return (prefix + text).trim() + extras
}

/** 脚注/尾注引用编号：按正文出现顺序给 1、2、3… */
function docxNoteNumbers(documentXml: string, kind: 'footnote' | 'endnote'): Map<string, number> {
  const map = new Map<string, number>()
  const re = new RegExp(`<w:${kind}Reference\\b[^>]*\\bw:id="(\\d+)"`, 'g')
  for (const m of documentXml.matchAll(re)) {
    if (!map.has(m[1])) map.set(m[1], map.size + 1)
  }
  return map
}

/** footnotes.xml / endnotes.xml → 注 id → 正文（分隔符/续行分隔符这类 id ≤ 0 的不要） */
function parseDocxNotes(xml: string, kind: 'footnote' | 'endnote'): Map<string, string> {
  const map = new Map<string, string>()
  if (!xml) return map
  const re = new RegExp(`<w:${kind}\\b[^>]*>([\\s\\S]*?)</w:${kind}>`, 'g')
  for (const m of xml.matchAll(re)) {
    const id = /\bw:id="(-?\d+)"/.exec(m[0])?.[1] ?? ''
    if (!id || Number(id) <= 0) continue
    const paras: string[] = []
    for (const p of docxChildElements(m[1], ['w:p'])) {
      const t = docxParagraphText(p.body).trim()
      if (t) paras.push(t)
    }
    if (paras.length > 0) map.set(id, paras.join(' '))
  }
  return map
}

/** 段落里的超链接目标（按出现顺序）：r:id 查 rels 的 Target；w:anchor 用 #锚点 */
function docxHyperlinkTargets(paragraph: string, rels: Map<string, string>): string[] {
  const out: string[] = []
  for (const m of paragraph.matchAll(/<w:hyperlink\b([^>]*)>/g)) {
    const attrs = m[1] ?? ''
    const rid = /\br:id="([^"]*)"/.exec(attrs)?.[1]
    const anchor = /\bw:anchor="([^"]*)"/.exec(attrs)?.[1]
    const target = rid ? rels.get(rid) : undefined
    if (target) out.push(target)
    else if (anchor) out.push(`#${anchor}`)
  }
  return out
}

/** 段落里批注范围的起始 id（<w:commentRangeStart w:id="N"/>） */
function docxCommentIds(paragraph: string): string[] {
  const out: string[] = []
  for (const m of paragraph.matchAll(/<w:commentRangeStart\b[^>]*\bw:id="([^"]*)"/g)) {
    out.push(m[1] ?? '')
  }
  return out
}

/** comments.xml → 批注 id → {作者, 正文, 首段 paraId}（正文只取纯文本，不带粗斜体标记） */
function parseDocxComments(
  xml: string
): Map<string, { author: string; text: string; paraId: string }> {
  const map = new Map<string, { author: string; text: string; paraId: string }>()
  if (!xml) return map
  for (const m of xml.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g)) {
    const id = /\bw:id="([^"]*)"/.exec(m[1] ?? '')?.[1]
    if (!id) continue
    const author = /\bw:author="([^"]*)"/.exec(m[1] ?? '')?.[1] ?? ''
    const paras: string[] = []
    for (const p of docxChildElements(m[2] ?? '', ['w:p'])) {
      const t = docxParagraphText(p.body).trim()
      if (t) paras.push(t)
    }
    const text = paras.join(' ')
    if (!text) continue
    // 首段的 paraId（w14:paraId 这类前缀按本地名匹配）；
    // 不会误配 paraIdParent —— 那串在 paraId 后还有 Parent，接不上 `="`
    const paraId = /(?:[\w.-]+:)?paraId="([^"]*)"/.exec(m[2] ?? '')?.[1] ?? ''
    map.set(id, { author, text, paraId })
  }
  return map
}

/**
 * commentsExtended.xml → 批注线程结构。
 * `commentEx` 的 paraId → paraIdParent 表示「这条批注回复了那一条」；
 * 回复挂在根批注之后按文档顺序摊平输出。部件缺失或解析不出时返回空结构，
 * 输出与没有回复链之前逐字一致（回归红线）。
 */
function buildDocxCommentThreads(
  comments: Map<string, { author: string; text: string; paraId: string }>,
  xml: string
): { thread: Map<string, string[]>; replies: Set<string> } {
  const thread = new Map<string, string[]>()
  const replies = new Set<string>()
  if (!xml || comments.size === 0) return { thread, replies }
  const attr = (attrs: string, name: string): string =>
    new RegExp(`(?:[\\w.-]+:)?${name}="([^"]*)"`).exec(attrs)?.[1] ?? ''
  const byParaId = new Map<string, string>()
  for (const [id, c] of comments) {
    if (c.paraId && !byParaId.has(c.paraId)) byParaId.set(c.paraId, id)
  }
  const parentOf = new Map<string, string>()
  for (const m of xml.matchAll(/<(?:[\w.-]+:)?commentEx\b([^>]*)>/g)) {
    const self = attr(m[1] ?? '', 'paraId')
    const parent = attr(m[1] ?? '', 'paraIdParent')
    if (!self || !parent) continue
    const id = byParaId.get(self)
    const root = byParaId.get(parent)
    if (!id || !root || id === root) continue
    parentOf.set(id, root)
  }
  // 沿 parentOf 上溯找根；seen 防环
  const rootOf = (id: string): string => {
    let cur = id
    const seen = new Set<string>()
    while (parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur)
      cur = parentOf.get(cur) as string
    }
    return cur
  }
  // comments 是 Map，迭代顺序 = comments.xml 文档顺序，挂到根下后回复保持原文顺序
  for (const [id] of comments) {
    if (!parentOf.has(id)) continue
    const root = rootOf(id)
    if (root === id) continue // 成环自指：当独立批注输出，不挂任何人、也不被任何人藏起
    replies.add(id)
    const list = thread.get(root) ?? []
    list.push(id)
    thread.set(root, list)
  }
  return { thread, replies }
}

/** 删除类修订的文本：`<w:delText>`（没有就回退 `<w:t>`） */
function docxDeletedText(body: string): string {
  const out: string[] = []
  for (const m of body.matchAll(/<w:delText(?:\s[^>]*)?>([\s\S]*?)<\/w:delText>/g)) {
    out.push(decodeXmlEntities(m[1]))
  }
  if (out.length === 0) return docxParagraphText(body)
  return out.join('')
}

/**
 * 段落里的修订痕迹标记（按文档顺序）。
 *
 * - `<w:ins>` = 插入（+），`<w:del>` = 删除（-）；
 * - `<w:moveTo>` = 移动到（按插入算），`<w:moveFrom>` = 移动自（按删除算）；
 * - 自闭合的 `<w:ins/>`（段落标记修订：`<w:pPr><w:rPr><w:ins/></w:rPr></w:pPr>`）没有块体 → 天然排除；
 * - 块体里没有文本（空壳修订）也不产生标记。
 */
function docxRevisionMarks(paragraph: string): string[] {
  const out: string[] = []
  const re = /<w:(ins|del|moveFrom|moveTo)\b([^>]*?)(\/>|>([\s\S]*?)<\/w:\1>)/g
  for (const m of paragraph.matchAll(re)) {
    const tag = m[1] ?? ''
    const body = m[4] ?? ''
    if (!body) continue
    const author = /\bw:author="([^"]*)"/.exec(m[2] ?? '')?.[1] ?? ''
    const inserted = tag === 'ins' || tag === 'moveTo'
    const text = inserted ? docxParagraphText(body) : docxDeletedText(body)
    if (!text) continue
    out.push(`[修订${inserted ? '+' : '-'}${author}: ${text}]`)
  }
  return out
}

/** 段落末尾附加的修订 / 链接 / 批注（含回复）/ 图表标记（没有就返回空串） */
function docxExtras(paragraph: string, ctx: DocxRenderCtx): string {
  const parts: string[] = docxRevisionMarks(paragraph)
  for (const target of docxHyperlinkTargets(paragraph, ctx.hyperlinks)) {
    parts.push(`[链接: ${target}]`)
  }
  for (const id of docxCommentIds(paragraph)) {
    if (ctx.commentReplyIds.has(id)) continue // 回复：跟着根批注一起输出
    const c = ctx.comments.get(id)
    if (c) parts.push(`[批注(${c.author}): ${c.text}]`)
    for (const rid of ctx.commentThread.get(id) ?? []) {
      const r = ctx.comments.get(rid)
      if (r) parts.push(`[回复(${r.author}): ${r.text}]`)
    }
  }
  parts.push(...graphicRefMarks(paragraph, ctx.graphics))
  return parts.length > 0 ? ` ${parts.join(' ')}` : ''
}

/**
 * 正文 rels → 关系 id → 图表 / SmartArt 标记。
 * 图表的关系类型是 …/chart，SmartArt 数据部件是 …/diagramData。
 */
function docxGraphicMarkMap(relsXml: string, graphics: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>()
  for (const e of parseRelEntries(relsXml)) {
    if (isExternalTarget(e.target)) continue
    const xml = graphics[resolveRelTarget('word', e.target)]
    if (!xml) continue
    if (e.type.endsWith('/chart')) {
      const mark = chartMarker(xml)
      if (mark) map.set(e.id, mark)
    } else if (e.type.endsWith('/diagramData')) {
      const mark = smartArtMarker(xml)
      if (mark) map.set(e.id, mark)
    }
  }
  return map
}

/**
 * XML 片段里的图形引用 → 图表 / SmartArt 标记（DOCX 段落 / PPTX graphicFrame 共用）。
 * 图表是 `<c:chart r:id="…"/>`，SmartArt 是 `<dgm:relIds r:dm="…"/>`（数据部件的关系 id）。
 */
function graphicRefMarks(xml: string, graphics: Map<string, string>): string[] {
  const out: string[] = []
  for (const m of xml.matchAll(/<(?:[\w.-]+:)?chart\b([^>]*)/g)) {
    const rid = /\br:id="([^"]*)"/.exec(m[1] ?? '')?.[1]
    const mark = rid ? graphics.get(rid) : undefined
    if (mark) out.push(mark)
  }
  for (const m of xml.matchAll(/<(?:[\w.-]+:)?relIds\b([^>]*)/g)) {
    const rid = /\br:dm="([^"]*)"/.exec(m[1] ?? '')?.[1]
    const mark = rid ? graphics.get(rid) : undefined
    if (mark) out.push(mark)
  }
  return out
}

/** 页眉/页脚部件 → 文本行（纯文本，不带结构标记） */
function docxHeaderLines(xml: string): string[] {
  const lines: string[] = []
  for (const p of docxChildElements(xml, ['w:p'])) {
    const t = docxParagraphText(p.body).trim()
    if (t) lines.push(t)
  }
  return lines
}

/** DOCX 的结构容器标签：只有这四种标签的嵌套会影响「直接子级」判定 */
const DOCX_CONTAINER_TAGS = 'w:tbl|w:tr|w:tc|w:p'

/** XML 结构元素（只取结构容器，w:r / w:t / a:r 等叶子不建节点） */
interface XmlElement {
  /** 标签名，如 w:tbl */
  tag: string
  /** 开始标签原文（如 `<a:tc gridSpan="2">`），属性要靠它读 */
  open: string
  /** 内部 XML */
  body: string
}

/**
 * 深度感知地取 content 里 wanted 的**直接子元素**（按文档顺序）。
 *
 * 为什么不能用非贪婪正则：`<w:tc>…</w:tc>` 会在**内层**单元格的 `</w:tc>` 提前收尾，
 * 表格一旦嵌套，外层的行列位就全错。这里按容器标签做栈式配对，同名嵌套不会打断匹配。
 * 只跟踪 containerTags 里的容器标签，其余标签（w:r / w:t / w:sdt …）不参与层级判定。
 */
function xmlChildElements(content: string, containerTags: string, wanted: string[]): XmlElement[] {
  const want = new Set(wanted)
  const out: XmlElement[] = []
  const tokenRe = new RegExp(`<(/?)(${containerTags})(?:\\s[^>]*?)?(/?)>`, 'g')
  const stack: string[] = []
  let curTag = ''
  let curOpen = ''
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
          out.push({ tag: popped, open: curOpen, body: content.slice(curStart, m.index) })
          curTag = ''
          curOpen = ''
        }
      }
      continue
    }
    if (selfClosing) {
      // 自闭合（如 <w:p/>）没有内容，按空子元素记
      if (stack.length === 0 && want.has(tag)) out.push({ tag, open: m[0], body: '' })
      continue
    }
    if (stack.length === 0 && want.has(tag)) {
      curTag = tag
      curOpen = m[0]
      curStart = m.index + m[0].length
    }
    stack.push(tag)
  }
  return out
}

/** DOCX 版的「直接子级」提取（容器标签固定为 DOCX_CONTAINER_TAGS） */
function docxChildElements(content: string, wanted: string[]): XmlElement[] {
  return xmlChildElements(content, DOCX_CONTAINER_TAGS, wanted)
}

/**
 * 表格单元格 → 文本
 * - 自身段落：多段用空格连接（沿用既有口径）；
 * - 内嵌表格：每行占一行，行内各列用 ` | ` 连接（渲染时转义成 `\|`，仍落在同一个外层格子里）。
 */
function docxCellText(cell: XmlElement, ctx: DocxRenderCtx): string {
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
      const t = renderDocxParagraph(child.body, ctx, false)
      if (t) own.push(t)
    } else {
      flush()
      for (const row of docxChildElements(child.body, ['w:tr'])) {
        const cells = docxChildElements(row.body, ['w:tc']).map((c) => docxCellText(c, ctx))
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
function docxCellSpan(cell: XmlElement): number {
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
function docxTableMarkdown(tableXml: string, ctx: DocxRenderCtx): string {
  const rows: string[][] = []
  for (const row of docxChildElements(tableXml, ['w:tr'])) {
    const cells: string[] = []
    for (const cell of docxChildElements(row.body, ['w:tc'])) {
      const span = docxCellSpan(cell)
      cells.push(markdownCell(docxCellText(cell, ctx)))
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

/**
 * DOCX → 纯文本。
 * 正文段落 + 表格转 Markdown 表格；标题带 `#`、列表项带真实编号、粗斜体带 `**`/`*`；
 * 页眉置顶、页脚置底、脚注尾注在正文之后（引用处内联 `[N]`，脚注段在前、尾注段在后）。
 */
function extractDocxText(parts: DocxParts): string {
  const comments = parseDocxComments(parts.comments)
  const threads = buildDocxCommentThreads(comments, parts.commentsExtended)
  const ctx: DocxRenderCtx = {
    styles: parseDocxStyles(parts.styles),
    numbering: parseDocxNumbering(parts.numbering),
    counters: new Map<string, number[]>(),
    footnoteNumbers: docxNoteNumbers(parts.document, 'footnote'),
    endnoteNumbers: docxNoteNumbers(parts.document, 'endnote'),
    hyperlinks: parseRels(parts.rels),
    comments,
    commentThread: threads.thread,
    commentReplyIds: threads.replies,
    graphics: docxGraphicMarkMap(parts.rels, parts.graphics)
  }
  const footnotes = parseDocxNotes(parts.footnotes, 'footnote')
  const endnotes = parseDocxNotes(parts.endnotes, 'endnote')
  const blocks: string[] = []

  // 文档属性：core（标题/作者/修改人/修改时间）+ app（应用/公司/页数/字数）+ custom
  for (const line of docPropsLines(parts.coreProps, parts.appProps, parts.customProps)) {
    blocks.push(line)
  }

  // 页眉（多个部件可能内容重复，去重）
  const seen = new Set<string>()
  for (const line of parts.headers.flatMap((h) => docxHeaderLines(h))) {
    if (seen.has(line)) continue
    seen.add(line)
    blocks.push(`[页眉] ${line}`)
  }

  // 深度感知地按文档顺序取正文里的段落与表格（表格里的段落归表格，不再重复抽）
  for (const block of docxChildElements(parts.document, ['w:p', 'w:tbl'])) {
    if (block.tag === 'w:tbl') {
      const table = docxTableMarkdown(block.body, ctx)
      if (table) blocks.push(table)
    } else {
      const text = renderDocxParagraph(block.body, ctx, true)
      if (text) blocks.push(text)
    }
  }

  // 脚注：按正文引用顺序编号
  const fnLines: string[] = []
  for (const [id, num] of [...ctx.footnoteNumbers.entries()].sort((a, b) => a[1] - b[1])) {
    const text = footnotes.get(id)
    if (text) fnLines.push(`${num}. ${text}`)
  }
  if (fnLines.length > 0) blocks.push('[脚注]', ...fnLines)

  // 尾注：与脚注同口径（按正文引用顺序编号），独立成段、排在脚注之后
  const enLines: string[] = []
  for (const [id, num] of [...ctx.endnoteNumbers.entries()].sort((a, b) => a[1] - b[1])) {
    const text = endnotes.get(id)
    if (text) enLines.push(`${num}. ${text}`)
  }
  if (enLines.length > 0) blocks.push('[尾注]', ...enLines)

  // 页脚
  const seenFooter = new Set<string>()
  for (const line of parts.footers.flatMap((f) => docxHeaderLines(f))) {
    if (seenFooter.has(line)) continue
    seenFooter.add(line)
    blocks.push(`[页脚] ${line}`)
  }

  // 缩进哨兵在归一化之后还原成空格（归一化会把连续空格压成一个）
  return normalizeText(blocks.join('\n')).replace(/\u0000/g, ' ')
}

/** 解出 zip 里需要的条目（只解这些条目，且每个条目有解压上限 → 拒 zip 炸弹） */
function readZipEntries(filePath: string, match: (name: string) => boolean): Record<string, Uint8Array> {
  const data = new Uint8Array(fs.readFileSync(filePath))
  return unzipSync(data, { filter: (f) => match(f.name) && f.originalSize <= MAX_ENTRY_BYTES })
}

/** 解出 DOCX 要用的部件（正文 + 样式 + 编号 + 脚注尾注 + 页眉页脚 + 批注含回复，拒绝 zip 炸弹） */
function readDocxParts(filePath: string): DocxParts {
  const files = readZipEntries(
    filePath,
    (n) =>
      n === DOCX_ENTRY ||
      n === DOCX_STYLES_ENTRY ||
      n === DOCX_NUMBERING_ENTRY ||
      n === DOCX_FOOTNOTES_ENTRY ||
      n === DOCX_ENDNOTES_ENTRY ||
      n === DOCX_RELS_ENTRY ||
      n === DOCX_COMMENTS_ENTRY ||
      n === DOCX_COMMENTS_EXTENDED_ENTRY ||
      n === DOC_CORE_PROPS_ENTRY || n === DOC_APP_PROPS_ENTRY || n === DOC_CUSTOM_PROPS_ENTRY ||
      DOCX_HEADER_RE.test(n) ||
      DOCX_FOOTER_RE.test(n) ||
      DOCX_CHART_RE.test(n) ||
      DOCX_DIAGRAM_RE.test(n)
  )
  const entry = files[DOCX_ENTRY]
  if (!entry) throw new Error(`缺少 ${DOCX_ENTRY}，不是有效的 DOCX 文件`)
  const dec = (u: Uint8Array | undefined): string =>
    u ? new TextDecoder('utf-8').decode(u) : ''
  const names = Object.keys(files)
  const graphics: Record<string, string> = {}
  for (const n of names.filter((n) => DOCX_CHART_RE.test(n) || DOCX_DIAGRAM_RE.test(n))) {
    graphics[n] = dec(files[n])
  }
  return {
    document: dec(entry),
    styles: dec(files[DOCX_STYLES_ENTRY]),
    numbering: dec(files[DOCX_NUMBERING_ENTRY]),
    footnotes: dec(files[DOCX_FOOTNOTES_ENTRY]),
    endnotes: dec(files[DOCX_ENDNOTES_ENTRY]),
    headers: names.filter((n) => DOCX_HEADER_RE.test(n)).sort().map((n) => dec(files[n])),
    footers: names.filter((n) => DOCX_FOOTER_RE.test(n)).sort().map((n) => dec(files[n])),
    rels: dec(files[DOCX_RELS_ENTRY]),
    comments: dec(files[DOCX_COMMENTS_ENTRY]),
    commentsExtended: dec(files[DOCX_COMMENTS_EXTENDED_ENTRY]),
    graphics,
    coreProps: dec(files[DOC_CORE_PROPS_ENTRY]),
    appProps: dec(files[DOC_APP_PROPS_ENTRY]),
    customProps: dec(files[DOC_CUSTOM_PROPS_ENTRY])
  }
}

/* --------------------- 图形内容轴：图表 / SmartArt / 透视表 --------------------- */

/**
 * 取 XML 里所有指定**本地名**的元素（忽略命名空间前缀）。
 *
 * 与 xmlChildElements 的区别：不限深度，本地名匹配就收；自闭合标签记空体，
 * 同名嵌套按栈配对（不会在内层提前收尾）。
 * prefixes 给定时只收这些前缀的标签（'' = 无前缀），用于区分同名不同前缀的元素。
 */
function xmlElements(xml: string, local: string, prefixes?: string[]): XmlElement[] {
  const out: XmlElement[] = []
  const tokenRe = new RegExp(`<(/?)(?:([\\w.-]+):)?${local}\\b(?:\\s[^>]*?)?(/?)>`, 'g')
  const stack: string[] = []
  let curOpen = ''
  let curStart = 0
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(xml)) !== null) {
    const prefix = m[2] ?? ''
    if (prefixes && !prefixes.includes(prefix)) continue
    if (m[1] === '/') {
      if (stack.length === 0) continue
      stack.pop()
      if (stack.length === 0) out.push({ tag: local, open: curOpen, body: xml.slice(curStart, m.index) })
      continue
    }
    if (m[3] === '/') {
      out.push({ tag: local, open: m[0], body: '' })
      continue
    }
    if (stack.length === 0) {
      curOpen = m[0]
      curStart = m.index + m[0].length
    }
    stack.push(local)
  }
  return out
}

/** 片段里所有文本节点（DrawingML 的 <a:t>）拼起来 */
function joinXmlTexts(fragment: string): string {
  const parts: string[] = []
  for (const el of xmlElements(fragment, 't', ['a', ''])) {
    parts.push(decodeXmlEntities(el.body))
  }
  return parts.join('')
}

/** 元素列表里第一个非空文本 */
function firstXmlText(els: XmlElement[]): string {
  for (const el of els) {
    const text = decodeXmlEntities(el.body).trim()
    if (text) return text
  }
  return ''
}

/** 图表信息：标题 + 系列名 */
interface ChartInfo {
  title: string
  series: string[]
}

/**
 * 图表部件（c:chartSpace）→ 标题 + 系列名。
 *
 * 标题取**图表级**的 c:title（在 c:plotArea 之前）；坐标轴标题在 c:plotArea 里，不算图表标题。
 * 标题两种写法都认：c:tx/c:rich 的富文本，或 c:tx/c:strRef 的缓存值。
 * 系列名取 c:ser/c:tx：c:strRef 缓存值或字面量 c:v。
 *
 * resolveFormula 是兜底：strRef 没写缓存值时（openpyxl 就不写 strCache），
 * 按 c:f 里的单元格公式回查原表。DOCX/PPTX 的图表没有单元格上下文，不传。
 */
function parseChartInfo(xml: string, resolveFormula?: (formula: string) => string): ChartInfo {
  if (!xml) return { title: '', series: [] }
  const chartEl = xmlElements(xml, 'chart')[0]
  const body = chartEl ? chartEl.body : xml
  const plotIdx = /<(?:[\w.-]+:)?plotArea\b/.exec(body)?.index ?? -1
  const head = plotIdx >= 0 ? body.slice(0, plotIdx) : body
  // strRef 取值：先读缓存值（c:strCache 里的 c:v），没有再按 c:f 公式回查
  const strRefText = (refBody: string): string => {
    const cached = firstXmlText(xmlElements(refBody, 'v'))
    if (cached) return cached
    if (!resolveFormula) return ''
    const formula = firstXmlText(xmlElements(refBody, 'f'))
    return formula ? resolveFormula(formula).trim() : ''
  }
  let title = ''
  for (const t of xmlElements(head, 'title')) {
    const rich = xmlElements(t.body, 'rich')[0]
    if (rich) {
      const text = joinXmlTexts(rich.body).trim()
      if (text) {
        title = text
        break
      }
    }
    const ref = xmlElements(t.body, 'strRef')[0]
    if (ref) {
      const text = strRefText(ref.body)
      if (text) {
        title = text
        break
      }
    }
  }
  const series: string[] = []
  for (const ser of xmlElements(body, 'ser')) {
    const tx = xmlElements(ser.body, 'tx')[0]
    if (!tx) continue
    const ref = xmlElements(tx.body, 'strRef')[0]
    let name = ref ? strRefText(ref.body) : ''
    if (!name) name = firstXmlText(xmlElements(tx.body, 'v'))
    if (name) series.push(name)
  }
  return { title, series }
}

/** 图表部件 → `[图表: 标题 · 系列1, 系列2]`（标题与系列都空则不出标记） */
function chartMarker(xml: string, resolveFormula?: (formula: string) => string): string {
  const info = parseChartInfo(xml, resolveFormula)
  const bits: string[] = []
  if (info.title) bits.push(info.title)
  if (info.series.length > 0) bits.push(info.series.join(', '))
  return bits.length > 0 ? `[图表: ${bits.join(' · ')}]` : ''
}

/**
 * 图表里的单元格公式（`'数据'!B1` / `Sheet1!$B$1`）→ 工作表名 + 单元格引用。
 * 只认「表名!单元格」这种单格引用；区间、跨表数组等一律不解析。
 */
function parseChartFormula(formula: string): { sheet: string; ref: string } | null {
  const t = formula.trim()
  const quoted = /^'((?:[^']|'')+)'!\$?([A-Z]+)\$?(\d+)$/.exec(t)
  if (quoted) return { sheet: quoted[1].replace(/''/g, "'"), ref: `${quoted[2]}${quoted[3]}` }
  const plain = /^([^!]+)!\$?([A-Z]+)\$?(\d+)$/.exec(t)
  if (plain) return { sheet: plain[1].trim(), ref: `${plain[2]}${plain[3]}` }
  return null
}

/**
 * SmartArt 数据部件（dgm:dataModel）→ `[SmartArt: 节点1, 节点2]`。
 * 文本在 dgm:pt 里的 a:t；type="doc" 的根节点不算内容。
 */
function smartArtMarker(xml: string): string {
  if (!xml) return ''
  const texts: string[] = []
  const seen = new Set<string>()
  for (const pt of xmlElements(xml, 'pt')) {
    if (/\btype="doc"/.test(pt.open)) continue
    const text = joinXmlTexts(pt.body).trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    texts.push(text)
  }
  return texts.length > 0 ? `[SmartArt: ${texts.join(', ')}]` : ''
}

/** 数据透视表部件（pivotTableDefinition）→ `[透视表: 名称 · 字段: …]` */
function pivotTableMarker(xml: string): string {
  if (!xml) return ''
  const def = /<(?:[\w.-]+:)?pivotTableDefinition\b([^>]*)>/.exec(xml)
  if (!def) return ''
  const name = decodeXmlEntities(/\bname="([^"]*)"/.exec(def[1] ?? '')?.[1] ?? '').trim()
  const fields: string[] = []
  for (const f of xmlElements(xml, 'pivotField')) {
    const field = decodeXmlEntities(/\bname="([^"]*)"/.exec(f.open)?.[1] ?? '').trim()
    if (field && !fields.includes(field)) fields.push(field)
  }
  const head = name || '未命名'
  return fields.length > 0
    ? `[透视表: ${head} · 字段: ${fields.join(', ')}]`
    : `[透视表: ${head}]`
}

/* ------------------------------ PPTX / XLSX 抽取 ------------------------------ */

const PPTX_PRESENTATION_RELS = 'ppt/_rels/presentation.xml.rels'
const PPTX_SLIDE_RE = /^ppt\/slides\/slide\d+\.xml$/
const XLSX_WORKBOOK_RELS = 'xl/_rels/workbook.xml.rels'
const XLSX_SHARED_STRINGS_ENTRY = 'xl/sharedStrings.xml'
const XLSX_STYLES_ENTRY = 'xl/styles.xml'
const XLSX_SHEET_RE = /^xl\/worksheets\/sheet\d+\.xml$/
const XLSX_SHEET_RELS_RE = /^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/
const XLSX_COMMENTS_RE = /^xl\/comments\d+\.xml$/
const XLSX_TABLES_RE = /^xl\/tables\/table\d+\.xml$/
const XLSX_THREADED_COMMENTS_RE = /^xl\/threadedComments\/[^/]+\.xml$/
/** 图表部件（xl/charts/chartN.xml） */
const XLSX_CHART_RE = /^xl\/charts\/chart\d*\.xml$/
/** 绘图部件（xl/drawings/drawingN.xml，工作表里的图表挂在它下面） */
const XLSX_DRAWING_RE = /^xl\/drawings\/drawing\d*\.xml$/
/** 绘图部件自己的 rels（drawing → chart 是第二层关系） */
const XLSX_DRAWING_RELS_RE = /^xl\/drawings\/_rels\/drawing\d*\.xml\.rels$/
/** 数据透视表部件（xl/pivotTables/pivotTableN.xml） */
const XLSX_PIVOT_RE = /^xl\/pivotTables\/pivotTable\d*\.xml$/
const XLSX_PERSONS_ENTRY = 'xl/persons/person.xml'

/** 解码 zip 条目为 UTF-8 文本 */
function decodeEntry(entry: Uint8Array | undefined): string {
  if (!entry) return ''
  return new TextDecoder('utf-8').decode(entry)
}

/** rels 里的一个关系 */
interface RelEntry {
  id: string
  target: string
  /** 关系类型（如 .../hyperlink、.../comments） */
  type: string
}

/**
 * rels 关系表 → 关系清单（Id / Target / Type）。
 * （ppt/presentation.xml 里只有 r:id，真实路径在 rels 里）
 */
function parseRelEntries(xml: string): RelEntry[] {
  const out: RelEntry[] = []
  for (const m of xml.matchAll(/<Relationship\s[^>]*\/>/g)) {
    const id = /\bId="([^"]*)"/.exec(m[0])?.[1]
    const target = /\bTarget="([^"]*)"/.exec(m[0])?.[1]
    if (!id || !target) continue
    out.push({
      id,
      target: decodeXmlEntities(target),
      type: /\bType="([^"]*)"/.exec(m[0])?.[1] ?? ''
    })
  }
  return out
}

/**
 * rels 关系表 → Id → Target。
 * （ppt/presentation.xml 里只有 r:id，真实路径在 rels 里）
 */
function parseRels(xml: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const e of parseRelEntries(xml)) map.set(e.id, e.target)
  return map
}

/** 目标带协议（http: / mailto: 等）就是外部资源，原样保留，不当 zip 内路径解析 */
function isExternalTarget(target: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(target)
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

/* ---------------------- PPTX 结构：表格 / 备注 / 图片 alt ---------------------- */

/**
 * PPTX 里影响「直接子级」判别的容器标签。
 * 注意**不含 p:sld**：它是最外层包装，不跟踪它，扫描时 <p:cSld> 才落在深度 0。
 */
const PPTX_CONTAINER_TAGS =
  'p:cSld|p:spTree|p:sp|p:pic|p:graphicFrame|p:grpSp|p:txBody|a:txBody|a:tbl|a:tr|a:tc|a:p'

/** 幻灯片自己的 rels（用来找 notesSlide） */
const PPTX_SLIDE_RELS_RE = /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/
/** 备注页 */
const PPTX_NOTES_RE = /^ppt\/notesSlides\/notesSlide\d+\.xml$/
/** 批注部件（旧的 ppt/comments/comment1.xml / 新的 ppt/comments/modernComment_*.xml） */
const PPTX_COMMENTS_RE = /^ppt\/comments\/[^/]+\.xml$/
/** 作者表部件（旧的 ppt/commentAuthors.xml / 新的 ppt/authors.xml） */
const PPTX_AUTHORS_RE = /^ppt\/(?:[^/]*[Aa]uthor[^/]*\.xml|[Aa]uthors\/[^/]+\.xml)$/
/** 图表部件（ppt/charts/chartN.xml） */
const PPTX_CHART_RE = /^ppt\/charts\/chart\d*\.xml$/
/** SmartArt 数据部件（ppt/diagrams/dataN.xml） */
const PPTX_DIAGRAM_RE = /^ppt\/diagrams\/data\d*\.xml$/

/** 只是占位的形状类型：页码 / 日期 / 页眉页脚（抽出来是噪音，不是内容） */
const PPTX_SKIP_PLACEHOLDERS = new Set(['sldNum', 'dt', 'hdrFtr', 'ftr'])

/** PPTX 部件：幻灯片 + 每页的 rels + 备注页 + 批注 + 作者表 */
interface PptxParts {
  presentation: string
  presentationRels: string
  slides: Array<{ name: string; xml: string; rels: string }>
  notes: Record<string, string>
  /** 批注部件：zip 内路径 → xml */
  comments: Record<string, string>
  /** 作者表部件：zip 内路径 → xml */
  authors: Record<string, string>
  /** 图形部件（图表 / SmartArt）：zip 内路径 → xml */
  graphics: Record<string, string>
  /** docProps/core.xml 原文 */
  coreProps: string
  /** docProps/app.xml 原文 */
  appProps: string
  /** docProps/custom.xml 原文 */
  customProps: string
}

/** 形状（p:sp）里的文字：每个段落一行（段落里的超链接挂在该行末尾） */
function pptxShapeLines(shapeXml: string, ctx?: PptxRenderCtx): string[] {
  const lines: string[] = []
  for (const body of xmlChildElements(shapeXml, PPTX_CONTAINER_TAGS, ['p:txBody'])) {
    for (const para of xmlChildElements(body.body, PPTX_CONTAINER_TAGS, ['a:p'])) {
      const text = pptxParagraphText(para.body).trim()
      if (!text) continue
      const marks = ctx ? pptxLinkMarks(para.body, ctx.links) : []
      lines.push(marks.length > 0 ? `${text} ${marks.join(' ')}` : text)
    }
  }
  return lines
}

/** 形状的占位符类型（p:ph@type；没有 p:ph 就是普通文本框） */
function pptxPlaceholderType(shapeXml: string): string {
  return /<p:ph\b[^>]*?\btype="([^"]*)"/.exec(shapeXml)?.[1] ?? ''
}

/** 图片替代文字（alt）：p:pic 的 cNvPr@descr；没有 descr 就不出噪音行 */
function pptxPictureAlt(picXml: string): string {
  const nv = /<p:nvPicPr(?:\s[^>]*)?>[\s\S]*?<\/p:nvPicPr>/.exec(picXml)?.[0] ?? picXml
  const descr = /\bdescr="([^"]*)"/.exec(nv)?.[1] ?? ''
  return decodeXmlEntities(descr).trim()
}

/* ---------------------- PPTX 链接 / 批注 ---------------------- */

/** PPTX 一条批注 */
interface PptxComment {
  author: string
  text: string
  /** 归属形状 id（p:cm@idx）；没有就是空串 */
  shapeId: string
  /** 挂在这个批注下的回复（多级已摊平到根） */
  replies: PptxComment[]
}

/** 一页幻灯片的渲染上下文 */
interface PptxRenderCtx {
  /** rId → 外部链接 URL（内部跳转不进这里） */
  links: Map<string, string>
  /** 形状 id → 该形状上的批注 */
  comments: Map<string, PptxComment[]>
  /** 已经挂到形状上的形状 id（剩下的 = 找不到归属） */
  used: Set<string>
  /** 没有归属形状 id 的批注 → 该页末尾 */
  loose: PptxComment[]
  /** r:id → 图表 / SmartArt 标记 */
  graphics: Map<string, string>
}

/** slide rels 里的外部超链接：rId → URL（内部跳转 / 内部部件不进） */
function pptxLinkTargets(relsXml: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const e of parseRelEntries(relsXml)) {
    if (!e.type.endsWith('/hyperlink')) continue
    if (!isExternalTarget(e.target)) continue
    map.set(e.id, e.target)
  }
  return map
}

/** xml 里的超链接标记（按出现顺序；r:id 查不到就跳过） */
function pptxLinkMarks(xml: string, links: Map<string, string>): string[] {
  const out: string[] = []
  for (const m of xml.matchAll(/<a:hlinkClick\b([^>]*?)\/?>/g)) {
    const rid = /\br:id="([^"]*)"/.exec(m[1] ?? '')?.[1]
    if (!rid) continue
    const url = links.get(rid)
    if (url) out.push(`[链接: ${url}]`)
  }
  return out
}

/** 形状自己的 id（p:cNvPr@id）：批注靠它找归属 */
function pptxShapeId(shapeXml: string): string {
  return /<p:cNvPr\b[^>]*?\bid="([^"]*)"/.exec(shapeXml)?.[1] ?? ''
}

/**
 * 形状级链接标记（p:cNvPr 里的 a:hlinkClick —— 整个形状可点）。
 * 靠「属性段是否以 / 结尾」区分自闭合标签（与 DOCX 修订同一套路）。
 */
function pptxShapeLinkMarks(shapeXml: string, links: Map<string, string>): string[] {
  const cnv = /<p:cNvPr\b([^>]*?)(\/>|>([\s\S]*?)<\/p:cNvPr>)/.exec(shapeXml)
  if (!cnv) return []
  return pptxLinkMarks(cnv[3] ?? '', links)
}

/** 批注正文：旧格式 p:text；新格式 p188:txBody 里的 a:t */
function pptxCommentText(body: string): string {
  const direct = /<(?:\w+:)?text\b[^>]*>([\s\S]*?)<\/(?:\w+:)?text>/.exec(body)
  if (direct) return decodeXmlEntities(direct[1]).trim()
  const parts: string[] = []
  for (const m of body.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)) {
    parts.push(decodeXmlEntities(m[1]))
  }
  return parts.join('').trim()
}

/**
 * 批注部件 → 批注清单（旧的 p:cm / 新的 p188:cm 都认）。
 *
 * 回复两种写法都认：
 * - 注解版（2018/annotation）：回复是独立的 p188:cm，用 paraIdParent 指回父批注；
 * - 规范版（2018/8/main）：回复是 p188:replyLst 里的 p188:reply。
 * 多级回复摊平挂到根批注；父批注找不到就按独立批注输出（不猜）。
 */
function parsePptxComments(xml: string, authors: Map<string, string>): PptxComment[] {
  const out: PptxComment[] = []
  if (!xml) return out
  interface Node {
    comment: PptxComment
    paraId: string
    parentParaId: string
  }
  const nodes: Node[] = []
  const byParaId = new Map<string, Node>()
  for (const m of xml.matchAll(/<((?:\w+:)?)cm\b([^>]*?)(\/>|>([\s\S]*?)<\/\1cm>)/g)) {
    const attrs = m[2] ?? ''
    const body = m[4] ?? ''
    if (!body) continue
    const authorId = /\bauthorId="([^"]*)"/.exec(attrs)?.[1] ?? ''
    const shapeId = /\bidx="([^"]*)"/.exec(attrs)?.[1] ?? ''
    const paraId = /\bparaId="([^"]*)"/.exec(attrs)?.[1] ?? ''
    const parentParaId = /\bparaIdParent="([^"]*)"/.exec(attrs)?.[1] ?? ''
    // 回复体（p188:replyLst 里的 p188:reply）单独摘出来，根批注正文不含它们
    const replies: PptxComment[] = []
    for (const rm of body.matchAll(/<((?:\w+:)?)reply\b([^>]*?)(\/>|>([\s\S]*?)<\/\1reply>)/g)) {
      const rBody = rm[4] ?? ''
      if (!rBody) continue
      const rAuthorId = /\bauthorId="([^"]*)"/.exec(rm[2] ?? '')?.[1] ?? ''
      const rText = pptxCommentText(rBody)
      if (!rText) continue
      replies.push({ author: authors.get(rAuthorId) ?? '', text: rText, shapeId: '', replies: [] })
    }
    const ownBody = body.replace(/<((?:\w+:)?)replyLst\b[^>]*>[\s\S]*?<\/\1replyLst>/g, '')
    const text = pptxCommentText(ownBody)
    if (!text && replies.length === 0) continue
    const comment: PptxComment = { author: authors.get(authorId) ?? '', text, shapeId, replies }
    const node: Node = { comment, paraId, parentParaId }
    nodes.push(node)
    if (paraId) byParaId.set(paraId, node)
  }
  // 沿 paraIdParent 上溯到根批注（多级摊平；成环时停在当前节点）
  const rootOf = (node: Node): Node => {
    let cur = node
    const seen = new Set<Node>([cur])
    while (cur.parentParaId && byParaId.has(cur.parentParaId)) {
      const parent = byParaId.get(cur.parentParaId) as Node
      if (seen.has(parent)) break
      seen.add(parent)
      cur = parent
    }
    return cur
  }
  for (const node of nodes) {
    if (!node.parentParaId || !byParaId.has(node.parentParaId)) continue
    const root = rootOf(node)
    if (root === node) continue
    root.comment.replies.push(node.comment)
  }
  return nodes
    .filter((n) => !n.parentParaId || !byParaId.has(n.parentParaId))
    .map((n) => n.comment)
}

/** 批注（含回复）→ 输出标记：根批注 `[批注(作者): …]`，回复 `[回复(作者): …]` */
function pptxCommentMarks(c: PptxComment): string[] {
  const out: string[] = []
  if (c.text) out.push(`[批注(${c.author}): ${c.text}]`)
  for (const r of c.replies) out.push(`[回复(${r.author}): ${r.text}]`)
  return out
}

/** 作者表：commentAuthors.xml / authors.xml → authorId → 姓名 */
function parsePptxAuthors(xml: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!xml) return map
  for (const m of xml.matchAll(/<(?:\w+:)?(?:cm)?[Aa]uthor\b([^>]*?)\/?>/g)) {
    const id = /\bid="([^"]*)"/.exec(m[1] ?? '')?.[1]
    const name = /\bname="([^"]*)"/.exec(m[1] ?? '')?.[1]
    if (id && name) map.set(id, decodeXmlEntities(name))
  }
  return map
}

/** 表格单元格文本：多段用空格连接（沿用 DOCX 口径） */
function pptxCellText(cellXml: string): string {
  const parts: string[] = []
  for (const body of xmlChildElements(cellXml, PPTX_CONTAINER_TAGS, ['a:txBody'])) {
    for (const para of xmlChildElements(body.body, PPTX_CONTAINER_TAGS, ['a:p'])) {
      const text = pptxParagraphText(para.body).trim()
      if (text) parts.push(text)
    }
  }
  return parts.join(' ')
}

/** 单元格横向跨几列（DrawingML 的 gridSpan 是 a:tc 自己的属性） */
function pptxCellGridSpan(cell: XmlElement): number {
  const raw = Number(/\bgridSpan="(\d+)"/.exec(cell.open)?.[1] ?? 1)
  if (!Number.isFinite(raw) || raw < 1) return 1
  return Math.min(Math.floor(raw), MAX_GRID_SPAN)
}

/**
 * PPTX 表格 → Markdown 管道表（首行作表头，缺的列补空）
 *
 * 合并单元格口径与 DOCX 一致：
 * - 横向 `gridSpan="N"`：内容只放首格，其余 N-1 格补空，后续列位因此与其它行对齐；
 * - 纵向 `rowSpan` / `hMerge` / `vMerge`：内容留在起始格，续格本身没有内容 → 输出空格。
 */
function pptxTableMarkdown(frameXml: string): string {
  const tbl = xmlChildElements(frameXml, PPTX_CONTAINER_TAGS, ['a:tbl'])[0]
  if (!tbl) return ''
  const rows: string[][] = []
  for (const tr of xmlChildElements(tbl.body, PPTX_CONTAINER_TAGS, ['a:tr'])) {
    const cells: string[] = []
    for (const tc of xmlChildElements(tr.body, PPTX_CONTAINER_TAGS, ['a:tc'])) {
      const span = pptxCellGridSpan(tc)
      cells.push(markdownCell(pptxCellText(tc.body)))
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

/** 取 spTree 的内容（幻灯片 / 备注页 / 组合形状都有一层 spTree） */
function pptxSpTreeBody(xml: string): string {
  const cSld = xmlChildElements(xml, PPTX_CONTAINER_TAGS, ['p:cSld'])[0]
  const tree = cSld ? xmlChildElements(cSld.body, PPTX_CONTAINER_TAGS, ['p:spTree'])[0] : undefined
  return tree?.body ?? ''
}

/** 演讲者备注：优先 body 占位符；页码 / 日期 / 页眉页脚占位符跳过 */
function pptxNotesText(notesXml: string): string {
  if (!notesXml) return ''
  const bodyLines: string[] = []
  const otherLines: string[] = []
  for (const sp of xmlChildElements(pptxSpTreeBody(notesXml), PPTX_CONTAINER_TAGS, ['p:sp'])) {
    const type = pptxPlaceholderType(sp.body)
    if (PPTX_SKIP_PLACEHOLDERS.has(type)) continue
    const lines = pptxShapeLines(sp.body)
    if (lines.length === 0) continue
    if (type === 'body') bodyLines.push(...lines)
    else otherLines.push(...lines)
  }
  return (bodyLines.length > 0 ? bodyLines : otherLines).join(' ')
}

/**
 * 一页 spTree 里的内容块：形状文字 / 表格 / 图片 alt，按形状在页面里的先后顺序。
 * 形状级链接与该形状的批注挂在它的首个块末尾（表格不挂，会破坏 Markdown 表）。
 */
function pptxTreeBlocks(treeXml: string, ctx: PptxRenderCtx): string[] {
  const blocks: string[] = []
  for (const child of xmlChildElements(treeXml, PPTX_CONTAINER_TAGS, [
    'p:sp',
    'p:pic',
    'p:graphicFrame',
    'p:grpSp'
  ])) {
    const start = blocks.length
    if (child.tag === 'p:sp') {
      if (PPTX_SKIP_PLACEHOLDERS.has(pptxPlaceholderType(child.body))) continue
      blocks.push(...pptxShapeLines(child.body, ctx))
    } else if (child.tag === 'p:grpSp') {
      const tree = xmlChildElements(child.body, PPTX_CONTAINER_TAGS, ['p:spTree'])[0]
      if (tree) blocks.push(...pptxTreeBlocks(tree.body, ctx))
    } else if (child.tag === 'p:graphicFrame') {
      const table = pptxTableMarkdown(child.body)
      if (table) blocks.push(table)
      blocks.push(...graphicRefMarks(child.body, ctx.graphics))
    } else {
      const alt = pptxPictureAlt(child.body)
      if (alt) blocks.push(`[图片: ${alt}]`)
    }
    if (child.tag === 'p:graphicFrame') continue
    const marks = pptxShapeLinkMarks(child.body, ctx.links)
    const id = pptxShapeId(child.body)
    if (id) {
      const cs = ctx.comments.get(id)
      if (cs) {
        ctx.used.add(id)
        for (const c of cs) marks.push(...pptxCommentMarks(c))
      }
    }
    if (marks.length > 0 && blocks.length > start) {
      blocks[start] = `${blocks[start]} ${marks.join(' ')}`
    }
  }
  return blocks
}

/** 一页（slideN.xml）里的内容块 */
function pptxSlideBlocks(slideXml: string, ctx: PptxRenderCtx): string[] {
  return pptxTreeBlocks(pptxSpTreeBody(slideXml), ctx)
}

/** rels 里按关系类型找目标路径（Type 以 typeSuffix 结尾） */
function relTargetByType(relsXml: string, typeSuffix: string, baseDir: string): string {
  for (const m of relsXml.matchAll(/<Relationship\s[^>]*\/>/g)) {
    const type = /\bType="([^"]*)"/.exec(m[0])?.[1] ?? ''
    if (!type.endsWith(typeSuffix)) continue
    const target = /\bTarget="([^"]*)"/.exec(m[0])?.[1]
    if (target) return resolveRelTarget(baseDir, target)
  }
  return ''
}

/** rels 里按关系类型找全部目标路径（Type 以 typeSuffix 结尾） */
function relTargetsByType(relsXml: string, typeSuffix: string, baseDir: string): string[] {
  const out: string[] = []
  for (const m of relsXml.matchAll(/<Relationship\s[^>]*\/>/g)) {
    const type = /\bType="([^"]*)"/.exec(m[0])?.[1] ?? ''
    if (!type.endsWith(typeSuffix)) continue
    const target = /\bTarget="([^"]*)"/.exec(m[0])?.[1]
    if (target) out.push(resolveRelTarget(baseDir, target))
  }
  return out
}

/** slideN.xml 的序号（用于兜底排序） */
function slideNo(name: string): number {
  return Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0)
}

/** 解出 PPTX 要用的部件（幻灯片 + 幻灯片 rels + 备注页） */
function readPptxParts(filePath: string): PptxParts {
  const files = readZipEntries(
    filePath,
    (n) =>
      n === PPTX_PRESENTATION_ENTRY ||
      n === PPTX_PRESENTATION_RELS ||
      PPTX_SLIDE_RE.test(n) ||
      PPTX_SLIDE_RELS_RE.test(n) ||
      PPTX_NOTES_RE.test(n) ||
      PPTX_COMMENTS_RE.test(n) ||
      PPTX_AUTHORS_RE.test(n) ||
      PPTX_CHART_RE.test(n) ||
      PPTX_DIAGRAM_RE.test(n) ||
      n === DOC_CORE_PROPS_ENTRY || n === DOC_APP_PROPS_ENTRY || n === DOC_CUSTOM_PROPS_ENTRY
  )
  const dec = (u: Uint8Array | undefined): string =>
    u ? new TextDecoder('utf-8').decode(u) : ''
  const names = Object.keys(files)
  const slideNames = names.filter((n) => PPTX_SLIDE_RE.test(n))
  if (slideNames.length === 0) throw new Error('没有找到幻灯片（ppt/slides/*.xml）')
  const notes: Record<string, string> = {}
  for (const n of names.filter((n) => PPTX_NOTES_RE.test(n))) notes[n] = dec(files[n])
  const comments: Record<string, string> = {}
  for (const n of names.filter((n) => PPTX_COMMENTS_RE.test(n))) comments[n] = dec(files[n])
  const authors: Record<string, string> = {}
  for (const n of names.filter((n) => PPTX_AUTHORS_RE.test(n))) authors[n] = dec(files[n])
  const graphics: Record<string, string> = {}
  for (const n of names.filter((n) => PPTX_CHART_RE.test(n) || PPTX_DIAGRAM_RE.test(n))) {
    graphics[n] = dec(files[n])
  }
  const slides = slideNames
    .sort((a, b) => slideNo(a) - slideNo(b))
    .map((name) => ({
      name,
      xml: dec(files[name]),
      rels: dec(files[`ppt/slides/_rels/${path.basename(name)}.rels`])
    }))
  return {
    presentation: dec(files[PPTX_PRESENTATION_ENTRY]),
    presentationRels: dec(files[PPTX_PRESENTATION_RELS]),
    slides,
    notes,
    comments,
    authors,
    graphics,
    coreProps: dec(files[DOC_CORE_PROPS_ENTRY]),
    appProps: dec(files[DOC_APP_PROPS_ENTRY]),
    customProps: dec(files[DOC_CUSTOM_PROPS_ENTRY])
  }
}

/**
 * 放映顺序：优先按 `ppt/presentation.xml` 的 sldIdLst（那是真实放映顺序），
 * 读不到再退回按 slideN.xml 的编号排。
 */
function pptxSlideOrder(parts: PptxParts): PptxParts['slides'] {
  const byName = new Map(parts.slides.map((s) => [s.name, s]))
  if (parts.presentation && parts.presentationRels) {
    const rels = parseRels(parts.presentationRels)
    const ids: string[] = []
    for (const m of parts.presentation.matchAll(/<p:sldId\s[^>]*\/>/g)) {
      const rid = /\br:id="([^"]*)"/.exec(m[0])?.[1]
      if (rid) ids.push(rid)
    }
    const targets = ids
      .map((id) => rels.get(id))
      .filter((t): t is string => !!t)
      .map((t) => resolveRelTarget('ppt', t))
    if (targets.length > 0 && targets.every((t) => byName.has(t))) {
      return targets.map((t) => byName.get(t) as PptxParts['slides'][number])
    }
  }
  return parts.slides
}

/** 一页幻灯片的渲染上下文：外部链接 + 批注（按形状 id 分组） */
function pptxRenderCtx(parts: PptxParts, slide: PptxParts['slides'][number]): PptxRenderCtx {
  const authors = new Map<string, string>()
  Object.keys(parts.authors).forEach((p) => {
    parsePptxAuthors(parts.authors[p]).forEach((name, id) => authors.set(id, name))
  })
  const comments = new Map<string, PptxComment[]>()
  const loose: PptxComment[] = []
  relTargetsByType(slide.rels, '/comments', 'ppt/slides').forEach((p) => {
    parsePptxComments(parts.comments[p] ?? '', authors).forEach((c) => {
      if (!c.shapeId) {
        loose.push(c)
        return
      }
      const arr = comments.get(c.shapeId) ?? []
      arr.push(c)
      comments.set(c.shapeId, arr)
    })
  })
  return {
    links: pptxLinkTargets(slide.rels),
    comments,
    used: new Set<string>(),
    loose,
    graphics: pptxGraphicMarkMap(slide.rels, parts.graphics)
  }
}

/** 幻灯片 rels → 关系 id → 图表 / SmartArt 标记 */
function pptxGraphicMarkMap(relsXml: string, graphics: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>()
  for (const e of parseRelEntries(relsXml)) {
    if (isExternalTarget(e.target)) continue
    const xml = graphics[resolveRelTarget('ppt/slides', e.target)]
    if (!xml) continue
    if (e.type.endsWith('/chart')) {
      const mark = chartMarker(xml)
      if (mark) map.set(e.id, mark)
    } else if (e.type.endsWith('/diagramData')) {
      const mark = smartArtMarker(xml)
      if (mark) map.set(e.id, mark)
    }
  }
  return map
}

/**
 * PPTX → 文本。
 * 一页一个块：`[幻灯片 N]` + 形状文字 + 表格（Markdown 管道表）+ 图片 alt，
 * 行尾带超链接 `[链接: …]` 与批注 `[批注(作者): …]`，
 * 末尾挂这一页的演讲者备注 `[备注] …`。
 */
export function extractPptxText(filePath: string): string {
  const parts = readPptxParts(filePath)
  const meta = docPropsLines(parts.coreProps, parts.appProps, parts.customProps).join('\n')
  const blocks: string[] = []
  pptxSlideOrder(parts).forEach((slide, i) => {
    const ctx = pptxRenderCtx(parts, slide)
    const lines = [`[幻灯片 ${i + 1}]`, ...pptxSlideBlocks(slide.xml, ctx)]
    // 挂不到形状上的批注 → 该页末尾（备注仍在最后）
    const orphans: PptxComment[] = ctx.loose.slice()
    ctx.comments.forEach((cs, id) => {
      if (!ctx.used.has(id)) orphans.push(...cs)
    })
    for (const c of orphans) lines.push(...pptxCommentMarks(c))
    const notesPath = relTargetByType(slide.rels, '/notesSlide', 'ppt/slides')
    const notes = pptxNotesText(notesPath ? (parts.notes[notesPath] ?? '') : '')
    if (notes) lines.push(`[备注] ${notes}`)
    blocks.push(lines.join('\n'))
  })
  const body = normalizeText(blocks.join('\n\n'))
  return meta ? `${meta}\n${body}` : body
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

/** 列号（0 起）→ 字母（0 → A，26 → AA） */
function colLetters(col: number): string {
  let n = col + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
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
  /** 规则在清单里的稳定序号（区间级命中集合按它索引） */
  id: number
  ranges: XlsxCellRange[]
  type: string
  operator: string
  text: string
  formulas: string[]
  dxfId: number
  stopIfTrue: boolean
  priority: number
  /** top10：取前/后 N 项；`percent` 为真时 N 是百分比 */
  rank: number
  percent: boolean
  bottom: boolean
  /** aboveAverage：默认「高于均值」；`aboveAverage=false` 即低于均值 */
  aboveAverage: boolean
  /** aboveAverage：是否把「恰好等于均值」也算命中 */
  equalAverage: boolean
  /** aboveAverage：是否改成「偏离均值超过 1 个标准差」 */
  stdDev: boolean
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

/** 工作表里的 `<conditionalFormatting>` → 规则清单（只收带 dxfId 的；图形类规则 colorScale/dataBar/iconSet 与表达式仍不处理） */
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
        id: out.length,
        ranges,
        type: /\btype="([^"]*)"/.exec(attrs)?.[1] ?? '',
        operator: /\boperator="([^"]*)"/.exec(attrs)?.[1] ?? '',
        text: decodeXmlEntities(/\btext="([^"]*)"/.exec(attrs)?.[1] ?? ''),
        formulas,
        dxfId,
        stopIfTrue: /\bstopIfTrue="(?:1|true)"/i.test(attrs),
        priority: Number(/\bpriority="(\d+)"/.exec(attrs)?.[1] ?? '0'),
        rank: Number(/\brank="(\d+)"/.exec(attrs)?.[1] ?? '10'),
        percent: /\bpercent="(?:1|true)"/i.test(attrs),
        bottom: /\bbottom="(?:1|true)"/i.test(attrs),
        aboveAverage: !/\baboveAverage="(?:0|false)"/i.test(attrs),
        equalAverage: /\bequalAverage="(?:1|true)"/i.test(attrs),
        stdDev: /\bstdDev="(?:1|true)"/i.test(attrs)
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

/** 逐格判定的规则类型（确定性强的）；区间级类型走 rangeLevelCfMatches，图形类与表达式一律跳过（fail-safe） */
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

/* --------------------- 区间级条件格式（top10 / aboveAverage / 重复值） --------------------- */

/**
 * 区间级规则：判定要看整段范围的数据（排名 / 均值 / 出现次数），不能只靠当前格子的值。
 * 这几类规则之前被静默丢弃（`matchCfRule` 只处理逐格判定的类型）。
 */
const RANGE_LEVEL_CF_TYPES = new Set(['top10', 'aboveAverage', 'duplicateValues', 'uniqueValues'])

function isRangeLevelCf(type: string): boolean {
  return RANGE_LEVEL_CF_TYPES.has(type)
}

/** 单元格坐标键（区间命中集合用） */
function cfCellKey(row: number, col: number): string {
  return `${row}:${col}`
}

/** 重复值比较键：数值与文本不同类；文本大小写不敏感（与 Excel 一致） */
function dupKey(cell: { value: string; num: number | null }): string {
  return cell.num !== null ? `n:${cell.num}` : `t:${cell.value.toLowerCase()}`
}

/** 样本标准差（n−1；Excel 的 stdDev 选项用的就是样本标准差） */
function sampleStdDev(nums: number[]): number {
  if (nums.length < 2) return 0
  const avg = nums.reduce((s, n) => s + n, 0) / nums.length
  const variance = nums.reduce((s, n) => s + (n - avg) ** 2, 0) / (nums.length - 1)
  return Math.sqrt(variance)
}

/** 某个单元格在「本段范围」里是否命中这条区间级规则 */
function matchRangeLevelCf(
  rule: XlsxCfRule,
  inRange: Array<{ value: string; num: number | null }>,
  cell: { value: string; num: number | null }
): boolean {
  switch (rule.type) {
    case 'top10': {
      const nums = inRange.map((c) => c.num).filter((n): n is number => n !== null)
      if (nums.length === 0 || cell.num === null) return false
      // `percent` 时 rank 表示百分比，取名次 = ceil(个数 × 百分比)
      const k = rule.percent
        ? Math.max(1, Math.ceil((nums.length * rule.rank) / 100))
        : Math.min(rule.rank, nums.length)
      if (k < 1) return false
      const sorted = [...nums].sort((a, b) => (rule.bottom ? a - b : b - a))
      const threshold = sorted[k - 1]
      // 并列取「≥ 阈值」（bottom 取「≤ 阈值」）
      return rule.bottom ? cell.num <= threshold : cell.num >= threshold
    }
    case 'aboveAverage': {
      const nums = inRange.map((c) => c.num).filter((n): n is number => n !== null)
      if (nums.length === 0 || cell.num === null) return false
      const avg = nums.reduce((s, n) => s + n, 0) / nums.length
      const eps = 1e-9
      if (rule.stdDev) {
        const bound = rule.aboveAverage ? avg + sampleStdDev(nums) : avg - sampleStdDev(nums)
        return rule.aboveAverage ? cell.num > bound + eps : cell.num < bound - eps
      }
      if (rule.aboveAverage) {
        return cell.num > avg + eps || (rule.equalAverage && Math.abs(cell.num - avg) <= eps)
      }
      return cell.num < avg - eps || (rule.equalAverage && Math.abs(cell.num - avg) <= eps)
    }
    case 'duplicateValues':
    case 'uniqueValues': {
      if (cell.value === '') return false
      const key = dupKey(cell)
      let count = 0
      for (const c of inRange) {
        if (c.value !== '' && dupKey(c) === key) count++
      }
      return rule.type === 'duplicateValues' ? count >= 2 : count === 1
    }
    default:
      return false
  }
}

/**
 * 为每条区间级规则算出「命中哪些格子」。
 * 聚合范围 = 该规则 sqref 的每一段（多段时**各段独立**排名 —— Excel 对多区域选择的语义有歧义，
 * 单区域是绝大多数情况，两者等价）。
 */
function rangeLevelCfMatches(
  rules: XlsxCfRule[],
  cells: Array<{ row: number; col: number; value: string; num: number | null }>
): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>()
  for (const rule of rules) {
    if (!isRangeLevelCf(rule.type)) continue
    const hits = new Set<string>()
    for (const range of rule.ranges) {
      const inRange = cells.filter(
        (c) => c.row >= range.r1 && c.row <= range.r2 && c.col >= range.c1 && c.col <= range.c2
      )
      for (const c of inRange) {
        if (matchRangeLevelCf(rule, inRange, c)) hits.add(cfCellKey(c.row, c.col))
      }
    }
    out.set(rule.id, hits)
  }
  return out
}

/** 命中规则 → 字体色 / 底色（按 priority 升序；stopIfTrue 截断） */
function conditionalColors(
  rules: XlsxCfRule[],
  styles: XlsxStyles,
  row: number,
  col: number,
  text: string,
  num: number | null,
  rangeMatches: Map<number, Set<string>>
): { font: string | null; fill: string | null } {
  let font: string | null = null
  let fill: string | null = null
  const ordered = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.ranges.some((r) => row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2))
    .sort((x, y) => x.rule.priority - y.rule.priority || x.index - y.index)
  for (const { rule } of ordered) {
    // 区间级规则查预先算好的命中集合；逐格规则照旧按当前格子的值判定
    const hit = isRangeLevelCf(rule.type)
      ? (rangeMatches.get(rule.id)?.has(cfCellKey(row, col)) ?? false)
      : matchCfRule(rule, text, num)
    if (!hit) continue
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

type DateTokenType = 'y' | 'm' | 'd' | 'h' | 's' | 'ampm' | 'ap' | 'eh' | 'em' | 'es' | 'literal' | 'locale'

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
      // `[$-804]` = locale 前缀（zh-CN）；只记 locale，不产生任何字面量
      const locale = /^\$-([0-9A-Fa-f]+)$/.exec(inner)
      if (locale) {
        tokens.push({ type: 'locale', text: locale[1], count: 0 })
      } else {
        const elapsed = /^([hms])\1*$/i.exec(inner)
        if (elapsed) {
          const unit = elapsed[1].toLowerCase()
          tokens.push({ type: unit === 'h' ? 'eh' : unit === 'm' ? 'em' : 'es', text: inner, count: inner.length })
        } else {
          const currency = /^\$([^\]-]*)/.exec(inner)?.[1]
          if (currency) tokens.push({ type: 'literal', text: currency, count: 0 })
        }
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

/** 中文月/星期名（只在格式码写了 zh locale 前缀时启用，见 §5.37 / §5.38） */
const MONTH_ZH = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']
const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六']

/** 日语：Excel 的月份就是「3月」这种数字 + 月，没有字母缩写 */
const MONTH_JA = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
const WEEK_JA_LONG = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日']
const WEEK_JA_SHORT = ['日', '月', '火', '水', '木', '金', '土']

/** 德语 */
const MONTH_DE_LONG = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
]
const MONTH_DE_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const WEEK_DE_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const WEEK_DE_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

/** 法语 */
const MONTH_FR_LONG = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
]
const MONTH_FR_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const WEEK_FR_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const WEEK_FR_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']

type LocaleLang = 'zh' | 'zhTW' | 'ja' | 'de' | 'fr' | 'en'

interface LocaleNames {
  /** 月名风格：latin = mmm→缩写 / mmmm→全名 / mmmmm→首字母；zh =「三月」型；cjkNum =「3月」型 */
  monthStyle: 'latin' | 'zh' | 'cjkNum'
  /** 星期名风格：latin = ddd→缩写 / dddd→全名；zh =「周三」/「星期三」型 */
  weekStyle: 'latin' | 'zh'
  monthShort: string[]
  monthLong: string[]
  weekShort: string[]
  weekLong: string[]
  am: string
  pm: string
}

const LOCALE_NAMES: Record<LocaleLang, LocaleNames> = {
  en: {
    monthStyle: 'latin',
    weekStyle: 'latin',
    monthShort: MONTH_SHORT,
    monthLong: MONTH_LONG,
    weekShort: WEEK_SHORT,
    weekLong: WEEK_LONG,
    am: 'AM',
    pm: 'PM'
  },
  zh: {
    monthStyle: 'zh',
    weekStyle: 'zh',
    monthShort: MONTH_ZH,
    monthLong: MONTH_ZH,
    weekShort: WEEK_ZH,
    weekLong: WEEK_ZH,
    am: '上午',
    pm: '下午'
  },
  // 繁体中文的月/星期/上下午写法与简体一致，只是前缀不同
  zhTW: {
    monthStyle: 'zh',
    weekStyle: 'zh',
    monthShort: MONTH_ZH,
    monthLong: MONTH_ZH,
    weekShort: WEEK_ZH,
    weekLong: WEEK_ZH,
    am: '上午',
    pm: '下午'
  },
  ja: {
    monthStyle: 'cjkNum',
    weekStyle: 'latin',
    monthShort: MONTH_JA,
    monthLong: MONTH_JA,
    weekShort: WEEK_JA_SHORT,
    weekLong: WEEK_JA_LONG,
    am: '午前',
    pm: '午後'
  },
  de: {
    monthStyle: 'latin',
    weekStyle: 'latin',
    monthShort: MONTH_DE_SHORT,
    monthLong: MONTH_DE_LONG,
    weekShort: WEEK_DE_SHORT,
    weekLong: WEEK_DE_LONG,
    am: 'AM',
    pm: 'PM'
  },
  fr: {
    monthStyle: 'latin',
    weekStyle: 'latin',
    monthShort: MONTH_FR_SHORT,
    monthLong: MONTH_FR_LONG,
    weekShort: WEEK_FR_SHORT,
    weekLong: WEEK_FR_LONG,
    am: 'AM',
    pm: 'PM'
  }
}

/**
 * Excel locale id（LCID 十六进制）→ locale。
 * 认得的：zh-CN 0x804 · zh-TW 0x404 · ja-JP 0x411 · de-DE 0x407 · fr-FR 0x40C · en-US 0x409。
 * 认不出的（以及压根没写 locale 前缀的）一律落英文 —— 保持可复现，不猜。
 */
function localeKind(localeId: string): LocaleLang | null {
  const id = localeId.trim().toLowerCase().replace(/^0+(?=\d)/, '')
  switch (id) {
    case '804':
      return 'zh'
    case '404':
      return 'zhTW'
    case '411':
      return 'ja'
    case '407':
      return 'de'
    case '40c':
      return 'fr'
    case '409':
      return 'en'
    default:
      return null
  }
}

/** 月名 → 显示文本（按 locale 的月份风格；count<=2 是纯数字） */
function renderMonthName(count: number, mo: number, names: LocaleNames): string {
  if (names.monthStyle === 'zh') {
    if (count >= 5) return names.monthLong[mo - 1].slice(0, 1)
    if (count === 4) return `${names.monthLong[mo - 1]}月`
    if (count === 3) return `${mo}月`
  } else if (names.monthStyle === 'cjkNum') {
    const text = names.monthShort[mo - 1]
    if (count >= 5) return text.slice(0, 1)
    if (count >= 3) return text
  } else {
    if (count >= 5) return names.monthLong[mo - 1].slice(0, 1)
    if (count === 4) return names.monthLong[mo - 1]
    if (count === 3) return names.monthShort[mo - 1]
  }
  return count === 1 ? String(mo) : String(mo).padStart(2, '0')
}

/** 星期名 → 显示文本（count<=2 是「几号」，返回空串交给调用方） */
function renderWeekName(count: number, weekday: number, names: LocaleNames): string {
  if (names.weekStyle === 'zh') {
    if (count >= 4) return `星期${names.weekLong[weekday]}`
    if (count === 3) return `周${names.weekShort[weekday]}`
    return ''
  }
  if (count >= 4) return names.weekLong[weekday]
  if (count === 3) return names.weekShort[weekday]
  return ''
}

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
  // 写了 locale 前缀（`[$-804]` 等）→ 月/星期/上下午按该 locale 本地化；
  // 没写前缀或 locale 认不出 → 固定英文（可复现）
  const localeToken = tokens.find((t) => t.type === 'locale')
  const lang: LocaleLang = (localeToken ? localeKind(localeToken.text) : null) ?? 'en'
  const names = LOCALE_NAMES[lang]
  const cjkAmPm = lang === 'zh' || lang === 'zhTW' || lang === 'ja'
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
  // 时长上下文：格式码里出现 [h]/[m]/[s] 之后，后面的 h/m/s 按「总时长的分量」算，
  // 而不是当天时钟的时分秒（两者平时相等，亚秒舍入边界会差 1 秒）
  let inDuration = false
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
        if (inDuration) out += pad(Math.floor(totalSec / 60) % 60, t.count)
        else if (isMinuteAt(k)) out += t.count === 1 ? String(p.mi) : pad(p.mi, 2)
        else out += renderMonthName(t.count, p.mo, names)
        break
      case 'd': {
        const weekday = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()
        const weekText = renderWeekName(t.count, weekday, names)
        out += weekText !== '' ? weekText : t.count === 1 ? String(p.d) : pad(p.d, 2)
        break
      }
      case 'h':
        if (inDuration) out += pad(Math.floor(totalSec / 3600), t.count)
        else out += t.count === 1 ? String(use12h ? hour12 : p.hh) : pad(use12h ? hour12 : p.hh, 2)
        break
      case 's':
        if (inDuration) out += pad(totalSec % 60, t.count)
        else out += t.count === 1 ? String(p.ss) : pad(p.ss, 2)
        break
      case 'ampm':
        if (cjkAmPm) out += p.hh < 12 ? names.am : names.pm
        else out += p.hh < 12 ? t.text.slice(0, 2).toUpperCase() : t.text.slice(3).toUpperCase()
        break
      case 'ap':
        if (cjkAmPm) out += p.hh < 12 ? names.am : names.pm
        else out += p.hh < 12 ? 'A' : 'P'
        break
      case 'eh':
        inDuration = true
        out += pad(Math.floor(totalSec / 3600), t.count)
        break
      case 'em':
        inDuration = true
        out += pad(Math.floor(totalSec / 60), t.count)
        break
      case 'es':
        inDuration = true
        out += pad(totalSec, t.count)
        break
    }
  }
  return out
}

/** 数字格式码里的一个数值占位段 */
/* ------------------------------ 格式段摊平（结构 vs 字面量） ------------------------------ */

/** 掩码符：摊平时把字面量字符替换成它，用来区分「结构字符」和「字面量字符」 */
const LITERAL_MASK = '\u0001'

interface FlatSection {
  /** 摊平后的文本：字面量内容保留，引号/转义符/填充符去掉 */
  text: string
  /** 与 text 等长的掩码串：字面量位置是 LITERAL_MASK，结构位原样 */
  masked: string
}

/**
 * 格式段摊平。
 * 除了文本（沿用原口径：引号内容保留、`\` 取后一位、`_` 记一个空格、`*` 丢弃、
 * `[...]` 只留货币符号），还产出等长掩码串。
 * 没有掩码就分不清 `"E"0.00`（字面量 E）和 `0.00E+00`（科学计数法）、
 * `"a/b"0.00`（字面量斜杠）和 `# ?/?`（分数格式）—— 掩码把字面量位置挖空。
 */
function flattenFormatSection(section: string): FlatSection {
  let text = ''
  let masked = ''
  const put = (s: string, literal: boolean): void => {
    text += s
    for (const ch of s) masked += literal ? LITERAL_MASK : ch
  }
  let i = 0
  while (i < section.length) {
    const ch = section[i]
    if (ch === '"') {
      const end = section.indexOf('"', i + 1)
      const stop = end < 0 ? section.length : end + 1
      put(section.slice(i + 1, stop - 1), true)
      i = stop
      continue
    }
    if (ch === '\\') {
      put(section[i + 1] ?? '', true)
      i += 2
      continue
    }
    if (ch === '_') {
      put(' ', true)
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
      // `[$-804]` = locale 前缀（不是货币）：不产生任何字面量
      if (!/^\$-[0-9A-Fa-f]+$/.test(inner)) {
        const currency = /^\$([^\]-]*)/.exec(inner)?.[1]
        if (currency) put(currency, true)
      }
      i = end < 0 ? section.length : end + 1
      continue
    }
    put(ch, false)
    i++
  }
  return { text, masked }
}

/** 小数位槽位收尾：`#` 去掉尾零、`?` 换成空格再截掉（与既有数字渲染同口径） */
function trimDecSlots(fracPart: string, decPat: string): string {
  let out = fracPart
  for (let k = out.length - 1; k >= 0; k--) {
    const spec = decPat[k]
    if (spec === '0') break
    if (out[k] !== '0') break
    out = out.slice(0, k) + (spec === '?' ? ' ' : '')
  }
  return out.replace(/ +$/, '')
}

/* ------------------------------ 科学计数法 ------------------------------ */

interface SciPattern {
  prefix: string
  intPat: string
  decPat: string
  mid: string
  /** 格式里写的是 `E+` → 正指数也带 `+` 号；`E` / `E-` → 只有负指数带号 */
  expSignAlways: boolean
  /** 指数最少几位（格式里 `0` 的个数，至少 1） */
  expDigits: number
  /** 工程格式（尾数整数位 ≥2 个槽，如 `##0.0E+0`）：指数取 3 的倍数 */
  engineering: boolean
  suffix: string
}

/** 格式段 → 科学计数法模板；不是科学计数法返回 null */
function parseScientificPattern(section: string): SciPattern | null {
  const { text, masked } = flattenFormatSection(section)
  const eIdx = masked.search(/[Ee]/)
  if (eIdx < 0) return null
  const m = /^([Ee])([+-]?)([#0?]*)/.exec(masked.slice(eIdx))
  if (!m) return null
  const core = /[#0?][#0?,]*(?:\.[#0?]+)?/.exec(masked.slice(0, eIdx))
  if (!core) return null
  const dot = core[0].indexOf('.')
  const intPat = dot >= 0 ? core[0].slice(0, dot) : core[0]
  const decPat = dot >= 0 ? core[0].slice(dot + 1) : ''
  const zeros = (m[3].match(/0/g) ?? []).length
  return {
    prefix: text.slice(0, core.index),
    intPat,
    decPat,
    mid: text.slice(core.index + core[0].length, eIdx),
    expSignAlways: m[2] === '+',
    expDigits: Math.max(1, zeros),
    engineering: (intPat.match(/[#0?]/g) ?? []).length >= 2,
    suffix: text.slice(eIdx + m[0].length)
  }
}

/** 科学计数法渲染：`0.00E+00` → `1.23E+04`；不支持的返回 null（调用方保留原值） */
function renderScientific(value: number, section: string, autoMinus: boolean): string | null {
  const pat = parseScientificPattern(section)
  if (!pat) return null
  const abs = Math.abs(value)
  let exp = 0
  let mant = abs
  if (abs !== 0) {
    exp = Math.floor(Math.log10(abs))
    mant = abs / Math.pow(10, exp)
    // log10 的浮点误差可能把尾数甩到 [0.1,1) 或 [10,100)：纠正一次
    if (mant >= 10) {
      mant /= 10
      exp += 1
    } else if (mant < 1) {
      mant *= 10
      exp -= 1
    }
    // 工程格式（`##0.0E+0`）：指数向下取到 3 的倍数，尾数落在 [1, 1000)
    if (pat.engineering) {
      exp = Math.floor(exp / 3) * 3
      mant = abs / Math.pow(10, exp)
    }
  }
  const decimals = pat.decPat.length
  let mantRounded = Number(mant.toFixed(decimals))
  // 尾数四舍五入进位到 10（9.999 → 10.00）→ 尾数归 1、指数加 1
  // 工程格式的尾数落在 [1, 1000)，不能按 10 归一（否则 12.3E+3 会被压回 1.2E+4）
  if (!pat.engineering && Math.abs(mantRounded) >= 10) {
    mantRounded = mantRounded / 10
    exp += 1
  }
  const fixed = mantRounded.toFixed(decimals)
  const dot = fixed.indexOf('.')
  let intPart = dot >= 0 ? fixed.slice(0, dot) : fixed
  const fracPart = dot >= 0 ? trimDecSlots(fixed.slice(dot + 1), pat.decPat) : ''
  intPart = intPart.padStart((pat.intPat.match(/0/g) ?? []).length, '0')
  const body = fracPart ? `${intPart}.${fracPart}` : intPart
  const expText = String(Math.abs(exp)).padStart(pat.expDigits, '0')
  const sign = exp < 0 ? '-' : pat.expSignAlways ? '+' : ''
  return `${autoMinus ? '-' : ''}${pat.prefix}${body}${pat.mid}E${sign}${expText}${pat.suffix}`
}

/* ------------------------------ 分数 ------------------------------ */

interface FractionPattern {
  prefix: string
  intPat: string
  sep: string
  numPat: string
  denPat: string
  /** 固定分母（`# ?/4` 里的 4）；null = 分母由槽位决定 */
  denFixed: number | null
  suffix: string
}

/** 格式段 → 分数模板；不是分数格式返回 null */
function parseFractionPattern(section: string): FractionPattern | null {
  const { text, masked } = flattenFormatSection(section)
  const slashIdx = masked.indexOf('/')
  if (slashIdx < 0) return null
  const leftMasked = masked.slice(0, slashIdx)
  // 分子 = 紧贴斜杠左侧的那段占位符
  const numMatch = /([#0?]+)$/.exec(leftMasked)
  if (!numMatch) return null
  const numStart = numMatch.index
  const headOnly = leftMasked.slice(0, numStart)
  // 整数位 = 更靠左的第一段占位符（`# ?/?` 里的 `#`）
  const intMatch = /([#0?][#0?,]*)/.exec(headOnly)
  const intPat = intMatch ? intMatch[1] : ''
  const intEnd = intMatch ? intMatch.index + intMatch[0].length : 0
  const rightMasked = masked.slice(slashIdx + 1)
  const denMatch = /^[#0?]+/.exec(rightMasked)
  let denPat = ''
  let denFixed: number | null = null
  let denLen = 0
  if (denMatch) {
    denPat = denMatch[0]
    denLen = denPat.length
  } else {
    // `# ?/4` 这种固定分母
    const fixedMatch = /^\d+/.exec(text.slice(slashIdx + 1))
    if (!fixedMatch) return null
    denFixed = Number(fixedMatch[0])
    denLen = fixedMatch[0].length
    if (!Number.isFinite(denFixed) || denFixed < 1) return null
  }
  return {
    prefix: text.slice(0, intMatch ? intMatch.index : numStart),
    intPat,
    sep: text.slice(intEnd, numStart),
    numPat: numMatch[1],
    denPat,
    denFixed,
    suffix: text.slice(slashIdx + 1 + denLen)
  }
}

/**
 * 最佳有理逼近（连分数收敛分数）。
 * Excel 的分数格式取法：取「分母不超过槽位上限」的最后一个收敛分数。
 * 不能简单就近取整 —— 那会把 0.3 取成 2/7，而 Excel 给 1/3。
 */
function bestFraction(x: number, maxNum: number, maxDen: number): { num: number; den: number } | null {
  if (!Number.isFinite(x) || x < 0) return null
  if (x === 0) return { num: 0, den: 1 }
  if (maxNum < 1 || maxDen < 1) return null
  let pPrev = 0
  let qPrev = 1
  let pCur = 1
  let qCur = 0
  let v = x
  let best: { num: number; den: number } | null = null
  for (let i = 0; i < 64; i++) {
    const a = Math.floor(v)
    if (!Number.isFinite(a)) break
    const pNext = a * pCur + pPrev
    const qNext = a * qCur + qPrev
    pPrev = pCur
    qPrev = qCur
    pCur = pNext
    qCur = qNext
    if (qCur > maxDen) break
    if (pCur > maxNum) break
    best = { num: pCur, den: qCur }
    const frac = v - a
    if (frac <= 1e-12) break
    v = 1 / frac
    if (!Number.isFinite(v)) break
  }
  if (best) return best
  // 收敛分数超限（分子放不下）→ 退一步：在分子/分母都不超上限的前提下就近取
  let fallback: { num: number; den: number } | null = null
  let fallbackErr = Infinity
  for (let d = 1; d <= maxDen; d++) {
    const n = Math.round(x * d)
    if (n > maxNum) continue
    const err = Math.abs(x - n / d)
    if (err < fallbackErr - 1e-12) {
      fallbackErr = err
      fallback = { num: n, den: d }
    }
  }
  return fallback
}

/** 整数位按占位符渲染（`0` 补零、`,` 千分位） */
function formatInt(value: number, intPat: string): string {
  let out = String(Math.trunc(value))
  out = out.padStart((intPat.match(/0/g) ?? []).length, '0')
  if (intPat.includes(',')) out = out.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return out
}

/** 分数渲染：`# ?/?` → `2 1/2`；不支持的返回 null（调用方保留原值） */
function renderFraction(value: number, section: string, autoMinus: boolean): string | null {
  const pat = parseFractionPattern(section)
  if (!pat) return null
  const abs = Math.abs(value)
  const hasInt = /[#0?]/.test(pat.intPat)
  let intVal = 0
  let fracVal = abs
  if (hasInt) {
    intVal = Math.floor(abs)
    fracVal = abs - intVal
  }
  let num = 0
  let den = 1
  if (pat.denFixed !== null) {
    den = pat.denFixed
    num = Math.round(fracVal * den)
  } else {
    const maxNum = Math.pow(10, pat.numPat.length) - 1
    const maxDen = Math.pow(10, pat.denPat.length) - 1
    const best = bestFraction(fracVal, maxNum, maxDen)
    if (!best) return null
    num = best.num
    den = best.den
  }
  // 小数部分被四舍五入成了 1（2.999 → 4/4）→ 进位到整数
  if (num === den) {
    intVal += 1
    num = 0
  }
  const sign = autoMinus ? '-' : ''
  if (num === 0) {
    if (!hasInt) return `${sign}${pat.prefix}0${pat.suffix}`
    return `${sign}${pat.prefix}${formatInt(intVal, pat.intPat)}${pat.suffix}`
  }
  const fracText = `${num}/${den}`
  if (!hasInt) return `${sign}${pat.prefix}${fracText}${pat.suffix}`
  return `${sign}${pat.prefix}${formatInt(intVal, pat.intPat)}${pat.sep}${fracText}${pat.suffix}`
}

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
 *
 * 占位段在**掩码串**上定位（字面量位置已挖空）—— 这样「字面量里的数字 / 逗号 / 句点」
 * 不会被误当成数值占位（`"12"0.00` 的 12 是字面量，不是占位段的一部分）。
 */
function parseNumberPattern(section: string, autoMinus: boolean): NumberPattern | null {
  const { text: flat, masked } = flattenFormatSection(section)
  if (/[Ee][+-]/i.test(flat) || flat.includes('/') || flat.includes('@')) return null
  // 掩码位上还留着 E 或「/」= 科学计数法 / 分数格式（字面量里的 E、斜杠已被挖空）→
  // 这类交给专用渲染器；这里解析不了就保留原值，不硬解成普通数字
  if (/[Ee]/.test(masked) || masked.includes('/')) return null

  // 扫出数值占位段：数字槽（#0?）、逗号（千分位或缩放）、小数点
  const start = masked.search(/[#0?]/)
  if (start < 0) return null
  let end = start
  let seenDot = false
  while (end < masked.length) {
    const ch = masked[end]
    if (ch === '#' || ch === '0' || ch === '?') {
      end++
      continue
    }
    if (ch === ',') {
      end++
      continue
    }
    if (ch === '.' && !seenDot) {
      seenDot = true
      end++
      continue
    }
    break
  }
  const core = masked.slice(start, end)

  // 占位段末尾的逗号 = 缩放逗号（每个逗号除以 1000）；整数位中间的逗号 = 千分位
  let scale = 0
  let body = core
  while (body.endsWith(',')) {
    scale++
    body = body.slice(0, -1)
  }
  const dot = body.indexOf('.')
  const intPattern = dot >= 0 ? body.slice(0, dot) : body
  const decPattern = dot >= 0 ? body.slice(dot + 1) : ''

  const grouping = intPattern.includes(',')
  if (!/[#0?]/.test(intPattern + decPattern)) return null
  return {
    prefix: flat.slice(0, start),
    suffix: flat.slice(end),
    intPattern,
    decPattern,
    percent: (masked.match(/%/g) ?? []).length,
    scale,
    grouping,
    autoMinus
  }
}

/** 千分位分组（1234567 → 1,234,567） */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * 整数位按占位槽渲染（照搬 Excel 的槽位语义）：
 *   - 数字右对齐填进最右边的槽；槽位不够就把数字原样多出来（不截断）；
 *   - 空着的槽：`0` 槽显示 0、`#` 槽不显示、`?` 槽显示空格。
 * `zeroValue` 为真时，整数位的 0 不占 `?` 槽 —— Excel 会计格式零段
 * `_($* "-"??_)` 就是靠这个只出横线、不出「0」。
 */
function renderIntSlots(intPattern: string, digits: string, grouping: boolean, zeroValue: boolean): string {
  const slots = [...intPattern].filter((c) => c === '#' || c === '0' || c === '?')
  const effective = zeroValue && digits === '0' && !intPattern.includes('0') ? '' : digits
  const grouped = grouping && effective.length > 3 ? groupThousands(effective) : effective
  if (slots.length === 0 || effective.length > slots.length) return grouped
  const offset = slots.length - effective.length
  let out = ''
  let gi = 0
  for (let i = 0; i < slots.length; i++) {
    if (i < offset) {
      out += slots[i] === '0' ? '0' : slots[i] === '?' ? ' ' : ''
      continue
    }
    while (gi < grouped.length && grouped[gi] === ',') {
      out += ','
      gi++
    }
    out += grouped[gi] ?? ''
    gi++
  }
  return out
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
  // 科学计数法 / 分数：先走专用渲染器，解析不了才落到普通数字
  const sci = renderScientific(value, section, autoMinus)
  if (sci !== null) return sci
  const frac = renderFraction(value, section, autoMinus)
  if (frac !== null) return frac

  const pattern = parseNumberPattern(section, autoMinus)
  if (!pattern) return null

  value = (value / Math.pow(1000, pattern.scale)) * Math.pow(100, pattern.percent)
  const decimals = pattern.decPattern.length
  const fixed = value.toFixed(decimals)
  let intPart = fixed.split('.')[0] ?? ''
  let fracPart = decimals > 0 ? fixed.split('.')[1] ?? '' : ''

  // 可选小数位：`#` 去掉尾零，`?` 去掉后补空格
  fracPart = trimDecSlots(fracPart, pattern.decPattern)

  // 整数位：0 槽补零 / ? 槽补空格 / # 槽不显示；数字右对齐填槽
  intPart = renderIntSlots(pattern.intPattern, intPart, pattern.grouping, value === 0)

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

/**
 * 文本单元格 → 显示文本：格式码里 `@` 前后的字面量要显示出来（`"¥"@` → `¥abc`）。
 * Excel 的文本占位符 `@` 本身不产出内容，只把两侧的字面量夹住文本；
 * 没有**结构** `@` 的格式段（纯数字格式）对文本不生效 —— 文本原样输出。
 */
function renderTextCell(value: string, code: string): string {
  const sections = splitFormatSections(code)
  // Excel 的文本格式有 4 段（正 / 负 / 零 / 文本）；不足 4 段时文本用第 1 段
  const section = sections.length >= 4 ? sections[3] ?? '' : sections[0] ?? ''
  const { text, masked } = flattenFormatSection(section)
  const at = masked.indexOf('@')
  if (at < 0) return value
  return `${text.slice(0, at)}${value}${text.slice(at + 1)}`
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

/**
 * 一个工作表的行 → 单元格文本（按列号定位，缺的列补空；有颜色时文本后附 `[颜色:…]`）。
 * 三趟：①解析全部单元格 → ②按整段范围算区间级条件格式的命中集合 → ③逐格套颜色后拼行。
 */
/* ---------------------- XLSX 超链接 / 批注 ---------------------- */

/** 一个 ref 展开成单元格时能覆盖的格数上限（区间过大直接放弃，防爆） */
const MAX_LINK_CELLS = 4096

/** ref（`A1` / `A1:B2` / `A1 B2`）覆盖的单元格键（`行:列`） */
function xlsxRefCellKeys(ref: string): string[] {
  const out: string[] = []
  for (const range of parseSqref(ref)) {
    const count = (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1)
    if (count > MAX_LINK_CELLS) continue
    for (let r = range.r1; r <= range.r2; r++) {
      for (let c = range.c1; c <= range.c2; c++) out.push(cfCellKey(r, c))
    }
  }
  return out
}

/**
 * 工作表里的 `<hyperlinks>` → 单元格键 → 目标。
 * 外部链接（http: / mailto: …）原样保留；内部链接用 `location`（如 `Sheet2!A1`）。
 */
function parseXlsxHyperlinks(sheetXml: string, rels: Map<string, string>): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of sheetXml.matchAll(/<hyperlink\b([^>]*?)\/?>/g)) {
    const attrs = m[1] ?? ''
    const ref = /\bref="([^"]*)"/.exec(attrs)?.[1]
    if (!ref) continue
    const rid = /\br:id="([^"]*)"/.exec(attrs)?.[1]
    const location = /\blocation="([^"]*)"/.exec(attrs)?.[1]
    let target = rid ? rels.get(rid) : undefined
    if (target && !isExternalTarget(target)) target = resolveRelTarget('xl/worksheets', target)
    if (!target && location) target = decodeXmlEntities(location)
    if (!target) continue
    for (const key of xlsxRefCellKeys(ref)) map.set(key, target)
  }
  return map
}

/** comments.xml → 单元格 ref → 批注列表（作者 + 正文；正文多段用空格连） */
function parseXlsxComments(xml: string): Map<string, Array<{ author: string; text: string }>> {
  const map = new Map<string, Array<{ author: string; text: string }>>()
  if (!xml) return map
  const authors: string[] = []
  for (const m of xml.matchAll(/<author>([\s\S]*?)<\/author>/g)) {
    authors.push(decodeXmlEntities(m[1] ?? ''))
  }
  for (const m of xml.matchAll(/<comment\b([^>]*)>([\s\S]*?)<\/comment>/g)) {
    const attrs = m[1] ?? ''
    const ref = /\bref="([^"]*)"/.exec(attrs)?.[1]
    if (!ref) continue
    const authorId = Number(/\bauthorId="(\d+)"/.exec(attrs)?.[1] ?? '0')
    const author = authors[authorId] ?? ''
    const textXml = /<text\b[^>]*>([\s\S]*?)<\/text>/.exec(m[2] ?? '')?.[1] ?? ''
    const texts = (body: string): string =>
      [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
        .map((t) => decodeXmlEntities(t[1] ?? ''))
        .join('')
    const paras: string[] = []
    for (const p of textXml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
      const t = texts(p[1] ?? '')
      if (t) paras.push(t)
    }
    const text = paras.length > 0 ? paras.join(' ') : texts(textXml)
    if (!text) continue
    const list = map.get(ref) ?? []
    list.push({ author, text })
    map.set(ref, list)
  }
  return map
}

/** workbook.xml definedNames → 置顶行 `[定义名称] 销售额 → 数据!$A$1:$A$10 …`（工作表级名标作用域；无则 ''） */
function parseXlsxDefinedNames(workbook: string, sheetNames: string[]): string {
  const items: string[] = []
  for (const m of workbook.matchAll(/<definedName\b([^>]*?)>([\s\S]*?)<\/definedName>/g)) {
    const name = decodeXmlEntities(/\bname="([^"]*)"/.exec(m[1] ?? '')?.[1] ?? '')
      .trim()
      .replace(/^_xlnm\./, '')
    const value = decodeXmlEntities((m[2] ?? '').replace(/<[^>]*>/g, '')).trim()
    if (!name || !value) continue
    const local = /\blocalSheetId="(\d+)"/.exec(m[1] ?? '')?.[1]
    // localSheetId 是 `<sheets>` 里的 0 起下标；越界不标（不猜）
    const scope =
      local !== undefined && Number(local) < sheetNames.length
        ? ` (工作表「${sheetNames[Number(local)]}」)`
        : ''
    items.push(`${name}${scope} → ${value}`)
  }
  return items.length === 0 ? '' : `[定义名称] ${items.join(' · ')}`
}

/** 数据校验类型 / 操作符的中文译名（认不出原样显示） */
const DATAVAL_TYPE_TEXT: Record<string, string> = {
  whole: '整数',
  decimal: '小数',
  textLength: '文本长度',
  date: '日期',
  time: '时间',
  list: '列表',
  custom: '自定义公式'
}
const DATAVAL_OPERATOR_TEXT: Record<string, string> = {
  between: '介于',
  notBetween: '不介于',
  equal: '等于',
  notEqual: '不等于',
  greaterThan: '大于',
  lessThan: '小于',
  greaterThanOrEqual: '大于等于',
  lessThanOrEqual: '小于等于'
}

/** worksheet 的 dataValidations → 表末行 `[数据校验] 范围: 描述`（空单元格不跟格关联；无则 ''） */
function parseXlsxDataValidations(sheetXml: string): string {
  const block = /<dataValidations\b[^>]*>([\s\S]*?)<\/dataValidations>/.exec(sheetXml)?.[1] ?? ''
  const items: string[] = []
  for (const m of block.matchAll(/<dataValidation\b([^>]*?)(\/>|>([\s\S]*?)<\/dataValidation>)/g)) {
    const attrs = m[1] ?? ''
    const inner = m[3] ?? ''
    const type = /\btype="([^"]*)"/.exec(attrs)?.[1] ?? ''
    if (type === '' || type === 'none' || type === 'any') continue
    const sqref = /\bsqref="([^"]*)"/.exec(attrs)?.[1]?.trim() ?? ''
    if (!sqref) continue
    const formula = (name: string): string =>
      decodeXmlEntities(
        new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(inner)?.[1] ?? ''
      ).trim()
    let desc: string
    if (type === 'list') {
      const f1 = formula('formula1')
      // `"a,b,c"` 是字面选项；否则是引用区域 → 原样显示公式
      desc = `列表(${/^".*"$/.test(f1) ? f1.slice(1, -1) : f1})`
    } else if (type === 'custom') {
      desc = `自定义公式(${formula('formula1')})`
    } else {
      const typeText = DATAVAL_TYPE_TEXT[type] ?? type
      const op = /\boperator="([^"]*)"/.exec(attrs)?.[1] ?? 'between'
      const opText = DATAVAL_OPERATOR_TEXT[op] ?? op
      const f1 = formula('formula1')
      const f2 = formula('formula2')
      const rangeLike = op === 'between' || op === 'notBetween'
      desc = rangeLike && f2 ? `${typeText} ${opText} ${f1}~${f2}` : `${typeText} ${opText} ${f1}`
    }
    items.push(`${sqref}: ${desc}`)
  }
  return items.length === 0 ? '' : `[数据校验] ${items.join(' · ')}`
}

/** tables/tableN.xml → 一条表格对象 `名字 (区间)`（无名字返 ''；name 是显示名，displayName 兜底） */
function parseXlsxTableLine(tableXml: string): string {
  const attrs = /<table\b([^>]*)>/.exec(tableXml)?.[1] ?? ''
  if (!attrs) return ''
  const pick = (name: string): string =>
    decodeXmlEntities(new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? '').trim()
  const name = pick('name') || pick('displayName')
  if (!name) return ''
  const ref = pick('ref')
  return ref ? `${name} (${ref})` : name
}

/** xl/persons/person.xml → personId → 显示名 */
function parseXlsxPersons(xml: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of xml.matchAll(/<person\b([^>]*?)(\/>|>[\s\S]*?<\/person>)/g)) {
    const id = /\bid="([^"]*)"/.exec(m[1] ?? '')?.[1] ?? ''
    const displayName = decodeXmlEntities(
      /\bdisplayName="([^"]*)"/.exec(m[1] ?? '')?.[1] ?? ''
    ).trim()
    if (id && displayName) map.set(id, displayName)
  }
  return map
}

/** 线程批注决议态译名（未知的态不标，不猜） */
const THREAD_STATE_TEXT: Record<string, string> = { resolved: '已解决', accepted: '已接受' }

/**
 * threadedComments 部件 → 单元格键 → 批注标记（回复摊平挂根、按文档顺序；父未知 → 独立批注；成环 seen 兜底）。
 * 作者经 person.xml 的 personId→displayName 解析；resolutionState 认得出才标注。
 */
function parseXlsxThreadedComments(
  xml: string,
  persons: Map<string, string>
): Map<string, string> {
  const map = new Map<string, string>()
  if (!xml) return map
  interface ThreadNode {
    id: string
    parentId: string
    ref: string
    author: string
    text: string
    state: string
  }
  const nodes: ThreadNode[] = []
  for (const m of xml.matchAll(/<threadedComment\b([^>]*?)>([\s\S]*?)<\/threadedComment>/g)) {
    const attrs = m[1] ?? ''
    const pick = (name: string): string =>
      decodeXmlEntities(
        new RegExp(`(?:[\\w.-]+:)?${name}="([^"]*)"`).exec(attrs)?.[1] ?? ''
      ).trim()
    const ref = pick('ref')
    const text = decodeXmlEntities((m[2] ?? '').replace(/<[^>]*>/g, '')).trim()
    if (!ref || !text) continue
    nodes.push({
      id: pick('id'),
      parentId: pick('parentId'),
      ref,
      author: persons.get(pick('personId')) ?? '',
      text,
      state: THREAD_STATE_TEXT[/\bresolutionState="([^"]*)"/.exec(attrs)?.[1] ?? ''] ?? ''
    })
  }
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const findRoot = (start: ThreadNode): ThreadNode | null => {
    let cur = start
    const seen = new Set([start.id])
    while (cur.parentId) {
      const parent = byId.get(cur.parentId)
      if (!parent || seen.has(parent.id)) return null
      seen.add(parent.id)
      cur = parent
    }
    return cur
  }
  const repliesOf = new Map<string, ThreadNode[]>()
  const replyIds = new Set<string>()
  for (const n of nodes) {
    if (!n.parentId) continue
    const root = findRoot(n)
    if (!root || root === n) continue
    const list = repliesOf.get(root.id) ?? []
    list.push(n)
    repliesOf.set(root.id, list)
    replyIds.add(n.id)
  }
  for (const n of nodes) {
    if (replyIds.has(n.id)) continue
    const head = n.state ? `[批注(${n.author})(${n.state}): ${n.text}]` : `[批注(${n.author}): ${n.text}]`
    const parts = [head]
    for (const r of repliesOf.get(n.id) ?? []) parts.push(`[回复(${r.author}): ${r.text}]`)
    const marker = parts.join(' ')
    for (const key of xlsxRefCellKeys(n.ref)) {
      const prev = map.get(key)
      map.set(key, prev ? `${prev} ${marker}` : marker)
    }
  }
  return map
}

/** 单元格键 → 链接 / 批注 / 线程批注标记文本（`[链接: …] [批注(作者): …]`） */
function xlsxCellExtras(
  links: Map<string, string>,
  comments: Map<string, Array<{ author: string; text: string }>>,
  threaded: Map<string, string>
): Map<string, string> {
  const map = new Map<string, string>()
  const add = (key: string, marker: string): void => {
    const prev = map.get(key)
    map.set(key, prev ? `${prev} ${marker}` : marker)
  }
  for (const [key, target] of links) add(key, `[链接: ${target}]`)
  for (const [ref, list] of comments) {
    const marker = list.map((c) => `[批注(${c.author}): ${c.text}]`).join(' ')
    if (!marker) continue
    for (const key of xlsxRefCellKeys(ref)) add(key, marker)
  }
  for (const [key, marker] of threaded) add(key, marker)
  return map
}

function parseXlsxSheet(
  xml: string,
  shared: string[],
  styles: XlsxStyles,
  date1904: boolean,
  extras: Map<string, string>,
  cellMap?: Map<string, string>
): string[] {
  interface Cell {
    row: number
    col: number
    value: string
    num: number | null
    sectionColor: string | null
    styleIdx: number
    font: string | null
    fill: string | null
    /** 单元格公式体（共享公式的 follower 已回填 master 的公式体） */
    formula: string
    /** 公式的 si（共享公式分组号） */
    formulaSi: string
    /** 本格是共享公式的 follower（公式体继承自 master） */
    sharedFollower: boolean
  }
  const rows: Array<{ row: number; cells: Cell[] }> = []
  /** 全部单元格（含空值）—— 区间级规则按范围取数时用 */
  const allCells: Cell[] = []
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
      // 文本单元格：格式码里 @ 前后的字面量要显示（`"¥"@` → `¥abc`）；颜色在第 4 个格式段
      if (sectionColor === null && (type === 's' || type === 'inlineStr' || type === 'str')) {
        const code = fmtOf(styleIdx)
        if (code) {
          value = renderTextCell(value, code)
          const sections = splitFormatSections(code)
          if (sections.length >= 4) sectionColor = sectionColorName(sections[3] ?? '')
        }
      }

      // 单元格文本索引（图表系列名兜底：strRef 无缓存值时按公式回查这张表）
      if (cellMap && value !== '') cellMap.set(ref ?? `${colLetters(col)}${rowNo}`, value)

      // 公式：`<f>` 的体（普通 / 数组公式直接取；共享公式 follower 只有 si，靠 master 回填）
      const fEl = /<f\b([^>]*?)(\/>|>([\s\S]*?)<\/f>)/.exec(cellInner)
      const fBody = fEl?.[3] ?? ''
      const cell: Cell = {
        row: rowNo,
        col,
        value,
        num,
        sectionColor,
        styleIdx,
        font: null,
        fill: null,
        formula: fBody.trim() === '' ? '' : decodeXmlEntities(fBody).trim(),
        formulaSi: /\bsi="(\d+)"/.exec(fEl?.[1] ?? '')?.[1] ?? '',
        sharedFollower: false
      }
      cells.push(cell)
      allCells.push(cell)
    }
    rows.push({ row: rowNo, cells })
  }

  // 共享公式：follower 只有 si 没有公式体 → 按 si 找回 master 的公式体（不做相对引用重写）
  const sharedMasters = new Map<string, string>()
  for (const cell of allCells) {
    if (cell.formula !== '' && cell.formulaSi !== '') sharedMasters.set(cell.formulaSi, cell.formula)
  }
  for (const cell of allCells) {
    if (cell.formula === '' && cell.formulaSi !== '') {
      const master = sharedMasters.get(cell.formulaSi)
      if (master) {
        cell.formula = master
        cell.sharedFollower = true
      }
    }
  }

  // 区间级规则（top10 / aboveAverage / 重复值 / 唯一值）要先拿整段范围的数据才能判定
  const rangeMatches = rangeLevelCfMatches(cfRules, allCells)
  for (const r of rows) {
    for (const cell of r.cells) {
      if (cell.value === '') continue
      // 优先级：条件格式 > 格式段颜色 > 静态字体色；底色来自条件格式或静态填充
      const cf = conditionalColors(cfRules, styles, cell.row, cell.col, cell.value, cell.num, rangeMatches)
      const staticColors = staticCellColors(styles, cell.styleIdx)
      cell.font = cf.font ?? cell.sectionColor ?? staticColors.font
      cell.fill = cf.fill ?? staticColors.fill
    }
  }

  const out: string[] = []
  for (const r of rows.sort((a, b) => a.row - b.row)) {
    const filled = r.cells
      .filter((c) => c.value !== '' || c.formula !== '' || extras.has(cfCellKey(c.row, c.col)))
      .sort((a, b) => a.col - b.col)
    if (filled.length === 0) continue
    const parts: string[] = []
    let expect = filled[0].col
    for (const c of filled) {
      while (expect < c.col) {
        parts.push('')
        expect++
      }
      const extra = extras.get(cfCellKey(c.row, c.col)) ?? ''
      // 顺序：值 → 公式 → 链接 / 批注 → 颜色标记（颜色恒在最末）
      const markers: string[] = []
      if (c.formula !== '') {
        markers.push(`[公式: ${c.sharedFollower ? `共享 ${c.formula}` : c.formula}]`)
      }
      if (extra) markers.push(extra)
      const text = [c.value, ...markers].filter((s) => s !== '').join(' ')
      parts.push(text + colorMarker(c.font, c.fill))
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
/**
 * 工作表里的图表与数据透视表标记。
 *
 * 图表要过两层关系：工作表 → xl/drawings/drawingN.xml → xl/charts/chartN.xml；
 * 数据透视表是一层：工作表 → xl/pivotTables/pivotTableN.xml。
 */
function xlsxSheetGraphics(
  sheetXml: string,
  relEntries: RelEntry[],
  entries: Record<string, Uint8Array>,
  resolveFormula?: (formula: string) => string
): string[] {
  const out: string[] = []
  const rels = new Map(relEntries.map((e) => [e.id, e.target]))
  const drawingRel = relEntries.find((e) => e.type.endsWith('/drawing'))
  if (drawingRel && !isExternalTarget(drawingRel.target)) {
    const drawingPath = resolveRelTarget('xl/worksheets', drawingRel.target)
    const drawingXml = decodeEntry(entries[drawingPath]) ?? ''
    const drawingRelsPath = drawingPath.replace(/([^/]+)$/, '_rels/$1.rels')
    const drawingRels = parseRels(decodeEntry(entries[drawingRelsPath]) ?? '')
    for (const m of drawingXml.matchAll(/<(?:[\w.-]+:)?chart\b([^>]*)/g)) {
      const rid = /\br:id="([^"]*)"/.exec(m[1] ?? '')?.[1]
      const target = rid ? drawingRels.get(rid) : undefined
      if (!target || isExternalTarget(target)) continue
      const mark = chartMarker(
        decodeEntry(entries[resolveRelTarget('xl/drawings', target)]) ?? '',
        resolveFormula
      )
      if (mark) out.push(mark)
    }
  }
  for (const m of sheetXml.matchAll(/<(?:[\w.-]+:)?pivotTablePart\b([^>]*)/g)) {
    const rid = /\br:id="([^"]*)"/.exec(m[1] ?? '')?.[1]
    const target = rid ? rels.get(rid) : undefined
    if (!target || isExternalTarget(target)) continue
    const mark = pivotTableMarker(decodeEntry(entries[resolveRelTarget('xl/worksheets', target)]) ?? '')
    if (mark) out.push(mark)
  }
  return out
}

export function extractXlsxText(filePath: string): string {
  const entries = readZipEntries(
    filePath,
    (n) =>
      n === XLSX_WORKBOOK_ENTRY ||
      n === XLSX_WORKBOOK_RELS ||
      n === XLSX_SHARED_STRINGS_ENTRY ||
      n === XLSX_STYLES_ENTRY ||
      XLSX_SHEET_RE.test(n) ||
      XLSX_SHEET_RELS_RE.test(n) ||
      XLSX_COMMENTS_RE.test(n) ||
      XLSX_TABLES_RE.test(n) ||
      XLSX_THREADED_COMMENTS_RE.test(n) ||
      XLSX_CHART_RE.test(n) ||
      XLSX_DRAWING_RE.test(n) ||
      XLSX_DRAWING_RELS_RE.test(n) ||
      XLSX_PIVOT_RE.test(n) ||
      n === XLSX_PERSONS_ENTRY ||
      n === DOC_CORE_PROPS_ENTRY || n === DOC_APP_PROPS_ENTRY || n === DOC_CUSTOM_PROPS_ENTRY
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

  const meta = docPropsLines(
    decodeEntry(entries[DOC_CORE_PROPS_ENTRY]),
    decodeEntry(entries[DOC_APP_PROPS_ENTRY]),
    decodeEntry(entries[DOC_CUSTOM_PROPS_ENTRY])
  ).join('\n')
  const definedLine = parseXlsxDefinedNames(workbook, sheets.map((s) => s.name))
  const persons = parseXlsxPersons(decodeEntry(entries[XLSX_PERSONS_ENTRY]))
  const blocks: string[] = []
  // 先把每个工作表解析完再出块：图表系列名可能要回查别的表的单元格（strRef 没缓存值时）
  interface PreparedSheet {
    name: string
    sheetXml: string
    relEntries: RelEntry[]
    rows: string[]
    tableLine: string
    dvLine: string
    cellMap: Map<string, string>
  }
  const prepared: PreparedSheet[] = []
  for (const sheet of sheets) {
    const sheetXml = decodeEntry(entries[sheet.path]) ?? ''
    // 工作表自己的 rels：超链接目标 + 批注部件都在这里
    const sheetRelsPath = sheet.path.replace(/([^/]+)$/, '_rels/$1.rels')
    const relEntries = parseRelEntries(decodeEntry(entries[sheetRelsPath]) ?? '')
    const rels = new Map(relEntries.map((e) => [e.id, e.target]))
    const links = parseXlsxHyperlinks(sheetXml, rels)
    const commentsRel = relEntries.find((e) => e.type.endsWith('/comments'))
    let commentsPath = commentsRel ? resolveRelTarget('xl/worksheets', commentsRel.target) : ''
    // 兜底：rels 里没指向批注部件就按命名约定找 xl/commentsN.xml（N 取工作表序号）
    if (!commentsPath) {
      const no = /sheet(\d+)\.xml$/.exec(sheet.path)?.[1]
      const guess = no ? `xl/comments${no}.xml` : ''
      if (guess && entries[guess]) commentsPath = guess
    }
    const comments = parseXlsxComments(commentsPath ? decodeEntry(entries[commentsPath]) ?? '' : '')
    // 线程批注（Excel 365）：rels 指向 threadedComments 部件；rels 缺失按命名约定兜底（批注同款套路）
    let threadXml = ''
    const threadRel = relEntries.find((e) => e.type.endsWith('/threadedComment'))
    if (threadRel && !isExternalTarget(threadRel.target)) {
      threadXml = decodeEntry(entries[resolveRelTarget('xl/worksheets', threadRel.target)]) ?? ''
    }
    if (!threadXml) {
      const no = /sheet(\d+)\.xml$/.exec(sheet.path)?.[1]
      const guess = no ? `xl/threadedComments/threadedComment${no}.xml` : ''
      if (guess && entries[guess]) threadXml = decodeEntry(entries[guess]) ?? ''
    }
    const threaded = parseXlsxThreadedComments(threadXml, persons)
    const extras = xlsxCellExtras(links, comments, threaded)
    const cellMap = new Map<string, string>()
    const rows = parseXlsxSheet(sheetXml, shared, styles, date1904, extras, cellMap)
    // 表格对象：rels 里 Type 结尾 /table 的部件（一表可多个，「 · 」拼一行）
    const tableFrags: string[] = []
    for (const e of relEntries) {
      if (!e.type.endsWith('/table') || isExternalTarget(e.target)) continue
      const frag = parseXlsxTableLine(
        decodeEntry(entries[resolveRelTarget('xl/worksheets', e.target)]) ?? ''
      )
      if (frag) tableFrags.push(frag)
    }
    prepared.push({
      name: sheet.name,
      sheetXml,
      relEntries,
      rows,
      tableLine: tableFrags.length > 0 ? `[表格] ${tableFrags.join(' · ')}\n` : '',
      dvLine: parseXlsxDataValidations(sheetXml),
      cellMap
    })
  }
  // 全工作簿单元格索引（`表名!A1` → 单元格文本）
  const cellIndex = new Map<string, string>()
  for (const p of prepared) {
    for (const [ref, value] of p.cellMap) cellIndex.set(`${p.name}!${ref}`, value)
  }
  // 图表里 strRef 没有缓存值时的兜底：按 `表名!单元格` 公式回查
  const resolveChartFormula = (formula: string): string => {
    const ref = parseChartFormula(formula)
    if (!ref) return ''
    return cellIndex.get(`${ref.sheet}!${ref.ref}`) ?? ''
  }
  for (const p of prepared) {
    if (p.rows.length === 0) continue
    const tail = p.dvLine ? `\n${p.dvLine}` : ''
    // 图表与数据透视表：挂在所属工作表末尾
    const graphicLines = xlsxSheetGraphics(
      p.sheetXml,
      p.relEntries,
      entries,
      resolveChartFormula
    )
    const graphicTail = graphicLines.length > 0 ? `\n${graphicLines.join('\n')}` : ''
    blocks.push(`[工作表 ${p.name}]\n${p.tableLine}${p.rows.join('\n')}${tail}${graphicTail}`)
  }
  const body = normalizeText(blocks.join('\n\n'))
  const top = [meta, definedLine].filter((s) => s !== '').join('\n')
  return top ? `${top}\n${body}` : body
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
  /** 起始页（1 起；第三十一阶段起可只抽一段页码范围） */
  startPage?: number
  /** 结束页（含） */
  endPage?: number
}

/** 把页码夹到 [min, max]；非数字 / NaN 一律退回 fallback（不猜） */
function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(n, max))
}

/**
 * 书签目标 → 页码（1 起）。
 *
 * pdfjs 给的 dest 有三种形态：
 *   - 字符串（命名目标）→ 先 getDestination 换成目标数组；
 *   - 目标数组 [页面引用, /XYZ, ...] → getPageIndex 把页面引用换成 0 起的页序号；
 *   - 其它 → null（**不猜页码**：猜错了点了跳到别的页，比不跳更糟）。
 */
async function outlineDestPage(doc: PdfDocument, dest: unknown): Promise<number | null> {
  let target = dest
  if (typeof target === 'string') {
    if (typeof doc.getDestination !== 'function') return null
    try {
      target = await doc.getDestination(target)
    } catch {
      return null
    }
  }
  if (!Array.isArray(target) || target.length === 0) return null
  const ref = target[0]
  if (!ref || typeof ref !== 'object') return null
  if (typeof doc.getPageIndex !== 'function') return null
  try {
    const index = await doc.getPageIndex(ref)
    if (typeof index !== 'number' || !Number.isFinite(index) || index < 0) return null
    return index + 1
  } catch {
    return null
  }
}

/**
 * 读 PDF 目录（书签）→ 树。
 * 解析失败一律当「没有目录」——目录是加分项，不该把整份预览拖垮。
 */
async function readPdfOutline(doc: PdfDocument): Promise<DocumentOutlineNode[]> {
  if (typeof doc.getOutline !== 'function') return []
  let items: PdfOutlineItem[] | null = null
  try {
    items = await doc.getOutline()
  } catch {
    return []
  }
  if (!Array.isArray(items) || items.length === 0) return []
  const walk = async (list: PdfOutlineItem[], depth: number): Promise<DocumentOutlineNode[]> => {
    // 畸形文件里可能有自引用 → 限深，不递归到爆栈
    if (depth > MAX_OUTLINE_DEPTH) return []
    const out: DocumentOutlineNode[] = []
    for (const item of list) {
      const title = normalizeText(typeof item?.title === 'string' ? item.title : '')
      const page = await outlineDestPage(doc, item?.dest)
      const children = Array.isArray(item?.items) ? await walk(item.items, depth + 1) : []
      out.push({ title, page, children })
    }
    return out
  }
  return walk(items, 0)
}

/**
 * 预览一个文档（PDF / DOCX / PPTX / XLSX；其余类型明确告知，不猜）。
 * 出错也不抛：把原因写进 error 字段，界面与 agent 都能读到人话。
 */
/** PDF 日期串（`D:20260101120000Z` / `D:20260101120000+08'00'`）→ 可读文本；认不出来就原样返回 */
function pdfDateText(raw: string): string {
  const s = raw.trim()
  const m = /^D?:?(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(s)
  if (!m) return s
  const zone = /([+-])(\d{2})'(\d{2})'/.exec(s)
  const suffix = zone ? ` ${zone[1]}${zone[2]}:${zone[3]}` : ''
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}${suffix}`
}

/** PDF 的 Info 字典 → 一行文档信息（空字段逐个省略；全空不出行） */
function pdfInfoLine(info: Record<string, unknown>): string {
  const pick = (key: string): string => {
    const v = info?.[key]
    return typeof v === 'string' ? v.trim() : ''
  }
  const parts: string[] = []
  const put = (label: string, value: string): void => {
    if (value) parts.push(`${label}: ${value}`)
  }
  put('标题', pick('Title'))
  put('作者', pick('Author'))
  put('主题', pick('Subject'))
  put('关键词', pick('Keywords'))
  put('创建工具', pick('Creator'))
  put('生成器', pick('Producer'))
  put('创建时间', pdfDateText(pick('CreationDate')))
  put('修改时间', pdfDateText(pick('ModDate')))
  return parts.length > 0 ? `[文档信息] ${parts.join(' · ')}` : ''
}

/** 文档元数据（Info 字典）→ 一行；没有 getMetadata 的实现 / 读失败都返回空串 */
async function pdfMetadataLine(doc: PdfDocument): Promise<string> {
  if (typeof doc.getMetadata !== 'function') return ''
  try {
    const meta = await doc.getMetadata()
    const info = meta?.info
    if (!info || typeof info !== 'object') return ''
    return pdfInfoLine(info as Record<string, unknown>)
  } catch {
    return ''
  }
}

/** 内部跳转目标 → 目标页号（1 起）；解析不出来返回 null（不猜） */
async function pdfDestPage(doc: PdfDocument, dest: unknown): Promise<number | null> {
  const ref = Array.isArray(dest) ? dest[0] : dest
  if (!ref || typeof ref !== 'object') return null
  const num = (ref as { num?: unknown }).num
  if (typeof num !== 'number') return null
  if (typeof doc.getPageIndex !== 'function') return null
  try {
    const idx = await doc.getPageIndex(ref)
    return typeof idx === 'number' && idx >= 0 ? idx + 1 : null
  } catch {
    return null
  }
}

/**
 * 一页的注释 / 链接 / 表单域 → 标记文本。
 *
 * - `Link` + `url` → `[链接: …]`；`Link` + `dest` → `[跳转: 第 N 页]`（页号解析不出就写「内部链接」）
 * - `Text` / `FreeText` 便笺 → `[注释(作者): 正文]`
 * - `Widget` 表单域 → `[表单: 字段名 = 已填值]`
 *
 * 注释读不出来不影响正文（调用方 try/catch）。
 */
async function pdfAnnotationMarks(doc: PdfDocument, annots: PdfAnnotation[]): Promise<string> {
  const out: string[] = []
  for (const a of annots) {
    const subtype = a.subtype ?? ''
    if (subtype === 'Link') {
      if (a.url) out.push(`[链接: ${a.url}]`)
      else if (a.dest) {
        const page = await pdfDestPage(doc, a.dest)
        out.push(page ? `[跳转: 第 ${page} 页]` : '[跳转: 内部链接]')
      }
      continue
    }
    if (subtype === 'Text' || subtype === 'FreeText') {
      const contents = (a.contentsObj?.str ?? '').trim()
      const author = (a.titleObj?.str ?? '').trim()
      if (contents) out.push(author ? `[注释(${author}): ${contents}]` : `[注释: ${contents}]`)
      continue
    }
    if (subtype === 'Widget') {
      const name = (a.fieldName ?? '').trim()
      const value = typeof a.fieldValue === 'string' ? a.fieldValue.trim() : ''
      if (name || value) out.push(`[表单: ${name}${value ? ` = ${value}` : ''}]`)
      continue
    }
  }
  return out.length > 0 ? ` ${out.join(' ')}` : ''
}

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
    error: null,
    outline: []
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
          ? extractDocxText(readDocxParts(resolved))
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
    const total = doc.numPages
    // 文档元数据（Info 字典）→ 置顶一行（没有 getMetadata 的实现就跳过）
    const infoLine = await pdfMetadataLine(doc)
    // 第三十一阶段：可指定页码范围（startPage / endPage），越界一律夹住
    // 不给 startPage → 从第 1 页起；不给 endPage → 到最后一页止（各自有自己的默认值）
    const start = clampInt(input.startPage, 1, 1, total)
    const end = clampInt(input.endPage, total, start, total)
    const take = Math.min(end - start + 1, maxPages)
    const lastPage = start + take - 1
    const pages: DocumentPreviewPage[] = []
    let chars = infoLine.length
    let truncated = false
    for (let i = start; i <= lastPage; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      let text = itemsToText(content.items)
      // 注释 / 链接 / 表单域（pdfjs 的 getAnnotations；没有这个方法的实现就跳过）
      if (typeof page.getAnnotations === 'function') {
        try {
          const marks = await pdfAnnotationMarks(doc, (await page.getAnnotations()) ?? [])
          if (marks) text = text ? `${text}${marks}` : marks.trim()
        } catch {
          /* 注释读不出来不影响正文 */
        }
      }
      pages.push({ page: i, text })
      chars += text.length
      if (chars >= maxChars) {
        truncated = true
        break
      }
    }
    const lastExtracted = pages.length ? pages[pages.length - 1].page : start
    if (lastExtracted < total) truncated = true
    const outline = await readPdfOutline(doc)
    const body = pages.map((p) => p.text).join('\n\n')
    return {
      ...base,
      pageCount: total,
      pages,
      text: infoLine ? `${infoLine}\n${body}` : body,
      truncated,
      error: null,
      pageStart: start,
      pageEnd: lastExtracted,
      outline
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

/** 打开 PDF（解析一次，供文本抽取 / 位图渲染共用） */
async function openPdfDoc(filePath: string): Promise<PdfDocument> {
  const pdfjs = loadPdfjs()
  const data = new Uint8Array(fs.readFileSync(filePath))
  return pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise
}

/** 把 PDF 的某一页渲染成 PNG（只给界面看；agent 读文本即可） */
async function renderPdfPageToPng(
  doc: PdfDocument,
  canvasMod: CanvasModule,
  pageNo: number,
  scale: number
): Promise<DocumentPageImage> {
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
  const doc = await openPdfDoc(resolved)
  const pageNo = Math.max(1, Math.min(Math.floor(input.page ?? 1), doc.numPages))
  const scale = Math.max(MIN_SCALE, Math.min(input.scale ?? 1.5, MAX_SCALE))

  return renderPdfPageToPng(doc, canvasMod, pageNo, scale)
}

export interface DocumentThumbsInput {
  path?: string
  name?: string
  /** 要出缩略图的页码（1 起）；不给则取前若干页 */
  pages?: number[]
  /** 缩略图目标宽度（像素，默认 132） */
  width?: number
}

export interface DocumentPageThumbs {
  /** 文档总页数 */
  pageCount: number
  /** 已渲染的缩略图（按请求顺序） */
  thumbs: DocumentPageImage[]
}

/**
 * 渲染多页缩略图（导航条用；只给界面看，agent 读文本即可）。
 *
 * 缩略图按**目标宽度**归一，而不是按固定 scale —— PDF 页面尺寸不一（A4 / Letter / 横向），
 * 固定 scale 会让缩略图宽窄不一。宽度相同才排得齐。
 * 出错直接抛（调用方是 IPC/界面），由界面显示原因。
 */
export async function renderDocumentThumbs(input: DocumentThumbsInput): Promise<DocumentPageThumbs> {
  const resolved = resolveInputPath(input)
  const stat = fs.statSync(resolved)
  if (detectDocumentKind(resolved) !== 'pdf') throw new Error('只有 PDF 支持位图预览')
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`文件过大（${stat.size} B），超过 ${MAX_FILE_BYTES} B 上限，不渲染`)
  }

  const canvasMod = loadCanvas()
  const doc = await openPdfDoc(resolved)
  const width = Math.max(MIN_THUMB_WIDTH, Math.min(Math.round(input.width ?? THUMB_WIDTH), MAX_THUMB_WIDTH))

  // 请求的页码先过滤掉越界 / 非法的；全空则退回「前若干页」
  const asked = (input.pages ?? []).filter((n) => Number.isFinite(n) && Math.floor(n) >= 1 && Math.floor(n) <= doc.numPages)
  const wanted = (asked.length ? asked : Array.from({ length: Math.min(doc.numPages, MAX_THUMBS) }, (_, i) => i + 1)).slice(
    0,
    MAX_THUMBS
  )

  const thumbs: DocumentPageImage[] = []
  for (const raw of wanted) {
    const pageNo = Math.floor(raw)
    const page = await doc.getPage(pageNo)
    const base = page.getViewport({ scale: 1 })
    const scale = width / Math.max(1, base.width)
    const viewport = page.getViewport({ scale })
    // 用 round 而不是 ceil：scale 是除法算出来的，viewport.width 常是 400.00000000000006 这种值，
    // ceil 会把它顶成 401（缩略图就比目标宽多 1 px，宽度不归一）。
    const canvas = canvasMod.createCanvas(Math.round(viewport.width), Math.round(viewport.height))
    const ctx = canvas.getContext('2d')
    // PDF 页面本身不画背景（透明），先铺白底再渲染，避免缩略图发黑
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    const png = canvas.toBuffer('image/png')
    thumbs.push({
      page: pageNo,
      width: canvas.width,
      height: canvas.height,
      dataUrl: `data:image/png;base64,${png.toString('base64')}`
    })
  }

  return { pageCount: doc.numPages, thumbs }
}