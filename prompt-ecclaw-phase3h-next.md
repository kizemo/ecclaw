# prompt · ecclaw 下一阶段（第九阶段）· 承接 phase3h

**基线**：`handoff-ecclaw-phase3h-2026-11-02.md`（第八阶段：写操作护栏 + MCP 12 工具 + agent 真调用已全绿）
**权威文档**：`docs/ecclaw-宿主写操作护栏-2026-11-02.md`
**工作区**：项目**不是 git 仓库**，无 commit，改动都在工作区；**禁止 git init / commit**。

## 必交付（按优先级）

1. **两段式写操作确认**
   - 现状：agent 触发的写操作在**一个** MCP 调用里等用户点头，窗口 40s（受 MCP SDK 60s 硬超时挤压）。
   - 目标：工具**立即**返回 `{status:"pending", approvalId}`，写入排队等批准；
     新增 MCP 工具 `ecclaw_approval_status(approvalId)` → `{status, result?, error?}` 让 agent 轮询。
   - 落点：`electron/main/write-guard.ts`（pending 里存 op+params+结果）、`host-bridge.ts`、
     `resources/mcp/host-server.mjs`（13 个工具）、`src/App.tsx`（卡片显示状态）。
   - 验收：`openclaw agent --local` 调 `ecclaw_click` → 拿到 pending 票据 → 用户点允许 →
     agent 轮询拿到结果 → 页面真的被点（fixture 服务端计数 +1）。
2. **poll 订阅式持续刷新**（宿主侧长轮询 → 渲染进程增量更新）。
3. **护栏粒度**：一次授权一批操作 / 站点白名单。

## 硬约束（踩过就别再踩）

- **MCP SDK 请求超时硬编码 60s**（`DEFAULT_REQUEST_TIMEOUT_MSEC`）：阻塞型工具总耗时必须明显 < 60s。
- **GUI 验证一律走 CDP**（`--remote-debugging-port=9222` + `Runtime.evaluate`），**不要用 computer-use**。
- `/json/list` 有多个 target：主应用 `out/renderer/index.html`、宿主页 `http://127.0.0.1:8897`。
- `host:read-dom` 会**重新打开 URL** → 别用它验证页面状态变化（用 fixture 服务端计数）。
- bash 里 `taskkill /PID` 要 `MSYS_NO_PATHCONV=1`。
- Electron 内 spawn 必须 `ELECTRON_RUN_AS_NODE=1`；宿主页面 sandbox + contextIsolation + nodeIntegration=false。
- 临时产物写 `C:/Temp/`；**不要删** `C:/Temp/rea-dabi`、`C:/Temp/ecclaw-verify`。
- 禁止删除用户文件；不改已定案平台包协议（`runtime.cjs` 一律子进程加载）；不重做逆向（REA 已结案）。
- openclaw.json 含明文 relay key，勿外传；relay 对话最小化。

## 环境

- electron：`ECCLAW_LOCAL_PACKAGES_DIR="C:/Users/Duanyi/AppData/Roaming/com.dabiai.desktop/platform-packages" npx electron . --remote-debugging-port=9222`
- 宿主桥端口每次启动随机；端点文件 `C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json`
- 护栏策略 `C:/Users/Duanyi/AppData/Roaming/ecclaw/ecclaw-settings.json` → `hostWriteGuard`
- fixture：写操作页 8897（含 `/api/writer/stats` 服务端点击计数）、只读页 8898
- 内核：`C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/`（与 dabi 的 `com.dabiai.desktop` 是两套）

## 收尾要求

`pnpm typecheck` + `pnpm build` 全绿 → 更新 `task.md`（新增阶段表）、`README.md`（对应章节 + §8 状态）、
`memory/ecclaw_host_contract.md` / `ecclaw_tech_constraints.md` → 写 `handoff-ecclaw-phase3i-<date>.md`
+ `prompt-ecclaw-phase3i-next.md`（<30 行）。
