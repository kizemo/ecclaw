# handoff · ecclaw 第十四阶段（phase3o）· 2026-11-02（**代码已就位 · 真机 e2e 待跑**）

> 阶段名：**第十四阶段 / phase3o** —— 事件 seq 空间遗留问题 + 导出物清理入口 + 趋势图可视化
> 上一阶段：`handoff-ecclaw-phase3n-2026-11-02.md`（项目完整背景入口，六层架构 / 红线 / 踩坑清单全在里面）
> 本文件是**接力入口**：接手后从 §5「剩余必交付」开始做，**不要重写代码**。

---

## 1. 状态速览

| 项 | 值 |
|---|---|
| 阶段 | 第十四阶段 ① ② ③ **代码全部完成**；**真机 e2e 未跑**、Electron 未用新代码重启过 |
| MCP 工具数 | 23 → **24**（新增 `ecclaw_export_list`） |
| typecheck | ✅ `pnpm typecheck` 绿（两段 tsc 均 exit 0） |
| build | ✅ `pnpm build` 绿（renderer 635.63 kB / preload 5.81 kB） |
| 真机验证 | ❌ **未跑** —— 这是下一会话的第一件事 |
| 本会话改动 | 主进程 + 共享类型 + preload + 渲染层 + MCP，**无文档改动**（README/task/memory/handoff 本文件是下一会话补的） |

---

## 2. 范围确认（AskUserQuestion 已确认）

用户明确「本阶段 3 项候选任务全做」，并确认了两个技术路线：

| 决策点 | 选定方案 |
|---|---|
| ① seq 修复路线 | **落盘续号 + 回放按 seq 排序**（不改成时间戳基准、不加 gseq 字段） |
| ② 导出物清理范围 | **界面逐个删 + agent 只列不删**（MCP 侧只有 `ecclaw_export_list`，没有删除工具） |

---

## 3. ① 事件 seq 空间遗留问题（已实现）

### 3.1 问题

`seq` 原来是**运行时计数器**（`host-events.ts` 的 `let seq = 0`），Electron 重启归零 →
落盘里存在**多个 seq 空间**（同一文件可能先写 1..N 再写 1..M），导致：

- `ecclaw_event_replay({sinceSeq/untilSeq})` 的区间过滤跨文件不可靠；
- 注释写「结果按 seq 升序返回」，实现却是 `scanDiskEvents` **按文件序**返回 —— 注释与实现不符；
- agent 拿 seq 当游标跨重启会漏事件或重放。

### 3.2 解法（两处一起改，缺一不可）

**(a) 启动时续号 → seq 全局单调**

`electron/main/host-events.ts` 新增 `maxSeqOnDisk()`：扫全部落盘文件（`.gz` 走 `readLog` 解压），
按行首 `{"seq":N` 正则取最大值（行首匹配是因为 `pushHostEvent` 里 `seq` 是第一个字段）；
拿不到的行再退回 `JSON.parse` 兜底。

`initHostEventLog()` 末尾加一行：

```ts
seq = Math.max(seq, maxSeqOnDisk())
```

`initHostEventLog()` 在 `electron/main/index.ts` 的 `app.whenReady()` 里、注册 IPC 之前调用 —— 早于任何事件产生。

> 代价：启动时要读一遍落盘目录（最坏 256MB）。`sweepDisk()` / `compressOldLogs()` 本来就在启动时读一遍，
> 量级相同，可接受。

**(b) 回放 / 导出改为「按 seq 升序」**

新增 `class SeqSelector`（大根堆）：扫完全部文件，只保留 **seq 最小的前 N 条**，内存有界 O(N)。
- `replayHostEvents()`：`new SeqSelector(limit)`（limit ≤ 2000），结果 `sort` 后返回 → **保证 seq 升序**。
- `exportHostEvents()`：同样用 `SeqSelector(MAX_EXPORT_EVENTS=50000)`，
  另计 `matched` 总数，`matched > MAX` 时 `truncated = true`（语义不变，只是「取前 5 万条」的
  口径从「文件序前 5 万」变成「seq 最小的 5 万」）。
- `scanDiskEvents()` 的回调签名从 `(e) => boolean` 改成 `(e) => void`：**不再有「够了就停」** ——
  文件序 ≠ seq 序，提前停会漏掉 seq 更小的那批。三个调用点（replay / summary / export）都已改。

### 3.3 遗留说明（写给下一会话，别当 bug 修）

- **旧日志里已存在的多个 seq 空间保持原样**（不改写历史文件）。新事件一律大于所有历史 seq，
  所以「拿 seq 当游标」从现在起跨重启可靠。
- 旧文件的高 seq（例如验证夹具的 900001+）与新事件的低 seq 在**全局排序上会交错** ——
  这是历史遗留的必然，不是 bug。
- **本机落盘目录里有上一阶段的验证夹具** `events-<45天前>.jsonl`（seq 900001+，8 条）——
  它把续号起点顶到了 900009。**e2e 断言不要写死 seq 基线**，要「相对落盘最大值」地断言。
  按红线该夹具不自动删（task.md 第十三阶段实证发现 #6 已记录）。

---

## 4. ② 导出物清理入口 + ③ 趋势图（已实现）

### 4.1 ② 导出物清理（六层）

| 层 | 文件 | 改动 |
|---|---|---|
| 主进程 | `electron/main/host-events.ts` | `listHostEventExports()` / `removeHostEventExport(name)`；常量 `EXPORT_FILE_RE = /^ecclaw-events-\d{8}-\d{6}\.(jsonl\|csv)$/` |
| 主进程 | `electron/main/host-service.ts` | `hostEventExports()` / `hostRemoveEventExport(name)` |
| 主进程 | `electron/main/index.ts` | IPC `host:event-exports` / `host:event-export-remove` |
| 宿主桥 | `electron/main/host-bridge.ts` | op `event-exports`（**只有列，没有删**） |
| MCP | `resources/mcp/host-server.mjs` | 新工具 `ecclaw_export_list` → 工具数 **23 → 24** |
| preload | `electron/preload/index.ts` | `listEventExports()` / `removeEventExport(name)` |
| 渲染层 | `src/views/HostEvents.tsx` | 新「导出物（自己清理）」面板：逐个列出（文件名 / 体积 / 修改时间）+ **两段式删除**（先点「删除」变「确认删除？」，再点才真删） |
| 类型 | `electron/shared/types.ts` + `src/api.ts` | `HostEventExportFile` 接口 + `EcclawApi.host.listEventExports/removeEventExport` |

**红线实现方式（改这块前必看）**：
- `removeHostEventExport` 只接受 `EXPORT_FILE_RE` 认得的**精确文件名** → 通配符 / 批量 / 路径穿越全部无效；
- 额外校验 `path.dirname(path.resolve(file)) === path.resolve(exportDir())`（双保险）；
- **程序任何路径都不自动删导出物**（`sweepDisk` / `trimToSize` 本来就不碰 `exports/`，这次也没加自动清理）；
- MCP 侧**只列不删** —— 删除权留在人手上。

### 4.2 ③ 趋势图（零依赖 SVG）

`src/views/HostEvents.tsx` 新增 `function TrendChart({points})`：
- `viewBox="0 0 760 190"`，`width="100%"`；
- 每桶一根 `<rect class="trend-bar">`，高度按 `count / max` 缩放；
- **峰值桶**加 `peak` class（橙色 `#ffb020`），其余蓝色 `#4c8dff`；
- 每根柱挂 `<title>`（hover 原生提示：`时间 · N 条`）；
- y 轴 3 条刻度线（0 / max/2 / max）+ 刻度值；x 轴标签抽稀（最多 6 个 + 最后一个）；
- `data-testid="trend-bar-{i}"` / `data-count` / `data-start` 便于 e2e 断言。

样式加在 `src/styles.css`（`.trend-chart` / `.trend-bar` / `.trend-bar.peak`）。
原有文字列表**保留**（图表在上、列表在下）。

---

## 5. 剩余必交付（下一会话按此顺序做）

### 5.1 ⬜ 同步 MCP 运行期副本 + 重启 Electron

```bash
# 1) 看当前 Electron 是否在跑
curl -s http://127.0.0.1:9222/json/list | head -5

# 2) 正常关闭（**必须正常关闭，强杀丢 cookie**）
node C:/Temp/ecclaw-verify/stop-electron.cjs

# 3) 重启（自带 --remote-debugging-port=9222；启动时会自动把
#    resources/mcp/host-server.mjs 复制到 <stateDir>/mcp/host-server.mjs）
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"
```

> MCP 运行期副本路径：`<stateDir>/mcp/host-server.mjs`；
> `electron/main/mcp-bridge.ts` 的 `ensureMcpServer()` 每次启动都会 `copyFileSync` 覆盖它 →
> **重启 Electron 就等于同步了**，别手动拷。

### 5.2 ⬜ 写并跑真机 e2e（`C:/Temp/ecclaw-verify/phase3o-e2e.cjs`）

**骨架照抄 `phase3m-e2e.cjs`**（MCP 客户端 + 桥 RPC + CDP 驱动 + 断言表，498 行 / 69 断言），
**别删已有脚手架**。建议断言：

**① seq 全局单调 + 回放升序**
- `tools/list` 工具数 = **24**，`ecclaw_export_list` 在列表里
- 造事件（`ecclaw_run_observe` 打 fixture，或 `ecclaw_watch` + `ecclaw_next_event`）→ 记 `seqA`
- **重启 Electron**（e2e 里用 `child_process` 调 `stop-electron.cjs` + `start-electron.ps1`，
  或拆成两轮由会话手动重启）→ 再造事件 → 记 `seqB`
- 断言 **`seqB > seqA`**（续号生效；旧行为会 `seqB` 归零后从 1 重来）
- 断言 `seqB > 落盘最大 seq`（= `ecclaw_event_replay` 全量取回后 `Math.max(...seq)`）
- 断言 `ecclaw_event_replay` 返回数组**按 seq 严格升序**（相邻 `seq[i] < seq[i+1]`）
- 断言 `ecclaw_event_replay({sinceSeq: X})` 过滤可靠：所有返回项 `seq > X`

**② 导出物清理**
- `ecclaw_export_list` 返回 `{dir, files[]}`，每项含 `name/file/bytes/modifiedAt`
- **现存 7 个历史导出物一条都不许删** —— 断言列表里能看到它们，且数量 ≥ 7（跑测试前后数量不变）
- 本轮自己造一个导出（`ecclaw_event_export`）→ 列表里多一条 → **只删这一条**（按 name 精确删）
- 删完再列 → 少了那一条，其余（尤其 7 个历史文件）**一条不少**
- 负例：`ecclaw_export_list` 之外**不存在**删除通道（MCP `tools/list` 里没有 remove 类工具）；
  界面删按钮是**两段式**（第一次点击只变文案，不删文件）

**③ 趋势图**
- CDP 进「宿主事件」页 → 汇总 → 趋势区块存在 `<svg class="trend-chart">`
- `rect.trend-bar` 的数量 == `summary.trend.points.length`
- 峰值柱带 `peak` class（`rect.trend-bar.peak` 数量 ≥ 1）
- 每根柱有 `<title>`（hover 提示）

**回归**
- `phase3m-e2e.cjs` **69/69** + `sse-e2e.cjs` **14/14** 全绿
  （注意：`phase3m-e2e.cjs` 里断言的 MCP 工具数要从 23 改成 **24**）
- `pnpm typecheck` + `pnpm build` 仍过

### 5.3 ⬜ 补文档（本会话没做）

- `README.md` 新增 **§5.18**（第十四阶段三块：seq 全局单调 / 导出物清理入口 / 趋势图）
- `task.md`：顶部状态段 + 新增「第十四阶段」表格 + 实证发现
  （至少记这几条：seq 续号让续号起点被夹具顶到 900009；回放必须全量扫盘才能保证升序；
  导出物删除必须精确文件名 + 二次确认；agent 只列不删）
- `memory/ecclaw_phase3o_seq_export_chart.md` + `MEMORY.md` 索引一条
- 收官写 `handoff-ecclaw-phase3o-final-2026-11-02.md` + `prompt-ecclaw-phase3o-next.md`

---

## 6. 环境与路径

| 项 | 值 |
|---|---|
| 项目根 | `F:\soft\00selfmade\ecclaw`（**非 git 仓库**，禁 git init/commit） |
| 用户数据 | `C:/Users/Duanyi/AppData/Roaming/ecclaw/` |
| stateDir | `<userData>/openclaw/.openclaw/` |
| MCP 运行期副本 | `<stateDir>/mcp/host-server.mjs`（重启 Electron 自动同步） |
| 桥端点 | `<stateDir>/host-bridge.json`（含 token，**勿外传**） |
| 事件落盘 | `<userData>/host-events/events-YYYY-MM-DD[.N].jsonl[.gz]` + `exports/` |
| 导出物 | `<userData>/host-events/exports/ecclaw-events-YYYYMMDD-HHMMSS.{jsonl,csv}`（**现存 7 个历史文件，一条都不许删**） |
| 脚手架 | `C:/Temp/ecclaw-verify/`（**勿删**） |
| 起 Electron | `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"` |
| 关 Electron | `node C:/Temp/ecclaw-verify/stop-electron.cjs`（正常关闭，保住 cookie） |
| GUI 验证 | **必须走 CDP**（`--remote-debugging-port=9222`），不要用 computer-use（对 Electron 截屏全黑） |

---

## 7. 本会话改动清单（全部未 commit —— 项目非 git 仓库）

| 文件 | 改动 |
|---|---|
| `electron/main/host-events.ts` | `SeqSelector`（大根堆）；`scanDiskEvents` 回调改 `(e)=>void`（不再提前停）；`replayHostEvents` / `exportHostEvents` 改按 seq 升序；`maxSeqOnDisk()`；`initHostEventLog()` 续号；`listHostEventExports()` / `removeHostEventExport()`；`EXPORT_FILE_RE` |
| `electron/shared/types.ts` | 新增 `HostEventExportFile`；`EcclawApi.host` 加 `listEventExports` / `removeEventExport` |
| `electron/main/host-service.ts` | `hostEventExports()` / `hostRemoveEventExport()` |
| `electron/main/index.ts` | IPC `host:event-exports` / `host:event-export-remove` |
| `electron/main/host-bridge.ts` | op `event-exports`（只列） |
| `electron/preload/index.ts` | `listEventExports()` / `removeEventExport(name)` |
| `src/api.ts` | 导出 `HostEventExportFile` 类型 |
| `src/views/HostEvents.tsx` | `TrendChart` 组件；导出物面板（列出 + 两段式删除）；汇总后刷新导出物清单 |
| `src/styles.css` | `.trend-chart` / `.trend-bar` / `.trend-bar.peak` |
| `resources/mcp/host-server.mjs` | 新工具 `ecclaw_export_list`（23 → 24） |

---

## 8. 红线（照旧，别踩）

- **禁删用户文件**：`<userData>/host-events/exports/` 里 7 个历史导出物**一条都不许删**；
  本阶段新增的删除功能也只允许「用户明确点了确认」后删**那一个**文件。
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

## 9. 踩坑清单

1. **ctx 硬闸门（160K）在本会话尾部触发**：Bash 与 Read 双双被拦，只剩 Write/Edit 可用 →
   代码写完了但**没来得及跑 e2e**。下一会话第一件事是跑 e2e，不是改代码。
2. **seq 断言不能写死基线**：落盘里有上一阶段的夹具（seq 900001+），续号起点已被顶到 900009。
   断言一律「相对落盘最大值」。
3. **回放不能提前停扫盘**：`scanDiskEvents` 改成不提前停了 —— 文件序 ≠ seq 序，提前停会漏。
4. **别手改 `<stateDir>/mcp/host-server.mjs`**：重启 Electron 会自动覆盖（`ensureMcpServer` → `copyFileSync`）。
5. **导出物删除的负例要测**：通配符（`*.jsonl`）、路径穿越（`../events-x.jsonl`）都必须删不掉。
6. **界面删除是两段式**：第一次点只把按钮文案变成「确认删除？」，**文件不动** —— e2e 要断言这一点。
7. **bash 传中文参数被 locale 破坏** → JS 表达式里的中文报 `SyntaxError`；
   办法：写 `.cjs` 文件再跑（本项目全部采用）。
8. **GUI 验证走 CDP**，不要用 computer-use（Electron 截屏全黑）。
9. **强杀 Electron 会丢 cookie** → 收尾一律 `stop-electron.cjs`。

---

## 10. 记忆索引（`E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\`）

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
