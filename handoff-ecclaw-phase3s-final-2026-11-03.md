# handoff · ecclaw 第十八阶段（phase3s）· **收官** · 2026-11-03

> ⚠️ **回归欠账已补（2026-11-03 晚，第十九阶段开局）**：本文件原先引用的 `run49-*.log` **不是回归全绿的证据** ——
> `run49`（15:00）是「环境全灭」那轮（六套全崩），`run49b`（15:23）才是自愈驱动跑完的实测：
> **phase3s 49/49 ✅ · phase3r 30/31 ❌ · phase3q 17/23 ❌ · phase3p 44/44 · phase3o 44/44 · phase3m 69/69 · sse 14/14**。
> 两处红**都不是产品 bug**：① `phase3r` G3 断言把 DOM 条目 `.slice(0,20)` 却要求等于计数行的 `approval=38` → 恒假；
> ② `phase3q` 旧脚本用 `document.querySelector('.approval-card')` 取「第一张卡」→ 点到了上一套件（phase3r）
> 遗留的 pending 卡 → 批准了 8898 而不是淘宝 → 本套件 6 条连环红（跨套件污染）。
> 已修（**脚本级、零产品改动**）并重跑：**phase3s 49 · 3r 31 · 3q 26 · 3p 45 · 3o 44 · 3m 69 · sse 14 —— 全绿**
> （产物 `C:\Temp\ecclaw-verify\run50-*.log` / `run50b-phase3{r,q}.log` / `run50-summary.txt`）。
> 详见 §2.5。

> **一句话结论**：范围 B「rejected/timeout/failed 三 stage 淘宝真站复验」**全部完成**——
> 三终态 + deny 分支磁盘事件实锤（均 fail-closed、均不留信任、timeout 真定时器误差 <1s）、
> Z 组口径全绿（`requested=4·rejected=2·failed=2·timeout=1·executed=0`，summary=replay=9）、
> `phase3s-e2e.cjs` v4 **49/49**（v1 37→v2 34→v3 45→v4 49）、六套回归**现已全绿**（含本轮补账，见顶部）、
> 剩余 4 项 FAIL 全部**定性完毕**（见 §3，无一是产品逻辑 bug）、文档五件套就绪。
> **下个会话可直接接下一阶段。**

---

## 0. 背景（一句）

ecclaw = OpenClaw 内核 + 内嵌浏览器宿主 + 写操作护栏 + 事件落盘的电商桌面端（Electron/Windows）。
架构/目录/复现命令权威版见 `handoff-ecclaw-phase3r-final-2026-11-03.md` §0/§6；红线全量见其 §10（照旧有效）。

## 1. 本阶段交付

| 项 | 结果 |
|---|---|
| 真站三 stage 事件实锤 | ✅ R/F/D/T 四组逐 stage 落盘（语义明细见 README §5.22 表格） |
| 唯一产品改动 | ✅ `src/App.tsx:193` `data-approval-id={req.id}`（一行；已 build 生效）。主进程/preload/MCP/类型零改动，工具数仍 26 |
| e2e | ✅ `C:\Temp\ecclaw-verify\phase3s-e2e.cjs` v4 **49/49**（v3→v4 改动：waitCardGone 60→90 次；F3 放宽为「默认值 ∈ 合法档位」） |
| 回归 | ✅ 3r **31** · 3q **26** · 3p **45** · 3o **44** · 3m **69** · sse **14**（驱动 `rerun-and-regress3.cjs`，日志 `C:\Temp\ecclaw-verify\run50-*.log` + `run50b-phase3{r,q}.log`，摘要 `run50-summary.txt`；3q 由 23 → 26 条：新增 A6/A7 清场与 Z1 收尾断言） |
| 文档 | ✅ README §5.22 + §8 · task.md 顶部状态 + 第十八阶段表 + 实证发现 8 条 · memory `ecclaw_phase3s_real_site_stages.md` + 索引 · 本收官 handoff · `prompt-ecclaw-phase3s-next.md` |

## 2. 三轮跑分史（要点）

v1 37/48 无锚点旧卡污染 → v2 34/48（瞬态 approved 当终态 / 回放没传 seqBase / **GUI 人工批准 T 卡**）→
v3 45/49（终态集合轮询 / seqBase / A6 开局清会话信任 / T8 detail 补取证）→ v4 49/49。
踩坑全录在两处：本文件 §3 与 task.md 第十八阶段「实证发现」（8 条），坑的叙事版在
`handoff-ecclaw-phase3s-2026-11-03.md` §6。

## 2.5 回归欠账修正（2026-11-03 晚 · 第十九阶段开局）

**发现**：本文件（及 README §5.22 / task.md）原先写「六套回归全绿」，但引用的日志 `run49-*.log` 却是
「环境全灭」那轮（phase3s 46/3、其余全崩）。真正的实测是 `run49b-*`：**3r 30/31 · 3q 17/23 · 3p 44/44**。

**两处红的定性（都不是产品 bug）**：

| 套件 | 红项 | 根因 | 修法（脚本级，零产品改动） |
|---|---|---|---|
| phase3r | G3「勾选 approval 后只剩 approval 条目」 | 断言把 DOM 条目 `.slice(0,20)` 却要求 `length === approvalCount`（实测 approval=38）→ 恒假 | 去掉截断，按实际渲染条目数比对 |
| phase3q | D1/E1/E2/E4/F2/F4（6 条） | 旧脚本用 `document.querySelector('.approval-card')` 取「第一张卡」→ 点中了 phase3r 遗留的 8898 pending 卡 → 批准了 8898；淘宝票据一直 pending → E 组「第二次 scroll 免确认」不成立、F 组找不到 `via=site-trust` 事件 | ① 卡片按 `data-approval-id` 锚定（phase3s 已给 App.tsx 加的锚点）② 开局拒绝遗留卡 + `ecclaw_guard_clear_session` 清会话信任 ③ 收尾同样清场 ④ 断言只数 pending 卡（终态卡 12s 自动收，收前仍在 DOM） |

**新增实证（四条）**：

1. **回归证据必须引「最后一轮」的日志，且摘要文件与被引前缀一致** —— 文档引 `run49-*` 而实际最新是 `run49b-*`，差一轮就全错。
2. **e2e 断言里给 DOM 条目 `.slice(0,N)` 再拿长度跟总数比 = 恒假**（N < 总数时）。要比对就取全量。
3. **跨套件污染的通用形态**：上一套件留下「未答复的 pending 卡」或「本次会话信任」→
   下一套件按「第一张卡 / 第一条规则」找东西就找错 → 连环红。
   纪律：**每个套件开局与收尾都做「拒绝遗留 pending 卡 + 清会话信任」**。
4. **phase3r 的 `ecclaw_open_page(8898/demo)` 会把默认页换掉 → 淘宝页签消失** →
   回归驱动必须在 phase3q 之前确认/重开淘宝页签（`taobao-login-state.cjs`，登录态在 persist 分区里不丢）。

**复跑结果**：`run50` 全链 = 3s **49** · 3r **31** · 3q **26** · 3p **45** · 3o **44** · 3m **69** · sse **14**（phase3q 首轮 A6 因
「终态卡还在 DOM」红一次，改判据后复跑 26/26）；并用「污染顺序」复验：**phase3r → phase3q 串跑 = 31/31 + 26/26** ✅。

## 3. 四个疑点的最终定性（都不是产品 bug）


1. **R9/F9（终态卡 30s 未收）+ D3（堆栈残留 1 张）**：活体复验（`repro-card-throttle.cjs`，hidden 态同环境）
   拒绝后 **18.4s 自动收**（3s tick + 12s cutoff）→ 定时器逻辑正确，v3 当时是时序竞态；waitCardGone 上限 30→45s。
   **别再对着「后台节流」改代码**——本环境 Electron hidden 态定时器工作正常。
2. **F3（scope 默认值 session）**：`App.tsx:57` scope 是 **App 级全局单一 state**（所有卡共享、记住上次选择、
   跨轮留存）——设计行为。v2 人工选「本次会话」把粘滞值留在 session。断言已放宽；实质保证由
   F7（落事件 scope=once）+ F8（不留规则）兜底。

## 4. 遗留给下阶段的「卡片收定时器尾巴」（候选，非必须）

- 若要产品级收紧：给 visibilitychange 立即清扫 / 每卡独立 setTimeout(12s) / 评估 `backgroundThrottling:false`。
- 若动 `App.tsx`：`pnpm typecheck && pnpm build` 后**必须重启 Electron** 才生效。

## 5. 环境状态（2026-11-03 晚 · 回归欠账补完后）

- **Electron 在跑**（CDP 9222，PID 随重启变，最新 28880）· 夹具 **8898 / 8897 在跑**（PID 478704 / 27964）· 淘宝已登录（`kizemo`）。
- 收尾若要拆：`node C:/Temp/ecclaw-verify/stop-electron.cjs`（优雅关）+ 精确 PID `Stop-Process` 停两个夹具（勿通配符）。
- 收官基线：exports 48 → **97**（只增不删）；settings `ask` + 白名单 `[]` **无污染**；禁 git。

## 6. 下一阶段候选（AskUserQuestion 用；超时自动选中 ≠ 批准）

> 第十九阶段开局已选「先补回归欠账」（AskUserQuestion 超时自动选中，无不可逆动作）→ **已完成，见 §2.5**。
> 下面的候选仍未拍板，下个会话重新问一次。

- **A. 真实站点 click 类写操作闭环**（需另找不会下单的页面；红线：真站只 scroll）。
- **C. 第二阶段外壳候选**：远程包仓库灰度发布 / 邮件 worker / 画布宿主 / PDF·Docx·Pptx·PSD 预览 / OCR /
  社媒自动化脚本执行器 / 数据迁移框架（团队·账号·计费·遥测刻意不做）。
- **D. kind:'page' 事件尾巴**：类型定义了但全项目无 push 点——补产生点或从类型删除；导出物面板按日期/kind 归类。
- 卡片收定时器尾巴（§4）。

## 7. 必读顺序

1. 本文件 → 2. `handoff-ecclaw-phase3s-2026-11-03.md`（过程记录）→ 3. `handoff-ecclaw-phase3r-final-2026-11-03.md`
（架构/复现/红线权威）→ 4. README §5.20–§5.22 → 5. task.md 顶部 + 第十八阶段表 →
6. memory `ecclaw_phase3s_real_site_stages.md`（+ 前阶段 q/r 两条）→ 7. `prompt-ecclaw-phase3s-next.md`。
