# prompt · ecclaw 下一会话接力（phase4c 之后）

承接 `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase4c-final-2026-11-05.md`。

按该 handoff **§1 的必读顺序**读完下列文档，掌握项目背景 / 目标 / 进度 / 下阶段计划后再动手：

1. `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase4c-final-2026-11-05.md` ← 本轮（§1 必读顺序、§3 设计决策、§4 证据、§6 复现、§7 红线、§8 候选、§9 提交计划）
2. `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase4b-final-2026-11-05.md` ← 上一阶段
3. `F:\soft\00selfmade\ecclaw\README.md` ← §5.29–§5.32
4. `F:\soft\00selfmade\ecclaw\task.md` ← 顶部状态段 + 第二十八阶段表
5. `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\ecclaw_phase4c_xlsx_colors.md`
6. `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\MEMORY.md` ← 全项目阶段索引

**第一件事**：按 handoff **§9** 执行 commit（项目尚未 `git init`，**先问用户确认**再初始化）。
**第二件事**：从 handoff **§8** 选一项开工（推荐首项：XLSX 科学计数法 / 分数格式渲染）。

约束变化：无新增红线，一律以 handoff §7 为准（含「不碰淘宝」「不删用户文件」「临时产物写 `C:\Temp\`」）。
收尾必须：typecheck + build + 新 e2e + 全量回归（`run61-*`），实测数字写进新的 handoff。