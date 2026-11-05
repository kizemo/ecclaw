# handoff · ecclaw 第十六阶段（phase3q）· 真实站点写操作闭环 + 写操作事件落盘 · 2026-11-03

> 阶段名：**第十六阶段 / phase3q** —— 真实站点（淘宝）写操作闭环复验 + 补齐「写操作不落事件」的真缺口
> 上一阶段：`handoff-ecclaw-phase3p-final-2026-11-03.md`（第十五阶段收官）
> ⚠️ **本阶段代码已写完且 typecheck/build 通过，但真机 e2e 还没跑**（写收尾时上下文撞到 160K 硬闸门，
> Bash 被拦）。**下个会话第一件事就是跑 e2e**（步骤见 §4）。

---

## 1. 状态速览

| 项 | 值 |
|---|---|
| 方向 | 用户从 phase3p §7 候选里选「真实站点写操作闭环复验」（AskUserQuestion 自动超时选中推荐项） |
| 复验结论 | ✅ 护栏闭环**全通**；❌ 撞出真缺口：**写操作完全不产生事件** |
| 代码 | ✅ 六层写完（共享类型 / 主进程 / 渲染层 / MCP；preload 无需改） |
| typecheck | ✅ `pnpm typecheck` 两段 tsc 均 exit 0 |
| build | ✅ `pnpm build`（preload 6.12 kB / renderer 641.38 kB） |
| 真机 e2e | ⏳ **未跑**（脚本已改好：`C:\Temp\ecclaw-verify\phase3q-e2e.cjs`，21 条断言） |
| 回归 | ⏳ 未跑（phase3p 45 / phase3o 44 / phase3m 69 / sse 14） |
| MCP 工具数 | 26 → **26**（`ecclaw_events_since` 加 `kind` 过滤，不新增工具） |
| 代码未 commit | ✅（项目非 git 仓库，禁 git init/commit） |

---

## 2. 复验实测（淘宝，真实站点，登录态已在）

第一轮 `phase3q-e2e.cjs` 跑出 **14/18**，4 个 FAIL —— 其中 2 个是**我断言写错**，2 个是**真缺口**：

| 断言 | 结果 | 真相 |
|---|---|---|
| A1–A5 前置（guard=ask / 白名单空 / 淘宝已登录 / 工具 26） | PASS | 登录态在 `persist:ecclaw-host` 分区里**跨 Electron 重启保住了**（昵称「密氪viva63」、购物车 189、无「请登录」） |
| B1 首次 scroll 被拦 | PASS | `{status:"pending",approvalId:"w-mvzzzey3-1"}` |
| C1–C4 界面护栏卡 | PASS | 卡片文案「agent 请求写操作 · 滚动：页面 https://www.taobao.com/」；选「本次会话内信任本站」→ 点「允许」 |
| D1 票据终态 | PASS | `executed`，`result={ok:true,mode:'dom-scroll',deltaY:400,scrollY:400}` |
| D2 页面真滚了 | PASS | scrollY 0→400 |
| E1 第二次 scroll 免确认 | ~~FAIL~~ | **断言写错**：实际返回 `{status:"executed",result:{ok:true,…}}`（session 信任已生效），我误判 `scroll2.ok` |
| E2 session 规则进会话组 | PASS | `{session:[{host:"www.taobao.com",match:"domain",ops:"all",ttl:"session"}]}` |
| E3 session 档不落盘 | PASS | `ecclaw-settings.json` 的 `hostWriteGuardAllowlist` 仍是 `[]` |
| E4 界面显示会话信任 | ~~FAIL~~ | **断言写错**：面板在「平台包」视图，脚本没切视图 |
| F1/F2 写操作落事件 | **FAIL** | ❗**真缺口**：磁盘新事件 **0 条**、`kinds=[]`、`ecclaw_event_summary` total=0 → 写操作在事件流里查无此案 |

---

## 3. 改动清单（**全部未 commit**）

| 文件 | 改动 |
|---|---|
| `electron/shared/types.ts` | 新增 `ApprovalEventStage`（requested/executed/rejected/timeout/failed）+ `ApprovalEventValue`（stage / op / url / host / scope / source / via / approvalId / ok / error / result） |
| `electron/main/write-guard.ts` | ①`import { pushHostEvent } from './host-events'`（host-events 不依赖 write-guard → 无循环引用）；②新增 `emitApprovalEvent(value)`（try/catch 包住，事件系统挂了不影响写操作）；③Entry 加 `source` / `scope`；④`createEntry(op, details, source)` 多一个参数；⑤**五处落点**（见下）；⑥复用既有 `hostOf(url)`（返回 `string \| null`）→ `hostOf(url) ?? undefined` |
| `src/api.ts` | 导出 `ApprovalEventValue` |
| `src/views/HostEvents.tsx` | `summarize()` 对 `kind==='approval'` 走可读摘要（阶段 / 滚动·点击 / 站点 / 放行来源 / 信任范围 / 错误），不再甩 JSON；新增三张文案表 `APPROVAL_STAGE_TEXT` / `APPROVAL_VIA_TEXT` / `APPROVAL_SCOPE_TEXT` |
| `resources/mcp/host-server.mjs` | `ecclaw_events_since` 加可选 `kind` 过滤（observe/approval/page；缓冲与落盘回放两条路都过滤）；工具描述补 approval 语义。**工具数不变（26）** |
| `electron/preload/index.ts` | **无改动**（事件读取 API 早已存在，只是多了一类事件） |

**五处落点（事件条数）**

| 路径 | 落什么 |
|---|---|
| `requestWriteApproval`（两段式，MCP 用） | `requested`（答复前就落）→ `executed`（via: ui / guard-allow / site-trust）/ `failed`（deny）/ `timeout`（10 分钟票据过期） |
| `resolveWriteApproval`（用户答复） | `rejected`（ok:false + 原因）/ `executed`（via:'user'）/ `failed`（via:'user'） |
| `runWithWriteApproval`（阻塞式，平台包 runner 用） | `requested` → `executed`（via:'user'）/ `failed` / `timeout`（40 秒窗口） |

- 被护栏拦下的一次写 = **2 条**（`requested` + `executed`）；站点信任放行 = **1 条**（`executed`，via='site-trust'）
- **'approved' 不单独落事件** —— 否则一次写变 3 条；答复信息折进 `executed` 的 `scope` / `via`

---

## 4. 下个会话必做（**按顺序**）

```bash
cd /f/soft/00selfmade/ecclaw
pnpm typecheck && pnpm build     # 已验证通过，可跳过；改了代码再跑

# 夹具（8898 必需；8897 只有跑 phase3m 回归才需要）
cd /c/Temp/ecclaw-verify && node fixture-server.cjs &    # 8898
cd /c/Temp/ecclaw-verify && node fixture-writer.cjs &    # 8897（phase3m 回归依赖）

# ⚠️ 必须重启 Electron —— 当前跑的还是**旧 main 代码**（改代码前启动的那次）
node C:/Temp/ecclaw-verify/stop-electron.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"

# 打开淘宝并确认登录态（重启后分区里的 cookie 应仍在）
node C:/Temp/ecclaw-verify/taobao-login-state.cjs

# 跑本阶段 e2e（21 条断言）
node C:/Temp/ecclaw-verify/phase3q-e2e.cjs \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs" \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json"
```

**e2e 里要盯的**（脚本已按设计写好，直接跑即可）：

- F1 `approval` 事件 ≥2 条；F2 `executed` 事件的 op/host/scope/via/ok/approvalId 全对；
  F3 `requested` 事件在答复前就落盘；F4 站点信任放行也留痕（via='site-trust'）；
  F5 `ecclaw_events_since` 带 `kind='approval'` 取得到；F6 汇总 `byKind.approval ≥ 2`；
  F7 导出物里含 `"kind":"approval"` 与 `"stage":"executed"`
- E1 已改成 `status==='executed' && result.ok===true`；E4 已加「切到平台包视图」再找会话信任面板
- F7 会**新增 1 个导出物**（`ecclaw_event_export`）→ `<userData>/host-events/exports/` 从 17 → 18（**只增不删**）

回归（工具数断言仍是 26，无需改）：
`node C:/Temp/ecclaw-verify/phase3p-e2e.cjs <hostServer> <bridge>`（45）
`node C:/Temp/ecclaw-verify/phase3o-e2e.cjs ...`（44）· `phase3m-e2e.cjs`（69，需 8897）· `sse-e2e.cjs`（14）

**收尾**：`node C:/Temp/ecclaw-verify/stop-electron.cjs`（优雅关，别强杀）+ 停两个夹具（按精确 PID）。
**然后补文档**（还没写）：
- `README.md` §5.20（写操作事件落盘）+ §8 状态段补本阶段
- `task.md` 顶部状态段 + **第十六阶段**表格 + 实证发现
- `handoff-ecclaw-phase3q-final-2026-11-03.md`（收官）+ `prompt-ecclaw-phase3q-next.md`

---

## 5. 本阶段踩到的坑

1. **`hostOf` 早就存在**（write-guard.ts:265，返回 `string | null`，取 hostname 小写、去掉端口）：
   我又定义了一个同名函数 → tsc 报 `string | null` 不可赋给 `string | undefined`。
   **写事件里的 host 复用它**（`hostOf(url) ?? undefined`）。先 grep 再定义。
2. **写操作的答复与执行分处两地**：用户在 `resolveWriteApproval` 点头，执行在
   `requestWriteApproval` 的 runner 回调（两段式）或 `runWithWriteApproval`（阻塞式）——
   scope / source 必须存在 Entry 上传递；'approved' 事件只能在**答复那一处**落，否则重复。
3. **React 的 `<select>` 不能直接赋值**：`select.value = 'session'` 不会触发 onChange →
   必须用 `HTMLSelectElement.prototype.value` 的原生 setter + `dispatchEvent(new Event('change'))`，
   再等一拍（React 重渲染）才点「允许」，否则按钮读到的还是旧 scope。
4. **「本次会话信任」面板在「平台包」视图**（不在宿主事件视图）—— 界面对账要先切视图。
5. **淘宝登录态跨 Electron 重启保住了**（第十阶段 partition 持久化在真实站点上成立）。
6. **导出物基线是 15 + 增量**：11-02 的 15 个一条没删；11-03 e2e 新造 2 个 → 17；本阶段 F7 再 +1 → 18。

---

## 6. 红线（照旧）

- **禁删用户文件**：`<userData>/host-events/exports/`（现 17 个，本阶段会 +1）；
  `<userData>/Partitions/ecclaw-profile-*` 是用户登录数据 → `removeHostProfile` **只删配置记录**。
- 禁 `git init` / `git commit`（项目非 git 仓库）。
- `openclaw.json`（明文 relay key）与 `host-bridge.json`（token）勿外传。
- Electron 内 spawn 内核/MCP 必须带 `ELECTRON_RUN_AS_NODE=1`；护栏默认 `ask`；别去掉 `persist:` 前缀。
- **真实站点只用 `scroll` 做写操作验证**（click 可能下单 —— 淘宝点一下就下单）。
- 临时产物写 `C:\Temp\`；记忆写 `memory/` 文件夹，**handoff / task 文档不得放进 memory 文件夹**。
- GUI 验证走 **CDP**（`--remote-debugging-port=9222`），不用 computer-use。
