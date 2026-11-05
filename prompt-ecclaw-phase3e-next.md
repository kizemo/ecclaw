# prompt — ecclaw 下一轮（承接 phase3e）

承接 `handoff-ecclaw-phase3e-2026-11-02.md`（第五阶段收官：可见内嵌浏览器 / extract / context 单一来源 /
覆盖矩阵 / observe 三模式）。权威背景仍看 `handoff-ecclaw-phase2-2026-11-01.md`。

基线状态（**勿重做**）：
- 第三阶段必做 1（643 能力 → 18 个托管技能）、必做 2（真 Provider 端到端）已完成
- 第四阶段（GUI 抽查 + 远程包仓库）已完成
- 第五阶段（内嵌浏览器宿主）四通道全绿：数据查询 / 页面动作 / 页面提取 / observe（network+poll+dom-signal）

本轮候选（**任选或组合，勿全铺**）：
1. **宿主接进对话链路**：技能目录已能给 agent「知道有哪些能力」，但执行仍只能手点；
   设计「能力 id → 宿主调用」的执行入口（优先复用现有 `packages:run-action` 等 IPC）。
2. **写操作能力**：最小 SDK 的 `browser.click` / `scroll` / `interceptNext` / `waitForNavigation`
   目前抛「ecclaw 宿主暂不支持」；dabi 的 `automationActions`（准备阶段）依赖它们。
3. **真实站点复验 observe**：用真实 dabi 包（如 doudian-compass）在真实站点跑一次 network-response。
4. **poll 持续刷新**：当前 poll 只触发一次，可补订阅式刷新形态。

约束（红线，勿违）：
- 不重做逆向（REA 已结案）；不改已定案的平台包协议；`runtime.cjs` 一律子进程加载
- 不删 `C:/Temp/rea-dabi`、`C:/Temp/ecclaw-verify`；不删任何用户文件；临时产物写 `C:/Temp/`
- 项目非 git 仓库 → 不 `git init` / 不 commit
- `openclaw.json` 含明文 relay key → 勿外传；relay 对话保持最小
- Electron 内 spawn 必带 `ELECTRON_RUN_AS_NODE=1`；宿主页面 sandbox + contextIsolation + nodeIntegration=false

验证配方（照抄 phase3e §4.1）：
```bash
cd F:/soft/00selfmade/ecclaw && pnpm build && pnpm typecheck
ECCLAW_LOCAL_PACKAGES_DIR="C:/Users/Duanyi/AppData/Roaming/com.dabiai.desktop/platform-packages" \
  npx electron . --remote-debugging-port=9222
cd C:/Temp/ecclaw-verify && node fixture-server.cjs
node gui-host.cjs / gui-host-action.cjs / gui-host-observe.cjs "" / gui-host-extract-demo.cjs / gui-capabilities.cjs
```
坑：CDP 多 target 要按 `index\.html$` 选主应用；8898 端口可能被旧进程占（netstat 找 PID 再 kill）。

收尾：更新 `task.md` + README + 相关 docs，并写 `handoff-ecclaw-phase3f-<date>.md` 与
`prompt-ecclaw-phase3f-next.md`（<30 行）。
