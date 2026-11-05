'use strict'

/**
 * ecclaw 写操作示例包（dabi 契约 · pages 版）。
 *
 * 演示「写操作」链路，与真实 dabi 包（例如 taobao / wxt / amazon）同形：
 *   1. browser.click({ selector, text }, { humanize, timeoutMs })
 *   2. browser.scroll({ deltaY, target: { selector } }, { humanize, timeoutMs })
 *   3. browser.interceptNext(pattern, { timeoutMs })  → { body, url, status }
 *   4. browser.waitForNavigation({ timeoutMs })       → { url }
 *
 * SDK 取法：宿主把最小 @dabi/plugins 注入在
 * globalThis[Symbol.for('com.dabiai.plugins.sdk')]（真实包里是 require("@dabi/plugins")）。
 */

const manifest = require('./manifest.json')

const PAGE_ID = 'builtin:ecclaw-writer-demo'

/** 取宿主注入的 SDK（真实包走 require('@dabi/plugins')，demo 直接读全局） */
function sdk() {
  const s = globalThis[Symbol.for('com.dabiai.plugins.sdk')]
  if (!s || !s.browser) throw new Error('宿主未注入 plugins SDK')
  return s
}

/** 读页面里的计数（证明点击真的发生了） */
function readCount(c) {
  return c.eval(
    "(() => { const el = document.querySelector('#count'); return el ? el.textContent : null })()"
  )
}

const writerPage = {
  id: PAGE_ID,

  /** 命中条件：写操作验证页（host:port/writer） */
  match: (c) => typeof c?.url === 'string' && c.url.includes('/writer'),

  /** 只读提取：写操作通道存在时，提取通道也应当可用 */
  extract: (c) => ({ url: c.url, title: c.title, tabId: c.tabId }),

  actions: {
    /** 点击：#btn-increment（按文本命中）→ 计数应当 +1 */
    'ecclaw-writer-demo.click': async (c) => {
      const before = await readCount(c)
      const result = await sdk().browser.click(
        { selector: '#btn-increment', text: '加一' },
        { humanize: true, timeoutMs: 8000 }
      )
      await c.sleep(300)
      const after = await readCount(c)
      return { before, after, click: result }
    },

    /** 滚动：把 #scroll-box 容器往下滚 300px → scrollTop 应当变大 */
    'ecclaw-writer-demo.scroll': async (c) => {
      await c.sleep(500)
      const result = await sdk().browser.scroll(
        { deltaY: 300, target: { selector: '#scroll-box' } },
        { humanize: true, timeoutMs: 8000 }
      )
      const state = await c.eval(
        `(() => {
          const el = document.querySelector('#scroll-box')
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { scrollTop: el.scrollTop, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, pageY: window.scrollY }
        })()`
      )
      return { state, scroll: result }
    },

    /** 拦截：抓下一次 /api/writer/echo 响应的 body */
    'ecclaw-writer-demo.intercept': async (c) => {
      const task = sdk().browser.interceptNext('*api/writer/echo*', { timeoutMs: 10000 })
      const trigger = task.catch(() => null)
      await c.eval(
        "fetch('/api/writer/echo?from=package').then(r => r.text()).catch(() => '')"
      )
      const receipt = await trigger
      if (!receipt) throw new Error('未拦截到响应')
      return {
        url: receipt.url,
        status: receipt.status,
        bodyPreview: String(receipt.body || '').slice(0, 200)
      }
    },

    /** 跳转：先 arm waitForNavigation，再点链接 → 拿到落地 URL */
    'ecclaw-writer-demo.navigate': async (c) => {
      const navigation = sdk().browser.waitForNavigation({ timeoutMs: 10000 })
      const guard = navigation.catch(() => null)
      await sdk().browser.click({ selector: '#nav-link' }, { timeoutMs: 8000 })
      const result = await guard
      if (!result) throw new Error('未观察到页面跳转')
      return { url: result.url }
    }
  }
}

module.exports = { manifest, pages: [writerPage] }
