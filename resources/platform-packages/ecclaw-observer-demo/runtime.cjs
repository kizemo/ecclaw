'use strict'

/**
 * ecclaw 观察器示例包（dabi 契约 · pages 版）。
 *
 * 演示「页面观察器」链路，与真实 dabi 包（例如 doudian-compass）同形：
 *   1. observations(context) → 返回观察器定义
 *      （mode=network-response + request.urlIncludes/method + captureBody）
 *   2. 宿主在页面上匹配到对应响应 → 把事件作为 context.event 喂回来
 *   3. observe(context) → 包内消费事件
 *
 * 页面对象形状（对齐 dabi）：
 *   { id, match(c), extract(c), observations(c), observe(c), actions: {cap: fn} }
 */

const manifest = require('./manifest.json')

const PAGE_ID = 'builtin:ecclaw-observer-demo'
const ECHO_PATH = '/api/demo/echo'

/** 观察器定义：只关心 fixture 页打出的 /api/demo/echo 请求 */
function observations() {
  return [
    {
      id: 'ecclaw-demo-network',
      mode: 'network-response',
      lifecycle: 'page',
      captureBody: true,
      request: { urlIncludes: [ECHO_PATH], method: 'GET' }
    }
  ]
}

const demoPage = {
  id: PAGE_ID,

  /** 命中条件：fixture 页 URL（host:port/demo） */
  match: (c) => typeof c?.url === 'string' && c.url.includes('/demo'),

  /** 只读提取：证明同一页面也能走 extract 通道 */
  extract: (c) => ({
    url: c.url,
    title: c.title,
    tabId: c.tabId,
    pageIdentity: c.pageIdentity ?? null
  }),

  observations,

  /** 消费宿主喂回的网络事件 */
  observe: (c) => {
    const event = c.event || {}
    return {
      mode: event.mode ?? null,
      url: event.request ? event.request.url : null,
      method: event.request ? event.request.method : null,
      status: event.response ? event.response.status : null,
      base64Encoded: event.base64Encoded === true,
      bodyText: event.bodyText ?? null,
      observationId: c.observation ? c.observation.id : null
    }
  },

  /** 一个最小动作（只为让能力目录不为空；执行动作走同一条 context 通道） */
  actions: {
    'ecclaw-observer-demo.echo': async (c) => ({
      url: c.url,
      title: c.title,
      tabId: c.tabId,
      pageIdentity: c.pageIdentity ?? null
    })
  }
}

/** mode: 'poll' —— 宿主按 intervalMs 定时触发 observe（runImmediately 表示先立刻来一次） */
const pollPage = {
  id: 'builtin:ecclaw-observer-demo-poll',
  match: (c) => typeof c?.url === 'string' && c.url.includes('/demo'),
  observations: () => [
    {
      id: 'ecclaw-demo-poll',
      mode: 'poll',
      lifecycle: 'page',
      intervalMs: 800,
      runImmediately: true
    }
  ],
  observe: (c) => ({
    mode: c.event ? c.event.mode : null,
    observationId: c.observation ? c.observation.id : null,
    url: c.url,
    title: c.title
  })
}

/** mode: 'dom-signal' —— 页面内脚本通过 console 消息上报（宿主按 signalPrefix 捕获） */
const signalPage = {
  id: 'builtin:ecclaw-observer-demo-signal',
  match: (c) => typeof c?.url === 'string' && c.url.includes('/demo'),
  observations: () => [
    {
      id: 'ecclaw-demo-signal',
      mode: 'dom-signal',
      lifecycle: 'page',
      signalPrefix: 'ecclaw-demo-signal:',
      installScript:
        `(() => { window.__ecclawDemoSignal = (window.__ecclawDemoSignal || 0) + 1;` +
        ` console.info('ecclaw-demo-signal:changed:' + window.__ecclawDemoSignal); return true })()`,
      stopScript: `(() => { delete window.__ecclawDemoSignal; return true })()`
    }
  ],
  observe: (c) => ({
    mode: c.event ? c.event.mode : null,
    message: c.event ? c.event.message : null,
    observationId: c.observation ? c.observation.id : null
  })
}

module.exports = { manifest, pages: [demoPage, pollPage, signalPage] }
