# handoff · ecclaw 第八阶段（写操作护栏 + 宿主 op 直暴露 MCP 工具）· 2026-11-02

> 本文件是**阶段收官交接**。项目**不是 git 仓库**，没有 commit，改动全在工作区。
> 权威背景：`handoff-ecclaw-phase3g-2026-11-02.md`（第七阶段：宿主写操作）。

---

## 1. 这一阶段做完了什么

一句话：**agent 现在能真的替用户操作页面，但每一笔写操作都必须用户点头**。

| # | 交付项 | 状态 | 落点 |
|---|---|---|---|
| 1 | 写操作护栏（三档 ask/allow/deny + 40s 超时自动拒绝） | ✅ | `electron/main/write-guard.ts`（新增） |
| 2 | 闸门接进执行路径（UI 直通 / agent 走闸） | ✅ | `browser-host.ts` `runOp` + `source` 透传链 |
| 3 | 确认卡片 UI | ✅ | `src/App.tsx` `.approval-stack` + `src/styles.css` |
| 4 | 宿主 op 直暴露成 MCP 工具（8 → 12） | ✅ | `resources/mcp/host-server.mjs` + `host-bridge.ts` |
| 5 | UI 暴露宿主桥状态 + 护栏下拉 | ✅ | `src/App.tsx` 平台包页 |
| 6 | **agent 真调用写操作端到端跑通** | ✅ | `openclaw agent --local` → MCP → 弹卡 → 用户允许 → 真的点了 |

设计与实测细节见 `docs/ecclaw-宿主写操作护栏-2026-11-02.md`（本阶段唯一权威文档）。

---

## 2. 改动清单（全部未 commit）

**新增**
- `electron/main/write-guard.ts`
- `docs/ecclaw-宿主写操作护栏-2026-11-02.md`

**改**
- `electron/main/browser-host.ts` —— `runOp(op, params, options?)`；`click`/`scroll` 执行前过护栏
- `electron/main/host-service.ts` —— `hostRunAction(..., source)`；新增 `hostWriteOp(op, params, source)`
- `electron/main/platform-actions.ts` —— `runPageAction` / `runRunner` 透传 `source`
- `electron/main/host-bridge.ts` —— 新增 4 个 op：`click` / `scroll` / `intercept-next` / `wait-for-navigation`
- `electron/main/index.ts` —— 4 个新 IPC（护栏模式读/写、待确认列表、回应）；桥状态接口去掉 token
- `electron/preload/index.ts` —— host 段 6 个新 API（含 `onWriteApproval` 订阅）
- `electron/shared/types.ts` —— `WriteGuardMode` / `WriteApprovalRequest`
- `resources/mcp/host-server.mjs` —— 工具 8 → 12
- `src/App.tsx` / `src/styles.css` —— 确认卡片浮层 + 平台包页护栏下拉 + 桥状态标签
- `task.md` / `README.md`（§5.9 工具数、§5.11 新增、§8 状态）
- `memory/ecclaw_host_contract.md` / `memory/ecclaw_tech_constraints.md` / `memory/MEMORY.md`

---

## 3. 测试证据

```
pnpm typecheck   ✓（node + web 两段）
pnpm build       ✓（main 109.75 kB / preload 3.52 kB / renderer 604.12 kB）
```

| 脚本（`C:/Temp/ecclaw-verify/`） | 覆盖 | 结果 |
|---|---|---|
| `guard-test.cjs` | ask 弹卡 / 拒绝 / 允许 / allow / deny / scroll 也弹卡 | ✅ 全通 |
| `guard-count-test.cjs` | 点击**是否真的生效**（直连宿主 CDP target 读 `window.__ecclawCount`） | ✅ 0→1（allow）、1→1（ask+拒绝）、1→2（ask+允许） |
| `mcp-driver.cjs` | `ecclaw_click`（allow）→ `ok:true`；`ecclaw_scroll`（deny）→ `isError=true` | ✅ |
| `gui-guard.cjs` | 平台包页桥标签 / 护栏下拉三选项 / `.approval-stack` 计算样式 | ✅ |
| `openclaw agent --local` + `approval-watcher.cjs` | **真模型**调 `ecclaw-host__ecclaw_click` → 弹卡 → 允许 → `dom-click`/`ok:true`/服务端计数 1 | ✅ stderr `MCP error` 0 次 |

---

## 4. 最重要的一个坑（不看代码也会再踩）

**MCP SDK 客户端请求超时硬编码 60000ms**
（`node_modules/.pnpm/@modelcontextprotocol+sdk@1.32.0*/…/dist/esm/shared/protocol.js`
→ `DEFAULT_REQUEST_TIMEOUT_MSEC = 60000`）。

护栏窗口初版也是 60s → **两者同时到点**：
agent 连点三次 `#btn-increment` 三次都拿到 `MCP error -32001: Request timed out`，
而**按钮根本没被点**（fixture 服务端计数 0），agent 还如实汇报「三次都在等弹窗确认时超时」。

改成 **40s**（留 20s 余量）后一次成功。
连带结论：**任何阻塞型 MCP 工具的总耗时必须明显 < 60s**；
需要更长的等待只能改成两段式（先返回 pending 票据，再轮询结果）。

---

## 5. 环境与基线

- electron：`npx electron . --remote-debugging-port=9222`，
  `ECCLAW_LOCAL_PACKAGES_DIR="C:/Users/Duanyi/AppData/Roaming/com.dabiai.desktop/platform-packages"`
  （否则看不到 dabi 真包）
- 宿主桥端口**每次启动随机**（本轮 57266），端点文件：
  `C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json`
- 护栏策略文件：`C:/Users/Duanyi/AppData/Roaming/ecclaw/ecclaw-settings.json` → `hostWriteGuard`
  （改文件即生效；本轮结束时是 `ask`）
- fixture：写操作页 `C:/Temp/ecclaw-verify/fixture-writer.cjs`（**8897**，已加 `/api/writer/stats` 服务端点击计数）；
  只读页 `fixture-server.cjs`（8898）；仓库 `repo-server.cjs`
- 内核目录：`C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/`
  （与 dabi 的 `com.dabiai.desktop` 是两套，别混）

---

## 6. 避坑清单（本轮实测）

1. **GUI 一律走 CDP**，不要用 computer-use（Electron 截屏全黑且拒输入）。
   脚本模板在 `C:/Temp/ecclaw-verify/gui-*.cjs`。
2. **`/json/list` 会有多个 page target**：主应用 = `url.includes('out/renderer/index.html')`，
   宿主页 = `url.startsWith('http://127.0.0.1:8897')`。
3. **`host:read-dom` 会重新打开 URL** → 读页面计数前会被刷掉。
   验证「点击真的发生」要么直连宿主 target 读页面变量，要么用 fixture 的服务端计数。
4. **宿主页也是 CDP target**（WebContentsView），可以 `Runtime.evaluate` 直接读页面状态。
5. **护栏超时后确认卡片不会自动消失**（渲染进程不知情），用户点它是空操作。
6. **bash 里 `taskkill /PID` 要加 `MSYS_NO_PATHCONV=1`**，否则 Git Bash 把 `/PID` 当路径。
7. **给 fixture 加接口后必须重启 fixture 进程**（8897 的 PID 会变）。
8. **Electron 主进程里 spawn 必须带 `ELECTRON_RUN_AS_NODE=1`**（老规矩）。
9. 临时产物写 `C:/Temp/`，**不要删** `C:/Temp/rea-dabi`、`C:/Temp/ecclaw-verify`。

---

## 7. 下一阶段必交付（按优先级）

1. **两段式确认**（当前 40s 窗口偏短，用户离开界面就失败）：
   工具立即返回 `{status:"pending", approvalId}`，写入排队等用户批准；
   新增 `ecclaw_approval_status(approvalId)` 让 agent 轮询结果。
   这样人的等待时间与 MCP 60s 超时**解耦**。
2. **poll 订阅式持续刷新**（宿主侧长轮询 + 渲染进程增量更新）。
3. **护栏粒度**：一次授权一批操作 / 站点白名单。
4. **真实站点复验**（taobao / amazon / doudian-compass）—— 需要真实登录态，风险自负。

---

## 8. 红线（勿违）

不重做逆向（REA 已结案）· 不改已定案平台包协议（`runtime.cjs` 一律子进程加载）·
不删 `C:/Temp/rea-dabi` 与 `C:/Temp/ecclaw-verify` · 禁止删除用户文件 ·
不 git init / commit · openclaw.json 含明文 relay key，勿外传 · relay 对话最小化 ·
宿主页面 sandbox + contextIsolation + nodeIntegration=false · 宿主桥 token 文件勿外传。

---

## 9. 必读顺序

1. `docs/ecclaw-宿主写操作护栏-2026-11-02.md` —— 本阶段全部设计与实测
2. `README.md` §5.8 / §5.9 / §5.10 / §5.11 —— 宿主 + MCP + 写操作 + 护栏
3. `task.md` 第八阶段 —— 交付项与实证发现表
4. `handoff-ecclaw-phase3g-2026-11-02.md` —— 上一阶段（写操作四个动作与五个硬坑）
