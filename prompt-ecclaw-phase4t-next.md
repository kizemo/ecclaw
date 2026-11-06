# prompt · ecclaw phase4u 续做 · 2026-11-07

承接 `handoff-ecclaw-phase4t-final-2026-11-07.md`（基线 / 必交付 / 避坑 / 候选清单全在里面，别重复问）。

上一会话已完成 phase4t（图形内容轴）并 commit。

本轮接着做（顺序别改）：

1. 先读 handoff 的 §3/§4/§7
2. **候选清单照例会过期**：先跑探针（`phase4t-probe*.cjs` 在 `C:/Temp/ecclaw-verify/`）复验，
   再扫新轴，按用户偏好逐项确认设计后动码
3. 实现（只改 `electron/main/document-preview.ts`；MCP 工具数保持 27；不加依赖）
4. 新自测 + e2e（`send()` 带 90s 超时）+ `run79-*` 全量回归
5. `pnpm typecheck`、`pnpm build`（改主进程后必须 build 才能真机验证）
6. 收尾：`handoff-ecclaw-phase4u-final-2026-11-07.md` + `prompt-ecclaw-phase4u-next.md`、
   更新 `task.md` 与 README 能力清单、项目记忆 `ecclaw_phase4u_*.md` + MEMORY.md 索引
7. commit（Conventional Commits，只 add 本轮改的文件，**禁 `git add -A`**）

禁止事项见 handoff §8：

- handoff §6 列的 `mc1.pptx` / `sa1.pptx` / `pv1.xlsx` / `sd1.docx` 的 ❌ 是**夹具缺陷或伪结构**，
  不是 bug，**不要去修**。
- 临时文件写 `C:\Temp\`；不删用户文件；不直接改 main/master。
