# handoff · ecclaw 第十一阶段（phase3k）· 2026-11-02（收官 · 真机已验）

> 主题：事件汇总视图（`ecclaw_event_summary`）· 落盘保留策略细化（8MB 分片 + 256MB 目录上限）
> 上一阶段：第十阶段（phase3j）—— `handoff-ecclaw-phase3j-2026-11-02.md`
> 权威背景：`handoff-ecclaw-phase2-2026-11-01.md`
> 状态：**代码完成 + 真机验证全绿（22/22）+ 文档已补齐**（本阶段收官）

---

## 1. 这一阶段做了什么

| # | 事项 | 状态 |
|---|---|---|
| 1 | 事件汇总（主进程 `summarizeHostEvents` + MCP 工具 `ecclaw_event_summary` + 宿主桥 op `event-summary` + 界面「事件汇总」面板） | ✅ 代码 + **真机 22/22 断言全绿**（MCP 工具 17 → **18**） |
| 2 | 落盘保留策略细化：单文件 8MB 滚动分片 + 目录 256MB 上限 + 每 200 条查一次 | ✅ 代码 + **真机验证**（超 8MB 出 `.1` 分片；超期文件启动即删） |
| 3 | `event-log-info` 返回值扩展（新增 `bytes` 与 `retention`） | ✅ |
| 4 | 护栏 session 规则可视化 | ✅（session → 「（本次会话）」、persistent → 「（永久）」+ `title` 提示） |
| 5 | 真实站点登录态闭环 | ❌ 未做（需用户本人账号，风险自负）；**只读已复验**：淘宝正常，amazon = AWS WAF 挑战页 |

> 上一阶段会话撞上下文墙，**代码写完但一行验证都没跑**（`HostEvents.tsx` 的面板甚至没写进去）。
> 本次会话补齐面板、跑通 typecheck/build、真机 22/22 全绿、文档补齐。

---

## 2. 改动清单（全部未 commit —— 本项目不是 git 仓库）

### 新增文件

| 文件 | 作用 |
|---|---|
| `docs/ecclaw-事件汇总与落盘保留策略-2026-11-02.md` | 本阶段设计、验证表、踩坑 |
| `C:/Temp/ecclaw-verify/event-summary-e2e.cjs` | **事件汇总 + 保留策略端到端（22 断言）** |
| `C:/Temp/ecclaw-verify/stop-electron.cjs` | 优雅关窗（`window.close()` → `window-all-closed` → `app.quit()`，保住 `persist:` 分区 cookie） |
| `handoff-ecclaw-phase3k-2026-11-02.md` / `prompt-ecclaw-phase3k-next.md` | 本阶段交接 |

### 修改文件

| 文件 | 改动 |
|---|---|
| `electron/main/host-events.ts` | **整文件重写**：`LOG_FILE_RE`（支持 `events-DAY.N.jsonl`）、`LogFile`、`listLogFiles()`、`fileBytes()`、`trimToSize()`、`scanDiskEvents(filter, cb)`（回放与汇总共用）、`summarizeHostEvents(filter)`；常量 `MAX_FILE_BYTES=8MB` / `MAX_TOTAL_BYTES=256MB` / `TRIM_CHECK_EVERY=200` / `writesSinceTrim`；`appendToDisk` 改为「当天最后分片超 8MB 就新开 `.1.jsonl`」；`sweepDisk()` 增删超期文件后调 `trimToSize()`；`hostEventLogInfo()` 返回值扩为 `{dir, days[], total, bytes, retention{}}` |
| `electron/shared/types.ts` | 新增 `HostEventFilter` / `HostEventLogInfo` / `HostEventSummary`；`EcclawApi.host` 的 `replayHostEvents` 改签名为 `HostEventFilter & {limit?}`，新增 `eventSummary(filter?)`，`hostEventLogInfo()` 改返回 `HostEventLogInfo` |
| `electron/main/host-service.ts` | import `summarizeHostEvents`；新增导出 `hostEventSummary(filter)`；`hostEventLogInfo()` 返回类型改 `HostEventLogInfo` |
| `electron/main/host-bridge.ts` | 新桥 op `event-summary`（参数与 replay 同语义，无 `limit`） |
| `electron/main/index.ts` | 新 IPC `host:host-event-summary` |
| `electron/preload/index.ts` | 新增 `eventSummary(filter?)`；`replayHostEvents` 签名收窄；`hostEventLogInfo` 返回 `HostEventLogInfo` |
| `resources/mcp/host-server.mjs` | 新工具 `ecclaw_event_summary`（工具数 17 → **18**）+ switch 分支 → `callBridge('event-summary', …)` |
| `src/views/HostEvents.tsx` | 新增「事件汇总」面板（`summary` state + `doSummary()` + 按平台包 / 按类型 / 按天三块渲染）；历史回放提示行补保留策略与占用体积；新增 `formatBytes()` |
| `src/api.ts` | 导出 `HostEventFilter` / `HostEventLogInfo` / `HostEventSummary` |
| `src/App.tsx` | 「已信任站点」标签：session → 「（本次会话）」、persistent → 「（永久）」+ `title` 提示 |
| `README.md` | §5.9 工具数 17 → 18 并补工具名；**新增 §5.15**（事件汇总 + 保留策略）；§8 状态与实测 |
| `task.md` | 新增「第十一阶段」小节（9 项交付 + 4 条实证发现），并更新顶部状态行 |

---

## 3. 契约（记住这几条就够用）

### 3.1 事件汇总

- MCP 工具：`ecclaw_event_summary({sinceSeq?, untilSeq?, sinceAt?, untilAt?, packageId?, pageId?, kind?})`
  → `{dir, total, days[], byPackage[{packageId, count, firstSeq, lastSeq, firstAt, lastAt, kinds{}}], byKind{}, byDay[{day, count}], firstAt, lastAt}`。
- **过滤语义与 `ecclaw_event_replay` 完全共用**（`scanDiskEvents()`，`electron/main/host-events.ts`）——
  改过滤维度只改这一处，不会出现「回放支持、汇总不支持」的语义漂移。
- 桥 op `event-summary`（无 `limit`）；界面「宿主事件」页第三个面板「事件汇总」。
- 无平台包的事件归到 `(无平台包)` 一档，不丢。

### 3.2 落盘保留策略

| 常量 | 值 | 行为 |
|---|---|---|
| `RETAIN_DAYS` | 14 | 启动 `initHostEventLog()` → `sweepDisk()` 删超期文件 |
| `MAX_FILE_BYTES` | 8 MB | 当天最后分片超限 → 新开 `events-DAY.1.jsonl` |
| `MAX_TOTAL_BYTES` | 256 MB | 目录总体积超限 → 从**最老一天**整日删除 |
| `TRIM_CHECK_EVERY` | 200 | 每写 200 条才检查一次总体积 |

- 分片名 `events-YYYY-MM-DD.N.jsonl`，`LOG_FILE_RE = /^events-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.jsonl$/`；
  `listLogFiles()` 按「天 + 分片序号」排序 → 跨分片回放/汇总仍连续有序。
- `event-log-info` → `{dir, days[], total, bytes, retention:{retainDays, maxFileBytes, maxTotalBytes}}`。

---

## 4. 真机验证结果（本次会话跑完，全部可复现）

脚本：`C:/Temp/ecclaw-verify/event-summary-e2e.cjs`（MCP 客户端 + CDP 骨架照抄 `event-replay-e2e.cjs`）
**22/22 全绿**：

| 组 | 断言 | 结果 |
|---|---|---|
| 工具面 | 工具数 = 18、`ecclaw_event_summary` 存在 | ✅ |
| 造事件 | `ecclaw_watch` 启动、`ecclaw_next_event` 取到 ≥3 条 | ✅ |
| 汇总结构 | `total>0`；`byPackage` 含 `ecclaw-observer-demo`；`byKind.observe>0`；`byDay` 含当天；`byPackage` 条目带 kind 细分 | ✅ |
| 汇总过滤 | 按 packageId 只返回该包 / 不存在的包 `total=0` / 按 kind 只返回 observe | ✅ |
| 宿主桥 | op `event-summary` 同形、支持过滤 | ✅ |
| 落盘概况 | `event-log-info` 含 `bytes` 与 `retention`，三个常量值正确，覆盖当天 | ✅ |
| 界面 | 「事件汇总」面板存在；点「汇总」渲染出包名与「按平台包」；历史回放提示含「保留 14 天」 | ✅ |
| 滚动分片 | 当天文件撑过 8MB 后再推事件 → 出现 `events-2026-11-02.1.jsonl` | ✅ |

保留策略第二条单独验：造 `events-2020-01-01.jsonl` → 重启 Electron → 启动即被 `sweepDisk()` 清掉（`SWEPT_OK`）；
重启后再查 `event-log-info`：`total=10` = 主分片 7 + `.1` 分片 3 → **跨分片统计连续**。

构建：`pnpm typecheck` ✓（两段 tsc）· `pnpm build` ✓（renderer 620.74 kB）。

> 验证脚本会把当天的 JSONL 撑成 ~9MB 填充行，**测完已清理**（恢复为 7 条合法事件、2107 字节）；
> `.1` 分片保留（3 条真实事件，是滚动机制的正常产物）。

---

## 5. 环境与基线（当前真机状态）

- **Electron 在跑**（本会话末未关，CDP 9222 占用中；要用请先
  `node C:/Temp/ecclaw-verify/stop-electron.cjs` 或杀干净）。
- 启动命令：`powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"`。
- fixture 在监听：**8897** 写操作页（PID 708952）、**8898** 只读页（PID 654200）。
- settings：`C:/Users/Duanyi/AppData/Roaming/ecclaw/ecclaw-settings.json` → `hostWriteGuard=ask`、
  `hostWriteGuardAllowlist=[]`（干净基线）。
- 端点文件：`C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json`（端口每次随机）。
- MCP 脚本副本：`C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs`
  —— 改 `resources/mcp/host-server.mjs` 后**必须重启 Electron**（复制发生在 `ensureMcpServer()`）。
- 落盘目录：`C:/Users/Duanyi/AppData/Roaming/ecclaw/host-events/`
  （当前 `events-2026-11-02.jsonl` 7 条 + `events-2026-11-02.1.jsonl` 3 条）。
- partition 目录：`C:/Users/Duanyi/AppData/Roaming/ecclaw/Partitions/ecclaw-host/`。

---

## 6. 踩坑与坑位（本次新增）

1. **ctx 160K 硬闸门下 `Read` 被拒 → 整文件 `Write` 也被拒**（Write 要求「先 Read」）→ 同一文件死锁。
   **教训：大改动前先 Read 目标文件，别攒到最后**；批量 Edit 也要留一个 Read 预算。
2. **同 message 内多文件 Edit 可行**（types / host-service / preload / index / host-server 一次全过），
   但**跨会话没 Read 过的文件直接被拒**（`src/views/HostEvents.tsx` 就这么卡住过）。
3. **验证脚本会污染真实日志目录**：8MB 滚动测试直接写在用户数据目录里，测完必须清掉，
   否则 `event-log-info.total` 被虚高、后续回归判断失真。
4. **Electron 实例只占一个 9222 端口**：重启前先杀干净，否则 CDP 指向旧实例。
5. 第十阶段及以前的坑见 `handoff-ecclaw-phase3j-2026-11-02.md` §6。

---

## 7. 下一阶段必交付（按优先级）

1. **真实站点登录态闭环**（需用户本人账号，写操作风险自负）：只读复验淘宝 → 在真实站点上
   走一遍护栏（建议先 `session`）；amazon 已知是 AWS WAF 挑战页，不必重试。
2. **事件落盘后续**：压缩归档（当前只有明文 JSONL）；汇总的时间序列趋势（环比 / 峰值，
   现只有按天计数）；事件导出的对外接口（把某天的 JSONL 交给用户）。
3. **护栏后续**：白名单是否要「精确路径」维度（现在只有 host / domain）；`session` 规则已可视化，
   但缺「查看/清空本次会话规则」的入口。
4. **宿主事件订阅**：agent 侧目前只有长轮询 `ecclaw_next_event`，没有主动推送通道。

---

## 8. 红线（勿违）

- **不重做逆向**（REA 已结案，MCP 只在 E:/RE 项目可见）。
- **不改已定案的平台包协议**（`runtime.cjs` 一律子进程加载）。
- 不删 `C:/Temp/rea-dabi` 与 `C:/Temp/ecclaw-verify`；**禁止删除用户文件**（删前二次确认）。
- 不 git init / commit（本项目不是 git 仓库）。
- `openclaw.json` 含明文 relay key，**勿外传**；relay 对话最小化。
- Electron 内 spawn 内核 / MCP 必须带 `ELECTRON_RUN_AS_NODE=1`。
- 宿主页面 sandbox + contextIsolation + nodeIntegration=false。
- 宿主桥 token 文件勿外传；临时产物写 `C:/Temp/`。
- **GUI 验证走 CDP，不要用 computer-use**。
- 护栏策略默认保持 `ask`；别去掉 partition 的 `persist:` 前缀。

---

## 9. 必读顺序

1. 本文件（`handoff-ecclaw-phase3k-2026-11-02.md`）
2. `docs/ecclaw-事件汇总与落盘保留策略-2026-11-02.md`（本阶段细节与验证表）
3. `handoff-ecclaw-phase3j-2026-11-02.md`（第十阶段：护栏四档 / 事件落盘 / 登录态 partition）
4. `handoff-ecclaw-phase2-2026-11-01.md`（权威背景：整体架构与红线）
5. `task.md` 第十一阶段 + `README.md` §5.14 / §5.15
6. `E:/Users/Duanyi/.claude/projects/F--soft-00selfmade-ecclaw/memory/ecclaw_phase3k_event_summary.md`
   （记忆版契约 + 踩坑）
