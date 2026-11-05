# handoff — ecclaw 第六阶段收官（宿主接进对话链路 · MCP）

> 承接 `handoff-ecclaw-phase3e-2026-11-02.md`（第五阶段收官：内嵌浏览器宿主四通道全绿）。
> 权威背景仍以 `handoff-ecclaw-phase2-2026-11-01.md` 为准；本文件只写**本轮增量**。

## 1. 本次交付（全部已验证）

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 宿主桥（loopback HTTP） | ✅ | `electron/main/host-bridge.ts`：主进程 `127.0.0.1:<随机端口>`，请求须带 `x-ecclaw-token`；端点写 `<stateDir>/host-bridge.json` |
| 2 | 宿主 MCP 服务（stdio） | ✅ | `resources/mcp/host-server.mjs`（手写 JSON-RPC 2.0）；8 个工具；`tools/list` 实测全列出 |
| 3 | 注册进 openclaw 配置 | ✅ | `electron/main/mcp-bridge.ts` → `mcp.servers.ecclaw-host`；启动日志 `[ecclaw] MCP 服务已注册：ecclaw-host` |
| 4 | openclaw 内核侧连通 | ✅ | `openclaw mcp doctor ecclaw-host --probe` → **`ecclaw-host: ok`** |
| 5 | agent 真调用（能力目录） | ✅ | `agent --local --json` → toolSummary 含 `ecclaw-host__ecclaw_list_capabilities`，failures 0；答「18 个平台包，第一个 1688」 |
| 6 | agent 真调用（宿主执行） | ✅ | agent 调 `ecclaw-host__ecclaw_run_extract{packageId:ecclaw-observer-demo,url:http://127.0.0.1:8898/demo}` → `{ok:true,title:"ECCLAW 宿主验证页"}`，agent 答标题正确 |
| 7 | 托管技能文本同步 | ✅ | 「使用边界」由「不执行动作」改为「可执行 + MCP 工具清单（含 `ecclaw-host__` 前缀）」；18 包技能已重新生成 |
| 8 | typecheck + build | ✅ | `pnpm typecheck` ✓；`pnpm build` ✓ |

## 2. 关键事实（本轮新增）

### 2.1 链路

```
openclaw agent → MCP(stdio) → resources/mcp/host-server.mjs
              → HTTP 127.0.0.1 + token → 主进程 host-bridge
              → host-service → BrowserHost / platform-actions
```

MCP 服务进程是 **openclaw 的孙子进程**，够不到 Electron 主进程 → 必须隔一层桥。

### 2.2 工具表（8 个，实际名带 `ecclaw-host__` 前缀）

`ecclaw_list_capabilities` / `ecclaw_open_page` / `ecclaw_read_dom` / `ecclaw_run_action` /
`ecclaw_run_data_query` / `ecclaw_run_extract` / `ecclaw_run_observe` / `ecclaw_host_status`

### 2.3 三个硬坑

1. **openclaw 用 `exactEnv` 拉起 stdio MCP 服务**（只给配置里的 env，不继承父进程环境）
   → `ELECTRON_RUN_AS_NODE=1` / `ECCLAW_HOST_BRIDGE_FILE` / `PATH` / `SystemRoot` / `TEMP` 必须写全在
   `mcp.servers.*.env`。
2. **`command` 用 `process.execPath`（electron.exe）可行**，前提是 env 带 `ELECTRON_RUN_AS_NODE=1`
   （和内核启动同一个坑：不加则以「Electron 应用」模式启动，脚本不执行）。
3. **MCP 服务 stdout 只能有协议消息**，日志一律走 stderr；协议版本直接回显客户端的 `protocolVersion`。

### 2.4 其它事实

- 上游 schema **允许顶层 `mcp`**（`additionalProperties:false` 只卡 `models.providers.<id>`）。
- MCP 服务脚本从 `resources/mcp/` 复制到 `<stateDir>/mcp/` 再启动 → 运行期不依赖打包路径
  （**打包时要把 `resources/` 收进产物**）。
- `host-bridge.json` 就是「谁能调宿主」的钥匙，只落在用户目录，不要外传。
- agent 不读技能也能用工具（MCP 由内核自动发现）；技能文本只负责告诉 agent「有哪些能力 id、怎么调」。

## 3. 改动清单（项目非 git 仓库，无 commit）

**新增**
- `electron/main/host-bridge.ts`（loopback HTTP 桥 + capabilities 目录）
- `electron/main/mcp-bridge.ts`（复制 MCP 脚本 + 写 `mcp.servers.ecclaw-host`）
- `resources/mcp/host-server.mjs`（MCP stdio 服务）
- `docs/ecclaw-宿主-MCP接入-2026-11-02.md`（协议 / 工具表 / 坑 / 验证配方）

**修改**
- `electron/main/index.ts`：`app.whenReady` 里 `startHostBridge()` + `ensureMcpServer()`；新增 IPC `host:bridge-status`
- `electron/main/package-skills.ts`：「使用边界」文案 + 顶部注释（改为「可执行」）
- `task.md`（第六阶段表 + 8 条实证发现 + 头部状态）、`README.md`（新增 §5.9、§8 状态）

**临时验证脚本**（`C:/Temp/ecclaw-verify/`，勿删）
`mcp-driver.cjs`（手搓 MCP 客户端：initialize/tools/list/tools/call）、
`mcp-sync-skills.cjs`（CDP 触发 `window.ecclaw.packages.syncSkills()`）

## 4. 验证配方（照抄）

```bash
cd F:/soft/00selfmade/ecclaw && pnpm build
ECCLAW_LOCAL_PACKAGES_DIR="C:/Users/Duanyi/AppData/Roaming/com.dabiai.desktop/platform-packages" \
  npx electron . --remote-debugging-port=9222        # 后台
cd C:/Temp/ecclaw-verify && node fixture-server.cjs  # 8898，后台

STATE="C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw"
HOME="C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw" USERPROFILE="$HOME" \
OPENCLAW_STATE_DIR="$STATE" OPENCLAW_CONFIG_PATH="$STATE/openclaw.json" \
  node node_modules/openclaw/openclaw.mjs mcp doctor ecclaw-host --probe     # → ecclaw-host: ok
node C:/Temp/ecclaw-verify/mcp-driver.cjs "$STATE/mcp/host-server.mjs" "$STATE/host-bridge.json" ecclaw_list_capabilities
```

端到端（真模型）：同 env 下 `node node_modules/openclaw/openclaw.mjs agent --local --json --session-id mcp-e2e
--message "请调用 MCP 工具 ecclaw-host__ecclaw_run_extract，参数 packageId=ecclaw-observer-demo，url=http://127.0.0.1:8898/demo，然后只告诉我页面标题。"`

坑（沿用）：CDP 多 target 要按 `/index\.html$/` 选主应用；8898 端口可能被旧进程占；
computer-use 截屏全黑 → 一律 CDP 驱动。

## 5. 环境状态（交接时）

- electron：**运行中**（后台任务 `bf5g62od8`，含 9222 调试端口；宿主桥端口随机，每次启动会变）
- fixture server：**交接时未能复验**（收尾时上下文闸门触发，Bash 被拦）。
  最后一次确认是在跑（8898，PID 10620，页面含 `/api/demo/echo` + 1.2s 定时请求），但期间有旧后台任务
  报「Start fixture server failed」——那是历史遗留任务的退出码，不一定代表当前进程死了。
  下轮开工先 `netstat -ano | grep 8898` 确认；不在就 `cd C:/Temp/ecclaw-verify && node fixture-server.cjs`（后台）。
- ecclaw 状态目录：`C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/`
  （注意：与 dabi 的 `com.dabiai.desktop` 目录是**两套**，别混）
- 项目**不是 git 仓库**：无 commit、无 git init 要求

## 6. 下一步（按优先级）

1. **写操作能力**（仍是最大缺口）：最小 SDK 的 `browser.click` / `scroll` / `interceptNext` /
   `waitForNavigation` 抛「暂不支持」，dabi 的准备阶段（`automationActions`）依赖它们；
   宿主已有 CDP 通道，补 `Input.dispatchMouseEvent` 一类即可。
2. **真实站点复验 observe**：只在 fixture 上验过；可用 doudian-compass 的
   `urlIncludes:["/compass_api/shop/common/homepage/"]` 在真实站点跑一次 network-response。
3. **poll 持续刷新**：当前 poll 只触发一次，dabi 是持续刷新（侧栏联动），可加订阅式形态。
4. **对话页暴露宿主状态**：把 `host:bridge-status` 接到 UI，让用户看到「宿主桥已就绪 / MCP 已注册」。
5. **写操作护栏**：agent 直接写操作前需要确认机制（当前是 straight-through）。

## 7. 红线与避坑（沿用，勿违）

- 不重做逆向（REA 已结案）；不改已定案的平台包协议；`runtime.cjs` 一律子进程加载
- 不删 `C:/Temp/rea-dabi`、`C:/Temp/ecclaw-verify`；禁止删除用户文件；临时产物写 `C:/Temp/`
- 项目非 git 仓库 → 不要 `git init` / `commit`
- `openclaw.json` 含明文 relay key → 勿外传；relay 对话保持最小
- Electron 内 spawn 必带 `ELECTRON_RUN_AS_NODE=1`
- 宿主页面 sandbox + contextIsolation + nodeIntegration=false
- 宿主桥是本机回环 + token，token 文件不要外传

## 8. 必读顺序

1. 本文件 §1（交付与证据）→ §2（链路与坑）
2. `docs/ecclaw-宿主-MCP接入-2026-11-02.md`（协议 / 工具表 / 验证配方）
3. `docs/dabi-宿主契约-context字段清单-2026-11-02.md`（宿主契约）
4. `electron/main/host-bridge.ts` + `electron/main/mcp-bridge.ts` + `resources/mcp/host-server.mjs`
5. `task.md` 第六阶段表
