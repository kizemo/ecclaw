# prompt · ecclaw 第三十七阶段（2026-11-06）

> 承接 `handoff-ecclaw-phase4k-final-2026-11-06.md`（第三十六阶段收官 · PPTX 结构保真）。
> 基线 / 本轮必做 / 候选清单 / 禁止事项 **一律看那份 handoff**（本文件只做指针，不重复内容）。

## 必读顺序

1. `handoff-ecclaw-phase4k-final-2026-11-06.md`
   —— §1 已确认设计（**勿重开**）· §4 下一轮候选 · §6 本轮踩坑 · §5 环境基线
2. `README.md` §5.40（上一轮对外口径）
3. `task.md`「第三十六阶段」交付表 + 实证发现

## 本轮要做的

- **选题**：**先探针实测 + 扫新轴**，别照抄 handoff §4 的候选表（候选清单已连续三次被推翻）。
  handoff §4 已列的三个方向（XLSX `expression` 条件格式 / PPTX 剩余项 / 空白格）可直接探针。
- **改码**：只改 `electron/main/document-preview.ts` 一个文件；MCP 工具数仍 **27**；无新增依赖。
- **验证**：秒级自测 → e2e（`send()` 必带超时，断言数**按实际数写**）→ 全量回归（新前缀 `run70-*`）。
- **收尾**：README §5.41 + 底部能力清单 · task.md 第三十七阶段表 + 顶部状态段 · 项目记忆 + `MEMORY.md` 索引 ·
  `handoff-ecclaw-phase4k-final` 同款收官 handoff + `prompt-ecclaw-phase4k-next.md` 同款下一轮指针（<30 行）。

## 禁止事项

- 红线：**不跑真站 phase3s / phase3q**（不碰淘宝）。
- 禁 `git add -A`；只 `git add` **精确文件**。
- `openclaw.json` / `host-bridge.json` / `C:\Temp\*` / 未跟踪的 `handoff-2026-11-06.md`（hook 占位）**不得提交**。
- 提交用 Conventional Commits，**不 amend**；feat 提交后再单独一条 docs 回填 hash。
- 主进程代码改完**必须重启 Electron**（先 `taskkill //F //IM electron.exe`）。
