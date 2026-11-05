# ecclaw 宿主 MCP 接入（2026-11-02）

> 目标：让 openclaw 的 agent **真正执行**平台包能力，而不只是「知道有哪些能力 id」。
> 上游依据：openclaw 内核自带 MCP 客户端（`mcp.servers` 配置项，stdio / sse / streamable-http）。

## 1. 链路

```
openclaw agent（ecclaw 的对话链路：openclaw agent --local --json）
      │  MCP 工具调用（stdio，JSON-RPC 2.0，newline 分隔）
      ▼
resources/mcp/host-server.mjs        ← 由 openclaw 拉起（孙子进程）
      │  HTTP POST 127.0.0.1:<port>  +  header: x-ecclaw-token
      ▼
electron/main/host-bridge.ts         ← Electron 主进程（loopback HTTP + 随机 token）
      ▼
electron/main/host-service.ts        ← open / read-dom / action / data-query / extract / observe
      ▼
BrowserHost（WebContentsView） + platform-actions（子进程加载 runtime.cjs）
```

为什么必须隔一层桥：MCP 服务进程是 **openclaw 的孙子进程**，拿不到 Electron 的 webContents；
而宿主能力只在主进程里。桥是「本机回环 + 随机 token」，token 落在 `<stateDir>/host-bridge.json`。

## 2. 宿主桥协议

- 监听：`127.0.0.1:0`（系统分配端口），仅本机可达。
- 鉴权：请求头 `x-ecclaw-token` 必须等于端点文件里的 `token`（`crypto.randomBytes(24).toString('hex')`）。
- 路由：只有 `POST /rpc`，body：`{ "op": "<op>", "params": { ... } }`。
- 响应：`200 { "result": ... }` / `500 { "error": "..." }`。

| op | params | 返回 |
|---|---|---|
| `status` | — | 宿主状态（当前页面 + 摆放位置） |
| `capabilities` | — | 18 个平台包的能力目录（包 id / 页面 / 动作 id / 数据查询 id / 观察器 id） |
| `open` | `{url}` | 页面信息 |
| `read-dom` | `{url}` | DOM 概览 |
| `action` | `{packageId, capability, payload, url?}` | `HostCommandResult` |
| `data-query` | `{packageId, queryId, args, url?}` | `HostCommandResult` |
| `extract` | `{packageId, pageId?, url?}` | `HostCommandResult` |
| `observe` | `{packageId, pageId?, url?}` | `HostCommandResult` |

## 3. MCP 工具表（8 个）

| 工具 | 用途 |
|---|---|
| `ecclaw_list_capabilities` | 列出平台包与能力目录（agent 的「查手册」入口） |
| `ecclaw_open_page` | 宿主里打开 URL |
| `ecclaw_read_dom` | 打开并读 DOM 概览（只读） |
| `ecclaw_run_action` | 执行页面动作能力（capability id + payload） |
| `ecclaw_run_data_query` | 执行数据查询能力（queryId + args） |
| `ecclaw_run_extract` | 执行页面提取（只读） |
| `ecclaw_run_observe` | 执行页面观察（网络响应 / 轮询 / 页面信号） |
| `ecclaw_host_status` | 宿主当前状态 |

**openclaw 会给工具名加前缀**：实际工具名是 `ecclaw-host__ecclaw_run_extract`（服务器名 + 双下划线）。
托管技能文本里已按这个写。

## 4. openclaw 配置

```json5
{
  mcp: {
    servers: {
      "ecclaw-host": {
        "enabled": true,
        "transport": "stdio",
        "command": "<process.execPath>",           // electron.exe
        "args": ["<stateDir>/mcp/host-server.mjs"],
        "env": {
          "ELECTRON_RUN_AS_NODE": "1",            // 必须：否则 electron.exe 以「应用模式」启动，脚本不执行
          "ECCLAW_HOST_BRIDGE_FILE": "<stateDir>/host-bridge.json",
          "PATH": "…", "SystemRoot": "…", "TEMP": "…", "USERPROFILE": "…", "HOME": "…"
        }
      }
    }
  }
}
```

- ecclaw 启动时（`app.whenReady`）自动写入 `mcp.servers.ecclaw-host`（只动自己那一个键）。
- 脚本源文件 `resources/mcp/host-server.mjs` 会被复制到 `<stateDir>/mcp/host-server.mjs` 再被拉起
  → 运行期不依赖打包路径（打包时记得把 `resources/` 收进应用产物）。
- 上游 schema 允许顶层 `mcp`（`additionalProperties` 只卡 `models.providers.<id>`）。

## 5. 踩过的坑

1. **`exactEnv`**：openclaw 拉起 stdio MCP 服务时**只给配置里的 env**，不继承父进程环境。
   → `ELECTRON_RUN_AS_NODE` / `ECCLAW_HOST_BRIDGE_FILE` / `PATH` / `SystemRoot` / `TEMP` 必须写全。
2. **electron.exe 当 node 用**：`command` 用 `process.execPath` 可以，但 env 里必须有
   `ELECTRON_RUN_AS_NODE=1`（和内核启动同一个坑：不加就以「Electron 应用」模式跑，脚本根本不执行）。
3. **工具名有前缀**：写文档/技能时要说 `ecclaw-host__xxx`，否则 agent 会去找不存在的工具名。
4. **stdout 只能有协议消息**：MCP 服务的任何日志都走 stderr，否则会破坏 JSON-RPC 帧。
5. **协议版本**：服务端直接回显客户端的 `protocolVersion`（最省事、不会触发版本协商失败）。
6. **host-bridge.json 是唯一凭据载体**：它就是「谁能调宿主」的钥匙，权限随用户目录；不要复制到别处。

## 6. 验证配方

```bash
# a) 内核侧连通性（最快）
cd F:/soft/00selfmade/ecclaw
STATE="C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw"
HOME="C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw" OPENCLAW_STATE_DIR="$STATE" \
OPENCLAW_CONFIG_PATH="$STATE/openclaw.json" \
  node node_modules/openclaw/openclaw.mjs mcp doctor ecclaw-host --probe      # → ecclaw-host: ok

# b) 直接对话 MCP 服务（不经过模型）
node C:/Temp/ecclaw-verify/mcp-driver.cjs "$STATE/mcp/host-server.mjs" "$STATE/host-bridge.json" \
  ecclaw_list_capabilities

# c) 端到端（真模型 + 真宿主）
HOME="C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw" USERPROFILE="$HOME" \
OPENCLAW_STATE_DIR="$STATE" OPENCLAW_CONFIG_PATH="$STATE/openclaw.json" ECCLAW_DESKTOP=1 \
  node node_modules/openclaw/openclaw.mjs agent --local --json --session-id mcp-e2e \
  --message "请调用 MCP 工具 ecclaw-host__ecclaw_run_extract，参数 packageId=ecclaw-observer-demo，url=http://127.0.0.1:8898/demo，然后只告诉我页面标题。"
```

实测结果（2026-11-02）：
- `mcp doctor` → `ecclaw-host: ok`
- `tools/list` → 8 个工具
- `tools/call ecclaw_run_extract` → `{ok:true,value:{url,title:"ECCLAW 宿主验证页",tabId:1,pageIdentity},durationMs:88}`
- agent 端到端 → toolSummary 含 `ecclaw-host__ecclaw_run_extract`，failures 0，agent 答「页面标题：ECCLAW 宿主验证页」
