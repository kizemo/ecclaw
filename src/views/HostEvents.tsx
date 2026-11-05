import { useEffect, useState, type JSX } from 'react'
import {
  api,
  type ApprovalEventValue,
  type HostEvent,
  type HostEventKind,
  type HostEventExportFile,
  type HostEventExportFormat,
  type HostEventExportResult,
  type HostEventLogInfo,
  type HostEventSummary,
  type HostEventTrendBucket,
  type HostEventTrendPoint,
  type HostWatch
} from '../api'

/**
 * 宿主事件面板 —— 「poll 订阅式持续刷新」的界面侧。
 *
 * 持续观察（watch）启动后，包里的 poll 观察器按 intervalMs 循环产出增量事件；
 * 主进程把事件推给这里，界面**增量追加**（不整页刷新、不定时轮询）。
 * 同一批事件也能被 agent 用 ecclaw_next_event 长轮询取走。
 */

/** 事件流最多保留最近几条 */
const EVENT_LIMIT = 60

/** 字节数人类可读 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 导出物归类方式（第十九阶段） */
type ExportGroupBy = 'none' | 'date' | 'kind'

/**
 * 导出物的日期分组键。
 *
 * 优先取文件名里的日期（`ecclaw-events-[-kind-]YYYYMMDD-HHMMSS.ext`）——
 * 那是导出发生的**本地日历日**（主进程 exportStamp 用本地时间拼的），
 * 比「文件最后修改时间」更贴近「哪天导出的」这个语义；
 * 文件名认不出来时才退回 modifiedAt。
 */
function exportDateKey(f: HostEventExportFile): string {
  const m = /(\d{8})-\d{6}/.exec(f.name)
  if (m) {
    const d = m[1]
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
  }
  const dt = new Date(f.modifiedAt)
  if (Number.isNaN(dt.getTime())) return '未知日期'
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

/** 导出物的类型分组键：拆分产物有 kind，单文件导出（混着多种）归「混合」 */
function exportKindKey(f: HostEventExportFile): string {
  return f.kind ?? 'mixed'
}

/** 类型分组的中文名 */
function exportKindLabel(key: string): string {
  if (key === 'mixed') return '混合（未拆分）'
  return KIND_TEXT[key] ?? key
}

/**
 * 导出物清单里的一行（平铺与分组两种视图共用同一份 DOM 结构）。
 *
 * 删除按钮的 testid `export-remove-{文件名}` 在两种视图下一字不变 —— 归类只是摆放方式变了，
 * 不能让「用户点哪个文件删哪个」这件事跟着视图变。
 */
function ExportFileRow({
  f,
  pendingDelete,
  onDelete,
  onCancel
}: {
  f: HostEventExportFile
  pendingDelete: string | null
  onDelete: (name: string) => void
  onCancel: () => void
}): JSX.Element {
  return (
    <li>
      <strong>{f.name}</strong>
      {f.kind ? <span className="tag">{KIND_TEXT[f.kind] ?? f.kind}</span> : null}
      <span className="tag">{formatBytes(f.bytes)}</span>
      <p>{new Date(f.modifiedAt).toLocaleString()}</p>
      <button
        className="ghost"
        data-testid={`export-remove-${f.name}`}
        onClick={() => onDelete(f.name)}
      >
        {pendingDelete === f.name ? '确认删除？' : '删除'}
      </button>
      {pendingDelete === f.name ? (
        <button className="ghost" onClick={onCancel}>
          取消
        </button>
      ) : null}
    </li>
  )
}

function summarize(event: HostEvent): string {
  const value = event.value
  if (event.kind === 'approval') return summarizeApproval(value)
  if (event.kind === 'page') return summarizePage(value)
  if (value === null || value === undefined) return '（空）'
  if (typeof value === 'string') return value.slice(0, 120)
  if (typeof value === 'object') {
    const err = (value as Record<string, unknown>).error
    if (typeof err === 'string') return `错误：${err}`
    return JSON.stringify(value).slice(0, 160)
  }
  return String(value)
}

/** 写操作事件的阶段文案 */
const APPROVAL_STAGE_TEXT: Record<string, string> = {
  requested: '已请求确认',
  executed: '已执行',
  rejected: '用户拒绝',
  timeout: '确认超时（未执行）',
  failed: '执行失败'
}

/** 放行来源文案 */
const APPROVAL_VIA_TEXT: Record<string, string> = {
  user: '用户放行',
  'site-trust': '站点信任放行',
  'guard-allow': '策略放行',
  ui: '界面直接触发'
}

/** 信任范围文案 */
const APPROVAL_SCOPE_TEXT: Record<string, string> = {
  once: '仅本次',
  session: '本次会话',
  persistent: '永久信任',
  'persistent-scroll': '永久信任（只放行滚动）',
  'persistent-path': '永久信任（当前路径）'
}

/**
 * 写操作事件的摘要（可读格式）。
 *
 * 写操作是唯一会改变用户页面的动作，事件流里必须一眼看清：
 * 做了什么、在哪做的、用户批没批、批的范围多大。
 */
function summarizeApproval(value: unknown): string {
  if (!value || typeof value !== 'object') return '（空）'
  const v = value as ApprovalEventValue
  const bits: string[] = []
  bits.push(APPROVAL_STAGE_TEXT[v.stage] ?? v.stage ?? '？')
  if (v.op) bits.push(v.op === 'scroll' ? '滚动' : v.op === 'click' ? '点击' : v.op)
  if (v.host) bits.push(v.host)
  if (v.via) bits.push(APPROVAL_VIA_TEXT[v.via] ?? v.via)
  if (v.scope) bits.push(APPROVAL_SCOPE_TEXT[v.scope] ?? v.scope)
  if (v.source === 'ui') bits.push('界面触发')
  if (v.error) bits.push(`错误：${v.error}`)
  return bits.join(' · ')
}

/** 页面事件（kind='page'）的载荷 */
interface PageEventValue {
  /** 目前只有开页一种动作 */
  action: 'open'
  url: string
  tabId: number
  title?: string
}

/**
 * 页面事件的摘要（可读格式）。
 *
 * 「agent 打开了哪些页面」此前完全无痕（开页不走写操作护栏），
 * 补上 page 事件后要能一眼看清：开的哪个站点、哪个标题。
 */
function summarizePage(value: unknown): string {
  if (!value || typeof value !== 'object') return '（空）'
  const v = value as PageEventValue
  const bits: string[] = []
  bits.push(v.action === 'open' ? '打开页面' : v.action ?? '页面事件')
  if (v.url) {
    const host = (() => {
      try {
        return new URL(v.url).host
      } catch {
        return ''
      }
    })()
    bits.push(host || v.url)
  }
  if (v.title) bits.push(v.title.slice(0, 40))
  return bits.join(' · ')
}

/** 事件类型（kind）的中文名 */
const KIND_TEXT: Record<string, string> = {
  observe: '观察事件',
  approval: '写操作审计',
  page: '页面事件'
}

/** 三种已知 kind（筛选控件用） */
const ALL_KINDS: HostEventKind[] = ['observe', 'approval', 'page']

/**
 * kind 多选筛选（第十七阶段）。
 *
 * 为什么要有：事件流里「机器看到的观察事件」和「人批过的写操作审计」是两类东西，
 * 混在一列里既看不过来，也没法只导出其中一类。
 * 空选 = 不限（三种都看）。
 */
function KindPicker({
  value,
  onChange,
  idPrefix
}: {
  value: HostEventKind[]
  onChange: (next: HostEventKind[]) => void
  idPrefix: string
}): JSX.Element {
  const toggle = (kind: HostEventKind): void => {
    onChange(value.includes(kind) ? value.filter((k) => k !== kind) : [...value, kind])
  }
  return (
    <span className="kind-picker">
      {ALL_KINDS.map((kind) => (
        <label key={kind} htmlFor={`${idPrefix}-${kind}`}>
          <input
            id={`${idPrefix}-${kind}`}
            type="checkbox"
            data-testid={`${idPrefix}-${kind}`}
            checked={value.includes(kind)}
            onChange={() => toggle(kind)}
          />
          {KIND_TEXT[kind]}（{kind}）
        </label>
      ))}
    </span>
  )
}

/**
 * 趋势柱状图（第十四阶段，零依赖 SVG）。
 *
 * 为什么用 SVG 而不是图表库：本机 pnpm 装依赖很慢，且这只是一张几十根柱子的图，
 * 自己画反而更可控（峰值高亮 / hover 提示 / 轴标签都能精确控制）。
 */
function TrendChart({ points }: { points: HostEventTrendPoint[] }): JSX.Element {
  const width = 760
  const height = 190
  const padLeft = 42
  const padRight = 12
  const padTop = 14
  const padBottom = 30
  const plotWidth = width - padLeft - padRight
  const plotHeight = height - padTop - padBottom
  const max = Math.max(...points.map((p) => p.count), 1)
  const slot = plotWidth / Math.max(points.length, 1)
  const barWidth = Math.max(Math.min(slot - 2, 26), 1)
  const peakCount = Math.max(...points.map((p) => p.count))
  // x 轴标签抽稀：最多 6 个，避免挤成一团
  const labelEvery = Math.max(Math.ceil(points.length / 6), 1)
  const ticks = [0, Math.round(max / 2), max]

  return (
    <svg
      className="trend-chart"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label="事件趋势柱状图"
    >
      {ticks.map((t) => {
        const y = padTop + plotHeight - (t / max) * plotHeight
        return (
          <g key={`t-${t}`}>
            <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="#2a2f3a" strokeWidth={1} />
            <text x={padLeft - 6} y={y + 4} fill="#8a93a6" fontSize={10} textAnchor="end">
              {t}
            </text>
          </g>
        )
      })}
      {points.map((p, i) => {
        const h = (p.count / max) * plotHeight
        const x = padLeft + i * slot + (slot - barWidth) / 2
        const y = padTop + plotHeight - h
        const isPeak = p.count === peakCount && p.count > 0
        return (
          <g key={`b-${p.start}`}>
            <rect
              className={isPeak ? 'trend-bar peak' : 'trend-bar'}
              data-testid={`trend-bar-${i}`}
              data-count={p.count}
              data-start={p.start}
              x={x}
              y={y}
              width={barWidth}
              height={Math.max(h, p.count > 0 ? 1 : 0)}
              fill={isPeak ? '#ffb020' : '#4c8dff'}
            >
              <title>{`${new Date(p.start).toLocaleString()} · ${p.count} 条`}</title>
            </rect>
            {i % labelEvery === 0 || i === points.length - 1 ? (
              <text
                x={x + barWidth / 2}
                y={height - 10}
                fill="#8a93a6"
                fontSize={10}
                textAnchor="middle"
              >
                {new Date(p.start).toLocaleDateString()}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

export default function HostEvents(): JSX.Element {
  const [events, setEvents] = useState<HostEvent[]>([])
  const [watches, setWatches] = useState<HostWatch[]>([])
  const [packageId, setPackageId] = useState('ecclaw-observer-demo')
  const [pageId, setPageId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [replay, setReplay] = useState<HostEvent[]>([])
  const [replaySince, setReplaySince] = useState('')
  const [replayPkg, setReplayPkg] = useState('')
  const [logInfo, setLogInfo] = useState<HostEventLogInfo | null>(null)
  const [summary, setSummary] = useState<HostEventSummary | null>(null)
  const [summaryPkg, setSummaryPkg] = useState('')
  const [summaryBucket, setSummaryBucket] = useState<HostEventTrendBucket>('day')
  const [exportFormat, setExportFormat] = useState<HostEventExportFormat>('jsonl')
  const [exportPkg, setExportPkg] = useState('')
  const [exported, setExported] = useState<HostEventExportResult | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportFiles, setExportFiles] = useState<HostEventExportFile[]>([])
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  // 第十九阶段：导出物归类（none = 平铺，与此前一字不差）
  const [exportGroupBy, setExportGroupBy] = useState<ExportGroupBy>('none')
  // 第十七阶段：kind 多选筛选（空 = 不限）
  const [streamKinds, setStreamKinds] = useState<HostEventKind[]>([])
  const [replayKinds, setReplayKinds] = useState<HostEventKind[]>([])
  const [exportKinds, setExportKinds] = useState<HostEventKind[]>([])
  const [exportSplit, setExportSplit] = useState(false)

  /** 增量事件流按 kind 过滤（纯前端：内存里的那 60 条） */
  const shownEvents =
    streamKinds.length === 0 ? events : events.filter((e) => streamKinds.includes(e.kind))

  /** 每种 kind 各有几条（用于筛选控件旁的计数） */
  const kindCounts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1
    return acc
  }, {})

  /**
   * 导出物分组（第十九阶段）。
   *
   * 纯前端算：不改 IPC、不改导出清单结构 —— 清单还是那一份文件列表，
   * 只是界面上按日期 / 按类型摆一下。默认 'none' = 平铺，DOM 与此前一字不差。
   */
  const exportGroups =
    exportGroupBy === 'none'
      ? []
      : Array.from(
          exportFiles.reduce((acc, f) => {
            const key = exportGroupBy === 'date' ? exportDateKey(f) : exportKindKey(f)
            const list = acc.get(key) ?? []
            list.push(f)
            acc.set(key, list)
            return acc
          }, new Map<string, HostEventExportFile[]>())
        ).map(([key, files]) => ({
          key,
          label: exportGroupBy === 'date' ? key : exportKindLabel(key),
          files
        }))

  /** 拉一次导出物清单 */
  const refreshExports = async (): Promise<void> => {
    try {
      setExportFiles(await api.host.listEventExports())
    } catch {
      setExportFiles([])
    }
  }

  useEffect(() => {
    // 先补一次历史（订阅建立前已经产生的事件），之后只靠推送增量更新
    void api.host.hostEvents(0).then((list) => setEvents(list.slice(-EVENT_LIMIT)))
    void api.host.listWatches().then(setWatches)
    void api.host.hostEventLogInfo().then(setLogInfo)
    void api.host.listEventExports().then(setExportFiles)
    return api.host.onHostEvent((event) => {
      setEvents((list) => [...list, event].slice(-EVENT_LIMIT))
    })
  }, [])

  const start = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      setWatches(await api.host.startWatch(packageId.trim(), pageId.trim() || undefined))
    } catch (err) {
      setError((err as Error).message || String(err))
    } finally {
      setBusy(false)
    }
  }

  const stop = async (watchId: string): Promise<void> => {
    setWatches(await api.host.stopWatch(watchId))
  }

  const doReplay = async (): Promise<void> => {
    setError('')
    try {
      const list = await api.host.replayHostEvents({
        sinceSeq: replaySince.trim() ? Number(replaySince.trim()) : undefined,
        packageId: replayPkg.trim() || undefined,
        kinds: replayKinds.length > 0 ? replayKinds : undefined,
        limit: 200
      })
      setReplay(list)
      setLogInfo(await api.host.hostEventLogInfo())
    } catch (err) {
      setError((err as Error).message || String(err))
    }
  }

  const doSummary = async (): Promise<void> => {
    setError('')
    try {
      setSummary(
        await api.host.eventSummary(
          { packageId: summaryPkg.trim() || undefined },
          { bucket: summaryBucket }
        )
      )
    } catch (err) {
      setError((err as Error).message || String(err))
    }
  }

  /** 导出落盘事件到文件（jsonl / csv），过滤语义与回放、汇总完全一致 */
  const doExport = async (): Promise<void> => {
    setError('')
    setExportBusy(true)
    try {
      setExported(
        await api.host.exportHostEvents(
          {
            packageId: exportPkg.trim() || undefined,
            kinds: exportKinds.length > 0 ? exportKinds : undefined
          },
          { format: exportFormat, splitByKind: exportSplit }
        )
      )
      await refreshExports()
    } catch (err) {
      setError((err as Error).message || String(err))
    } finally {
      setExportBusy(false)
    }
  }

  /**
   * 删除一个导出物（两段式：先点「删除」变「确认删除」，再点才真删）。
   * 红线：程序不会自动删任何导出物，删除只发生在用户明确点了确认之后。
   */
  const doDeleteExport = async (name: string): Promise<void> => {
    if (pendingDelete !== name) {
      setPendingDelete(name)
      return
    }
    setPendingDelete(null)
    setError('')
    try {
      await api.host.removeEventExport(name)
    } catch (err) {
      setError((err as Error).message || String(err))
    } finally {
      await refreshExports()
    }
  }

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h2>宿主事件（poll 订阅式持续刷新）</h2>
          <p className="hint">
            持续观察按包内 intervalMs 循环产出增量事件；界面增量追加，agent 用
            ecclaw_next_event 长轮询取走。
          </p>
        </div>
      </div>

      <div className="editor">
        <div className="row">
          <input
            value={packageId}
            placeholder="packageId"
            onChange={(e) => setPackageId(e.target.value)}
          />
          <input
            value={pageId}
            placeholder="pageId（可空）"
            onChange={(e) => setPageId(e.target.value)}
          />
          <button
            className="primary"
            disabled={busy || packageId.trim() === ''}
            onClick={() => void start()}
          >
            启动持续观察
          </button>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
      </div>

      <div className="split">
        <div>
          <h3>持续观察</h3>
          {watches.length === 0 ? (
            <p className="empty">还没有持续观察</p>
          ) : (
            <ul className="list">
              {watches.map((watch) => (
                <li key={watch.watchId}>
                  <strong>{watch.packageId}</strong>
                  {watch.pageId ? <span className="tag">{watch.pageId}</span> : null}
                  <p>
                    {watch.watchId} · 已产出 {watch.eventCount} 条 ·{' '}
                    {new Date(watch.startedAt).toLocaleTimeString()}
                  </p>
                  <button className="ghost" onClick={() => void stop(watch.watchId)}>
                    停止
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3>增量事件流</h3>
          <div className="row">
            <KindPicker value={streamKinds} onChange={setStreamKinds} idPrefix="stream-kind" />
            <span className="hint" data-testid="stream-kind-count">
              {events.length} 条中显示 {shownEvents.length} 条
              {ALL_KINDS.map((k) => ` · ${k}=${kindCounts[k] ?? 0}`).join('')}
            </span>
          </div>
          {shownEvents.length === 0 ? (
            <p className="empty">{events.length === 0 ? '还没有事件' : '当前筛选下没有事件'}</p>
          ) : (
            <ul className="list">
              {[...shownEvents].reverse().map((event) => (
                <li key={event.seq}>
                  <strong>
                    #{event.seq} {event.kind}
                  </strong>
                  {event.packageId ? <span className="tag">{event.packageId}</span> : null}
                  {event.observationId ? (
                    <span className="tag">{event.observationId}</span>
                  ) : null}
                  <p>
                    {new Date(event.at).toLocaleTimeString()} · {summarize(event)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="editor">
        <h3>历史回放（事件已落盘）</h3>
        <p className="hint">
          事件按天写入 JSONL（明文保留 {logInfo?.retention.retainDays ?? 14} 天后压缩归档，归档再留{' '}
          {logInfo?.retention.archiveDays ?? 90} 天），进程重启或崩溃后也能把之前观察到的数据取回来。
          {logInfo
            ? ` 当前 ${logInfo.total} 条，覆盖 ${logInfo.days.length} 天，占用 ${formatBytes(logInfo.bytes)}（明文 ${logInfo.plainFiles} 个分片 / 归档 ${logInfo.archivedFiles} 个）。`
            : ''}
        </p>
        <div className="row">
          <input
            value={replaySince}
            placeholder="起始 seq（可空）"
            onChange={(e) => setReplaySince(e.target.value)}
          />
          <input
            value={replayPkg}
            placeholder="packageId（可空）"
            onChange={(e) => setReplayPkg(e.target.value)}
          />
          <KindPicker value={replayKinds} onChange={setReplayKinds} idPrefix="replay-kind" />
          <button onClick={() => void doReplay()}>回放</button>
        </div>
        {replay.length > 0 ? (
          <p className="hint" data-testid="replay-kind-count">
            命中 {replay.length} 条
          </p>
        ) : null}
        {replay.length > 0 ? (
          <ul className="list">
            {replay.map((event) => (
              <li key={`r-${event.seq}`}>
                <strong>
                  #{event.seq} {event.kind}
                </strong>
                {event.packageId ? <span className="tag">{event.packageId}</span> : null}
                <p>
                  {new Date(event.at).toLocaleString()} · {summarize(event)}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="editor">
        <h3>事件汇总（按平台包 / 类型 / 天聚合）</h3>
        <p className="hint">
          汇总直接给结论，不必把几千条原始事件拉进上下文；要细节时再回放。agent
          侧同款能力是 ecclaw_event_summary。
        </p>
        <div className="row">
          <input
            value={summaryPkg}
            placeholder="packageId（可空）"
            onChange={(e) => setSummaryPkg(e.target.value)}
          />
          <select
            aria-label="趋势分桶粒度"
            value={summaryBucket}
            onChange={(e) => setSummaryBucket(e.target.value as HostEventTrendBucket)}
          >
            <option value="day">按天</option>
            <option value="hour">按小时</option>
          </select>
          <button onClick={() => void doSummary()}>汇总</button>
        </div>
        {summary ? (
          <div className="split">
            <div>
              <h3>按平台包</h3>
              {summary.byPackage.length === 0 ? (
                <p className="empty">没有命中的事件</p>
              ) : (
                <ul className="list">
                  {summary.byPackage.map((p) => (
                    <li key={p.packageId}>
                      <strong>{p.packageId}</strong>
                      <span className="tag">{p.count} 条</span>
                      <p>
                        seq #{p.firstSeq} → #{p.lastSeq} ·{' '}
                        {new Date(p.firstAt).toLocaleString()} →{' '}
                        {new Date(p.lastAt).toLocaleString()}
                      </p>
                      <p>
                        {Object.entries(p.kinds)
                          .map(([k, n]) => `${k}=${n}`)
                          .join(' · ')}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3>按类型 / 按天</h3>
              <ul className="list">
                {Object.entries(summary.byKind).map(([kind, n]) => (
                  <li key={`k-${kind}`}>
                    <strong>{kind}</strong>
                    <span className="tag">{n} 条</span>
                  </li>
                ))}
              </ul>
              <ul className="list">
                {summary.byDay.map((d) => (
                  <li key={`d-${d.day}`}>
                    <strong>{d.day}</strong>
                    <span className="tag">{d.count} 条</span>
                  </li>
                ))}
              </ul>
              <p className="hint">
                命中 {summary.total} 条，覆盖 {summary.days.length} 天
                {summary.firstAt ? ` · 首条 ${new Date(summary.firstAt).toLocaleString()}` : ''}
                {summary.lastAt ? ` · 末条 ${new Date(summary.lastAt).toLocaleString()}` : ''}
              </p>
            </div>
          </div>
        ) : null}
        {summary ? (
          <div>
            <h3>时间序列趋势（环比 / 峰值）</h3>
            {summary.trend.points.length === 0 ? (
              <p className="empty">没有可成趋势的事件</p>
            ) : (
              <>
                <p className="hint">
                  粒度：{summary.trend.bucket === 'hour' ? '按小时' : '按天'} ·{' '}
                  {summary.trend.points.length} 个点
                  {summary.trend.peak
                    ? ` · 峰值 ${new Date(summary.trend.peak.start).toLocaleString()}（${summary.trend.peak.count} 条）`
                    : ''}
                  {summary.trend.overallDeltaPct === null
                    ? ''
                    : ` · 末桶较首桶 ${summary.trend.overallDeltaPct > 0 ? '+' : ''}${summary.trend.overallDeltaPct}%`}
                </p>
                <ul className="list">
                  {[...summary.trend.points]
                    .reverse()
                    .slice(0, 30)
                    .map((p) => (
                      <li key={`t-${p.start}`}>
                        <strong>{new Date(p.start).toLocaleString()}</strong>
                        <span className="tag">{p.count} 条</span>
                        {p.delta === null ? (
                          <p>首个桶，无环比</p>
                        ) : (
                          <p>
                            环比 {p.delta > 0 ? '+' : ''}
                            {p.delta} 条
                            {p.deltaPct === null
                              ? ''
                              : `（${p.deltaPct > 0 ? '+' : ''}${p.deltaPct}%）`}
                          </p>
                        )}
                      </li>
                    ))}
                </ul>
                <TrendChart points={summary.trend.points} />
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="editor">
        <h3>导出（把观察记录拿走）</h3>
        <p className="hint">
          导出已落盘的事件到文件，过滤语义与回放、汇总完全一致。
          产物落在 <code>{exported?.dir ?? '<userData>/host-events/exports'}</code>，
          不受「保留天数 / 体积上限」的自动淘汰影响（导出物由你自己清理）。
          agent 侧同款能力是 ecclaw_event_export。
        </p>
        <div className="row">
          <label className="hint" htmlFor="host-event-export-format">
            格式：
          </label>
          <select
            id="host-event-export-format"
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as HostEventExportFormat)}
          >
            <option value="jsonl">JSONL（一行一条，可直接再导入）</option>
            <option value="csv">CSV（表格工具可读）</option>
          </select>
          <input
            value={exportPkg}
            placeholder="packageId（可空 = 全部）"
            onChange={(e) => setExportPkg(e.target.value)}
          />
          <button className="primary" disabled={exportBusy} onClick={() => void doExport()}>
            {exportBusy ? '导出中…' : '导出'}
          </button>
        </div>
        <div className="row">
          <KindPicker value={exportKinds} onChange={setExportKinds} idPrefix="export-kind" />
          <label className="hint" htmlFor="host-event-export-split">
            <input
              id="host-event-export-split"
              type="checkbox"
              data-testid="export-split"
              checked={exportSplit}
              onChange={(e) => setExportSplit(e.target.checked)}
            />
            按 kind 拆成多个文件
          </label>
        </div>
        {exported ? (
          <>
            <div className="row">
              <span className="tag">
                {exported.format.toUpperCase()} · {exported.count} 条 ·{' '}
                {formatBytes(exported.bytes)}
              </span>
              {exported.truncated ? (
                <span className="tag">已截断（单次上限 5 万条）</span>
              ) : null}
              {exported.split ? (
                <span className="tag">按 kind 拆分 · {exported.files.length} 个文件</span>
              ) : null}
              {exported.files.length === 1 ? (
                <>
                  <span className="hint">{exported.files[0].file}</span>
                  <button
                    className="ghost"
                    onClick={() => void api.host.showInFolder(exported.files[0].file)}
                  >
                    在文件夹中显示
                  </button>
                </>
              ) : null}
            </div>
            {exported.files.length > 1 ? (
              <ul className="list">
                {exported.files.map((f) => (
                  <li key={f.name}>
                    <strong>{f.name}</strong>
                    {f.kind ? <span className="tag">{KIND_TEXT[f.kind] ?? f.kind}</span> : null}
                    <span className="tag">{formatBytes(f.bytes)}</span>
                    <button
                      className="ghost"
                      data-testid={`export-show-${f.name}`}
                      onClick={() => void api.host.showInFolder(f.file)}
                    >
                      在文件夹中显示
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="editor">
        <h3>导出物（自己清理）</h3>
        <p className="hint">
          导出物落在 <code>&lt;userData&gt;/host-events/exports</code>，不受自动淘汰策略影响，
          也永远不会被程序自动删 —— 下面由你逐个决定要不要删。
          agent 侧同款能力是 ecclaw_export_list（只列不删）。
        </p>
        <div className="row">
          <button onClick={() => void refreshExports()}>刷新清单</button>
          <label className="hint" htmlFor="host-event-export-groupby">
            归类方式
          </label>
          <select
            id="host-event-export-groupby"
            data-testid="export-groupby"
            value={exportGroupBy}
            onChange={(e) => setExportGroupBy(e.target.value as ExportGroupBy)}
          >
            <option value="none">不分组</option>
            <option value="date">按日期</option>
            <option value="kind">按类型</option>
          </select>
          <span className="hint">共 {exportFiles.length} 个文件</span>
        </div>
        {exportFiles.length === 0 ? (
          <p className="empty">还没有导出过文件</p>
        ) : exportGroupBy === 'none' ? (
          <ul className="list">
            {exportFiles.map((f) => (
              <ExportFileRow
                key={f.name}
                f={f}
                pendingDelete={pendingDelete}
                onDelete={(name) => void doDeleteExport(name)}
                onCancel={() => setPendingDelete(null)}
              />
            ))}
          </ul>
        ) : (
          exportGroups.map((g) => (
            <div key={g.key} data-testid={`export-group-${g.key}`}>
              <h4>
                {g.label} · {g.files.length} 个文件
              </h4>
              <ul className="list">
                {g.files.map((f) => (
                  <ExportFileRow
                    key={f.name}
                    f={f}
                    pendingDelete={pendingDelete}
                    onDelete={(name) => void doDeleteExport(name)}
                    onCancel={() => setPendingDelete(null)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
