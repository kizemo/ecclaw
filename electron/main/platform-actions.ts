import { spawn } from 'node:child_process'
import type { BrowserHost } from './browser-host'
import { contextBuilderSource } from './action-context'
import type { WriteSource } from './write-guard'

/**
 * 平台包动作 / 数据查询执行器（ecclaw 最小宿主原型 · 第二块）。
 *
 * 依据：docs/dabi-宿主契约-context字段清单-2026-11-02.md
 *
 * 设计要点：
 * - 真实 dabi 的 runtime.cjs 是第三方代码，**一律在独立子进程**里加载
 *   （process.execPath + ELECTRON_RUN_AS_NODE=1 退化为纯 Node），崩溃不带崩主进程。
 * - 页面在 Electron 主进程里（WebContentsView），子进程够不着 → 用 IPC 做
 *   「子进程要页面求值」的 RPC：子进程发 {type:'eval'}，主进程在页面里求值后回传。
 * - 数据查询（dataQueries）是另一条路：包内 buildExpression() 产出**表达式字符串**，
 *   由主进程拿到后放进页面执行（包内代码用 document/fetch，必须在页面上下文跑）。
 */

/** 子进程要跑的规格 */
export interface RunnerSpec {
  mode: 'data-query' | 'action' | 'extract' | 'observe'
  /** data-query：查询 id；action：能力 id；extract：页面 id（可空） */
  target: string
  /** data-query 的入参 */
  args?: Record<string, unknown>
  /** action 的入参 */
  payload?: unknown
  /** observe：持续刷新模式（poll 观察器循环产出事件，子进程常驻） */
  continuous?: boolean
  /** 传给 context 的宿主信息 */
  context: {
    tabId: number | string
    url: string
    title: string
    resourceId?: string
    pageIdentity?: string
    pageIdentitySeed?: string
    observation?: { id: string }
  }
}

export interface RunnerResult {
  /** data-query：表达式（交给主进程在页面里跑）；action/extract：动作返回值 */
  expression?: string
  value?: unknown
}

/** 包内 observations() 返回的观察器定义（dabi 契约） */
export interface ObservationSpec {
  id?: string
  mode?: 'network-response' | 'poll' | 'dom-signal'
  lifecycle?: string
  request?: { urlIncludes?: string[]; method?: string }
  captureBody?: boolean
  intervalMs?: number
  runImmediately?: boolean
  /** dom-signal：console 消息前缀 */
  signalPrefix?: string
  /** dom-signal：页面内注入脚本 */
  installScript?: string
  /** dom-signal：停止脚本 */
  stopScript?: string
}

/**
 * 子进程脚本：注入最小 @dabi/plugins SDK → 加载 runtime.cjs → 执行规格。
 * SDK 里的 browser.eval / evalPage 走 IPC 回到主进程在页面里求值。
 */
const RUNNER_SCRIPT = [
  "const { createRequire } = require('node:module')",
  "const runtimePath = process.argv[1]",
  "const spec = JSON.parse(process.argv[2])",
  "let seq = 0",
  "const pending = new Map()",
  "let eventResolve = null",
  "let readyResolve = null",
  "let pendingEvent = null",
  "function waitForEvent() {",
  "  return new Promise((resolve) => { eventResolve = resolve })",
  "}",
  "function waitReady() {",
  "  return new Promise((resolve) => { readyResolve = resolve })",
  "}",
  "function sleep(ms) {",
  "  return new Promise((resolve) => setTimeout(resolve, ms))",
  "}",
  "function rpcEval(source, options) {",
  "  return new Promise((resolve, reject) => {",
  "    const id = ++seq",
  "    pending.set(id, { resolve, reject })",
  "    const timeoutMs = options && typeof options === 'object' ? options.timeoutMs : undefined",
  "    process.send({ type: 'eval', id, source, timeoutMs })",
  "  })",
  "}",
  "function rpcOp(op, params, options) {",
  "  return new Promise((resolve, reject) => {",
  "    const id = ++seq",
  "    pending.set(id, { resolve, reject })",
  "    const timeoutMs = options && typeof options === 'object' ? options.timeoutMs : undefined",
  "    process.send({ type: 'op', id, op, params: params || {}, timeoutMs })",
  "  })",
  "}",
  "process.on('message', (msg) => {",
  "  if (msg && msg.type === 'observations-ack') {",
  "    const r = readyResolve",
  "    readyResolve = null",
  "    if (r) r()",
  "    return",
  "  }",
  "  if (msg && msg.type === 'event') {",
  "    if (readyResolve) { pendingEvent = msg.event || {}; return }",
  "    const r = eventResolve",
  "    eventResolve = null",
  "    if (r) r(msg.event || {})",
  "    return",
  "  }",
  "  if (!msg || typeof msg.id !== 'number') return",
  "  const p = pending.get(msg.id)",
  "  if (!p) return",
  "  pending.delete(msg.id)",
  "  if (msg.ok) p.resolve(msg.value)",
  "  else p.reject(new Error(String(msg.error || '页面求值失败')))",
  "})",
  "const unsupported = (name) => async () => { throw new Error('ecclaw 宿主暂不支持 ' + name) }",
  "globalThis[Symbol.for('com.dabiai.plugins.sdk')] = {",
  "  version: 1,",
  "  logger: { info() {}, warn() {}, debug() {}, error() {} },",
  "  updateActionStatus() {},",
  "  browser: {",
  "    eval: (source, options) => rpcEval(source, options),",
  "    click: (target, options) => rpcOp('click', { target: target || {}, options: options || {} }, options),",
  "    scroll: (target, options) => rpcOp('scroll', { target: target || {}, options: options || {} }, options),",
  "    interceptNext: (pattern, options) => rpcOp('intercept-next', { pattern: pattern, options: options || {} }, options),",
  "    waitForNavigation: (options) => rpcOp('wait-for-navigation', { options: options || {} }, options)",
  "  },",
  "  evalPage: (source, options) => rpcEval(source, options),",
  "  matchURL: () => false,",
  "  requestAPI: unsupported('requestAPI'),",
  "  runAutomationScript: unsupported('runAutomationScript'),",
  "  readXlsxFirstSheet: async () => null,",
  "  resourceCache: { get: async () => null, run: async (fn) => (typeof fn === 'function' ? fn() : undefined) },",
  "  saveCSV: async () => null,",
  "  saveImages: async () => null,",
  "  saveMarkdown: async () => null,",
  "  saveFiles: async () => null,",
  "  saveVideos: async () => null,",
  "  saveXLSX: async () => null,",
  "  saveText: async () => null",
  "}",
  "function loadPackage() {",
  "  const req = createRequire(runtimePath)",
  "  const loaded = req(runtimePath)",
  "  const isPkg = (v) => v && typeof v === 'object' && v.manifest && (Array.isArray(v.pages) || Array.isArray(v.tools))",
  "  const pkg = isPkg(loaded) ? loaded : loaded && isPkg(loaded.default) ? loaded.default : Object.values(loaded || {}).find(isPkg)",
  "  if (!pkg) throw new Error('runtime 未导出平台包对象')",
  "  return pkg",
  "}",
  contextBuilderSource(),
  "(async () => {",
  "  const pkg = loadPackage()",
  "  if (spec.mode === 'data-query') {",
  "    const q = pkg.dataQueries && pkg.dataQueries[spec.target]",
  "    if (!q) throw new Error('未找到数据查询：' + spec.target)",
  "    if (typeof q.buildExpression !== 'function') throw new Error('数据查询缺少 buildExpression：' + spec.target)",
  "    const expression = q.buildExpression(spec.args || {})",
  "    if (typeof expression !== 'string') throw new Error('buildExpression 未返回表达式字符串')",
  "    process.send({ type: 'result', payload: { expression } })",
  "    return",
  "  }",
  "  const pages = Array.isArray(pkg.pages) ? pkg.pages : []",
  "  if (spec.mode === 'observe') {",
  "    const page = pages.find((p) => p && p.id === spec.target) || pages[0]",
  "    if (!page) throw new Error('未找到页面：' + spec.target)",
  "    if (typeof page.observe !== 'function') throw new Error('页面不支持 observe：' + (page.id || '?'))",
  "    const base = createActionContext(spec.context || {}, { eval: rpcEval })",
  "    const list = typeof page.observations === 'function' ? (await page.observations(base)) || [] : []",
  "    process.send({ type: 'observations', list })",
  "    await waitReady()",
  "    const pollObs = (list || []).find((o) => o && o.mode === 'poll')",
  "    if (spec.continuous) {",
  "      if (!pollObs) {",
  "        process.send({ type: 'result', payload: { value: { error: '该页面没有 poll 观察器，无法持续刷新' } } })",
  "        return",
  "      }",
  "      const intervalMs = Number(pollObs.intervalMs) > 0 ? Number(pollObs.intervalMs) : 1500",
  "      const obsId = String(pollObs.id || '')",
  "      const fireNow = pollObs.runImmediately !== false",
  "      for (let i = 0; ; i++) {",
  "        if (!fireNow || i > 0) await sleep(intervalMs)",
  "        const ev = { mode: 'poll', observationId: obsId, request: {}, response: { status: 0 } }",
  "        const c = createActionContext(",
  "          Object.assign({}, spec.context || {}, { event: ev, observation: { id: obsId } }),",
  "          { eval: rpcEval }",
  "        )",
  "        let val = null",
  "        try { val = await page.observe(c) } catch (err) { val = { error: String((err && err.message) || err) } }",
  "        process.send({ type: 'poll-event', value: val === undefined ? null : val, observationId: obsId })",
  "      }",
  "    }",
  "    let event",
  "    if (pollObs) {",
  "      const intervalMs = Number(pollObs.intervalMs) > 0 ? Number(pollObs.intervalMs) : 1500",
  "      if (pollObs.runImmediately !== true) await sleep(intervalMs)",
  "      event = { mode: 'poll', observationId: String(pollObs.id || ''), request: {}, response: { status: 0 } }",
  "    } else {",
  "      event = pendingEvent || await waitForEvent()",
  "      pendingEvent = null",
  "    }",
  "    const ctx = createActionContext(",
  "      Object.assign({}, spec.context || {}, {",
  "        event: event,",
  "        observation: { id: String((event && event.observationId) || '') }",
  "      }),",
  "      { eval: rpcEval }",
  "    )",
  "    const value = await page.observe(ctx)",
  "    process.send({ type: 'result', payload: { value: value === undefined ? null : value } })",
  "    return",
  "  }",
  "  if (spec.mode === 'extract') {",
  "    const ctx = createActionContext(spec.context || {}, { eval: rpcEval })",
  "    let page = spec.target ? pages.find((p) => p && p.id === spec.target) : null",
  "    if (!page) {",
  "      page = pages.find((p) => {",
  "        if (!p || typeof p.extract !== 'function') return false",
  "        try { return typeof p.match === 'function' ? !!p.match(ctx) : false } catch { return false }",
  "      })",
  "    }",
  "    if (!page) throw new Error('未找到可提取的页面（match 未命中）')",
  "    if (typeof page.extract !== 'function') throw new Error('页面不支持 extract：' + (page.id || '?'))",
  "    const value = await page.extract(ctx)",
  "    process.send({ type: 'result', payload: { value: value === undefined ? null : value } })",
  "    return",
  "  }",
  "  let action = null",
  "  for (const p of pages) {",
  "    if (!p) continue",
  "    const fn = (p.actions && p.actions[spec.target]) || (p.automationActions && p.automationActions[spec.target])",
  "    if (fn) { action = fn; break }",
  "  }",
  "  if (!action) throw new Error('未找到动作：' + spec.target)",
  "  const ctx = createActionContext(",
  "    Object.assign({}, spec.context || {}, { capability: spec.target, payload: spec.payload }),",
  "    { eval: rpcEval }",
  "  )",
  "  const value = await action(ctx)",
  "  process.send({ type: 'result', payload: { value: value === undefined ? null : value } })",
  "})().catch((e) => {",
  "  process.send({ type: 'error', error: String((e && e.message) || e) })",
  "})"
].join('\n')

/** runRunner 的附加选项（持续观察用） */
export interface RunnerOptions {
  /** 持续模式：poll 观察器循环产出事件，promise 直到子进程退出才结算 */
  continuous?: boolean
  /** 收到一条 poll 增量事件 */
  onPollEvent?: (value: unknown, observationId: string) => void
  /** 子进程句柄（持续模式要用它来停） */
  onSpawn?: (child: import('node:child_process').ChildProcess) => void
}

/** 在子进程里跑一条包内命令，页面求值走 host 代理 */
function runRunner(
  runtimePath: string,
  spec: RunnerSpec,
  host: BrowserHost,
  timeoutMs: number,
  onObservations?: (
    list: ObservationSpec[],
    send: (msg: object) => void
  ) => void | Promise<void>,
  source: WriteSource = 'ui',
  opts?: RunnerOptions
): Promise<RunnerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['-e', RUNNER_SCRIPT, runtimePath, JSON.stringify(spec)],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      }
    )

    let settled = false
    let stderr = ''
    /** 子进程可能已经退出，回包要吞掉异常（否则变成未处理的 Promise rejection） */
    const sendToChild = (message: object): void => {
      try {
        child.send(message)
      } catch {
        // 忽略：子进程已退出
      }
    }
    // timeoutMs <= 0 = 不设超时（持续观察模式常驻，靠 stop() 结束）
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            if (settled) return
            settled = true
            child.kill()
            reject(new Error(`包内命令超时（${timeoutMs}ms）`))
          }, timeoutMs)
        : null
    opts?.onSpawn?.(child)

    const finish = (err: Error | null, value?: RunnerResult): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (err) reject(err)
      else resolve(value as RunnerResult)
    }

    child.on('message', (msg: { type?: string; id?: number; source?: string; op?: string; params?: Record<string, unknown>; timeoutMs?: number; ok?: boolean; value?: unknown; error?: string; payload?: RunnerResult; list?: ObservationSpec[]; observationId?: string }) => {
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'eval' && typeof msg.id === 'number') {
        void host
          .eval(String(msg.source ?? ''), { timeoutMs: msg.timeoutMs })
          .then((value) => sendToChild({ id: msg.id, ok: true, value }))
          .catch((err: Error) => sendToChild({ id: msg.id, ok: false, error: err.message }))
        return
      }
      if (msg.type === 'op' && typeof msg.id === 'number') {
        // 写操作：包内 browser.click / scroll / interceptNext / waitForNavigation
        void host
          .runOp(String(msg.op ?? ''), msg.params ?? {}, { timeoutMs: msg.timeoutMs, source })
          .then((value) => sendToChild({ id: msg.id, ok: true, value }))
          .catch((err: Error) => sendToChild({ id: msg.id, ok: false, error: err.message }))
        return
      }
      if (msg.type === 'observations') {
        const list = (msg.list ?? []) as ObservationSpec[]
        void (async () => {
          try {
            await onObservations?.(list, (m) => child.send(m))
          } catch {
            // 观察器安装失败也放行子进程，避免子进程永久等待
          }
          child.send({ type: 'observations-ack' })
        })()
        return
      }
      if (msg.type === 'poll-event') {
        // 持续刷新模式：子进程每轮 poll 产出一条增量事件（不结束这次执行）
        try {
          opts?.onPollEvent?.(msg.value, String(msg.observationId ?? ''))
        } catch {
          /* 消费方异常不影响子进程 */
        }
        return
      }
      if (msg.type === 'result') {
        finish(null, msg.payload ?? {})
        return
      }
      if (msg.type === 'error') {
        finish(new Error(String(msg.error ?? '包内命令失败')))
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (err) => {
      finish(new Error(err.message))
    })

    child.on('close', (code) => {
      const detail = stderr.trim().slice(0, 400)
      finish(new Error(`包内命令异常退出（code=${code}）${detail ? '：' + detail : ''}`))
    })
  })
}

export interface HostCommandResult {
  ok: boolean
  /** data-query 时是表达式；action/extract 时是动作返回值 */
  expression?: string
  value?: unknown
  error?: string
  durationMs: number
}

/** 执行一条包内数据查询：子进程取表达式 → 主进程在页面里求值 */
export async function runDataQuery(
  runtimePath: string,
  queryId: string,
  args: Record<string, unknown>,
  host: BrowserHost
): Promise<HostCommandResult> {
  const started = Date.now()
  const info = host.info()
  try {
    const spec: RunnerSpec = {
      mode: 'data-query',
      target: queryId,
      args,
      context: { tabId: info.tabId, url: info.url, title: info.title }
    }
    const out = await runRunner(runtimePath, spec, host, 30000)
    if (!out.expression) throw new Error('数据查询未产出表达式')
    const value = await host.eval(out.expression, { timeoutMs: 30000 })
    return { ok: true, expression: out.expression, value, durationMs: Date.now() - started }
  } catch (err) {
    return { ok: false, error: (err as Error).message, durationMs: Date.now() - started }
  }
}

/** 执行一条包内页面动作（page.actions[capability]） */
export async function runPageAction(
  runtimePath: string,
  capability: string,
  payload: unknown,
  host: BrowserHost,
  source: WriteSource = 'ui'
): Promise<HostCommandResult> {
  const started = Date.now()
  const info = host.info()
  try {
    // 动作里可能用 browser.interceptNext 抓接口响应 → 先开网络捕获
    await host.enableNetworkCapture()
    const spec: RunnerSpec = {
      mode: 'action',
      target: capability,
      payload,
      context: { tabId: info.tabId, url: info.url, title: info.title }
    }
    const out = await runRunner(runtimePath, spec, host, 60000, undefined, source)
    return { ok: true, value: out.value, durationMs: Date.now() - started }
  } catch (err) {
    return { ok: false, error: (err as Error).message, durationMs: Date.now() - started }
  }
}

/** 执行页面提取（page.extract(context) —— 只读读 DOM 的标准入口） */
export async function runPageExtract(
  runtimePath: string,
  pageId: string | undefined,
  host: BrowserHost
): Promise<HostCommandResult> {
  const started = Date.now()
  const info = host.info()
  try {
    const spec: RunnerSpec = {
      mode: 'extract',
      target: pageId ?? '',
      context: { tabId: info.tabId, url: info.url, title: info.title }
    }
    const out = await runRunner(runtimePath, spec, host, 60000)
    return { ok: true, value: out.value, durationMs: Date.now() - started }
  } catch (err) {
    return { ok: false, error: (err as Error).message, durationMs: Date.now() - started }
  }
}

/**
 * 执行一次页面观察（page.observe(context)）。
 *
 * dabi 的 observe 路径：包内 `observations(context)` 给出观察器定义
 * （mode=network-response + request.urlIncludes/method + captureBody），
 * 宿主在页面上匹配到对应响应后，把事件（request/response/bodyText/base64Encoded）
 * 作为 `context.event` 喂给 `page.observe(context)`。
 *
 * 事件捕获用 CDP Network 域（Electron 的 webRequest 拿不到响应体）。
 */
/**
 * 安装包内声明的观察器（network-response / dom-signal）。
 * poll 观察器不需要装 —— 它由子进程按 intervalMs 循环触发。
 */
async function installObservers(
  host: BrowserHost,
  list: ObservationSpec[],
  send: (msg: object) => void
): Promise<void> {
  const matchers = list
    .filter((o) => o.mode === 'network-response')
    .map((o) => ({
      observationId: String(o.id ?? ''),
      urlIncludes: o.request?.urlIncludes ?? [],
      method: o.request?.method,
      captureBody: o.captureBody !== false
    }))
  host.setNetworkMatchers(matchers)
  host.onNetworkEvent((event) => {
    send({ type: 'event', event })
  })

  // dom-signal：包内给一段注入脚本 + console 前缀，宿主注入页面并监听 console 消息
  // 先挂回调再注入（注入脚本可能立刻打 console 消息）
  const signalObs = list.find((o) => o.mode === 'dom-signal' && o.installScript)
  if (signalObs) {
    host.onDomSignal((event) => {
      send({ type: 'event', event })
    })
    await host.installDomSignal({
      script: String(signalObs.installScript ?? ''),
      stopScript: signalObs.stopScript,
      prefix: String(signalObs.signalPrefix ?? ''),
      observationId: String(signalObs.id ?? '')
    })
  }
}

export async function runPageObserve(
  runtimePath: string,
  pageId: string | undefined,
  host: BrowserHost
): Promise<HostCommandResult> {
  const started = Date.now()
  const info = host.info()
  try {
    await host.enableNetworkCapture()
    const spec: RunnerSpec = {
      mode: 'observe',
      target: pageId ?? '',
      context: { tabId: info.tabId, url: info.url, title: info.title }
    }
    const out = await runRunner(runtimePath, spec, host, 45000, (list, send) =>
      installObservers(host, list, send)
    )
    return { ok: true, value: out.value, durationMs: Date.now() - started }
  } catch (err) {
    return { ok: false, error: (err as Error).message, durationMs: Date.now() - started }
  } finally {
    host.onNetworkEvent(null)
    host.setNetworkMatchers([])
    host.onDomSignal(null)
    await host.stopDomSignal()
  }
}

/** 持续观察的句柄 */
export interface ContinuousObserveHandle {
  stop(): void
  /** 子进程结束时的结果（null = 被停掉 / 异常退出） */
  done: Promise<RunnerResult | null>
}

/**
 * 启动一个**持续**的 poll 观察（dabi 的「侧栏持续刷新」语义）。
 *
 * 与 runPageObserve 的区别：后者跑一次就结束；这里子进程常驻，
 * 按包内 poll 观察器的 intervalMs 循环调用 page.observe，每轮产出一条增量事件。
 * 事件由 onEvent 回调交给调用方（宿主事件总线），调用方可以：
 * - 推给渲染进程（界面增量更新）
 * - 被 agent 长轮询取走（ecclaw_next_event）
 */
export function startContinuousObserve(
  runtimePath: string,
  pageId: string | undefined,
  host: BrowserHost,
  onEvent: (value: unknown, observationId: string) => void
): ContinuousObserveHandle {
  const info = host.info()
  const spec: RunnerSpec = {
    mode: 'observe',
    target: pageId ?? '',
    continuous: true,
    context: { tabId: info.tabId, url: info.url, title: info.title }
  }
  let child: import('node:child_process').ChildProcess | null = null
  let stopped = false
  const done = runRunner(
    runtimePath,
    spec,
    host,
    0,
    (list, send) => installObservers(host, list, send),
    'ui',
    {
      continuous: true,
      onSpawn: (c) => {
        child = c
      },
      onPollEvent: (value, observationId) => {
        if (!stopped) onEvent(value, observationId)
      }
    }
  )
    .then((r) => r)
    .catch(() => null)
  return {
    stop: () => {
      stopped = true
      try {
        child?.kill()
      } catch {
        /* 子进程可能已经退出 */
      }
    },
    done
  }
}
