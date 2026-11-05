# prompt · ecclaw 第二十四阶段接力

- 承接：`handoff-ecclaw-phase3x-final-2026-11-04.md`（第二十三阶段收官）。
- 基线、上一轮必做、候选清单、禁止事项、复现命令**一律以该 handoff 为准**，本文不重复。
- 本轮从 handoff §8 候选中选 **一项** 做：建议 **XLSX 日期还原**（读 `styles.xml` 的 numberFormat，把序列号还原成日期）。
- 只做选定项，不扩范围。
- 期限：单会话内可完成（含 typecheck + build + 新 e2e + 全量回归）。
- 约束变化：无新增红线；仍**不碰淘宝**（phase3s / phase3q 不跑）、不 git init/commit、不删用户文件。
- 收尾必须：typecheck + build + 新 e2e + 全量回归，**并把实测数字写进新的 handoff**。
