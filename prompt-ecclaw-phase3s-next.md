# prompt · ecclaw 第十九阶段开局（承接 phase3s 收官 + 回归欠账补完）

先读 `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3s-final-2026-11-03.md`
（§0 指到 3r final 的架构/复现/红线权威，**§2.5 = 第十九阶段开局补的回归欠账**，必读），
再按其 §7 顺序读完必读清单。

**当前状态**：第十八阶段 49/49 收官；四疑点全部定性（无产品 bug）；
**六套回归现已全绿**（3s 49 · 3r 31 · 3q 26 · 3p 45 · 3o 44 · 3m 69 · sse 14，产物 `C:\Temp\ecclaw-verify\run50-*.log`）。

开局流程：按 3r final §6 拉起夹具（8898/8897）与 Electron（`--remote-debugging-port=9222`）、
`taobao-login-state.cjs` 确认登录态 → AskUserQuestion 拍板范围（候选见收官 handoff §6：
A click 真站闭环 / C 外壳候选 / D kind:'page' 尾巴 + 卡片收定时器尾巴）。
**超时自动选中 ≠ 批准**；含真站写操作或不可逆动作的候选必须重新确认。

**回归驱动的两个必备前置**（本次踩出来的）：
① `phase3r` 的 `ecclaw_open_page(8898/demo)` 会把默认页换掉 → **淘宝页签消失** → phase3q 前必须确认/重开
（`taobao-login-state.cjs`，登录态在 persist 分区里不丢）；
② 每个 e2e 套件的**开局与收尾**都要「拒绝遗留 pending 卡 + `ecclaw_guard_clear_session` 清会话信任」，
卡片按 `data-approval-id` 锚定；断言要比对总数就别给 DOM 条目加 `.slice(0,N)`。

红线照旧：禁删用户文件（exports 只增不删）、禁 git、密钥只以指纹出现、真站只用 scroll、
GUI 只走 CDP（不用 computer-use）、临时产物 `C:\Temp\`、handoff/task 不进 memory 文件夹、
Electron 内 spawn 带 `ELECTRON_RUN_AS_NODE=1`、改 main 代码必须重启 Electron、
无人值守 e2e 跑期间提醒用户勿碰 GUI 卡片。
