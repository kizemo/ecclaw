承接 `handoff-ecclaw-phase4o-final-2026-11-06.md`（同目录）。

本轮下一阶段（phase4p）：
- 先按 handoff §6 **重新跑探针**，候选清单已过期 7 次，不得照抄。
- 探针后把实测缺口列表交我逐项确认，再选题改码。
- 约束照旧：只改 `electron/main/document-preview.ts`；MCP 工具数 27；不碰真站 phase3s/phase3q。

已知环境问题（不影响选题，但影响回归判读）：
- 事件库已超 2000 条，`host-events.ts:409` 的回放硬上限 2000 会让 phase3r 的 C3 假红；
  判读回归时把它当环境失败，别当产品回归。