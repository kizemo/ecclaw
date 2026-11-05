import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { paths } from './paths'
import { readSettings, writeSettings } from './openclaw-config'
import type {
  PackageEligibilityReason,
  PackageRollout,
  PlatformPackageManifest,
  RemotePackageEntry,
  RemotePackageInstallResult,
  RemoteRepoIndex
} from '../shared/types'

/**
 * 远程平台包仓库（对齐 dabi 的 taobao-launch-packages 处理器）。
 *
 * dabi 侧的线索（docs/逆向分析补充-平台包协议实证-2026-11-01.md §9.5）：
 *   manifest 哈希校验 + zip 安全解包 + OSS 签名直链下载 + 版本目录清理。
 * ecclaw 这边对齐到能独立跑通的最小闭环：
 *   ① 拉远端 index.json（注册表形态：packages[] / packageUrl 签名直链）
 *   ② 下载归档（只允许 http/https，限大小，校验 sha256）
 *   ③ 安全解包（无第三方依赖的最小 zip 解析：防 zip slip / 防符号链接 / 限文件数与体积 / CRC 校验）
 *   ④ 校验 manifest（packageId / version / manifest 哈希）
 *   ⑤ 落到 <userData>/platform-packages/<packageId>/<version-dir>/ 并写 current.json 指针
 *
 * 刻意不做：删旧版本目录（全局红线：禁止删除用户文件）——旧版本保留，需要时由用户自己清。
 */

/** 归档最大字节数 */
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024
/** 解包后总体积上限 */
const MAX_TOTAL_BYTES = 400 * 1024 * 1024
/** 单文件体积上限 */
const MAX_FILE_BYTES = 100 * 1024 * 1024
/** 文件数上限 */
const MAX_FILE_COUNT = 5000
/** 单次请求超时 */
const REQUEST_TIMEOUT_MS = 120000

/* ------------------------------ 仓库地址设置 ------------------------------ */

interface RepoSettings {
  baseUrl?: string
}

export function readRepoSettings(): RepoSettings {
  const settings = readSettings().packageRepo
  return settings && typeof settings === 'object' ? (settings as RepoSettings) : {}
}

export function saveRepoBaseUrl(baseUrl: string): RepoSettings {
  const next: RepoSettings = { ...readRepoSettings(), baseUrl: normalizeBaseUrl(baseUrl) }
  writeSettings({ packageRepo: next })
  return next
}

/* ------------------------------ 远端清单 ------------------------------ */

function normalizeBaseUrl(raw: string): string {
  return (raw ?? '').trim().replace(/\/+$/, '')
}

function assertHttpUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`地址不合法：${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`只支持 http/https 协议（收到 ${parsed.protocol}）`)
  }
  return parsed
}

/** 拉取远端仓库清单 index.json */
export async function fetchRepoIndex(baseUrl: string): Promise<RemoteRepoIndex> {
  const base = normalizeBaseUrl(baseUrl)
  if (!base) throw new Error('仓库地址为空')
  assertHttpUrl(base)
  const res = await fetch(`${base}/index.json`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: 'application/json' }
  })
  if (!res.ok) throw new Error(`拉取清单失败：HTTP ${res.status} ${res.statusText}`)
  const raw = (await res.json()) as { packages?: unknown[] }
  const list = Array.isArray(raw?.packages) ? raw.packages : []
  const clientId = readOrCreateClientId()
  const packages: RemotePackageEntry[] = []
  for (const item of list) {
    const entry = normalizeEntry(item)
    if (entry) packages.push(annotateEligibility(entry, clientId))
  }
  packages.sort((a, b) =>
    a.packageId === b.packageId
      ? (b.version ?? '').localeCompare(a.version ?? '', undefined, { numeric: true })
      : a.packageId.localeCompare(b.packageId)
  )
  return { baseUrl: base, packages }
}

function normalizeStringList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const list = raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  return list.length > 0 ? list.map((v) => v.trim()) : undefined
}

/**
 * 解析灰度配置。**写错一律 fail-closed**（percent=0）：
 * 灰度是「放量闸门」，清单写坏了宁可少放，不能误放给全量。
 */
function normalizeRollout(raw: unknown): PackageRollout | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object') return { id: 'invalid', percent: 0 }
  const obj = raw as Record<string, unknown>
  const id = typeof obj.id === 'string' ? obj.id.trim() : ''
  const percent = typeof obj.percent === 'number' && Number.isFinite(obj.percent) ? obj.percent : NaN
  if (!id || Number.isNaN(percent)) return { id: id || 'invalid', percent: 0 }
  return {
    id,
    percent: Math.min(100, Math.max(0, percent)),
    allowClientIds: normalizeStringList(obj.allowClientIds),
    denyClientIds: normalizeStringList(obj.denyClientIds)
  }
}

function normalizeEntry(item: unknown): RemotePackageEntry | null {
  if (!item || typeof item !== 'object') return null
  const obj = item as Record<string, unknown>
  const packageId = typeof obj.packageId === 'string' ? obj.packageId.trim() : ''
  const packageUrl = typeof obj.packageUrl === 'string' ? obj.packageUrl.trim() : ''
  if (!packageId || !packageUrl) return null
  return {
    packageId,
    version: typeof obj.version === 'string' ? obj.version : undefined,
    channel: typeof obj.channel === 'string' ? obj.channel : undefined,
    displayName: typeof obj.displayName === 'string' ? obj.displayName : undefined,
    match: Array.isArray(obj.match) ? obj.match.filter((m): m is string => typeof m === 'string') : undefined,
    packageUrl,
    size: typeof obj.size === 'number' ? obj.size : undefined,
    sha256: typeof obj.sha256 === 'string' ? obj.sha256.toLowerCase() : undefined,
    manifestSha256:
      typeof obj.manifestSha256 === 'string' ? obj.manifestSha256.toLowerCase() : undefined,
    rollout: normalizeRollout(obj.rollout)
  }
}

/* ------------------------------ 灰度分桶 ------------------------------ */

/** 客户端匿名标识：只落本地设置，绝不上传（项目刻意不做遥测） */
export function readOrCreateClientId(): string {
  const existing = readSettings().clientId
  if (typeof existing === 'string' && existing.trim()) return existing.trim()
  const created = crypto.randomUUID()
  writeSettings({ clientId: created })
  return created
}

/** 分桶 0-99：同一 clientId + 同一 rollout.id 恒定，重启不变；换 id 即重新洗牌 */
export function rolloutBucket(clientId: string, rolloutId: string): number {
  const hex = crypto.createHash('sha256').update(`${clientId}:${rolloutId}`).digest('hex').slice(0, 8)
  return Number.parseInt(hex, 16) % 100
}

export interface RolloutDecision {
  eligible: boolean
  bucket?: number
  reason: PackageEligibilityReason
}

/** 准入判定：deny > allow > 分桶 */
export function decideRollout(entry: RemotePackageEntry, clientId: string): RolloutDecision {
  const rollout = entry.rollout
  if (!rollout) return { eligible: true, reason: 'all' }
  if (rollout.denyClientIds?.includes(clientId)) return { eligible: false, reason: 'denylisted' }
  if (rollout.allowClientIds?.includes(clientId)) return { eligible: true, reason: 'allowlisted' }
  const bucket = rolloutBucket(clientId, rollout.id)
  return {
    eligible: bucket < rollout.percent,
    bucket,
    reason: bucket < rollout.percent ? 'rollout-hit' : 'rollout-miss'
  }
}

/** 给清单条目补上本客户端的准入结论（只读派生字段，不落远端） */
function annotateEligibility(entry: RemotePackageEntry, clientId: string): RemotePackageEntry {
  const decision = decideRollout(entry, clientId)
  return {
    ...entry,
    eligible: decision.eligible,
    bucket: decision.bucket,
    eligibleReason: decision.reason
  }
}

/* ------------------------------ 下载与安装 ------------------------------ */

function compareVersionDesc(a: RemotePackageEntry, b: RemotePackageEntry): number {
  return (b.version ?? '').localeCompare(a.version ?? '', undefined, { numeric: true })
}

function describeRolloutBlock(entry: RemotePackageEntry): string {
  const rollout = entry.rollout
  if (!rollout) return ''
  const bits = [`percent=${rollout.percent}`]
  if (typeof entry.bucket === 'number') bits.unshift(`bucket=${entry.bucket}`)
  if (entry.eligibleReason) bits.push(entry.eligibleReason)
  return `（${bits.join(', ')}）`
}

export async function installRemotePackage(
  baseUrl: string,
  packageId: string,
  version?: string,
  opts?: { bypassRollout?: boolean }
): Promise<RemotePackageInstallResult> {
  const index = await fetchRepoIndex(baseUrl)
  const candidates = index.packages.filter(
    (p) => p.packageId === packageId && (version ? p.version === version : true)
  )
  if (candidates.length === 0) {
    throw new Error(`远端仓库里没有 ${packageId}${version ? `@${version}` : ''}`)
  }
  // 二次准入：不能只靠界面过滤；version 只用于选条目，不等于放行
  const pool = opts?.bypassRollout ? candidates : candidates.filter((p) => p.eligible !== false)
  if (pool.length === 0) {
    const blocked = candidates[0]
    throw new Error(
      `灰度未放行：${packageId}${version ? `@${version}` : ''} 当前不对本客户端开放` +
        describeRolloutBlock(blocked)
    )
  }
  const entry = [...pool].sort(compareVersionDesc)[0]
  const archive = await downloadArchive(entry)
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecclaw-pkg-'))
  try {
    const extractDir = path.join(tmpRoot, 'extract')
    fs.mkdirSync(extractDir, { recursive: true })
    const files = extractZip(archive, extractDir)
    const pkgRoot = resolvePackageRoot(extractDir)
    const manifestFile = path.join(pkgRoot, 'manifest.json')
    if (!fs.existsSync(manifestFile)) throw new Error('包内缺少 manifest.json')
    const manifestBytes = fs.readFileSync(manifestFile)
    if (entry.manifestSha256) {
      const actual = crypto.createHash('sha256').update(manifestBytes).digest('hex')
      if (actual !== entry.manifestSha256) {
        throw new Error(`manifest 哈希不匹配（期望 ${entry.manifestSha256}，实际 ${actual}）`)
      }
    }
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as PlatformPackageManifest
    if (manifest.packageId !== entry.packageId) {
      throw new Error(`包内 packageId 不符（期望 ${entry.packageId}，实际 ${manifest.packageId}）`)
    }
    if (entry.version && manifest.version !== entry.version) {
      throw new Error(`包内 version 不符（期望 ${entry.version}，实际 ${manifest.version}）`)
    }

    const channel = entry.channel ?? 'stable'
    const ver = manifest.version ?? entry.version ?? '0.0.0'
    const versionDir = `${channel}-${ver}-${crypto
      .createHash('sha256')
      .update(manifestBytes)
      .digest('hex')
      .slice(0, 8)}`
    const pkgBase = path.join(paths.localPackagesDir(), packageId)
    const targetDir = path.join(pkgBase, versionDir)
    fs.mkdirSync(targetDir, { recursive: true })
    fs.cpSync(pkgRoot, targetDir, { recursive: true, force: true })
    // current.json 指针：{version, channel, dir}
    fs.writeFileSync(
      path.join(pkgBase, 'current.json'),
      `${JSON.stringify({ version: ver, channel, dir: versionDir }, null, 2)}\n`,
      'utf8'
    )
    return { packageId, version: ver, dir: targetDir, files }
  } finally {
    // 只删本会话自己创建的临时目录
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
}

async function downloadArchive(entry: RemotePackageEntry): Promise<Buffer> {
  assertHttpUrl(entry.packageUrl)
  const res = await fetch(entry.packageUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status} ${res.statusText}`)
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared && declared > MAX_ARCHIVE_BYTES) {
    throw new Error(`归档过大（${declared} B > ${MAX_ARCHIVE_BYTES} B）`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.length > MAX_ARCHIVE_BYTES) {
    throw new Error(`归档过大（${buffer.length} B > ${MAX_ARCHIVE_BYTES} B）`)
  }
  if (entry.sha256) {
    const actual = crypto.createHash('sha256').update(buffer).digest('hex')
    if (actual !== entry.sha256) {
      throw new Error(`归档哈希不匹配（期望 ${entry.sha256}，实际 ${actual}）`)
    }
  }
  return buffer
}

/** 解包后可能带一层顶级目录，找到真正的包根 */
function resolvePackageRoot(extractDir: string): string {
  if (fs.existsSync(path.join(extractDir, 'manifest.json'))) return extractDir
  const entries = fs.readdirSync(extractDir, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory())
  for (const dir of dirs) {
    if (fs.existsSync(path.join(extractDir, dir.name, 'manifest.json'))) {
      return path.join(extractDir, dir.name)
    }
  }
  throw new Error('包内找不到 manifest.json')
}

/* ------------------------------ 最小 zip 解析 ------------------------------ */

interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  crc32: number
  localOffset: number
  externalAttrs: number
}

function findEndOfCentralDirectory(buf: Buffer): number {
  const min = Math.max(0, buf.length - 66000)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  throw new Error('不是有效的 zip 归档（找不到 EOCD）')
}

function readZipEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buf)
  const count = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('zip 中央目录损坏')
    entries.push({
      method: buf.readUInt16LE(offset + 10),
      crc32: buf.readUInt32LE(offset + 16),
      compressedSize: buf.readUInt32LE(offset + 20),
      uncompressedSize: buf.readUInt32LE(offset + 24),
      localOffset: buf.readUInt32LE(offset + 42),
      externalAttrs: buf.readUInt32LE(offset + 38),
      name: buf.toString('utf8', offset + 46, offset + 46 + buf.readUInt16LE(offset + 28))
    })
    offset += 46 + buf.readUInt16LE(offset + 28) + buf.readUInt16LE(offset + 30) + buf.readUInt16LE(offset + 32)
  }
  return entries
}

/** 规范化条目名：拒绝绝对路径 / 盘符 / .. / 空字节 */
function normalizeEntryName(raw: string): string[] {
  const name = raw.replace(/\\/g, '/')
  if (name.includes('\0')) throw new Error('包内文件名含空字节')
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) throw new Error(`包内路径非法：${raw}`)
  const parts: string[] = []
  for (const part of name.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') throw new Error(`包内路径非法（含 ..）：${raw}`)
    parts.push(part)
  }
  return parts
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/**
 * 安全解包：防 zip slip、防符号链接、限文件数与体积、逐文件 CRC 校验。
 * 返回解出的文件数。
 */
export function extractZip(buf: Buffer, destDir: string): number {
  const entries = readZipEntries(buf)
  if (entries.length > MAX_FILE_COUNT) throw new Error(`包内文件过多（${entries.length}）`)
  const root = path.resolve(destDir)
  let total = 0
  let files = 0
  for (const entry of entries) {
    const parts = normalizeEntryName(entry.name)
    if (parts.length === 0) continue
    const unixMode = (entry.externalAttrs >>> 16) & 0xf000
    if (unixMode === 0xa000) throw new Error(`包内含符号链接，拒绝解包：${entry.name}`)
    const dest = path.resolve(path.join(root, ...parts))
    if (!dest.startsWith(root + path.sep)) throw new Error(`包内路径越界：${entry.name}`)
    if (entry.uncompressedSize > MAX_FILE_BYTES) {
      throw new Error(`包内单文件过大：${entry.name}`)
    }
    total += entry.uncompressedSize
    if (total > MAX_TOTAL_BYTES) throw new Error('包解开后总体积超限')
    if (entry.localOffset + 30 > buf.length) throw new Error('zip 局部头越界')
    if (buf.readUInt32LE(entry.localOffset) !== 0x04034b50) throw new Error('zip 局部头损坏')
    const nameLen = buf.readUInt16LE(entry.localOffset + 26)
    const extraLen = buf.readUInt16LE(entry.localOffset + 28)
    const dataStart = entry.localOffset + 30 + nameLen + extraLen
    const dataEnd = dataStart + entry.compressedSize
    if (dataEnd > buf.length) throw new Error(`zip 数据越界：${entry.name}`)
    const raw = buf.subarray(dataStart, dataEnd)
    let content: Buffer
    if (entry.method === 0) content = Buffer.from(raw)
    else if (entry.method === 8) content = zlib.inflateRawSync(raw)
    else throw new Error(`不支持的压缩方式（method=${entry.method}）：${entry.name}`)
    if (content.length !== entry.uncompressedSize) {
      throw new Error(`解包后长度不符：${entry.name}`)
    }
    if (crc32(content) !== entry.crc32) throw new Error(`CRC 校验失败：${entry.name}`)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, content)
    files += 1
  }
  return files
}
