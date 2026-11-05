# handoff · ecclaw 第十六阶段（phase3q）· **收官** · 2026-11-03

> **一句话结论**：第十六阶段「真实站点（淘宝）写操作闭环复验 + 写操作事件落盘」**全部完成**——
> 护栏闭环真机复验全通，顺手撞出并补齐了一个真缺口（**写操作原本一条事件都不产生**），
> 代码 / typecheck / build / e2e 23/23 / 四套回归 / 界面实证 / 文档 / 收官 handoff 全部就绪，
> 环境已优雅关停（electron=0 node=0）。**下个会话可直接接下一阶段。**

---

## 0. 项目背景与目标

**ecclaw** = 基于 **OpenClaw** 内核自制的电商 AI 桌面端（Windows / Electron）。
目标是让 agent 在**真实电商站点**上替用户干活，同时**不越权**：
用户页面上的每一个会改变状态的动作（click / scroll）都必须先过**确认护栏**，
事后都必须**在事件流里留痕**，用户随时能查、能导出、能撤销信任。

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
| **十六** | **真实站点写操作闭环复验 + 写操作事件落盘** | **本文档** |

---

## 1. 必读顺序（完整路径）

新会话按此顺序读，**不要跳过前两份**：

1. `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3q-final-2026-11-03.md` ← **本文档**（现状 + 复现 + 下一步）
2. `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3q-2026-11-03.md` ← 本阶段的实现层细节（五处落点逐行）
3. `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3p-final-2026-11-03.md` ← 上一阶段收官（profile 机制）
4. `F:\soft\00selfmade\ecclaw\README.md` ← 能力总览（§5.8 ~ §5.20 是宿主 / 护栏 / 事件三块的权威描述）
5. `F:\soft\00selfmade\ecclaw\task.md` ← 全部阶段的交付表 + 实证发现（顶部状态段是最新进度）
6. `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\MEMORY.md` ← 项目记忆索引（12 条）
   （重点：`ecclaw_phase3q_approval_events.md` 本阶段、`ecclaw_phase3j_guard_scope.md` 护栏四档、
   `ecclaw_phase3p_profiles.md` profile、`feedback_gui_verify_cdp.md` GUI 验证纪律）
7. `F:\soft\00selfmade\ecclaw\prompt-ecclaw-phase3q-next.md` ← 下一阶段的一句话 prompt（存根）

---

## 2. 状态速览

| 项 | 值 |
|---|---|
| 阶段范围 | 第十五阶段 §7 候选 A：**真实站点（淘宝）登录态下的写操作闭环复验** |
| 复验结论 | ✅ 护栏闭环**全通**；❌ 撞出真缺口：**写操作完全不产生事件** |
| 代码 | ✅ 六层写完（共享类型 / 主进程 / 渲染层 / MCP；preload 无需改） |
| typecheck | ✅ `pnpm typecheck` 两段 tsc 均 exit 0 |
| build | ✅ `pnpm build`（preload 6.12 kB / renderer 641.38 kB） |
| 真机 e2e | ✅ `C:\Temp\ecclaw-verify\phase3q-e2e.cjs` **23/23 全绿** |
| 回归 | ✅ phase3p 44/44 · phase3o 44/44 · phase3m 69/69 · sse 14/14 |
| 界面复核 | ✅ `C:\Temp\ecclaw-verify\phase3q-ui-check.cjs` —— approval 可读摘要已核对 DOM 文本 |
| MCP 工具数 | 26 → **26**（`ecclaw_events_since` 加 `kind` 过滤，**不新增工具**） |
| 文档 | ✅ README §5.20 + §8 · task.md 顶部状态 + 第十六阶段表 + 实证发现 8 条 · memory + 收官 handoff + next prompt |
| 代码未 commit | ✅（项目**非 git 仓库**，禁 git init/commit） |
| 环境 | ✅ 已优雅关停（electron=0 node=0；8898/8897/9222 全 DOWN） |

---

## 3. 本阶段做了什么

### 3.1 复验：真实站点（淘宝）写操作闭环 —— 护栏全通

`ecclaw_scroll` → `{status:'pending', approvalId}` → 界面弹护栏卡 → 选信任范围 → 点「允许」→
票据转 `executed` → 页面真滚动 → session 档信任进会话组 → 第二次 scroll **免确认直接放行** →
`ecclaw-settings.json` 持久白名单仍是 `[]`（session 档不落盘）。
淘宝登录态在 `persist:ecclaw-host` 分区里**跨 Electron 重启保住**（昵称「密氪viva63」、购物车 189、无「请登录」）。

### 3.2 真缺口：写操作根本不产生事件

事件流 / 汇总 / 导出这套设施原本只覆盖 `kind:'observe'`。
`HostEvent['kind']` 里明明有 `'approval'`，但**全项目没有任何一处 push 过它**
→ agent 真的动了页面，事件流里查无此案、导出物里也没有。
护栏本身是通的，但**闭环缺最后一环**：写操作是唯一会**改变用户页面**的动作，却没有审计痕迹。

### 3.3 补齐：五处落点 + stage 语义

| 路径 | 落什么 |
|---|---|
| `requestWriteApproval`（两段式，MCP 用） | `requested`（答复前就落）→ `executed`（via: ui / guard-allow / site-trust）/ `failed`（deny）/ `timeout`（10 分钟票据过期） |
| `resolveWriteApproval`（用户答复） | `rejected`（ok:false + 原因）/ `executed`（via:'user'）/ `failed`（via:'user'） |
| `runWithWriteApproval`（阻塞式，平台包 runner 用） | `requested` → `executed`（via:'user'）/ `failed` / `timeout`（40 秒窗口） |

**条数口径**：被护栏拦下的写 = **2 条**（`requested` + `executed`）；站点信任放行 = **1 条**（`executed`, via='site-trust'）；
`rejected` / `timeout` / `failed` 各 1 条。
**'approved' 不单独落事件** —— 否则一次写变 3 条；答复信息折进 `executed` 的 `scope` / `via`。

---

## 4. 改动清单（**全部未 commit**；项目非 git 仓库）

| 文件（完整路径） | 改动 |
|---|---|
| `F:\soft\00selfmade\ecclaw\electron\shared\types.ts` | 新增 `ApprovalEventStage`（requested/executed/rejected/timeout/failed）+ `ApprovalEventValue`（stage / op / url / host / scope / source / via / approvalId / ok / error / result） |
| `F:\soft\00selfmade\ecclaw\electron\main\write-guard.ts` | ①`import { pushHostEvent } from './host-events'`（host-events 不依赖 write-guard → 无循环引用）；②新增 `emitApprovalEvent(value)`（try/catch 包住，事件系统挂了不影响写操作）；③票据 Entry 加 `source` / `scope`；④`createEntry(op, details, source)`；⑤五处落点；⑥复用既有 `hostOf(url)`（`string \| null`）→ `hostOf(url) ?? undefined` |
| `F:\soft\00selfmade\ecclaw\src\api.ts` | 导出 `ApprovalEventValue` |
| `F:\soft\00selfmade\ecclaw\src\views\HostEvents.tsx` | `summarize()` 对 `kind==='approval'` 走可读摘要（阶段 / 滚动·点击 / 站点 / 放行来源 / 信任范围 / 错误），不再甩 JSON；新增三张文案表 `APPROVAL_STAGE_TEXT` / `APPROVAL_VIA_TEXT` / `APPROVAL_SCOPE_TEXT` |
| `F:\soft\00selfmade\ecclaw\resources\mcp\host-server.mjs` | `ecclaw_events_since` 加可选 `kind` 过滤（observe/approval/page；缓冲与落盘回放**两条路都过滤**）；工具描述补 approval 语义。**工具数不变（26）** |
| `F:\soft\00selfmade\ecclaw\electron\preload\index.ts` | **无改动**（事件读取 API 早已存在，只是多了一类事件） |
| `F:\soft\00selfmade\ecclaw\README.md` | 新增 **§5.20**；§8 状态段补本阶段实现与实测数字，并把「真实站点写操作闭环复验」从下一轮候选里划掉 |
| `F:\soft\00selfmade\ecclaw\task.md` | 顶部状态段 + **第十六阶段**表格（10 行）+ **实证发现 8 条** |
| `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\ecclaw_phase3q_approval_events.md` | 项目记忆（新建）+ `MEMORY.md` 索引一条（补了 e2e 计数与「必须重启 Electron」两条实证） |
| `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3q-final-2026-11-03.md` | 本文档 |
| `F:\soft\00selfmade\ecclaw\prompt-ecclaw-phase3q-next.md` | 下一阶段 prompt |

**临时脚本**（`C:\Temp\ecclaw-verify\`，非项目文件）：
`phase3q-e2e.cjs`（23 条断言）· `phase3q-ui-check.cjs`（界面可读摘要复核，**必须 `process.exit(0)`**，见 §9 坑 8）。

---

## 5. 验证证据

### 5.1 e2e（23 条断言全绿）

| 断言 | 结果 | 真相 |
|---|---|---|
| A1–A5 前置（guard=ask / 白名单空 / 淘宝已登录 / 工具 26 / 写操作工具在册） | PASS | 登录态在 `persist:ecclaw-host` 分区里**跨 Electron 重启保住了** |
| B1 首次 scroll 被拦 | PASS | `{status:"pending",approvalId:"w-mw00btfq-1"}` |
| C1–C4 界面护栏卡 | PASS | 卡片文案「agent 请求写操作 · 滚动：页面 https://www.taobao.com/」；选「本次会话内信任本站」→ 点「允许」 |
| D1 票据终态 | PASS | `executed`，`result={ok:true,mode:'dom-scroll',deltaY:400,scrollY:400}` |
| D2 页面真滚了 | PASS | scrollY 0→400 |
| E1 第二次 scroll 免确认 | PASS | `{status:"executed",result:{ok:true,…}}` |
| E2 session 规则进会话组 | PASS | `{session:[{host:"www.taobao.com",match:"domain",ops:"all",ttl:"session"}]}` |
| E3 session 档不落盘 | PASS | `ecclaw-settings.json` 的 `hostWriteGuardAllowlist` 仍是 `[]` |
| E4 界面显示会话信任 | PASS | 「平台包」视图 → 「本次会话信任： www.taobao.com · 整站移除清空本站」 |
| F1 写操作落事件 | PASS | 磁盘新事件 3 条、approval 3 条、`stages=["requested","executed","executed"]` |
| F2 executed 审计要素齐全 | PASS | `{stage,op,url,host,source,scope:"session",approvalId,via:"user",ok:true,result}` |
| F3 requested 答复前就落盘 | PASS | `{stage:"requested",op:"scroll",host,source:"agent",approvalId}` |
| F4 站点信任放行也留痕 | PASS | `{stage:"executed",via:"site-trust",ok:true,result:{scrollY:700}}` |
| F5 `kind='approval'` 过滤取得到 | PASS | 取到 3 条，`source=push` |
| F6 汇总 byKind 含 approval | PASS | `{"approval":3}` |
| F7 导出物含审计 | PASS | `ecclaw-events-20261103-092638.jsonl` count=3 bytes=806 |

### 5.2 磁盘实证（`C:\Users\Duanyi\AppData\Roaming\ecclaw\host-events\events-2026-11-03.jsonl`）

```
seq 900016  approval  requested              op=scroll
seq 900017  approval  executed  via=user     scope=session  ok=true
seq 900018  approval  executed  via=site-trust                ok=true
```

### 5.3 界面实证（宿主事件视图，回归套件在夹具站产生的 approval 事件）

```
09:27:34 · 已请求确认 · 点击 · 127.0.0.1
09:27:35 · 已执行 · 点击 · 127.0.0.1 · 用户放行 · 永久信任（当前路径）
09:27:44 · 已请求确认 · 点击 · 127.0.0.1
09:27:45 · 已执行 · 点击 · 127.0.0.1 · 用户放行 · 本次会话
```

### 5.4 回归

| 套件 | 结果 |
|---|---|
| `C:\Temp\ecclaw-verify\phase3p-e2e.cjs` | 44/44 |
| `C:\Temp\ecclaw-verify\phase3o-e2e.cjs` | 44/44 |
| `C:\Temp\ecclaw-verify\phase3m-e2e.cjs` | 69/69（需 8897 夹具） |
| `C:\Temp\ecclaw-verify\sse-e2e.cjs` | 14/14 |

### 5.5 红线复核

- `<userData>\host-events\exports\`：17 → **19**（本阶段 F7 +1、回归 phase3o +1，**只增不删**；11-02 的 15 个原样在）
- `C:\Users\Duanyi\AppData\Roaming\ecclaw\ecclaw-settings.json`：`hostWriteGuard="ask"`、`hostWriteGuardAllowlist=[]`（**无测试污染**）
- 未 `git init` / `git commit`（项目非 git 仓库）
- `openclaw.json`（明文 relay key）与 `host-bridge.json`（token）**未外传**
- 真机只用 `scroll`（淘宝 click 可能下单）
- 环境已优雅关停：`electron=0 node=0`，8898/8897/9222 全 DOWN

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

# 打开淘宝并确认登录态（重启后分区里的 cookie 应仍在）
node C:/Temp/ecclaw-verify/taobao-login-state.cjs

# 跑本阶段 e2e（23 条断言）
node C:/Temp/ecclaw-verify/phase3q-e2e.cjs \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs" \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json"

# 回归
node C:/Temp/ecclaw-verify/phase3p-e2e.cjs <hostServer> <bridge>   # 44
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
- **D. 本阶段小尾巴**：事件流 approval / observe 混合筛选界面 / 导出物按 kind 拆分。

### 7.2 交付节奏（六层，每层跑 typecheck + build）

```
主进程 → 共享类型 → preload → 渲染层 → MCP → 文档
```

验证纪律：GUI 一律走 **CDP**（`--remote-debugging-port=9222`，`Runtime.evaluate` 点按钮 / 读 DOM），
**不用 computer-use**（对 Electron 截屏全黑）；写 e2e 脚本跑到全绿；
最后补 `README.md` §5.21 + `task.md` 顶部状态与阶段表 + `memory/` 记忆 + `MEMORY.md` 索引
+ `handoff-ecclaw-phase3q-final` 式的收官 handoff + 下一阶段 prompt。

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

---

## 9. 本阶段踩到的坑

1. **`hostOf` 早就存在**（`write-guard.ts:265`，返回 `string | null`，hostname 小写、去掉端口）：
   我又定义了一个同名函数 → tsc 报 `string | null` 不可赋给 `string | undefined`。
   **写事件里的 host 复用它**（`hostOf(url) ?? undefined`）。**先 grep 再定义**。
2. **写操作的答复与执行分处两地**：用户在 `resolveWriteApproval` 点头，执行在
   `requestWriteApproval` 的 runner 回调（两段式）或 `runWithWriteApproval`（阻塞式）——
   scope / source 必须存在 Entry 上传递；'approved' 事件只能在**答复那一处**落，否则重复。
3. **React 的 `<select>` 不能直接赋值**：`select.value = 'session'` 不会触发 onChange →
   必须用 `HTMLSelectElement.prototype.value` 的原生 setter + `dispatchEvent(new Event('change'))`，
   再等一拍（React 重渲染）才点「允许」，否则按钮读到的还是旧 scope。
4. **「本次会话信任」面板在「平台包」视图**（不在宿主事件视图）—— 界面对账要先切视图。
5. **淘宝登录态跨 Electron 重启保住了**（第十阶段 partition 持久化在真实站点上成立）。
6. **导出物基线是 15 + 增量**：11-02 的 15 个一条没删；11-03 e2e 新造 2 个 → 17；
   本阶段 F7 +1、回归 phase3o 再 +1 → **19**（只增不删）。
7. **改完 main 代码必须重启 Electron**：本次 e2e 首轮跑的是旧 main
   （进程 09:13 启动、构建 09:22 产出）→ 必须 `stop-electron.cjs` → `start-electron.ps1`。
   MCP 侧同理：`ensureMcpServer()`（`electron/main/mcp-bridge.ts`）在启动时把
   `resources/mcp/host-server.mjs` 复制进 `<stateDir>/mcp/`。
8. **CDP 脚本必须显式 `process.exit(0)`**：WebSocket 会吊住 Node 事件循环；
   配 `| tail -10` 时输出被 tail 缓冲住 → 看起来像「卡死」，其实是已跑完没退出。

---

## 10. 红线（照旧）

- **禁删用户文件**：`<userData>\host-events\exports\`（现 **19** 个，只增不删）；
  `<userData>\Partitions\ecclaw-profile-*` 是用户登录数据 → `removeHostProfile` **只删配置记录**。
- 禁 `git init` / `git commit`（项目非 git 仓库）。
- `openclaw.json`（明文 relay key）与 `host-bridge.json`（token）勿外传。
- Electron 内 spawn 内核/MCP 必须带 `ELECTRON_RUN_AS_NODE=1`；护栏默认 `ask`；别去掉 `persist:` 前缀。
- **真实站点只用 `scroll` 做写操作验证**（click 可能下单 —— 淘宝点一下就下单）。
- 临时产物写 `C:\Temp\`；记忆写 `memory/` 文件夹，**handoff / task 文档不得放进 memory 文件夹**。
- GUI 验证走 **CDP**（`--remote-debugging-port=9222`），不用 computer-use。
