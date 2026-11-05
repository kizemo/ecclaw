# handoff — ecclaw 第七阶段收官（宿主写操作）

> 承接 `handoff-ecclaw-phase3f-2026-11-02.md`（第六阶段收官：宿主接进对话链路 · MCP）。
> 权威背景仍以 `handoff-ecclaw-phase2-2026-11-01.md` 为准；本文件只写**本轮增量**。

## 1. 本次交付（全部已验证）

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | `browser.click` | ✅ | `electron/main/browser-host.ts` → `click()`：定位（selector + text + frame）→ 可见时真实鼠标事件、隐藏时 DOM `el.click()` |
| 2 | `browser.scroll` | ✅ | `scroll()`：无 target 滚窗口、有 target 滚容器；`Input.synthesizeScrollGesture` + 效果校验 + DOM 回退 |
| 3 | `browser.interceptNext` | ✅ | `interceptNext()`：glob 匹配下一次请求 → `Network.getResponseBody` → 回执 `{url,method,status,body}` |
| 4 | `browser.waitForNavigation` | ✅ | `waitForNavigation()`：`did-navigate` / `did-navigate-in-page`（忽略同 URL） |
| 5 | 子进程 RPC 通道 | ✅ | `platform-actions.ts`：`RUNNER_SCRIPT` 的 SDK stub 从 `unsupported(...)` 改成 `rpcOp(...)`；`runRunner` 新增 `type:'op'` 消息 |
| 6 | 示例包 | ✅ | `resources/platform-packages/ecclaw-writer-demo`（4 个动作：click / scroll / intercept / navigate） |
| 7 | 验证页 | ✅ | `C:/Temp/ecclaw-verify/fixture-writer.cjs`（**端口 8897**；8899 已被别的服务占用，8898 是旧 fixture） |
| 8 | 端到端 | ✅ | 可见 × 隐藏 × 4 动作 = **8/8 全绿** |
| 9 | MCP 层 | ✅ | `tools/call ecclaw_run_action{packageId:"ecclaw-writer-demo"}` → `ok:true` |
| 10 | typecheck + build | ✅ | `pnpm typecheck` ✓；`pnpm build` ✓ |

细节见 `docs/ecclaw-宿主写操作-2026-11-02.md`。

## 2. 关键事实（本轮新增）

### 2.1 dabi 真实包的写操作签名（实测自 17 个真实包）

```js
browser.click({ selector, text?, frame? }, { humanize?, timeoutMs? })
browser.scroll({ deltaY?, target?: { selector, frame? }, humanize? }, { timeoutMs? })
browser.interceptNext(globPattern, { timeoutMs })   // → { url, method, status, body }
browser.waitForNavigation({ timeoutMs })            // → { url }
```

- 真实包里 SDK 是 `require("@dabi/plugins")`，宿主把最小 SDK 注入在
  `globalThis[Symbol.for('com.dabiai.plugins.sdk')]`（demo 包可直接读这个全局）。
- `interceptNext` 的 pattern 是 glob（`*` 通配），例：`*mtop.taobao.shop*`。

### 2.2 两条执行路径

| 宿主页面 | 点击 | 滚动 |
|---|---|---|
| 可见（渲染进程给了真实矩形） | CDP `Input.dispatchMouseEvent` | CDP `Input.synthesizeScrollGesture` |
| 隐藏（viewport = null） | DOM `el.click()` | DOM `scrollBy` |

回执里带 `mode`（`cdp-click` / `dom-click` / `gesture` / `dom-scroll`），能直接判断走了哪条。

### 2.3 五个硬坑（详见 docs §4）

1. **隐藏的 widget 不收 CDP 输入事件**（`setVisible(false)` 时鼠标事件被静默丢弃）。
2. **隐藏不能收成 0×0**（布局宽度 0 → 元素坐标全 0）；只能「1280×800 + setVisible(false)」。
3. **挪到画面外也不行**（`x=-1280` → 视口宽度被裁成 0）。
4. **`mouseWheel` 不产生滚动**（scrollTop 恒 0）→ 用 `synthesizeScrollGesture`（yDistance 取负），
   且滚完必须校验 scrollTop 是否真的变了，没变就回退 DOM。
5. **`interceptNext` 登记前不能 await**（否则包内后续请求抢先发出）。

## 3. 改动清单（项目非 git 仓库，无 commit）

**新增**
- `resources/platform-packages/ecclaw-writer-demo/`（manifest.json + runtime.cjs）
- `docs/ecclaw-宿主写操作-2026-11-02.md`
- `C:/Temp/ecclaw-verify/fixture-writer.cjs`（临时验证页，端口 8897）
- `C:/Temp/ecclaw-verify/bridge-rpc.cjs`（直接打宿主桥：`<op> <json>`）
- `C:/Temp/ecclaw-verify/cdp-viewport.cjs`（CDP 调 `window.ecclaw.host.setViewport(...)`，用来切可见/隐藏）

**修改**
- `electron/main/browser-host.ts`：`applyViewport`（隐藏态改为 1280×800 + setVisible(false)）、
  新增 `runOp` / `click` / `scroll` / `interceptNext` / `waitForNavigation` /
  `locate` / `domClickSource` / `domScrollSource` / `gestureScroll` / `readScrollTop` / `readWindowScrollY`；
  `ensureDebugger()` 改为**同步**；`Network.loadingFinished` 里先匹配拦截器
- `electron/main/platform-actions.ts`：SDK stub 的 `browser.*` 改为 `rpcOp(...)`；
  `runRunner` 新增 `type:'op'` 分支（回包用 `sendToChild` 防未处理 rejection）；
  `runPageAction` 先 `enableNetworkCapture()`（interceptNext 依赖）
- `task.md`（第七阶段表 + 6 条实证发现 + 头部状态）、`README.md`（§5.10 / §8）

## 4. 验证配方（照抄）

```bash
cd F:/soft/00selfmade/ecclaw && pnpm build
ECCLAW_LOCAL_PACKAGES_DIR="C:/Users/Duanyi/AppData/Roaming/com.dabiai.desktop/platform-packages" \
  npx electron . --remote-debugging-port=9222        # 后台
cd C:/Temp/ecclaw-verify && node fixture-writer.cjs   # 8897，后台

node C:/Temp/ecclaw-verify/bridge-rpc.cjs action \
  '{"packageId":"ecclaw-writer-demo","capability":"ecclaw-writer-demo.click","url":"http://127.0.0.1:8897/writer"}'
node C:/Temp/ecclaw-verify/cdp-viewport.cjs 0 0 900 600   # 让宿主页面可见（走真实鼠标路径）
node C:/Temp/ecclaw-verify/cdp-viewport.cjs hide          # 还原隐藏
```

MCP 层复验：

```bash
STATE="C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw"
node C:/Temp/ecclaw-verify/mcp-driver.cjs "$STATE/mcp/host-server.mjs" "$STATE/host-bridge.json" \
  ecclaw_run_action '{"packageId":"ecclaw-writer-demo","capability":"ecclaw-writer-demo.click","url":"http://127.0.0.1:8897/writer"}'
```

坑（沿用 + 新增）：CDP 多 target 按 `/index\.html$/` 选主应用；8898/8899 端口常被占
（**8899 被别的服务占着，写操作 fixture 放 8897**）；computer-use 截屏全黑 → 一律 CDP 驱动。

## 5. 环境状态（交接时）

- electron：运行中（后台任务 `b4wwtifxe`，含 9222 调试端口；宿主桥端口随机，每次启动会变）
- fixture 8898：旧 fixture（PID 10620）在跑；**8897**：新写操作 fixture 在跑
- ecclaw 状态目录：`C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/`
  （与 dabi 的 `com.dabiai.desktop` 是**两套**，别混）
- 项目**不是 git 仓库**：无 commit、无 git init 要求

## 6. 下一步（按优先级）

1. **真实站点复验写操作**：现在只在本地 fixture 上验过。可用 dabi 真实包（如 taobao 的
   `performInteraction` → `browser.click` + `waitForNavigation`，或 amazon 的 search 分页）打一次真站点。
2. **写操作护栏**：agent 直接写操作前需要确认机制（当前 straight-through），
   同时把 `host-bridge` 的 op 面暴露成 MCP 工具（`ecclaw_click` / `ecclaw_scroll`），
   让 agent 不依赖平台包也能驱动页面。
3. **poll 持续刷新**：当前 poll 只触发一次，dabi 是持续刷新（侧栏联动），可加订阅式形态。
4. **对话页暴露宿主状态**：把 `host:bridge-status` 接到 UI，让用户看到「宿主桥已就绪 / MCP 已注册」。
5. **真实站点复验 observe**：doudian-compass 的 `urlIncludes:["/compass_api/shop/common/homepage/"]`。

## 7. 红线与避坑（沿用，勿违）

- 不重做逆向（REA 已结案）；不改已定案的平台包协议；`runtime.cjs` 一律子进程加载
- 不删 `C:/Temp/rea-dabi`、`C:/Temp/ecclaw-verify`；禁止删除用户文件；临时产物写 `C:/Temp/`
- 项目非 git 仓库 → 不要 `git init` / `commit`
- `openclaw.json` 含明文 relay key → 勿外传；relay 对话保持最小
- Electron 内 spawn 必带 `ELECTRON_RUN_AS_NODE=1`
- 宿主页面 sandbox + contextIsolation + nodeIntegration=false
- 宿主桥 token（`host-bridge.json`）不外传
- **写操作是「替用户操作页面」**：接 agent 直连前先做确认护栏

## 8. 必读顺序

1. 本文件 §1（交付与证据）→ §2（签名与两条路径）→ §2.3（五个坑）
2. `docs/ecclaw-宿主写操作-2026-11-02.md`（契约 / 实现 / 坑 / 验证配方）
3. `docs/ecclaw-宿主-MCP接入-2026-11-02.md`（MCP 链路与协议）
4. `electron/main/browser-host.ts`（写操作四个方法 + `runOp`）+ `electron/main/platform-actions.ts`（SDK stub + op 消息）
5. `task.md` 第七阶段表
