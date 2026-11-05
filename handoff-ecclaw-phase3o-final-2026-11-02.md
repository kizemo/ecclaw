# handoff · ecclaw 第十四阶段（phase3o）· **收官** · 2026-11-02

> 阶段名：**第十四阶段 / phase3o** —— 事件 seq 空间遗留问题 + 导出物清理入口 + 趋势图可视化
> 上一阶段：`handoff-ecclaw-phase3n-2026-11-02.md`（项目完整背景入口，六层架构 / 红线 / 踩坑清单全在里面）
> 实施细节：`handoff-ecclaw-phase3o-2026-11-02.md`（代码已就位、真机 e2e 待跑那一份）
> 本文件是**收官交接**：本阶段 ①②③ 全部完成并真机验证通过。

---

## 1. 状态速览

| 项 | 值 |
|---|---|
| 阶段 | 第十四阶段 ① ② ③ **全部完成** + **真机 e2e 已跑** |
| MCP 工具数 | 23 → **24**（新增 `ecclaw_export_list`） |
| typecheck | ✅ `pnpm typecheck` 绿（两段 tsc 均 exit 0） |
| build | ✅ `pnpm build` 绿（preload 5.81 kB / renderer 635.63 kB） |
| 真机验证 | ✅ `phase3o-e2e.cjs` **44/44**；回归 `phase3m-e2e.cjs` **69/69** + `sse-e2e.cjs` **14/14** |
| 文档 | ✅ README §5.18 / task.md 第十四阶段 / memory `ecclaw_phase3o_seq_export_chart.md` + 索引 |
| 本会话改动 | 主进程 3 处（契约对齐）+ 共享类型 + preload + 渲染层 + MCP（上一会话已写完）+ **文档全套** |

---

## 2. 本阶段三块交付

### 2.1 ① 事件 seq 全局单调（跨重启续号 + 回放按 seq 升序）

**问题**：`seq` 原来是运行时计数器，Electron 重启归零 → 落盘里存在多个 seq 空间
（同一批文件里既有 1..N 又有 1..M）；`ecclaw_event_replay` 的区间过滤跨文件不可靠；
注释写「结果按 seq 升序返回」，实现却是**按文件序**返回。

**解法（两处一起改，缺一不可）**：

| 改动 | 位置 | 说明 |
|---|---|---|
| 启动续号 | `host-events.ts` `maxSeqOnDisk()` + `initHostEventLog()` | 扫全部落盘文件（`.gz` 走 `readLog` 解压），行首正则 `{"seq":N` 取最大值（失败行退回 `JSON.parse`）；`seq = Math.max(seq, maxSeqOnDisk())`；在 `index.ts` 的 `app.whenReady()` 里、注册 IPC 之前调用 |
| 回放 / 导出排序 | `class SeqSelector`（大根堆） | 全量扫盘、只保留 **seq 最小的前 N 条**（内存 O(N)）；`replayHostEvents` 用 `SeqSelector(limit≤2000)` → 结果 sort 后返回；`exportHostEvents` 用 `SeqSelector(50000)` + 另计 `matched`（超限 `truncated=true`） |
| 不提前停 | `scanDiskEvents` 回调 `(e)=>boolean` → `(e)=>void` | 文件序 ≠ seq 序，扫到"够了"就停会漏掉 seq 更小的那批；三个调用点全改 |

**遗留（别当 bug 修）**：

- 旧日志里已存在的多个 seq 空间**保持原样**（不改写历史文件）。新事件一律大于所有历史 seq，
  所以「拿 seq 当游标」从现在起跨重启可靠。
- 落盘里有 phase3m 的验证夹具 `events-2026-09-18.jsonl.gz`（8 条，seq 900001+）→
  **续号起点被顶到 900009**。e2e 断言一律「相对落盘最大值」，**不要写死 seq 基线**。
- 落盘里存在**重复 seq** → 「按 seq 升序」的断言口径是**非递减**（`seq[i] <= seq[i+1]`），
  不是严格递增；只有新 seq 空间内才严格递增。
- `SeqSelector` 的口径是「seq 最小的前 N 条」，**不是「最新 N 条」** —— `limit` 小的时候拿到的是最老的事件
  （与旧的「按文件序取前 N」一致）；要拿最新必须自己带 `sinceSeq`。

### 2.2 ② 导出物清理入口（界面逐个删 + agent 只列不删）

| 层 | 文件 | 改动 |
|---|---|---|
| 主进程 | `electron/main/host-events.ts` | `listHostEventExports()` / `removeHostEventExport(name)`；`hostEventExportDir()`；`EXPORT_FILE_RE = /^ecclaw-events-\d{8}-\d{6}\.(jsonl\|csv)$/` |
| 主进程 | `electron/main/host-service.ts` | `hostEventExports()` → **`{dir, files[]}`**；`hostRemoveEventExport(name)` |
| 主进程 | `electron/main/index.ts` | IPC `host:event-exports`（**返回 `.files` 数组**给界面）/ `host:event-export-remove` |
| 宿主桥 | `electron/main/host-bridge.ts` | op `event-exports` —— **只有列，没有删**（agent 想删也走不通） |
| MCP | `resources/mcp/host-server.mjs` | 新工具 `ecclaw_export_list`（无参数）→ 工具数 **23 → 24** |
| preload | `electron/preload/index.ts` | `listEventExports()` / `removeEventExport(name)` |
| 渲染层 | `src/views/HostEvents.tsx` | 「导出物（自己清理）」面板：逐个列出（文件名 / 体积 / 修改时间）+ **两段式删除**（先点「删除」变「确认删除？」，再点才真删） |
| 类型 | `electron/shared/types.ts` + `src/api.ts` | `HostEventExportFile` 接口 + `EcclawApi.host.listEventExports/removeEventExport` |

**红线实现方式（改这块前必看）**：

- `removeHostEventExport` 只接受 `EXPORT_FILE_RE` 认得的**精确文件名** → 通配符 / 批量 / 路径穿越全部无效；
- 额外校验 `path.dirname(path.resolve(file)) === path.resolve(exportDir())`（双保险）；
- **程序任何路径都不自动删导出物**（`sweepDisk` / `trimToSize` 不碰 `exports/`）；
- MCP 侧**只列不删** —— 删除权留在人手上。

### 2.3 ③ 趋势图（零依赖 SVG）

`src/views/HostEvents.tsx` 新增 `function TrendChart({points})`：

- `viewBox="0 0 760 190"`、`width="100%"`；
- 每桶一根 `<rect class="trend-bar">`，高度按 `count / max` 缩放；
- **峰值桶**加 `peak` class（橙色 `#ffb020`），其余蓝色 `#4c8dff`；
- 每根柱挂 `<title>`（hover 原生提示：`时间 · N 条`）；
- y 轴 3 条刻度线（0 / max/2 / max）+ 刻度值；x 轴标签抽稀（最多 6 个 + 最后一个）；
- `data-testid="trend-bar-{i}"` / `data-count` / `data-start` 便于 e2e 断言；
- 样式在 `src/styles.css`（`.trend-chart` / `.trend-bar` / `.trend-bar.peak`）；
- 原有文字列表**保留**（图表在上、列表在下）。

---

## 3. 验证证据（本会话实跑）

| 套件 | 结果 | 关键断言 |
|---|---|---|
| `C:/Temp/ecclaw-verify/phase3o-e2e.cjs`（新建，44 断言） | **44/44** | 工具数 24；`ecclaw_export_list` 已注册且无参数、agent 侧无导出物删除工具；落盘全量回放**非递减**；seqA=900009 →（重启 Electron）→ seqB=900010（**续号，不归零**）；重启后回放仍升序、新空间内严格递增；`sinceSeq` / `untilSeq` 过滤可靠；导出物清单 `{dir, files}`、14 个历史文件一个不少、只删本轮自己造的那一个；负例：桥上无 `event-export-remove` op、`*` / `*.jsonl` / `../events-2026-11-02.jsonl` / 不存在名字**全部 false**；界面**两段式**（第一次点只变文案、文件仍在，第二次点才真删）；趋势图 46 根柱，柱子数 / `data-count` / `data-start` 与 MCP 汇总**逐一相等** |
| `phase3m-e2e.cjs`（回归，工具数断言 23 → 24） | **69/69** | 压缩归档 / 趋势 / 护栏粒度 / 界面全绿 |
| `sse-e2e.cjs`（回归，工具数断言 23 → 24） | **14/14** | SSE 端点 + `source=push` 取件 + 空取件不挂住 |
| `pnpm typecheck` | ✅ | 两段 tsc exit 0 |
| `pnpm build` | ✅ | preload 5.81 kB / renderer 635.63 kB |

> e2e 里做了**一次真实重启**（`stop-electron.cjs` 正常关闭 → `start-electron.ps1` 重启），
> 用来验证续号；重启后桥端口与 token 全变（MCP 服务每次调用都重读 `host-bridge.json`，不用重启 MCP 进程）。

---

## 4. 本会话改动清单（**全部未 commit —— 项目非 git 仓库**）

| 文件 | 改动 |
|---|---|
| `electron/main/host-events.ts` | `SeqSelector`（大根堆）；`scanDiskEvents` 回调改 `(e)=>void`；`replayHostEvents` / `exportHostEvents` 按 seq 升序；`maxSeqOnDisk()`；`initHostEventLog()` 续号；`listHostEventExports()` / `removeHostEventExport()` / `hostEventExportDir()`；`EXPORT_FILE_RE` |
| `electron/shared/types.ts` | `HostEventExportFile`；`EcclawApi.host.listEventExports/removeEventExport` |
| `electron/main/host-service.ts` | `hostEventExports()`（→ `{dir, files}`）/ `hostRemoveEventExport()` |
| `electron/main/index.ts` | IPC `host:event-exports` / `host:event-export-remove`；`initHostEventLog()` 调用位置 |
| `electron/main/host-bridge.ts` | op `event-exports`（只列） |
| `electron/preload/index.ts` | `listEventExports()` / `removeEventExport(name)` |
| `src/api.ts` | 导出 `HostEventExportFile` 类型 |
| `src/views/HostEvents.tsx` | `TrendChart` 组件；导出物面板（列出 + 两段式删除）；汇总后刷新导出物清单 |
| `src/styles.css` | `.trend-chart` / `.trend-bar` / `.trend-bar.peak` |
| `resources/mcp/host-server.mjs` | 新工具 `ecclaw_export_list`（23 → 24） |
| `README.md` | 新增 **§5.18**；§8 状态与实测数字同步 |
| `task.md` | 顶部状态段 + **第十四阶段**表格 + 8 条实证发现 |
| `memory/ecclaw_phase3o_seq_export_chart.md` + `MEMORY.md` | 项目记忆 + 索引一条 |

**本会话额外修的一处契约不一致**：`ecclaw_export_list` 的工具说明写「返回 `{dir, files[]}`」，
实现却直接返回数组 → 桥 op 现在返回 `{dir, files}`（界面那条 IPC 仍返回数组给 `HostEventExportFile[]`）。

**验证脚手架改动**（`C:/Temp/ecclaw-verify/`，**勿删**）：
`phase3o-e2e.cjs`（新建）；`phase3m-e2e.cjs` / `sse-e2e.cjs` 的工具数断言 23 → 24。

---

## 5. 环境与路径

| 项 | 值 |
|---|---|
| 项目根 | `F:\soft\00selfmade\ecclaw`（**非 git 仓库**，禁 git init/commit） |
| 用户数据 | `C:/Users/Duanyi/AppData/Roaming/ecclaw/` |
| stateDir | `<userData>/openclaw/.openclaw/` |
| MCP 运行期副本 | `<stateDir>/mcp/host-server.mjs`（**重启 Electron 自动同步**，别手动拷） |
| 桥端点 | `<stateDir>/host-bridge.json`（含 token，**勿外传**；每次重启端口与 token 都变） |
| 事件落盘 | `<userData>/host-events/events-YYYY-MM-DD[.N].jsonl[.gz]` + `exports/` |
| 导出物 | `<userData>/host-events/exports/ecclaw-events-YYYYMMDD-HHMMSS.{jsonl,csv}`（**现存 15 个，一条都不许删**；回归脚本每跑一次会新增 1 个，属正常） |
| 脚手架 | `C:/Temp/ecclaw-verify/`（**勿删**） |
| 起 Electron | `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"` |
| 关 Electron | `node C:/Temp/ecclaw-verify/stop-electron.cjs`（正常关闭，保住 cookie） |
| GUI 验证 | **必须走 CDP**（`--remote-debugging-port=9222`），不要用 computer-use（对 Electron 截屏全黑） |
| 造事件的夹具 | 内置示例包 `ecclaw-observer-demo` / 页面 `builtin:ecclaw-observer-demo-poll`；本地验证页 `http://127.0.0.1:8898/demo`（8898 / 8897 两个本地 fixture server 都在跑） |

---

## 6. 红线（照旧，别踩）

- **禁删用户文件**：`<userData>/host-events/exports/` 里 **15 个导出物（14 个历史 + 回归脚本每次新增 1 个）一条都不许删**；
  本阶段新增的删除功能也只允许「用户明确点了确认」后删**那一个**文件。
  通用铁律见 `E:\Users\Duanyi\.claude\CLAUDE.md` §A（`no-delete-gate.py` 强制）。
- 禁 `git init` / `git commit`（项目非 git 仓库）。
- `openclaw.json`（含明文 relay key）与 `host-bridge.json`（含 token）**勿外传**。
- Electron 内 spawn 内核 / MCP 必须带 `ELECTRON_RUN_AS_NODE=1`。
- 护栏策略默认保持 `ask`；**别去掉 partition 的 `persist:` 前缀**。
- **真实站点只用 `scroll` 做写操作验证**（淘宝点一下可能下单）。
- 临时产物写 `C:\Temp\`（或 `%TEMP%`）。
- 记忆文件写 `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\`；
  **handoff / task 文档不得放进 memory 文件夹**。

---

## 7. 踩坑清单（本阶段实证）

1. **seq 断言不能写死基线**：落盘里有夹具（seq 900001+），续号起点被顶到 900009 → 断言一律「相对落盘最大值」。
2. **回放不能提前停扫盘**：文件序 ≠ seq 序，提前停会漏 → `scanDiskEvents` 回调改成 `(e)=>void`。
3. **`SeqSelector` 取的是「seq 最小的前 N 条」不是「最新 N 条」** —— 要最新就带 `sinceSeq`。
4. **落盘有重复 seq** → 升序断言口径是**非递减**，不是严格递增。
5. **别手改 `<stateDir>/mcp/host-server.mjs`**：重启 Electron 会自动覆盖（`ensureMcpServer` → `copyFileSync`）。
6. **导出物删除的负例要测**：通配符（`*.jsonl`）、路径穿越（`../events-x.jsonl`）、不存在名字必须全 `false`。
7. **界面删除是两段式**：第一次点只把按钮文案变成「确认删除？」，**文件不动** —— e2e 要断言这一点。
8. **重启后桥端口与 token 全变**：MCP 服务每次调用都重读 `host-bridge.json`（不用重启 MCP 进程），
   但 e2e 要等端口变化再断言。
9. **重启后宿主没有页面**：先 `ecclaw_open_page` 再起 `ecclaw_watch`，否则观察事件起不来。
10. **bash 传中文参数被 locale 破坏** → JS 表达式里的中文报 `SyntaxError`；办法：写 `.cjs` 文件再跑。
11. **GUI 验证走 CDP**，不要用 computer-use（Electron 截屏全黑）。
12. **强杀 Electron 会丢 cookie** → 收尾一律 `stop-electron.cjs`。

---

## 8. 下一阶段候选（还没定，等用户拍板）

1. **导出物批量策略**：目前只能逐个删。可以加「只保留最近 N 个」之类，但**必须**是用户明确点确认才执行。
2. **历史 seq 空间归一**：把旧文件里重复 seq 的事件重编号（会**改写历史文件**，红线慎碰）。
3. **事件订阅游标**：给 agent 一个明确的「从某时刻起的新事件」入口（现在要自己算 `sinceSeq`）。
4. **第二阶段外壳候选**（邮件 worker / PDF 预览 / OCR / 店铺登录态 profile 等，见 README §8）。

---

## 9. 记忆索引（`E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\`）

| 文件 | 内容 |
|---|---|
| `MEMORY.md` | 索引 |
| `ecclaw_tech_constraints.md` | openclaw schema 硬约束、spawn 内核要 ELECTRON_RUN_AS_NODE、runtime.cjs 契约、MCP 接法 |
| `ecclaw_phase3_provider.md` | aliyun-maas relay 模型白名单、agent CLI 直跑配方、agent --json 真实信封 |
| `ecclaw_host_contract.md` | dabi context 15 字段、observe 三模式与 ack 缓冲、宿主 MCP 桥、写操作两路径 |
| `feedback_gui_verify_cdp.md` | GUI 验证走 CDP 而非 computer-use；超时自动选项 ≠ 批准 |
| `ecclaw_phase3i_guard_poll.md` | 两段式票据/状态机、站点白名单、事件总线与长轮询 |
| `ecclaw_phase3j_guard_scope.md` | 四档 scope、白名单 match×ops×ttl、ecclaw_event_replay、persist partition |
| `ecclaw_phase3k_event_summary.md` | ecclaw_event_summary、8MB 分片 + 256MB 上限、ctx 硬闸门与验证污染坑 |
| `ecclaw_phase3l_export_guard.md` | 导出/规则工具、白名单 path 维、批准后界面必须重拉 |
| `ecclaw_phase3m_archive_trend_push.md` | 先压后删、趋势补空桶/UTC 桶键、ecclaw_guard_remove、SSE 取件覆盖判据 |
| `ecclaw_phase3n_taobao_closedloop.md` | persist cookie 留存 + session 档信任实证；护栏卡不弹两大根因 |
| `ecclaw_phase3o_seq_export_chart.md` | **本阶段**：启动续号 + SeqSelector 口径、导出物精确名 + 两段式、趋势图、续号被夹具顶高 |
