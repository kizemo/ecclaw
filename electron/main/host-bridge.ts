import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { paths } from './paths'
import {
  hostOpen,
  hostReadDom,
  hostRunAction,
  hostRunDataQuery,
  hostRunExtract,
  hostRunObserve,
  hostStartWatch,
  hostStopWatch,
  hostListWatches,
  hostNextEvent,
  hostReplayEvents,
  hostEventLogInfo,
  hostEventSummary,
  hostExportEvents,
  hostEventExports,
  hostGuardRuleGroups,
  hostClearSessionGuardRules,
  hostRemoveGuardRules,
  hostStatus,
  hostProfiles,
  hostUseProfile,
  hostWriteOp
} from './host-service'
import { listPackages } from './platform-packages'
import { listDocuments, previewDocument } from './document-preview'
import { loadAllCapabilities } from './platform-runtime'
import { listHostEvents, subscribeHostEvents } from './host-events'
import { approvalStatus } from './write-guard'

/**
 * 解析桥参数里的 kind 列表（第十七阶段的多选过滤）。
 *
 * 只认三种已知 kind；认不出就当没传（不因为脏数据报错）。
 * 空数组同样当没传 —— 语义是「不限」。
 */
function parseKinds(value: unknown): ('observe' | 'approval' | 'page')[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: ('observe' | 'approval' | 'page')[] = []
  for (const v of value) {
    if (v === 'observe' || v === 'approval' || v === 'page') out.push(v)
  }
  return out.length > 0 ? out : undefined
}

/**
 * 宿主桥（loopback HTTP）—— 让 openclaw 内核里的 MCP 服务能回调 ecclaw 主进程。
 *
 * 为什么需要这一层：
 * MCP 服务进程由 openclaw 拉起（openclaw 的孙子进程），够不到 Electron 主进程；
 * 而宿主能力（WebContentsView、平台包执行器）只在主进程里。
 * 于是：MCP 服务 → 127.0.0.1 HTTP + token → 主进程 → 宿主能力。
 *
 * 安全：只绑 127.0.0.1；每个请求必须带 x-ecclaw-token（token 随机生成，
 * 随端点信息写在 <stateDir>/host-bridge.json，权限随用户目录）。
 */

export interface HostBridgeEndpoint {
  port: number
  token: string
  pid: number
  startedAt: string
  file: string
}

let server: http.Server | null = null
let endpoint: HostBridgeEndpoint | null = null

/** 端点文件路径（agent 侧通过 ECCLAW_HOST_BRIDGE_FILE 拿到） */
export function hostBridgeFile(): string {
  return path.join(paths.openclawStateDir(), 'host-bridge.json')
}

export function hostBridgeStatus(): HostBridgeEndpoint | null {
  return endpoint
}

function writeEndpointFile(ep: HostBridgeEndpoint): void {
  const file = hostBridgeFile()
  fs.mkdirSync(paths.openclawStateDir(), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(ep, null, 2)}\n`, 'utf8')
}

/** 能力目录（给 agent 看：哪个包、哪些页面、哪些动作 id） */
async function capabilitiesPayload(): Promise<unknown> {
  const packages = listPackages()
  const caps = await loadAllCapabilities()
  const byId = new Map(caps.map((c) => [c.packageId, c]))
  return {
    packages: packages.map((pkg) => {
      const c = byId.get(pkg.manifest.packageId)
      return {
        packageId: pkg.manifest.packageId,
        displayName: pkg.manifest.displayName,
        version: pkg.manifest.version,
        sites: pkg.manifest.sites ?? [],
        match: [...new Set([...(pkg.registry?.match ?? []), ...(pkg.manifest.match ?? [])])],
        pages: (c?.pages ?? []).map((p) => ({
          id: p.id,
          actions: p.actions,
          automationActions: p.automationActions,
          observations: p.observations
        })),
        dataQueries: c?.dataQueries ?? [],
        tools: (c?.tools ?? []).map((t) => ({ name: t.name, description: t.description })),
        error: c?.error
      }
    })
  }
}

async function dispatch(op: string, params: Record<string, unknown>): Promise<unknown> {
  const url = typeof params.url === 'string' ? params.url : undefined
  switch (op) {
    case 'status':
      return hostStatus()
    case 'capabilities':
      return capabilitiesPayload()
    case 'open':
      return hostOpen(String(params.url ?? ''))
    case 'read-dom':
      return hostReadDom(String(params.url ?? ''))
    case 'action':
      return hostRunAction(
        String(params.packageId ?? ''),
        String(params.capability ?? ''),
        JSON.stringify(params.payload ?? {}),
        url,
        'agent'
      )
    case 'click':
      return hostWriteOp('click', {
        target: {
          selector: params.selector,
          text: params.text,
          frame: params.frame
        },
        options: { timeoutMs: params.timeoutMs, humanize: params.humanize }
      })
    case 'scroll':
      return hostWriteOp('scroll', {
        target: {
          deltaY: params.deltaY,
          target: params.selector
            ? { selector: String(params.selector), frame: params.frame }
            : undefined
        },
        options: { timeoutMs: params.timeoutMs, humanize: params.humanize }
      })
    case 'intercept-next':
      return hostWriteOp('intercept-next', {
        pattern: String(params.pattern ?? ''),
        options: { timeoutMs: params.timeoutMs }
      })
    case 'wait-for-navigation':
      return hostWriteOp('wait-for-navigation', { options: { timeoutMs: params.timeoutMs } })
    case 'approval-status':
      return approvalStatus(String(params.approvalId ?? ''))
    case 'data-query':
      return hostRunDataQuery(
        String(params.packageId ?? ''),
        String(params.queryId ?? ''),
        JSON.stringify(params.args ?? {}),
        url
      )
    case 'extract':
      return hostRunExtract(String(params.packageId ?? ''), params.pageId as string | undefined, url)
    case 'observe':
      return hostRunObserve(String(params.packageId ?? ''), params.pageId as string | undefined, url)
    case 'watch':
      return hostStartWatch(String(params.packageId ?? ''), params.pageId as string | undefined)
    case 'watch-stop':
      return hostStopWatch(String(params.watchId ?? ''))
    case 'watch-list':
      return hostListWatches()
    case 'next-event':
      return hostNextEvent(
        Number(params.sinceSeq ?? 0),
        Math.min(Number(params.timeoutMs ?? 30000), 55_000)
      )
    case 'event-replay':
      return hostReplayEvents({
        sinceSeq: params.sinceSeq === undefined ? undefined : Number(params.sinceSeq),
        untilSeq: params.untilSeq === undefined ? undefined : Number(params.untilSeq),
        sinceAt: typeof params.sinceAt === 'string' ? params.sinceAt : undefined,
        untilAt: typeof params.untilAt === 'string' ? params.untilAt : undefined,
        packageId: typeof params.packageId === 'string' ? params.packageId : undefined,
        pageId: typeof params.pageId === 'string' ? params.pageId : undefined,
        kind: typeof params.kind === 'string' ? (params.kind as 'observe' | 'approval' | 'page') : undefined,
        kinds: parseKinds(params.kinds),
        limit: params.limit === undefined ? undefined : Number(params.limit)
      })
    case 'event-log-info':
      return hostEventLogInfo()
    case 'event-summary':
      return hostEventSummary(
        {
          sinceSeq: params.sinceSeq === undefined ? undefined : Number(params.sinceSeq),
          untilSeq: params.untilSeq === undefined ? undefined : Number(params.untilSeq),
          sinceAt: typeof params.sinceAt === 'string' ? params.sinceAt : undefined,
          untilAt: typeof params.untilAt === 'string' ? params.untilAt : undefined,
          packageId: typeof params.packageId === 'string' ? params.packageId : undefined,
          pageId: typeof params.pageId === 'string' ? params.pageId : undefined,
          kind: typeof params.kind === 'string' ? (params.kind as 'observe' | 'approval' | 'page') : undefined,
          kinds: parseKinds(params.kinds)
        },
        { bucket: params.bucket === 'hour' ? 'hour' : 'day' }
      )
    case 'event-export':
      return hostExportEvents(
        {
          sinceSeq: params.sinceSeq === undefined ? undefined : Number(params.sinceSeq),
          untilSeq: params.untilSeq === undefined ? undefined : Number(params.untilSeq),
          sinceAt: typeof params.sinceAt === 'string' ? params.sinceAt : undefined,
          untilAt: typeof params.untilAt === 'string' ? params.untilAt : undefined,
          packageId: typeof params.packageId === 'string' ? params.packageId : undefined,
          pageId: typeof params.pageId === 'string' ? params.pageId : undefined,
          kind: typeof params.kind === 'string' ? (params.kind as 'observe' | 'approval' | 'page') : undefined,
          kinds: parseKinds(params.kinds)
        },
        {
          format: params.format === 'csv' ? 'csv' : 'jsonl',
          splitByKind: params.splitByKind === true
        }
      )
    case 'event-exports':
      // agent 侧**只列不删**：导出物是用户主动产物，删除权留在人手上（红线）。
      return hostEventExports()
    case 'guard-rules':
      return hostGuardRuleGroups()
    case 'guard-rules-clear-session':
      return hostClearSessionGuardRules()
    case 'guard-rules-remove':
      return hostRemoveGuardRules(
        String(params.host ?? ''),
        typeof params.path === 'string' ? params.path : undefined,
        params.scope === 'session' || params.scope === 'persistent' ? params.scope : 'all'
      )
    case 'profiles':
      // 店铺登录态 profile（第十五阶段）：agent 看看有哪些店铺、当前在哪个店。
      // **只读 + 切换**：新建要人起名、移除涉及用户登录数据，都留在界面里做。
      return hostProfiles()
    case 'profile-use':
      return hostUseProfile(String(params.id ?? ''))
    case 'document-list':
      // 文件库文档清单（第二十一阶段）：只读，agent 先知道有哪些文件再点名预览。
      return listDocuments()
    case 'document-preview':
      // 文档预览（第二十一阶段）：只读，本地解析，不外发。
      return previewDocument({
        path: typeof params.path === 'string' ? params.path : undefined,
        name: typeof params.name === 'string' ? params.name : undefined,
        maxPages: params.maxPages === undefined ? undefined : Number(params.maxPages),
        maxChars: params.maxChars === undefined ? undefined : Number(params.maxChars)
      })
    default:
      throw new Error(`未知的宿主操作：${op}`)
  }
}

/**
 * 事件主动推送通道（SSE）：`GET /events?sinceSeq=N`
 *
 * 为什么要在桥上加这一条：
 * MCP 是 stdio 传输，服务端没法把消息「推」给 agent（没有服务端主动通知的语义）。
 * 于是 agent 只能长轮询（ecclaw_next_event）：想知道有没有新事件就得挂住一个调用，
 * 而挂住期间这个调用是一直占着的。
 *
 * SSE 是另一种形状：MCP 进程常驻一条连接，宿主一有新事件就推过来，
 * agent 随时取件、取不到立刻返回 —— 没有长请求，也不用轮询。
 *
 * 安全：与 /rpc 一样要求 x-ecclaw-token，且只绑 127.0.0.1。
 */
function openEventStream(req: http.IncomingMessage, res: http.ServerResponse, token: string): void {
  if (req.headers['x-ecclaw-token'] !== token) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: '宿主桥接令牌不匹配' }))
    return
  }
  const url = new URL(req.url ?? '/events', 'http://127.0.0.1')
  const sinceSeq = Number(url.searchParams.get('sinceSeq') ?? 0) || 0
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive'
  })
  res.write(': ecclaw host events\n\n')
  // 补发断线期间的增量（内存环形缓冲最多 200 条，够补一个短断线）
  for (const ev of listHostEvents(sinceSeq)) {
    res.write(`event: host-event\ndata: ${JSON.stringify(ev)}\n\n`)
  }
  const unsubscribe = subscribeHostEvents((ev) => {
    if (ev.seq <= sinceSeq) return
    try {
      res.write(`event: host-event\ndata: ${JSON.stringify(ev)}\n\n`)
    } catch {
      /* 客户端已断开 */
    }
  })
  // 心跳：没有事件时也要保持连接（有些代理会掐掉静默连接）
  const keepAlive = setInterval(() => {
    try {
      res.write(': keepalive\n\n')
    } catch {
      /* 客户端已断开 */
    }
  }, 15_000)
  const cleanup = (): void => {
    clearInterval(keepAlive)
    unsubscribe()
  }
  req.on('close', cleanup)
  req.on('error', cleanup)
}

/** 启动桥接服务器（app ready 时调用） */
export function startHostBridge(): HostBridgeEndpoint {
  if (endpoint) return endpoint
  const token = crypto.randomBytes(24).toString('hex')
  const srv = http.createServer((req, res) => {
    const reply = (status: number, body: unknown): void => {
      const text = JSON.stringify(body)
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(text)
      })
      res.end(text)
    }
    const pathname = (req.url ?? '').split('?')[0]
    if (req.method === 'GET' && pathname === '/events') {
      openEventStream(req, res, token)
      return
    }
    if (req.method !== 'POST' || pathname !== '/rpc') {
      reply(404, { error: '仅支持 POST /rpc 与 GET /events' })
      return
    }
    if (req.headers['x-ecclaw-token'] !== token) {
      reply(403, { error: '宿主桥接令牌不匹配' })
      return
    }
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString()
    })
    req.on('end', () => {
      void (async () => {
        try {
          const body = JSON.parse(raw || '{}') as { op?: string; params?: Record<string, unknown> }
          const op = String(body.op ?? '')
          const params = body.params && typeof body.params === 'object' ? body.params : {}
          const result = await dispatch(op, params)
          reply(200, { result })
        } catch (err) {
          reply(500, { error: (err as Error).message || String(err) })
        }
      })()
    })
  })
  srv.on('error', (err) => {
    process.stderr.write(`[ecclaw] 宿主桥接启动失败：${err.message}\n`)
  })
  srv.listen(0, '127.0.0.1', () => {
    const addr = srv.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    endpoint = {
      port,
      token,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      file: hostBridgeFile()
    }
    writeEndpointFile(endpoint)
    process.stdout.write(`[ecclaw] 宿主桥接已监听 127.0.0.1:${port}\n`)
  })
  server = srv
  return endpoint ?? { port: 0, token, pid: process.pid, startedAt: new Date().toISOString(), file: hostBridgeFile() }
}

export function stopHostBridge(): void {
  if (server) {
    server.close()
    server = null
  }
  endpoint = null
}
