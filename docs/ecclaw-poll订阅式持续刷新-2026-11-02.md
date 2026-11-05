# ecclaw · poll 订阅式持续刷新（宿主侧长轮询 + 渲染进程增量更新）

> 第九阶段（phase3i）交付项 2。补上第八阶段列出的最后一块语义缺口：
> **dabi 的 poll 观察器是持续刷新的**（侧栏随页面联动），ecclaw 早期的 observe 只跑一次。

---

## 1. 这一阶段解决什么问题

第八阶段之前，ecclaw 的 observe 是**一次性**的：包内 `observations(context)` 给出观察器定义 →
宿主产生一个事件 → 喂给 `page.observe(context)` → 返回一个值 → 结束。

但 dabi 的 `poll` 观察器（`intervalMs` + `runImmediately`）语义是**持续**的：
页面在变，观察器就该一直按周期产出数据，侧栏（dabi 的侧栏联动）因此一直刷新。

缺了这段，agent 只能「反复调 observe、反复拿全量」，既贵又不准。

这一阶段的解法：**宿主事件总线**。

```
包内 poll 观察器（常驻子进程，按 intervalMs 循环）
        │  每轮一条增量事件
        ▼
   宿主事件总线（electron/main/host-events.ts）
        ├──► 渲染进程：webContents.send('host:host-event') → 界面**增量追加**
        └──► agent：MCP 工具 ecclaw_next_event（长轮询，一次调用等一条）
```

事件带单调递增的 `seq`，消费者记住自己的 `seq` 就只拿新事件 —— 这就是「增量」。

---

## 2. 契约

### 2.1 MCP 工具（13 → 16）

| 工具 | 作用 |
| --- | --- |
| `ecclaw_watch({packageId, pageId?})` | 启动持续观察，返回 watch 列表（含 `watchId`） |
| `ecclaw_watch_stop({watchId})` | 停掉持续观察，返回剩余 watch 列表 |
| `ecclaw_next_event({sinceSeq?, timeoutMs?})` | **长轮询**取下一个增量事件；超时返回 `null`（不是错误） |

`ecclaw_next_event` 的超时上限 55s（MCP SDK 客户端硬超时 60s，见 §5）。

### 2.2 事件

```jsonc
{
  "seq": 12,                    // 单调递增；消费者记下来就只拿新事件
  "kind": "observe",            // observe | approval | page
  "packageId": "ecclaw-observer-demo",
  "pageId": "builtin:ecclaw-observer-demo-poll",
  "observationId": "ecclaw-demo-poll",
  "value": { "mode": "poll", "url": "http://127.0.0.1:8898/demo", "title": "..." },
  "at": "2026-11-02T00:37:48.107Z"
}
```

### 2.3 界面

侧栏新增「宿主事件」页：上半是持续观察列表（可启动/停止），下半是增量事件流。
渲染进程**订阅**主进程推送（`api.host.onHostEvent`），只做追加，**不做定时轮询**。

---

## 3. 实现落点

| 文件 | 改动 |
| --- | --- |
| `electron/main/host-events.ts` | **新文件**：事件总线（环形缓冲 200 条 + 长轮询等待者 + 渲染进程推送） |
| `electron/main/platform-actions.ts` | runner 新增 `spec.continuous` 分支（poll 循环）；`runRunner` 支持 `RunnerOptions`（`onPollEvent` / `onSpawn`）；抽出 `installObservers()`；新增 `startContinuousObserve()` |
| `electron/main/host-service.ts` | watch 管理（启动/停止/列表）+ `hostNextEvent()` |
| `electron/main/host-bridge.ts` | 新增 op：`watch` / `watch-stop` / `watch-list` / `next-event` |
| `electron/main/index.ts` | 推送 `host:host-event`；新增 IPC `host:host-events` / `host:host-event-next` / `host:watch-start` / `host:watch-stop` / `host:watch-list` |
| `electron/preload/index.ts` | `onHostEvent` / `hostEvents` / `nextHostEvent` / `startWatch` / `stopWatch` / `listWatches` |
| `electron/shared/types.ts` | `HostEvent` / `HostWatch` 类型 + `EcclawApi.host` 扩展 |
| `resources/mcp/host-server.mjs` | 三个新 MCP 工具 |
| `src/views/HostEvents.tsx` | **新文件**：宿主事件面板 |
| `src/App.tsx` | 新增「宿主事件」导航项 |

### 关键设计点

1. **持续模式在子进程里跑**：一次 spawn 常驻，按 `intervalMs` 循环调用 `page.observe(context)`，
   每轮 `process.send({type:'poll-event', value})`。不采用「主进程反复 spawn」的做法 ——
   那是每轮一次进程创建，800ms 周期太重。
2. **子进程永远不结束**：`runRunner` 的 `timeoutMs <= 0` 表示不设超时，靠 `stop()` 结束。
3. **`poll-event` 不结算这次执行**：主进程收到就交给事件总线，继续等。
4. **停止是 fail-safe 的**：包内没有 poll 观察器时，runner 直接回一条错误结果，
   主进程把它转成一条 `{error}` 事件，agent 不会「安静地什么都不发生」。
5. **长轮询是订阅，不是轮询**：agent 一次调用就挂着等事件；事件到了立刻醒。
   超时返回 `null` 而不是报错，agent 可以带着 `sinceSeq` 再等一轮。

---

## 4. 实测证据

脚本：`C:/Temp/ecclaw-verify/poll-subscribe-e2e.cjs`
（真实 MCP 进程 + 真实宿主 + 真实渲染进程，fixture 页面 `http://127.0.0.1:8898/demo`）

```
[0] MCP 工具总数 = 16；三个新工具齐备 = true
[1] ecclaw_watch → [{"watchId":"w-mvyj5ghl-2","packageId":"ecclaw-observer-demo",
                     "pageId":"builtin:ecclaw-observer-demo-poll","eventCount":0}]
[2] next_event#1 → {"seq":1,"kind":"observe","observationId":"ecclaw-demo-poll",
                     "value":{"mode":"poll","url":"http://127.0.0.1:8898/demo", ...}}
[3] next_event#2 → {"seq":2, ...}     ← seq 递增
[4] next_event#3 → {"seq":3, ...}
[5] 界面事件流前几条 = ... #4 observe ... #3 observe ... #2 observe ... #1 observe
[6] watch_stop → []
[7] 停止后排干：残留 3 条，最终 null = true
断言整体通过 = true
```

- 事件时间戳 `00:37:47.298 → 00:37:48.107 → 00:37:48.919` —— 间隔 ≈ 810ms，
  与包内 `intervalMs: 800` 一致，**持续刷新**成立。
- [5] 是从渲染进程用 CDP 读出来的：界面确实增量收到了事件（最新在最上）。
- [7] 说明停止后缓冲区里可能还残留 1~3 条**已产出但没被取走**的事件（子进程 kill 有延迟），
  排干后必然返回 `null` —— 不再有新事件。

---

## 5. 真实站点只读复验

脚本：`C:/Temp/ecclaw-verify/real-site-check.cjs`（只读：只开页 + 读 DOM，不点不滚，不需要登录态）

```
[淘宝] https://www.taobao.com/
   打开：title=淘宝  最终 url=https://www.taobao.com/
   读 DOM：h1=淘宝网 元素数=74 链接数=1944
[亚马逊] https://www.amazon.com/
   打开：title=amazon.com  最终 url=https://www.amazon.com/
   读 DOM：h1= 元素数=0 链接数=0
   正文片段：AwsWafIntegration.saveReferrer(); AwsWafIntegration.checkForceRefresh().
断言：两个站点都完成只读打开+读 DOM = true
```

**结论**：

- 宿主在真实电商站点上**开页 + 读 DOM 正常**（淘宝读出 h1「淘宝网」、74 个元素、1944 条链接）。
- 亚马逊返回的是 **AWS WAF 挑战页**（`AwsWafIntegration`），DOM 里没有商品内容。
  这是**反爬拦截**，不是宿主能力问题 —— 内嵌浏览器没有真实登录态 / 真人行为特征时会被挡。
- 因此「真实站点的写操作闭环（登录态下点搜索/加购/下单）」**仍然没有验证**：
  需要用户自己的登录态与人工过验证码，属于高风险动作，本阶段不做（红线：风险自负）。

---

## 6. 已知边界

1. 持续观察**只在包里有 poll 观察器时**才有意义；没有的话 watch 会立刻产出一条错误事件。
2. 事件缓冲 200 条，环形覆盖；消费方应尽快取走。
3. `ecclaw_next_event` 是**广播**语义：多个订阅者会拿到同一条事件（各自维护 `sinceSeq`）。
4. 长轮询期间宿主页面被关闭：子进程会拿到 evaluate 失败，包内 observe 抛错，
   事件里带 `{error}`，watch 仍活着。
5. 界面事件流保留最近 60 条。
