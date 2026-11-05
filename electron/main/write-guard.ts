import { readSettings, writeSettings } from './openclaw-config'
import { pushHostEvent } from './host-events'
import type {
  AllowRule,
  ApprovalEventValue,
  ApprovalScope,
  GuardRuleGroups,
  WriteApproval,
  WriteApprovalRequest,
  WriteApprovalStatus
} from '../shared/types'

/**
 * 写操作护栏 —— agent 触发的写操作必须先过用户确认。
 *
 * 为什么需要：
 * 写操作 = 「替用户操作页面」（点按钮、滚页面）。agent 自己决定点哪里是不可接受的，
 * 必须让用户看到「要做什么」并点头。宿主（UI 里手动点「执行页面动作」）是用户自己的操作，
 * 不走这道闸。
 *
 * 三档策略（ecclaw-settings.json → hostWriteGuard）：
 * - ask（默认）：弹窗等用户点「允许 / 拒绝」
 * - allow：直接放行（用户明确表示信任 agent）
 * - deny ：直接拒绝
 *
 * 只有「改动页面」的操作需要确认：click / scroll。
 * interceptNext（抓响应）与 waitForNavigation（等跳转）是只读的，不打扰用户。
 *
 * 两种等待形态：
 * - 阻塞式（runWithWriteApproval）：调用方一直等到用户答复。窗口必须 **明显 < 60s**，
 *   因为 MCP SDK 客户端请求超时硬编码 60000ms（DEFAULT_REQUEST_TIMEOUT_MSEC），
 *   超时后 agent 只拿到 `MCP error -32001: Request timed out`，既不知道用户没点，
 *   也拿不到「被拒绝」这个明确结论。取 40s（留 20s 余量），超时自动拒绝（fail-closed）。
 * - 两段式（requestWriteApproval）：**立即**返回票据 {status:"pending", approvalId}，
 *   真正的执行推迟到用户批准之后，由 agent 轮询 ecclaw_approval_status 取结果。
 *   人的等待时间与 MCP 的 60s 超时彻底解耦 —— 用户离开界面去干别的也没关系。
 */

export type WriteGuardMode = 'ask' | 'allow' | 'deny'

/** 写操作的发起方：ui = 用户自己在界面里点的；agent = agent 通过 MCP 触发的 */
export type WriteSource = 'ui' | 'agent'

/** 用户对一次写操作确认的回应 */
export type ApprovalDecision = 'approved' | 'rejected' | 'timeout'

/** 写操作的定位信息（用于给用户看 + 摘要） */
export interface WriteApprovalDetails {
  selector?: string
  text?: string
  frame?: string
  url?: string
}

/** 两段式票据：立即返回给 agent 的东西 */
export interface WriteApprovalTicket {
  /** pending = 等用户批准；executed = 已直接执行完（allow 档或无需确认） */
  status: 'pending' | 'executed'
  /** status=pending 时的票据号，用它轮询最终结果 */
  approvalId?: string
  /** status=executed 时的执行结果 */
  result?: unknown
}

/** 需要用户确认的写操作（改动页面的那些） */
const MUTATING_OPS = new Set(['click', 'scroll'])

/**
 * 阻塞式等待窗口。
 * 必须 < MCP SDK 的 60s 硬超时，否则 agent 侧必然先超时（实测连点三次全部 -32001，
 * 而按钮根本没被点）。取 40s。
 */
const BLOCKING_TIMEOUT_MS = 40_000

/**
 * 两段式票据的存活窗口。
 * 两段式不再受 MCP 60s 限制（工具已经返回了），所以可以给用户很长的思考时间；
 * 但仍要有上限，避免票据无限堆积（未答复的票据过期后 fail-closed：不会执行）。
 */
const PENDING_TIMEOUT_MS = 10 * 60_000

/** 终态票据的保留时长（过了就清掉，防内存无限增长） */
const TERMINAL_KEEP_MS = 30 * 60_000

interface Entry {
  request: WriteApprovalRequest
  status: WriteApprovalStatus
  result?: unknown
  error?: string
  createdAt: string
  updatedAt: string
  /** 发起方（ui / agent） */
  source: WriteSource
  /** 用户选定的信任范围 */
  scope?: ApprovalScope
  /** 超时定时器 */
  timer?: NodeJS.Timeout
  /** 阻塞式等待者 */
  wait?: (decision: ApprovalDecision) => void
  /** 两段式：批准后才真正执行的函数 */
  runner?: () => Promise<unknown>
}

const entries = new Map<string, Entry>()
let seq = 0

/** 确认请求的投递通道（主进程 → 渲染进程） */
type Emitter = (request: WriteApprovalRequest) => void
let emitter: Emitter | null = null

/** 票据状态变化的投递通道（主进程 → 渲染进程） */
type UpdateEmitter = (approval: WriteApproval) => void
let updateEmitter: UpdateEmitter | null = null

export function setWriteApprovalEmitter(fn: Emitter | null): void {
  emitter = fn
}

export function setWriteApprovalUpdateEmitter(fn: UpdateEmitter | null): void {
  updateEmitter = fn
}

/** 当前策略 */
export function writeGuardMode(): WriteGuardMode {
  const raw = readSettings().hostWriteGuard
  return raw === 'allow' || raw === 'deny' || raw === 'ask' ? raw : 'ask'
}

/* ------------------------------------------------------------------
 * 站点白名单（护栏粒度：一次授权一批操作）
 *
 * 用户点「允许并信任本页面」→ 把当前页面的域名加进白名单 →
 * 该站点之后的写操作直接放行，不再一张张弹卡片。
 * 存 ecclaw-settings.json → hostWriteGuardAllowlist（数组）。
 *
 * 第十阶段把粒度再拆成三个维度（原来只有「域名 + 永久 + 全部写操作」）：
 * - match：host（精确主机）/ domain（含子域，现有行为）
 * - ops  ：all（全部写操作）/ scroll（只放行滚动，点按仍要确认 —— 电商场景里
 *          「点一下」可能下单，「滚一下」只是浏览，风险完全不同）
 * - ttl  ：persistent（落盘）/ session（仅本次宿主运行，内存里，重启即失效）
 *
 * 第十二阶段加了第四个维度 **path**：
 * - path 缺省 / 根路径 = 整站（与第十阶段行为完全一致）
 * - path 非空 = 只对该 pathname 前缀生效（`pathname === path || pathname.startsWith(path + '/')`）
 *
 * 三个维度取**交集**（最严为准）：host(match) ∧ path ∧ ops。
 * 新增的第五档信任范围 `persistent-path` = 「永久信任该站点的当前路径」，
 * 授权时把当前 URL 的 pathname 写进规则（如 `/seller/item`）——
 * 站点内部换到别的路径（`/seller/payout`）仍然逐次确认。
 *
 * 存量兼容：老版本存的是字符串数组（["127.0.0.1"]），读的时候按
 * {host, match:'domain', ops:'all', ttl:'persistent'} 解释，行为不变。
 * ------------------------------------------------------------------ */

/** 匹配粒度：精确主机 / 含子域的域名 */
export type AllowMatch = AllowRule['match']
/** 放行的操作范围 */
export type AllowOps = AllowRule['ops']
/** 有效期：落盘 / 仅本次宿主运行 */
export type AllowTtl = AllowRule['ttl']

/** scope → 白名单条目的粒度映射 */
function scopeRule(
  scope: ApprovalScope,
  url?: string
): { match: AllowMatch; ops: AllowOps; ttl: AllowTtl; path?: string } {
  switch (scope) {
    case 'session':
      return { match: 'domain', ops: 'all', ttl: 'session' }
    case 'persistent':
      return { match: 'domain', ops: 'all', ttl: 'persistent' }
    case 'persistent-scroll':
      return { match: 'domain', ops: 'scroll', ttl: 'persistent' }
    case 'persistent-path': {
      // 「永久信任当前路径」：记下当前页面的 pathname 前缀。
      // 拿不到 URL 或正好在站点根路径时退化成整站 —— 宁可宽一点，
      // 也不要留一条永远匹配不上的死规则（那会让用户以为已经授权了）。
      const path = rulePath(pathOf(url))
      return path
        ? { match: 'domain', ops: 'all', ttl: 'persistent', path }
        : { match: 'domain', ops: 'all', ttl: 'persistent' }
    }
    default:
      return { match: 'domain', ops: 'all', ttl: 'persistent' }
  }
}

/* ------------------------------------------------------------------
 * 路径维度（第十二阶段）
 * ------------------------------------------------------------------ */

/** 规范化路径：补前导斜杠、去尾斜杠（根 '/' 保持为 '/'） */
function normalizePath(p: string | undefined): string {
  let out = (p ?? '').trim()
  if (!out) return '/'
  if (!out.startsWith('/')) out = `/${out}`
  while (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
  return out
}

/** 规则的路径：空串 / 根路径都表示「整站」（不限定路径） */
function rulePath(p: string | undefined): string {
  const n = normalizePath(p)
  return n === '/' ? '' : n
}

/** URL 的 pathname（规范化） */
function pathOf(url: string | undefined): string {
  if (!url) return '/'
  try {
    return normalizePath(new URL(url).pathname)
  } catch {
    return '/'
  }
}

/** pathname 是否落在规则路径前缀内 */
function pathMatches(rule: AllowRule, pathname: string): boolean {
  const p = rule.path ? rulePath(rule.path) : ''
  if (!p) return true
  const target = normalizePath(pathname)
  return target === p || target.startsWith(`${p}/`)
}

/** 两条规则是否指同一条（host + match + ops + path 全同） */
function sameRule(a: AllowRule, b: AllowRule): boolean {
  return (
    a.host === b.host &&
    a.match === b.match &&
    a.ops === b.ops &&
    (a.path ?? '') === (b.path ?? '')
  )
}

/** 白名单里的站点（域名）—— 兼容旧格式（字符串数组）与新格式（对象数组） */
export function writeGuardAllowlist(): AllowRule[] {
  const raw = readSettings().hostWriteGuardAllowlist
  if (!Array.isArray(raw)) return []
  const rules: AllowRule[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const host = item.trim().toLowerCase().replace(/^\./, '')
      if (host) rules.push({ host, match: 'domain', ops: 'all', ttl: 'persistent' })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const obj = item as Partial<AllowRule>
    const host = typeof obj.host === 'string' ? obj.host.trim().toLowerCase() : ''
    if (!host) continue
    const path = rulePath(typeof obj.path === 'string' ? obj.path : '')
    rules.push({
      host,
      match: obj.match === 'host' ? 'host' : 'domain',
      ops: obj.ops === 'scroll' ? 'scroll' : 'all',
      ttl: obj.ttl === 'session' ? 'session' : 'persistent',
      ...(path ? { path } : {})
    })
  }
  return rules
}

/** 仅本次宿主运行有效的规则（内存，不落盘） */
const sessionRules: AllowRule[] = []

function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

function ruleMatches(rule: AllowRule, host: string, pathname: string): boolean {
  const target = rule.host.replace(/^\./, '')
  if (!target) return false
  if (rule.match === 'host') {
    if (host !== target) return false
  } else if (!(host === target || host.endsWith(`.${target}`))) {
    return false
  }
  return pathMatches(rule, pathname)
}

/** 把站点加进白名单（已在里面则不动） */
export function allowSite(
  url: string | undefined,
  opts: { match?: AllowMatch; ops?: AllowOps; ttl?: AllowTtl; path?: string } = {}
): string | null {
  const host = hostOf(url) ?? undefined
  if (!host) return null
  const match = opts.match ?? 'domain'
  const ops = opts.ops ?? 'all'
  const ttl = opts.ttl ?? 'persistent'
  const path = rulePath(opts.path)
  const rule: AllowRule = { host, match, ops, ttl, ...(path ? { path } : {}) }
  if (ttl === 'session') {
    if (!sessionRules.some((r) => sameRule(r, rule))) {
      sessionRules.push(rule)
    }
    return host
  }
  const list = writeGuardAllowlist()
  if (!list.some((r) => sameRule(r, rule))) {
    writeSettings({ hostWriteGuardAllowlist: [...list, rule] })
  }
  return host
}

/**
 * 该页面的站点是否被信任到可以执行这个写操作。
 * op 传 'click' / 'scroll'：ops='scroll' 的规则只放行 scroll。
 * 带 path 的规则还要 pathname 落在该前缀内。
 */
export function isSiteAllowed(url: string | undefined, op = 'click'): boolean {
  const host = hostOf(url) ?? undefined
  if (!host) return false
  const pathname = pathOf(url)
  const all = [...sessionRules, ...writeGuardAllowlist()]
  return all.some((rule) => {
    if (!ruleMatches(rule, host, pathname)) return false
    if (rule.ops === 'all') return true
    return rule.ops === op
  })
}

/** 全部白名单条目（含仅本次会话有效的），给界面展示与删除 */
export function listGuardRules(): AllowRule[] {
  return [...sessionRules, ...writeGuardAllowlist()]
}

/**
 * 信任规则分组（第十二阶段）。
 * 「本次会话」和「永久」必须能分开看、分开清 —— 之前只有一条扁平列表，
 * 用户设了 session 规则却看不见，也没法只清 session 而留着永久的。
 */
export function guardRuleGroups(): GuardRuleGroups {
  return {
    session: [...sessionRules],
    persistent: writeGuardAllowlist()
  }
}

/** 清空「本次会话」的信任规则（只清内存里的 sessionRules，不碰落盘的永久规则） */
export function clearSessionGuardRules(): number {
  const n = sessionRules.length
  sessionRules.length = 0
  return n
}

/**
 * 删掉一条白名单条目。
 *
 * 按 ttl 决定删哪一组：界面上「本次会话信任」和「永久信任」是两个独立分组，
 * 各自的「移除」只该动自己那一组。
 *
 * 早先的写法是「先在 session 里找，找到就删，否则删永久的」，而 sameRule
 * 不比较 ttl —— 同一个站点同一条路径在两组里可能长得完全一样（session 档
 * 永远是整站规则，permanent 档整站授权也是整站规则）。
 * 于是用户在「永久信任」分组点移除，被删掉的其实是会话那条，
 * 永久信任原封不动还在生效 —— 看着像撤销失败，其实删错了地方。
 */
export function removeGuardRule(rule: AllowRule): AllowRule[] {
  if (rule.ttl === 'session') {
    const idx = sessionRules.findIndex((r) => sameRule(r, rule))
    if (idx >= 0) {
      sessionRules.splice(idx, 1)
    }
    return listGuardRules()
  }
  const list = writeGuardAllowlist()
  const kept = list.filter((r) => !sameRule(r, rule))
  if (kept.length !== list.length) {
    writeSettings({ hostWriteGuardAllowlist: kept })
  }
  return listGuardRules()
}

/**
 * 按「站点 + 路径」移除信任规则（第十三阶段）。
 *
 * 为什么需要整条规则的粒度之外再给一个按站点的：
 * 用户给同一站点授权过好几条路径规则（/seller/item、/seller/payout、…）时，
 * 界面上是若干个平铺的标签 —— 看不出哪几条属于同一个站点，
 * 想撤销其中一条又只能靠肉眼逐条比对路径。
 *
 * - 给了 path：只移除该站点该路径的那一条（路径粒度）
 * - 不给 path：移除该站点的全部规则（站点粒度）
 *
 * session 与 persistent 两条线一起清 —— 用户说「我不信这个站了」时，
 * 不该留下会话规则还在生效。
 */
export function removeGuardRules(
  host: string,
  path?: string,
  scope: 'session' | 'persistent' | 'all' = 'all'
): number {
  const target = host.trim().toLowerCase().replace(/^\./, '')
  if (!target) return 0
  // path 缺省 = 整站；给了空串也按「整站」口径（rulePath 把 '/' 和 '' 都归一成 ''）
  const wantPath = path === undefined ? undefined : rulePath(path)

  let removed = 0
  if (scope === 'session' || scope === 'all') {
    for (let i = sessionRules.length - 1; i >= 0; i--) {
      const rule = sessionRules[i]
      if (rule.host !== target) continue
      if (wantPath !== undefined && rulePath(rule.path) !== wantPath) continue
      sessionRules.splice(i, 1)
      removed += 1
    }
  }

  if (scope === 'persistent' || scope === 'all') {
    const list = writeGuardAllowlist()
    const kept = list.filter((rule) => {
      if (rule.host !== target) return true
      if (wantPath !== undefined && rulePath(rule.path) !== wantPath) return true
      removed += 1
      return false
    })
    if (kept.length !== list.length) {
      writeSettings({ hostWriteGuardAllowlist: kept })
    }
  }
  return removed
}

function now(): string {
  return new Date().toISOString()
}

function newId(): string {
  return `w-${Date.now().toString(36)}-${++seq}`
}

function toApproval(entry: Entry): WriteApproval {
  return {
    ...entry.request,
    status: entry.status,
    result: entry.result,
    error: entry.error,
    updatedAt: entry.updatedAt
  }
}

function notifyUpdate(entry: Entry): void {
  if (!updateEmitter) return
  try {
    updateEmitter(toApproval(entry))
  } catch {
    /* 渲染进程不可用时忽略 */
  }
}

/**
 * 写操作审计事件：把「agent 动了页面」这件事落进事件流。
 *
 * 事件流 / 汇总 / 导出 / 趋势原本只覆盖 observe（观察），写操作查无此案 ——
 * 而写操作恰恰是唯一会**改变用户页面**的动作，必须留痕：谁发起、用户批没批、
 * 批的范围多大、执行结果如何。
 */
function emitApprovalEvent(value: ApprovalEventValue): void {
  try {
    pushHostEvent({ kind: 'approval', value })
  } catch {
    /* 事件系统不可用不影响写操作本身 */
  }
}

/** 清掉过期太久的终态票据 */
function sweep(): void {
  const cutoff = Date.now() - TERMINAL_KEEP_MS
  for (const [id, entry] of entries) {
    if (entry.status !== 'pending' && new Date(entry.updatedAt).getTime() < cutoff) {
      entries.delete(id)
    }
  }
}

function createEntry(op: string, details: WriteApprovalDetails, source: WriteSource): Entry {
  sweep()
  const id = newId()
  const createdAt = now()
  const entry: Entry = {
    request: {
      id,
      op,
      summary: summarize(op, details),
      selector: details.selector,
      text: details.text,
      frame: details.frame,
      url: details.url,
      createdAt
    },
    status: 'pending',
    createdAt,
    updatedAt: createdAt,
    source
  }
  entries.set(id, entry)
  return entry
}

/** 全部票据（渲染进程补渲染 + agent 查询都用它） */
export function listApprovals(): WriteApproval[] {
  return [...entries.values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(toApproval)
}

/** 仍在等待用户答复的票据 */
export function listPendingApprovals(): WriteApproval[] {
  return listApprovals().filter((a) => a.status === 'pending')
}

/** 查一张票据（agent 轮询用；查不到返回 null） */
export function approvalStatus(id: string): WriteApproval | null {
  const entry = entries.get(id)
  return entry ? toApproval(entry) : null
}

/**
 * 用户回应（渲染进程点按钮后调用）。
 * 批准 → 两段式票据在后台真正执行；拒绝 → 票据落到 rejected（fail-closed，绝不执行）。
 *
 * scope 决定这次批准顺带记住多少信任：
 * - once：什么都不记（只放行这一次）
 * - session：本次宿主运行内信任该域名（内存，重启即失效）
 * - persistent：永久信任该域名（含子域，全部写操作）
 * - persistent-scroll：永久信任该域名，但**只放行滚动**，点按仍逐次确认
 * - persistent-path：永久信任该域名，但**只限当前页面的路径前缀**（如 /seller/item）
 */
export function resolveWriteApproval(
  id: string,
  approved: boolean,
  scope: ApprovalScope = 'once'
): boolean {
  const entry = entries.get(id)
  if (!entry || entry.status !== 'pending') return false
  if (entry.timer) clearTimeout(entry.timer)
  entry.updatedAt = now()
  entry.scope = scope
  const op = entry.request.op
  const url = entry.request.url
  const host = hostOf(url) ?? undefined
  // 一次授权一批：按 scope 把该站点写进白名单，之后同 scope 的写操作直接放行
  if (approved && scope !== 'once') {
    allowSite(entry.request.url, scopeRule(scope, entry.request.url))
  }
  if (!approved) {
    entry.status = 'rejected'
    entry.error = '用户拒绝了本次写操作'
    emitApprovalEvent({
      stage: 'rejected',
      op,
      url,
      host,
      source: entry.source,
      scope,
      approvalId: id,
      ok: false,
      error: entry.error
    })
    entry.wait?.('rejected')
    notifyUpdate(entry)
    return true
  }
  entry.status = 'approved'
  entry.wait?.('approved')
  notifyUpdate(entry)
  const runner = entry.runner
  if (runner) {
    void (async () => {
      try {
        const result = await runner()
        entry.status = 'executed'
        entry.result = result
        emitApprovalEvent({
          stage: 'executed',
          op,
          url,
          host,
          source: entry.source,
          scope,
          approvalId: id,
          via: 'user',
          ok: true,
          result
        })
      } catch (err) {
        entry.status = 'failed'
        entry.error = (err as Error).message || String(err)
        emitApprovalEvent({
          stage: 'failed',
          op,
          url,
          host,
          source: entry.source,
          scope,
          approvalId: id,
          via: 'user',
          ok: false,
          error: entry.error
        })
      }
      entry.updatedAt = now()
      notifyUpdate(entry)
    })()
  }
  return true
}

/**
 * 两段式：请求写操作授权，**立即**返回票据。
 *
 * 返回 {status:"pending", approvalId} 表示「排队等用户批准」；
 * 用户批准后由 resolveWriteApproval 触发 runner 执行，结果用 approvalStatus(id) 取。
 * allow 档（或 ui 发起 / 只读 op）则当场执行完，返回 {status:"executed", result}。
 */
export async function requestWriteApproval(
  op: string,
  details: WriteApprovalDetails,
  source: WriteSource,
  runner: () => Promise<unknown>
): Promise<WriteApprovalTicket> {
  if (!MUTATING_OPS.has(op)) {
    return { status: 'executed', result: await runner() }
  }
  const url = details.url
  const host = hostOf(url) ?? undefined
  if (source === 'ui') {
    const result = await runner()
    emitApprovalEvent({ stage: 'executed', op, url, host, source, via: 'ui', ok: true, result })
    return { status: 'executed', result }
  }
  const mode = writeGuardMode()
  if (mode === 'allow') {
    const result = await runner()
    emitApprovalEvent({ stage: 'executed', op, url, host, source, via: 'guard-allow', ok: true, result })
    return { status: 'executed', result }
  }
  // 站点白名单：该站点已被用户「一次授权一批」→ 直接放行
  if (isSiteAllowed(details.url, op)) {
    const result = await runner()
    emitApprovalEvent({ stage: 'executed', op, url, host, source, via: 'site-trust', ok: true, result })
    return { status: 'executed', result }
  }
  if (mode === 'deny') {
    const error = `写操作已被策略禁用（hostWriteGuard=deny）：${op}`
    emitApprovalEvent({ stage: 'failed', op, url, host, source, ok: false, error })
    throw new Error(error)
  }
  if (!emitter) {
    throw new Error(`无法请求写操作确认（没有可用的界面通道）：${op}`)
  }
  const entry = createEntry(op, details, source)
  entry.runner = runner
  emitApprovalEvent({ stage: 'requested', op, url, host, source, approvalId: entry.request.id })
  entry.timer = setTimeout(() => {
    if (entry.status !== 'pending') return
    entry.status = 'timeout'
    entry.error = `用户未在 ${PENDING_TIMEOUT_MS / 60000} 分钟内确认本次写操作（${op}）`
    entry.updatedAt = now()
    emitApprovalEvent({
      stage: 'timeout',
      op,
      url,
      host,
      source,
      approvalId: entry.request.id,
      ok: false,
      error: entry.error
    })
    notifyUpdate(entry)
  }, PENDING_TIMEOUT_MS)
  emitter(entry.request)
  return { status: 'pending', approvalId: entry.request.id }
}

/**
 * 阻塞式：等用户答复后执行（给平台包 runner 用 —— 包内 await 的就是执行结果，
 * 不能塞一张票据进去）。窗口 40s，必须 < MCP 60s 硬超时。
 */
export async function runWithWriteApproval<T>(
  op: string,
  details: WriteApprovalDetails,
  source: WriteSource,
  runner: () => Promise<T>
): Promise<T> {
  if (!MUTATING_OPS.has(op)) {
    return runner()
  }
  const url = details.url
  const host = hostOf(url) ?? undefined
  if (source === 'ui') {
    const result = await runner()
    emitApprovalEvent({ stage: 'executed', op, url, host, source, via: 'ui', ok: true, result })
    return result
  }
  const mode = writeGuardMode()
  if (mode === 'allow') {
    const result = await runner()
    emitApprovalEvent({ stage: 'executed', op, url, host, source, via: 'guard-allow', ok: true, result })
    return result
  }
  // 站点白名单：该站点已被用户「一次授权一批」→ 直接放行
  if (isSiteAllowed(details.url, op)) {
    const result = await runner()
    emitApprovalEvent({ stage: 'executed', op, url, host, source, via: 'site-trust', ok: true, result })
    return result
  }
  if (mode === 'deny') {
    const error = `写操作已被策略禁用（hostWriteGuard=deny）：${op}`
    emitApprovalEvent({ stage: 'failed', op, url, host, source, ok: false, error })
    throw new Error(error)
  }
  if (!emitter) {
    throw new Error(`无法请求写操作确认（没有可用的界面通道）：${op}`)
  }
  const entry = createEntry(op, details, source)
  const emit = emitter
  emitApprovalEvent({ stage: 'requested', op, url, host, source, approvalId: entry.request.id })
  const decision = await new Promise<ApprovalDecision>((resolve) => {
    entry.wait = resolve
    entry.timer = setTimeout(() => {
      if (entry.status !== 'pending') return
      entry.status = 'timeout'
      entry.error = `用户未在 ${BLOCKING_TIMEOUT_MS / 1000}s 内确认本次写操作`
      entry.updatedAt = now()
      emitApprovalEvent({
        stage: 'timeout',
        op,
        url,
        host,
        source,
        approvalId: entry.request.id,
        ok: false,
        error: entry.error
      })
      notifyUpdate(entry)
      resolve('timeout')
    }, BLOCKING_TIMEOUT_MS)
    emit(entry.request)
  })
  if (decision === 'rejected') {
    throw new Error(
      `用户拒绝了本次写操作（${op}）：${entry.request.summary}（用户明确拒绝，不要重试）`
    )
  }
  if (decision === 'timeout') {
    throw new Error(
      `用户未在 ${BLOCKING_TIMEOUT_MS / 1000}s 内确认本次写操作（${op}）：${entry.request.summary}` +
        `（已自动拒绝；可以稍后重试，但不要连续重试）`
    )
  }
  entry.status = 'approved'
  entry.updatedAt = now()
  notifyUpdate(entry)
  try {
    const result = await runner()
    entry.status = 'executed'
    entry.result = result
    entry.updatedAt = now()
    emitApprovalEvent({
      stage: 'executed',
      op,
      url,
      host,
      source,
      scope: entry.scope,
      approvalId: entry.request.id,
      via: 'user',
      ok: true,
      result
    })
    notifyUpdate(entry)
    return result
  } catch (err) {
    entry.status = 'failed'
    entry.error = (err as Error).message || String(err)
    entry.updatedAt = now()
    emitApprovalEvent({
      stage: 'failed',
      op,
      url,
      host,
      source,
      scope: entry.scope,
      approvalId: entry.request.id,
      via: 'user',
      ok: false,
      error: entry.error
    })
    notifyUpdate(entry)
    throw err
  }
}

function summarize(op: string, details: WriteApprovalDetails): string {
  const bits: string[] = []
  if (details.selector) bits.push(`选择器 ${details.selector}`)
  if (details.text) bits.push(`文本「${details.text}」`)
  if (details.frame) bits.push(`框架 ${details.frame}`)
  if (details.url) bits.push(`页面 ${details.url}`)
  const where = bits.length > 0 ? bits.join(' · ') : '（无定位信息）'
  return op === 'click' ? `点击：${where}` : `滚动：${where}`
}
