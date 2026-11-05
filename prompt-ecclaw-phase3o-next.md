# prompt · ecclaw 下一阶段 · 2026-11-02

> 承接：`handoff-ecclaw-phase3o-final-2026-11-02.md`（第十四阶段收官）。
> 项目背景入口（没读过就读它）：`handoff-ecclaw-phase3n-2026-11-02.md`。

## 基线

- 第十四阶段 ① seq 全局单调 / ② 导出物清理入口 / ③ 趋势图 **全部完成并真机验证**：
  `phase3o-e2e.cjs` 44/44，回归 `phase3m-e2e.cjs` 69/69、`sse-e2e.cjs` 14/14，`pnpm typecheck` + `pnpm build` 绿。
- MCP 工具 **24 个**（新增 `ecclaw_export_list`）。代码**未 commit**（项目非 git 仓库）。
- Electron 正在跑（桥端口与 token 每次重启都变；MCP 运行期副本 `<stateDir>/mcp/host-server.mjs` 随启动自动同步）。

## 第一步（别跳）

用 **AskUserQuestion** 让用户拍板下一阶段范围（候选见 handoff §8），
再按 **六层交付 + 真机 e2e + 文档（README §5.19 / task.md / memory / handoff+prompt 收尾）** 推进。

## 禁止事项

- **禁删用户文件**：`<userData>/host-events/exports/` 现存 **15 个导出物，一条都不许删**（回归脚本每跑一次会新增 1 个）；
  新增删除功能只允许「用户明确点确认」后删**那一个**。
- 禁 `git init` / `git commit`；`openclaw.json`（明文 relay key）与 `host-bridge.json`（token）勿外传。
- Electron 内 spawn 内核/MCP 必须带 `ELECTRON_RUN_AS_NODE=1`；护栏默认 `ask`；别去掉 `persist:` 前缀。
- **真实站点只用 `scroll` 做写操作验证**（淘宝点一下可能下单）。
- GUI 验证走 **CDP**（`--remote-debugging-port=9222`），不要用 computer-use；收尾用 `stop-electron.cjs`（强杀丢 cookie）。
- 临时产物写 `C:\Temp\`；记忆写 `memory/`，**handoff / task 文档不得放进 memory 文件夹**。
- seq 断言**相对落盘最大值**，别写死基线（落盘有 seq 900001+ 的历史夹具）。
