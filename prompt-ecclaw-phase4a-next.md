# 接力 · ecclaw 第二十七阶段

承接：`handoff-ecclaw-phase4a-final-2026-11-04.md`（第二十六阶段收官 · DOCX 合并单元格）。

- 基线、必做项、候选清单、复现命令、红线一律以该 handoff 为准，本文件只留指针。
- 本轮从 handoff §8 候选中选一项做（推荐第一项：DOCX 单元格内嵌表格的 `<w:tc>` 匹配缺陷）。
- 约束变化：无新增红线；仍不碰淘宝（phase3s / phase3q 不跑）、不 git init/commit、不删用户文件。
- 收尾必须：typecheck + build + 新 e2e + 全量回归（run59-*），实测数字写进新的 handoff。