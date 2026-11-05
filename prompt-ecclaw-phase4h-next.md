# 接力 · ecclaw 第三十四阶段

**承接**：`handoff-ecclaw-phase4h-final-2026-11-05.md`（第三十三阶段收官，XLSX 单位/工程/会计格式 + 日期 locale）

**基线**：HEAD = phase4h 的 feat 提交（hash 见 handoff §10 已回填）；工作区干净树；
工具数 **27**；stateDir `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw`。

**本轮选哪个候选**：见 handoff §9「下一阶段候选」—— 建议先读 §9 再定，不要在 prompt 里定选题。

**本轮变化 / 期限约束**：
- 无新期限；沿用 phase4h 红线：**不跑真站 phase3s / phase3q**（不碰淘宝）。
- 回归驱动用**新前缀**（phase4h 用的是 `run66-*`，下一轮用 `run67-*`，**别覆盖 run66**）。
- 提交只 `git add` 精确文件，**禁止 `git add -A`**；`openclaw.json` / `host-bridge.json` 不得提交。

**必做**：设计先与用户逐项确认 → 改代码 → 跑秒级自测 + e2e → 全量回归十九套 → 收尾
（README / task.md / 项目记忆 / handoff / prompt）→ 精确提交。

**必读**：handoff §4（关键设计决策 + §4.2 行为修正）· §5（验证基线）· §12（本轮踩坑）。
