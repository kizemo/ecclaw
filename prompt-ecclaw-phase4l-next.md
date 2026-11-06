# prompt · ecclaw 第三十七阶段（phase4l）接力

承接：`handoff-ecclaw-phase4l-wip-2026-11-06.md`（同目录）——**本文件只做指针**。
基线 / 已确认设计 / 改动清单 / 测试证据 / 必交付 / 禁止事项全在那份里，别在这里找。

## 相对上一轮的变化
- 上轮**已完成**：探针实测 9 轴 → 选题（链接 + 批注，DOCX/XLSX 双格式）→ 设计确认 →
  改码（仅 `electron/main/document-preview.ts`）→ typecheck ✅ → 秒级自测 **41/41** ✅ →
  交叉复验 4j **30/30** / 4k **27/27** ✅（既有 DOCX/PPTX 输出逐字不变）。
- 尚未做：`pnpm build` 确认 → 重启 Electron → e2e → run70 全量回归 → 收尾文档 → 提交。

## 本会话按此顺序
1. `pnpm build`，grep `out/main/index.js` 确认含新代码（上轮后台任务 `b0ztclh9r` 结果未确认，**重跑**）
2. `taskkill //F //IM electron.exe` → `C:\Temp\ecclaw-verify\start-electron.ps1`（CDP 9222）
3. `C:\Temp\ecclaw-verify\phase4l-e2e.cjs <hostServerPath> <bridgeFile>` —— 已写好**未跑**，
   脚本内预估 30 条断言，**实跑后按实际数改**
4. 全量回归：复制 `rerun-and-regress21.cjs` → `rerun-and-regress22.cjs`，前缀 `run69-*` → **`run70-*`**，
   加入 phase4l 套件（23 + 1 = 24 套）
5. 收尾：README §5.41 · task.md 第三十七阶段 · 项目记忆 · `handoff-ecclaw-phase4l-final-2026-11-06.md`
6. 提交：精确 `git add` → feat 一条 → docs 回填 hash 一条，**不 amend**

## 硬约束
- 本轮**别再动别的产品文件**；MCP 工具数仍 **27**
- 精确 `git add`（**禁 `git add -A`**）；禁提交 `openclaw.json` / `host-bridge.json` /
  `C:\Temp\*` / 未跟踪的 `handoff-2026-11-06.md`（hook 占位，别动）
- **不跑真站 phase3s / phase3q**（不碰淘宝）
- 上下文 ≥160K 被闸门拦时：写 handoff + prompt 后开新会话（勿依赖自动压缩）
