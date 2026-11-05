# handoff · ecclaw 第十七阶段（phase3r）· **收官** · 2026-11-03

> **一句话结论**：第十七阶段「事件流 kind 多选筛选 + 导出物按 kind 拆分」**全部完成**——
> 过滤语义统一收敛到 `scanDiskEvents` 一处（`kinds` 多选**优先于** `kind` 单选，脏 kind 丢弃不报错），
> 回放 / 汇总 / 导出三条路天然一致；导出可按类型拆成多份文件（kind 放时间戳前、同秒撞名加 `-N` **绝不覆盖**用户产物）；
> 界面三处 kind 多选 + 「按 kind 拆成多个文件」开关；
> 代码 / typecheck / build / e2e 31/31 / 五套回归 / 界面实证 / 文档 / 收官 handoff 全部就绪。
> **下个会话可直接接下一阶段。**

---

## 0. 项目背景与目标

**ecclaw** = 基于 **OpenClaw** 内核自制的电商 AI 桌面端（Windows / Electron）。
目标是让 agent 在**真实电商站点**上替用户干活，同时**不越权**：
用户页面上的每一个会改变状态的动作（click / scroll）都必须先过**确认护栏**，
事后都必须**在事件流里留痕**，用户随时能查、能筛、能导出、能撤销信任。

一句话架构：**Electron 主进程**（内嵌 Chromium 宿主 + 写操作护栏 + 事件总线 + 落盘）
→ **宿主桥**（主进程内 HTTP server，loopback + token）→ **MCP 服务**（`resources/mcp/host-server.mjs`）
→ **openclaw 内核**（agent 侧调用 MCP 工具）→ **渲染层**（React 界面，事件流 / 护栏卡 / 信任规则可视化）。

| 层 | 目录（完整路径） |
|---|---|
| 项目根 | `F:\soft\00selfmade\ecclaw` |
| Electron 主进程 | `F:\soft\00selfmade\ecclaw\electron\main` |
| 共享类型 | `F:\soft\00selfmade\ecclaw\electron\shared\types.ts` |
| preload | `F:\soft\00selfmade\ecclaw\electron\preload\index.ts` |
| 渲染层 | `F:\soft\00selfmade\ecclaw\src`（视图在 `F:\soft\00selfmade\ecclaw\src\views`） |
| MCP 服务 | `F:\soft\00selfmade\ecclaw\resources\mcp\host-server.mjs` |
| 构建产物 | `F:\soft\00selfmade\ecclaw\out`（`out\main\index.js` / `out\preload` / `out\renderer`） |
| 用户数据 | `C:\Users\Duanyi\AppData\Roaming\ecclaw`（`<userData>`） |
| openclaw 状态目录 | `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw`（`<stateDir>`） |
| 事件落盘 | `C:\Users\Duanyi\AppData\Roaming\ecclaw\host-events`（`events-YYYY-MM-DD.jsonl` + `exports\`） |
| 验证夹具与脚本 | `C:\Temp\ecclaw-verify` |

**阶段地图**（每阶段一个 handoff，全在项目根）：

| 阶段 | 主题 | 收官 handoff |
|---|---|---|
| 一 ~ 八 | 架构 / 内核接入 / 内嵌浏览器宿主 / 写操作 / 护栏 / MCP 直暴露 | `handoff-ecclaw-phase3f-2026-11-02.md` 起 |
| 九 | 写操作票据化 + 站点白名单 + poll 持续刷新 | `handoff-ecclaw-phase3i-final-2026-11-02.md` |
| 十 | 信任范围四档 + 事件落盘回放 + 登录态持久 partition | `handoff-ecclaw-phase3j-final-2026-11-02.md` |
| 十一 | 事件汇总 + 落盘保留策略细化 | `handoff-ecclaw-phase3k-final-2026-11-02.md` |
| 十二 | 事件导出 + 信任规则可视化 + 白名单路径维度 | `handoff-ecclaw-phase3l-final-2026-11-02.md` |
| 十三 | 压缩归档 + 时间序列趋势 + 护栏粒度 + SSE 推送 | `handoff-ecclaw-phase3m-final-2026-11-02.md` |
| 十四 | 事件 seq 全局单调 + 导出物清理入口 + 趋势图 | `handoff-ecclaw-phase3o-final-2026-11-02.md` |
| 十五 | 店铺登录态 profile（多店铺登录隔离） | `handoff-ecclaw-phase3p-final-2026-11-03.md` |
| 十六 | 真实站点写操作闭环复验 + 写操作事件落盘 | `handoff-ecclaw-phase3q-final-2026-11-03.md` |
| **十七** | **事件流 kind 多选筛选 + 导出物按 kind 拆分** | **本文档** |

---

## 1. 必读顺序（完整路径）

新会话按此顺序读，**不要跳过前两份**：

1. `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3r-final-2026-11-03.md` ← **本文档**（现状 + 复现 + 下一步）
2. `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3q-final-2026-11-03.md` ← 上一阶段收官（写操作事件落盘 / stage 语义）
3. `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3q-2026-11-03.md` ← 第十六阶段实现层细节
4. `F:\soft\00selfmade\ecclaw\README.md` ← 能力总览（§5.8 ~ §5.21 是宿主 / 护栏 / 事件三块的权威描述）
5. `F:\soft\00selfmade\ecclaw\task.md` ← 全部阶段的交付表 + 实证发现（顶部状态段是最新进度）
6. `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\MEMORY.md` ← 项目记忆索引（13 条）
   （重点：`ecclaw_phase3r_kind_filter_export.md` 本阶段、`ecclaw_phase3q_approval_events.md` 写操作事件、
   `ecclaw_phase3p_profiles.md` profile、`feedback_gui_verify_cdp.md` GUI 验证纪律）
7. `F:\soft\00selfmade\ecclaw\prompt-ecclaw-phase3r-next.md` ← 下一阶段的一句话 prompt（存根）

---

## 2. 状态速览

| 项 | 值 |
|---|---|
| 阶段范围 | 第十六阶段 §7 候选 D：**事件流 approval / observe 混合筛选界面 + 导出物按 kind 拆分**（用户超时自动选中 D，见 §9 坑 1） |
| 代码 | ✅ 六层写完（共享类型 / 主进程 / preload / 渲染层 / MCP / 文档） |
| typecheck | ✅ `pnpm typecheck` 两段 tsc 均 exit 0 |
| build | ✅ `pnpm build`（main 180.51 kB / preload 6.18 kB / renderer 646.76 kB） |
| 真机 e2e | ✅ `C:\Temp\ecclaw-verify\phase3r-e2e.cjs` **31/31 全绿** |
| 回归 | ✅ phase3q 23/23 · phase3p 45/45 · phase3o 44/44 · phase3m 69/69 · sse 14/14 |
| MCP 工具数 | 26 → **26**（四个事件工具加 `kinds`，导出工具加 `splitByKind`，**不新增工具**） |
| 文档 | ✅ README §5.21 + §8 · task.md 顶部状态 + 第十七阶段表 + 实证发现 9 条 · memory + 收官 handoff + next prompt |
| 代码未 commit | ✅（项目**非 git 仓库**，禁 git init/commit） |
| 环境 | 见 §6 收尾 |

---

## 3. 本阶段做了什么

### 3.1 为什么要做

事件流里现在混着两类东西：「机器看到的观察事件」（`observe`，一次持续观察 800ms 一条，量最大）
和「人批过的写操作审计」（`approval`，一次写 1~2 条）。两类混在一列里既看不过来，
也没法只把其中一类交给别处分析 —— 单选的 `kind` 只能选一类，多选没有出口，导出更是一股脑全导出。

### 3.2 过滤语义：kinds（多选）优先于 kind（单选）

统一落在 `scanDiskEvents`（`electron/main/host-events.ts`）：

| 参数 | 语义 |
|---|---|
| `kinds: ['approval']` | 多选，只要这几类 |
| `kind: 'approval'` | 单选（旧参数，保留） |
| 两者都给 | **`kinds` 优先** |
| 都不给 | 不限 |
| `kinds: ['bogus','approval']` | 认不出的丢掉，只按 `approval` 过滤（脏数据不报错） |

因为过滤只在 `scanDiskEvents` 一处实现，**回放 / 汇总 / 导出三条路语义天然一致** ——
不会出现「回放能筛、汇总能筛、导出不能筛」的漂移。

### 3.3 导出拆分

`splitByKind: true` → 每类一个文件，文件名 `ecclaw-events-<kind>-YYYYMMDD-HHMMSS.<ext>`：

```
ecclaw-events-approval-20261103-103318.jsonl
ecclaw-events-observe-20261103-103318.jsonl
```

- kind 放在**时间戳前面**：文件名里一眼可见，正则也能稳定解析出来（`EXPORT_FILE_RE` 的 group1 就是 kind）。
- 不拆分时文件名**一字未改**（`ecclaw-events-YYYYMMDD-HHMMSS.ext`），历史导出物照旧可列可删。
- **同秒导出两次不覆盖**：时间戳只精确到秒，撞名会加 `-2` / `-3` 后缀（红线：禁删用户文件）。
- 导出结果从 `{file, count, bytes, format, truncated, dir}` 扩成
  `{file, files:[{name,file,bytes,kind}], count, bytes, format, truncated, dir, kinds, split}`。

### 3.4 分层落点

| 层 | 改动 |
|---|---|
| 共享类型 | `HostEventKind`；`HostEventFilter.kinds`；`HostEventExportOptions.{kinds,splitByKind}`；`HostEventExportResult.{files,kinds,split}`；`HostEventExportFile.kind` |
| 主进程 | `host-events.ts`：`scanDiskEvents` 加 kinds 过滤、`uniqueExportPath()` 去重、`renderEvents()` 渲染、`exportHostEvents` 按 kind 分组导出；`host-bridge.ts` / `main/index.ts` 各自解析 `kinds`（只认三种已知 kind，脏数据当没传） |
| preload | `exportHostEvents` 的 IPC 契约从 `(filter, format)` 改成 `(filter, {format, splitByKind})` |
| 渲染层 | `src/views/HostEvents.tsx`：`KindPicker` 多选控件（增量事件流 / 历史回放 / 导出 三处各一个）+「按 kind 拆成多个文件」开关 + 拆分结果文件列表 + 导出物清单的 kind 标签 |
| MCP | `ecclaw_event_replay` / `ecclaw_event_summary` / `ecclaw_event_export` / `ecclaw_events_since` 全部支持可选 `kinds`；`ecclaw_event_export` 另加 `splitByKind`。**工具数不变（26）** |

---

## 4. 改动清单（**全部未 commit**；项目非 git 仓库）

| 文件（完整路径） | 改动 |
|---|---|
| `F:\soft\00selfmade\ecclaw\electron\shared\types.ts` | `export type HostEventKind = HostEvent['kind']`；`HostEventFilter.kinds?: HostEventKind[]`；`HostEventExportOptions.{kinds?, splitByKind?}`；`HostEventExportResult.{files, kinds, split}`；`HostEventExportFile.kind?` |
| `F:\soft\00selfmade\ecclaw\electron\main\host-events.ts` | ①`scanDiskEvents` 加 `kindFilter`（kinds 非空优先于 kind）；②`EXPORT_KIND_RE`（kind 文件名安全校验）；③`uniqueExportPath(dir, stem, format)`（同秒撞名加 `-2`/`-3`，不覆盖）；④`renderEvents(events, format)`；⑤`exportHostEvents` 重写（按 kind 分组 → 拆分 / 单文件）；⑥`EXPORT_FILE_RE` 扩展为 `/^ecclaw-events-(?:([a-z0-9-]{1,32})-)?(\d{8})-(\d{6})(?:-\d{1,3})?\.(jsonl\|csv)$/`；⑦`listHostEventExports` 解析 group1 → `HostEventExportFile.kind` |
| `F:\soft\00selfmade\ecclaw\electron\main\host-service.ts` | `hostReplayEvents` 签名改 `HostEventFilter & { limit?: number }`（自动带上 kinds） |
| `F:\soft\00selfmade\ecclaw\electron\main\host-bridge.ts` | 新增本地 `parseKinds()`（只认 observe/approval/page，脏数据当没传）；`event-replay` / `event-summary` / `event-export` 三 op 透传 `kinds`；`event-export` 加 `splitByKind` |
| `F:\soft\00selfmade\ecclaw\electron\main\index.ts` | 新增本地 `parseEventKinds()`；`host:host-event-replay` / `host:host-event-summary` 透传 `kinds`；**`host:host-event-export` 的 IPC 契约从 `(filter, format)` 改成 `(filter, {format, splitByKind})`** |
| `F:\soft\00selfmade\ecclaw\electron\preload\index.ts` | `exportHostEvents` 改为 `ipcRenderer.invoke('host:host-event-export', filter ?? {}, { format: options?.format ?? 'jsonl', splitByKind: options?.splitByKind === true })`（与新 IPC 契约同步） |
| `F:\soft\00selfmade\ecclaw\src\api.ts` | `import` / `export` 都加 `HostEventKind` |
| `F:\soft\00selfmade\ecclaw\src\views\HostEvents.tsx` | `KIND_TEXT` / `ALL_KINDS` / `KindPicker`（三个 checkbox，`data-testid={prefix}-{kind}`，空选 = 不限）；三处各挂一个（`stream-kind-*` / `replay-kind-*` / `export-kind-*`）；事件流实时显示各类型条数（`stream-kind-count`）；导出面板加「按 kind 拆成多个文件」开关（`export-split`）；导出结果按文件逐条列出；导出物清单每条显示 kind 标签 |
| `F:\soft\00selfmade\ecclaw\resources\mcp\host-server.mjs` | 新增 `KNOWN_KINDS` + `parseKindFilter(kind, kinds)`（kinds 优先；脏值丢弃）；`eventsSince` 支持多选；四个事件工具 inputSchema 加可选 `kinds`，`ecclaw_event_export` 加 `splitByKind`；`ecclaw_export_list` 描述补 kind 字段。**工具数不变（26）** |
| `F:\soft\00selfmade\ecclaw\README.md` | 新增 **§5.21**；§8 状态段补本阶段实现与实测数字 |
| `F:\soft\00selfmade\ecclaw\task.md` | 顶部状态段 + **第十七阶段**表格（11 行）+ **实证发现 9 条** |
| `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\ecclaw_phase3r_kind_filter_export.md` | 项目记忆（新建）+ `MEMORY.md` 索引一条 |
| `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3r-final-2026-11-03.md` | 本文档 |
| `F:\soft\00selfmade\ecclaw\prompt-ecclaw-phase3r-next.md` | 下一阶段 prompt |

**临时脚本**（`C:\Temp\ecclaw-verify\`，非项目文件）：
`phase3r-e2e.cjs`（31 条断言）· 改 `phase3o-e2e.cjs` 的导出物文件名断言（放宽为 `ecclaw-events[-kind]-YYYYMMDD-HHMMSS.ext`）。

---

## 5. 验证证据

### 5.1 e2e（31 条断言全绿）

| 断言 | 结果 | 真相 |
|---|---|---|
| A1–A4 工具与 schema | PASS | 工具数 **26**；`kinds` 是数组（三个事件工具 + `ecclaw_events_since`）；`splitByKind` 是布尔 |
| A5 清场 | PASS | 停掉上一轮遗留的 2 个 watch（否则 observe 持续涌入 → 跨调用比条数会漂） |
| B0–B5 回放多选 | PASS | 单选/多选/并集/kinds 优先于 kind/脏 kind 丢弃，全部符合 |
| C1–C3 汇总多选 | PASS | `kinds=['approval']` 的 `byKind` 只有 approval，`total` 与回放单类条数一致 |
| D1–D8 导出过滤与拆分 | PASS | 过滤后单文件只含该类；拆分 2 份、文件名带 kind、每份只含自己那类、字节合计 = 返回 bytes |
| E1 同秒不覆盖 | PASS | 连续两次导出得到 `...103318-2.jsonl` / `...103318-3.jsonl` 两个文件 |
| F1 `events_since` 多选 | PASS | 只返回 approval |
| G1–G6 界面 | PASS | 三处控件 + 拆分开关都在；勾选 approval 后「60 条中显示 1 条」，列表只剩 approval；勾选 observe 后两类都回来；界面拆分导出出现多份文件 |

### 5.2 界面实证（宿主事件视图）

```
60 条中显示 60 条 · observe=59 · approval=1 · page=0      ← 不限
60 条中显示 1 条  · observe=59 · approval=1 · page=0      ← 勾选「写操作审计」
```

拆分导出产物（`<userData>/host-events/exports/`）：

```
ecclaw-events-approval-20261103-103318.jsonl
ecclaw-events-observe-20261103-103318.jsonl
```

### 5.3 回归

| 套件 | 结果 |
|---|---|
| `C:\Temp\ecclaw-verify\phase3q-e2e.cjs`（淘宝真站闭环） | 23/23 |
| `C:\Temp\ecclaw-verify\phase3p-e2e.cjs` | 45/45 |
| `C:\Temp\ecclaw-verify\phase3o-e2e.cjs` | 44/44（文件名断言已随新命名放宽） |
| `C:\Temp\ecclaw-verify\phase3m-e2e.cjs` | 69/69（需 8897 夹具） |
| `C:\Temp\ecclaw-verify\sse-e2e.cjs` | 14/14 |

### 5.4 红线复核

- `<userData>\host-events\exports\`：19 → **45**（本阶段 e2e 多轮新造，**只增不删**；11-02/11-03 的原 19 个原样在）
- `C:\Users\Duanyi\AppData\Roaming\ecclaw\ecclaw-settings.json`：`hostWriteGuard="ask"`、`hostWriteGuardAllowlist=[]`（**无测试污染**）
- 未 `git init` / `git commit`（项目非 git 仓库）
- `openclaw.json`（明文 relay key）与 `host-bridge.json`（token）**未外传**
- 本阶段**未做任何真实站点写操作**（真机写操作只做 scroll 仍是红线）

---

## 6. 复现步骤（完整命令，按顺序）

```bash
cd /f/soft/00selfmade/ecclaw
pnpm typecheck && pnpm build

# 夹具（8898 必需；8897 只有跑 phase3m 回归才需要）
cd /c/Temp/ecclaw-verify && node fixture-server.cjs &    # 8898
cd /c/Temp/ecclaw-verify && node fixture-writer.cjs &    # 8897

# ⚠️ 必须重启 Electron —— 改完 main 代码不重启，跑的还是旧代码
node C:/Temp/ecclaw-verify/stop-electron.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"

# 打开淘宝并确认登录态（跑 phase3q 回归才需要）
node C:/Temp/ecclaw-verify/taobao-login-state.cjs

# 跑本阶段 e2e（31 条断言）
node C:/Temp/ecclaw-verify/phase3r-e2e.cjs \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs" \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json"

# 回归
node C:/Temp/ecclaw-verify/phase3q-e2e.cjs <hostServer> <bridge>   # 23（真站，先跑 taobao-login-state.cjs）
node C:/Temp/ecclaw-verify/phase3p-e2e.cjs <hostServer> <bridge>   # 45
node C:/Temp/ecclaw-verify/phase3o-e2e.cjs <hostServer> <bridge>   # 44
node C:/Temp/ecclaw-verify/phase3m-e2e.cjs <hostServer> <bridge>   # 69（需 8897）
node C:/Temp/ecclaw-verify/sse-e2e.cjs <hostServer> <bridge>        # 14
```

`<hostServer>` = `C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs`
`<bridge>` = `C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json`

**收尾**：`node C:/Temp/ecclaw-verify/stop-electron.cjs`（优雅关，别强杀）+ 停两个夹具（按精确 PID）。

---

## 7. 下一阶段：候选 + 计划

### 7.1 候选（供 AskUserQuestion 拍板）

- **A. 真实站点的 click 类写操作闭环** —— 真机只用 `ecclaw_scroll` 验过（淘宝点一下可能下单）；
  click 需要另找不会产生下单的页面。
- **B. 写操作的 rejected / timeout / failed 三条 stage 在真实站点复验** —— 目前只在夹具站验过。
- **C. 第二阶段外壳候选**：远程包仓库灰度发布 / 邮件 worker / 画布宿主 / PDF·Docx·Pptx·PSD 预览 /
  OCR / 社媒自动化脚本执行器 / 数据迁移框架（团队·账号·计费·遥测本项目刻意不做）。
- **D. 本阶段小尾巴**：`kind:'page'` 的事件至今**没有任何一处 push 过**（类型里定义了，实际只有
  observe / approval 两种在产生）—— 要么补上页面级事件的产生点，要么把该 kind 从类型里去掉；
  另外导出物已经 45 个，界面「导出物」面板可以加个「按日期 / 按 kind 归类」的视图。

### 7.2 交付节奏（六层，每层跑 typecheck + build）

```
主进程 → 共享类型 → preload → 渲染层 → MCP → 文档
```

验证纪律：GUI 一律走 **CDP**（`--remote-debugging-port=9222`，`Runtime.evaluate` 点按钮 / 读 DOM），
**不用 computer-use**（对 Electron 截屏全黑）；写 e2e 脚本跑到全绿；
最后补 `README.md` §5.22 + `task.md` 顶部状态与阶段表 + `memory/` 记忆 + `MEMORY.md` 索引
+ `handoff-ecclaw-phase3r-final` 式的收官 handoff + 下一阶段 prompt。

---

## 8. 环境基线

| 项 | 值 |
|---|---|
| 平台 | Windows 11 Pro 10.0.26300（shell = bash / Git Bash） |
| 项目根 | `F:\soft\00selfmade\ecclaw`（**非 git 仓库**） |
| Node / pnpm | `D:\Program Files\nodejs\node.exe`；pnpm 优先 |
| Electron | `npx electron . --remote-debugging-port=9222`（工作目录 = 项目根） |
| userData | `C:\Users\Duanyi\AppData\Roaming\ecclaw` |
| stateDir | `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw` |
| 夹具 | 8898 `fixture-server.cjs` · 8897 `fixture-writer.cjs` |
| CDP | `http://127.0.0.1:9222`（目标：`file:///F:/soft/00selfmade/ecclaw/out/renderer/index.html`） |
| 护栏设置 | `hostWriteGuard="ask"`、`hostWriteGuardAllowlist=[]` |
| 导航视图 | 对话 / 大模型 / 技能 / 平台包 / 文件库 / 宿主事件（**「本次会话信任」面板在「平台包」视图**） |

**本阶段收尾时的运行态（2026-11-03 收官时实测）**：Electron **0 个进程**（GUI 点 X 优雅退出）·
夹具 **8898 / 8897 均已停**（按精确 PID `Stop-Process`，未用通配符）· 9222 / 8897 / 8898 **三端口均 free**。
→ 新会话从「冷启动」开始，按 §6 复现步骤重新拉起夹具与 Electron 即可，**不要**假定它们还在跑。

---

## 9. 本阶段踩到的坑

1. **AskUserQuestion 超时自动选中 ≠ 用户批准**：本阶段的范围是「超时自动选中 D」，
   工具返回明示「These are automatic selections, not direct user input. Use them as defaults where
   appropriate; do not treat them as approval for irreversible actions.」→ 只能当**默认值**用，
   遇到不可逆动作 / 真实站点写操作**必须重新问**。D 不含这些，所以照做即可。
2. **改了 IPC 契约要两端同步**：`host:host-event-export` 从 `(filter, format)` 改成
   `(filter, {format, splitByKind})` → 只改一侧会静默拿到 `splitByKind=undefined`
   （拆分永远不生效），而 **tsc 不会报错**。preload 与 `main/index.ts` 必须一起改。
3. **同秒导出撞名会覆盖用户产物**（红线：禁删用户文件）：时间戳只精确到秒 → 同秒两次导出，
   后一次覆盖前一次 = 弄没了用户的一份产物。`uniqueExportPath` 加 `-2`/`-3` 后缀解决。
   **任何「自动生成文件名」的写入都要先想撞名**。
4. **跨调用比较条数前必须先停掉遗留的持续观察**：`observe` 事件每 800ms 一条，上一轮 e2e 留下的
   watch 会让「回放单类条数」与「并集条数」两次调用的快照漂移（实测 304 vs 305）→ 断言随机红。
   **e2e 开头先 `watch-list` + `watch-stop` 清场**（本阶段脚本用宿主桥 `watch-list` op）。
5. **界面过滤断言要能观察出差异**：起初事件流里只有 observe，勾选后条数没变（过滤前后都是 N）
   → 断言是「碰巧通过」的。补一次被护栏拦下的滚动造出 approval 事件，流里同时有两类后，
   勾选 approval → 「60 条中显示 1 条」，过滤才真正被观测到。
6. **新命名形态会让旧的文件名断言变红**：`phase3o-e2e.cjs` 断言导出物文件名符合
   `ecclaw-events-YYYYMMDD-HHMMSS.ext`，拆分产物多一段 kind → 断言已放宽为
   `ecclaw-events[-kind]-YYYYMMDD-HHMMSS.ext`（**单文件形态保持一字未改**，
   所以历史导出物照旧可列可删）。
7. **kind 放在时间戳前面**：文件名里一眼可见（不用打开文件就知道是哪类），
   正则也能稳定解析（`EXPORT_FILE_RE` 的 group1 就是 kind）。放在后面虽然也能解析，但人眼不友好。
8. **过滤语义必须收敛到一处实现**：回放、汇总、导出各写一套 kind 判断，迟早漂移成
   「回放能筛、汇总能筛、导出不能筛」。统一落进 `scanDiskEvents` 后三条路**天然**一致 ——
   新增一种筛选维度只要改一处。
9. **脏输入要丢弃而不是报错**：agent 可能传 `kinds:['bogus']`。桥层与 MCP 层各有一处解析器
   （只认 observe/approval/page），认不出就当没传 —— **脏数据不该让调用炸掉**。

---

## 10. 红线（照旧）

- **禁删用户文件**：`<userData>\host-events\exports\`（现 **45** 个，只增不删）；
  `<userData>\Partitions\ecclaw-profile-*` 是用户登录数据 → `removeHostProfile` **只删配置记录**。
- 禁 `git init` / `git commit`（项目非 git 仓库）。
- `openclaw.json`（明文 relay key）与 `host-bridge.json`（token）勿外传。
- Electron 内 spawn 内核/MCP 必须带 `ELECTRON_RUN_AS_NODE=1`；护栏默认 `ask`；别去掉 `persist:` 前缀。
- **真实站点只用 `scroll` 做写操作验证**（click 可能下单 —— 淘宝点一下就下单）。
- 临时产物写 `C:\Temp\`；记忆写 `memory/` 文件夹，**handoff / task 文档不得放进 memory 文件夹**。
- GUI 验证走 **CDP**（`--remote-debugging-port=9222`），不用 computer-use。
