# prompt — ecclaw 下一轮（承接 phase3f）

承接 `handoff-ecclaw-phase3f-2026-11-02.md`（第六阶段收官：宿主接进对话链路 · MCP）。
权威背景仍看 `handoff-ecclaw-phase2-2026-11-01.md`。

基线状态（**勿重做**）：
- 第三/四/五阶段已完成：托管技能 18 包、真 Provider 端到端、远程包仓库、
  内嵌浏览器宿主四通道（数据查询 / 页面动作 / 页面提取 / observe 三模式）
- 第六阶段已完成：宿主已注册成 openclaw MCP 服务（`mcp.servers.ecclaw-host`），
  agent 能直接调用 8 个 `ecclaw_*` 工具（实际名带 `ecclaw-host__` 前缀）；
  `openclaw mcp doctor ecclaw-host --probe` → ok；agent 端到端跑通 extract

本轮候选（**任选或组合，勿全铺**）：
1. **写操作能力**（最大缺口）：最小 SDK 的 `browser.click` / `scroll` / `interceptNext` /
   `waitForNavigation` 仍抛「ecclaw 宿主暂不支持」；dabi 的 `automationActions` 依赖它们。
   宿主已有 CDP 通道（`browser-host.ts`），可直接补 `Input.*` / `Page.navigate` 事件。
2. **真实站点复验 observe**：用真实 dabi 包（如 doudian-compass 的
   `urlIncludes:["/compass_api/shop/common/homepage/"]`）在真实站点跑一次 network-response。
3. **poll 持续刷新**：当前 poll 只触发一次，可补订阅式刷新形态（dabi 侧栏联动语义）。
4. **UI 暴露宿主桥状态**：把 `host:bridge-status` 接到 UI（宿主桥就绪 / MCP 已注册）。
5. **写操作护栏**：agent 触发写操作前的确认机制。

约束（红线，勿违）：
- 不重做逆向（REA 已结案）；不改已定案的平台包协议；`runtime.cjs` 一律子进程加载
- 不删 `C:/Temp/rea-dabi`、`C:/Temp/ecclaw-verify`；不删任何用户文件；临时产物写 `C:/Temp/`
- 项目非 git 仓库 → 不 `git init` / 不 commit
- `openclaw.json` 含明文 relay key → 勿外传；relay 对话保持最小
- Electron 内 spawn 必带 `ELECTRON_RUN_AS_NODE=1`；宿主页面 sandbox + contextIsolation + nodeIntegration=false
- 宿主桥 token（`host-bridge.json`）不外传

验证配方（照抄 phase3f §4）：
```bash
cd F:/soft/00selfmade/ecclaw && pnpm build && pnpm typecheck
ECCLAW_LOCAL_PACKAGES_DIR="C:/Users/Duanyi/AppData/Roaming/com.dabiai.desktop/platform-packages" \
  npx electron . --remote-debugging-port=9222
cd C:/Temp/ecclaw-verify && node fixture-server.cjs
STATE="C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw"
HOME="C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw" OPENCLAW_STATE_DIR="$STATE" \
OPENCLAW_CONFIG_PATH="$STATE/openclaw.json" node node_modules/openclaw/openclaw.mjs mcp doctor ecclaw-host --probe
node C:/Temp/ecclaw-verify/mcp-driver.cjs "$STATE/mcp/host-server.mjs" "$STATE/host-bridge.json" ecclaw_list_capabilities
```
坑：CDP 多 target 按 `index\.html$` 选主应用；8898 端口可能被旧进程占；computer-use 截屏全黑 → 一律 CDP。

收尾：更新 `task.md` + README + 相关 docs，并写 `handoff-ecclaw-phase3g-<date>.md` 与
`prompt-ecclaw-phase3g-next.md`（<30 行）。
