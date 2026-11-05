# handoff — ecclaw 第五阶段（候选 3：内嵌浏览器宿主 · 最小原型）

> 权威背景沿用 `handoff-ecclaw-phase2-2026-11-01.md`（项目背景/平台包协议/能力边界/绝对路径）
> 与 `handoff-ecclaw-phase3c-2026-11-02.md`（第四阶段：GUI 抽查 + 远程包仓库）。
> 本文件只记 2026-11-02 第五阶段增量。

## 1. 本次交付（已完成）

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | **摸清 dabi 宿主契约**（不做 REA，直接读真实 runtime.cjs） | ✅ | 17 包 / 18 个版本目录静态直读；产出 `docs/dabi-宿主契约-context字段清单-2026-11-02.md`；扫描脚本 `C:/Temp/ecclaw-verify/ctx-scan.cjs`（粗扫）+ `ctx-scan2.cjs`（高精度） |
| 2 | **ecclaw 最小宿主原型**（Electron WebContentsView + dabi 形状 context） | ✅ | 新增 `electron/main/browser-host.ts`、`action-context.ts`、`platform-actions.ts`、`host-service.ts`；IPC `host:open` / `host:read-dom` / `packages:run-data-query` / `packages:run-action` / `packages:run-extract` |
| 3 | **跑通一条只读动作（打开页面 → 读 DOM → 返回结果）** | ✅ | GUI（CDP 驱动真 Electron）：打开 fixture 页 → `itemCount=3` / h1 / bodyText / linkCount 全部读出 |
| 4 | 额外：**真实 dabi 数据查询跑通** | ✅ | `databank / list-leaf-category`：包内 `buildExpression({"keyword":"衣"})` → 宿主在页面里求值 → `{ok:true,total:1,categories:[{cateId:"101",cateName:"连衣裙",cateFullName:"女装/连衣裙",cateLevel:3}]}`（keyword 过滤确实生效：T恤 被滤掉），durationMs=85 |
| 5 | typecheck + build | ✅ | `tsc -p tsconfig.node.json --noEmit` NODE_OK；`tsconfig.web.json` WEB_OK；`pnpm build` ✓（out/preload 2.56 kB / renderer 598 kB） |

## 2. 关键事实（本轮最大的收获：宿主契约）

### 2.1 三条硬结论

1. **平台包从不接触 `webContents` / `executeJavaScript`** —— 全 17 包 runtime.cjs 里出现次数为 **0**。
   包与页面之间**唯一**的桥是 `context.eval(source, options?)`（及同义别名 `context.evaluate`）。
   → ecclaw 只要实现 `context.eval`，就能复用绝大多数 dabi 包，不需要复刻 Electron 内部对象。
2. **`context.eval` 回传的是结构化值，不是字符串**。taobao 包写的是
   `const state = await context.eval(JS)` 然后直接访问 `state.url` / `state.documentId` / `state.data`。
   → 宿主必须把页面表达式的值结构化回传（`webContents.executeJavaScript(source, true)` 正好满足）。
3. **数据查询（dataQueries）是另一条通道，表达式在页面里跑**：
   `pkg.dataQueries[id].buildExpression(args)` 返回**表达式字符串**，宿主把它放进页面执行。
   包内代码直接用 `document.querySelector("meta[name=_csrf]")` 和 `fetch(url,{credentials:'include'})`。

### 2.2 context 字段清单（摘要，全表见 docs/）

宿主契约（跨包命中 ≥4 的字段）：`tabId` `url` `title` `capability` `actionId` `payload` `resourceId`
`pageIdentity` `pageIdentitySeed` `signal` `sleep` `eval` `evaluate` `observation` `event` `tab`。

- `sleep(ms)`：宿主提供的等待（页面就绪轮询用）。
- `signal`：AbortSignal（`context.signal?.throwIfAborted()`）。
- `event`：三种 mode —— `network-response`（`event.request.url/method/headers/postData`、`event.response.status`、
  `event.bodyText`、`event.base64Encoded`）、`poll`、`dom-signal`（`event.message`）。
- `observation`：本次触发的观察器定义，包里只用到 `.id`。
- ⚠️ `pkg ≤2` 的零散字段（`state` / `period` / `category` / `shopId` …）是 bi、dmp 包**自造的局部变量**，
  **不是宿主契约**，别照抄。

### 2.3 平台包对象契约

```js
{
  manifest, 
  pages: [{ id, actions:{capId:async(context)=>r}, automationActions:{...},
            observations:()=>[{id}], observe:async(context)=>r, extract:async(context)=>r,
            match:(context)=>bool }],
  dataQueries: { [queryId]: { scene, description, args, buildExpression(args) } },
  canOpenSidePanel, checkPageAccess, resolveSidePanelNavigation
}
```

### 2.4 `@dabi/plugins` SDK

包内 `node_modules/@dabi/plugins/index.cjs` 只有 4 行，读
`globalThis[Symbol.for('com.dabiai.plugins.sdk')]`；**宿主必须在 require runtime.cjs 之前注入**。
各包用到的成员：`updateActionStatus`(778) `browser.eval`(457) `evalPage`(227) `logger.*`(165)
`saveCSV/saveImages/saveMarkdown/...` `resourceCache.*` `readXlsxFirstSheet` `runAutomationScript`
`matchURL` `requestAPI` `browser.click/scroll/interceptNext/waitForNavigation`（**写操作，本轮不实现**）
`rollingVideo.*` `withBackgroundPage` `runFrameBridgeTask` `getTheme`。
起步最小 SDK：`logger.*` + `updateActionStatus` + `browser.eval` + `evalPage` 四个就够。

## 3. 改动清单（工作区文件，无 git）

| 文件 | 改动 |
|---|---|
| `electron/main/browser-host.ts` | **新建**：`BrowserHost`（Electron `WebContentsView`，sandbox + contextIsolation + nodeIntegration=false；`open` / `eval`（带超时）/ `readDom`（DOM 概览）/ `close`） |
| `electron/main/action-context.ts` | **新建**：dabi 形状的 `createActionContext(init, bridge)`（字段按 §2.2 全给，含 `sleep`/`eval`/`evaluate`/`signal`） |
| `electron/main/platform-actions.ts` | **新建**：子进程执行器（`RUNNER_SCRIPT`）—— 注入最小 SDK → require runtime.cjs → 三种模式：`data-query`（取表达式）/ `action`（`page.actions[capability]`）/ `extract`（`page.extract(context)`）；页面求值走 IPC RPC（子进程 `{type:'eval'}` → 主进程在页面里求值 → 回传） |
| `electron/main/host-service.ts` | **新建**：服务层（绑主窗口 → BrowserHost；找包 runtime；解析 JSON 参数；三种执行入口） |
| `electron/main/index.ts` | 新增 5 个 IPC + `initHost(mainWindow)` |
| `electron/main/platform-runtime.ts` | `runtimeFile()` 改为导出 |
| `electron/preload/index.ts` | 新增 `packages.runDataQuery/runAction/runExtract` + `host.open/readDom` |
| `electron/shared/types.ts` | 新增 `HostPageInfo` / `DomSnapshot` / `HostCommandResult` + `EcclawApi` 5 个方法 |
| `src/api.ts` | 导出上述类型 |
| `src/App.tsx` | 平台包页新增「内嵌浏览器宿主（实验）」卡片：URL 输入 + 「打开并读 DOM」+ 包 id / 查询 id / 参数 / 「执行数据查询」+ 能力 id / 「执行页面动作」；输出用 `<pre class="host-out">` |
| `src/styles.css` | 新增 `.host-out` 样式 |
| `docs/dabi-宿主契约-context字段清单-2026-11-02.md` | **新建**：字段清单 + SDK 清单 + 两条执行路径 |
| `task.md` | 新增「第五阶段」表 + 实证发现 |
| `C:/Temp/ecclaw-verify/`（勿删） | 新增 `ctx-scan.cjs` / `ctx-scan2.cjs` / `fixture-server.cjs`（8898 端口 fixture 页）/ `gui-host.cjs` / `gui-host-read.cjs` / `gui-host-action.cjs`（**本轮未跑，见 §5**） |

## 4. 运行事实（下次直接复用）

### 4.1 架构：三层

```
渲染进程 UI（平台包页「内嵌浏览器宿主」卡片）
   ↓ IPC
主进程 host-service
   ├─ BrowserHost：WebContentsView 承载页面；eval = webContents.executeJavaScript(src, true)
   └─ platform-actions：spawn 子进程（ELECTRON_RUN_AS_NODE=1）加载真实 runtime.cjs
          子进程要页面求值 → IPC {type:'eval'} → 主进程 eval → 回传 → 子进程
```

- runtime.cjs 是第三方代码，**一律在子进程**里加载（与既有能力探测一致）。
- 子进程与主进程之间用 `stdio: ['ignore','pipe','pipe','ipc']` + `process.send`/`child.send`。

### 4.2 GUI 验证配方（本轮新踩的坑）

```bash
cd F:/soft/00selfmade/ecclaw && pnpm build
ECCLAW_LOCAL_PACKAGES_DIR="C:/Users/Duanyi/AppData/Roaming/com.dabiai.desktop/platform-packages" \
  npx electron . --remote-debugging-port=9222          # 后台
cd C:/Temp/ecclaw-verify && node fixture-server.cjs &   # 8898 端口 fixture 页
cd C:/Temp/ecclaw-verify && node gui-host.cjs            # CDP 驱动
```

- **`ECCLAW_LOCAL_PACKAGES_DIR` 指向 dabi 真实包目录** → ecclaw 直接看到 17 个真包（无需安装）。
- ⚠️ **CDP 有多个 page target**：宿主打开 fixture 后，`/json/list` 里会出现
  `page:ECCLAW 宿主验证页`（WebContentsView）和 `page:ecclaw`（主窗口）两个 target。
  驱动脚本必须按 URL 选主应用那个：
  `list.find(t => t.type==='page' && /index\.html$/.test(t.url))`。
  （踩过一次：driver 连到 fixture 页面 → 报 "Cannot read p…"，误以为是应用崩了。）
- fixture 页要点：① DOM 里放 `li[data-ecclaw-item]` 便于统计；② **页面内 stub 掉 `window.fetch`**，
  才能让真实 dabi 数据查询表达式在页面里跑通（返回与 databank `list-leaf-category` 同构的数据）。
- 验证脚本 `gui-host.cjs` 已修：填 URL → 点「打开并读 DOM」→ 填包/查询/参数 → 点「执行数据查询」，
  最后直接 `JSON.parse` 输出 `{ok, durationMs, value}`。

### 4.3 fixture 页 stub 的 fetch 返回体

```json
{ "errCode": 0, "errMsg": "ok", "data": [
  { "leaf": true, "cateId": "101", "cateName": "连衣裙", "cateFullName": "女装/连衣裙", "cateLevel": 3 },
  { "leaf": true, "cateId": "102", "cateName": "T恤", "cateFullName": "男装/T恤", "cateLevel": 3 }]}
```
databank 的表达式会用 `keyword` 过滤（`cateFullName.includes(keyword) || cateName.includes(keyword)`），
传 `{"keyword":"衣"}` → 只剩「连衣裙」，可作为「参数真的传进去了」的判据。

## 5. 环境状态（交接时）—— ⚠️ 有残留待清

- 本会话末：**Bash 被 ctx-budget-guard 拦（164K/82%）**，因此
  - `taskkill //IM electron.exe //T //F` **没来得及执行** → **下次第一件事：清掉残留 electron.exe**
    （两个实例会抢 openclaw state dir 锁）。启动前也建议先 taskkill。
  - fixture server（8898 端口）已用 TaskStop 停掉（进程树可能仍有 node 子进程，端口占用则换端口）。
- `C:/Temp/ecclaw-verify/` 的 fixture 目录、验证脚本**全部保留**（红线：勿删）。
- 本轮**没有**跑 relay 对话（省额度）；openclaw.json 未被改动。
- `gui-host-action.cjs`（真实 dabi **页面动作**路径验证）**本轮未跑**（写完就被 ctx 闸门拦了）→
  **下一轮必跑**（见 §6 第 1 项）。

## 6. 下一步（按优先级）

1. **跑 `gui-host-action.cjs`**，补上「页面动作」路径的端到端证据
   （taobao / `taobao.search.exportProducts` 打在 fixture 页上，预期是**结构化失败或空结果**——
   fixture 不是淘宝页；但能证明 子进程 → action 查找 → context → eval → 错误回传 整条链是通的）。
2. **把宿主从「1×1 隐藏 view」升级成可见的内嵌浏览器**：主窗口内一个可切换的标签区，
   让用户看到被操作的页面（当前原型页面不可见，只返回结果）。
3. **补 `packages:run-extract` 的 UI 入口**（IPC/preload 已有，UI 没有；用 `page.extract(context)` 走
   dabi 官方的只读读 DOM 入口，需要 URL 命中 `page.match(context)`）。
4. **网络事件通道**：`context.event` 的 `network-response` 模式需要宿主挂
   `webContents.session.webRequest.onCompleted`（或 CDP Network 域）把响应喂给包 —— 这是
   `observe` 路径的前置，目前只支持 `poll` / `dom-signal` 语义。
5. 其余遗留：远程仓库的灰度/回滚；托管技能文档正文（dabi 包内无 .md）；
   店铺登录态 profile（**刻意不做**）。
6. 大价值缺口只剩一个：**让 576 项页面动作真正可执行**（目前只跑通了只读链路）。

## 7. 红线与避坑（沿用，勿违）

- 不重做逆向（REA 已结案）；不改已定案的平台包协议；不删 `C:/Temp/rea-dabi`、`C:/Temp/ecclaw-verify`。
- 禁止删除用户文件（含「版本目录清理」）；临时产物写 `C:/Temp/`；项目不是 git 仓库，不要 `git init`/commit。
- openclaw.json 含明文 relay key，勿外传；relay 验收对话保持最小。
- Electron 内 spawn 内核/子进程必带 `ELECTRON_RUN_AS_NODE=1`。
- 宿主页面 sandbox + contextIsolation + nodeIntegration=false，页面不得拿到 Node 能力。

## 8. 必读顺序

1. 本文件（第五阶段增量）
2. `handoff-ecclaw-phase3c-2026-11-02.md`（第四阶段：远程包仓库 + GUI 抽查配方）
3. `handoff-ecclaw-phase2-2026-11-01.md`（平台包协议 / 能力边界 / 绝对路径）
4. `docs/dabi-宿主契约-context字段清单-2026-11-02.md`（本轮新产出，宿主契约全表）
