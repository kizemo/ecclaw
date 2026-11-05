# 接力 · ecclaw 第三十五阶段

**承接**：`handoff-ecclaw-phase4i-final-2026-11-05.md`（第三十四阶段收官，XLSX 日期 locale 扩展 + 文本格 `@` 字面量）

**基线**：HEAD = phase4i 的 feat 提交（hash 见 handoff §5 已回填）；工作区干净树；
工具数 **27**；stateDir `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw`。

**本轮选哪个候选**：见 handoff §8「下一阶段候选」—— ⚠️ **候选清单会过期，先写探针脚本实测再选题**，
别照抄（上一轮 §9 有两条早已实现）。

**本轮变化 / 期限约束**：
- 无新期限；沿用 phase4i 红线：**不跑真站 phase3s / phase3q**（不碰淘宝）。
- 回归驱动用**新前缀**（phase4i 用的是 `run67-*`，下一轮用 `run68-*`，**别覆盖 run67**）。
- 提交只 `git add` 精确文件，**禁止 `git add -A`**；`openclaw.json` / `host-bridge.json` 不得提交。

**必做**：设计先与用户逐项确认 → 改代码 → 跑秒级自测 + e2e → 全量回归二十套 → 收尾
（README / task.md / 项目记忆 / handoff / prompt）→ 精确提交。

**必读**：handoff §2（代码改动）· §4（验证结果）· §5（收尾产物）· §7（踩坑）· §8（候选）。
