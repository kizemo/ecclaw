# prompt · ecclaw phase4q 下一轮 · 2026-11-06

承接 `handoff-ecclaw-phase4q-final-2026-11-06.md`（同目录，**先读它**）。

**本轮状态**：phase4p（PDF 全家桶）+ phase4q（docProps app/custom）已收官并提交；
run75 二十九套 **980 PASS / 1 FAIL**（phase3r C3 为事件库 >2000 条的既有环境失败）。

**下一轮选哪个候选**：按 handoff 排期做 **D+F（DOCX）**：

- D：DOCX 尾注（`word/endnotes.xml`）、DOCX 图片 alt（`wp:docPr@descr` / `@title`）
- F：DOCX 批注回复（`word/commentsExtended.xml` 的 `paraIdParent`）

**约束变化**：

- 候选清单已过期 8 次 —— 开打前**先探针复验 + 扫新轴**，别照抄。
- 探针资产在 `C:/Temp/ecclaw-verify/`（`phase4p-make.cjs` / `phase4p-probe.cjs` / `probe4p/`），**直接复用**。
- 事件库 >2000 条 → phase3r C3 是环境失败，别当产品回归。

**禁止**：不改真站套件 phase3s / phase3q；不碰 `host-bridge.ts` / `host-server.mjs` / `src/App.tsx`；
MCP 工具数保持 **27**；产品改动只落 `electron/main/document-preview.ts`。