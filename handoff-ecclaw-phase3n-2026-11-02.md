# handoff · ecclaw 第十四阶段（phase3n）收官交接 · 2026-11-02

> **本文件是本项目的完整交接入口**，包含背景、架构、进度、契约、路径、红线。
> 新会话只需读本文件 + 下方「必读顺序」列出的文件即可完全接手。

---

## 1. 项目是什么

**ecclaw** —— 基于 OpenClaw 的电商 AI 桌面端（Electron）。

- **目标**：让 agent 在**内嵌浏览器宿主**里操作真实电商站点（淘宝/抖店/小红书…），
  且**所有写操作都经过可审计、可控的护栏**；同时把「agent 看到了什么」沉淀成可回放的事件流。
- **形态**：Electron 桌面应用（主进程 + 渲染进程 React + preload）+ 内嵌 **MCP server**
  （`resources/mcp/host-server.mjs`）让对话链路里的 agent 直接调宿主能力。
- **非 git 仓库**（`F:\soft\00selfmade\ecclaw`）—— 禁止 `git init` / `git commit`。

### 当前状态（2026-11-02）

| 项 | 值 |
|---|---|
| 阶段 | 第十三阶段 ①②③④ **全部完成**；第十四阶段**尚未开工** |
| MCP 工具数 | **23** |
| typecheck / build | ✅ 已绿 |
| 真机验证 | `phase3m-e2e.cjs` **69/69** + `sse-e2e.cjs` **14/14** + 淘宝登录态闭环 ✅ |
| 本会话改动 | 仅文档 + 脚手架 + 一处设置复原，**无 TS 代码改动** |

---

## 2. 必读顺序（新会话按此读，勿跳）

1. **本文件** `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3n-2026-11-02.md`
2. `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3m-final-2026-11-02.md` —— 第十三阶段收官（含 69/14 断言细节与踩坑）
3. `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3m-2026-11-02.md` —— 第十三阶段实施细节与契约
4. `F:\soft\00selfmade\ecclaw\README.md` §5.14 / §5.15 / §5.16 / §5.17 —— 第十至十三阶段能力全表
5. `F:\soft\00selfmade\ecclaw\task.md` —— 全部阶段任务表与实证发现
6. `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\MEMORY.md` —— 记忆索引（11 个文件，按需读）

> 背景交接（同目录，前序阶段）：
> `handoff-ecclaw-phase3l-2026-11-02.md`（第十二）、`handoff-ecclaw-phase3k-2026-11-02.md`（第十一）、
> `handoff-ecclaw-phase3j-2026-11-02.md`（第十）、`handoff-ecclaw-phase3i-2026-11-02.md`（第九）。
> 更早的 `handoff-ecclaw-phase1..3h-*.md` 覆盖更底层设计，一般不用读。

---

## 3. 架构全貌（六层）

```
Electron 主进程 (electron/main/*.ts)
   ├─ browser-host.ts     内嵌浏览器宿主 WebContentsView（partition = persist:ecclaw-host）
   ├─ write-guard.ts      写操作护栏：ask/allow/deny + 信任档 + 白名单规则
   ├─ host-events.ts      事件落盘（按天 JSONL）、压缩归档、趋势汇总、SSE 推送源
   ├─ host-service.ts     业务编排层（主进程 ← host-bridge ← MCP 之间的服务）
   ├─ host-bridge.ts      宿主桥：loopback HTTP，/rpc（JSON-RPC）+ /events（SSE）
   └─ index.ts            Electron 主入口 + IPC 通道注册
        ↓ IPC (electron/shared/types.ts 定义契约)
preload (electron/preload/index.ts)  →  src/api.ts
        ↓
渲染进程 React (src/App.tsx + src/views/{Chat,Models,HostEvents}.tsx)
        ↑
MCP server (resources/mcp/host-server.mjs) —— 由 agent 通过 stdio 调起
        ↑ 走宿主桥 HTTP（token 鉴权）
```

### 目录与关键文件（完整路径）

| 路径 | 作用 |
|---|---|
| `F:\soft\00selfmade\ecclaw\electron\shared\types.ts` | 跨层类型契约（`EcclawApi`、`HostEvent*`、`GuardRule`…） |
| `F:\soft\00selfmade\ecclaw\electron\main\browser-host.ts` | 内嵌浏览器宿主；`HOST_PARTITION='persist:ecclaw-host'` |
| `F:\soft\00selfmade\ecclaw\electron\main\write-guard.ts` | 护栏核心：信任档、白名单规则增删查 |
| `F:\soft\00selfmade\ecclaw\electron\main\host-events.ts` | 事件落盘/压缩/趋势/推送订阅 |
| `F:\soft\00selfmade\ecclaw\electron\main\host-service.ts` | 主进程服务层 |
| `F:\soft\00selfmade\ecclaw\electron\main\host-bridge.ts` | 宿主桥 HTTP（`/rpc` + `/events` SSE） |
| `F:\soft\00selfmade\ecclaw\electron\main\index.ts` | 主入口 + IPC 注册 |
| `F:\soft\00selfmade\ecclaw\electron\preload\index.ts` | preload 桥 |
| `F:\soft\00selfmade\ecclaw\resources\mcp\host-server.mjs` | **MCP server 源码**（23 工具） |
| `F:\soft\00selfmade\ecclaw\src\App.tsx` | 界面主框架（含信任规则面板、护栏卡片） |
| `F:\soft\00selfmade\ecclaw\src\views\HostEvents.tsx` | 宿主事件页（汇总/趋势/导出/回放） |
| `F:\soft\00selfmade\ecclaw\src\api.ts` | 渲染层 API 封装 |
| `F:\soft\00selfmade\ecclaw\src\views\{Chat,Models}.tsx` | 对话页 / 模型配置页 |
| `F:\soft\00selfmade\ecclaw\docs\*.md` | 各阶段设计文档（12 篇） |
| `F:\soft\00selfmade\ecclaw\README.md` / `task.md` | 能力总表 / 任务总表 |

### MCP 工具面（23 个，`resources/mcp/host-server.mjs`）

- 宿主状态与能力：`ecclaw_host_status`、`ecclaw_list_capabilities`
- 页面读取：`ecclaw_open_page`、`ecclaw_read_dom`
- 平台包能力：`ecclaw_run_data_query`、`ecclaw_run_action`、`ecclaw_run_extract`、`ecclaw_run_observe`
- 写操作：`ecclaw_click`、`ecclaw_scroll`、`ecclaw_intercept_next`、`ecclaw_wait_navigation`
- 护栏：`ecclaw_approval_status`、`ecclaw_guard_rules`、`ecclaw_guard_remove`、`ecclaw_guard_clear_session`
- 事件：`ecclaw_watch`、`ecclaw_watch_stop`、`ecclaw_next_event`、`ecclaw_event_replay`、
  `ecclaw_event_summary`、`ecclaw_event_export`、`ecclaw_events_since`

---

## 4. 阶段进度全表

| 阶段 | 主题 | 状态 | 交接文件 |
|---|---|---|---|
| 1–3d | 骨架 / 平台包 / 仓库 / 模型配置 | ✅ | `handoff-ecclaw-phase1..3d-*.md` |
| 3e | 内嵌浏览器宿主（四通道） | ✅ | `handoff-ecclaw-phase3e-2026-11-02.md` |
| 3f | 宿主接入 MCP 对话链路 | ✅ | `handoff-ecclaw-phase3f-2026-11-02.md` |
| 3g | 宿主写操作（可见/隐藏两路径） | ✅ | `handoff-ecclaw-phase3g-2026-11-02.md` |
| 3h | 写操作护栏 + 直接工具面 | ✅ | `handoff-ecclaw-phase3h-2026-11-02.md` |
| 3i | 两段式确认 + 站点白名单 + poll 刷新 | ✅ | `handoff-ecclaw-phase3i-2026-11-02.md` |
| 3j | 信任范围四档 + 事件落盘回放 + persist partition | ✅ | `handoff-ecclaw-phase3j-2026-11-02.md` |
| 3k | 事件汇总 + 落盘保留策略 | ✅ | `handoff-ecclaw-phase3k-2026-11-02.md` |
| 3l | 事件导出 + 信任规则可视化 + 白名单 path 维 | ✅ | `handoff-ecclaw-phase3l-2026-11-02.md` |
| 3m | 压缩归档 + 趋势 + 护栏粒度 + SSE 推送 | ✅ | `handoff-ecclaw-phase3m-2026-11-02.md` + `handoff-ecclaw-phase3m-final-2026-11-02.md` |
| **3n** | **真实站点登录态闭环收尾（淘宝）** | ✅ | **本文件** |
| 3o | 下一阶段（候选见 §7） | ⬜ 未开工 | — |

---

## 5. 核心契约（改这块前必读）

### 5.1 写操作护栏

- 三档策略：`hostWriteGuard` = `ask`（默认，红线）/ `allow` / `deny`
- **信任范围五档**（`write-guard.ts`）：
  | 档 | 生成规则 |
  |---|---|
  | 仅本次 | 不留规则，一次性放行 |
  | `session` | `{match:'domain', ops:'all', ttl:'session'}` |
  | `persistent` | `{match:'domain', ops:'all', ttl:'persistent'}` |
  | `persistent-scroll` | `{match:'domain', ops:'scroll', ttl:'persistent'}` |
  | `persistent-path` | `{match:'domain', ops:'all', ttl:'persistent', path}` |
- 规则维度：`host × match(host|domain) × ops(all|scroll) × ttl(session|persistent) × path?`
- 会话规则只落内存（重启即清）；永久规则落 `ecclaw-settings.json` 的 `hostWriteGuardAllowlist`
- `removeGuardRule` **按 ttl 分组删除**（同站同时有 session+persistent 时不能删错组）

### 5.2 事件落盘：先压后删

| 层 | 保留 |
|---|---|
| 明文 `.jsonl` | 14 天 → 压缩成 `.jsonl.gz`，**不删** |
| 归档 `.gz` | 90 天 → 才删 |
| 目录总量 | 256MB → 从最老一整天整日删 |

- `compressLogFile` 顺序：写 `.gz` → 确认写成了 → 再删明文（宁多占盘不丢数据）
- **所有读路径必须走 `readLog(file, gz)`**，漏一处 → gzip 被当明文 → 事件静默消失

### 5.3 趋势口径

补空桶 0；桶键用 **UTC**；`deltaPct` 首桶 null、上桶为 0 时 null；`peak` = 条数最多桶；
`overallDeltaPct` = 末桶 vs 首桶；跨度 > 500 桶退化稀疏模式；非法 `bucket` 归一到 `day`。

### 5.4 SSE 推送

MCP 是 stdio → 无服务端推送语义 → 推送落在宿主桥：
`主进程 → 桥 GET /events (SSE) → MCP 缓冲 → agent 取件`

- 端点 `GET /events?sinceSeq=N`，loopback + `x-ecclaw-token`（与 `/rpc` 同令牌），15s 心跳，
  首连按 `sinceSeq` 补发内存环形缓冲增量（≤200 条），随后转实时
- MCP 常驻连接（断线 2s 重连、缓冲 ≤500）；`ecclaw_events_since` 取件
- **取件覆盖判据**：`sinceSeq >= 缓冲最旧 seq - 1` → 直接返回（无新事件即空数组）；
  不覆盖（事件太老被挤出）→ 回落落盘回放 `source:'replay'`

### 5.5 真实站点登录态闭环（phase3n 实证）

- `persist:ecclaw-host` partition → cookie 落 `<userData>/Partitions/ecclaw-host/`
- ⚠️ **正常退出**（`stop-electron.cjs` 走 window.close）重启 cookie 仍在；
  `taskkill /F` 强杀会丢（Chromium 没刷 cookie 库）
- 淘宝实证：昵称 `kizemo`、cookie 含 `_tb_token_`/`_hvn_lgc_`；**真实站点写操作验证只用 `scroll`**（click 可能下单）

---

## 6. 环境、路径与运行方式（完整）

| 项 | 值 |
|---|---|
| 项目根 | `F:\soft\00selfmade\ecclaw`（**非 git**） |
| 用户数据 | `C:\Users\Duanyi\AppData\Roaming\ecclaw\` |
| 设置文件 | `C:\Users\Duanyi\AppData\Roaming\ecclaw\ecclaw-settings.json`（`hostWriteGuard` / `hostWriteGuardAllowlist`） |
| stateDir | `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw\` |
| MCP 运行期副本 | `<stateDir>\mcp\host-server.mjs`（**改 `resources/mcp/host-server.mjs` 后必须重启 Electron 或手动同步**） |
| 桥端点文件 | `<stateDir>\host-bridge.json`（含 token，**勿外传**） |
| 持久 partition | `<userData>\Partitions\ecclaw-host\` |
| 事件落盘 | `<userData>\host-events\events-YYYY-MM-DD[.N].jsonl[.gz]` + `exports\` |
| 内核 | `F:\soft\00selfmade\ecclaw\node_modules\openclaw\openclaw.mjs` |
| 桥/MCP relay key | `<stateDir>\openclaw.json`（含明文 key，**勿外传**） |

### 起停

```bash
# 起（后台）
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"
# 关（**必须正常关闭，强杀丢 cookie**）
node C:/Temp/ecclaw-verify/stop-electron.cjs
```

### 验证脚手架 `C:\Temp\ecclaw-verify\`（**勿删**）

| 文件 | 用途 |
|---|---|
| `phase3m-e2e.cjs` | 第十三阶段主 e2e（69 断言：压缩归档/趋势/护栏粒度/界面） |
| `sse-e2e.cjs` | SSE 推送 e2e（14 断言） |
| `p3m-fixture.cjs` + `p3m-fixture-meta.json` | 造「45 天前」明文 JSONL 夹具 |
| `p3n-card.cjs` | **护栏卡 DOM 探针**（inspect / `--click` 两模式） |
| `taobao-login-state.cjs` | 淘宝登录态探针（开页 + CDP 读页面） |
| `bridge-rpc.cjs` | 宿主桥 JSON-RPC 调用器（`node bridge-rpc.cjs <op> <paramsJson>`） |
| `cdp-eval.cjs` | 通用 CDP 求值器（`node cdp-eval.cjs <targetSubstr> "<js>"`） |
| `fixture-server.cjs` / `fixture-writer.cjs` | 本地夹具站（8898 端口） |
| `start-electron.ps1` / `stop-electron.cjs` | 起停 Electron |
| `p3m-probe.cjs` | 事件 seq 分布探针（内存环 vs 落盘） |

### 宿主桥 op 速查

`status` `capabilities` `open` `read-dom` `action` `click` `scroll` `intercept-next`
`wait-for-navigation` `approval-status` `data-query` `extract` `observe` `watch` `watch-stop`
`watch-list` `next-event` `event-replay` `event-log-info` `event-summary` `event-export`
`guard-rules` `guard-rules-clear-session` `guard-rules-remove`

---

## 7. 第十四阶段候选（下一步计划，先与用户确认范围）

### 候选 1（推荐）：**事件 seq 空间遗留问题**

- **现象**：`seq` 是**运行时计数器**（`host-events.ts:69 let seq = 0`），Electron **重启归零**
  → 落盘存在**多个 seq 空间**；同一天文件里可能先写 1..N（重启前）再写 1..M（重启后），**seq 非单调**
- **副作用**：`ecclaw_event_replay({sinceSeq})` 的 `sinceSeq/untilSeq` 过滤跨文件不可靠；
  注释（`host-events.ts:328`「结果按 seq 升序返回」）与实现不符 —— 实现是
  `scanDiskEvents` 按 **文件序**（`listLogFiles()` 按 day→part 排序）逐行返回
- **影响**：agent 用 seq 当游标跨重启会漏事件或重放；SSE 缓冲取件游标也只在单次运行内可靠
- **候选方案**：落盘时把排序键换成**全局时间戳序**（如 `at` + 文件内序号），
  或落盘时写 `seq` 为全局单调（启动时从落盘最大值续号）
- **注意**：改 seq 语义 = 改 `host-events.ts` + `host-bridge.ts` + `resources/mcp/host-server.mjs` + 类型，
  需跑 `phase3m-e2e.cjs` + `sse-e2e.cjs` 回归

### 候选 2：导出物清理入口

界面提供 `<userData>\host-events\exports\` 的**手动逐个删除**入口。
⚠️ 现存 **7 个历史导出文件，一条都不许自动删**。

### 候选 3：趋势图可视化

`src/views/HostEvents.tsx` 趋势区块现为文字列表 → 柱状/折线图。

### 通用交付要求（沿用前例）

每块能力走完「主进程 → 宿主桥 → MCP → IPC → preload → 界面」六层，
并写真机 e2e（照抄 `phase3m-e2e.cjs` 骨架）；
`pnpm typecheck` + `pnpm build` 必须过；
更新 `README.md`、`task.md`、memory；
收尾写 `handoff-ecclaw-phase3o-<date>.md` + `prompt-ecclaw-phase3o-next.md`。

---

## 8. 本会话（phase3n）改动清单（全部未 commit）

- `C:\Users\Duanyi\AppData\Roaming\ecclaw\ecclaw-settings.json`
  → **`hostWriteGuard` 从验证轮遗留的 `allow` 复原为 `ask`**（红线状态）
- `F:\soft\00selfmade\ecclaw\task.md` → 第十三阶段表头改「①②③④ 全部完成」；#8 行改 ✅ 带实证；
  顶部「第十四阶段待办」段改写为候选列表
- `F:\soft\00selfmade\ecclaw\README.md` → §5.14 尾行改为已完成实证；§5.17 新增「⑤ 真实站点登录态闭环」段
- `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3n-2026-11-02.md` → 本文件（完整重写）
- `F:\soft\00selfmade\ecclaw\prompt-ecclaw-phase3n-next.md` → 改为一句话接力 prompt
- 新增脚手架 `C:\Temp\ecclaw-verify\p3n-card.cjs`（护栏卡 DOM 定位/点击探针）
- 新增记忆 `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\ecclaw_phase3n_taobao_closedloop.md`
  + `MEMORY.md` 索引一条

**无任何 TS/TSX 代码改动** → typecheck/build 沿用上轮结论（✅）。

---

## 9. 踩坑清单（血泪，勿重踩）

1. **护栏卡不弹的头号原因**：`hostWriteGuard` 被改成了 `allow` → 写操作直接执行、界面零弹卡、
   规则也空，看起来像「卡丢了」。**排查先 grep 设置文件**。
2. **卡片默认信任范围是「仅本次」** → 直接点「允许」= 一次性放行、**不留任何规则**（session/persistent 全空属正常）。
   要验 session 档必须**先点选项再点允许**。
3. **卡片位置**：App 右下角 `.approval-stack`（实测 rect x≈1081,y≈660,311×60），小且不显眼；
   **60s 超时**后 status=`timeout`、卡片从 DOM 消失。
4. **bash 传中文参数被 locale 破坏** → `SyntaxError`；办法：写 `.cjs` 文件再跑（本项目全部采用）。
5. **授权顺序**：授过「整站」信任后，同站写操作全部自动放行、不再弹卡 → 造 session 规则必须排在整站授权**之前**。
6. **界面不自动重拉信任分组**：只在「批准写操作」后刷新；直接改 settings 后需 `location.reload()` 再等 3.5s。
7. **`ul.list li` 会混进别的面板** → 用 `h3.parentElement` 圈定趋势面板再取 `li`。
8. **趋势列表倒序渲染**（最近的在前）→ 「首个桶，无环比」在**最后一项**。
9. **取件游标取「新事件之前」那一条的 seq**，不是最后一条的 seq，否则天然取不到东西、误判链路没通。
10. **断言「没有新事件」前先停掉 watch**（`ecclaw_watch_stop` 全部停 → 等 800ms），否则前提不成立。
11. **MCP 有运行期副本**：改 `resources/mcp/host-server.mjs` 不重启 Electron = 测的还是旧码。
12. **GUI 验证走 CDP（`--remote-debugging-port=9222`）**，不要用 computer-use（对 Electron 截屏全黑且拒输入）。
13. **强杀 Electron 会丢 cookie** → 收尾一律 `stop-electron.cjs`。

---

## 10. 红线（照旧）

- **禁删用户文件**：`<userData>\host-events\exports\` 里 7 个历史导出文件一条都不许删；
  通用铁律见 `E:\Users\Duanyi\.claude\CLAUDE.md` §A（`no-delete-gate.py` 强制）。
- 禁 `git init` / `git commit`（项目非 git 仓库）。
- `openclaw.json` 含明文 relay key、桥 token 文件 → **勿外传**。
- Electron 内 spawn 内核 / MCP 必须带 `ELECTRON_RUN_AS_NODE=1`。
- 护栏策略默认保持 `ask`；**别去掉 partition 的 `persist:` 前缀**。
- **真实站点只用 `scroll` 做写操作验证**（淘宝点一下可能下单）。
- 临时产物写 `C:\Temp\`（或 `%TEMP%`）。
- 记忆文件写 `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\`；
  **handoff / task 文档不得放进 memory 文件夹**。

---

## 11. 记忆索引（`E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\`）

| 文件 | 内容 |
|---|---|
| `MEMORY.md` | 索引 |
| `ecclaw_tech_constraints.md` | openclaw schema 硬约束、spawn 内核要 ELECTRON_RUN_AS_NODE、runtime.cjs 契约、MCP 接法 |
| `ecclaw_phase3_provider.md` | aliyun-maas relay 模型白名单、agent CLI 直跑配方、agent --json 信封 |
| `ecclaw_host_contract.md` | dabi context 15 字段、observe 三模式与 ack 缓冲、宿主 MCP 桥、写操作两路径 |
| `feedback_gui_verify_cdp.md` | GUI 验证走 CDP 而非 computer-use；超时自动选项 ≠ 批准 |
| `ecclaw_phase3i_guard_poll.md` | 两段式票据/状态机、站点白名单、事件总线与长轮询 |
| `ecclaw_phase3j_guard_scope.md` | 四档 scope、白名单 match×ops×ttl、ecclaw_event_replay、persist partition |
| `ecclaw_phase3k_event_summary.md` | ecclaw_event_summary、8MB 分片 + 256MB 上限、ctx 硬闸门与验证污染坑 |
| `ecclaw_phase3l_export_guard.md` | 导出/规则工具、白名单 path 维、批准后界面必须重拉 |
| `ecclaw_phase3m_archive_trend_push.md` | 先压后删、趋势补空桶/UTC 桶键、ecclaw_guard_remove、SSE 取件覆盖判据 |
| `ecclaw_phase3n_taobao_closedloop.md` | persist cookie 留存 + session 档信任实证；护栏卡不弹两大根因 |
