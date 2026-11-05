import { BrowserWindow, WebContentsView } from 'electron'
import { requestWriteApproval, runWithWriteApproval, type WriteSource } from './write-guard'
import { pushHostEvent } from './host-events'

/**
 * 内嵌浏览器宿主（ecclaw 最小宿主原型）。
 *
 * 依据：docs/dabi-宿主契约-context字段清单-2026-11-02.md
 * 平台包从不直接接触 webContents —— 与页面之间唯一的桥是 `context.eval(source)`，
 * 返回值必须是**结构化值**（taobao 包里写的是 `const state = await context.eval(JS)`
 * 然后直接访问 `state.url` / `state.data`）。
 *
 * 页面用 Electron 的 WebContentsView 承载，挂在主窗口 contentView 下；
 * 渲染进程把「占位盒」的 getBoundingClientRect 传过来，宿主据此摆位（可见内嵌浏览器）。
 * 安全：sandbox + contextIsolation + nodeIntegration=false，页面拿不到 Node 能力。
 */

export interface HostPageInfo {
  /** 宿主分配的标签页 id（对齐 dabi 的 context.tabId） */
  tabId: number
  url: string
  title: string
}

export interface HostEvalOptions {
  timeoutMs?: number
}

/** 宿主页面在主窗口里的可视区域（渲染进程测得，主进程据此摆放 WebContentsView） */
export interface HostViewportBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 宿主页面的持久化 partition（第十阶段）。
 *
 * 为什么要有：真实站点（淘宝/抖音小店…）的观察与提取往往要登录态才有意义。
 * 用默认 session 的话 cookie 跟宿主自己的渲染进程混在一起，而且
 * 「Electron 退出 → 重启」之间的登录态保留行为不可控。
 * 独立 partition 后，cookie / localStorage 落在
 * `<userData>/Partitions/ecclaw-host/`，重启后仍在 —— 用户登录一次，
 * agent 之后就能在登录态下继续读页面。
 *
 * `persist:` 前缀是 Electron 的约定：不加前缀的 partition 是内存态，退出即丢。
 */
export const HOST_PARTITION = 'persist:ecclaw-host'

/** 宿主捕获到的网络事件（对齐 dabi 的 context.event，mode=network-response） */
export interface HostNetworkEvent {
  mode: 'network-response'
  request: {
    url: string
    method: string
    headers: Record<string, string>
    postData?: string
  }
  response: { status: number }
  bodyText?: string
  base64Encoded?: boolean
  /** 命中的观察器 id（对应 context.observation.id） */
  observationId?: string
}

/** 观察器的请求匹配条件（来自包内 observations() 的 request 段） */
export interface HostNetworkMatcher {
  observationId?: string
  urlIncludes?: string[]
  method?: string
  captureBody?: boolean
}

/** dom-signal 模式：页面内脚本通过 console 消息上报（对齐 dabi 的 context.event.mode='dom-signal'） */
export interface HostDomSignalEvent {
  mode: 'dom-signal'
  /** 页面 console 输出的原始消息（前缀 + 负载） */
  message: string
  /** 包内约定的消息前缀 */
  prefix: string
  /** 命中的观察器 id（对应 context.observation.id） */
  observationId?: string
}

/** 页面求值结果（与 dabi 的 context.eval 返回类型一致：结构化值） */
export type HostEvalResult = unknown

/** 页面 DOM 概览（宿主只读动作的返回） */
export interface DomSnapshot {
  url: string
  title: string
  h1: string
  itemCount: number
  itemTexts: string[]
  bodyText: string
  linkCount: number
}

/**
 * 宿主隐藏时的「离屏布局尺寸」。
 * 隐藏不能真的把 view 收成 0×0：那样页面布局宽度为 0，元素 getBoundingClientRect 全是 0，
 * 写操作（点击坐标、滚动落点）就无从计算。改成「有尺寸但不显示」。
 */
const HIDDEN_LAYOUT = { x: 0, y: 0, width: 1280, height: 800 }

/** 写操作的目标描述（对齐 dabi 的 browser.* 入参） */
export interface WriteTarget {
  /** CSS 选择器 */
  selector?: string
  /** 元素文本（配合 selector 一起用：选中文字命中的那个） */
  text?: string
  /** 所在 iframe 的选择器（宿主用 contentDocument 进入同源 iframe） */
  frame?: string
}

/** 写操作选项（对齐 dabi 的第二参数） */
export interface WriteOptions {
  timeoutMs?: number
  /** 拟人化：加随机延迟与坐标抖动 */
  humanize?: boolean
}

export class BrowserHost {
  private view: WebContentsView | null = null
  private tabSeq = 0
  /** 当前可视区域（null = 隐藏，只作为「可求值的页面容器」存在） */
  private viewport: HostViewportBounds | null = null
  /** CDP Network 域：requestId → 请求信息 */
  private netRequests = new Map<string, { url: string; method: string; headers: Record<string, string>; postData?: string; status?: number }>()
  private netMatchers: HostNetworkMatcher[] = []
  private netListener: ((event: HostNetworkEvent) => void) | null = null
  /** dom-signal：console 监听器与包内给的停止脚本 */
  private domSignalListener: ((event: HostDomSignalEvent) => void) | null = null
  /** 监听器还没挂上时先存着（注入脚本可能立刻触发 console 消息） */
  private domSignalPending: HostDomSignalEvent | null = null
  private domSignalPrefix = ''
  private domSignalObservationId = ''
  private domSignalStopScript: string | null = null
  private consoleListenerAttached = false
  /** 写操作：等待中的「下一次匹配请求」拦截器 */
  private interceptors: Array<{
    pattern: string
    resolve: (value: unknown) => void
    reject: (err: Error) => void
    timer: NodeJS.Timeout
  }> = []
  /**
   * 当前登录态 profile 对应的 partition（第十五阶段：店铺登录态 profile）。
   * 默认值就是第十阶段那个 `persist:ecclaw-host`（含已有的登录态，一个字符都不改）。
   */
  private partition: string = HOST_PARTITION

  constructor(private readonly owner: BrowserWindow, partition: string = HOST_PARTITION) {
    this.partition = partition
  }

  private ensureView(): WebContentsView {
    if (!this.view) {
      const view = new WebContentsView({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          // 第十阶段：独立持久化 partition —— 登录态（cookie / localStorage）在
          // 应用重启后保留，agent 才能在用户登录过的站点上继续干活。
          // 用独立 partition 而不是默认 session，是为了别跟宿主自己的渲染进程共享 cookie。
          // 第十五阶段：partition 由「店铺登录态 profile」决定（默认仍是 HOST_PARTITION）。
          partition: this.partition
        }
      })
      this.owner.contentView.addChildView(view)
      this.view = view
      this.applyViewport()
    }
    return this.view
  }

  /**
   * 切换登录态 partition（第十五阶段：店铺登录态 profile）。
   *
   * 实现要点：
   * - 换 partition **必须重建 view** —— partition 是 webPreferences 的创建期参数，改不动已有 view；
   * - 旧 view 直接销毁（cookie 落在磁盘上，不受影响），下次 ensureView 按新 partition 重建；
   * - viewport 要留着：close() 会把 viewport 清成 null，不恢复的话内嵌浏览器会「看不见」
   *   （占位盒还在、页面却不在屏幕上）。
   */
  async usePartition(partition: string): Promise<void> {
    if (partition === this.partition) return
    const box = this.viewport
    await this.close()
    this.viewport = box
    this.partition = partition
  }

  /**
 * 把可视区域套用到 view 上。
 * 隐藏时不能收成 0×0（那样页面布局宽度为 0，元素坐标全废），
 * 也不能挪到画面外（那样视口宽度会被裁成 0）——
 * 实测只有「保持 1280×800 布局 + setVisible(false)」能拿到正确布局。
 * 代价：隐藏的 widget 不接收 CDP 真实鼠标事件（实测点击无效），
 * 所以隐藏态走 DOM 点击，可见态才派发真实鼠标事件。
 */
  private applyViewport(): void {
    const view = this.view
    if (!view) return
    const box = this.viewport
    if (!box || box.width <= 0 || box.height <= 0) {
      view.setBounds(HIDDEN_LAYOUT)
      view.setVisible(false)
    } else {
      view.setBounds({ x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) })
      view.setVisible(true)
    }
  }

  /** 宿主页面当前是否真的显示在屏幕上（决定走真实鼠标事件还是 DOM 事件） */
  private get pageVisible(): boolean {
    const box = this.viewport
    return !!box && box.width > 0 && box.height > 0
  }

  /**
   * 设置宿主页面在主窗口里的位置（渲染进程把占位盒的 getBoundingClientRect 传进来）。
   * 传 null 表示隐藏宿主页面。
   */
  setViewport(bounds: HostViewportBounds | null): void {
    this.viewport = bounds
    this.applyViewport()
  }

  /** 当前页面信息（未打开任何页面时 url/title 为空串） */
  info(): HostPageInfo {
    const wc = this.view?.webContents
    return {
      tabId: this.tabSeq,
      url: wc?.getURL() ?? '',
      title: wc?.getTitle() ?? ''
    }
  }

  /** 宿主当前状态（页面信息 + 摆放位置） */
  status(): { info: HostPageInfo; bounds: HostViewportBounds | null } {
    return { info: this.info(), bounds: this.viewport }
  }

  /**
   * 打开 CDP Network 域，开始捕获宿主页面的网络请求/响应。
   * dabi 的 observe 路径依赖它：`page.observations()` 给出 urlIncludes/method，
   * 宿主匹配到响应后把 body 喂给 `page.observe(context)`。
   */
  async enableNetworkCapture(): Promise<void> {
    const wc = this.ensureDebugger()
    await wc.debugger.sendCommand('Network.enable')
  }

  /**
   * 挂上 CDP 调试器（写操作要发 Input.* 事件，必须先 attach）。
   * 刻意做成**同步**：interceptNext 要在收到 RPC 的同一拍就登记拦截器，
   * 中间任何 await 都会让后续 eval 触发的请求抢先发出。
   */
  private ensureDebugger(): Electron.WebContents {
    const wc = this.ensureView().webContents
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3')
      wc.debugger.on('message', (_event, method, params) => {
        void this.onDebuggerMessage(method, params as Record<string, unknown>)
      })
    }
    return wc
  }

  /** 设置请求匹配条件（来自包内 observations()） */
  setNetworkMatchers(matchers: HostNetworkMatcher[]): void {
    this.netMatchers = matchers
  }

  /** 注册网络事件回调（observe 执行器用） */
  onNetworkEvent(listener: ((event: HostNetworkEvent) => void) | null): void {
    this.netListener = listener
  }

  /** 注册 dom-signal 回调（observe 执行器用） */
  onDomSignal(listener: ((event: HostDomSignalEvent) => void) | null): void {
    this.domSignalListener = listener
    if (listener && this.domSignalPending) {
      const pending = this.domSignalPending
      this.domSignalPending = null
      listener(pending)
    }
  }

  /**
   * dom-signal 模式：把包内给的注入脚本装进页面，并监听 console 消息前缀。
   * 包内脚本形如 `console.info('prefix:changed')`，宿主据此还原「页面主动上报」事件。
   */
  async installDomSignal(opts: {
    script: string
    stopScript?: string
    prefix: string
    observationId?: string
  }): Promise<void> {
    const wc = this.ensureView().webContents
    this.domSignalPrefix = opts.prefix
    this.domSignalObservationId = opts.observationId ?? ''
    this.domSignalStopScript = opts.stopScript ?? null
    if (!this.consoleListenerAttached) {
      this.consoleListenerAttached = true
      // Electron 45：console-message 的第一个参数即 Event<WebContentsConsoleMessageEventParams>
      wc.on('console-message', (event) => {
        const message = String(event?.message ?? '')
        const prefix = this.domSignalPrefix
        if (!prefix || !message.startsWith(prefix)) return
        const signal: HostDomSignalEvent = {
          mode: 'dom-signal',
          message,
          prefix,
          observationId: this.domSignalObservationId
        }
        if (this.domSignalListener) this.domSignalListener(signal)
        else this.domSignalPending = signal
      })
    }
    await wc.executeJavaScript(opts.script, true)
  }

  /** 停止 dom-signal：跑包内的 stopScript 并摘掉回调 */
  async stopDomSignal(): Promise<void> {
    const stop = this.domSignalStopScript
    this.domSignalStopScript = null
    this.domSignalPrefix = ''
    this.domSignalListener = null
    this.domSignalPending = null
    if (!stop) return
    try {
      await this.ensureView().webContents.executeJavaScript(stop, true)
    } catch {
      // 页面可能已关闭，忽略
    }
  }

  private async onDebuggerMessage(method: string, params: Record<string, unknown>): Promise<void> {
    if (method === 'Network.requestWillBeSent') {
      const request = (params.request ?? {}) as Record<string, unknown>
      const id = String(params.requestId ?? '')
      this.netRequests.set(id, {
        url: String(request.url ?? ''),
        method: String(request.method ?? 'GET'),
        headers: (request.headers ?? {}) as Record<string, string>,
        postData: typeof request.postData === 'string' ? request.postData : undefined
      })
      return
    }
    if (method === 'Network.responseReceived') {
      const id = String(params.requestId ?? '')
      const response = (params.response ?? {}) as Record<string, unknown>
      const hit = this.netRequests.get(id)
      if (hit) hit.status = Number(response.status ?? 0)
      return
    }
    if (method === 'Network.loadingFinished') {
      const id = String(params.requestId ?? '')
      const hit = this.netRequests.get(id)
      if (!hit) return
      this.netRequests.delete(id)
      // 写操作拦截器优先：browser.interceptNext 等的是「下一次匹配请求」
      const interceptor = this.interceptors.find((it) => globMatch(it.pattern, hit.url))
      if (interceptor) {
        this.removeInterceptor(interceptor)
        let bodyText = ''
        let base64Encoded = false
        try {
          const body = (await this.ensureView().webContents.debugger.sendCommand(
            'Network.getResponseBody',
            { requestId: id }
          )) as { body?: string; base64Encoded?: boolean }
          bodyText = body.body ?? ''
          base64Encoded = body.base64Encoded === true
        } catch {
          bodyText = ''
        }
        interceptor.resolve({
          url: hit.url,
          method: hit.method,
          status: hit.status ?? 0,
          body: bodyText,
          base64Encoded,
          headers: hit.headers
        })
        return
      }
      const matcher = this.netMatchers.find((m) => this.matches(m, hit))
      if (!matcher || !this.netListener) return
      let bodyText: string | undefined
      let base64Encoded = false
      if (matcher.captureBody !== false) {
        try {
          const body = (await this.ensureView().webContents.debugger.sendCommand(
            'Network.getResponseBody',
            { requestId: id }
          )) as { body?: string; base64Encoded?: boolean }
          bodyText = body.body
          base64Encoded = body.base64Encoded === true
        } catch {
          bodyText = undefined
        }
      }
      this.netListener({
        mode: 'network-response',
        request: {
          url: hit.url,
          method: hit.method,
          headers: hit.headers,
          postData: hit.postData
        },
        response: { status: hit.status ?? 0 },
        bodyText,
        base64Encoded,
        observationId: matcher.observationId
      })
    }
  }

  private matches(matcher: HostNetworkMatcher, req: { url: string; method: string }): boolean {
    if (matcher.method && matcher.method.toUpperCase() !== req.method.toUpperCase()) return false
    const includes = matcher.urlIncludes ?? []
    if (includes.length === 0) return true
    return includes.some((part) => req.url.includes(part))
  }

  /** 打开一个页面（分配新的 tabId） */
  async open(url: string): Promise<HostPageInfo> {
    const view = this.ensureView()
    this.tabSeq += 1
    await view.webContents.loadURL(url)
    const info = this.info()
    // 页面事件（第十九阶段）：'page' 这一类此前只在类型里声明、全项目零产生点 ——
    // 「agent 打开了哪些页面」完全无痕。开页不走写操作护栏（护栏只管 click/scroll），
    // 所以这里是唯一能留下这条痕迹的地方。
    // 事件系统挂了不该影响开页 → try/catch 包住（与 write-guard 的落点同一纪律）。
    try {
      pushHostEvent({
        kind: 'page',
        pageId: String(info.tabId),
        value: { action: 'open', url: info.url, tabId: info.tabId, title: info.title }
      })
    } catch {
      /* 忽略：事件落盘失败不该阻断开页 */
    }
    return info
  }

  /**
   * 在页面里执行表达式并回传结构化值（= dabi 的 context.eval）。
   * source 既可以是表达式（`location.href`）也可以是 IIFE 语句。
   */
  async eval(source: string, options?: HostEvalOptions): Promise<HostEvalResult> {
    const wc = this.ensureView().webContents
    const timeoutMs = options?.timeoutMs ?? 15000
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`页面求值超时（${timeoutMs}ms）`)), timeoutMs)
    })
    try {
      return await Promise.race([wc.executeJavaScript(source, true), timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * 只读动作：读当前页面的 DOM 概览。
   * 走的是与 dabi `context.eval` 完全相同的求值通道，
   * 用于验证「打开页面 → 读 DOM → 返回结果」这条最小链路。
   */
  async readDom(): Promise<DomSnapshot> {
    const source = `(() => {
      const text = (el) => (el && el.textContent ? el.textContent : '').trim()
      const items = document.querySelectorAll('li, .item, [data-item], [data-ecclaw-item]')
      return {
        url: location.href,
        title: document.title,
        h1: text(document.querySelector('h1')).slice(0, 200),
        itemCount: items.length,
        itemTexts: Array.from(items).slice(0, 20).map((el) => text(el).slice(0, 120)),
        bodyText: text(document.body).slice(0, 2000),
        linkCount: document.querySelectorAll('a[href]').length
      }
    })()`
    return (await this.eval(source)) as DomSnapshot
  }

  /* ------------------------------------------------------------------
   * 写操作（对齐 dabi 的 browser.click / scroll / interceptNext / waitForNavigation）
   *
   * 语义来自真实 dabi 包的用法（taobao / wxt / amazon / doudian-compass）：
   *   click({ selector, text?, frame? }, { humanize?, timeoutMs? })
   *   scroll({ deltaY?, target?: { selector, frame? }, humanize? }, { timeoutMs? })
   *   interceptNext(pattern, { timeoutMs })  → Promise<{ body, url, status, ... }>
   *   waitForNavigation({ timeoutMs })       → Promise<{ url }>
   * ------------------------------------------------------------------ */

  /**
   * 子进程（平台包 runner）写操作的统一入口。
   *
   * mode 两种等待形态：
   * - blocking（默认）：等用户点头后当场执行并返回结果 —— 平台包 runner 必须这样，
   *   因为包内 await 的就是执行结果，塞一张票据进去包会误判。
   * - deferred：立即返回票据 {status:"pending", approvalId}，用户批准后才在后台执行，
   *   agent 用 ecclaw_approval_status 轮询 —— MCP 直连工具用这个，
   *   人的等待时间与 MCP SDK 的 60s 硬超时彻底解耦。
   */
  async runOp(
    op: string,
    params: Record<string, unknown>,
    options?: { timeoutMs?: number; source?: WriteSource; mode?: 'blocking' | 'deferred' }
  ): Promise<unknown> {
    const source: WriteSource = options?.source ?? 'ui'
    const deferred = options?.mode === 'deferred'
    switch (op) {
      case 'click': {
        const target = (params.target ?? {}) as WriteTarget
        const details = {
          selector: target.selector,
          text: target.text,
          frame: target.frame,
          url: this.info().url
        }
        const run = (): Promise<unknown> =>
          this.click(target, (params.options ?? {}) as WriteOptions)
        if (deferred) return requestWriteApproval('click', details, source, run)
        return runWithWriteApproval('click', details, source, run)
      }
      case 'scroll': {
        const target = (params.target ?? {}) as WriteTarget & { deltaY?: number; target?: WriteTarget }
        const inner = target.target ?? {}
        const details = {
          selector: inner.selector,
          frame: inner.frame,
          url: this.info().url
        }
        const run = (): Promise<unknown> =>
          this.scroll(target, (params.options ?? {}) as WriteOptions)
        if (deferred) return requestWriteApproval('scroll', details, source, run)
        return runWithWriteApproval('scroll', details, source, run)
      }
      case 'intercept-next':
        return this.interceptNext(String(params.pattern ?? ''), (params.options ?? {}) as WriteOptions)
      case 'wait-for-navigation':
        return this.waitForNavigation((params.options ?? {}) as WriteOptions)
      default:
        throw new Error(`未知宿主写操作：${op}`)
    }
  }

  /** 定位元素：返回视口坐标（供 CDP 派发真实鼠标事件） */
  private async locate(target: WriteTarget): Promise<{
    found: boolean
    reason?: string
    x?: number
    y?: number
    width?: number
    height?: number
    inFrame?: boolean
    tag?: string
  }> {
    const source = `(() => {
      const selector = ${JSON.stringify(target.selector ?? '')}
      const text = ${JSON.stringify(target.text ?? '')}
      const frameSelector = ${JSON.stringify(target.frame ?? '')}
      const doc = frameSelector ? (document.querySelector(frameSelector)?.contentDocument ?? null) : document
      if (!doc) return { found: false, reason: 'frame 不可访问（跨域？）' }
      let el = null
      try {
        const nodes = Array.from(doc.querySelectorAll(selector))
        el = text
          ? nodes.find((n) => String(n.textContent || '').includes(text)) || null
          : nodes[0] || null
      } catch (e) {
        return { found: false, reason: '选择器无效：' + selector }
      }
      if (!el) return { found: false, reason: '未找到元素：' + selector + (text ? '（文本 ' + text + '）' : '') }
      try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }) } catch (e) {}
      const r = el.getBoundingClientRect()
      return {
        found: true,
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        width: r.width,
        height: r.height,
        inFrame: !!frameSelector,
        tag: el.tagName
      }
    })()`
    return (await this.eval(source)) as {
      found: boolean
      reason?: string
      x?: number
      y?: number
      width?: number
      height?: number
      inFrame?: boolean
      tag?: string
    }
  }

  /** 点击元素（优先派发真实鼠标事件；坐标系不可用时退化为 DOM click） */
  async click(target: WriteTarget, options: WriteOptions): Promise<unknown> {
    if (!target.selector) throw new Error('点击缺少 selector')
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000
    const deadline = Date.now() + timeoutMs
    let reason = '未找到元素'
    for (;;) {
      const loc = await this.locate(target)
      if (loc.found) {
        // 宿主页面隐藏时派发真实鼠标事件会被丢弃（隐藏 widget 不收输入），改走 DOM 点击
        if (loc.inFrame || !this.pageVisible || !(loc.width! > 0 && loc.height! > 0)) {
          const dom = (await this.eval(this.domClickSource(target))) as { ok?: boolean; reason?: string }
          if (!dom?.ok) throw new Error(`点击失败：${dom?.reason ?? reason}`)
          return { ok: true, mode: 'dom-click', selector: target.selector }
        }
        const wc = this.ensureDebugger()
        if (options.humanize) await sleep(80 + Math.random() * 220)
        const jitter = options.humanize ? (Math.random() - 0.5) * 3 : 0
        const x = (loc.x ?? 0) + jitter
        const y = (loc.y ?? 0) + jitter
        try {
          wc.focus()
        } catch {
          // 聚焦失败不致命
        }
        await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseMoved', x, y, buttons: 0
        })
        await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1
        })
        // 按下与抬起之间留一点间隔（真实点击也是这样，个别前端框架要求完整的按下/抬起序列）
        await sleep(options.humanize ? 40 + Math.random() * 60 : 30)
        await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1
        })
        return { ok: true, mode: 'cdp-click', selector: target.selector, x, y }
      }
      reason = loc.reason ?? reason
      if (Date.now() >= deadline) throw new Error(`点击失败：${reason}`)
      await sleep(200)
    }
  }

  /** DOM 级点击（iframe 内或布局坐标不可用时的退化路径） */
  private domClickSource(target: WriteTarget): string {
    return `(() => {
      const selector = ${JSON.stringify(target.selector ?? '')}
      const text = ${JSON.stringify(target.text ?? '')}
      const frameSelector = ${JSON.stringify(target.frame ?? '')}
      const doc = frameSelector ? (document.querySelector(frameSelector)?.contentDocument ?? null) : document
      if (!doc) return { ok: false, reason: 'frame 不可访问（跨域？）' }
      let el = null
      try {
        const nodes = Array.from(doc.querySelectorAll(selector))
        el = text
          ? nodes.find((n) => String(n.textContent || '').includes(text)) || null
          : nodes[0] || null
      } catch (e) {
        return { ok: false, reason: '选择器无效' }
      }
      if (!el) return { ok: false, reason: '未找到元素：' + selector }
      try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }) } catch (e) {}
      el.click()
      return { ok: true }
    })()`
  }

  /** 滚动：滚窗口（无 target）或滚指定容器/元素（target.selector） */
  async scroll(target: WriteTarget, options: WriteOptions): Promise<unknown> {
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000
    const deadline = Date.now() + timeoutMs
    const inner = (target as WriteTarget & { deltaY?: number; target?: WriteTarget }).target
    const scrollTarget = inner ?? {}
    const deltaY = Math.round(Number((target as WriteTarget & { deltaY?: number }).deltaY ?? 0))
    if (!scrollTarget.selector) {
      // 滚窗口
      const amount = deltaY || 400
      const before = await this.readWindowScrollY()
      if (this.pageVisible) {
        const wc = this.ensureDebugger()
        if (options.humanize) await sleep(60 + Math.random() * 160)
        const dims = (await this.eval('({ w: window.innerWidth, h: window.innerHeight })')) as {
          w?: number
          h?: number
        }
        await this.gestureScroll(
          wc,
          Math.max(1, Math.round((dims?.w ?? 800) / 2)),
          Math.max(1, Math.round((dims?.h ?? 600) / 2)),
          amount
        )
        await sleep(200)
        const after = await this.readWindowScrollY()
        if (after !== null && before !== null && after !== before) {
          return { ok: true, mode: 'gesture', deltaY: amount, scrollY: after }
        }
      }
      // 回退：DOM 滚动（真实滚轮在部分场景不生效）
      await this.eval(`window.scrollBy(0, ${amount}); true`)
      return { ok: true, mode: 'dom-scroll', deltaY: amount, scrollY: await this.readWindowScrollY() }
    }
    // 滚指定容器/元素
    for (;;) {
      const loc = await this.locate(scrollTarget)
      if (loc.found) {
        const domOnly = loc.inFrame || !this.pageVisible || !(loc.width! > 0 && loc.height! > 0)
        if (!domOnly && deltaY) {
          const wc = this.ensureDebugger()
          if (options.humanize) await sleep(60 + Math.random() * 160)
          const before = await this.readScrollTop(scrollTarget)
          await this.gestureScroll(wc, loc.x ?? 0, loc.y ?? 0, deltaY)
          await sleep(200)
          const after = await this.readScrollTop(scrollTarget)
          if (after !== null && before !== null && after !== before) {
            return { ok: true, mode: 'gesture', deltaY, scrollTop: after }
          }
        }
        const dom = (await this.eval(this.domScrollSource(scrollTarget, deltaY))) as {
          ok?: boolean
          reason?: string
          scrollTop?: number | null
        }
        if (!dom?.ok) throw new Error(`滚动失败：${dom?.reason ?? '未知'}`)
        return {
          ok: true,
          mode: deltaY ? 'dom-scroll' : 'scroll-into-view',
          deltaY,
          scrollTop: dom.scrollTop ?? null
        }
      }
      if (Date.now() >= deadline) throw new Error(`滚动失败：${loc.reason ?? '未找到元素'}`)
      await sleep(200)
    }
  }

  /**
   * 合成一次滚动手势。
   * 优先用 Input.synthesizeScrollGesture（更接近真实滚轮，能触发虚拟列表加载），
   * 失败再退回 mouseWheel。
   */
  private async gestureScroll(
    wc: Electron.WebContents,
    x: number,
    y: number,
    deltaY: number
  ): Promise<void> {
    try {
      await wc.debugger.sendCommand('Input.synthesizeScrollGesture', {
        x,
        y,
        xDistance: 0,
        // CDP 语义：yDistance 为正表示「向上滚」，向下滚取负
        yDistance: -deltaY,
        gestureSourceType: 'mouse',
        speed: 2000,
        preventFling: true
      })
      return
    } catch {
      // 退回到 mouseWheel
    }
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX: 0,
      deltaY,
      buttons: 0
    })
  }

  /** 读窗口滚动位置 */
  private async readWindowScrollY(): Promise<number | null> {
    const value = await this.eval('window.scrollY')
    return typeof value === 'number' ? value : null
  }

  /** 读元素滚动位置 */
  private async readScrollTop(target: WriteTarget): Promise<number | null> {
    const source = `(() => {
      const selector = ${JSON.stringify(target.selector ?? '')}
      const frameSelector = ${JSON.stringify(target.frame ?? '')}
      const doc = frameSelector ? (document.querySelector(frameSelector)?.contentDocument ?? null) : document
      if (!doc) return null
      const el = doc.querySelector(selector)
      return el ? el.scrollTop : null
    })()`
    const value = await this.eval(source)
    return typeof value === 'number' ? value : null
  }

  /** DOM 级滚动（iframe 内或布局坐标不可用时的退化路径） */
  private domScrollSource(target: WriteTarget, deltaY: number): string {
    return `(() => {
      const selector = ${JSON.stringify(target.selector ?? '')}
      const frameSelector = ${JSON.stringify(target.frame ?? '')}
      const delta = ${JSON.stringify(deltaY)}
      const doc = frameSelector ? (document.querySelector(frameSelector)?.contentDocument ?? null) : document
      if (!doc) return { ok: false, reason: 'frame 不可访问（跨域？）' }
      const el = doc.querySelector(selector)
      if (!el) return { ok: false, reason: '未找到元素：' + selector }
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
      if (delta) el.scrollBy(0, delta)
      return { ok: true, scrollTop: el.scrollTop ?? null }
    })()`
  }

  /**
   * 拦截「下一次」匹配 pattern 的网络请求，回传响应体。
   * pattern 是 glob（`*` 通配），例：`*mtop.taobao.shop*`。
   */
  async interceptNext(pattern: string, options: WriteOptions): Promise<unknown> {
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 20000
    // 注意：这里不能 await —— 拦截器必须在本拍登记，否则随后的页面请求会抢先发出
    const wc = this.ensureDebugger()
    void wc.debugger.sendCommand('Network.enable').catch(() => undefined)
    return new Promise<unknown>((resolve, reject) => {
      const interceptor = {
        pattern,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removeInterceptor(interceptor)
          reject(new Error(`未捕获到匹配请求：${pattern}`))
        }, timeoutMs)
      }
      this.interceptors.push(interceptor)
    })
  }

  private removeInterceptor(interceptor: { pattern: string; timer: NodeJS.Timeout }): void {
    clearTimeout(interceptor.timer)
    this.interceptors = this.interceptors.filter((it) => it !== interceptor)
  }

  /** 等待下一次页面跳转（armed 之后的导航） */
  async waitForNavigation(options: WriteOptions): Promise<unknown> {
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 30000
    const wc = this.ensureView().webContents
    const armedUrl = wc.getURL()
    return new Promise<unknown>((resolve, reject) => {
      let done = false
      const cleanup = (): void => {
        wc.removeListener('did-navigate', onNavigate)
        wc.removeListener('did-navigate-in-page', onNavigateInPage)
        clearTimeout(timer)
      }
      const settle = (url: string): void => {
        if (done) return
        done = true
        cleanup()
        resolve({ url })
      }
      const onNavigate = (_event: unknown, url: string): void => {
        if (url && url !== armedUrl) settle(url)
      }
      const onNavigateInPage = (_event: unknown, url: string, isMainFrame: boolean): void => {
        if (isMainFrame && url && url !== armedUrl) settle(url)
      }
      const timer = setTimeout(() => {
        if (done) return
        done = true
        cleanup()
        reject(new Error(`等待页面跳转超时（${timeoutMs}ms）`))
      }, timeoutMs)
      wc.on('did-navigate', onNavigate)
      wc.on('did-navigate-in-page', onNavigateInPage)
    })
  }

  /** 关闭宿主页面（不销毁主窗口） */
  async close(): Promise<void> {
    if (!this.view) return
    const view = this.view
    this.view = null
    this.viewport = null
    this.owner.contentView.removeChildView(view)
    view.webContents.close()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

/** glob 匹配（`*` 通配）；无 `*` 时按子串包含匹配 */
function globMatch(pattern: string, url: string): boolean {
  const p = String(pattern ?? '').trim()
  if (!p) return false
  if (!p.includes('*')) return url.includes(p)
  const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(escaped, 'i').test(url)
}
