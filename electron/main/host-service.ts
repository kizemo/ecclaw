import type { BrowserWindow } from 'electron'
import { BrowserHost } from './browser-host'
import { listPackages } from './platform-packages'
import { runtimeFile } from './platform-runtime'
import {
  runDataQuery,
  runPageAction,
  runPageExtract,
  runPageObserve,
  startContinuousObserve,
  type ContinuousObserveHandle
} from './platform-actions'
import {
  exportHostEvents as exportHostEventsRaw,
  hostEventExportDir,
  hostEventLogInfo as hostEventLogInfoRaw,
  listHostEventExports as listHostEventExportsRaw,
  removeHostEventExport as removeHostEventExportRaw,
  pushHostEvent,
  replayHostEvents,
  summarizeHostEvents,
  waitHostEvent
} from './host-events'
import {
  createHostProfile,
  getActiveProfile,
  getProfileState,
  removeHostProfile,
  setActiveProfile
} from './host-profiles'
import { clearSessionGuardRules, guardRuleGroups, removeGuardRules } from './write-guard'
import type { WriteSource } from './write-guard'
import type {
  DomSnapshot,
  GuardRuleGroups,
  HostCommandResult,
  HostEvent,
  HostEventExportFile,
  HostEventExportOptions,
  HostEventExportResult,
  HostEventFilter,
  HostEventLogInfo,
  HostEventSummary,
  HostEventTrendBucket,
  HostPageInfo,
  HostProfileState,
  HostStatus,
  HostViewportBounds,
  HostWatch
} from '../shared/types'

/**
 * 内嵌浏览器宿主的服务层（把「宿主 + 平台包执行器」组装成 IPC 可调用的能力）。
 *
 * 契约依据：docs/dabi-宿主契约-context字段清单-2026-11-02.md
 */

let host: BrowserHost | null = null

/** 绑定到主窗口（窗口重建时重新绑定） */
export function initHost(win: BrowserWindow): void {
  // 第十五阶段：按当前激活的店铺 profile 建 partition（默认仍是 `persist:ecclaw-host`）
  host = new BrowserHost(win, getActiveProfile().partition)
}

function requireHost(): BrowserHost {
  if (!host) throw new Error('内嵌浏览器宿主尚未初始化')
  return host
}

/** 找到包的 runtime.cjs 绝对路径 */
function packageRuntime(packageId: string): string {
  const pkg = listPackages().find((p) => p.manifest.packageId === packageId)
  if (!pkg) throw new Error(`未找到平台包：${packageId}`)
  const file = runtimeFile(pkg)
  if (!file) throw new Error(`平台包 ${packageId} 没有可用的 runtime 文件`)
  return file
}

function parseJsonArg(text: string | undefined, label: string): Record<string, unknown> {
  const raw = (text ?? '').trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('必须是 JSON 对象')
    }
    return parsed as Record<string, unknown>
  } catch (err) {
    throw new Error(`${label} 不是合法 JSON：${(err as Error).message}`)
  }
}

/** 打开页面 */
export async function hostOpen(url: string): Promise<HostPageInfo> {
  const target = url.trim()
  if (!target) throw new Error('URL 不能为空')
  return requireHost().open(target)
}

/** 打开页面并读 DOM 概览（只读动作） */
export async function hostReadDom(url: string): Promise<DomSnapshot> {
  const target = url.trim()
  if (!target) throw new Error('URL 不能为空')
  const h = requireHost()
  await h.open(target)
  return h.readDom()
}

/** 跑一条包内数据查询 */
export async function hostRunDataQuery(
  packageId: string,
  queryId: string,
  argsJson?: string,
  url?: string
): Promise<HostCommandResult> {
  const h = requireHost()
  const args = parseJsonArg(argsJson, '查询参数')
  const runtime = packageRuntime(packageId)
  if (url?.trim()) await h.open(url.trim())
  return runDataQuery(runtime, queryId.trim(), args, h)
}

/** 跑一条包内页面动作 */
export async function hostRunAction(
  packageId: string,
  capability: string,
  payloadJson?: string,
  url?: string,
  source: WriteSource = 'ui'
): Promise<HostCommandResult> {
  const h = requireHost()
  const payload = parseJsonArg(payloadJson, '动作参数')
  const runtime = packageRuntime(packageId)
  if (url?.trim()) await h.open(url.trim())
  return runPageAction(runtime, capability.trim(), payload, h, source)
}

/**
 * 直接执行一条宿主写操作（不经平台包）。
 * 供 MCP 的 ecclaw_click / ecclaw_scroll 使用：agent 不依赖任何平台包也能驱动页面。
 *
 * 走两段式（deferred）：需要用户确认时**立即**返回票据 {status:"pending", approvalId}，
 * 用户批准后才真正执行，agent 用 ecclaw_approval_status 轮询结果。
 */
export async function hostWriteOp(
  op: string,
  params: Record<string, unknown>,
  source: WriteSource = 'agent'
): Promise<unknown> {
  return requireHost().runOp(op, params, { source, mode: 'deferred' })
}

/** 跑一次包内页面提取（只读读 DOM） */
export async function hostRunExtract(
  packageId: string,
  pageId?: string,
  url?: string
): Promise<HostCommandResult> {
  const h = requireHost()
  const runtime = packageRuntime(packageId)
  if (url?.trim()) await h.open(url.trim())
  return runPageExtract(runtime, pageId?.trim() || undefined, h)
}

/** 摆放宿主页面（可见内嵌浏览器）；bounds 为 null 时隐藏 */
export function hostSetViewport(bounds: HostViewportBounds | null): void {
  requireHost().setViewport(bounds)
}

/** 跑一次包内页面观察（observations → 宿主捕获网络事件 → page.observe(context)） */
export async function hostRunObserve(
  packageId: string,
  pageId?: string,
  url?: string
): Promise<HostCommandResult> {
  const h = requireHost()
  const runtime = packageRuntime(packageId)
  if (url?.trim()) await h.open(url.trim())
  return runPageObserve(runtime, pageId?.trim() || undefined, h)
}

/** 宿主当前状态（页面信息 + 摆放位置） */
export function hostStatus(): HostStatus {
  return requireHost().status()
}

/* ------------------------------------------------------------------
 * 持续观察（poll 订阅式持续刷新）
 *
 * dabi 的 poll 观察器是持续刷新的（侧栏随页面联动），这里把它补上：
 * 启动一个常驻子进程，按包内 intervalMs 循环调用 page.observe，
 * 每轮产出一条**增量**事件进宿主事件总线 —— 界面增量更新、agent 长轮询取走。
 * ------------------------------------------------------------------ */

interface WatchEntry {
  watch: HostWatch
  handle: ContinuousObserveHandle
  stopped: boolean
}

const watches = new Map<string, WatchEntry>()
let watchSeq = 0

/** 当前所有持续观察 */
export function hostListWatches(): HostWatch[] {
  return [...watches.values()].map((entry) => entry.watch)
}

/** 启动一个持续观察（poll 订阅） */
export async function hostStartWatch(packageId: string, pageId?: string): Promise<HostWatch[]> {
  const h = requireHost()
  const runtime = packageRuntime(packageId)
  const page = pageId?.trim() || undefined
  const watchId = `w-${Date.now().toString(36)}-${++watchSeq}`
  await h.enableNetworkCapture()
  const entry: WatchEntry = {
    watch: {
      watchId,
      packageId,
      pageId: page,
      startedAt: new Date().toISOString(),
      eventCount: 0
    },
    handle: null as unknown as ContinuousObserveHandle,
    stopped: false
  }
  entry.handle = startContinuousObserve(runtime, page, h, (value, observationId) => {
    entry.watch.eventCount += 1
    pushHostEvent({
      kind: 'observe',
      packageId,
      pageId: page,
      observationId,
      value
    })
  })
  watches.set(watchId, entry)
  void entry.handle.done.then((result) => {
    if (entry.stopped) return
    // 一条都没产出 = 子进程自己退了（包里没有 poll 观察器 / 异常），留一条错误事件
    if (entry.watch.eventCount === 0) {
      const payload = result?.value as Record<string, unknown> | undefined
      const detail =
        payload && typeof payload === 'object' && typeof payload.error === 'string'
          ? payload.error
          : '持续观察已结束'
      pushHostEvent({ kind: 'observe', packageId, pageId: page, value: { error: detail } })
    }
    watches.delete(watchId)
  })
  return hostListWatches()
}

/** 停掉一个持续观察 */
export function hostStopWatch(watchId: string): HostWatch[] {
  const entry = watches.get(watchId)
  if (!entry) return hostListWatches()
  entry.stopped = true
  entry.handle.stop()
  watches.delete(watchId)
  return hostListWatches()
}

/** 长轮询等下一个增量事件（超时返回 null，不是错误） */
export async function hostNextEvent(sinceSeq: number, timeoutMs: number): Promise<HostEvent | null> {
  return waitHostEvent(sinceSeq, timeoutMs)
}

/**
 * 回放历史事件（第十阶段：事件落盘后，崩了/重启了也能把之前观察到的数据取回来）。
 */
export function hostReplayEvents(
  filter: HostEventFilter & { limit?: number }
): HostEvent[] {
  return replayHostEvents(filter)
}

/** 事件日志概况（落盘目录 / 覆盖天数 / 总条数 / 保留策略） */
export function hostEventLogInfo(): HostEventLogInfo {
  return hostEventLogInfoRaw()
}

/**
 * 事件汇总（第十一阶段）：按平台包 / 类型 / 天聚合。
 * agent 想知道「哪个包产了多少事件」时用这个，而不是把几千条原始事件拉进上下文。
 *
 * 第十三阶段加了 bucket：趋势分桶粒度（'day' 默认 / 'hour'）。
 */
export function hostEventSummary(
  filter: HostEventFilter = {},
  options: { bucket?: HostEventTrendBucket } = {}
): HostEventSummary {
  return summarizeHostEvents(filter, options)
}

/**
 * 导出已落盘的事件到文件（第十二阶段）。
 * 过滤语义与回放 / 汇总完全一致；导出物落在 <userData>/host-events/exports/。
 */
export function hostExportEvents(
  filter: HostEventFilter = {},
  options: HostEventExportOptions = {}
): HostEventExportResult {
  return exportHostEventsRaw(filter, options)
}

/**
 * 列出导出物（第十四阶段：导出物清理入口）。
 * 程序绝不自动删导出物 —— 这里只是让界面能列出来，让用户自己决定删哪个。
 */
export function hostEventExports(): { dir: string; files: HostEventExportFile[] } {
  return { dir: hostEventExportDir(), files: listHostEventExportsRaw() }
}

/** 删除一个导出物（精确文件名；禁通配符 / 批量）。只有用户明确点了「删除」才会走到这。 */
export function hostRemoveEventExport(name: string): boolean {
  return removeHostEventExportRaw(name)
}

/** 信任规则分组（本次会话 / 永久） */
export function hostGuardRuleGroups(): GuardRuleGroups {
  return guardRuleGroups()
}

/** 清空本次会话的信任规则（返回清掉几条） */
export function hostClearSessionGuardRules(): number {
  return clearSessionGuardRules()
}

/**
 * 按「站点 + 可选路径」移除信任规则（返回移除条数）。
 * 不给 path = 清掉该站点全部规则（session + persistent）。
 */
export function hostRemoveGuardRules(
  host: string,
  path?: string,
  scope: 'session' | 'persistent' | 'all' = 'all'
): number {
  return removeGuardRules(host, path, scope)
}

/* ------------------------------------------------------------------
 * 店铺登录态 profile（第十五阶段）
 *
 * 一个 profile = 一个独立 partition；切换 profile = 换 partition + 重建宿主页面。
 * 默认 profile 沿用第十阶段的 `persist:ecclaw-host`（已有登录态不受影响）。
 * ------------------------------------------------------------------ */

/** 全部 profile + 当前激活 id */
export function hostProfiles(): HostProfileState {
  return getProfileState()
}

/** 新建一个 profile（= 一个新的空 partition；不碰任何已有 partition 的数据） */
export function hostCreateProfile(name: string): HostProfileState {
  createHostProfile(name)
  return getProfileState()
}

/** 切换当前 profile：换 partition 并重建宿主页面（当前页面会被关闭） */
export async function hostUseProfile(id: string): Promise<HostProfileState> {
  const profile = setActiveProfile(id)
  await requireHost().usePartition(profile.partition)
  return getProfileState()
}

/**
 * 移除一个 profile 的配置记录。
 * **不删**磁盘上的登录数据（那是用户文件，删除权在用户手上）；
 * 删的是当前 profile 时激活项复位到默认 profile，宿主 partition 一并切回去。
 */
export async function hostRemoveProfile(id: string): Promise<HostProfileState> {
  const removed = removeHostProfile(id)
  if (!removed) throw new Error('未找到该店铺，或内置默认店铺不可移除')
  await requireHost().usePartition(getActiveProfile().partition)
  return getProfileState()
}
