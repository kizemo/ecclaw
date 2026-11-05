# prompt · ecclaw 第十三阶段（phase3m）· 2026-11-02

## 承接

- 读 `handoff-ecclaw-phase3l-2026-11-02.md`（第十二阶段收官：事件导出 + 信任规则可视化 + 白名单路径维度）
- 再读 `README.md` §5.16、`task.md` 第十二阶段
- 背景：`handoff-ecclaw-phase3k-2026-11-02.md`（第十一阶段）、`handoff-ecclaw-phase2-2026-11-01.md`（权威背景与红线）

## 基线

- 项目根 `F:\soft\00selfmade\ecclaw`，**不是 git 仓库**（禁 git init / commit）
- 状态：第十二阶段已完成并真机验证 **46/46 全绿**；`pnpm typecheck` ✓、`pnpm build` ✓
- MCP 工具数 **21**；信任范围五档（含 `persistent-path`）；白名单三维度 `match × ops × path`
- 验证脚手架 `C:/Temp/ecclaw-verify/`（**勿删**）：`export-guard-e2e.cjs`、`event-summary-e2e.cjs`、
  `event-replay-e2e.cjs`、`scope-e2e.cjs`、`approval-watcher.cjs`、`fixture-writer.cjs`(8897)、`fixture-server.cjs`(8898)
- Electron 启动：`powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"`
- MCP 运行期副本：`<stateDir>/mcp/host-server.mjs`（改 `resources/mcp/host-server.mjs` 后**必须重启 Electron**）

## 必交付（按优先级，先跟用户确认范围）

1. **真实站点登录态闭环**（phase3k §7-1 一直顺延）：需用户本人账号，风险自负。
   淘宝只读复验 → 用 `session` 档在真实站点走一遍护栏。amazon 是 AWS WAF 挑战页，不必重试。
2. **事件落盘后续**：压缩归档（现只有明文 JSONL）/ 汇总的时间序列趋势（环比、峰值）。
3. **宿主事件主动推送**：agent 侧现在只有长轮询 `ecclaw_next_event`，加推送通道（WS / SSE / MCP 侧长轮询循环）。
4. **护栏收尾**：`persistent-path` 目前缺「按路径粒度列出/移除」的界面。

## 交付要求

- 每块能力都要走完「主进程 → 宿主桥 → MCP → IPC → preload → 界面」六层，并写真机 e2e
  （照抄 `export-guard-e2e.cjs` 骨架：MCP 客户端 + 桥 RPC + CDP 驱动 + 断言表）
- `pnpm typecheck` + `pnpm build` 必须过
- 更新 `README.md`（新增 §5.x）、`task.md`（新增阶段表格 + 实证发现）
- 收尾写 `handoff-ecclaw-phase3m-<date>.md` + `prompt-ecclaw-phase3m-next.md`

## 禁止事项

- 禁止删除用户文件（`<userData>/host-events/exports/` 下的测试产物也别自动删）
- 禁止 git init / commit
- `openclaw.json` 含明文 relay key，勿外传
- Electron 内 spawn 内核 / MCP 必须带 `ELECTRON_RUN_AS_NODE=1`
- GUI 验证走 CDP，不要用 computer-use
- 护栏策略默认保持 `ask`；别去掉 partition 的 `persist:` 前缀
- 临时产物写 `C:/Temp/`
