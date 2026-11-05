/**
 * dabi 形状的「动作 context」适配层。
 *
 * 依据：docs/dabi-宿主契约-context字段清单-2026-11-02.md §2。
 * 字段严格按实测清单给全，宁可多给（宿主侧填 null/空串）也不能缺——
 * 包内代码直接解构使用（如 `context.payload`、`context.signal?.throwIfAborted()`）。
 *
 * 这份实现同时被两处使用：
 * - 平台包 runner（独立子进程）：通过 `contextBuilderSource()` 把函数源码内联进脚本，
 *   保证主进程与子进程用的是**同一份** context 构造逻辑，不会漂移。
 * 因此函数体不得引用模块外部的变量（打包后取到的源码会缺标识符）。
 */

/** 宿主提供给 context 的能力桥 */
export interface ActionContextBridge {
  /** 在页面里执行表达式，回传结构化值 */
  eval(source: string, options?: { timeoutMs?: number }): Promise<unknown>
}

/** 事件（网络响应 / 轮询 / DOM 信号） */
export interface ActionEvent {
  mode: 'network-response' | 'poll' | 'dom-signal'
  request?: {
    url?: string
    method?: string
    headers?: Record<string, string>
    postData?: string
  }
  response?: { status?: number }
  bodyText?: string
  base64Encoded?: boolean
  message?: string
}

/** 观察器定义（只暴露包内实际用到的 id） */
export interface ActionObservation {
  id: string
}

export interface ActionContextInit {
  tabId: number | string
  url: string
  title: string
  capability?: string
  actionId?: string
  payload?: unknown
  resourceId?: string
  pageIdentity?: string
  pageIdentitySeed?: string
  observation?: ActionObservation
  event?: ActionEvent
  signal?: AbortSignal
}

/** 生成 dabi 形状的 context（字段名与 dabi 完全一致） */
export function createActionContext(
  init: ActionContextInit,
  bridge: ActionContextBridge
): Record<string, unknown> {
  const seed = init.pageIdentitySeed ?? init.pageIdentity ?? init.url
  const context: Record<string, unknown> = {
    tabId: init.tabId,
    url: init.url,
    title: init.title,
    capability: init.capability ?? '',
    actionId: init.actionId ?? init.capability ?? '',
    payload: init.payload ?? {},
    resourceId: init.resourceId ?? '',
    pageIdentity: init.pageIdentity ?? seed,
    pageIdentitySeed: init.pageIdentitySeed ?? seed,
    signal: init.signal ?? new AbortController().signal,
    sleep: (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0))),
    eval: (source: string, options?: { timeoutMs?: number }) => bridge.eval(source, options),
    evaluate: (source: string, options?: { timeoutMs?: number }) => bridge.eval(source, options)
  }
  if (init.observation) context.observation = init.observation
  if (init.event) context.event = init.event
  return context
}

/**
 * 供平台包 runner（子进程）内联的 JS 源码。
 * 直接取函数源码，保证两边 context 构造逻辑一致。
 */
export function contextBuilderSource(): string {
  return `const createActionContext = ${createActionContext.toString()};`
}
