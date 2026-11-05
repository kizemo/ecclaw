# handoff · ecclaw phase3m（第十三阶段）收官交接 · 2026-11-02

> 本文件是**接力入口**。接手前先读 §1（必读顺序）→ §7（下一步必交付）。
> 前置交接：`handoff-ecclaw-phase3m-2026-11-02.md`（本阶段的实施细节与契约）。
> 上一阶段：`handoff-ecclaw-phase3l-2026-11-02.md`。

---

## 1. 必读顺序（别跳）

1. 本文件
2. `handoff-ecclaw-phase3m-2026-11-02.md` §3 核心契约（压缩归档、趋势口径、护栏粒度）
3. `F:\soft\00selfmade\ecclaw\electron\main\host-events.ts`（落盘 + 趋势 + 推送订阅）
4. `F:\soft\00selfmade\ecclaw\electron\main\host-bridge.ts`（宿主桥 + SSE 端点）
5. `F:\soft\00selfmade\ecclaw\resources\mcp\host-server.mjs`（MCP 工具面 + SSE 客户端）

---

## 2. 阶段范围与完成度

用户在 AskUserQuestion 里勾选了 phase3m 全部四块：

| # | 交付块 | 代码 | 编译 | 真机验证 | 状态 |
|---|---|---|---|---|---|
| ① | 事件落盘后续：压缩归档 + 时间序列趋势 | ✅ | ✅ | ✅ **69/69 全绿** | **完成** |
| ② | 护栏收尾：按站点/路径粒度列出与移除 | ✅ | ✅ | ✅ **69/69 全绿** | **完成** |
| ③ | 宿主事件主动推送通道（SSE） | ✅ | ✅ | ✅ **14/14 全绿** | **完成** |
| ④ | 真实站点登录态闭环 | ❌ | — | 🔶 **用户已登录淘宝（CDP 实证），剩：重启验 cookie → scroll 触发护栏 → session 信任验证** | **进行中** |

---

## 3. 本轮实际改动清单（全部未 commit —— 项目不是 git 仓库）

### 3.1 主进程

- `electron/shared/types.ts`
  - `HostEventLogInfo` 加 `plainFiles` / `archivedFiles`；`retention` 加 `archiveDays`
  - 新增 `HostEventTrendBucket`（`'hour' | 'day'`）、`HostEventTrendPoint`、`HostEventTrend`
  - `HostEventSummary` 加 `trend`
  - `EcclawApi.host.eventSummary` 加 `options.bucket`
  - `EcclawApi.host` 加 `removeGuardRules(host, path?, scope?)`
- `electron/main/host-events.ts`
  - `LOG_FILE_RE` 加 `(\.gz)?`；`LogFile` 加 `gz`
  - 新增 `readLog(file, gz)` / `compressLogFile(f)` / `compressOldLogs()`
  - `sweepDisk` 改「先压后删」；`appendToDisk` 跨天触发压缩；`initHostEventLog` 启动时压缩
  - `scanDiskEvents` 与 `hostEventLogInfo` 改走 `readLog`
  - `summarizeHostEvents(filter, { bucket })` + `bucketOf` / `bucketKeyOf` / `nextBucketStart` / `bucketSpan` / `buildTrend` / `MAX_TREND_POINTS = 500`
  - **本轮新增**：事件推送从单槽 `emitter` 改为订阅者集合 `emitters`，新增 `subscribeHostEvents(fn): () => void`（渲染进程 IPC 与宿主桥 SSE 各占一拨）
- `electron/main/write-guard.ts`
  - 新增 `removeGuardRules(host, path?, scope: 'session'|'persistent'|'all')`
  - **本轮修复（真缺陷）**：`removeGuardRule` 改为按 `ttl` 分组删除。原先是「先在 session 找，找到就删，否则删永久」，而 `sameRule` 不比较 `ttl` —— 同一站点同时存在会话规则与永久规则时，点「永久信任」的移除会删掉会话那条，永久信任原封不动还在生效
- `electron/main/host-service.ts`：`hostEventSummary` 透传 bucket；新增 `hostRemoveGuardRules`
- `electron/main/host-bridge.ts`
  - `event-summary` 透传 `bucket`；新增 op `guard-rules-remove`
  - **本轮新增**：`GET /events?sinceSeq=N` —— SSE 主动推送端点（`openEventStream`，token 鉴权、15s 心跳、断线补发内存增量）
- `electron/main/index.ts`：`host:host-event-summary` 加第三参 bucket；新增 IPC `host:write-guard-remove`

### 3.2 preload / 渲染

- `electron/preload/index.ts`：`eventSummary(filter, options?)`；`removeGuardRules(host, path?, scope?)`
- `src/api.ts`：导出三个 trend 类型
- `src/views/HostEvents.tsx`：汇总加「按天 / 按小时」下拉（`aria-label="趋势分桶粒度"`）；新增趋势区块（`<h3>时间序列趋势（环比 / 峰值）</h3>`，含峰值、末桶较首桶%、逐桶环比）；留存文案改「明文 14 天 → 归档 90 天」+ 明文/归档分片数；导出面板文案改「保留天数」
- `src/App.tsx`：信任规则**按站点分组**（`groupByHost()` + `guardHostGroup()`），每条路径可单独「移除」，站点级「清空本站」（只清当前那一类）

### 3.3 MCP（工具数 21 → 22 → 23）

- `resources/mcp/host-server.mjs`
  - `ecclaw_event_summary` 加 `bucket`
  - 新增 `ecclaw_guard_remove`（`{host, path?, scope?}`）→ 22
  - **本轮新增**：常驻 SSE 客户端（`ensureEventStream` / `pushBuffered` / `eventsSince`，断线 2s 重连、缓冲上限 500、缓冲不足时回落落盘回放）+ 新工具 `ecclaw_events_since`（`{sinceSeq, limit}`）→ 23
  - **收口轮修复**：`eventsSince()` 取件覆盖判据 —— 由「缓冲里捞到东西」改为「缓冲是否覆盖 `sinceSeq` 之后的全部事件」（详见 §5.3）

---

## 4. 核心契约（改这块前必读）

### 4.1 保留策略「先压后删」

- 明文 `.jsonl` 超过 **14 天** → 压缩成 `.jsonl.gz`（**不删**）
- 归档 `.gz` 超过 **90 天** → 才删
- 目录总体积超 256MB → 从最老的一天整日删（`trimToSize`，含归档）
- **所有读路径必须走 `readLog(file, gz)`**，漏一处 → gzip 被当明文解析 → 事件静默消失
- `compressLogFile` 顺序：先写 `.gz` → 确认写成了 → 再删明文（中途失败保持原样，宁可多占磁盘也不能丢数据）

### 4.2 时间序列趋势口径

- 必须**补空桶 0**，否则「环比」变成「跟上一个有数据的桶比」，口径不一致
- 桶键用 **UTC**（落盘时间就是 UTC ISO），别用本地时区
- `deltaPct`：首桶 null；上桶为 0 也 null（不除零）
- `peak` = 条数最多的桶；`overallDeltaPct` = 末桶 vs 首桶（百分比，保留 1 位）
- 跨度 > `MAX_TREND_POINTS`（500）桶 → 退化稀疏模式（只保留有数据的桶）
- 非法 `bucket` 值归一到 `day`，不抛错

### 4.3 护栏移除粒度

- `removeGuardRules(host, path?, scope?)`
  - `path` 缺省 = 整站；给空串 `''` 也按整站（`rulePath()` 把 `'/'` 与 `''` 归一）
  - `scope` 缺省 `all`，但**界面按行分开清**（session 行只清 session）
- 界面逐条「移除」走 `removeGuardAllow(rule)` → `removeGuardRule(rule)`，**已修为按 ttl 分组**（见 §3.1）

### 4.4 事件推送通道

- MCP 是 stdio 传输，**没有服务端主动推送语义** → 推送落在宿主桥这一层：
  `主进程 → 桥 GET /events (SSE) → MCP 进程缓冲 → agent 取件`
- 桥端点：loopback + `x-ecclaw-token`，与 `/rpc` 同一把令牌
- 首次连接按 `sinceSeq` 补发内存环形缓冲里的增量（最多 200 条），随后转实时
- MCP 侧 `ecclaw_events_since` 取件；缓冲不足（事件太老被挤出）时**回落到落盘回放**（`source: 'replay'`），保证不漏

---

## 5. 测试证据

### 5.1 已通过：`phase3m-e2e.cjs` **69/69 全绿**

```bash
cd C:/Temp/ecclaw-verify
node phase3m-e2e.cjs \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs" \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json"
```

覆盖：压缩归档（明文→`.gz`、回放条数一致、留存策略 14/90、归档可导出）、
趋势（day/hour 桶对齐、补空桶、环比与除零、峰值、overallDeltaPct、非法桶归一）、
护栏移除（路径粒度、作用域粒度、`path:''`≡整站、站点粒度、不误伤其它站点、界面逐条移除删对组）、
界面（按站点分组、路径维度、清空本站、趋势面板渲染与切粒度）。

> 注：该脚本断言的 MCP 工具数已从 22 改成 **23**（加了 `ecclaw_events_since`），
> **已于收口轮重跑：69/69 全绿**。

### 5.2 已通过：`sse-e2e.cjs` **14/14 全绿**（收口轮）

```bash
cd C:/Temp/ecclaw-verify
node sse-e2e.cjs \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs" \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json" > sse-e2e.log 2>&1
```

覆盖：`GET /events` 200 + `text/event-stream`、无 token 403、MCP 工具数 23、
`ecclaw_events_since` 存在且能取到事件、事件带 seq/at、宿主产生事件时 SSE **主动推过来（不轮询）**、
增量取件走**推送缓冲（source=push）**、推送缓冲里取到刚推来的事件、
**没有新事件时立即返回空数组（不挂住）**、空取件也走 push（不回落扫盘）。

### 5.3 收口轮修的产品缺陷（真缺陷，不是测试问题）

**MCP 侧 `eventsSince()` 的取件覆盖判据写错了**（`resources/mcp/host-server.mjs`）。

原判据：`fromBuffer.length > 0 && sinceSeq >= oldest - 1` 才走推送缓冲。
问题：**没有新事件时缓冲本来就是空的** → `fromBuffer.length > 0` 为假 → 错误地回落扫盘，
把落盘里**另一个 seq 空间**的老事件又吐回来（agent 会看到自己早就消费过的旧事件）。

改成纯覆盖判据：

```js
if (oldest !== null && sinceSeq >= oldest - 1) {
  return { events: fromBuffer, source: 'push', buffered: eventBuffer.length }
}
```

即：**缓冲覆盖 `sinceSeq` 之后的全部事件 → 直接返回（没新事件就是空数组）；
不覆盖（事件太老被挤出 500 上限）→ 才回落落盘回放 `source:'replay'`。**

> 改的是 `.mjs`，**没动 TypeScript** → 不需要重新 build；
> 但 MCP 有运行期副本 `<stateDir>/mcp/host-server.mjs`，**改完必须同步或重启 Electron**，否则测的还是旧码。

---

## 6. 本轮踩坑（都是**测试脚本**的坑，不是产品缺陷，但很容易再踩）

1. **授权顺序**：授过「整站」信任（session 档本身就是整站规则）之后，同站点的写操作**全部自动放行，不再弹卡**。
   → 造 session 规则必须排在整站授权**之前**；整站永久规则用 settings 直写（等价于用户之前授权过）。
2. **界面不自动重拉信任分组**：只在「批准写操作」后刷新。直接 patch settings 后界面看到的是旧值
   → 需要 `location.reload()` 再等 3.5s。
3. **`ul.list li` 会混进别的面板**：按平台包 / 按类型 / 按天 / 趋势都用 `ul.list`
   → 用 `h3.parentElement` 圈定趋势面板再取 `li`。
4. **趋势列表是倒序渲染**（最近的在前）→「首个桶，无环比」在**最后一项**。
5. bash 传中文参数被 locale 破坏（`setlocale: cannot change locale (zh-CN)`）→ JS 表达式里的中文报 `SyntaxError`
   → 办法：用 `\uXXXX` 转义，或**把脚本写进 `.cjs` 文件再跑**（推荐，本轮全部采用）。
6. **ctx 硬闸门 160K 触发**（只放行 Write/Edit）→ 本文件就是这么落盘的；下一步必须**开新会话**继续。
7. **取件的「游标」要取新事件**之前那一条，不是最后一条。收口轮 `sse-e2e.cjs` 一开始取
   `lastSeq = 最后一条的 seq` 再要 `seq > lastSeq` → 天然取不到东西 → 误判成推送链路没通。
   正确做法：记 `prevSeq`（新事件**之前**最后一条的 seq），再要 `seq > prevSeq`。
8. **断言「没有新事件」之前必须先停掉观察**。watch 还在跑就一直有新事件进来，前提不成立。
   `sse-e2e.cjs` 收口版改成「先 `ecclaw_watch_stop` 全部 watch → 等 800ms → 再断言空取件」。
9. **`seq` 是运行时计数器，Electron 重启后归零** → 落盘里存在**多个 seq 空间**；
   且 `replayHostEvents` 是**按文件顺序**返回（**不是**全局按 seq 升序 —— 注释与实现不符）。
   → 拿「回放列表最后一条的 seq」当游标会踩坑（可能拿到夹具的 900001+）。
   本阶段**未改**（属既有设计），已写进 `prompt-ecclaw-phase3n-next.md` 当候选。

---

## 7. 下一步必交付（按顺序）

### 7.1 ✅ 收口 SSE 推送链路 —— **已完成**（14/14 全绿）

修了一个真缺陷（§5.3：取件覆盖判据），测试脚本也修了三处（§6 踩坑 7/8）。详见 §5.2。

### 7.2 ✅ 回归重跑（工具数 23）—— **已完成**（69/69 全绿）

### 7.3 ✅ 补文档 —— **已完成**

- `README.md` §5.17 —— 第十三阶段：压缩归档 / 趋势 / 护栏粒度 / SSE 推送 ✅
- `task.md` —— 第十三阶段表格 + 8 条实证发现 ✅
- `memory/ecclaw_phase3m_archive_trend_push.md` + `MEMORY.md` 索引 ✅
- `prompt-ecclaw-phase3n-next.md` ✅

### 7.4 🔶 真实站点登录态闭环（④，进行中 —— 用户已登录，剩 3 步）

**已完成的实证（2026-11-02 ~19:2x）**：
- 用户已在 ecclaw 内嵌浏览器登录淘宝 ✅
- `taobao-login-state.cjs` CDP 复验 ✅：`hasLoginPrompt=false`、页面显示昵称 **kizemo**、
  购物车 1341 字节含登录态 cookie（`_tb_token_`、`_hvn_lgc_`；登录前 735 字节只有匿名项）
- 注：探针重新 open 了一次，现页签是 `tabId 8`（旧 tabId 7 被复用替换）

**新会话剩余步骤**（都必须在用户在场时做）：
1. 关 Electron 用 `node C:/Temp/ecclaw-verify/stop-electron.cjs`（走 window.close，保住 cookie，**别强杀**），
   重启 `start-electron.ps1`，复跑 `taobao-login-state.cjs` → 昵称仍在 = `persist:ecclaw-host` cookie 留存验证 ✅
2. 用 **`ecclaw_scroll`（不是 click！淘宝点一下可能下单）** 在 taobao.com 触发护栏弹卡
3. 用户选「本次会话内信任本站」→ 验证规则只落在 session 组、`hostWriteGuardAllowlist` 仍为 `[]`
   （`node C:/Temp/ecclaw-verify/bridge-rpc.cjs guard-rules '{}'` + 读 `ecclaw-settings.json`）
4. 全过 → 更新本文件 §2 表格 ④ 为完成 + `task.md` 第十三阶段 #8 行改 ✅
5. amazon 是 AWS WAF 挑战页，不必重试

### 7.5 ✅ 收尾交接 —— **已完成**：`prompt-ecclaw-phase3n-next.md`（<30 行）

### 7.6 （可选，下一阶段候选）事件 seq 空间的遗留问题

见 §6 踩坑 9：`seq` 重启归零、落盘多 seq 空间、回放按文件顺序不按 seq 升序。
已写进 `prompt-ecclaw-phase3n-next.md` 当候选，等用户定优先级。

---

## 8. 环境与路径

| 项 | 值 |
|---|---|
| 项目根 | `F:\soft\00selfmade\ecclaw`（**非 git 仓库**，禁止 git init/commit） |
| 用户数据 | `C:/Users/Duanyi/AppData/Roaming/ecclaw/` |
| stateDir | `<userData>/openclaw/.openclaw/` |
| MCP 运行期副本 | `<stateDir>/mcp/host-server.mjs`（Electron 启动时自动从 `resources/mcp/` 同步） |
| 桥端点 | `<stateDir>/host-bridge.json`（含 token，**勿外传**） |
| 持久化 partition | `<userData>/Partitions/ecclaw-host/`（`persist:ecclaw-host`） |
| 事件落盘 | `<userData>/host-events/events-YYYY-MM-DD[.N].jsonl[.gz]`（+ `exports/`） |
| 脚手架 | `C:/Temp/ecclaw-verify/`（**勿删**） |
| 起 Electron | `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"` |
| 关 Electron | `node C:/Temp/ecclaw-verify/stop-electron.cjs`（走 window.close，保住 cookie） |
| GUI 验证 | **必须走 CDP**（`--remote-debugging-port=9222`），**不要用 computer-use**（对 Electron 截屏全黑且拒输入） |

新增脚手架文件：
- `C:/Temp/ecclaw-verify/p3m-fixture.cjs` —— 造「45 天前」的明文 JSONL 夹具（8 条，跨 3 天、其中一天留空桶）
- `C:/Temp/ecclaw-verify/p3m-fixture-meta.json` —— 夹具元信息（D0/D1/D2、期望条数）
- `C:/Temp/ecclaw-verify/phase3m-e2e.cjs` —— 主 e2e（69 断言）
- `C:/Temp/ecclaw-verify/sse-e2e.cjs` —— SSE 推送 e2e（14 断言）
- `C:/Temp/ecclaw-verify/cdp-eval.cjs` —— 通用 CDP 探针
- `C:/Temp/ecclaw-verify/taobao-login-state.cjs` —— 真实站点登录态探针（开页 + CDP 读页面判登录态）
- `C:/Temp/ecclaw-verify/p3m-probe.cjs` —— 事件 seq 分布探针（内存环 vs 落盘）

---

## 9. 红线（照旧，别踩）

- **禁删用户文件**：`host-events/exports/` 里还留着 7 个历史导出文件，一条都不许删
- 禁 `git init` / `commit`（项目不是 git 仓库）
- `openclaw.json` 含明文 relay key，**勿外传**；桥 token 文件**勿外传**
- Electron 内 spawn 内核 / MCP 必须 `ELECTRON_RUN_AS_NODE=1`
- 护栏默认 `ask`；保留 partition 的 `persist:` 前缀
- **真实站点只用 scroll 做写操作验证**（淘宝点一下可能下单）
- 临时产物写 `C:/Temp/`
- 记忆文件写 `E:/Users/Duanyi/.claude/projects/F--soft-00selfmade-ecclaw/memory/`，**别放进 `memory/` 子目录以外的地方**；禁止把 handoff/task 文档放进 memory 文件夹
