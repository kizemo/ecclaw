import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { paths } from './paths'
import type {
  HostEvent,
  HostEventExportFile,
  HostEventExportFormat,
  HostEventExportOptions,
  HostEventExportResult,
  HostEventFilter,
  HostEventLogInfo,
  HostEventSummary,
  HostEventTrend,
  HostEventTrendBucket,
  HostEventTrendPoint
} from '../shared/types'

/**
 * 宿主事件总线 —— 「poll 订阅式持续刷新」的中枢。
 *
 * 为什么要它：
 * dabi 的 poll 观察器是**持续刷新**的（侧栏随页面变化联动），而 ecclaw 早期的 observe
 * 只跑一次就结束。要补上持续刷新，得有一个地方承接「源源不断产生的增量事件」，
 * 并且同时喂给两类消费者：
 * - agent 侧：MCP 工具 `ecclaw_next_event` 长轮询取下一个增量事件（一次调用等一个事件，
 *   不用反复轮询整个状态）；
 * - 界面侧：主进程把事件推给渲染进程，渲染进程**增量**追加到事件流（不整页刷新）。
 *
 * 事件是**增量**的：每条带单调递增的 seq，消费者记住自己的 seq 就能只拿新事件。
 *
 * 第十阶段加了**落盘**（JSONL，按天分文件，进程内仍保留 200 条环形缓冲）：
 * 原来崩了就丢 —— agent 挂了、宿主重启了，前面观察到的数据全没了。
 * 落盘后可以回放：按 seq / 时间 / packageId 把历史事件取回来。
 *
 * 第十一阶段补了两块：
 * - **汇总视图**：落盘数据按「平台包 / 事件类型 / 天」聚合（`summarizeHostEvents`），
 *   agent 不用为了知道「哪个包产了多少事件」而把几千条原始事件拉进上下文。
 * - **保留策略细化**：单文件超过 8MB 滚动到下一个分片（events-DAY.N.jsonl）；
 *   目录总体积超过 256MB 时从最老的一天开始整日删除（原来只有「按天 + 14 天」）。
 *
 * 第十三阶段再补两块：
 * - **压缩归档**：超过保留期的明文 JSONL 不再直接删，改压成 events-DAY.jsonl.gz。
 *   明文留 14 天 → 压缩归档 → 归档留 90 天才删。JSONL 压缩率通常 8~12 倍，
 *   于是同样 256MB 配额能装下原来两三倍的历史。
 * - **时间序列趋势**：汇总里多一条 trend（按小时/按天分桶，带环比与峰值）。
 *   「今天比昨天多了多少」「峰值在哪个小时」这类问题以前只能自己拉明细数。
 */

const MAX_EVENTS = 200

/** 明文落盘保留的天数：超过就压缩归档（不再直接删除） */
const RETAIN_DAYS = 14
/** 压缩归档保留的天数：超过才删除 */
const ARCHIVE_DAYS = 90
/** 单个落盘文件最大体积：超出就滚动到下一个分片（events-DAY.1.jsonl） */
const MAX_FILE_BYTES = 8 * 1024 * 1024
/** 落盘目录总体积上限：超出时从最老的一天开始整日删除 */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024
/** 每写多少条检查一次总体积上限 */
const TRIM_CHECK_EVERY = 200

/** 距离上次检查总体积过了多少条 */
let writesSinceTrim = 0

/** 上一次写入的日期（跨天时触发归档压缩） */
let lastLogDay = ''

const events: HostEvent[] = []
let seq = 0

interface Waiter {
  sinceSeq: number
  resolve: (event: HostEvent | null) => void
  timer: NodeJS.Timeout
}

const waiters: Waiter[] = []

/**
 * 事件推送通道。
 * 渲染进程（IPC）与宿主桥（SSE 主动推送）都要订阅同一路事件，
 * 所以这里是订阅者集合而不是单槽 —— 第十三阶段加 SSE 之后订阅者就有两拨了。
 */
type Emitter = (event: HostEvent) => void
const emitters = new Set<Emitter>()

/** 订阅增量事件，返回退订函数 */
export function subscribeHostEvents(fn: Emitter): () => void {
  emitters.add(fn)
  return () => {
    emitters.delete(fn)
  }
}

/** 设置唯一订阅者（兼容旧调用；会顶掉已有订阅） */
export function setHostEventEmitter(fn: Emitter | null): void {
  emitters.clear()
  if (fn) emitters.add(fn)
}

/* ------------------------------------------------------------------
 * 落盘（JSONL，按天分文件）
 * ------------------------------------------------------------------ */

/** 落盘文件名：events-2026-11-02.jsonl / events-2026-11-02.1.jsonl（分片）/ 末尾 .gz（压缩归档） */
const LOG_FILE_RE = /^events-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.jsonl(\.gz)?$/

/** 一个落盘文件（day = 日期，part = 分片序号，0 = 当天第一个文件；gz = 已压缩归档） */
interface LogFile {
  day: string
  part: number
  file: string
  /** true = 压缩归档（.gz） */
  gz: boolean
}

/** 事件日志目录 */
function logDir(): string {
  return path.join(paths.userData(), 'host-events')
}

/** 当天第 part 个分片的路径（part=0 是 events-DAY.jsonl） */
function logFile(day: string, part = 0): string {
  const name = part > 0 ? `events-${day}.${part}.jsonl` : `events-${day}.jsonl`
  return path.join(logDir(), name)
}

function dayOf(iso: string): string {
  return iso.slice(0, 10)
}

/** 按天 + 分片序号排序列出所有落盘文件 */
function listLogFiles(): LogFile[] {
  let names: string[]
  try {
    if (!fs.existsSync(logDir())) return []
    names = fs.readdirSync(logDir())
  } catch {
    return []
  }
  const out: LogFile[] = []
  for (const name of names) {
    const m = LOG_FILE_RE.exec(name)
    if (!m) continue
    out.push({
      day: m[1],
      part: m[2] ? Number(m[2]) : 0,
      file: path.join(logDir(), name),
      gz: Boolean(m[3])
    })
  }
  out.sort((a, b) => (a.day === b.day ? a.part - b.part : a.day < b.day ? -1 : 1))
  return out
}

/** 读一个落盘文件的内容（.gz 先解压） */
function readLog(file: string, gz: boolean): string {
  const raw = fs.readFileSync(file)
  return gz ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8')
}

/**
 * 把一个明文分片压缩成 .gz 归档。
 * 先写归档、确认写成了，再删明文 —— 中途失败就保持原样，宁可多占点磁盘也不能丢数据。
 */
function compressLogFile(f: LogFile): boolean {
  try {
    const raw = fs.readFileSync(f.file)
    const gz = zlib.gzipSync(raw)
    const target = `${f.file}.gz`
    fs.writeFileSync(target, gz)
    if (fs.statSync(target).size === 0 && raw.length > 0) return false
    fs.unlinkSync(f.file)
    return true
  } catch {
    return false
  }
}

/** 把「已经不是今天」的明文分片全部压成归档（当天那个还在写，不能动） */
function compressOldLogs(): number {
  const today = dayOf(new Date().toISOString())
  let n = 0
  try {
    for (const f of listLogFiles()) {
      if (f.gz || f.day >= today) continue
      if (compressLogFile(f)) n += 1
    }
  } catch {
    /* 忽略清理失败 */
  }
  return n
}

function fileBytes(file: string): number {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

/**
 * 追加一条事件到当天的 JSONL。
 * 当天最后一个分片超过 MAX_FILE_BYTES 就新开一个分片（events-DAY.1.jsonl、.2.jsonl…）。
 * 写失败不影响主流程（事件总线是内存优先的，落盘只是补历史）。
 */
function appendToDisk(event: HostEvent): void {
  try {
    fs.mkdirSync(logDir(), { recursive: true })
    const day = dayOf(event.at)
    const line = `${JSON.stringify(event)}\n`
    const files = listLogFiles().filter((f) => f.day === day)
    let target = files.length > 0 ? files[files.length - 1] : { day, part: 0, file: logFile(day, 0) }
    if (fileBytes(target.file) + Buffer.byteLength(line) > MAX_FILE_BYTES) {
      target = { day, part: target.part + 1, file: logFile(day, target.part + 1) }
    }
    fs.appendFileSync(target.file, line, 'utf8')
    // 跨天了：把前几天的明文压成归档（当天那个还在写，不能动）
    if (day !== lastLogDay) {
      lastLogDay = day
      compressOldLogs()
    }
    writesSinceTrim += 1
    if (writesSinceTrim >= TRIM_CHECK_EVERY) {
      writesSinceTrim = 0
      compressOldLogs()
      trimToSize()
    }
  } catch {
    /* 落盘失败不阻塞事件流 */
  }
}

/** 目录总体积超上限 → 从最老的一天开始整日删 */
function trimToSize(): void {
  try {
    const files = listLogFiles()
    let bytes = files.reduce((sum, f) => sum + fileBytes(f.file), 0)
    if (bytes <= MAX_TOTAL_BYTES) return
    const days = [...new Set(files.map((f) => f.day))].sort()
    for (const day of days) {
      if (bytes <= MAX_TOTAL_BYTES) break
      for (const f of files.filter((x) => x.day === day)) {
        bytes -= fileBytes(f.file)
        try {
          fs.unlinkSync(f.file)
        } catch {
          /* 忽略删除失败 */
        }
      }
    }
  } catch {
    /* 忽略清理失败 */
  }
}

/**
 * 保留策略（第十三阶段改为「先归档、后删除」）：
 * - 明文（.jsonl）超过 RETAIN_DAYS 天 → 压缩成 .gz 归档，**不删** —— 历史不该凭空消失
 * - 归档（.gz）超过 ARCHIVE_DAYS 天 → 才删除
 * - 目录总体积超上限 → 从最老的一天开始整日删（trimToSize）
 */
function sweepDisk(): void {
  try {
    if (!fs.existsSync(logDir())) return
    const plainCutoff = Date.now() - RETAIN_DAYS * 24 * 3600_000
    const archiveCutoff = Date.now() - ARCHIVE_DAYS * 24 * 3600_000
    for (const f of listLogFiles()) {
      const day = Date.parse(`${f.day}T00:00:00Z`)
      if (!Number.isFinite(day)) continue
      if (f.gz) {
        if (day < archiveCutoff) {
          try {
            fs.unlinkSync(f.file)
          } catch {
            /* 忽略删除失败 */
          }
        }
        continue
      }
      if (day < plainCutoff) compressLogFile(f)
    }
    trimToSize()
  } catch {
    /* 忽略清理失败 */
  }
}

/**
 * 逐条扫盘（回放与汇总共用同一套过滤语义）。
 * 第十四阶段起**必须扫完整个目录**：seq 曾经有多个空间（Electron 重启归零的历史遗留），
 * 文件顺序 ≠ seq 顺序，「扫到 N 条就停」会漏掉 seq 更小的那批。
 * 排序交给调用方（SeqSelector：内存有界地挑出 seq 最小的前 N 条）。
 */
function scanDiskEvents(filter: HostEventFilter, onEvent: (event: HostEvent) => void): void {
  const sinceSeq = filter.sinceSeq ?? 0
  const untilSeq = filter.untilSeq ?? Number.MAX_SAFE_INTEGER
  const sinceAt = filter.sinceAt ? Date.parse(filter.sinceAt) : Number.NEGATIVE_INFINITY
  const untilAt = filter.untilAt ? Date.parse(filter.untilAt) : Number.POSITIVE_INFINITY
  // kind 过滤：给了 kinds（多选）就以它为准，否则退回单选的 kind；都没给 = 不限。
  const kindFilter =
    filter.kinds && filter.kinds.length > 0
      ? filter.kinds
      : filter.kind
        ? [filter.kind]
        : undefined
  for (const f of listLogFiles()) {
    let raw: string
    try {
      raw = readLog(f.file, f.gz)
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let event: HostEvent
      try {
        event = JSON.parse(line) as HostEvent
      } catch {
        continue
      }
      if (event.seq <= sinceSeq || event.seq > untilSeq) continue
      const at = Date.parse(event.at)
      if (Number.isFinite(at) && (at < sinceAt || at > untilAt)) continue
      if (filter.packageId && event.packageId !== filter.packageId) continue
      if (filter.pageId && event.pageId !== filter.pageId) continue
      if (kindFilter && !kindFilter.includes(event.kind)) continue
      onEvent(event)
    }
  }
}

/**
 * seq 最小的前 N 条选择器（大根堆）。
 *
 * 为什么不能「扫到 N 条就停」：落盘里的 seq 曾经有多个空间（重启归零的历史遗留），
 * 文件顺序 ≠ seq 顺序 —— 按文件序截断会漏掉 seq 更小的那批，agent 拿 seq 当游标就会漏事件。
 * 为什么不能「全存进内存再排序」：目录上限 256MB，最坏有一百万条，内存扛不住。
 * → 用堆只留最小的 N 条：内存有界（O(N)），时间 O(总数 × log N)。
 */
class SeqSelector {
  private heap: HostEvent[] = []
  private readonly limit: number

  constructor(limit: number) {
    this.limit = Math.max(limit, 1)
  }

  /** 投一条候选 */
  offer(event: HostEvent): void {
    if (this.heap.length < this.limit) {
      this.heap.push(event)
      this.siftUp(this.heap.length - 1)
      return
    }
    if (event.seq >= this.heap[0].seq) return
    this.heap[0] = event
    this.siftDown(0)
  }

  /** 取结果（按 seq 升序） */
  result(): HostEvent[] {
    return [...this.heap].sort((a, b) => a.seq - b.seq)
  }

  private siftUp(index: number): void {
    let i = index
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.heap[parent].seq >= this.heap[i].seq) break
      this.swap(parent, i)
      i = parent
    }
  }

  private siftDown(index: number): void {
    let i = index
    const n = this.heap.length
    for (;;) {
      const left = i * 2 + 1
      const right = left + 1
      let largest = i
      if (left < n && this.heap[left].seq > this.heap[largest].seq) largest = left
      if (right < n && this.heap[right].seq > this.heap[largest].seq) largest = right
      if (largest === i) break
      this.swap(i, largest)
      i = largest
    }
  }

  private swap(a: number, b: number): void {
    const tmp = this.heap[a]
    this.heap[a] = this.heap[b]
    this.heap[b] = tmp
  }
}

/**
 * 回放历史事件。
 * 过滤条件都是可选的：sinceSeq / untilSeq / sinceAt / untilAt / packageId / pageId / kind。
 * 结果**按 seq 升序**返回（最多 limit 条，默认 200、上限 2000）。
 *
 * 第十四阶段修正：以前是「按文件顺序返回」，与「按 seq 升序」的注释不符 ——
 * 落盘里存在多个 seq 空间时，agent 拿「返回列表最后一条的 seq」当游标会踩坑。
 */
export function replayHostEvents(filter: HostEventFilter & { limit?: number }): HostEvent[] {
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 2000)
  const selector = new SeqSelector(limit)
  scanDiskEvents(filter, (event) => {
    selector.offer(event)
  })
  return selector.result()
}

/**
 * 事件汇总（第十一阶段）：按「平台包 / 事件类型 / 天」聚合。
 *
 * 为什么需要它：agent 想回答「哪个平台包产了多少事件、覆盖了哪几天」时，
 * 用 `ecclaw_event_replay` 得把几千条原始事件拉进上下文 —— 又贵又占窗口。
 * 汇总直接给聚合结果，原始事件留给需要细节时再回放。
 *
 * 第十三阶段加了 **trend**：按小时/按天分桶的时间序列，带环比与峰值。
 * 「今天比昨天多了多少」「峰值在哪个小时」这类问题不用再自己拉明细数。
 */
export function summarizeHostEvents(
  filter: HostEventFilter = {},
  options: { bucket?: HostEventTrendBucket } = {}
): HostEventSummary {
  const byPackage = new Map<
    string,
    {
      packageId: string
      count: number
      firstSeq: number
      lastSeq: number
      firstAt: string
      lastAt: string
      kinds: Record<string, number>
    }
  >()
  const byKind: Record<string, number> = {}
  const byDay = new Map<string, number>()
  const days = new Set<string>()
  const bucketCounts = new Map<string, number>()
  const bucketStarts = new Map<string, string>()
  const bucket: HostEventTrendBucket = options.bucket === 'hour' ? 'hour' : 'day'
  let total = 0
  let firstAt: string | undefined
  let lastAt: string | undefined

  scanDiskEvents(filter, (event) => {
    total += 1
    const day = dayOf(event.at)
    days.add(day)
    byDay.set(day, (byDay.get(day) ?? 0) + 1)
    byKind[event.kind] = (byKind[event.kind] ?? 0) + 1
    const b = bucketOf(event.at, bucket)
    bucketCounts.set(b.key, (bucketCounts.get(b.key) ?? 0) + 1)
    bucketStarts.set(b.key, b.start)

    const pkgId = event.packageId ?? '(无平台包)'
    const cur = byPackage.get(pkgId) ?? {
      packageId: pkgId,
      count: 0,
      firstSeq: event.seq,
      lastSeq: event.seq,
      firstAt: event.at,
      lastAt: event.at,
      kinds: {}
    }
    cur.count += 1
    cur.firstSeq = Math.min(cur.firstSeq, event.seq)
    cur.lastSeq = Math.max(cur.lastSeq, event.seq)
    cur.kinds[event.kind] = (cur.kinds[event.kind] ?? 0) + 1
    if (event.at < cur.firstAt) cur.firstAt = event.at
    if (event.at > cur.lastAt) cur.lastAt = event.at
    byPackage.set(pkgId, cur)

    if (!firstAt || event.at < firstAt) firstAt = event.at
    if (!lastAt || event.at > lastAt) lastAt = event.at
  })

  return {
    dir: logDir(),
    total,
    days: [...days].sort(),
    byPackage: [...byPackage.values()].sort((a, b) => b.count - a.count),
    byKind,
    byDay: [...byDay.entries()]
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => (a.day < b.day ? -1 : 1)),
    trend: buildTrend(bucket, bucketCounts, bucketStarts),
    firstAt,
    lastAt
  }
}

/* ------------------------------------------------------------------
 * 时间序列趋势（第十三阶段）
 * ------------------------------------------------------------------ */

/** 补空桶后的点最多多少个（跨度太大就只保留有数据的桶，避免一次汇总吐出几百个点） */
const MAX_TREND_POINTS = 500

/** 一个事件落在哪个桶（桶键 + 桶起点 ISO） */
function bucketOf(at: string, bucket: HostEventTrendBucket): { key: string; start: string } {
  if (bucket === 'hour') {
    const key = at.slice(0, 13)
    return { key, start: `${key}:00:00.000Z` }
  }
  const key = at.slice(0, 10)
  return { key, start: `${key}T00:00:00.000Z` }
}

/** 桶起点 → 桶键（与 bucketOf 的键口径一致） */
function bucketKeyOf(start: string, bucket: HostEventTrendBucket): string {
  return bucket === 'hour' ? start.slice(0, 13) : start.slice(0, 10)
}

/** 下一个桶的起点 */
function nextBucketStart(start: string, bucket: HostEventTrendBucket): string {
  const d = new Date(start)
  if (bucket === 'hour') d.setUTCHours(d.getUTCHours() + 1)
  else d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

/** 首末桶之间一共多少个桶 */
function bucketSpan(first: string, last: string, bucket: HostEventTrendBucket): number {
  const unit = bucket === 'hour' ? 3_600_000 : 86_400_000
  return Math.floor((Date.parse(last) - Date.parse(first)) / unit) + 1
}

/**
 * 组装时间序列：补空桶 → 算环比 → 找峰值。
 *
 * 补空桶是必须的：没有数据的时段如果直接跳过，「环比」就成了「跟上一个有数据的时段比」，
 * 数字看着像环比，其实不是同一个口径。空桶补 0 之后环比才是真的逐桶比。
 */
function buildTrend(
  bucket: HostEventTrendBucket,
  counts: Map<string, number>,
  starts: Map<string, string>
): HostEventTrend {
  const keys = [...counts.keys()].sort()
  if (keys.length === 0) return { bucket, points: [], peak: null, overallDeltaPct: null }

  const first = starts.get(keys[0]) as string
  const last = starts.get(keys[keys.length - 1]) as string
  const points: HostEventTrendPoint[] = []
  if (bucketSpan(first, last, bucket) <= MAX_TREND_POINTS) {
    for (let cursor = first; cursor <= last; cursor = nextBucketStart(cursor, bucket)) {
      points.push({ start: cursor, count: counts.get(bucketKeyOf(cursor, bucket)) ?? 0, delta: null, deltaPct: null })
    }
  } else {
    // 跨度太大（按小时分桶时很常见）：只保留有数据的桶
    for (const key of keys) {
      points.push({ start: starts.get(key) as string, count: counts.get(key) ?? 0, delta: null, deltaPct: null })
    }
  }

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    cur.delta = cur.count - prev.count
    cur.deltaPct = prev.count > 0 ? Math.round(((cur.count - prev.count) / prev.count) * 1000) / 10 : null
  }

  let peak: HostEventTrendPoint | null = null
  for (const p of points) {
    if (!peak || p.count > peak.count) peak = p
  }

  const firstPoint = points[0]
  const lastPoint = points[points.length - 1]
  const overallDeltaPct =
    firstPoint.count > 0
      ? Math.round(((lastPoint.count - firstPoint.count) / firstPoint.count) * 1000) / 10
      : null

  return {
    bucket,
    points,
    peak: peak ? { start: peak.start, count: peak.count } : null,
    overallDeltaPct
  }
}

/** 落盘日志概况（界面显示用） */
export function hostEventLogInfo(): HostEventLogInfo {
  let days: string[] = []
  let total = 0
  let bytes = 0
  let plainFiles = 0
  let archivedFiles = 0
  try {
    const files = listLogFiles()
    days = [...new Set(files.map((f) => f.day))].sort()
    for (const f of files) {
      bytes += fileBytes(f.file)
      if (f.gz) archivedFiles += 1
      else plainFiles += 1
      try {
        const raw = readLog(f.file, f.gz)
        total += raw.split('\n').filter((l) => l.trim()).length
      } catch {
        /* 忽略 */
      }
    }
  } catch {
    /* 忽略 */
  }
  return {
    dir: logDir(),
    days,
    total,
    bytes,
    plainFiles,
    archivedFiles,
    retention: {
      retainDays: RETAIN_DAYS,
      archiveDays: ARCHIVE_DAYS,
      maxFileBytes: MAX_FILE_BYTES,
      maxTotalBytes: MAX_TOTAL_BYTES
    }
  }
}

/* ------------------------------------------------------------------
 * 事件导出（第十二阶段）
 *
 * 为什么需要：回放是给 agent 用的（拉进上下文），汇总也是给 agent 用的。
 * 但用户自己也常要「把某段时间的观察记录拿走」—— 发给同事、存档、贴进工单。
 * 之前只有落盘的 JSONL，用户得自己去 <userData>/host-events/ 里翻文件，
 * 还得自己按天拼。导出接口把这件事收成一次调用。
 * ------------------------------------------------------------------ */

/** 单次导出最多多少条（防止一次导出把内存和磁盘吃满） */
const MAX_EXPORT_EVENTS = 50_000

/** 导出目录：<userData>/host-events/exports */
function exportDir(): string {
  return path.join(logDir(), 'exports')
}

/** CSV 字段转义（RFC 4180：含逗号/引号/换行就整体加引号，内部引号翻倍） */
function csvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

/** 时间戳文件名后缀：20261102-123456 */
function exportStamp(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}

/** 事件 kind 的文件名安全形式（只允许小写字母、数字、连字符） */
const EXPORT_KIND_RE = /^[a-z0-9-]{1,32}$/

/**
 * 生成一个不撞名的导出文件路径。
 *
 * 为什么要去重：文件名里的时间戳只精确到秒，同一秒内导出两次会撞名 ——
 * 后一次会**覆盖**前一次，等于把用户的一份产物弄没了（红线：禁删用户文件）。
 * 撞了就加 -2 / -3 后缀，宁可名字难看也不覆盖。
 */
function uniqueExportPath(dir: string, stem: string, format: HostEventExportFormat): string {
  for (let n = 1; n <= 999; n++) {
    const name = n === 1 ? `${stem}.${format}` : `${stem}-${n}.${format}`
    const file = path.join(dir, name)
    if (!fs.existsSync(file)) return file
  }
  return path.join(dir, `${stem}-${Date.now()}.${format}`)
}

/** 把一组事件渲染成导出文本（jsonl 或 csv） */
function renderEvents(events: HostEvent[], format: HostEventExportFormat): string {
  const lines: string[] = []
  if (format === 'csv') {
    lines.push('seq,at,kind,packageId,pageId,observationId,value')
    for (const e of events) {
      lines.push(
        [
          String(e.seq),
          e.at,
          e.kind,
          csvCell(e.packageId ?? ''),
          csvCell(e.pageId ?? ''),
          csvCell(e.observationId ?? ''),
          // value 统一存 JSON 文本：类型信息不丢，读 CSV 时还能再 JSON.parse
          csvCell(e.value === undefined ? '' : JSON.stringify(e.value))
        ].join(',')
      )
    }
  } else {
    for (const e of events) lines.push(JSON.stringify(e))
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

/**
 * 导出已落盘的事件到文件（jsonl / csv）。
 *
 * 过滤语义与回放、汇总**完全一致**（共用 scanDiskEvents）——
 * 不会出现「回放能筛、汇总能筛、导出不能筛」的语义漂移。
 *
 * 第十七阶段加了两件事：
 * - `options.kinds`：只要其中几类事件（多选过滤）；
 * - `options.splitByKind`：每类一个文件（observe / approval / page 各一份），
 *   文件名带 kind 前缀，导出物清单里一眼能看出是哪种。
 *
 * 导出物放在 host-events/exports/ 子目录：目录名不匹配 LOG_FILE_RE，
 * 所以 sweepDisk（超期清理）与 trimToSize（体积淘汰）都不会碰它 ——
 * 导出是用户主动产物，不能被自动淘汰策略删掉。
 * 反过来也不自动删导出物（红线：禁止删除用户文件），由用户自己清。
 */
export function exportHostEvents(
  filter: HostEventFilter = {},
  options: HostEventExportOptions = {}
): HostEventExportResult {
  const format: HostEventExportFormat = options.format === 'csv' ? 'csv' : 'jsonl'
  const dir = exportDir()
  fs.mkdirSync(dir, { recursive: true })

  // 第十四阶段：导出也按 seq 升序（与回放一致）。
  // 用 SeqSelector 保证「取的是 seq 最小的前 5 万条」，而不是文件顺序的前 5 万条。
  const selector = new SeqSelector(MAX_EXPORT_EVENTS)
  let matched = 0
  scanDiskEvents(filter, (event) => {
    matched += 1
    selector.offer(event)
  })
  const events = selector.result()
  const truncated = matched > MAX_EXPORT_EVENTS

  // 按 kind 分组（拆分导出用；不拆分时这个 Map 只用来统计 kinds）
  const groups = new Map<string, HostEvent[]>()
  for (const e of events) {
    const list = groups.get(e.kind) ?? []
    list.push(e)
    groups.set(e.kind, list)
  }

  const stamp = exportStamp()
  const files: HostEventExportFile[] = []
  let totalBytes = 0

  const writeGroup = (kind: string | undefined, list: HostEvent[]): void => {
    const text = renderEvents(list, format)
    // kind 放在时间戳前面：文件名里 kind 一眼可见，正则也能稳定解析出来
    const safeKind = kind && EXPORT_KIND_RE.test(kind) ? kind : undefined
    const stem = safeKind ? `ecclaw-events-${safeKind}-${stamp}` : `ecclaw-events-${stamp}`
    const file = uniqueExportPath(dir, stem, format)
    fs.writeFileSync(file, text, 'utf8')
    const bytes = Buffer.byteLength(text)
    totalBytes += bytes
    files.push({
      name: path.basename(file),
      file,
      bytes,
      modifiedAt: new Date().toISOString(),
      kind: safeKind as HostEventExportFile['kind']
    })
  }

  if (options.splitByKind) {
    for (const kind of [...groups.keys()].sort()) {
      writeGroup(kind, groups.get(kind) as HostEvent[])
    }
  } else {
    writeGroup(undefined, events)
  }

  return {
    file: files[0]?.file ?? '',
    count: events.length,
    bytes: totalBytes,
    format,
    truncated,
    dir,
    files,
    kinds: [...groups.keys()].sort(),
    split: Boolean(options.splitByKind)
  }
}

/**
 * 推一条增量事件。
 * 返回带 seq / at 的完整事件；消费方（长轮询等待者 + 渲染进程）立刻收到。
 */
export function pushHostEvent(input: {
  kind: HostEvent['kind']
  packageId?: string
  pageId?: string
  observationId?: string
  value?: unknown
}): HostEvent {
  const event: HostEvent = {
    seq: ++seq,
    kind: input.kind,
    packageId: input.packageId,
    pageId: input.pageId,
    observationId: input.observationId,
    value: input.value,
    at: new Date().toISOString()
  }
  events.push(event)
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS)
  }
  appendToDisk(event)
  for (const emit of [...emitters]) {
    try {
      emit(event)
    } catch {
      /* 订阅者不可用时忽略 */
    }
  }
  // 唤醒所有「等的是新事件」的等待者（订阅语义：每个订阅者都拿到这一条）
  for (const waiter of [...waiters]) {
    if (waiter.sinceSeq >= event.seq) continue
    const index = waiters.indexOf(waiter)
    if (index >= 0) waiters.splice(index, 1)
    clearTimeout(waiter.timer)
    waiter.resolve(event)
  }
  return event
}

/** 列出 seq 大于 sinceSeq 的事件（增量拉取） */
export function listHostEvents(sinceSeq = 0): HostEvent[] {
  return events.filter((e) => e.seq > sinceSeq)
}

/** 当前最大 seq（消费者记下来，下次只要新的） */
export function latestHostEventSeq(): number {
  return seq
}

/**
 * 长轮询：等下一个增量事件。
 * 已有事件立刻返回；没有就挂到 timeoutMs（调用方必须保证 < MCP 的 60s 硬超时）。
 * 超时返回 null（不是错误 —— 订阅者可以继续等下一轮）。
 */
export function waitHostEvent(sinceSeq: number, timeoutMs: number): Promise<HostEvent | null> {
  const existing = events.find((e) => e.seq > sinceSeq)
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve) => {
    const waiter: Waiter = {
      sinceSeq,
      resolve,
      timer: setTimeout(() => {
        const index = waiters.indexOf(waiter)
        if (index >= 0) waiters.splice(index, 1)
        resolve(null)
      }, Math.max(0, timeoutMs))
    }
    waiters.push(waiter)
  })
}

/** 清空事件（测试 / 重新订阅时用） */
export function clearHostEvents(): void {
  events.length = 0
}

/**
 * 扫盘找历史最大 seq（启动时续号用）。
 *
 * 背景（第十四阶段修的真缺陷）：`seq` 原来是**运行时计数器**，Electron 重启就归零
 * → 落盘里存在**多个 seq 空间**：同一个文件里可能先写 1..N（重启前）再写 1..M（重启后），
 * seq 非单调。于是：
 * - `ecclaw_event_replay({sinceSeq})` 的区间过滤跨文件不可靠；
 * - agent 拿 seq 当游标跨重启会漏事件或重放。
 *
 * 修法：启动时把计数器续到**落盘最大值之后**，新事件继续往上走 → seq 全局单调。
 * （旧日志里已存在的多个 seq 空间保持原样 —— 不改写历史文件；新事件一律大于所有历史 seq。）
 */
function maxSeqOnDisk(): number {
  let max = 0
  for (const f of listLogFiles()) {
    let raw: string
    try {
      raw = readLog(f.file, f.gz)
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      // 落盘行首就是 {"seq":N,...}（pushHostEvent 里 seq 是第一个字段）→ 直接取，省一次 JSON.parse
      const m = /^\{"seq":(\d+)/.exec(line)
      if (m) {
        const v = Number(m[1])
        if (Number.isFinite(v) && v > max) max = v
        continue
      }
      try {
        const parsed = JSON.parse(line) as { seq?: unknown }
        const v = Number(parsed.seq)
        if (Number.isFinite(v) && v > max) max = v
      } catch {
        /* 不是合法 JSON 行，跳过 */
      }
    }
  }
  return max
}

/** 启动时清一次过期日志（并把历史明文压成归档） */
export function initHostEventLog(): void {
  sweepDisk()
  compressOldLogs()
  // 续号：让 seq 在重启后继续往上走（全局单调），否则落盘里会出现多个 seq 空间
  seq = Math.max(seq, maxSeqOnDisk())
}

/* ------------------------------------------------------------------
 * 导出物清单与清理（第十四阶段）
 *
 * 红线：导出物是**用户主动产物**，程序绝不自动删（既不被 sweepDisk/trimToSize 碰，
 * 也不在启动时清理）。这里只提供「用户明确点删除时才删这一个文件」的口子。
 * ------------------------------------------------------------------ */

/**
 * 导出物文件名（只认自己生成的这一种）：
 *   ecclaw-events-YYYYMMDD-HHMMSS.jsonl|csv              —— 单文件导出（历史命名，一字不变）
 *   ecclaw-events-<kind>-YYYYMMDD-HHMMSS.jsonl|csv       —— 按 kind 拆分导出（第十七阶段）
 *   末尾可跟 -N（同一秒内重复导出的去重后缀）
 */
const EXPORT_FILE_RE = /^ecclaw-events-(?:([a-z0-9-]{1,32})-)?(\d{8})-(\d{6})(?:-\d{1,3})?\.(jsonl|csv)$/

/** 导出目录（给上层拼 {dir, files} 载荷用；agent 侧要看到落在哪儿） */
export function hostEventExportDir(): string {
  return exportDir()
}

/** 列出导出物（按修改时间倒序，最近的在前） */
export function listHostEventExports(): HostEventExportFile[] {
  const out: HostEventExportFile[] = []
  try {
    if (!fs.existsSync(exportDir())) return out
    for (const name of fs.readdirSync(exportDir())) {
      const m = EXPORT_FILE_RE.exec(name)
      if (!m) continue
      const file = path.join(exportDir(), name)
      try {
        const st = fs.statSync(file)
        if (!st.isFile()) continue
        // 拆分产物的文件名里带 kind 前缀 → 清单里标出来，单文件导出没有 kind
        out.push({
          name,
          file,
          bytes: st.size,
          modifiedAt: st.mtime.toISOString(),
          kind: m[1] as HostEventExportFile['kind']
        })
      } catch {
        /* 忽略读不到的文件 */
      }
    }
  } catch {
    /* 忽略 */
  }
  out.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : 0))
  return out
}

/**
 * 删除一个导出物（**精确文件名**）。
 *
 * 禁止通配符 / 批量：只接受 EXPORT_FILE_RE 认得的那个文件名，
 * 且解析后的路径必须仍在导出目录里（双保险，防目录穿越）。
 * 调用方必须来自用户明确的一次点击（界面二次确认）。
 */
export function removeHostEventExport(name: string): boolean {
  const target = String(name ?? '').trim()
  if (!target || !EXPORT_FILE_RE.test(target)) return false
  const dir = path.resolve(exportDir())
  const file = path.resolve(path.join(dir, target))
  if (path.dirname(file) !== dir) return false
  try {
    if (!fs.existsSync(file)) return false
    fs.unlinkSync(file)
    return true
  } catch {
    return false
  }
}
