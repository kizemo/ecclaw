# prompt · ecclaw 第二十阶段之后 / 第二十一阶段开工

先读：`handoff-ecclaw-phase3u-final-2026-11-03.md` →
`handoff-ecclaw-phase3r-final-2026-11-03.md` §0/§6/§10（架构/复现/红线权威）。

## 第一件事：补 phase3o 的 2 条红（必做，先于新功能）
`run52` 实测 phase3o 42/44：seqA=900500 落后磁盘最大 900548；重启后 900550 正常。
疑双 Electron 实例/陈旧内存计数器。做法：确认只剩一个 Electron 进程 → 干净重启 →
单跑 `node C:/Temp/ecclaw-verify/phase3o-e2e.cjs <hostServer> <bridge>`。
44/44 定性环境；仍红按产品 bug 查（涉及 `electron/main/host-events.ts` 的 seq 初始化）。

## 基线
phase3u 已交付：灰度 rollout + clientId 分桶 + 安装二次准入；phase3u e2e 24/24；
phase3t 16 · 3s 49 · 3r 31 · 3q 26 · 3p 45 · 3m 69 · sse 14 全绿；工具数 26。

## 然后：用 AskUserQuestion 拍板下一范围
候选：C-2 文档预览（先 PDF）· C-3 邮件 worker · C-4 画布宿主 · OCR · 数据迁移框架。
自动选中 ≠ 批准；含真站写操作/外发副作用的方向必须显式确认。

## 必交付
- 若新功能：换新回归前缀 `run53-*` 并同步改驱动产物名；收官数字只引用 `run53-summary.txt` 实测。
- 更新 task.md（第二十阶段表尚未写，本轮因上下文见底跳过）与 README §8 状态段。

## 禁止
真站写操作（本阶段不碰淘宝）；git；删除用户文件；新增 MCP 工具或事件 kind（非必要不做）；
把 handoff/task 放进 `memory/`。

## 收尾
`node C:/Temp/ecclaw-verify/stop-electron.cjs` + 按精确 PID 停夹具（禁通配符）；
写收官 handoff + 下一阶段 prompt。