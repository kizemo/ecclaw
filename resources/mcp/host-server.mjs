#!/usr/bin/env node
/**
 * ecclaw 宿主 MCP 服务（stdio transport）。
 *
 * 作用：把 ecclaw 主进程里的「内嵌浏览器宿主」暴露成 openclaw agent 可调用的 MCP 工具，
 * 让托管技能从「能力目录」升级为「能真正执行动作」。
 *
 * 桥接方式：
 *   agent（openclaw）→ 本进程（MCP stdio）→ ecclaw 主进程的 loopback HTTP 桥
 *   → 宿主能力（open / read-dom / data-query / action / extract / observe / capabilities）
 *
 * 端点信息从 ECCLAW_HOST_BRIDGE_FILE 指向的 JSON 里读（port + token），
 * 读不到时回退到 $HOME/.openclaw/host-bridge.json。
 *
 * 注意：stdout 只能出现 MCP 协议消息，任何日志都走 stderr。
 */

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'

const SERVER_NAME = 'ecclaw-host'
const SERVER_VERSION = '0.1.0'

/* ------------------------------ 桥接端点 ------------------------------ */

function readEndpoint() {
  const candidates = []
  if (process.env.ECCLAW_HOST_BRIDGE_FILE) candidates.push(process.env.ECCLAW_HOST_BRIDGE_FILE)
  const home = process.env.HOME || process.env.USERPROFILE || ''
  if (home) candidates.push(path.join(home, '.openclaw', 'host-bridge.json'))
  for (const file of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (raw && typeof raw.port === 'number' && typeof raw.token === 'string') return raw
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error(
    'ecclaw 宿主桥接不可用：找不到 host-bridge.json（ECCLAW_HOST_BRIDGE_FILE 未设置，或文件不可读）。' +
      '宿主需要先启动 ecclaw 桌面端。'
  )
}

function callBridge(op, params) {
  return new Promise((resolve, reject) => {
    let ep
    try {
      ep = readEndpoint()
    } catch (err) {
      reject(err)
      return
    }
    const body = JSON.stringify({ op, params: params || {} })
    const req = http.request(
      {
        host: '127.0.0.1',
        port: ep.port,
        path: '/rpc',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-ecclaw-token': ep.token
        }
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk.toString()
        })
        res.on('end', () => {
          let parsed = null
          try {
            parsed = JSON.parse(data)
          } catch {
            reject(new Error(`宿主返回非 JSON（HTTP ${res.statusCode}）：${data.slice(0, 400)}`))
            return
          }
          if (res.statusCode !== 200) {
            const message = parsed && parsed.error ? parsed.error : `HTTP ${res.statusCode}`
            reject(new Error(message))
            return
          }
          resolve(parsed && 'result' in parsed ? parsed.result : parsed)
        })
      }
    )
    req.on('error', (err) => reject(new Error(`宿主桥接请求失败：${err.message}`)))
    req.end(body)
  })
}

/* ------------------------------ 事件主动推送通道（SSE） ------------------------------ */

/**
 * 常驻一条 SSE 连接，宿主一有新事件就推过来。
 *
 * 与 ecclaw_next_event（长轮询）的分工：
 * - 长轮询：一次调用等一个事件，没有事件就挂住最多 30 秒。适合「我就在等这一条」。
 * - 推送通道：连接常驻，事件进本地缓冲。agent 随时取件，取不到立刻返回空数组。
 *   适合「有没有新东西？没有就干别的去」。
 *
 * MCP 是 stdio 传输，没有服务端主动推送的语义，所以推送落在宿主桥这一层：
 * 主进程 → 桥（SSE）→ MCP 进程缓冲 → agent 取件。
 */

const MAX_BUFFERED_EVENTS = 500
const eventBuffer = []
let sseSinceSeq = 0
let sseStarted = false

function pushBuffered(ev) {
  eventBuffer.push(ev)
  if (eventBuffer.length > MAX_BUFFERED_EVENTS) {
    eventBuffer.splice(0, eventBuffer.length - MAX_BUFFERED_EVENTS)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 启动推送连接（只启动一次；断线自动重连） */
function ensureEventStream() {
  if (sseStarted) return
  sseStarted = true
  void (async () => {
    for (;;) {
      let ep = null
      try {
        ep = readEndpoint()
      } catch {
        /* 桥还没起来，稍后重试 */
      }
      if (ep) {
        try {
          const res = await fetch(`http://127.0.0.1:${ep.port}/events?sinceSeq=${sseSinceSeq}`, {
            headers: { 'x-ecclaw-token': ep.token }
          })
          if (!res.ok || !res.body) throw new Error(`SSE 返回 ${res.status}`)
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buf = ''
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            let idx
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const chunk = buf.slice(0, idx)
              buf = buf.slice(idx + 2)
              for (const line of chunk.split('\n')) {
                if (!line.startsWith('data:')) continue
                try {
                  const ev = JSON.parse(line.slice(5).trim())
                  if (ev && typeof ev.seq === 'number') {
                    if (ev.seq > sseSinceSeq) sseSinceSeq = ev.seq
                    pushBuffered(ev)
                  }
                } catch {
                  /* 忽略坏行 */
                }
              }
            }
          }
          process.stderr.write('[ecclaw-mcp] 事件推送通道已关闭，重连中\n')
        } catch (err) {
          process.stderr.write(
            `[ecclaw-mcp] 事件推送通道断开：${err && err.message ? err.message : err}\n`
          )
        }
      }
      await sleep(2000)
    }
  })()
}

/**
 * 取件：从推送缓冲里捞 seq 大于 sinceSeq 的事件。
 *
 * 取件口径（第十三阶段收口）：
 * - 缓冲**覆盖** sinceSeq 之后的所有事件（sinceSeq >= 缓冲最旧 seq - 1）
 *   → 缓冲就是权威，直接返回；没有新事件就返回空数组，不去扫盘。
 * - 缓冲**不覆盖**（要的事件太老，已经被挤出 500 条上限）
 *   → 回落落盘回放补齐，保证不漏。
 *
 * 为什么不能用「缓冲里捞到东西」当覆盖判据：
 * 没有新事件时缓冲本来就捞不到东西，那时会错误地回落扫盘，
 * 把落盘里另一个 seq 空间的老事件又吐回来（agent 会看到自己早就消费过的旧事件）。
 */
const KNOWN_KINDS = ['observe', 'approval', 'page']

/**
 * 解析 kind 过滤参数（第十七阶段的多选）。
 *
 * kinds 是数组（多选）；kind 是单选。两者都给时 kinds 优先。
 * 空数组 = 不限；认不出的值一律丢掉（脏数据不该让调用报错）。
 */
function parseKindFilter(kind, kinds) {
  const list = Array.isArray(kinds)
    ? kinds.filter((k) => typeof k === 'string' && KNOWN_KINDS.includes(k))
    : []
  if (list.length > 0) return { kinds: list }
  if (typeof kind === 'string' && KNOWN_KINDS.includes(kind)) return { kind }
  return {}
}

async function eventsSince(sinceSeq, limit, kind, kinds) {
  const filter = parseKindFilter(kind, kinds)
  const kindSet = filter.kinds ? new Set(filter.kinds) : null
  const match = (e) => {
    if (e.seq <= sinceSeq) return false
    if (kindSet) return kindSet.has(e.kind)
    if (filter.kind) return e.kind === filter.kind
    return true
  }
  const fromBuffer = eventBuffer.filter(match).slice(0, limit)
  const oldest = eventBuffer.length > 0 ? eventBuffer[0].seq : null
  if (oldest !== null && sinceSeq >= oldest - 1) {
    return { events: fromBuffer, source: 'push', buffered: eventBuffer.length }
  }
  // 缓冲不覆盖：回落到落盘回放，保证不漏
  const replayed = await callBridge('event-replay', {
    sinceSeq,
    limit,
    kind: filter.kind,
    kinds: filter.kinds
  })
  const list = Array.isArray(replayed) ? replayed : []
  return { events: list.slice(0, limit), source: 'replay', buffered: eventBuffer.length }
}

/* ------------------------------ 工具定义 ------------------------------ */

const TOOLS = [
  {
    name: 'ecclaw_list_capabilities',
    description:
      '列出 ecclaw 已安装平台包及其能力目录（包 id、页面 id、动作能力 id、数据查询 id、观察器 id）。' +
      '调用任何执行类工具前先查这里确认包 id 与能力 id。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'ecclaw_open_page',
    description: '在内嵌浏览器宿主里打开一个 URL，返回页面标题与地址。',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: '要打开的 URL' } },
      required: ['url'],
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_read_dom',
    description: '打开 URL 并读取页面 DOM 概览（标题、正文片段、元素计数），只读。',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: '要读取的 URL' } },
      required: ['url'],
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_run_action',
    description:
      '执行平台包的页面动作能力（capability id）。可先调 ecclaw_list_capabilities 拿到动作 id。' +
      'payload 为动作参数对象（JSON）。',
    inputSchema: {
      type: 'object',
      properties: {
        packageId: { type: 'string', description: '平台包 id' },
        capability: { type: 'string', description: '动作能力 id' },
        payload: { type: 'object', description: '动作参数（JSON 对象，可空）' },
        url: { type: 'string', description: '可选：执行前先打开的 URL' }
      },
      required: ['packageId', 'capability'],
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_run_data_query',
    description: '执行平台包的数据查询能力（dataQueries id），返回结构化查询结果。',
    inputSchema: {
      type: 'object',
      properties: {
        packageId: { type: 'string', description: '平台包 id' },
        queryId: { type: 'string', description: '数据查询 id' },
        args: { type: 'object', description: '查询参数（JSON 对象，可空）' },
        url: { type: 'string', description: '可选：执行前先打开的 URL' }
      },
      required: ['packageId', 'queryId'],
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_run_extract',
    description: '执行平台包的页面提取（extract），读取页面并返回提取到的结构化数据，只读。',
    inputSchema: {
      type: 'object',
      properties: {
        packageId: { type: 'string', description: '平台包 id' },
        pageId: { type: 'string', description: '页面 id（可空，空则由包内自动匹配）' },
        url: { type: 'string', description: '可选：执行前先打开的 URL' }
      },
      required: ['packageId'],
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_run_observe',
    description:
      '执行平台包的页面观察（observations → observe）：捕获网络响应 / 定时轮询 / 页面信号，' +
      '返回观察到的数据。',
    inputSchema: {
      type: 'object',
      properties: {
        packageId: { type: 'string', description: '平台包 id' },
        pageId: { type: 'string', description: '页面 id（可空，空则由包内自动匹配）' },
        url: { type: 'string', description: '可选：执行前先打开的 URL' }
      },
      required: ['packageId'],
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_watch',
    description:
      '启动一个持续观察（poll 订阅式持续刷新）：包里的 poll 观察器按 intervalMs 循环运行，' +
      '每轮产出一条增量事件。返回当前所有 watch 列表（含 watchId）。' +
      '之后用 ecclaw_next_event 取事件、用 ecclaw_watch_stop 停止。',
    inputSchema: {
      type: 'object',
      properties: {
        packageId: { type: 'string', description: '平台包 id' },
        pageId: { type: 'string', description: '页面 id（可空，空则由包内自动匹配）' }
      },
      required: ['packageId'],
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_watch_stop',
    description: '停止一个持续观察（poll 订阅），返回剩余的 watch 列表。',
    inputSchema: {
      type: 'object',
      properties: { watchId: { type: 'string', description: 'watch id' } },
      required: ['watchId'],
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_next_event',
    description:
      '长轮询取下一个宿主增量事件（宿主侧挂起等待，不需要反复轮询状态）。' +
      'sinceSeq 是上一次拿到的事件序号（首次可不传）。' +
      '超时返回 null（不是错误），可以带上次的 sinceSeq 再等一轮。',
    inputSchema: {
      type: 'object',
      properties: {
        sinceSeq: { type: 'number', description: '只取该序号之后的事件（默认 0 = 全部之后）' },
        timeoutMs: { type: 'number', description: '最长等待毫秒（默认 30000，上限 55000）' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_events_since',
    description:
      '取走「上次取完之后」新增的宿主事件（推送通道）。' +
      '本进程常驻一条到宿主的推送连接，宿主一有事件就推进来进缓冲；' +
      '这个工具从缓冲里取件，没有新事件立刻返回空数组（不会挂住）。' +
      '记住上次返回的最后一个 seq，下次当 sinceSeq 传进来即可只取增量。',
    inputSchema: {
      type: 'object',
      properties: {
        sinceSeq: { type: 'number', description: '只取 seq 大于它的（上次取到的最后一个 seq；首次取用 0）' },
        limit: { type: 'number', description: '最多返回多少条（默认 100，上限 500）' },
        kind: {
          type: 'string',
          enum: ['observe', 'approval', 'page'],
          description:
            '可选：只看某一类事件。approval = 写操作审计（agent 动了页面：' +
            'requested 已请求确认 / executed 已执行 / rejected 用户拒绝 / timeout 超时 / failed 执行报错）'
        },
        kinds: {
          type: 'array',
          items: { type: 'string', enum: ['observe', 'approval', 'page'] },
          description: '可选：只看这几类事件（多选）。比 kind 优先；不给 = 不限'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_event_replay',
    description:
      '回放历史宿主事件（事件已落盘，进程重启/崩溃后也能取回之前观察到的数据）。' +
      '可按 seq 区间、时间区间、packageId、pageId、kind/kinds 过滤；结果按 seq 升序返回。',
    inputSchema: {
      type: 'object',
      properties: {
        sinceSeq: { type: 'number', description: '只取该序号之后的事件' },
        untilSeq: { type: 'number', description: '只取该序号及之前的事件' },
        sinceAt: { type: 'string', description: '起始时间（ISO 8601）' },
        untilAt: { type: 'string', description: '结束时间（ISO 8601）' },
        packageId: { type: 'string', description: '只看某个平台包的事件' },
        pageId: { type: 'string', description: '只看某个页面的事件' },
        kind: { type: 'string', description: '只看某类事件（observe / approval / page）' },
        kinds: {
          type: 'array',
          items: { type: 'string', enum: ['observe', 'approval', 'page'] },
          description: '可选：只看这几类事件（多选）。比 kind 优先；不给 = 不限'
        },
        limit: { type: 'number', description: '最多返回多少条（默认 200，上限 2000）' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_event_summary',
    description:
      '汇总已落盘的宿主事件（按平台包 / 事件类型 / 天聚合 + 时间序列趋势）。' +
      '想知道「哪个平台包产了多少事件、覆盖了哪几天」时用这个，' +
      '不要为了同样的目的去拉取大量原始事件（明细用 ecclaw_event_replay）。' +
      'trend 字段给出分桶时间序列：points[].delta / deltaPct 是环比，peak 是峰值桶。',
    inputSchema: {
      type: 'object',
      properties: {
        sinceSeq: { type: 'number', description: '只看 seq 大于它的' },
        untilSeq: { type: 'number', description: '只看 seq 小于等于它的' },
        sinceAt: { type: 'string', description: '只看这个时间之后的（ISO 8601）' },
        untilAt: { type: 'string', description: '只看这个时间之前的（ISO 8601）' },
        packageId: { type: 'string', description: '只看某个平台包的事件' },
        pageId: { type: 'string', description: '只看某个页面的事件' },
        kind: { type: 'string', description: '只看某类事件（observe / approval / page）' },
        kinds: {
          type: 'array',
          items: { type: 'string', enum: ['observe', 'approval', 'page'] },
          description: '可选：只看这几类事件（多选）。比 kind 优先；不给 = 不限'
        },
        bucket: {
          type: 'string',
          description: '趋势分桶粒度：day（默认，按天）/ hour（按小时，找峰值时段用）'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_event_export',
    description:
      '把已落盘的宿主事件导出成文件交给用户（jsonl 或 csv）。' +
      '过滤语义与 ecclaw_event_replay / ecclaw_event_summary 完全一致。' +
      '返回 {file, files:[{name,file,bytes,kind}], count, bytes, format, truncated, dir, kinds, split}，' +
      'file 是导出文件的完整路径，把它告诉用户即可（文件已落盘，不需要再回传内容）。' +
      'splitByKind=true 时按事件类型拆成多个文件（observe / approval / page 各一份，文件名带类型前缀）。',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          description: '导出格式：jsonl（默认，机器可读，与落盘同构）或 csv（人可读，Excel 可开）'
        },
        splitByKind: {
          type: 'boolean',
          description: '是否按事件类型拆成多个文件（默认 false = 一个文件装全部）'
        },
        sinceSeq: { type: 'number', description: '只看 seq 大于它的' },
        untilSeq: { type: 'number', description: '只看 seq 小于等于它的' },
        sinceAt: { type: 'string', description: '只看这个时间之后的（ISO 8601）' },
        untilAt: { type: 'string', description: '只看这个时间之前的（ISO 8601）' },
        packageId: { type: 'string', description: '只看某个平台包的事件' },
        pageId: { type: 'string', description: '只看某个页面的事件' },
        kind: { type: 'string', description: '只看某类事件（observe / approval / page）' },
        kinds: {
          type: 'array',
          items: { type: 'string', enum: ['observe', 'approval', 'page'] },
          description: '可选：只看这几类事件（多选）。比 kind 优先；不给 = 不限'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_export_list',
    description:
      '列出已经导出的事件文件（<userData>/host-events/exports/ 下）。' +
      '用户想知道「之前导过哪些文件、占多大」时用这个。' +
      '返回 {dir, files:[{name,file,bytes,modifiedAt,kind}]}（kind 只有按类型拆分导出的文件才有）。' +
      '注意：删除导出物是**用户自己的决定**，本工具只列不删 —— ' +
      '要清理请让用户在界面的「导出物」面板里逐个删除。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'ecclaw_profile_list',
    description:
      '列出店铺登录态 profile（每个 profile = 一个独立 partition，登录态互不串味）。' +
      '想知道「现在跑在哪个店的登录态下 / 有哪些店铺可用」时用这个。' +
      '返回 {profiles:[{id,name,partition,createdAt,builtin}], activeId}。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'ecclaw_profile_use',
    description:
      '切换当前店铺 profile（换 partition）。切换后宿主页面的登录态就是那个店铺的登录态。' +
      '参数 id = profile id（先用 ecclaw_profile_list 查）。' +
      '注意：切换会**关闭当前页面**（登录态按 partition 隔离，必须重建页面）。' +
      '新建 / 移除 profile 留在界面里做（新建要人起名，移除涉及用户登录数据）。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'profile id（如 default 或 p-shop-xxxx）' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_guard_rules',
    description:
      '查看当前的写操作信任规则，分「本次会话」与「永久」两组。' +
      '想知道「我现在被信任到什么程度 / 哪些站点是永久放行的」时用这个。' +
      '返回 {session:[...], persistent:[...]}，每条含 host / match / ops / ttl / path。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'ecclaw_guard_clear_session',
    description:
      '清空「本次会话」的全部写操作信任规则（永久规则不受影响）。' +
      '返回清掉了几条。用户改主意、想撤销会话内的授权时用这个。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'ecclaw_guard_remove',
    description:
      '移除写操作信任规则（按站点，可指定路径）。' +
      '给了 path：只移除该站点该路径的那一条（路径粒度）；' +
      '不给 path：移除该站点的全部规则（本次会话 + 永久）。返回移除了几条。',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: '站点域名（如 taobao.com）' },
        path: {
          type: 'string',
          description: '可选：路径前缀（如 /seller/item）。不给 = 清掉该站点的全部规则'
        },
        scope: {
          type: 'string',
          description:
            '可选：只清哪一类 —— session（仅本次会话）/ persistent（仅永久）/ all（默认，两者都清）'
        }
      },
      required: ['host'],
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_click',
    description:
      '在内嵌浏览器宿主里点击页面元素（不依赖任何平台包）。' +
      'selector 是 CSS 选择器，text 可选（命中文字包含它的那个元素）。' +
      '这是写操作，会先请用户确认：若返回 {status:"pending", approvalId}，' +
      '说明排队等用户点头，请用 ecclaw_approval_status 轮询该 approvalId 取最终结果；' +
      '用户拒绝或超时会得到 status=rejected / timeout，此时不要重试。',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS 选择器' },
        text: { type: 'string', description: '可选：元素文本关键词' },
        frame: { type: 'string', description: '可选：所在 iframe 的选择器' },
        timeoutMs: { type: 'number', description: '可选：等待元素出现的超时（默认 15000）' },
        humanize: { type: 'boolean', description: '可选：加随机延迟与坐标抖动' }
      },
      required: ['selector'],
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_scroll',
    description:
      '滚动宿主页面：不给 selector 则滚窗口，给 selector 则滚该容器。' +
      '这是写操作，会先请用户确认：若返回 {status:"pending", approvalId}，' +
      '请用 ecclaw_approval_status 轮询该 approvalId 取最终结果。',
    inputSchema: {
      type: 'object',
      properties: {
        deltaY: { type: 'number', description: '滚动距离（正数向下，默认 400）' },
        selector: { type: 'string', description: '可选：滚动目标容器' },
        frame: { type: 'string', description: '可选：目标所在 iframe 的选择器' },
        timeoutMs: { type: 'number', description: '可选：超时（默认 15000）' },
        humanize: { type: 'boolean', description: '可选：加随机延迟' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_approval_status',
    description:
      '查询一次写操作确认票据的最终结果。' +
      'ecclaw_click / ecclaw_scroll 在需要用户确认时返回 {status:"pending", approvalId}；' +
      '用本工具轮询该 approvalId，status 会依次变成 pending → approved → executed（或 failed）。' +
      '用户拒绝是 rejected，超时未确认是 timeout（两者都不会执行，不要重试）。',
    inputSchema: {
      type: 'object',
      properties: {
        approvalId: { type: 'string', description: '写操作票据号（来自 ecclaw_click / ecclaw_scroll 的返回）' }
      },
      required: ['approvalId'],
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_intercept_next',
    description:
      '拦截下一次匹配 glob 的网络请求并返回响应体（只读，不改页面）。' +
      'pattern 例：*mtop.taobao.shop*。',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'glob 匹配（* 通配）' },
        timeoutMs: { type: 'number', description: '可选：超时（默认 20000）' }
      },
      required: ['pattern'],
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_wait_navigation',
    description: '等待宿主页面下一次跳转，返回新 URL（只读，不改页面）。',
    inputSchema: {
      type: 'object',
      properties: {
        timeoutMs: { type: 'number', description: '可选：超时（默认 30000）' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'ecclaw_host_status',
    description: '返回内嵌浏览器宿主的当前状态（当前页面、摆放位置）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'ecclaw_document_preview',
    description:
      '预览文件库里的文档（支持 PDF / DOCX / PPTX / XLSX）。不传 path/name 时返回文件库文档清单（名称/类型/大小）；' +
      '传 path 或 name 时返回该文档的文本（PDF 按页，DOCX / PPTX / XLSX 为全文）。只读：本地解析、不联网、不外发、不改用户文件。' +
      '（PDF 位图预览只在界面里提供，不返回给 agent，避免把 base64 灌进上下文。）' +
      '（PDF 还会返回 outline 目录：章节标题 + 目标页码；长文档可用 startPage / endPage 只抽其中一段页码。）',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件库内的文件绝对路径（与 name 二选一）' },
        name: { type: 'string', description: '文件库内的文件名（与 path 二选一）' },
        maxPages: { type: 'number', description: '可选：最多抽取多少页（默认全部，上限 200）' },
        maxChars: { type: 'number', description: '可选：最多抽取多少字（默认 200000）' },
        startPage: { type: 'number', description: '可选：从第几页开始抽（PDF 专用，1 起；越界会被夹到有效范围）' },
        endPage: { type: 'number', description: '可选：抽到第几页为止（含；PDF 专用，越界会被夹到有效范围）' }
      },
      additionalProperties: false
    }
  }
]

/* ------------------------------ 工具执行 ------------------------------ */

function pick(obj, key) {
  const v = obj && obj[key]
  return v === undefined || v === null ? undefined : v
}

async function runTool(name, args) {
  const a = args && typeof args === 'object' ? args : {}
  switch (name) {
    case 'ecclaw_list_capabilities':
      return callBridge('capabilities', {})
    case 'ecclaw_open_page':
      return callBridge('open', { url: String(pick(a, 'url') ?? '') })
    case 'ecclaw_read_dom':
      return callBridge('read-dom', { url: String(pick(a, 'url') ?? '') })
    case 'ecclaw_run_action':
      return callBridge('action', {
        packageId: String(pick(a, 'packageId') ?? ''),
        capability: String(pick(a, 'capability') ?? ''),
        payload: pick(a, 'payload') ?? {},
        url: pick(a, 'url')
      })
    case 'ecclaw_run_data_query':
      return callBridge('data-query', {
        packageId: String(pick(a, 'packageId') ?? ''),
        queryId: String(pick(a, 'queryId') ?? ''),
        args: pick(a, 'args') ?? {},
        url: pick(a, 'url')
      })
    case 'ecclaw_run_extract':
      return callBridge('extract', {
        packageId: String(pick(a, 'packageId') ?? ''),
        pageId: pick(a, 'pageId'),
        url: pick(a, 'url')
      })
    case 'ecclaw_run_observe':
      return callBridge('observe', {
        packageId: String(pick(a, 'packageId') ?? ''),
        pageId: pick(a, 'pageId'),
        url: pick(a, 'url')
      })
    case 'ecclaw_watch':
      return callBridge('watch', {
        packageId: String(pick(a, 'packageId') ?? ''),
        pageId: pick(a, 'pageId')
      })
    case 'ecclaw_watch_stop':
      return callBridge('watch-stop', { watchId: String(pick(a, 'watchId') ?? '') })
    case 'ecclaw_next_event':
      return callBridge('next-event', {
        sinceSeq: Number(pick(a, 'sinceSeq') ?? 0),
        timeoutMs: Number(pick(a, 'timeoutMs') ?? 30000)
      })
    case 'ecclaw_click':
      return callBridge('click', {
        selector: String(pick(a, 'selector') ?? ''),
        text: pick(a, 'text'),
        frame: pick(a, 'frame'),
        timeoutMs: pick(a, 'timeoutMs'),
        humanize: pick(a, 'humanize')
      })
    case 'ecclaw_scroll':
      return callBridge('scroll', {
        deltaY: pick(a, 'deltaY'),
        selector: pick(a, 'selector'),
        frame: pick(a, 'frame'),
        timeoutMs: pick(a, 'timeoutMs'),
        humanize: pick(a, 'humanize')
      })
    case 'ecclaw_intercept_next':
      return callBridge('intercept-next', {
        pattern: String(pick(a, 'pattern') ?? ''),
        timeoutMs: pick(a, 'timeoutMs')
      })
    case 'ecclaw_wait_navigation':
      return callBridge('wait-for-navigation', { timeoutMs: pick(a, 'timeoutMs') })
    case 'ecclaw_approval_status':
      return callBridge('approval-status', { approvalId: String(pick(a, 'approvalId') ?? '') })
    case 'ecclaw_events_since':
      ensureEventStream()
      return eventsSince(
        Number(pick(a, 'sinceSeq') ?? 0) || 0,
        Math.min(Math.max(Number(pick(a, 'limit') ?? 100) || 100, 1), 500),
        typeof pick(a, 'kind') === 'string' ? pick(a, 'kind') : undefined,
        pick(a, 'kinds')
      )
    case 'ecclaw_event_replay':
      return callBridge('event-replay', {
        sinceSeq: pick(a, 'sinceSeq'),
        untilSeq: pick(a, 'untilSeq'),
        sinceAt: pick(a, 'sinceAt'),
        untilAt: pick(a, 'untilAt'),
        packageId: pick(a, 'packageId'),
        pageId: pick(a, 'pageId'),
        kind: pick(a, 'kind'),
        kinds: pick(a, 'kinds'),
        limit: pick(a, 'limit')
      })
    case 'ecclaw_event_summary':
      return callBridge('event-summary', {
        sinceSeq: pick(a, 'sinceSeq'),
        untilSeq: pick(a, 'untilSeq'),
        sinceAt: pick(a, 'sinceAt'),
        untilAt: pick(a, 'untilAt'),
        packageId: pick(a, 'packageId'),
        pageId: pick(a, 'pageId'),
        kind: pick(a, 'kind'),
        kinds: pick(a, 'kinds'),
        bucket: pick(a, 'bucket')
      })
    case 'ecclaw_event_export':
      return callBridge('event-export', {
        format: pick(a, 'format'),
        splitByKind: pick(a, 'splitByKind') === true,
        sinceSeq: pick(a, 'sinceSeq'),
        untilSeq: pick(a, 'untilSeq'),
        sinceAt: pick(a, 'sinceAt'),
        untilAt: pick(a, 'untilAt'),
        packageId: pick(a, 'packageId'),
        pageId: pick(a, 'pageId'),
        kind: pick(a, 'kind'),
        kinds: pick(a, 'kinds')
      })
    case 'ecclaw_export_list':
      return callBridge('event-exports', {})
    case 'ecclaw_profile_list':
      return callBridge('profiles', {})
    case 'ecclaw_profile_use':
      return callBridge('profile-use', { id: String(pick(a, 'id') ?? '') })
    case 'ecclaw_guard_rules':
      return callBridge('guard-rules', {})
    case 'ecclaw_guard_clear_session':
      return callBridge('guard-rules-clear-session', {})
    case 'ecclaw_guard_remove':
      return callBridge('guard-rules-remove', {
        host: String(pick(a, 'host') ?? ''),
        path: pick(a, 'path'),
        scope: pick(a, 'scope')
      })
    case 'ecclaw_host_status':
      return callBridge('status', {})
    case 'ecclaw_document_preview': {
      // 第二十一阶段：文档预览（只读）。
      // 不给 path/name → 先给清单（agent 得先知道文件库里有什么）；
      // 给了 → 预览那一份。路径越界由主进程拒绝（只允许文件库内的文件）。
      const p = pick(a, 'path')
      const n = pick(a, 'name')
      if (!p && !n) return callBridge('document-list', {})
      return callBridge('document-preview', {
        path: p,
        name: n,
        maxPages: pick(a, 'maxPages'),
        maxChars: pick(a, 'maxChars'),
        // 第三十一阶段：只抽长文档里的一段页码（PDF 专用）
        startPage: pick(a, 'startPage'),
        endPage: pick(a, 'endPage')
      })
    }
    default:
      throw new Error(`未知工具：${name}`)
  }
}

/* ------------------------------ JSON-RPC ------------------------------ */

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handle(msg) {
  const { id, method, params } = msg
  const isNotification = id === undefined || id === null

  try {
    if (method === 'initialize') {
      const version =
        params && typeof params.protocolVersion === 'string' && params.protocolVersion
          ? params.protocolVersion
          : '2024-11-05'
      // 推送通道常驻：initialize 之后就开始连，事件到就进缓冲
      ensureEventStream()
      sendResult(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      })
      return
    }
    if (method === 'notifications/initialized' || method === 'initialized') return
    if (method === 'ping') {
      if (!isNotification) sendResult(id, {})
      return
    }
    if (method === 'tools/list') {
      sendResult(id, { tools: TOOLS })
      return
    }
    if (method === 'tools/call') {
      const name = params && params.name ? String(params.name) : ''
      const args = params && params.arguments ? params.arguments : {}
      try {
        const result = await runTool(name, args)
        sendResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result ?? null, null, 2) }],
          isError: false
        })
      } catch (err) {
        sendResult(id, {
          content: [{ type: 'text', text: `工具执行失败：${(err && err.message) || String(err)}` }],
          isError: true
        })
      }
      return
    }
    if (isNotification) return
    sendError(id, -32601, `不支持的方法：${method}`)
  } catch (err) {
    if (isNotification) return
    sendError(id, -32603, (err && err.message) || String(err))
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line) {
      try {
        const msg = JSON.parse(line)
        void handle(msg)
      } catch {
        /* 忽略非 JSON 行 */
      }
    }
    index = buffer.indexOf('\n')
  }
})
process.stdin.on('end', () => process.exit(0))
process.on('uncaughtException', (err) => {
  process.stderr.write(`[ecclaw-mcp] ${err && err.stack ? err.stack : String(err)}\n`)
})
