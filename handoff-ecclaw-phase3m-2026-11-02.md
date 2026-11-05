# handoff · ecclaw 第十三阶段（phase3m）· 2026-11-02（**未收官 · 代码已就位，真机验证待补**）

> 阶段名：**第十三阶段 / phase3m** —— 事件落盘后续（压缩归档 + 时间序列趋势）+ 护栏收尾（按站点/路径粒度）+ 宿主事件主动推送 + 真实站点登录态闭环
> 上一阶段：`handoff-ecclaw-phase3l-2026-11-02.md`（第十二阶段：事件导出 + 信任规则可视化 + 白名单路径维度）
> 本轮范围：用户勾选了这四块 **全部**。实际进度见 §1。
>
> ⚠️ **本文件不是收官 handoff**：代码写完了、`typecheck`/`build` 过了，但 **真机 e2e 没跑**、
> **Electron 重启状态未确认**、**真实站点登录态闭环没做**（用户当时还没在淘宝登录）。
> 下一阶段请从 §4「验证待办」接手，不要重写代码。

---

## 1. 本轮进度总览

| 四块 | 代码 | 编译 | 真机 e2e | 状态 |
|---|---|---|---|---|
| ① 事件落盘后续（压缩归档 + 时间序列趋势） | ✅ 完成 | ✅ | ❌ 待跑 | **待验证** |
| ② 护栏收尾（按站点 / 路径粒度列出与移除） | ✅ 完成 | ✅ | ❌ 待跑 | **待验证** |
| ③ 宿主事件主动推送通道 | ❌ **未实现** | — | — | **顺延** |
| ④ 真实站点登录态闭环 | ❌ 未做（用户未登录淘宝） | — | — | **顺延（需用户在场）** |

已完成部分的证据：
- `pnpm typecheck` ✓（`tsconfig.node.json` + `tsconfig.web.json` 两段 tsc 均 exit 0）
- `pnpm build` ✓（renderer 629.77 kB / preload 5.64 kB / main 156.16 kB）
- MCP 运行期副本已同步：`resources/mcp/host-server.mjs` → `<stateDir>/mcp/host-server.mjs` ✓

---

## 2. 已完成的代码（改动清单）

本项目**不是 git 仓库**（禁 git init / commit），以下全部是未提交的工作区改动。

### 主进程

| 文件 | 改动 |
|---|---|
| `electron/shared/types.ts` | `HostEventLogInfo` 加 `plainFiles` / `archivedFiles`，`retention` 加 `archiveDays`；新增 `HostEventTrendBucket` / `HostEventTrendPoint` / `HostEventTrend`；`HostEventSummary` 加 `trend`；`EcclawApi.host.eventSummary` 加第二参 `options.bucket`；`EcclawApi.host` 加 `removeGuardRules(host, path?, scope?)` |
| `electron/main/host-events.ts` | **压缩归档**：`LOG_FILE_RE` 加 `(\.gz)?`；`LogFile` 加 `gz`；新增 `readLog(file, gz)`（统一解压）、`compressLogFile(f)`（先写 .gz 再删明文）、`compressOldLogs()`；`sweepDisk` 改为「明文超期→压缩、归档超期→删」；`appendToDisk` 跨天触发压缩；`initHostEventLog` 启动时压缩；`scanDiskEvents` / `hostEventLogInfo` 改走 `readLog`。<br>**时间序列趋势**：`summarizeHostEvents(filter, {bucket})`；新增 `bucketOf` / `bucketKeyOf` / `nextBucketStart` / `bucketSpan` / `buildTrend` / `MAX_TREND_POINTS=500` |
| `electron/main/write-guard.ts` | 新增 `removeGuardRules(host, path?, scope: 'session'\|'persistent'\|'all' = 'all')` —— 按站点 + 可选路径移除信任规则，session 与 persistent 两条线分开处理 |
| `electron/main/host-service.ts` | `hostEventSummary(filter, options)` 透传 bucket；新增 `hostRemoveGuardRules(host, path?, scope?)` |
| `electron/main/host-bridge.ts` | `event-summary` 透传 `bucket`；新增 op `guard-rules-remove`（`{host, path?, scope?}`） |
| `electron/main/index.ts` | `host:host-event-summary` 增加第三参 `bucket`；新增 IPC `host:write-guard-remove`（`host, path?, scope?`） |

### preload / 渲染层

| 文件 | 改动 |
|---|---|
| `electron/preload/index.ts` | `eventSummary(filter, options?)`；新增 `removeGuardRules(host, path?, scope?)` |
| `src/api.ts` | 导出 `HostEventTrend` / `HostEventTrendBucket` / `HostEventTrendPoint` |
| `src/views/HostEvents.tsx` | 汇总面板加「按天 / 按小时」粒度下拉；新增「时间序列趋势（环比 / 峰值）」区块（峰值、末桶较首桶%、逐桶环比，列表倒序取最近 30 个）；留存策略文案改为「明文 14 天 → 归档 90 天」并显示明文/归档分片数 |
| `src/App.tsx` | 信任规则**按站点分组**展示：`groupByHost()` + `guardHostGroup()`；每条路径规则可单独「移除」；每个站点有「清空本站」（只清当前那一类：session 行只清 session，persistent 行只清 permanent） |

### MCP

| 文件 | 改动 |
|---|---|
| `resources/mcp/host-server.mjs` | `ecclaw_event_summary` 加 `bucket` 参数（`day` 默认 / `hour`），描述补 trend 语义；新增工具 **`ecclaw_guard_remove`**（`{host, path?, scope?}`）→ **MCP 工具数 21 → 22** |

### 尚未改动（下一阶段要补）

- `task.md`（第十二阶段之后的阶段表格 + 实证发现）
- `README.md`（新增 §5.17）
- `docs/` 下无新增文档
- 记忆文件 `memory/ecclaw_phase3m_*.md` 与 `MEMORY.md` 索引

---

## 3. 契约（记住这几条就够用）

### 3.1 压缩归档

1. **保留策略从「删」改成「先压后删」**：明文 `.jsonl` 超 **14 天** → 压成 `.jsonl.gz`；归档 `.gz` 超 **90 天** → 才删除。
2. `LOG_FILE_RE` = `/^events-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.jsonl(\.gz)?$/` —— `exports/` 子目录仍然不匹配，所以导出物依旧不受淘汰策略影响。
3. **所有读路径必须走 `readLog(file, gz)`**（`scanDiskEvents` / `hostEventLogInfo`）。直接 `readFileSync` 会把 gzip 字节当明文解析 → 事件静默消失。
4. `compressLogFile` 的顺序是**先写 .gz、确认写成、再删明文** —— 中途失败保持原样，宁可多占磁盘也不能丢数据。
5. 压缩触发点：跨天（`lastLogDay` 变化）、每 200 次写入（`TRIM_CHECK_EVERY`）、启动时（`initHostEventLog`）。
6. `trimToSize`（256MB 目录上限）依然整日删除，**包括归档** —— 归档不是免死金牌。

### 3.2 时间序列趋势

7. `summarizeHostEvents(filter, {bucket})`，`bucket` = `'day'`（默认）| `'hour'`；结果在 `summary.trend`。
8. `trend = { bucket, points[], peak, overallDeltaPct }`；`points[] = { start, count, delta, deltaPct }`。
9. **空桶必须补 0**：不补的话「环比」就变成「跟上一个有数据的时段比」，数字看着像环比其实不是同一口径。
   跨度 > 500 个桶时退化为稀疏模式（只保留有数据的桶），此时 delta 是「跟上一个非空桶比」。
10. `delta` = 与上一个桶的条数差；`deltaPct` = 相对上一个桶的百分比（首桶为 `null`；上一桶为 0 时也为 `null`，不能除零）。
11. `peak` = 条数最多的桶；`overallDeltaPct` = 末桶相对**首桶**的总体变化（首桶为 0 时 `null`）。
12. `at` 是 UTC ISO 串，桶键取 `slice(0,10)`（天）/ `slice(0,13)`（小时）；`start` 是桶起点（`T00:00:00.000Z` / `整点:00:00.000Z`）。**别用本地时区**——落盘时间就是 UTC。

### 3.3 护栏按站点 / 路径粒度

13. `removeGuardRules(host, path?, scope?)`：
    - `path` 缺省 = 整站；`path` 给了 = 只命中该路径前缀那一条（比较用 `rulePath()` 归一化，`/` 与 `''` 等价于「整站」）。
    - `scope` = `'session'` | `'persistent'` | `'all'`（默认 `'all'`）。**session 与 persistent 要分开清**：界面上「本次会话信任」行的「清空本站」只清 session，永久规则保留。
14. 界面按站点分组：同一 host 的多条路径规则聚成一个标签，标签内每条路径单独「移除」，站点级「清空本站」。
15. MCP `ecclaw_guard_remove`：`{host, path?, scope?}` → 返回移除条数。

### 3.4 MCP 工具面

16. **MCP 工具 22 个**（21 + `ecclaw_guard_remove`）。
17. `ecclaw_event_summary` 的 `bucket` 参数：`day`（默认）/ `hour`。

---

## 4. 验证待办（下一阶段的第一件事）

### 4.0 确认 Electron 重启状态

本轮最后一条命令是「kill 旧 Electron + 起新 Electron」，**以后台任务方式发起，结果没来得及确认**：
`taskkill /F /T /PID 154900` → `start-electron.ps1` → 后台任务 id `bvudh6tu5`。

接手时先做：

```bash
cat "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json" | head -6
curl -s http://127.0.0.1:9222/json/list
```

- 若 bridge 文件里的 `pid` / `startedAt` 是旧值 → 说明没重启成功，手动重跑
  `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"`。
- 若 Electron 根本没起 → 先看 `C:/Temp/ecclaw-verify/dev.log`。
- fixture（8897 / 8898）两个 node 进程独立于 Electron，重启 Electron **不用**重启它们。

### 4.1 写并跑真机 e2e（C:/Temp/ecclaw-verify/phase3m-e2e.cjs）

骨架照抄 `export-guard-e2e.cjs`（MCP 客户端 + 桥 RPC + CDP 驱动 + 断言表），**勿删已有脚手架**：
`export-guard-e2e.cjs` / `event-summary-e2e.cjs` / `event-replay-e2e.cjs` / `scope-e2e.cjs` /
`approval-watcher.cjs` / `fixture-writer.cjs`(8897) / `fixture-server.cjs`(8898) / `cdp-eval.cjs`（本轮新建）

建议断言：

**归档（①）**
- `tools/list` 工具数 = **22**，`ecclaw_guard_remove` 在列表里
- 明文文件压成 `.gz` 后，**回放条数不变**（压缩前后 `ecclaw_event_replay` 条数一致）
- 汇总 `days` / `total` 与压缩前一致
- `ecclaw_event_summary` 的返回里 `retention.archiveDays` = 90（走 `event-log-info` 桥 op 看）
- 手动压一个分片后，`host-events/` 目录里出现 `events-YYYY-MM-DD.jsonl.gz`

**趋势（①）**
- `ecclaw_event_summary` 带 `bucket:'day'` → `trend.bucket='day'`，`points[]` 的 `start` 对齐到 `T00:00:00.000Z`
- 带 `bucket:'hour'` → `trend.bucket='hour'`，`points[]` 的 `start` 对齐到整点
- `points[0].delta === null`、`points[0].deltaPct === null`
- `points[i].delta === points[i].count - points[i-1].count`
- `peak.count === max(points[].count)`
- **空桶补 0**：造两个相隔两天的桶 → 中间那天 count=0 且 delta 为负数（不是被跳过）
- 桥 op `event-summary` 与 MCP 工具返回同形

**护栏粒度（②）**
- 给同一 host 授权两条不同 path → `ecclaw_guard_rules` 的 persistent 组里能看到两条
- `ecclaw_guard_remove` 带 `{host, path:'/foo'}` → 只掉那一条，另一条还在
- `ecclaw_guard_remove` 带 `{host}`（不带 path）→ 该 host 全部规则清空
- `ecclaw_guard_remove` 带 `{host, scope:'session'}` → 只清 session，persistent 不动
- 界面：信任规则**按站点分组**（同一 host 只出现一个标签，标签内两条路径），点某条的「移除」只掉那一条，点「清空本站」掉该站点全部

**回归**
- 第十二阶段的导出能力没被破坏：`ecclaw_event_export` 仍能导出、条数与汇总一致
- `pnpm typecheck` + `pnpm build` 仍过

### 4.2 真实站点登录态闭环（需用户在场）

淘宝**当前未登录**（本轮多次检查都是「亲，请登录」）。`persist:ecclaw-host` partition 在位但没 cookie。

接手时的步骤：

1. 让用户在 ecclaw 窗口里点「显示内嵌浏览器」（`src/App.tsx` 的平台包页），淘宝已经打开过；直接在里面登录（扫码或账号密码）。
   - **用户自己点不算写操作**（source=ui），不会触发护栏卡片。
2. 登录后用 CDP 验证（`cdp-eval.cjs`，target 子串 `taobao`）：页面不再出现「请登录」，出现用户名。
3. **验证 partition 持久化**：重启 Electron → 重新读淘宝页面 → 仍处于登录态。
   这是第十阶段 `persist:ecclaw-host` 的核心承诺，本轮第一次在真实站点上实证。
4. **真实站点护栏闭环**：用 `ecclaw_scroll`（不是 click！淘宝的点击可能下单）在真实站点触发一次写操作
   → 确认卡片弹出 → 用户在界面上选「本次会话内信任本站」并允许 → 确认执行成功
   → 再 `ecclaw_guard_rules` 确认规则出现在 **session** 组、**不在** persistent 组
   → `ecclaw-settings.json` 的 `hostWriteGuardAllowlist` 仍为 `[]`
   - 务必用 scroll 而不是 click：scroll 也走护栏（`MUTATING_OPS` 含 scroll），但不会产生订单。
5. amazon **不必重试**（已知是 AWS WAF 挑战页）。

### 4.3 宿主事件主动推送通道（③，未实现）

现状：agent 侧只有长轮询 `ecclaw_next_event`（宿主侧挂起等待，超时返回 null）。

MCP 是 stdio 传输，**没有服务端主动推送的语义** —— 所以「推送」要么给非 MCP 消费者开一条流式通道，
要么让 MCP 侧自己持一条长轮询循环。建议方向（下一阶段定夺）：

- **SSE 端点**：宿主桥（`electron/main/host-bridge.ts` 已经是 loopback HTTP + token 鉴权）
  加 `GET /events`（`text/event-stream`），主进程用 `host-events.ts` 已有的 `setHostEventEmitter` 把事件推出去。
  非 MCP 消费者（openclaw 内核、脚本、界面）都能直接订阅。**注意**：现有桥只接受 `POST /rpc`，
  要放开 GET + SSE 的鉴权方式（token 走 header 或 query）。
- **MCP 侧长轮询循环**：`host-server.mjs` 里起一条后台循环，持续 `next-event` 并把事件缓存起来，
  再给一个 `ecclaw_events_since(sinceSeq)` 之类的工具去取 —— 相当于把推送做成了「不阻塞的长轮询」。
- 权衡：SSE 更接近「真推送」，但多一条要维护的协议；长轮询循环改动小、复用现成的 `waitHostEvent`，
  但 agent 侧仍然是「自己去取」。

---

## 5. 环境与基线

| 项 | 值 |
|---|---|
| 项目根 | `F:\soft\00selfmade\ecclaw`（**不是 git 仓库** —— 禁 git init / commit） |
| 用户数据 | `C:/Users/Duanyi/AppData/Roaming/ecclaw/` |
| 状态根（stateDir） | `C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/` |
| MCP 脚本副本 | `<stateDir>/mcp/host-server.mjs`（**运行期副本**；改 `resources/mcp/host-server.mjs` 后**必须重启 Electron**） |
| 宿主桥端点 | `<stateDir>/host-bridge.json`（含 token，勿外传） |
| 事件落盘 | `<userData>/host-events/events-YYYY-MM-DD[.N].jsonl`（+ `.gz` 归档 + `exports/` 子目录放导出物） |
| 持久化 partition | `<userData>/Partitions/ecclaw-host/`（Electron 侧 `persist:ecclaw-host`） |
| 设置 | `<userData>/ecclaw-settings.json`（`hostWriteGuard: ask` / `hostWriteGuardAllowlist: []`） |
| 验证脚手架 | `C:/Temp/ecclaw-verify/`（**勿删**）：`export-guard-e2e.cjs`、`event-summary-e2e.cjs`、`event-replay-e2e.cjs`、`scope-e2e.cjs`、`approval-watcher.cjs`、`fixture-writer.cjs`(8897)、`fixture-server.cjs`(8898)、`start-electron.ps1`、**`cdp-eval.cjs`（本轮新建）** |
| fixture 端口 | 8897（写操作验证页，任何路径都返回同一页 → 天然支持路径维度测试）、8898（只读 demo 页） |
| Electron 启动 | `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"`（自带 `--remote-debugging-port=9222`） |

---

## 6. 踩坑与坑位

1. **`readLog` 漏一处就静默丢事件**。`scanDiskEvents` 与 `hostEventLogInfo` 都要走 `readLog(file, gz)`；
   任何一处直接 `readFileSync` 一个 `.gz`，解析失败会被 `catch` 吞掉 → 事件凭空消失，界面上看不出异常。
2. **bash 传中文参数会被 locale 破坏**（`setlocale: cannot change locale (zh-CN)`）。
   本轮 `cdp-eval.cjs` 的 JS 表达式里带中文直接报 `SyntaxError: Invalid or unexpected token`。
   → 办法一：表达式里用 `\uXXXX` 转义（纯 ASCII）；办法二：**把脚本写进 `.cjs` 文件再跑**（推荐，
   `Write` 写的是 UTF-8，node 读没问题）。`approval-watcher.cjs` 就是这个模式。
3. **Electron 的 WebContentsView 也出现在 CDP 的 target 列表里**（title 是页面标题，url 是站点地址）。
   所以宿主页面的 DOM 可以直接用 CDP 读，不必写注入脚本。app 渲染层则是 `file:///.../out/renderer/index.html`。
4. **`bounds: null` = 宿主视图当前是隐藏的**。要用宿主浏览器得点「显示内嵌浏览器」，
   之后 `hostStatus().bounds` 才有值（点之前是 null，别误判成「没装好」）。
5. **`filter` 回调里不能写 `continue`**（那是循环的语法）。本轮在 `removeGuardRules` 里差点写错，
   TS 不会报错但运行行为诡异 —— 改成 `return true`。
6. **ctx-budget-guard 在 ~160K 硬拦**（只放行 Write/Edit）。本轮正是在 161K 被拦，
   所以「写完代码 → 立刻 typecheck/build → 再写 handoff」的顺序要照做，别攒到最后。
7. **子进程要带 `ELECTRON_RUN_AS_NODE=1`**（Electron 内 spawn 内核 / MCP 的老规矩）。

---

## 7. 下一阶段必交付（按优先级）

1. **跑通真机 e2e**（§4.1）—— 代码已经写完，缺的是证据。这是最高优先级。
2. **真实站点登录态闭环**（§4.2，需用户在场登录）。
3. **宿主事件主动推送通道**（§4.3，未实现）。
4. **补文档**：`README.md` §5.17、`task.md` 第十三阶段表格 + 实证发现、
   `memory/ecclaw_phase3m_*.md` + `MEMORY.md` 索引。
5. 收尾写 `handoff-ecclaw-phase3m-final-<date>.md` + `prompt-ecclaw-phase3n-next.md`。

---

## 8. 红线（勿违）

- **禁止删除用户文件**（`<userData>/host-events/exports/` 下的测试产物也别自动删；
  本轮前的 `exports/` 里还留着 7 个历史导出文件）。
- 禁止 git init / commit（本项目不是 git 仓库）。
- `openclaw.json` 含明文 relay key，**勿外传**；宿主桥 token 文件勿外传。
- Electron 内 spawn 内核 / MCP 必须带 `ELECTRON_RUN_AS_NODE=1`。
- 宿主页面 sandbox + contextIsolation + nodeIntegration=false。
- **GUI 验证走 CDP，不要用 computer-use**（Electron 截屏全黑）。
- 护栏策略默认保持 `ask`；别去掉 partition 的 `persist:` 前缀。
- 临时产物写 `C:/Temp/`。
- **真实站点上只用 `scroll` 做写操作验证**，别用 click（淘宝点一下可能下单）。

---

## 9. 必读顺序

1. 本文件（`handoff-ecclaw-phase3m-2026-11-02.md`）
2. `handoff-ecclaw-phase3l-2026-11-02.md`（第十二阶段收官：导出 / 信任规则可视化 / 路径维度）
3. `handoff-ecclaw-phase3k-2026-11-02.md`（第十一阶段：事件汇总 + 保留策略）
4. `handoff-ecclaw-phase3j-2026-11-02.md`（第十阶段：护栏四档 + 事件落盘 + 登录态 partition）
5. `handoff-ecclaw-phase2-2026-11-01.md`（权威背景：整体架构与红线）
6. `E:/Users/Duanyi/.claude/projects/F--soft-00selfmade-ecclaw/memory/ecclaw_phase3l_export_guard.md`
   （记忆版契约 + 踩坑）
