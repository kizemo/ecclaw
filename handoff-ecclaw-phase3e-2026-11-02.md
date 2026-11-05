# handoff — ecclaw 第五阶段收官（内嵌浏览器宿主 · observe 事件通道全模式）

> 承接 `handoff-ecclaw-phase3d-2026-11-02.md`（第五阶段原型）/ `handoff-ecclaw-phase3c-2026-11-02.md`（第四阶段）。
> 权威背景仍以 `handoff-ecclaw-phase2-2026-11-01.md` 为准。
> 本文件只写**本轮增量**，前序结论不重复。

## 1. 本次交付（全部已验证）

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 可见内嵌浏览器（占位盒 → `view.setBounds`） | ✅ | 主进程 bounds `(274.7, 521.4, 1093×420)` == 占位盒 rect；宿主页面 `innerWidth/innerHeight` 实测 = 1093×420 |
| 2 | `packages:run-extract` 的 UI 入口 | ✅ | 「执行页面提取」按钮；demo 包 + `/demo` → `{url,title,tabId,pageIdentity}`（match 自动匹配命中） |
| 3 | context 构造**单一来源** | ✅ | `action-context.ts` 的 `createActionContext` + `contextBuilderSource()`（`fn.toString()`）内联进 runner；重构后数据查询/动作/提取全绿 |
| 4 | 宿主契约**覆盖矩阵** | ✅ | `docs/dabi-宿主契约-覆盖矩阵-2026-11-02.md`：15 个契约字段**全部已实现，真实缺口 = 0**（`context.page`/`context.tab` 判定为包内局部变量，非契约） |
| 5 | **observe 通道 · network-response** | ✅ | `{mode:"network-response",url:"…/api/demo/echo?probe=…",method:"GET",status:200,base64Encoded:false,bodyText:"{\"ok\":true,…}",observationId:"ecclaw-demo-network"}` |
| 6 | **observe 通道 · poll** | ✅ | `{mode:"poll",observationId:"ecclaw-demo-poll",url,title}`（`intervalMs` / `runImmediately` 生效） |
| 7 | **observe 通道 · dom-signal** | ✅ | `{mode:"dom-signal",message:"ecclaw-demo-signal:changed:1",observationId:"ecclaw-demo-signal"}` |
| 8 | 能力探测**去噪**（18 包全绿） | ✅ | 探测给 `observations(context)` 传空壳 context + SDK stub 补 `matchURL`/`logger` → 18 包 `err` 全 null；`doudian` 观察器 10 → **37**；托管技能 17 → **18** |
| 9 | typecheck + build | ✅ | `tsc -p tsconfig.node.json` NODE_OK；`tsconfig.web.json` WEB_OK；`pnpm build` ✓ |

## 2. 关键事实（本轮新增）

### 2.1 observe 的 dabi 契约（实测 doudian-compass 等真实包）

观察器定义形状：

```js
{ id, mode: 'network-response' | 'poll' | 'dom-signal', lifecycle: 'page',
  captureBody: true,
  request: { urlIncludes: ['/api/…'], method: 'GET' },   // network-response
  intervalMs: 1500, runImmediately: true,                 // poll
  signalPrefix: 'xxx:', installScript: '…', stopScript: '…' } // dom-signal
```

包内**真正会读**的事件字段：`event.mode` / `event.request.url` / `event.request.postData` /
`event.bodyText` / `event.base64Encoded`（`c.event.*` 命中 4 种）。宿主另补 `event.response.status` 与
`context.observation.id`。dom-signal 的 `event.message` = 页面 console 原始消息（前缀 + 负载）。

### 2.2 三条硬坑（都踩过）

1. **CDP `Network.enable` 在 observe 启动之后才生效** → 页面此前发出的请求抓不到，
   必须让页面**后续**再发一次请求才会命中（fixture 用 1.2s 定时请求）。
2. **observe 需要「ack 握手 + 事件缓冲」**：子进程发 `observations` → 宿主装 dom-signal 脚本 → 回
   `observations-ack` → 子进程才等事件；**ack 之前到达的事件必须缓冲**（注入脚本可能立刻打 console），
   否则 dom-signal 事件丢失，子进程等到 45s 超时。
3. **Electron 45 的 `console-message` 第一个参数即事件对象**（`event.message`），
   旧位置参数 `(event, level, message, …)` 已 deprecated；类型定义会把第二参推成 `number` → 必须用第一个参数。

### 2.3 能力探测的两个修正

- `observations(context)` **必须带 context** 调用：真实包读 `c.url`；无参调用会抛
  `Cannot read properties of undefined (reading 'url')`，被误记成「探测失败」。
- 探测注入的 SDK stub 必须有 `matchURL`（qianniu 的 `observations()` 会调 `matchURL`）。

## 3. 改动清单（工作区文件，项目非 git 仓库）

**新增**
- `resources/platform-packages/ecclaw-observer-demo/manifest.json`（3 个页面）
- `resources/platform-packages/ecclaw-observer-demo/runtime.cjs`（dabi 形状 pages 契约，3 种 mode 各一页）
- `docs/dabi-宿主契约-覆盖矩阵-2026-11-02.md`

**修改**
- `electron/main/browser-host.ts`：CDP Network 捕获（`enableNetworkCapture` / `setNetworkMatchers` /
  `onNetworkEvent`）、dom-signal（`installDomSignal` / `onDomSignal` / `stopDomSignal`）、`setViewport` / `status`
- `electron/main/platform-actions.ts`：runner 脚本加 `waitReady` / `waitForEvent` / `sleep` / 事件缓冲；
  `RunnerSpec.mode` 加 `'observe'`；新增 `runPageObserve()`
- `electron/main/host-service.ts`：`hostRunObserve`
- `electron/main/index.ts`：IPC `packages:run-observe` / `host:set-viewport` / `host:status`
- `electron/main/platform-runtime.ts`：探测传空壳 context + SDK stub 补 `matchURL`/`logger`
- `electron/main/action-context.ts`：`createActionContext` 类型化实现 + `contextBuilderSource()`
- `electron/shared/types.ts`、`electron/preload/index.ts`：`runObserve` / `setViewport` / `status`
- `src/App.tsx`：「显示/隐藏内嵌浏览器」按钮 + `.host-viewport` 占位盒 + 「执行页面提取」「执行页面观察」按钮
- `src/styles.css`：`.host-viewport` / `.host-viewport-hint`
- `README.md`（§5.8 + §8）、`task.md`（第五阶段表 + 11 条实证发现）
- `docs/dabi-宿主契约-context字段清单-2026-11-02.md`（新增 §3.1 ecclaw 实测落地）

**临时验证脚本**（`C:/Temp/ecclaw-verify/`，勿删）
`fixture-server.cjs`（已加 `/api/demo/echo` + 只拦 databank 的 fetch stub + 1.2s 定时请求）、
`gui-host.cjs`、`gui-host-action.cjs`、`gui-host-visible.cjs`、`gui-host-observe.cjs`（接页面 id 参数，
`""`=network / `-poll` / `-signal`）、`gui-host-extract-demo.cjs`、`gui-capabilities.cjs`、`ctx-coverage.cjs`

## 4. 运行事实（下次直接复用）

### 4.1 GUI 验证配方

```bash
cd F:/soft/00selfmade/ecclaw && pnpm build
ECCLAW_LOCAL_PACKAGES_DIR="C:/Users/Duanyi/AppData/Roaming/com.dabiai.desktop/platform-packages" \
  npx electron . --remote-debugging-port=9222          # 后台
cd C:/Temp/ecclaw-verify && node fixture-server.cjs    # 8898，后台
cd C:/Temp/ecclaw-verify && node gui-host-observe.cjs ""                       # network 模式
cd C:/Temp/ecclaw-verify && node gui-host-observe.cjs "builtin:ecclaw-observer-demo-poll"   # poll
cd C:/Temp/ecclaw-verify && node gui-host-observe.cjs "builtin:ecclaw-observer-demo-signal" # dom-signal
cd C:/Temp/ecclaw-verify && node gui-host.cjs && node gui-host-action.cjs && node gui-host-extract-demo.cjs
```

### 4.2 坑

- **CDP 多 target**：宿主打开 fixture 后 `/json/list` 里有多个 page → 必须
  `list.find(t => t.type==='page' && /index\.html$/.test(t.url))`。
- **端口残留**：fixture server 端口 8898 可能被上一轮的 node 进程占着（`netstat -ano | grep 8898`
  找到 PID 后 `taskkill //PID <pid> //T //F`），否则新起的 server 直接 EADDRINUSE，页面还是旧的。
- **computer-use 截屏全黑** → 一律 CDP 驱动；可见性用「宿主页面视口尺寸 == 占位盒尺寸」取证。
- **Electron 内 spawn 子进程必带 `ELECTRON_RUN_AS_NODE=1`**。
- CSS px 与 Electron DIP 1:1。

## 5. 环境状态（交接时）

- electron：**状态不确定**（本轮多次 `taskkill` 重启；最后一次后台任务报 exit 1，可能已被终止，
  也可能仍占着 9222）→ 下轮开工第一件事照做 `taskkill //IM electron.exe //T //F`，
  再按 §4.1 重启（代码已 build 过，但改了包 runtime.cjs 后需重跑 `pnpm build`）。
- fixture server：仍在 8898（`node fixture-server.cjs`，后台，页面已含 `/api/demo/echo` + 1.2s 定时请求）；
  可复用，端口冲突时按 §4.2 杀掉再起
- 项目**不是 git 仓库**：无 commit、无 git init 要求

## 6. 下一步（按优先级）

1. **把宿主接进对话链路**：目前四条宿主通道只能从「平台包」页手动触发；
   下一步应让 agent 通过技能里的能力 id 发起调用（当前技能只是目录，不执行动作）。
2. **写操作能力**：宿主最小 SDK 里 `browser.click` / `scroll` / `interceptNext` / `waitForNavigation` 仍抛
   「暂不支持」；dabi 的准备阶段（`automationActions`）依赖它们。
3. **真实站点复验**：observe 只在 fixture 上验过；可用真实 dabi 包（如 doudian-compass 的
   `urlIncludes:["/compass_api/shop/common/homepage/"]`）在真实站点复验。
4. **poll 语义补全**：当前 poll 只触发**一次**；dabi 是持续刷新（侧栏联动），可加「订阅式」调用形态。
5. dom-signal 的 `installScript` 目前用 `executeJavaScript` 注入；dabi 真实包还带 `stopScript` 清理（已支持）。

## 7. 红线与避坑（沿用，勿违）

- 不重做逆向（REA 已结案，结论见 `task.md`「尚未做」段）
- 不改已定案的平台包协议；`runtime.cjs` 是第三方代码 → 一律子进程加载
- 不删 `C:/Temp/rea-dabi`、`C:/Temp/ecclaw-verify`
- 禁止删除用户文件（含版本目录清理）
- 临时产物写 `C:/Temp/`
- 项目非 git 仓库 → 不要 `git init` / `commit`
- `openclaw.json` 含明文 relay key → 勿外传；relay 验收对话保持最小
- Electron 内 spawn 必带 `ELECTRON_RUN_AS_NODE=1`
- 宿主页面 sandbox + contextIsolation + nodeIntegration=false

## 8. 必读顺序

1. 本文件 §1（交付与证据）→ §2（坑）
2. `docs/dabi-宿主契约-context字段清单-2026-11-02.md`（含 §3.1 observe 实测）
3. `docs/dabi-宿主契约-覆盖矩阵-2026-11-02.md`（字段覆盖结论）
4. `electron/main/browser-host.ts` + `electron/main/platform-actions.ts`（宿主与执行器）
5. `task.md` 第五阶段表（阶段状态与实证发现）
