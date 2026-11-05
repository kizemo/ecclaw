# prompt — ecclaw 第三阶段收尾（承接 phase3b）

请先完整阅读 `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3b-2026-11-01.md`（必做 2 收口），
其权威背景沿用 `handoff-ecclaw-phase2-2026-11-01.md`（项目背景、平台包协议、能力边界、全部绝对路径）。

## 基线（已完成，勿重做）

- 必做 1：643 项能力 → 17 个托管技能（`<stateDir>/skills/<packageId>/SKILL.md`），已落 ecclaw 真实 stateDir。
- 必做 2：真 Provider `aliyun-maas/qwen3.8-max`（anthropic relay）端到端对话 ✓（`agent --local` EXIT=0，
  模型能点名 taobao/doudian 等托管技能）；`providers:set-default` IPC/UI 入口 ✓（typecheck/build 过）。

## 本轮可做（按优先级）

1. GUI 抽查：`pnpm dev` → 大模型页「设为默认」按钮 + 对话页一句话（chatViaCli 同链路）。
2. 小打磨：setDefaultModel 后同步 `providerMeta.<id>.defaultModel`（按钮态不滞后）。
3. 候选 3（内嵌浏览器宿主）或候选 4（远程包仓库）——开工前先读 phase2 handoff §9 对应线索。

## 禁止事项

- 不重做逆向；不改已定案平台包协议；不删 `C:/Temp/rea-dabi`、`C:/Temp/ecclaw-verify`；
  不 git init/commit；relay 对话最小化（与 cc-haha 同额度池）；openclaw.json 含明文 key 勿外传。
