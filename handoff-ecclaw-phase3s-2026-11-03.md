# handoff · ecclaw 第十八阶段（phase3s）· 进行中（v3 已 45/49，核心三 stage 实锤；剩 4 项疑点，额度 97% 让位）· 2026-11-03

> **一句话**：范围 B「rejected/timeout/failed 真站复验」**主体已完成**——v3 后台跑（task `b5yqoxd3r`）
> **45/49**：timeout 组 T1-T9 **全绿**（真 10 分钟无人答复 → 自动 timeout、fail-closed、winY 恒 0）、
> Z1 计数完美 `requested=4·rejected=2·failed=2·timeout=1·executed=0`、Z3 越界 0、Z4 summary=replay=9、
> Z5 导出含三终态、Z6/Z7 红线过。**三条 stage 的真站证据已全部落盘**。
> 剩 4 项 FAIL（R9/F9 终态卡片 30s 未自动收、D3 堆栈残留 1 张、F3 卡片 scope 默认值=session 而非 once）
> 是**同一批现场疑点**，下个会话第一件事是**保留现场直接看 DOM 取证**（见 §4），**先别重启 Electron**。
> 上一阶段收官必读 `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3r-final-2026-11-03.md`（§0 架构 / §6 复现 / §9 坑 / §10 红线照旧有效）。

---

## 0. 阶段范围与拍板

- 候选 B 由 AskUserQuestion **超时自动选中**（自动选择≠批准；B 只用 scroll + 三 stage 均不执行页面动作，无不可逆风险 → 合规照做）。
- 第十六阶段只在夹具站验过三 stage；本阶段补淘宝真站证据——**已补上**（见 §2 事件链）。
- 意外收获 ①：卡片堆栈无票据锚点的真盲区 → `App.tsx:193` 加 `data-approval-id={req.id}`（已 build + 实跑生效）。
- 意外收获 ②：复验过程撞出 4 个新疑点（§5），可能指向界面卡片收敛定时器与 scope 默认值的真 bug——**下阶段的核心待办**。

## 1. 三轮跑分史（同环境：新渲染层 Electron + 淘宝登录 + 8898 夹具）

| 轮 | 结果 | 根因 | 处置 |
|---|---|---|---|
| v1（task b4etjxtgf） | 37/48 | 卡片无锚点 → 旧卡污染 F/D/T 组点击 | App.tsx 加 `data-approval-id` + 脚本 v2 锚定 |
| v2（task buckjhgde） | 34/48 | ① `pollTicket` 把瞬态 `approved` 当终态；② `approvalsSince()` 忘传 seqBase → 回放混入 11-02 老事件（Z1-Z5 误报，summary=8 才是真值）；③ **运行中有人在 GUI 手工批准 T 卡并选「本次会话」**（事件 seq 900241 scope=session via=user → 会话信任吞掉后续护栏，T 没超时）| 脚本 v3：终态集合轮询 / seqBase 传参 / A6 开局 `ecclaw_guard_clear_session` + 断言 session 空 / T8 detail 补取证 |
| v3（task b5yqoxd3r） | **45/49** | 核心全绿；剩 R9/F9/D3/F3 四项现场疑点（§5）| 交下个会话 |

## 2. 真站三 stage 实锤（v3 磁盘事件为权威）

- rejected：R 组 9/9 绿 + 事件 `{stage:rejected, scope, ok:false, error:用户拒绝了本次写操作, approvalId}`。
- failed(via=user)：F 组票据批准后 runner 抛错 → 事件 `{stage:failed, via:user, scope:once, error:滚动失败：未找到元素：#no-such-…}`（v2 轮 seq 900238 已见原文，v3 F5-F8 绿）。
- failed(deny 分支)：`{stage:failed, 无 approvalId, 无 via, error:写操作已被策略禁用（hostWriteGuard=deny）：scroll}`，D1-D5 绿。
- timeout：T 组全绿——10 分钟真定时器误差 <1s、fail-closed winY 不变、无 via、不留信任（T7 再拦仍 pending）、T9 清场闭环。
- U1-U3 界面三终态摘要全绿；Z 组口径全绿（计数/归因/汇总一致/导出/红线）。

## 3. 改动清单（未 commit；项目非 git）

| 文件 | 改动 | 状态 |
|---|---|---|
| `F:\soft\00selfmade\ecclaw\src\App.tsx` | :193 `data-approval-id={req.id}` | ✅ 已写 + 已 build（typecheck 两段 exit 0，renderer 646.79 kB `index-DbS6ugab.js`），Electron 已重启生效 |
| `C:\Temp\ecclaw-verify\phase3s-e2e.cjs` | v3（49 断言）：锚定卡片 / 终态轮询 / seqBase / A6 清会话信任 | ✅ 45/49 |
| 主进程 / preload / MCP / 类型 | 零改动 | — |
| `C:\Temp\ecclaw-verify\probe-events.cjs` | 新取证脚本：`node probe-events.cjs <sinceSeq>` 列 approval 事件明细 | ✅ 可用 |

## 4. 下个会话必做（按顺序）

1. **保留现场取证（别重启 Electron！）**——v3 结束时堆栈里应有 ~1 张未收的卡，用 CDP 直接看：
   ```bash
   curl -s http://127.0.0.1:9222/json/list | grep -o '"webSocketDebuggerUrl":"[^"]*index.html[^"]*"'
   ```
   在渲染层执行：`[...document.querySelectorAll('.approval-card')].map(c=>({id:c.getAttribute('data-approval-id'), text:c.textContent.slice(0,80)}))`
   - 若卡 **2 分钟+ 仍未收** → 「终态卡片 12s 自动收」定时器存在真 bug（R9/F9/D3 同因）；读 `src/App.tsx` 的收卡定时器
     （126-134 行附近 `TERMINAL_KEEP` 12s）查它为何没跑：怀疑点=多卡并存/票据更新覆盖 timer/React 状态合并。
   - 若卡已收 → R9/F9 是时序竞态（当时恰好被人操作/GC 延迟），改 waitCardGone 上限后重跑即可。
2. **F3 疑点独立排查**：卡片 scope 下拉默认值本轮是 `session`（上轮 `once`）。读渲染层确认默认值来源
   （是否记住上次选择的 App 级状态？若是设计如此 → F3 断言应放宽为「默认值 ∈ 合法档位 且本轮会话信任未因批准失败而留存」
   ——F8 已证明失败不留规则；若是 bug → 修默认值）。
3. 修完重跑 v3 到 **49/49**（~13 分钟，run_in_background；**期间请提醒用户勿碰 GUI 卡片**——v2 的 T 组事故就是 GUI 手工批准造成的）。
4. **回归串跑**（同一 Electron，勿并行）：phase3r **31** · phase3q **23** · phase3p **45** · phase3o **44** ·
   phase3m **69**（8897 已预起）· sse **14**。命令形态见 phase3r final §6。
5. **文档五件套**：README **§5.22**（插入点：§5.21 末 ~1001 行与 `## 6` 之间）+ §8 状态段；task.md 顶部状态 +
   第十八阶段表 + 实证发现（§6 坑全录）；memory `ecclaw_phase3s_real_site_stages.md` + MEMORY.md 索引；
   `handoff-ecclaw-phase3s-final-<date>.md`；`prompt-ecclaw-phase3s-next.md`（候选沿用 phase3r §7.1 A/C/D + 卡片收定时器尾巴）。
6. **收尾拆除**：`node C:/Temp/ecclaw-verify/stop-electron.cjs`；停 8898（PID 212608）与 8897（精确 PID `Stop-Process`）。

## 5. 剩余 4 项 FAIL 明细（v3 输出 `...\tasks\b5yqoxd3r.output`）

- `R9 终态卡片约 12s 后自动收掉` :: waitCardGone(30s) 超时，卡 id=w-…-1（拒绝后 30s 未收）。
- `F9 终态卡片自动收掉` :: 同上（w-…-2）。
- `D3 deny 档下堆栈里没有任何卡片` :: cards=1 —— 大概率就是 R/F 没收的残留（同因）。
- `F3 信任范围默认「仅本次」（once）` :: select.value=session（上轮同断言=once）。
- 注意：这 4 项与「本轮 T 组之外无 executed」不矛盾——**功能语义（护栏/事件/信任）全部正确**，
  疑点集中在**渲染层卡片生命周期**，是本轮复验额外挖出的产品级线索。

## 6. 本阶段踩坑（供 task.md 实证发现）

1. **堆栈式浮层必须给每个条目可寻址锚点**：`key` 不落 DOM → 多卡并存抓卡看运气。一行 `data-approval-id` 根治（v3 实跑证明）。
2. **`approved` 是瞬态不是终态**：pending→approved→executed/failed 的轮询必须等真终态集合，否则拿到中间快照。
3. **回放断言必须带 seq 基线**：`ecclaw_event_replay` 不传 sinceSeq = 全量（11-02 夹具老事件全进来，Z 组整体误报）；summary 与 replay 交叉验证是发现该 bug 的钥匙。
4. **GUI 手工答复会污染无人值守 e2e**：v2 的 T 卡被人点「允许」+选「本次会话」→ timeout 没验成 + 会话信任吞卡。**e2e 跑期间别碰界面**；脚本侧 A6 开局清会话信任兜底（`ecclaw_guard_clear_session` 只清内存 session 组，不碰永久规则）。
5. **record 的 detail 不能传空串**：FAIL 时无线索（T8 教训，v3 已补）。
6. **终态卡片 12s 自动收是产品语义**：断言消失要等定时器（waitCardGone 30s 富余）；本轮 45/49 恰恰暴露它**可能真有 bug**（R9/F9/D3），值得下会话专门查。
7. **deny 分支 failed 无 approvalId/无 via**，与 via=user 分支必须在事件里区分（D4 坐实）。
8. 正向结论：**三 stage 真站语义全部正确**——拒绝/失败/超时均 fail-closed（winY 恒 0）、均不留信任（R8/F8/T7）、界面三终态摘要正确（U1-U3）、timeout 真定时器误差 <1s。

## 7. 环境运行态（让位时刻 2026-11-03 约 12:20）

- Electron **在跑（新渲染层）**；⚠️ **堆栈里可能残留 1 张未收终态卡 = R9 疑点的活现场，先取证再重启**。
- 淘宝已登录（kizemo）；8898 在跑（PID 212608）；8897 已预起（task bp32o7j7i）。
- settings 干净（ask + 白名单 []）；会话信任已被 v3 A6 清零（且 F 批准失败不留规则）。
- exports 48（只增不删）。窗口 winY 停在 ~800（v2 外部批准滚动残留，脚本自取基线，无碍）。
- v2/v3 输出：`...\tasks\buckjhgde.output` / `...\tasks\b5yqoxd3r.output`（同目录）。
- **额度**：MiniMax 15:00 块已 ~97% → 本会话停；下会话 15:00 块后开。

## 8. 红线（照旧，全量见 phase3r final §10）

禁删用户文件（exports 只增不删）；禁 git；密钥/token 不外传；真站只用 scroll；GUI 走 CDP；
临时产物 `C:\Temp\`；handoff/task 不进 memory 文件夹；Electron 内 spawn 带 `ELECTRON_RUN_AS_NODE=1`。
