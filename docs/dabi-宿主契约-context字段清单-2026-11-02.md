# dabi 宿主契约 —— 动作 `context` 字段清单（2026-11-02 实测）

> 证据来源：本机真实 dabi 平台包 `runtime.cjs`（17 包 / 18 个版本目录）静态直读，
> **未做 REA**。扫描脚本：`C:/Temp/ecclaw-verify/ctx-scan.cjs`（粗扫）、
> `ctx-scan2.cjs`（只统计「形参名为 context 的函数」体内的高精度扫描）。
>
> 宿主侧实现（dabi Electron 主进程）本机**未安装**（`C:/Program Files/dabi` 是空目录），
> 因此本清单描述的是**平台包一侧所依赖的宿主契约**——这正是 ecclaw 要实现的那一面。

## 1. 关键结论（先看这三条）

1. **平台包从不接触 `webContents` / `executeJavaScript`**：全 17 包的 `runtime.cjs`
   里 `webContents`、`executeJavaScript` 出现次数为 **0**。包与页面之间的唯一桥梁是
   `context.eval(source, options?)`（以及同义的 `context.evaluate`）。
   → ecclaw 只要实现 `context.eval`，就能复用绝大多数 dabi 包。
2. **`context.eval` 返回的是结构化值，不是字符串**：例如 taobao 包
   `readTaobaoSearchReadiness()` 直接写 `const state = await context.eval(JS)`，
   然后访问 `state.url` / `state.documentId` / `state.data`。
   → 宿主必须把页面表达式的值**结构化回传**（Electron `webContents.executeJavaScript` 正好满足）。
3. **数据查询（dataQueries）是另一条通道，表达式在页面里跑**：
   `pkg.dataQueries[id].buildExpression(args)` 返回一段**字符串表达式**，
   由宿主拿到后**放进页面执行**（包内代码直接用 `document.querySelector` / `fetch(credentials:'include')`）。
   → ecclaw 宿主需要「取表达式 → 在页面求值」两步。

## 2. `context` 字段清单

高精度扫描口径：只统计「形参名含 `context` 的函数」体内的 `context.<prop>` 访问。
`pkg=` = 17 个真实包里命中该字段的包数（≥4 基本可判定为宿主契约，≤2 多为包内自造局部变量）。

| 字段 | pkg | 类型（推断） | 语义与证据 |
|---|---|---|---|
| `tabId` | 15 | `string \| number` | 宿主标签页标识。`console.info(\`…tab=${context.tabId ?? "-"}\`)`；被用作缓存键前缀（`rememberTaobaoSearchForAction(tabId,…)` 拼成 `tab:${tabId}|builtin:taobao-search|…`） |
| `url` | 14 | `string` | 当前页 URL。`matchTaobaoDetail(context)` 里 `isTaobaoDetailUrl(context.url)`；`readTaobaoSearchReadiness` 校验 `state.url !== context.url`（页面内 URL 与宿主 URL 必须一致） |
| `title` | 13 | `string` | 页面标题，传给 view model 构造 |
| `capability` | 13 | `string` | 本次要执行的能力 id。`context.capability !== "taobao.product.exportSkuList"` 等分支判断 |
| `actionId` | 7 | `string` | 动作 id（与 capability 相近但独立） |
| `payload` | 14 | `object` | 动作入参。`itemIdFromPayload(context.payload)`、`normalizeSkuListPayload(context.payload)` |
| `resourceId` | 9 | `string` | 资源标识（商品/店铺/报表 id）。`socialKindForResourceId(context.resourceId)` |
| `pageIdentity` | 11 | `string` | 页面身份（用于跨次读取的稳定键）。`context.pageIdentity ?? context.pageIdentitySeed ?? context.url` |
| `pageIdentitySeed` | 5 | `string` | 页面身份种子，缺失时回退到 identity / url |
| `signal` | 4 | `AbortSignal` | 取消信号。`context.signal?.throwIfAborted()`、`context.signal?.addEventListener("abort", abort, {once:true})`、`controller.abort(context.signal?.reason)` |
| `sleep` | 12 | `(ms:number)=>Promise<void>` | 宿主提供的等待。`await context.sleep(1e3)`、`context.sleep(300)`（轮询页面就绪） |
| `eval` | 14 | `(source:string, options?:{timeoutMs?:number})=>Promise<any>` | **在页面里执行表达式并回传结构化值**。`context.eval("location.href")`、`await context.eval(TAOBAO_SEARCH_SIDEPANEL_READY_JS)`；第二参 `true` 用于「只执行不取返回值」的注入场景（`await context.eval(source, true)`） |
| `evaluate` | 4 | 同 `eval` | 同义别名，bi 包用：`await context.evaluate(BI_MARKET_CAP_PROBE_JS, { timeoutMs: 5e3 })` |
| `observation` | 8 | `{ id:string, … }` | 触发本次观察的观察器定义。`context.observation.id === TAOBAO_SHOP_MODERN_CATEGORY_CARD_OBSERVATION.id` |
| `event` | 11 | 见 §3 | 本次事件（网络响应 / 轮询 / DOM 信号）。`context.event.mode` 分派 |
| `tab` | 1 | `{ key:string, label:string }` | 侧栏内子标签（bi 包）：`context.tab.key === "goods"`、`context.tab.label !== expectedLabel` |

> `pkg ≤2` 的零散字段（`state` / `period` / `category` / `shopId` / `resource` / `data`…）
> 是 bi、dmp 这类包**自造的局部上下文**（函数里另有一个同名 `context` 局部变量），
> **不是宿主契约**，不要照抄。

## 3. `context.event` 结构（网络/轮询事件）

三种 `mode`（`context.event.mode`）：

| mode | 触发 | 关键字段 |
|---|---|---|
| `network-response` | 宿主拦截到网络响应 | `event.request.url`、`event.request.method`、`event.request.headers`、`event.request.postData`、`event.response?.status`、`event.bodyText`、`event.base64Encoded` |
| `poll` | 宿主定时轮询 | 同上字段可能为空；`context.event.mode === "poll"` → 走 `extract` 重读页面 |
| `dom-signal` | 页面内脚本主动上报 | `event.message`（字符串，前缀约定 + JSON 负载，如 `TAOBAO_SEARCH_CATEGORY_SIGNAL_PREFIX`） |

例（taobao 搜索包 `observeTaobaoSearch`）：
```js
const rawPayload = extractTaobaoSearchPassiveData({
  requestUrl: context.event.request.url,
  postData: context.event.request.postData,
  responseBody: context.event.bodyText,
  base64Encoded: context.event.base64Encoded
})
```

### 3.1 ecclaw 实测落地（2026-11-02）

观察器定义（`observations(context)` 返回项）实测形状（doudian-compass 等真实包）：

```js
{
  id: "search-overview-response",
  mode: "network-response",
  lifecycle: "page",
  captureBody: false,                                   // true 时宿主抓响应体
  request: { urlIncludes: ["/compass_api/shop/mall/search_analysis/"], method: "GET" }
}
```

ecclaw 宿主当前实现：

| mode | 状态 | 实现 |
|---|---|---|
| `network-response` | ✅ | CDP `Network` 域：`requestWillBeSent` 记请求 → `responseReceived` 记状态 → `loadingFinished` 匹配 → `Network.getResponseBody` 取体 → 作为 `context.event` 喂给 `page.observe(context)` |
| `poll` | ✅ | 包内给 `intervalMs` / `runImmediately`；宿主按间隔触发一次 observe，事件为 `{mode:'poll',observationId}` |
| `dom-signal` | ✅ | 包内给 `signalPrefix` + `installScript`（+`stopScript`）；宿主注入脚本并监听页面 console 消息前缀，事件为 `{mode:'dom-signal',message}` |

实测包内**真正会读**的事件字段：`event.mode`、`event.request.url`、`event.request.postData`、
`event.bodyText`、`event.base64Encoded`；宿主另补 `event.response.status` 与 `context.observation.id`。

端到端样例（`resources/platform-packages/ecclaw-observer-demo/`，dabi 同形 pages 契约）：

```json
{
  "mode": "network-response",
  "url": "http://127.0.0.1:8898/api/demo/echo?probe=1793551712208",
  "method": "GET",
  "status": 200,
  "base64Encoded": false,
  "bodyText": "{\"ok\":true,\"path\":\"/api/demo/echo\",…}",
  "observationId": "ecclaw-demo-network"
}
```

> 注意：CDP `Network.enable` 在 observe 启动**之后**才生效，页面此前发出的请求抓不到，
> 必须由页面**后续**再发一次请求才会命中。

## 4. 平台包对象契约（宿主要提供什么）

`runtime.cjs` 导出（CommonJS）：

```js
{
  manifest: { packageId, version, sites, pages, runtime, … },
  pages: [{
    id: "builtin:taobao-search",
    actions: { [capabilityId]: async (context) => result },   // 动作
    automationActions: { [capabilityId]: fn },                // 需要「准备」阶段的动作
    observations: () => [{ id, … }],                           // 观察器定义
    observe: async (context) => result,                       // 事件驱动观察
    extract: async (context) => result,                        // 主动提取（读 DOM）
    match: (context) => boolean                               // 用 context.url 判定是否适用
  }],
  dataQueries: { [queryId]: { scene, description, args, buildExpression(args) } },
  canOpenSidePanel: ({ url }) => ({ openable, … }),
  checkPageAccess, resolveSidePanelNavigation
}
```

宿主动作链（phase2 已实证）：`sidePanelStrategyManager.actionHandler(context, capability, strategyId)`
→ 找到 `page.actions[capability]` → 以 `context` 调用它。

## 5. `@dabi/plugins` SDK（宿主注入的全局对象）

包内 `node_modules/@dabi/plugins/index.cjs` 只有 4 行：

```js
const key = Symbol.for('com.dabiai.plugins.sdk')
const sdk = globalThis[key]
if (!sdk) throw new Error('@dabi/plugins host SDK is not available')
module.exports = sdk
```

→ **宿主必须在 require runtime.cjs 之前注入 `globalThis[Symbol.for('com.dabiai.plugins.sdk')]`**
（ecclaw 现有的能力探测子进程已经这么做了，见 `electron/main/platform-runtime.ts`）。

各包用到的 SDK 成员（按调用次数）：

| 成员 | 次数 | 备注 |
|---|---|---|
| `updateActionStatus` | 778 | 动作进度上报 |
| `browser.eval` | 457 | `browser.eval(source, { timeoutMs })` → 页面求值，**与 `context.eval` 同一能力** |
| `evalPage` | 227 | `evalPage(source, options)`，同义 |
| `logger.warn/debug/info` | 165 | 日志 |
| `saveCSV` / `saveImages` / `saveMarkdown` / `saveFiles` / `saveVideos` / `saveXLSX` / `saveText` | 96 / 41 / 30 / 17 / 16 / 12 / 7 | 落盘导出 |
| `resourceCache.get` / `resourceCache.run` | 62 / 60 | 资源缓存 |
| `readXlsxFirstSheet` | 36 | Excel 读取 |
| `runAutomationScript` | 21 | 自动化脚本 |
| `matchURL` | 18 | URL 匹配 |
| `requestAPI` | 11 | 接口请求 |
| `browser.click` / `scroll` / `interceptNext` / `waitForNavigation` | 40 / 9 / 9 / 3 | 页面交互（**写操作**，ecclaw 起步阶段不实现） |
| `rollingVideo.*` / `withBackgroundPage` / `runFrameBridgeTask` / `getTheme` | 少量 | 宿主级能力 |

**起步阶段最小 SDK**：`logger.*`、`updateActionStatus`、`browser.eval`、`evalPage` 四个就够跑通只读动作。

## 6. 两条不同的执行路径（别混淆）

```
路径 A —— 页面动作 / 观察（read-only 也走这条）
  宿主 page ──(构造 context)──> 包内 page.actions[capability](context)
                                    └─ context.eval(src) ──> 宿主 ──> 页面 executeJavaScript(src)

路径 B —— 数据查询
  包内 pkg.dataQueries[id].buildExpression(args) ──> 表达式字符串
  宿主把表达式放进页面执行 ──> 页面内 fetch(document.querySelector…) ──> JSON 结果
```

路径 B 的包内代码直接访问 `document` / `fetch`（见 `databank` 的
`list-leaf-category`：用 `document.querySelector("meta[name=_csrf]")` 取 csrf，
再 `fetch(url, { credentials: 'include' })`），**必须在真实页面上下文里跑**。

## 7. ecclaw 最小宿主要做的事（据此定案）

1. 一个 Electron `WebContentsView`（Electron 45 可用）承载被操作的页面。
2. 一个 `context` 适配层，字段严格按 §2 表格。
3. `context.eval` → `webContents.executeJavaScript(source, true)`（结构化回传）。
4. `context.sleep` → `setTimeout`。
5. 加载真实 dabi `runtime.cjs` 时注入最小 SDK（§5）。
6. 数据查询走「子进程取表达式 → 主进程在页面求值」两步。

> 边界提醒（沿用）：ecclaw **没有**店铺登录态 profile（明确不做），
> 起步只在无账号 / 本地页面验证；`browser.click` 等写操作暂不实现。

## 8. 复现命令

```bash
cd C:/Temp/ecclaw-verify && node ctx-scan.cjs   # 粗扫（含噪音）
cd C:/Temp/ecclaw-verify && node ctx-scan2.cjs  # 高精度（只统计 context 形参函数）
```
