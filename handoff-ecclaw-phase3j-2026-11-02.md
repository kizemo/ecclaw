# handoff · ecclaw 第十阶段（phase3j）· 2026-11-02（收官 · 真机已验）

> 主题：护栏中间档（信任范围四档 + 白名单粒度两维）· 事件落盘与回放 · 登录态持久 partition
> 上一阶段：第九阶段（phase3i）—— `handoff-ecclaw-phase3i-2026-11-02.md`
> 权威背景：`handoff-ecclaw-phase2-2026-11-01.md`
> 状态：**代码完成 + 真机验证全绿 + 文档已补齐**（本阶段收官）

---

## 1. 这一阶段做了什么

| # | 事项 | 状态 |
|---|---|---|
| 1 | 护栏中间档：once / session / persistent / persistent-scroll 四档 + 白名单粒度（match × ops × ttl） | ✅ 代码 + **真机 15/15 断言全绿** |
| 2 | 事件持久化与回放：按天 JSONL 落盘 + `ecclaw_event_replay` 工具（16→17） | ✅ 代码 + **真机 12/12 全绿** |
| 3 | 登录态持久化：`partition: 'persist:ecclaw-host'` | ✅ 代码 + **真机跨重启保留（正常退出）** |
| 4 | 真实站点登录态复验 | ❌ 未做（需用户本人账号，风险自负）；**只读已复验**：淘宝正常，amazon = AWS WAF 挑战页 |

> 上一次会话撞上下文墙时**一行真机验证都没跑**；本次会话把 §4 清单全部跑完并补齐文档。

---

## 2. 改动清单（全部未 commit —— 本项目不是 git 仓库）

### 新增文件

| 文件 | 作用 |
|---|---|
| `docs/ecclaw-护栏中间档与事件落盘-2026-11-02.md` | 本阶段设计与坑（§5 已改成真机验证结果） |
| `C:/Temp/ecclaw-verify/scope-watcher.cjs` | 看门狗（选范围 + 点允许） |
| `C:/Temp/ecclaw-verify/scope-e2e.cjs` | **四档 scope 端到端（p1/p2/p3，跨重启）** |
| `C:/Temp/ecclaw-verify/event-replay-e2e.cjs` | **事件落盘与回放端到端** |
| `C:/Temp/ecclaw-verify/login-state-e2e.cjs` | **登录态跨重启（set / check 两段）** |
| `C:/Temp/ecclaw-verify/guard-ui-check.cjs` | 「已信任站点」标签行 + 移除按钮 |
| `handoff-ecclaw-phase3j-2026-11-02.md` / `prompt-ecclaw-phase3j-next.md` | 本阶段交接 |

### 修改文件

| 文件 | 改动 |
|---|---|
| `electron/main/write-guard.ts` | 白名单条目升级为 `{host, match, ops, ttl}`（**兼容旧字符串数组**）；新增 `sessionRules` 内存规则、`scopeRule()`、`listGuardRules()`、`removeGuardRule()`；`isSiteAllowed(url, op)` 改为看 op；`resolveWriteApproval(id, approved, scope)` 第三参由 boolean 改 scope |
| `electron/main/host-events.ts` | 新增按天 JSONL 落盘（`<userData>/host-events/`）、`replayHostEvents()`、`hostEventLogInfo()`、`initHostEventLog()` |
| `electron/main/host-service.ts` | 新增 `hostReplayEvents()` / `hostEventLogInfo()` |
| `electron/main/host-bridge.ts` | 新 op `event-replay` / `event-log-info` |
| `electron/main/browser-host.ts` | 新增 `HOST_PARTITION = 'persist:ecclaw-host'`，WebContentsView 用它（登录态跨重启保留） |
| `electron/main/index.ts` | IPC：`host:write-approval-respond`（scope）、`host:write-guard-allowlist`、`host:write-guard-allowlist-remove`、`host:host-event-replay`、`host:host-event-log-info`；启动时 `initHostEventLog()` |
| `electron/preload/index.ts` | `respondApproval(id, approved, scope)`、`guardAllowlist()`、`removeGuardAllow(rule)`、`replayHostEvents()`、`hostEventLogInfo()` |
| `electron/shared/types.ts` | 新增 `ApprovalScope`、`AllowRule`；EcclawApi.host 补 4 个方法 |
| `resources/mcp/host-server.mjs` | 新工具 `ecclaw_event_replay`（工具数 16 → **17**） |
| `src/App.tsx` | 确认卡片改「信任范围」下拉 + 允许/拒绝；宿主卡片新增「已信任站点」标签行 + 移除按钮 |
| `src/views/HostEvents.tsx` | 新增「历史回放（事件已落盘）」面板 |
| `src/api.ts` | 导出 `ApprovalScope` / `AllowRule` |
| `README.md` | §5.9 工具数 16→17；**新增 §5.14**（四档 scope / 白名单粒度 / 事件落盘 / 登录态 partition）；§8 状态与实测 |
| `task.md` | 新增「第十阶段」小节（10 项交付 + 5 条实证发现），并更新顶部状态行 |
| `C:/Temp/ecclaw-verify/fixture-writer.cjs` | 加 `/set-probe`、`/api/writer/probe` 两条路由（登录态验证用） |

---

## 3. 契约（记住这几条就够用）

### 3.1 护栏范围（ApprovalScope）

```jsonc
"once"               // 只放行这一次（默认，不记规则）
"session"            // 内存规则：本次宿主运行内信任该域名，重启即失效
"persistent"         // 落盘：永久信任该域名（含子域，全部写操作）
"persistent-scroll"  // 落盘：永久信任该域名，但只放行滚动，点按仍逐次确认
```

### 3.2 白名单条目

```jsonc
{
  "hostWriteGuardAllowlist": [
    "127.0.0.1",                                      // 旧格式 = domain/all/persistent
    { "host": "taobao.com", "match": "domain",        // domain=含子域 / host=精确主机
      "ops": "scroll", "ttl": "persistent" },         // all / scroll
    { "host": "shop.example.com", "match": "host",
      "ops": "all", "ttl": "session" }                // persistent / session
  ]
}
```

判定顺序：ui/非写操作 → allow 档 → **白名单（看 ops 与 op 是否匹配）** → deny 档 → 弹卡。
白名单检查在 `ask` 判定**之前**，只作用于 `source=agent`。

### 3.3 事件落盘与回放

```
落盘：<userData>/host-events/events-YYYY-MM-DD.jsonl（每天一个文件，保留 14 天）
回放：ecclaw_event_replay({sinceSeq, untilSeq, sinceAt, untilAt, packageId, pageId, kind, limit})
      → 按 seq 升序返回，limit 默认 200、上限 2000
日志概况：桥 op event-log-info → {dir, days[], total}
```

### 3.4 登录态 partition

```ts
export const HOST_PARTITION = 'persist:ecclaw-host'
```

cookie / localStorage 落 `<userData>/Partitions/ecclaw-host/`，**重启后仍在**；
且不与宿主渲染进程共享 cookie。**别改回默认 session，也别去掉 `persist:` 前缀。**

---

## 4. 真机验证结果（本次会话跑完，全部可复现）

| 脚本 | 断言 | 结果 |
|---|---|---|
| `scope-e2e.cjs p1/p2/p3` | once 两次都问且不写白名单 / session 二次放行且**重启后失效** / persistent 落盘+二次放行+**跨重启仍放行** / persistent-scroll 滚动放行、点按仍问 | **15/15 ✅** |
| `event-replay-e2e.cjs` | 回放升序、包过滤、空结果、磁盘 JSONL 逐行合法、`event-log-info`、界面面板 | **12/12 ✅** |
| `login-state-e2e.cjs set/check` | 种 cookie → 正常退出重启 → cookie 仍在 | **✅** |
| `guard-ui-check.cjs` | 「已信任站点」标签行 + 移除按钮（settings 同步少一条） | **✅** |
| `real-site-check.cjs` | 淘宝只读正常（h1=淘宝网、52 元素、1907 链接）；amazon = AWS WAF 挑战页 | ⚠️ 部分 |
| `pnpm typecheck && pnpm build` | ✓ / ✓（renderer 616.18 kB） | ✅ |

---

## 5. 环境与基线（当前真机状态）

- **Electron 已优雅关闭**（本会话末尾 `CloseMainWindow()`），**当前没有 Electron 在跑**。
- fixture 在监听：**8897** 写操作页（PID 已变，见 `netstat`；含 `/api/writer/stats`、`/set-probe`、`/api/writer/probe`）、
  **8898** 只读页。
- 启动命令（**必须**用这个，后台 bash 任务方式启动会被回收）：

  ```
  powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"
  ```

  （脚本内含 `ECCLAW_LOCAL_PACKAGES_DIR=C:/Users/Duanyi/AppData/Roaming/com.dabiai.desktop/platform-packages`）
- 端点文件：`C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json`（端口每次随机）
- settings：`C:/Users/Duanyi/AppData/Roaming/ecclaw/ecclaw-settings.json`
  当前 `hostWriteGuard=ask`；`hostWriteGuardAllowlist=[]`（**本会话测完已清空**，干净基线）
- 内核目录：`C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/`
- GUI 验证走 **CDP**（`/json/list` 选 `url.includes('out/renderer/index.html')` 的 target），**不要用 computer-use**
- `host:read-dom` 会重开 URL → 验证页面状态变化用 fixture 的**服务端计数** `/api/writer/stats`

---

## 6. 踩坑与坑位（本次新增，第九阶段及以前的坑见 `handoff-ecclaw-phase3i-2026-11-02.md` §5）

1. **同 host 上「all 规则」盖掉「scroll 规则」**：验 `persistent-scroll` 必须换 host
   （本轮用 `localhost` 隔离 `127.0.0.1`），否则「点按仍问」触发不了。
2. **`persist:` partition 的 cookie 强杀会丢**：`taskkill /F` 不让 Chromium 刷 cookie 库；
   必须「关窗口 / `CloseMainWindow()`」再重启，登录态才留得住。
3. **Electron 实例只能占一个 `--remote-debugging-port`**：没杀干净就重启会出现两个实例，
   CDP 9222 指向**旧**实例的渲染进程（看门狗点的是旧进程的卡片）→ 重启前先杀干净再起。
4. **旧格式白名单字符串落盘时会升级成对象条目** —— 行为不变，但 settings 里格式会变，别误判成 bug。
5. **确认卡片下拉是 React 受控组件**：CDP 改 `select.value` 必须 native setter +
   `dispatchEvent('change')`，改完等 500ms 再点「允许」。且 scope 是**共享 state**，
   上一张卡选过的值会成为下一张的默认值，测试要每次显式设值。
6. **MCP 脚本有副本**：`resources/mcp/host-server.mjs` 会被复制到 `<stateDir>/mcp/`；
   改完 MCP 工具**必须重启 Electron**，否则跑的还是旧副本。

---

## 7. 下一阶段必交付（按优先级）

1. **真实站点登录态闭环**（需用户本人账号，写操作风险自负）：
   - 先只读：`ecclaw_open_page` + `ecclaw_read_dom` / `ecclaw_run_extract`；
   - 再写：护栏四档在真实站点上的表现（建议先 `session`，别一上来 `persistent`）；
   - 已知：淘宝只读正常；**amazon.com 返回 AWS WAF 挑战页**（反爬，非宿主 bug）。
2. **事件落盘的后续**：是否给 agent 一个「按 packageId 汇总」的视图；
   落盘目录的清理策略是否要更细（现在是按天 + 14 天）。
3. **护栏的后续**：白名单条目是否要支持「精确路径」维度；`session` 规则要不要可视化到界面。
4. **第二阶段候选**（长期）：邮件 worker、画布宿主、PDF/Docx 预览、OCR、店铺登录态 profile。

---

## 8. 红线（勿违）

不重做逆向（REA 已结案）· 不改已定案平台包协议（`runtime.cjs` 一律子进程加载）·
不删 `C:/Temp/rea-dabi` 与 `C:/Temp/ecclaw-verify` · 禁止删除用户文件 ·
不 git init / commit · openclaw.json 含明文 relay key，勿外传 · relay 对话最小化 ·
宿主页面 sandbox + contextIsolation + nodeIntegration=false · 宿主桥 token 文件勿外传 ·
临时产物写 `C:/Temp/` · Electron 内 spawn 必带 `ELECTRON_RUN_AS_NODE=1` ·
护栏策略默认保持 `ask` · **GUI 验证走 CDP，不用 computer-use**。

---

## 9. 必读顺序

1. `docs/ecclaw-护栏中间档与事件落盘-2026-11-02.md` —— 本阶段设计 + 实测表 + 坑
2. `README.md` §5.14（新增） / §5.9 / §5.11–5.13 / §8 —— 本阶段已更新
3. `task.md` 第十阶段（新增） —— 交付项与实证发现表
4. `handoff-ecclaw-phase3i-2026-11-02.md` —— 上一阶段（两段式 + 白名单 + poll）
5. `memory/ecclaw_phase3j_guard_scope.md` —— 第十阶段要点（记忆）
