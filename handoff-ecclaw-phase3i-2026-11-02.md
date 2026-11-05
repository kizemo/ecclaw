# handoff · ecclaw 第九阶段（phase3i）· 2026-11-02

> 主题：两段式写操作确认 · 护栏粒度（站点白名单）· poll 订阅式持续刷新
> 上一阶段：第八阶段（phase3h）—— `handoff-ecclaw-phase3h-2026-11-02.md`
> 权威背景：`handoff-ecclaw-phase2-2026-11-01.md`（平台包协议定案）

---

## 1. 这一阶段做了什么

第八阶段留的四件事，本阶段做完三件半：

| # | 事项 | 状态 |
|---|---|---|
| 1 | 两段式写操作确认（票据化，人等 MCP 超时解耦） | ✅ 完成并真机验证 |
| 2 | poll 订阅式持续刷新（宿主侧长轮询 + 渲染进程增量更新） | ✅ 完成并真机验证 |
| 3 | 护栏粒度：一次授权一批 / 站点白名单 | ✅ 完成并真机验证 |
| 4 | 真实站点复验（taobao / amazon / doudian-compass） | ⚠️ 只读部分完成；登录态写操作闭环未做（风险自负） |

---

## 2. 改动清单（全部未 commit —— 本项目不是 git 仓库）

### 新增文件

| 文件 | 作用 |
|---|---|
| `electron/main/host-events.ts` | 宿主事件总线：环形缓冲 200 条 + 长轮询等待者 + 渲染进程推送 |
| `src/views/HostEvents.tsx` | 「宿主事件」面板：持续观察列表 + 增量事件流 |
| `docs/ecclaw-两段式写操作确认-2026-11-02.md` | 两段式 + 白名单的设计与实测 |
| `docs/ecclaw-poll订阅式持续刷新-2026-11-02.md` | 持续刷新的设计与实测（含真实站点复验） |
| `handoff-ecclaw-phase3i-2026-11-02.md` / `prompt-ecclaw-phase3i-next.md` | 本阶段交接 |

### 修改文件

| 文件 | 改动 |
|---|---|
| `electron/main/write-guard.ts` | **整体重写**：票据存储 + 状态机 + `requestWriteApproval`（两段式）/ `runWithWriteApproval`（阻塞式）；站点白名单（`writeGuardAllowlist` / `allowSite` / `isSiteAllowed`） |
| `electron/main/browser-host.ts` | `runOp(op, params, {mode:'blocking'|'deferred'})`，click/scroll 分叉两种等待形态 |
| `electron/main/host-service.ts` | watch 管理（`hostStartWatch` / `hostStopWatch` / `hostListWatches`）+ `hostNextEvent`；写操作走两段式 |
| `electron/main/host-bridge.ts` | 新增 op：`approval-status` / `watch` / `watch-stop` / `watch-list` / `next-event` |
| `electron/main/platform-actions.ts` | runner 新增 `spec.continuous` 分支；`runRunner` 支持 `RunnerOptions`；抽出 `installObservers()`；新增 `startContinuousObserve()` |
| `electron/main/index.ts` | 推送 `host:write-approval-update` / `host:host-event`；新增 IPC（approval-status / respond / host-events / event-next / watch-*） |
| `electron/preload/index.ts` | 新增 6 个 host API（`approvalStatus` / `respondApproval(+allowSite)` / `onHostEvent` / `hostEvents` / `nextHostEvent` / `startWatch` / `stopWatch` / `listWatches`） |
| `electron/shared/types.ts` | `WriteApprovalStatus` / `WriteApproval` / `HostEvent` / `HostWatch` |
| `resources/mcp/host-server.mjs` | MCP 工具 **12 → 16**：新增 `ecclaw_approval_status` / `ecclaw_watch` / `ecclaw_watch_stop` / `ecclaw_next_event` |
| `src/App.tsx` | 「允许并信任本页面」按钮；「宿主事件」导航项；`answer()` 缩进修整 |
| `src/api.ts` | 导出新类型 |
| `README.md` | §5.9 工具数 12→16；新增 §5.12（两段式 + 白名单）、§5.13（持续刷新）；§8 状态 |
| `task.md` | 新增第九阶段小节 + 顶部状态块 |

---

## 3. 实测证据（全部真机）

### 3.1 两段式 —— 真 agent 端到端

脚本 `C:/Temp/ecclaw-verify/agent-two-stage-e2e.cjs`，真模型 `aliyun-maas/qwen3.8-max`：

- agent 实调 `ecclaw-host__ecclaw_click` 与 `ecclaw-host__ecclaw_approval_status`
- failures 0、exitCode 0、stderr 里 `MCP error` **0 次**
- 票据 `w-mvyik2wr-2` → `status=executed`，`result={ok:true,mode:"dom-click",selector:"#btn-increment"}`
- fixture 服务端计数 **1→2**，pendingLeft = 0
- agent 原话：「确认已通过并执行成功：`#btn-increment` 在 http://127.0.0.1:8897/ 上以 dom-click 方式完成点击（approvalId w-mvyik2wr-2，status=executed，ok=true）。」

拒绝路径（`two-stage-e2e.cjs deny`）：pending → 点「拒绝」→ `status=rejected`、
`error="用户拒绝了本次写操作"`、计数 **1→1**（没点）。

### 3.2 站点白名单

脚本 `C:/Temp/ecclaw-verify/whitelist-e2e.cjs`：

| 步骤 | 实测 |
|---|---|
| 首次 `ecclaw_click` | 60ms → `{status:"pending", approvalId:"w-mvyiyu74-1"}` |
| 看门狗点「允许并信任本页面」 | → `status=executed`，`result={ok:true,mode:"dom-click"}` |
| fixture 服务端计数 | 2 → 3 |
| `ecclaw-settings.json` | `hostWriteGuardAllowlist = ["127.0.0.1"]`（已落盘） |
| 再次 `ecclaw_click` | **32ms 直接 `{status:"executed"}`**，不再弹卡 |
| fixture 服务端计数 | 3 → 4 |

### 3.3 poll 订阅式持续刷新

脚本 `C:/Temp/ecclaw-verify/poll-subscribe-e2e.cjs`（真 MCP 进程 + 真宿主 + 真渲染进程）：

```
[0] MCP 工具总数 = 16；三个新工具齐备 = true
[1] ecclaw_watch → [{"watchId":"w-mvyj5ghl-2","packageId":"ecclaw-observer-demo",
                     "pageId":"builtin:ecclaw-observer-demo-poll","eventCount":0}]
[2..4] next_event → seq 1 / 2 / 3（时间戳 47.298 → 48.107 → 48.919，间隔 ≈810ms，与包内 intervalMs=800 一致）
[5] 界面（CDP 读渲染进程）事件流：#4 #3 #2 #1 observe 全部在列
[6] watch_stop → []
[7] 停止后排干：残留 3 条，最终 null = true
断言整体通过 = true
```

### 3.4 真实站点只读复验

脚本 `C:/Temp/ecclaw-verify/real-site-check.cjs`（只开页 + 读 DOM，无写操作、无登录态）：

- **淘宝** `https://www.taobao.com/`：title=淘宝，h1=淘宝网，元素数 74，链接数 1944 —— 宿主在真实站点上工作正常。
- **亚马逊** `https://www.amazon.com/`：返回 **AWS WAF 挑战页**（正文含 `AwsWafIntegration.checkForceRefresh()`），
  元素数 0 —— **反爬拦截**，不是宿主能力问题。

---

## 4. 契约（记住这三条就够用）

### 4.1 写操作（两段式）

```jsonc
// ecclaw_click / ecclaw_scroll 的返回
{ "status": "pending", "approvalId": "w-xxx" }                        // 等用户点头
{ "status": "executed", "result": { "ok": true, "mode": "dom-click" } } // allow 档 / 白名单站点

// ecclaw_approval_status(approvalId)
{ "id":"w-xxx","op":"click","summary":"点击：选择器 #btn-increment · 页面 http://…",
  "status":"executed","result":{...},"createdAt":"…","updatedAt":"…" }
```

状态机：`pending → approved → executed | failed`；或 `pending → rejected | timeout`（后两者绝不执行，fail-closed）。

- 阻塞式（平台包 runner 用）窗口 **40s**（必须 < MCP 硬超时 60s）。
- 两段式（MCP 直连用）票据存活 **10 分钟**；终态票据保留 30 分钟后清理。
- 站点白名单在 `ask` 判定**之前**检查；只作用于 `source=agent`。

### 4.2 持续刷新

```jsonc
// ecclaw_watch({packageId, pageId}) → [{watchId, packageId, pageId, startedAt, eventCount}]
// ecclaw_next_event({sinceSeq, timeoutMs}) → {seq, kind:"observe", packageId, pageId, observationId, value, at}
//                                            或 null（超时，不是错误）
// ecclaw_watch_stop({watchId}) → 剩余 watch 列表
```

### 4.3 白名单存储

`ecclaw-settings.json`（`C:/Users/Duanyi/AppData/Roaming/ecclaw/ecclaw-settings.json`）：

```jsonc
{
  "hostWriteGuard": "ask",              // ask | allow | deny
  "hostWriteGuardAllowlist": ["127.0.0.1"]   // 域名数组，精确或 .后缀 匹配
}
```

---

## 5. 踩坑与坑位

1. **MCP SDK 客户端请求超时硬编码 60000ms**（`DEFAULT_REQUEST_TIMEOUT_MSEC`）。
   阻塞型窗口必须明显 < 60s；两段式是根治，不是把窗口调大。
2. **护栏超时后确认卡片不会自动消失** → 票据状态变化必须由主进程**推送**回渲染进程，
   否则用户点已过期卡片是空操作。
3. **测试看门狗会被旧卡片骗**：只认**还带按钮**（pending）的 `.approval-card`，
   否则上一轮留下的「已执行」卡片挡住，看起来像功能坏了。
4. **持续刷新必须在子进程里常驻**（一次 spawn 循环产出），不要「主进程反复 spawn」——
   包内 `intervalMs=800`，每轮一次进程创建太重。
5. **停止 watch 后缓冲区会残留 1~3 条已产出事件**（子进程 kill 有延迟）→
   测试要「排干到 null」，不能断言立刻 null。
6. **Electron 用后台任务方式启动会被静默回收** → 必须
   `powershell Start-Process`（`C:/Temp/ecclaw-verify/start-electron.ps1`）。
   fixture 进程（8897 / 8898）同样会被回收，验证前先 `netstat` 确认在监听。
7. **bash 里 `taskkill /PID` 要加 `MSYS_NO_PATHCONV=1`**（否则 Git Bash 把 `/PID` 当路径）。
8. **真实站点会被反爬挡**：亚马逊返回 AWS WAF 挑战页 —— 这是「无登录态 + 无真人特征」的必然结果，
   不是宿主 bug。

---

## 6. 环境与基线（当前真机状态）

- Electron：PID **618620**，`--remote-debugging-port=9222`，宿主桥端口 **62612**
  （每次启动随机；端点文件 `C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json`）。
- 启动命令（**必须**用这个，后台 bash 任务方式启动会被回收）：

  ```
  powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"
  ```

  （脚本内含 `ECCLAW_LOCAL_PACKAGES_DIR=C:/Users/Duanyi/AppData/Roaming/com.dabiai.desktop/platform-packages`）
- fixture：写操作页 **8897**（`fixture-writer.cjs`，含 `/api/writer/stats` 服务端计数）；
  只读页 **8898**（`fixture-server.cjs`，`/demo` 供 poll 观察器用）。
- 护栏策略：`hostWriteGuard=ask`；白名单当前含 `127.0.0.1`（测试留下的，
  想回到干净状态就把这个数组清空）。
- 内核目录：`C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/`（与 dabi 的 `com.dabiai.desktop` 是两套）。
- GUI 验证一律走 **CDP**（`/json/list` 选 `url.includes('out/renderer/index.html')` 的主应用 target）；
  **不要用 computer-use**（Electron 截屏全黑且拒输入）。
- `host:read-dom` 会重新打开 URL → 验证页面状态变化要用 fixture 的**服务端计数**。

---

## 7. 下一阶段必交付（按优先级）

1. **真实站点登录态复验**（需要用户自己的登录态；写操作闭环风险自负）。
   建议先只做只读（搜索/列表抽取），再考虑写操作。
2. **白名单的更多形态**：目前只有「本站点全放行」。可考虑「本页一次」「只放行只读操作」等中间档。
3. **事件的持久化与回放**：事件总线目前是进程内环形缓冲，崩了就丢；宿主包观察结果是否该落盘。
4. **第二阶段候选**（长期）：邮件 worker、画布宿主、PDF/Docx 预览、OCR、店铺登录态 profile。

---

## 8. 红线（勿违）

不重做逆向（REA 已结案）· 不改已定案平台包协议（`runtime.cjs` 一律子进程加载）·
不删 `C:/Temp/rea-dabi` 与 `C:/Temp/ecclaw-verify` · 禁止删除用户文件 ·
不 git init / commit · openclaw.json 含明文 relay key，勿外传 · relay 对话最小化 ·
宿主页面 sandbox + contextIsolation + nodeIntegration=false · 宿主桥 token 文件勿外传 ·
临时产物写 `C:/Temp/` · Electron 内 spawn 必带 `ELECTRON_RUN_AS_NODE=1`。

---

## 9. 必读顺序

1. `docs/ecclaw-两段式写操作确认-2026-11-02.md` —— 两段式 + 白名单
2. `docs/ecclaw-poll订阅式持续刷新-2026-11-02.md` —— 持续刷新 + 真实站点复验
3. `README.md` §5.9 / §5.11 / §5.12 / §5.13 —— MCP 工具面 + 护栏 + 票据 + 订阅
4. `task.md` 第九阶段 —— 交付项与实证发现表
5. `handoff-ecclaw-phase3h-2026-11-02.md` —— 上一阶段（护栏与 12 个工具）
