# 接力 · ecclaw 第二十八阶段

承接：`handoff-ecclaw-phase4b-final-2026-11-05.md`（第二十七阶段收官 · DOCX 内嵌表格深度感知抽取）。

- 基线、必做项、候选清单、复现命令、红线一律以该 handoff 为准，本文件只留指针。
- 本轮从 handoff §8 候选中选一项做（推荐第一项：XLSX 条件格式 / 颜色 —— `[Red]` 目前只剥掉，不输出颜色信息）。
- 约束变化：无新增红线；仍不碰淘宝（phase3s / phase3q 不跑）、不 git init/commit、不删用户文件。
- 收尾必须：typecheck + build + 新 e2e + 全量回归（run60-*），实测数字写进新的 handoff。
