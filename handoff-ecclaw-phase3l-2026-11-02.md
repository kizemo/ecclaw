# handoff · ecclaw 第十二阶段（phase3l）· 2026-11-02（收官 · 真机已验 46/46）

> 阶段名：**第十二阶段 / phase3l** —— 事件导出接口 + 信任规则可视化（会话规则查看/清空 + 白名单精确路径维度）
> 前一阶段：`handoff-ecclaw-phase3k-2026-11-02.md`（第十一阶段：事件汇总 + 落盘保留策略）
> 上一轮范围确认：本轮做 handoff §7 的 **§7-2（导出接口）** 与 **§7-3（会话规则查看/清空 + 白名单路径维度）**；
> **§7-1（真实站点登录态闭环）本轮不做**，留到后面（需用户本人账号，风险自负）。
> 附带产出（非代码）：`docs/达比架构分析报告-2026-11-02.md`（非技术语言版架构分析报告）。

---

## 1. 这一阶段做了什么

三块能力 + 一份报告，全部端到端接进「主进程 → 宿主桥 → MCP → IPC → preload → 界面」六层管道。

**① 事件导出（把观察记录拿走）**

回放与汇总都是给 agent 用的；用户自己也常要「把某段时间的观察记录拿走」（发给同事、存档、贴工单）。
之前只有落盘的 JSONL，用户得自己去 `<userData>/host-events/` 翻文件、还得自己按天拼。

- `exportHostEvents(filter, options)` → `{file, count, bytes, format, truncated, dir}`
- 格式：`jsonl`（默认）/ `csv`；CSV 列 `seq,at,kind,packageId,pageId,observationId,value`，RFC4180 转义，`value` 存 JSON 文本
- 过滤：与回放 / 汇总 **完全一致**（三者共用 `scanDiskEvents()`），不会出现「回放能筛、汇总能筛、导出不能筛」
- 单次上限 5 万条，超出 `truncated: true`
- 落点 `<userData>/host-events/exports/ecclaw-events-<YYYYMMDD-HHMMSS>.<ext>`
- 界面「宿主事件」页新增「导出」面板 + 「在文件夹中显示」（`shell.showItemInFolder`）

**② 信任规则可视化（会话规则 / 永久规则分开看 + 分开清）**

第十阶段的「已信任站点」是一条扁平列表：用户设了 `session` 规则看不见，也没法只清 session 而留着永久的。

- `guardRuleGroups(): {session, persistent}` + `clearSessionGuardRules(): number`（只清内存 `sessionRules`）
- 界面「平台包」页拆成两行：「本次会话信任」+「清空本次会话」按钮 /「永久信任」
- **批准写操作后界面自动重拉**（批准可能顺带写入新规则）

**③ 白名单路径维度（第五档信任范围 `persistent-path`）**

- `AllowRule.path?: string`（缺省 = 整站，与第十阶段行为完全一致）
- `ApprovalScope` 加第五档 `persistent-path`：授权时把**当前页面的 pathname** 写进规则
- 三维取**交集**（最严为准）：`host(match) ∧ path ∧ ops`
- 匹配：`pathname === path || pathname.startsWith(path + '/')`

**④ 达比架构分析报告（非技术语言）**

`docs/达比架构分析报告-2026-11-02.md`，9 节：与 OpenClaw 的关系 / 架构比喻 /
在 OpenClaw 之上做的 7 项创新 / 融合的其他软件功能表 / 达比独有 / 逆向工程总体计划 /
已完成任务 / 下阶段任务 / 术语对照表。

---

## 2. 改动清单（全部未 commit —— 本项目不是 git 仓库）

### 主进程

| 文件 | 改动 |
|---|---|
| `electron/shared/types.ts` | `ApprovalScope` 加 `persistent-path`；`AllowRule` 加 `path?`；新增 `GuardRuleGroups` / `HostEventExportFormat` / `HostEventExportOptions` / `HostEventExportResult`；`EcclawApi.host` 加 `guardRuleGroups()` / `clearSessionGuardRules()` / `exportHostEvents()` / `showInFolder()` |
| `electron/main/write-guard.ts` | 新增 `normalizePath` / `rulePath` / `pathOf` / `pathMatches` / `sameRule`；`scopeRule(scope, url?)` 支持 `persistent-path`；`writeGuardAllowlist()` 解析 `path`；`ruleMatches(rule, host, pathname)`；`allowSite()` 支持 `path`；`isSiteAllowed()` 用 pathname；新增 `guardRuleGroups()` / `clearSessionGuardRules()`；`removeGuardRule` 用 `sameRule`；`resolveWriteApproval` 把 url 传给 `scopeRule` |
| `electron/main/host-events.ts` | 新增 `MAX_EXPORT_EVENTS=50000` / `exportDir()` / `csvCell()` / `exportStamp()` / `exportHostEvents(filter, options)` |
| `electron/main/host-service.ts` | 新增 `hostExportEvents()` / `hostGuardRuleGroups()` / `hostClearSessionGuardRules()` |
| `electron/main/host-bridge.ts` | 新增 op `event-export` / `guard-rules` / `guard-rules-clear-session` |
| `electron/main/index.ts` | 新增 IPC `host:host-event-export` / `host:write-guard-rule-groups` / `host:write-guard-clear-session` / `host:show-in-folder` |

### preload / 渲染层

| 文件 | 改动 |
|---|---|
| `electron/preload/index.ts` | 加 4 个方法（`exportHostEvents` / `guardRuleGroups` / `clearSessionGuardRules` / `showInFolder`） |
| `src/api.ts` | 导出新类型 `GuardRuleGroups` / `HostEventExportFormat` / `HostEventExportOptions` / `HostEventExportResult`（跨目录 import 统一走这里） |
| `src/views/HostEvents.tsx` | 「导出」面板：格式下拉 + packageId + 「导出」按钮 + 结果（条数/体积/路径/截断提示）+「在文件夹中显示」 |
| `src/App.tsx` | scope 下拉加 `persistent-path`；信任规则拆两行 +「清空本次会话」；规则标签显示路径前缀；`guardEpoch` 机制（批准后自动重拉） |

### MCP

| 文件 | 改动 |
|---|---|
| `resources/mcp/host-server.mjs` | 新增 3 个工具定义 + 3 个 switch 分支：`ecclaw_event_export` / `ecclaw_guard_rules` / `ecclaw_guard_clear_session`（**MCP 工具 18 → 21**） |

### 文档

| 文件 | 改动 |
|---|---|
| `README.md` | 新增 §5.16「事件导出 + 信任规则可视化 + 白名单路径维度」 |
| `task.md` | 新增「第十二阶段」表格 + 实证发现；顶部状态行更新 |
| `docs/达比架构分析报告-2026-11-02.md` | 新建（非技术语言版架构分析报告） |
| `handoff-ecclaw-phase3l-2026-11-02.md` / `prompt-ecclaw-phase3l-next.md` | 本轮交接两件套 |

### 验证脚手架（`C:/Temp/ecclaw-verify/`，勿删）

- `export-guard-e2e.cjs` —— **新建**，本轮 46 断言
- `fixture-writer.cjs`（8897）/ `fixture-server.cjs`（8898）—— 复用，未改

---

## 3. 契约（记住这几条就够用）

1. **MCP 工具 21 个**：`ecclaw_event_export` / `ecclaw_guard_rules` / `ecclaw_guard_clear_session` 是新增的三个。
2. **导出的过滤语义 = 回放 = 汇总**：三者共用 `scanDiskEvents(filter, cb)`。改过滤逻辑只改那一处。
3. **导出物不受自动淘汰策略影响**：`exports/` 目录名不匹配 `LOG_FILE_RE`，
   所以 `sweepDisk()`（超期清理）与 `trimToSize()`（体积淘汰）都不碰它。
   反过来**也不自动删导出物**（红线：禁止删除用户文件），由用户自己清。
4. **白名单三维度取交集**：`host(match) ∧ path ∧ ops`。path 缺省 = 整站（向后兼容第十阶段行为）。
5. **路径匹配必须带边界**：`pathname === path || pathname.startsWith(path + '/')`。
   只用 `startsWith(path)` 会让 `/foo` 误伤 `/foobar`。
6. **`session` 规则只在内存**：重启即失效；`persistent*` 落 `settings.hostWriteGuardAllowlist`。
   界面必须分组显示，否则用户看不出哪些是临时的。
7. **旧格式白名单字符串数组仍合法**：读的时候按 `{host, match:'domain', ops:'all', ttl:'persistent'}` 解释。

---

## 4. 真机验证结果（本次会话跑完，全部可复现）

脚本：`C:/Temp/ecclaw-verify/export-guard-e2e.cjs` —— **46/46 全绿**。

```
node C:/Temp/ecclaw-verify/export-guard-e2e.cjs \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs" \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json"
```

| 组 | 断言 | 关键证据 |
|---|---|---|
| 工具面 | 4 | 工具数 = 21；三个新工具都在 `tools/list` |
| 造事件 | 2 | `ecclaw_watch` 起持续观察 + `ecclaw_next_event` 取到 3 条增量 |
| 导出 | 11 | JSONL 行数 = 条数（16）且逐行是合法事件对象；CSV 表头 `seq,at,kind,packageId,pageId,observationId,value`、每行 7 列、value 反解回 JSON、引号翻倍转义；导出与汇总按 packageId 过滤条数一致（16=16）；无命中导出 0 条；桥 op `event-export` 同形；导出物不计入落盘 total |
| 信任规则 | 7 | `ecclaw_guard_rules` 返回两组；干净基线两组皆空；桥 op 同形；session 授权后规则出现在 session 组且**不进** permanent 组；`ecclaw_guard_clear_session` 返回清掉条数；清空后 session 空、permanent 不受影响 |
| 路径维度 | 7 | `persistent-path` 弹卡并执行；白名单落盘 `{host:"127.0.0.1", path:"/foo", ops:"all", ttl:"persistent"}`；permanent 组含 path；同路径再点**直接放行**（无卡片）；`/foo/bar` **子路径直接放行**；`/baz` **仍弹卡逐次确认**；换路径规则不消失 |
| 界面 | 9 | 「导出」面板存在；格式下拉 = `jsonl,csv`；点「导出」显示条数与路径；「在文件夹中显示」按钮在；session 授权后「本次会话信任」行**自动出现**；「永久信任」行显示「路径 /foo」；「清空本次会话」按钮在；点它后该行消失且 permanent 仍在 |

其他：
- `pnpm typecheck` ✓（`tsconfig.node.json` + `tsconfig.web.json` 两段 tsc 均 exit 0）
- `pnpm build` ✓（renderer 625.83 kB / preload 5.48 kB / main 147.65 kB）
- 验证结束后 `ecclaw-settings.json` 已还原到干净基线（`hostWriteGuard: "ask"`、`hostWriteGuardAllowlist: []`）

---

## 5. 环境与基线（当前真机状态）

| 项 | 值 |
|---|---|
| 项目根 | `F:\soft\00selfmade\ecclaw`（**不是 git 仓库** —— 禁 git init / commit） |
| 用户数据 | `C:/Users/Duanyi/AppData/Roaming/ecclaw/` |
| 状态根（stateDir） | `C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/` |
| MCP 脚本副本 | `<stateDir>/mcp/host-server.mjs`（**运行期副本**；改 `resources/mcp/host-server.mjs` 后必须重启 Electron） |
| 宿主桥端点 | `<stateDir>/host-bridge.json`（含 token，勿外传） |
| 事件落盘 | `<userData>/host-events/events-YYYY-MM-DD.jsonl`（+ `exports/` 子目录放导出物） |
| 设置 | `<userData>/ecclaw-settings.json`（`hostWriteGuard: ask` / `hostWriteGuardAllowlist: []`） |
| 验证脚手架 | `C:/Temp/ecclaw-verify/`（**勿删**）：`export-guard-e2e.cjs`（本轮）、`event-summary-e2e.cjs`、`event-replay-e2e.cjs`、`scope-e2e.cjs`、`approval-watcher.cjs`、`fixture-writer.cjs`(8897)、`fixture-server.cjs`(8898) |
| fixture 端口 | 8897（写操作验证页，任何路径都返回同一页 → 天然支持路径维度测试）、8898（只读 demo 页） |
| Electron 启动 | `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"`（自带 `--remote-debugging-port=9222`） |

**残留（本会话测试产物，未自动删除）**：`<userData>/host-events/exports/` 下有 7 个导出文件
（3 次跑 × jsonl/csv）。按红线未自动删，留给用户自清。

---

## 6. 踩坑与坑位（本次新增）

1. **规则列表打标签 ≠ 分组**。第十阶段用 `（本次会话）` / `（永久）` 后缀区分，用户看不出哪些是临时的，
   也没法只清临时的。→ 拆两行 + 独立「清空」按钮。
2. **批准动作会改规则 → 界面得在批准后重拉**。`guardGroups` 原本只在组件挂载时拉一次；
   用户在平台包页点「允许并信任本站」后列表不会自己更新（这是本轮实测暴露的真缺陷）。
   → `answer()` 里 `setGuardEpoch(n+1)`，`PackagesView` 的 effect 依赖 `guardEpoch`。
3. **导出物必须躲开自动淘汰**。如果导出文件直接落在 `host-events/` 根目录，
   8MB 单文件上限和 256MB 目录上限会把它删掉 —— 用户主动要的产物被自动清理是不可接受的。
   → 放 `exports/` 子目录，目录名不匹配 `LOG_FILE_RE`。
4. **CSV 的 value 列要存 JSON 文本、且必须整格加引号**。存摘要会丢类型；
   不转义则含逗号的 JSON 直接把列冲散。→ `csvCell()` 按 RFC4180 转义 + `JSON.stringify` 存 value。
5. **路径匹配要带边界**：`/foo` 不该放行 `/foobar`。→ `pathname === path || pathname.startsWith(path + '/')`。
6. **`persistent-path` 在站点根路径授权时要退化成整站**。否则会写下一条永远匹配不上的死规则，
   用户以为已经授权了其实没有。→ `scopeRule` 里 `path` 为空时按整站处理。
7. **验证脚本会污染真实数据目录**。本轮在 `exports/` 留了 7 个文件、`host-events/` 多了一批事件。
   测试结束要还原 `ecclaw-settings.json`（脚本已做），导出文件按红线不自动删。
8. **`ctx-budget-guard` 在 ~160K 会硬拦 Read/Grep/Glob/Bash/WebFetch/Task/Agent**（只放行 Write/Edit）。
   内联 `CTX_GUARD_ALLOW=1` 对 Bash **无效**。撞上就只能写 handoff 后开新会话 —— 本轮前半段正是因此
   差点写不出渲染层，最后靠会话压缩后闸门解除才把 typecheck / build / 真机验证跑完。

---

## 7. 下一阶段必交付（按优先级）

1. **真实站点登录态闭环**（承接 phase3k §7-1，**仍未做**）：需用户本人账号，写操作风险自负。
   建议顺序：淘宝只读复验 → 在真实站点上用 `session` 档走一遍护栏（不落盘）。
   amazon 已知是 AWS WAF 挑战页，不必重试。
2. **事件落盘后续**（承接 phase3k §7-2 未做完的部分）：
   - 压缩归档（当前只有明文 JSONL）
   - 汇总的时间序列趋势（环比 / 峰值，现只有按天计数）
   - 导出格式再加 `csv` 之外的形态（如 HTML 表格 / Excel xlsx，按需）
3. **宿主事件订阅**（承接 phase3k §7-4）：agent 侧目前只有长轮询 `ecclaw_next_event`，没有主动推送通道。
   可考虑 WebSocket / SSE 桥，或让 MCP 服务侧持一条长轮询循环。
4. **护栏收尾**：`persistent-path` 目前只在授权时记当前 pathname，
   还没有「按站点批量列出所有路径规则 / 按路径粒度移除」的界面（移除按钮是整条规则粒度）。

---

## 8. 红线（勿违）

- **不重做逆向**（REA 已结案，MCP 只在 E:/RE 项目可见）。
- **不改已定案的平台包协议**（`runtime.cjs` 一律子进程加载）。
- 不删 `C:/Temp/rea-dabi` 与 `C:/Temp/ecclaw-verify`；**禁止删除用户文件**（删前二次确认）。
  → 本轮 `exports/` 下的测试产物就是因此保留的。
- 不 git init / commit（本项目不是 git 仓库）。
- `openclaw.json` 含明文 relay key，**勿外传**；relay 对话最小化。
- Electron 内 spawn 内核 / MCP 必须带 `ELECTRON_RUN_AS_NODE=1`。
- 宿主页面 sandbox + contextIsolation + nodeIntegration=false。
- 宿主桥 token 文件勿外传；临时产物写 `C:/Temp/`。
- **GUI 验证走 CDP，不要用 computer-use**（Electron 截屏全黑）。
- 护栏策略默认保持 `ask`；别去掉 partition 的 `persist:` 前缀。

---

## 9. 必读顺序

1. 本文件（`handoff-ecclaw-phase3l-2026-11-02.md`）
2. `README.md` §5.16（新能力说明）
3. `task.md` 第十二阶段（交付表 + 实证发现）
4. `handoff-ecclaw-phase3k-2026-11-02.md`（第十一阶段：事件汇总 + 保留策略）
5. `handoff-ecclaw-phase3j-2026-11-02.md`（第十阶段：护栏四档 / 事件落盘 / 登录态 partition）
6. `handoff-ecclaw-phase2-2026-11-01.md`（权威背景：整体架构与红线）
7. `docs/达比架构分析报告-2026-11-02.md`（对外可讲的架构叙事）
8. `E:/Users/Duanyi/.claude/projects/F--soft-00selfmade-ecclaw/memory/ecclaw_phase3l_export_guard.md`
   （记忆版契约 + 踩坑）
