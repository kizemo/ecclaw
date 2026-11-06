# ecclaw

**基于 OpenClaw 内核的电商 AI 桌面端 —— 并且开放自定义大模型接入。**

ecclaw 是对 [dabi-desktop 3.0.18](https://xishui-oc.oss-cn-shanghai.aliyuncs.com)（闭源商业软件）的逆向复刻。
逆向结论见 [`docs/逆向分析-dabi-vs-openclaw.md`](docs/逆向分析-dabi-vs-openclaw.md)。

一句话结论：**dabi = 上游 OpenClaw 原版内核 + 自研 Electron 外壳 + 电商平台技能包**，
电商能力全部落在平台包与技能层，内核未改；dabi 的模型接入是**白名单式**（openai / anthropic / deepseek / moonshot），
**ecclaw 的增量就是把这个白名单拆掉** —— 任意 OpenAI 兼容 / Anthropic 兼容端点、本地推理（Ollama / LM Studio / vLLM），
以及从包目录一键安装第三方 Provider。

---

## 1. 架构

```
┌──────────────────────────────────────────────────────────────┐
│  renderer (React 19)                                         │
│  对话 · 大模型 · 技能 · 平台包 · 文件库                        │
└───────────────▲──────────────────────────┬───────────────────┘
                │ contextBridge (白名单)     │ HTTP/WS
┌───────────────┴──────────────────────────▼───────────────────┐
│  main (Electron)                                              │
│  ├ openclaw-config.ts  ← openclaw.json 读写 / Provider CRUD   │
│  ├ gateway.ts          ← openclaw 进程管理 + agent CLI 适配   │
│  ├ platform-packages.ts← 平台包注册表（两种布局 + 站点匹配）    │
│  └ library.ts          ← 技能（managed/user）+ 文件库         │
└───────────────────────────┬──────────────────────────────────┘
                            │ spawn + env
┌───────────────────────────▼──────────────────────────────────┐
│  openclaw 内核（上游原版，npm openclaw 2026.10.9）             │
│  openclaw agent --local --json  /  openclaw gateway --port N  │
│  状态根：<userData>/openclaw/.openclaw                        │
└──────────────────────────────────────────────────────────────┘
```

**接缝约定**（与 dabi 完全一致，见逆向报告第 4 节）：

| 项 | 路径 |
|---|---|
| openclaw 配置目录 | `<userData>/openclaw` |
| openclaw 状态目录 | `<userData>/openclaw/.openclaw` |
| openclaw 主配置 | `<userData>/openclaw/.openclaw/openclaw.json` |
| 托管技能 | `<stateDir>/skills` |
| 用户技能 | `<stateDir>/user-skills` |
| 用户平台包 | `<userData>/platform-packages` |
| ecclaw 自身设置 | `<userData>/ecclaw-settings.json` |

Windows 下 `<userData>` = `%APPDATA%\ecclaw`。

---

## 2. 目录结构

```
electron/
  shared/types.ts            IPC 契约（EcclawApi / ModelProvider / PlatformPackageManifest…）
  main/
    paths.ts                 所有路径的唯一来源
    openclaw-config.ts       ★ openclaw.json 读写 + Provider CRUD + 连通性测试
    gateway.ts               openclaw 进程管理、对话 CLI 适配
    platform-packages.ts     平台包注册表、站点匹配、文档读取
    library.ts               技能（managed/user）与文件库
    index.ts                 窗口 + 全部 IPC handler
  preload/index.ts           contextBridge 白名单 API
src/
  api.ts                     renderer 侧 API 入口（window.ecclaw）
  App.tsx                    侧栏 + 五个视图
  views/Chat.tsx             对话
  views/Models.tsx           ★ 大模型接入
resources/platform-packages/  内置示例包（taobao / 1688 / douyin）
docs/逆向分析-dabi-vs-openclaw.md
```

---

## 3. 安装与启动

前置：Node ≥ 26.12.1（openclaw 的 engines 要求）、pnpm。

```bash
pnpm install
pnpm dev          # 开发模式（electron-vite dev，监听 5173）
pnpm build        # 三段构建 → out/main | out/preload | out/renderer
pnpm typecheck    # tsc -p tsconfig.node.json / tsconfig.web.json
```

> **pnpm 注意事项**：pnpm 默认不执行依赖的构建脚本，electron 的二进制下载（postinstall）会被跳过，
> 表现为 `Error: Electron uninstall`。已在 `package.json` 里加 `"pnpm": { "onlyBuiltDependencies": ["electron"] }`；
> 若仍报此错，手动执行一次：
> ```bash
> cd node_modules/electron && node install.js
> # 国内网络可加镜像
> ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/" node install.js
> ```

---

## 4. 自定义大模型接入（ecclaw 核心增量）

在「大模型」页新增 Provider，配置写入 **openclaw 自己的配置格式**：

```jsonc
// <userData>/openclaw/.openclaw/openclaw.json
{
  "models": {
    "mode": "merge",              // 与内置模型目录合并，而不是覆盖
    "providers": {
      "my-gateway": {
        "baseUrl": "http://127.0.0.1:11434/v1/",
        "api": "openai-completions",
        "apiKey": "${MY_API_KEY}", // 支持 ${ENV} 占位，避免把密钥写进文件
        "models": [{ "id": "qwen2.5:7b", "name": "qwen2.5:7b" }]
      }
    }
  },
  "agents": {
    "defaults": { "model": { "primary": "my-gateway/qwen2.5:7b" } }
  }
}
```

### 4.1 schema 硬约束（踩过的坑）

上游 `models.providers.<id>` 是 **`additionalProperties: false`**，多写一个字段就会被
`openclaw config validate` 判为非法：

```
Unrecognized keys: "label", "defaultModel", "local"
```

所以 ecclaw 做了拆分：

| 放哪 | 内容 |
|---|---|
| `openclaw.json` → `models.providers.<id>` | 仅上游允许的键：`baseUrl` `apiKey` `auth` `api` `maxTokens` `timeoutSeconds` `region` `params` `agentRuntime` `localService` `headers` `authHeader` `request` `models` |
| `ecclaw-settings.json` → `providerMeta.<id>` | ecclaw 私有元数据：`label`（显示名）、`defaultModel`、`local`（本地端点标记） |

另外 ecclaw 写配置时会自动补 `gateway.mode: "local"`（openclaw 缺这个字段会拒绝启动），
并在填了「默认模型」时写 `agents.defaults.model.primary = "<provider>/<modelId>"`。

`api` 可选值（上游枚举）：
`openai-completions` `openai-responses` `openai-chatgpt-responses` `anthropic-messages`
`google-generative-ai` `google-interactions` `google-vertex` `github-copilot`
`bedrock-converse-stream` `ollama` `pi-messages` `azure-openai-responses`。

`models[]` 每项允许：`id` `name` `api` `baseUrl` `reasoning` `input` `cost`
`contextWindow` `contextTokens` `maxTokens` `thinkingLevelMap` `params` `agentRuntime` `headers`。

### 4.2 本地推理端点

Ollama / LM Studio / vLLM 一律填 OpenAI 兼容端点即可（Ollama 本身也提供 `/v1`）：

| 运行时 | baseUrl |
|---|---|
| Ollama | `http://127.0.0.1:11434/v1` |
| LM Studio | `http://127.0.0.1:1234/v1` |
| vLLM | `http://127.0.0.1:8000/v1` |

### 4.3 测试连接

「大模型」页的「测试连接」按钮在主进程里打真实接口：

- OpenAI 兼容：`GET {baseUrl}/models`
- Anthropic 兼容：`POST {baseUrl}/v1/messages`（`max_tokens:16` 的最小请求，带 `x-api-key` + `anthropic-version`）

### 4.4 校验生成的配置

```bash
OPENCLAW_CONFIG_PATH="<userData>/openclaw/.openclaw/openclaw.json" \
OPENCLAW_STATE_DIR="<userData>/openclaw/.openclaw" \
node node_modules/openclaw/openclaw.mjs config validate --json
# → {"valid":true, ...}
```

---

## 5. 平台技能包协议

协议对齐 dabi 的 `platform-packages`。一个包是一个目录：

```
<root>/<packageId>/
  manifest.json        必需 —— 包元数据
  runtime.cjs          可选 —— 运行时（导出 manifest / tools / execute）
  docs/**/*.md         可选 —— 站点知识文档（供 agent 阅读）
```

### 5.1 包注册表 index.json

包根目录下的 `index.json` 是**注册表**，匹配规则的权威来源：

```
<root>/index.json
  { "packages": [ { "packageId": "taobao", "version": "1.0.67",
                    "match": ["*.taobao.com"], "matchPriority": 10,
                    "packageUrl": "https://…/taobao.zip" } ] }
```

> 真实 dabi 的 `match` / `matchPriority` **只写在注册表里，manifest 里没有**。
> ecclaw 现在的规则是：注册表的 `match` 与 manifest 的 `match` 取并集，
> `matchPriority` 以注册表为准（manifest 仅作自有扩展的兼容兜底）。
> 没有 `index.json` 时退化为纯 manifest 匹配。

### 5.2 两种目录布局

```
# 直接布局
<root>/<packageId>/manifest.json

# 版本化布局（current.json 指向版本目录）
<root>/<packageId>/current.json          → { "dir": "1.0.67" }
<root>/<packageId>/1.0.67/manifest.json
```

缺省时若两者都没有，会退化到「取字典序最大的含 manifest.json 的子目录」。

### 5.3 manifest.json 字段

```jsonc
{
  "schemaVersion": 1,
  "packageId": "taobao",            // 唯一标识，用户本地包可覆盖同 id 内置包
  "displayName": "淘宝/天猫",
  "version": "0.1.0",
  "platform": "taobao-family",
  "sites": ["taobao", "tmall"],     // 站点标识
  "match": ["taobao.com", "*.taobao.com"],  // 域名匹配，支持 *. 通配
  "matchPriority": 10,              // 多包命中时数值大的优先
  "minClientVersion": "0.1.0",
  "runtime": "runtime.cjs",
  "pages": [                        // 站点页面描述
    { "id": "builtin:taobao-detail", "path": "detail", "type": "product",
      "docs": "docs/tx/taobao/product-detail.md" }
  ]
}
```

### 5.4 runtime 能力契约

`runtime.cjs` 是**第三方代码**，ecclaw 一律在独立子进程里加载它做**能力探测**
（`ELECTRON_RUN_AS_NODE=1` 退化为纯 Node，崩溃/死循环不会带崩主进程）。
在「平台包 → 探测能力」里可以看到每个包暴露的能力清单。

支持三种导出形态，探测时自动归一化：

| 形态 | 导出 | 归一化结果 |
|---|---|---|
| ecclaw 示例包 | `{ manifest, tools[], execute() }` | `tools[]` → 工具名 + 参数 schema |
| dabi 包 | `{ manifest, pages[], canOpenSidePanel() }` | 每个 page 的 `actions` / `automationActions` → 动作能力 id；`observations()` → 观察器 id |
| dabi 数据包 | `{ manifest, pages[], dataQueries{} }` | `dataQueries` 的键 → 数据查询能力 id |

dabi 契约的两个细节：

- 加载前必须先注入 `globalThis[Symbol.for('com.dabiai.plugins.sdk')]`（包内 `@dabi/plugins` 会读它），
  否则 `require` 直接抛错。
- `page.observations()` 依赖宿主传入的页面上下文，脱离宿主调用会抛错。
  探测脚本对它单独 try/catch，失败只丢观察器 id，不影响动作能力抽取。

**当前边界**：ecclaw 只做「能力目录抽取 + 呈现」，**不执行动作**。
dabi 的动作执行依赖内嵌浏览器宿主（`webContents` / `tabId`），ecclaw 尚无此宿主。

### 5.5 能力目录喂给 Agent（托管技能）

「平台包 → 生成 Agent 技能」把每个已安装包的能力目录写成 openclaw **托管技能**
（`<stateDir>/skills/<packageId>/SKILL.md`），openclaw 技能系统会将其暴露给模型：

- frontmatter：`name`（包 id）/ `description`（显示名 + 站点匹配 + 能力计数）；
- 正文：使用边界（只给能力目录知识、**不执行动作**）、站点匹配、页面 → 动作能力 id
  （与 manifest 的 path/type 关联）、观察器、数据查询、工具清单、站点知识文档指针；
- 包内若带 `docs/`，整目录拷入技能目录，供 agent 渐进阅读；
- 输出目录可用 `ECCLAW_SKILLS_DIR` 重定向（开发/验证期避免写真实状态根）；
- 真机实测（2026-11-01）：17 个真实 dabi 包全部生成成功，能力合计 643 项。

### 5.6 新增一个平台包

1. 建目录 `<userData>/platform-packages/<packageId>/`（用户包）或
   `resources/platform-packages/<packageId>/`（内置包，随包分发）。
2. 写 `manifest.json`（至少 `packageId` + `displayName` + `version`）。
3. 可选：放 `runtime.cjs` 与 `docs/`。
4. 应用里点「平台包 → 重新扫描」，或重启应用。

内置包目录可用环境变量 `ECCLAW_PACKAGES_DIR` 覆盖（便于开发期指向别处）。

### 5.7 远程包仓库

「平台包 → 远程包仓库」支持从远端仓库直接安装平台包（对齐 dabi 的 `taobao-launch-packages`：

manifest 哈希校验 + zip 安全解包 + 签名直链下载）。

**仓库侧**：仓库根目录提供 `index.json`，形态与包注册表一致：

```jsonc
{
  "packages": [
    {
      "packageId": "taobao",
      "version": "1.0.67",
      "channel": "stable",
      "match": ["*.taobao.com"],
      "packageUrl": "https://…/taobao-1.0.67.zip?OSSAccessKeyId=…&Signature=…",
      "sha256": "归档 sha256（可选，填了就强校验）",
      "manifestSha256": "manifest.json 的 sha256（可选）"
    }
  ]
}
```

**客户端流程**（`electron/main/package-repository.ts`）：

1. `GET <仓库>/index.json` → 解析 `packages[]`；
2. `GET packageUrl`（只允许 http/https，限 200 MB）→ 校验归档 `sha256`；
3. **安全解包**（自带的最小 zip 解析，无第三方依赖）：拒绝绝对路径 / `..` / 盘符 /
   符号链接，限文件数 5000、单文件 100 MB、总体积 400 MB，逐文件 CRC 校验；
4. 校验 `manifest.json`（存在 / `packageId` / `version` / `manifestSha256`）；
5. 落盘到 `<userData>/platform-packages/<packageId>/<channel>-<version>-<hash8>/`，
   并写 `current.json` 指针 `{version, channel, dir}`；
6. 仓库地址存在 `ecclaw-settings.json` 的 `packageRepo.baseUrl`。

安装不删除旧版本目录（避免误删用户文件）；本地包目录可用 `ECCLAW_LOCAL_PACKAGES_DIR` 覆盖。

### 5.8 内嵌浏览器宿主（实验）

平台包**从不接触** `webContents`：包与页面之间唯一的桥是 `context.eval(source)`，
且回传的是**结构化值**（`const state = await context.eval(JS)` 后直接取 `state.url`）。
数据查询是另一条通道：`pkg.dataQueries[id].buildExpression(args)` 产出**表达式字符串**，
宿主把它放进页面执行（包内代码用 `document` / `fetch(credentials:'include')`）。

三层结构：

```
渲染进程 UI（平台包页「内嵌浏览器宿主（实验）」卡片）
   ↓ IPC
主进程 host-service
   ├─ BrowserHost：WebContentsView 承载页面；eval = webContents.executeJavaScript(src, true)
   └─ platform-actions：spawn 子进程（ELECTRON_RUN_AS_NODE=1）加载真实 runtime.cjs
          子进程要页面求值 → IPC {type:'eval'} → 主进程求值 → 回传
```

- **runtime.cjs 一律在子进程加载**（第三方代码不带崩主进程）；子进程与主进程用
  `stdio: ['ignore','pipe','pipe','ipc']` + `process.send` / `child.send` 通信。
- **可见内嵌浏览器**：渲染进程把占位盒的 `getBoundingClientRect()` 通过 `host:set-viewport`
  交给主进程，主进程据此 `view.setBounds(...)`（CSS px 与 DIP 1:1）。隐藏时收成 0×0，
  避免遮挡 UI。`host:status` 可读回「当前页面 + 摆放位置」。
- **observe（事件）通道**：包内 `page.observations(context)` 返回观察器定义 → 宿主产生事件 →
  作为 `context.event` 喂给 `page.observe(context)`。dabi 的三种 mode **全部实现**：
  `network-response`（CDP `Network` 域匹配响应，`Network.getResponseBody` 取响应体）、
  `poll`（按 `intervalMs` / `runImmediately` 触发）、
  `dom-signal`（注入包内 `installScript`，监听页面 console 前缀）。
  包内真正会读的字段：`event.mode` / `event.request.url` / `event.bodyText` / `event.base64Encoded`
  （宿主另补 `event.response.status` 与 `observation.id`）。
  示例包见 `resources/platform-packages/ecclaw-observer-demo/`（3 个页面各演示一种 mode）。
- **context 构造只有一份**：`electron/main/action-context.ts` 的 `createActionContext`
  既是类型化的实现，又通过 `contextBuilderSource()`（`fn.toString()`）内联进 runner 脚本，
  主进程与子进程不会漂移。字段清单见 `docs/dabi-宿主契约-context字段清单-2026-11-02.md`。
- 最小 `@dabi/plugins` SDK：`logger.*` / `updateActionStatus` / `browser.eval` / `evalPage`；
  写操作见 §5.10。
- **context 契约 15 字段全部实现，真实缺口 = 0**（清单见
  `docs/dabi-宿主契约-context字段清单-2026-11-02.md`）。

### 5.9 宿主接入对话链路（MCP）

托管技能只解决「agent 知道有哪些能力 id」；**执行**靠 openclaw 的 MCP 客户端：

```
openclaw agent ──MCP(stdio)──> resources/mcp/host-server.mjs
                                      │ HTTP 127.0.0.1 + token
                                      ▼
                            主进程 host-bridge（electron/main/host-bridge.ts）
                                      ▼
                            host-service → BrowserHost / platform-actions
```

- **为什么要有桥**：MCP 服务进程由 openclaw 拉起（openclaw 的孙子进程），够不到 Electron 主进程；
  而宿主能力（WebContentsView、平台包执行器）只在主进程里。
- **宿主桥**：`127.0.0.1:<随机端口>`，每个请求必须带 `x-ecclaw-token`（随机 24 字节 hex）；
  端点信息写在 `<stateDir>/host-bridge.json`，MCP 侧通过 `ECCLAW_HOST_BRIDGE_FILE` 读到。
- **MCP 服务**：`resources/mcp/host-server.mjs` 是手写的 JSON-RPC 2.0（stdio，newline 分隔），
  实现 `initialize` / `tools/list` / `tools/call`，共 18 个工具：
  `ecclaw_list_capabilities`、`ecclaw_open_page`、`ecclaw_read_dom`、`ecclaw_run_action`、
  `ecclaw_run_data_query`、`ecclaw_run_extract`、`ecclaw_run_observe`、`ecclaw_host_status`，
  以及直接操作宿主页面的 4 个：`ecclaw_click`、`ecclaw_scroll`、`ecclaw_intercept_next`、
  `ecclaw_wait_navigation`（后两个只读；前两个是写操作，**会先请用户确认**，见 §5.11 / §5.12），
  外加票据与订阅 6 个：`ecclaw_approval_status`（查写操作票据）、`ecclaw_watch` /
  `ecclaw_watch_stop`（持续观察）、`ecclaw_next_event`（长轮询取增量事件，见 §5.13）、
  `ecclaw_event_replay`（回放已落盘的历史事件，见 §5.14）、
  `ecclaw_event_summary`（已落盘事件的聚合汇总，见 §5.15）。
- **注册**：启动时把 `mcp.servers.ecclaw-host` 写进 openclaw 配置（`transport:"stdio"`，
  `command=process.execPath`，`env` 里带 `ELECTRON_RUN_AS_NODE=1`）。
  脚本先从 `resources/mcp/` 复制到 `<stateDir>/mcp/`，运行期不依赖打包路径。
- **工具名带前缀**：openclaw 会把工具名改成 `ecclaw-host__ecclaw_run_action`（服务器名 + 双下划线）。
- 自检：`openclaw mcp doctor ecclaw-host --probe` → `ecclaw-host: ok`。

### 5.10 宿主写操作（替用户操作页面）

平台包可以真的**操作页面**，而不只是读数据。dabi 真实包的写操作签名：

```js
browser.click({ selector, text?, frame? }, { humanize?, timeoutMs? })
browser.scroll({ deltaY?, target?: { selector, frame? }, humanize? }, { timeoutMs? })
browser.interceptNext(globPattern, { timeoutMs })   // → { url, method, status, body }
browser.waitForNavigation({ timeoutMs })            // → { url }
```

- 真实包里 SDK 是 `require("@dabi/plugins")`，宿主把最小 SDK 注入在
  `globalThis[Symbol.for('com.dabiai.plugins.sdk')]`。
- **两条执行路径**（回执里的 `mode` 字段能直接看出走了哪条）：

| 宿主页面 | 点击 | 滚动 |
|---|---|---|
| 可见（渲染进程给了真实矩形） | CDP `Input.dispatchMouseEvent`（`mode:"cdp-click"`） | CDP `Input.synthesizeScrollGesture`（`mode:"gesture"`） |
| 隐藏（viewport = null） | DOM `el.click()`（`mode:"dom-click"`） | DOM `scrollBy`（`mode:"dom-scroll"`） |

- **五个硬坑**（详见 `docs/ecclaw-宿主写操作-2026-11-02.md`）：
  1. 隐藏的 widget **不收** CDP 输入事件（`setVisible(false)` 时鼠标事件被静默丢弃）；
  2. 隐藏**不能收成 0×0**（布局宽 0 → 元素坐标全 0），唯一可用隐藏方式 = 1280×800 布局 + `setVisible(false)`；
  3. 挪到画面外也不行（`x=-1280` → 视口宽度被裁成 0）；
  4. `mouseWheel` 不产生滚动（scrollTop 恒 0）→ 用 `synthesizeScrollGesture`（yDistance 取负），
     且滚完必须校验 scrollTop 是否真的变了，没变就回退 DOM；
  5. `interceptNext` 登记前不能 `await`（否则包内后续请求抢先发出）。
- 示例包：`resources/platform-packages/ecclaw-writer-demo/`（4 个动作各一个）。
- 实测（2026-11-02）：可见 × 隐藏 × 4 动作 = **8/8 全绿**；
  MCP 层 `ecclaw_run_action` 亦返回 `ok:true`。
- 写操作**必须先过确认护栏**（agent 触发时），见 §5.11。

### 5.11 写操作确认护栏

「替用户操作页面」不能由 agent 自己拍板，所以所有改动页面的写操作都要用户点头。

- **三档策略**（存 `ecclaw-settings.json` 的 `hostWriteGuard`，运行时可改）：

  | 模式 | 行为 |
  |---|---|
  | `ask`（默认） | 渲染进程右下角弹确认卡片，用户点「允许 / 拒绝」；**40 秒无响应 = 自动拒绝**（fail-closed） |
  | `allow` | 直接放行 |
  | `deny` | 直接拒绝，报错回给 agent |

  > **40 秒这个数字是被 MCP SDK 逼出来的**：openclaw 的 MCP 客户端请求超时硬编码
  > `60000ms`（`DEFAULT_REQUEST_TIMEOUT_MSEC`），超时只会给 agent 一句
  > `MCP error -32001: Request timed out`。护栏窗口若 ≥ 60s，两者同时到点 →
  > agent 必然先超时，且按钮其实**没被点**（实测连点三次全 -32001、页面计数 0）。
  > 取 40s 后重测：agent 首次调用即弹卡 → 用户允许 → 点击真的发生（`dom-click`/`ok:true`）。

- **只拦改动页面的操作**：`click` / `scroll`。
  `interceptNext`（抓响应）、`waitForNavigation`（等跳转）以及全部只读通道
  （`read-dom` / `extract` / `observe` / `data-query`）不受影响。
- **用户自己点的操作不走闸**：发起方用 `source` 区分（`'ui'` = 用户在界面里点的，
  `'agent'` = agent 经 MCP / 平台包触发）；`ui` 直接放行。
  透传链：`host-service` → `platform-actions.runRunner` → `host.runOp`。
- **闸门位置**：`BrowserHost.runOp` 里、执行动作之前 —— 所以平台包子进程和 MCP 直连工具共用同一道闸。
- **UI**：「平台包」页宿主卡片有 `宿主桥已就绪 :<port>` 标签与 `agent 写操作：` 下拉（ask/allow/deny）。
  桥状态接口**不返回 token**（token 不能进渲染进程）。
- 详细设计与实测：`docs/ecclaw-宿主写操作护栏-2026-11-02.md`。

---

### 5.12 两段式写操作确认 + 站点白名单

护栏升级成**票据制**，并把「一次授权」的粒度从单个动作放宽到整个站点。

**两段式（agent 触发的写操作）**

`ecclaw_click` / `ecclaw_scroll` 不再阻塞等用户，而是**立即**返回票据：

```jsonc
{ "status": "pending", "approvalId": "w-mvyiyu74-1" }   // 等用户点头
{ "status": "executed", "result": { "ok": true, "mode": "dom-click" } }  // allow 档 / 白名单站点
```

用户点头后，agent 用 `ecclaw_approval_status(approvalId)` 取最终结果：

| 状态 | 含义 |
|---|---|
| `pending` | 排队等用户（票据最长 10 分钟） |
| `approved` | 用户已允许，正在执行 |
| `executed` | 执行完，`result` 有值 |
| `failed` | 执行报错，`error` 有值 |
| `rejected` | 用户明确拒绝（**绝不执行**，不要重试） |
| `timeout` | 超时未确认（fail-closed，**绝不执行**） |

> 为什么要改：40 秒的阻塞窗口对「用户离开了界面」的场景仍然太短。
> 两段式把**人的等待时间**与 **MCP 的 60 秒硬超时**彻底解耦 ——
> 工具已经返回了，用户去干别的也没关系，agent 什么时候来取结果都行。

**站点白名单（一次授权一批）**

确认卡片上有第三个按钮「允许并信任本页面」→ 当前页面的**域名**写进
`ecclaw-settings.json` 的 `hostWriteGuardAllowlist` → 该站点之后的写操作**直接放行**，
不再逐次弹卡。匹配规则：精确匹配或后缀匹配（`.taobao.com` 覆盖 `shop.taobao.com`）。

实测（2026-11-02）：首次点击 60ms 返回 pending → 点「允许并信任本页面」→ `executed`、
fixture 计数 2→3、settings 落盘 `["127.0.0.1"]`；再次点击 **32ms 直接 `executed`**、计数 3→4。

- 详细设计与实测：`docs/ecclaw-两段式写操作确认-2026-11-02.md`。

---

### 5.13 poll 订阅式持续刷新

dabi 的 `poll` 观察器是**持续**的（`intervalMs` + `runImmediately`，侧栏随页面联动），
ecclaw 早期只跑一次。这一阶段补上。

```
包内 poll 观察器（常驻子进程，按 intervalMs 循环）
      │ 每轮一条增量事件
      ▼
宿主事件总线（electron/main/host-events.ts）
      ├──► 渲染进程：界面增量追加（不轮询）
      └──► agent：ecclaw_next_event（长轮询，一次调用等一条）
```

| 工具 | 作用 |
|---|---|
| `ecclaw_watch({packageId, pageId?})` | 启动持续观察，返回 watch 列表（含 `watchId`） |
| `ecclaw_watch_stop({watchId})` | 停止持续观察 |
| `ecclaw_next_event({sinceSeq?, timeoutMs?})` | **长轮询**取下一个增量事件（超时返回 `null`，不是错误） |

- 事件带单调递增 `seq`，消费者记住 `sinceSeq` 就只拿新事件 —— 这就是「增量」。
- 界面侧：侧栏新增「宿主事件」页（持续观察列表 + 增量事件流），靠主进程推送更新。
- 实测：事件间隔 ≈810ms，与包内 `intervalMs:800` 一致；停止后排干至 `null`。
- 详细设计与实测：`docs/ecclaw-poll订阅式持续刷新-2026-11-02.md`。

### 5.14 护栏信任范围四档 + 事件落盘回放 + 登录态持久化

**① 护栏中间档（信任范围四档）**

确认卡片从「允许 / 拒绝 / 允许并信任本页面」改成「信任范围下拉 + 允许 / 拒绝」：

| scope | 落点 | 语义 |
|---|---|---|
| `once` | 不记任何规则 | 只放行这一次 |
| `session` | 内存 `sessionRules` | 本次宿主运行内信任该域名，重启即失效 |
| `persistent` | `settings.hostWriteGuardAllowlist` | 永久信任该域名（含子域，全部写操作） |
| `persistent-scroll` | 同上 | 永久信任该域名，但**只放行滚动**，点按仍逐次确认 |

白名单条目从 `string[]` 升级为 `{host, match, ops, ttl}` 三维（**旧字符串数组仍合法**，
按 `domain / all / persistent` 解释）：

```jsonc
"hostWriteGuardAllowlist": [
  "127.0.0.1",                                   // 旧格式 = domain + all + persistent
  { "host": "taobao.com", "match": "domain",     // domain=含子域 / host=精确主机
    "ops": "scroll", "ttl": "persistent" },      // all / scroll
  { "host": "shop.example.com", "match": "host",
    "ops": "all", "ttl": "session" }             // persistent / session
]
```

判定顺序：`ui / 非写操作` → `allow 档` → **白名单（按 ops 与本次 op 匹配）** → `deny 档` → 弹卡。
白名单检查在 `ask` 判定**之前**，只作用于 `source=agent`。
界面「平台包」页宿主卡片里有「已信任站点」标签行（标注「精确 / 只滚动 / 本次会话」）+ 移除按钮。

**② 事件落盘与回放**

- 落盘：`<userData>/host-events/events-YYYY-MM-DD.jsonl`（每天一个文件，保留 14 天，
  启动时 `initHostEventLog()` 清过期文件）；写失败不阻塞事件流。
- 回放：`ecclaw_event_replay({sinceSeq, untilSeq, sinceAt, untilAt, packageId, pageId, kind, limit})`
  → 按 `seq` 升序返回（默认 200，上限 2000）；桥 op `event-log-info` 返回 `{dir, days[], total}`。
- 界面「宿主事件」页新增「历史回放（事件已落盘）」面板。

**③ 登录态持久 partition**

`electron/main/browser-host.ts` 里 `HOST_PARTITION = 'persist:ecclaw-host'`，
宿主 WebContentsView 用它 → cookie / localStorage 落在
`<userData>/Partitions/ecclaw-host/`，**应用重启后仍在**，且不与宿主渲染进程共享 cookie。

- ⚠️ 实测：**正常退出**（关窗口 / `CloseMainWindow`）重启后 cookie 仍在；
  `taskkill /F` 强杀进程会丢未落盘的 cookie（Chromium 没来得及刷 cookie 库）。
- 真实站点登录态闭环 **已于 2026-11-02 完成**（用户本人账号 · 淘宝）：正常关闭重启后登录态 cookie 留存（昵称在、`_tb_token_`/`_hvn_lgc_` 在）；真实站点写操作验证只用 `scroll`（点一下可能下单），护栏卡选「本次会话内信任本站」后规则只落 session 组、`hostWriteGuardAllowlist` 保持 `[]`。

详细设计与实测：`docs/ecclaw-护栏中间档与事件落盘-2026-11-02.md`。

### 5.15 事件汇总 + 落盘保留策略

**① 事件汇总（agent 侧工具 + 界面侧面板）**

事件落盘之后，agent 若想知道「哪个平台包产了多少事件、覆盖了哪几天」，靠
`ecclaw_event_replay` 得把成百上千条原始事件拉进上下文 —— 又贵又占窗口。
第十一阶段补了聚合视图：

```jsonc
// ecclaw_event_summary({ sinceSeq?, untilSeq?, sinceAt?, untilAt?, packageId?, pageId?, kind? })
{
  "dir": "C:/Users/Duanyi/AppData/Roaming/ecclaw/host-events",
  "total": 10,
  "days": ["2026-11-02"],
  "byPackage": [                       // 按条数倒序
    { "packageId": "ecclaw-observer-demo", "count": 10,
      "firstSeq": 1, "lastSeq": 6, "firstAt": "…", "lastAt": "…",
      "kinds": { "observe": 10 } }      // 该包内各 kind 的条数
  ],
  "byKind": { "observe": 10 },          // 按事件类型聚合
  "byDay": [ { "day": "2026-11-02", "count": 10 } ],
  "firstAt": "…", "lastAt": "…"
}
```

- 过滤语义与 `ecclaw_event_replay` **完全一致**（回放与汇总共用 `scanDiskEvents()`）。
- 宿主桥对应 op：`event-summary`（无 `limit`，聚合不需要条数上限）。
- 界面「宿主事件」页新增「事件汇总」面板：填 packageId（可空）→「汇总」→ 左侧按平台包、
  右侧按类型 / 按天；历史回放面板的提示行现在也显示「保留 14 天 · 当前 N 条 · 占用 X KB」。

**② 落盘保留策略细化**

原来只有「按天 + 保留 14 天」，现在补了两条上限（`electron/main/host-events.ts`）：

| 约束 | 值 | 行为 |
|---|---|---|
| 单文件体积 | `MAX_FILE_BYTES = 8MB` | 当天最后一个分片写满就新开 `events-DAY.1.jsonl`、`.2.jsonl`… |
| 目录总体积 | `MAX_TOTAL_BYTES = 256MB` | 超了从**最老的一天**开始整日删除 |
| 检查频率 | 每写 200 条 | `TRIM_CHECK_EVERY = 200`（避免每条都 stat 整个目录） |
| 保留天数 | `RETAIN_DAYS = 14` | 启动时 `initHostEventLog()` → `sweepDisk()` 清过期文件 |

- 分片文件名 `events-YYYY-MM-DD.N.jsonl` 由 `LOG_FILE_RE` 统一解析（`N` 缺省 = 0），
  回放与汇总都按「天 + 分片序号」顺序扫，因此跨分片统计仍然连续。
- `event-log-info` 返回值扩为 `{dir, days[], total, bytes, retention:{retainDays, maxFileBytes, maxTotalBytes}}`。

详细设计与实测：`docs/ecclaw-事件汇总与落盘保留策略-2026-11-02.md`。

### 5.16 事件导出 + 信任规则可视化 + 白名单路径维度

**① 事件导出（把观察记录拿走）**

回放与汇总都是给 **agent** 用的；但用户自己也常要「把某段时间的观察记录拿走」——
发给同事、存档、贴工单。之前只有落盘的 JSONL，用户得自己去 `<userData>/host-events/`
里翻文件、还得自己按天拼。导出接口把这件事收成一次调用：

```jsonc
// ecclaw_event_export({ format?, sinceSeq?, untilSeq?, sinceAt?, untilAt?, packageId?, pageId?, kind? })
{
  "file": "C:/Users/Duanyi/AppData/Roaming/ecclaw/host-events/exports/ecclaw-events-20261102-175613.jsonl",
  "count": 17,
  "bytes": 4816,
  "format": "jsonl",        // 或 "csv"
  "truncated": false,        // 超过单次上限 5 万条会被截断
  "dir": "C:/Users/Duanyi/AppData/Roaming/ecclaw/host-events/exports"
}
```

| 项 | 约定 |
|---|---|
| 格式 | `jsonl`（默认，与落盘同构，一行一条）/ `csv`（表格工具可读） |
| CSV 列 | `seq,at,kind,packageId,pageId,observationId,value`，按 RFC4180 转义；`value` 存 JSON 文本，可再 `JSON.parse` |
| 过滤 | 与 `ecclaw_event_replay` / `ecclaw_event_summary` **完全一致**（三者共用 `scanDiskEvents()`） |
| 上限 | 单次最多 5 万条，超出时 `truncated: true` |
| 落点 | `<userData>/host-events/exports/` —— 目录名不匹配 `LOG_FILE_RE`，所以「保留 14 天 / 体积上限」的自动淘汰**不会**碰它（导出物是用户主动产物） |
| 交到用户手里 | 界面「在文件夹中显示」（IPC `host:show-in-folder` → `shell.showItemInFolder`） |

- 宿主桥对应 op：`event-export`。
- 界面「宿主事件」页新增「导出」面板：格式下拉（jsonl / csv）+ packageId（可空 = 全部）→「导出」。

**② 信任规则可视化（会话规则 / 永久规则分开看 + 分开清）**

之前只有一条扁平的「已信任站点」列表：用户设了 `session` 规则看不见，
也没法只清 session 而留着永久的。现在分组：

```jsonc
// ecclaw_guard_rules()
{ "session": [ … ], "persistent": [ … ] }
// ecclaw_guard_clear_session()  → 清掉的条数（永久规则不受影响）
```

- 宿主桥对应 op：`guard-rules` / `guard-rules-clear-session`。
- 界面「平台包」页拆成两行：「本次会话信任」+「清空本次会话」按钮 /「永久信任」。
- 每次批准写操作后界面会自动重拉（批准可能顺带写入新规则）。

**③ 白名单路径维度（第五档信任范围 `persistent-path`）**

原来白名单的粒度是 `match × ops × ttl`（域名 × 操作 × 有效期）。现在多了第三个维度 **path**：

- `AllowRule.path` 缺省 = 整站（与第十阶段行为完全一致）。
- 非空 = 只对该 pathname 前缀生效：`pathname === path || pathname.startsWith(path + '/')`。
- 三个维度取**交集**（最严为准）：`host(match) ∧ path ∧ ops`。
- 新增信任范围 `persistent-path`：授权时把**当前页面的 pathname** 写进规则
  （如 `/seller/item`）—— 站点内部换到别的路径仍逐次确认。

| 信任范围 | 语义 |
|---|---|
| `once` | 只放行这一次 |
| `session` | 本次宿主运行内信任该域名（内存，重启失效） |
| `persistent` | 永久信任该域名（含子域，全部写操作） |
| `persistent-scroll` | 永久信任该域名，但只放行滚动，点按仍逐次确认 |
| `persistent-path` | 永久信任该域名，但只限当前页面路径前缀 |

---

### 5.17 压缩归档 + 时间序列趋势 + 护栏粒度 + 事件推送通道

第十三阶段。四个交付块：把事件日志**存得久、看得懂**，把护栏**拆得细、管得住**，
把事件**推给 agent** 而不是让 agent 去轮询。

**① 事件落盘后续：压缩归档（先压后删）**

原来的保留策略是「超期就删」。但观察记录往往是**事后**才要查的（"上周三那次操作到底看到了什么"），
删了就真没了。现在改成**先压后删**：

| 层 | 保留 | 说明 |
|---|---|---|
| 明文 `.jsonl` | 14 天 | 超过 14 天 → 压缩成 `.jsonl.gz`，**不删** |
| 归档 `.gz` | 90 天 | 超过 90 天 → 才删 |
| 目录总量 | 256MB | 超了从**最老的一整天**整日删（含归档） |

- 压缩是**顺序**操作：先写 `.gz` → 确认写成了 → 再删明文。中途失败保持原样
  （宁可多占磁盘，也不能丢数据）。
- **所有读路径必须走 `readLog(file, gz)`** —— 漏一处 → gzip 被当明文解析 → 事件静默消失。
- `HostEventLogInfo` 现在给 `plainFiles` / `archivedFiles` 两个分片数，
  `retention` 里多了 `archiveDays`。
- 触发点有三个：跨天落盘时、Electron 启动时（`initHostEventLog`）、体积检查时。

**② 时间序列趋势（按天 / 按小时分桶）**

`ecclaw_event_summary` 现在能回答"今天比昨天多了多少""峰值在哪个小时"，
不用把几千条明细拉进上下文再自己数：

```jsonc
// ecclaw_event_summary({ bucket: 'day' | 'hour', …过滤条件 })
{
  "trend": {
    "bucket": "day",
    "points": [
      { "start": "2026-10-30T00:00:00.000Z", "count": 0, "delta": null, "deltaPct": null },
      { "start": "2026-10-31T00:00:00.000Z", "count": 12, "delta": 12, "deltaPct": null },
      { "start": "2026-11-01T00:00:00.000Z", "count": 7,  "delta": -5, "deltaPct": -41.7 }
    ],
    "peak": { "start": "2026-10-31T00:00:00.000Z", "count": 12 },
    "overallDeltaPct": -41.7
  }
}
```

| 口径 | 约定 |
|---|---|
| 空桶 | **必须补 0**，否则"环比"变成"跟上一个有数据的桶比"，口径不一致 |
| 桶键 | 用 **UTC**（落盘时间就是 UTC ISO），不用本地时区 |
| `deltaPct` | 首桶为 `null`；上一个桶为 0 时也是 `null`（不除零） |
| `peak` | 条数最多的桶 |
| `overallDeltaPct` | 末桶 vs 首桶（百分比，保留 1 位） |
| 跨度上限 | 超过 `MAX_TREND_POINTS`（500）个桶 → 退化成稀疏模式（只留有数据的桶） |
| 非法 `bucket` | 归一到 `day`，不抛错 |

- 界面「宿主事件」页有「按天 / 按小时」下拉，趋势区块给峰值、末桶较首桶%、逐桶环比。

**③ 护栏粒度收尾：按站点 / 按路径列出与移除**

`ecclaw_guard_remove({ host, path?, scope? })`：

| 参数 | 缺省 | 语义 |
|---|---|---|
| `path` | 整站 | 给具体 pathname 前缀 → 只清这一条路径的规则；给空串 `''` 也按整站（`/` 与 `''` 归一） |
| `scope` | `all` | `'session'` / `'persistent'` / `'all'` |

- 界面「平台包」页的信任规则**按站点分组**：每条路径可单独「移除」，站点级「清空本站」只清当前那一类。
- 宿主桥对应 op：`guard-rules-remove`。

**④ 宿主事件主动推送通道（SSE）**

MCP 是 **stdio 传输**，服务端没法把消息「推」给 agent。所以推送落在**宿主桥**这一层：

```
主进程 → 桥 GET /events (SSE) → MCP 进程缓冲 → agent 取件
```

- 桥端点：`GET /events?sinceSeq=N`，loopback + `x-ecclaw-token`（与 `/rpc` 同一把令牌），
  15 秒心跳，首次连接按 `sinceSeq` 补发内存环形缓冲里的增量（最多 200 条），随后转实时。
- MCP 侧常驻一条 SSE 连接（断线 2 秒重连，缓冲上限 500 条），
  新工具 `ecclaw_events_since({ sinceSeq, limit })` 从缓冲取件：

```jsonc
// ecclaw_events_since({ sinceSeq: 208 })
{ "events": [ { "seq": 209, "at": "…", "kind": "observe", … } ], "source": "push", "buffered": 42 }
```

| 字段 | 含义 |
|---|---|
| `source: 'push'` | 取件来自推送缓冲（缓冲覆盖了 `sinceSeq` 之后的全部事件） |
| `source: 'replay'` | 缓冲不覆盖（要的事件太老、已被挤出）→ 回落落盘回放，保证不漏 |
| `buffered` | 当前缓冲里有多少条 |

**取件口径**：`sinceSeq >= 缓冲最旧 seq - 1` 即视为「缓冲覆盖」，此时**没有新事件就返回空数组**
（不会挂住、也不会回落扫盘把别的 seq 空间的老事件吐回来）。

> 与 `ecclaw_next_event`（长轮询）的分工：长轮询适合"我就在等这一条"，
> 推送取件适合"有没有新东西？没有就干别的去"。

**⑤ 真实站点登录态闭环（2026-11-02 收官）**

用真实淘宝账号走完最后一段链路：`stop-electron.cjs` 正常关闭 → 重启 → 登录态 cookie 留存
（昵称、`_tb_token_`/`_hvn_lgc_` 均在）；`scroll` 触发护栏卡（**真实站点只用 scroll 做写操作验证**）→
界面选「本次会话内信任本站」→ 规则只落 session 组（`{host:'www.taobao.com', match:'domain', ops:'all', ttl:'session'}`），
持久组与 `hostWriteGuardAllowlist` 保持 `[]`。注意：护栏卡默认信任范围是「仅本次」，
一次性放行**不留规则**；另外若 `hostWriteGuard` 被验证轮改成了 `allow`，弹卡会整个消失（排查先查设置）。

### 5.18 事件 seq 全局单调 + 导出物清理入口 + 趋势图

第十四阶段。三个交付块：让**序号**可信、让**导出物**可清理、让**趋势**看得见。

**① 事件 seq 全局单调（跨重启续号 + 回放按 seq 排序）**

问题：`seq` 原来是**运行时计数器**，Electron 一重启就归零 → 落盘里存在**多个 seq 空间**
（同一批文件里既有 1..N 又有 1..M）。后果：`ecclaw_event_replay` 的区间过滤跨文件不可靠；
注释写「结果按 seq 升序返回」，实现却是**按文件序**返回；agent 拿 seq 当游标跨重启会漏事件或重放。

| 改动 | 位置 | 说明 |
|---|---|---|
| 启动续号 | `host-events.ts` `maxSeqOnDisk()` + `initHostEventLog()` | 启动时扫全部落盘文件（`.gz` 走 `readLog` 解压）取最大 seq，`seq = Math.max(seq, maxSeqOnDisk())` |
| 回放排序 | `SeqSelector`（大根堆） | 全量扫盘、只保留 **seq 最小的前 N 条**（内存 O(N)），结果按 seq 升序返回 |
| 导出排序 | 同上（上限 5 万条） | 「取前 5 万条」的口径从「文件序前 5 万」变成「seq 最小的 5 万」 |
| 不提前停 | `scanDiskEvents` 回调改成 `(e)=>void` | 文件序 ≠ seq 序，扫到"够了"就停会漏掉 seq 更小的那批 |

- **历史文件不改写**：旧的多 seq 空间原样保留；新事件一律大于所有历史 seq，
  所以「拿 seq 当游标」从现在起跨重启可靠。
- 断言口径是**非递减**（历史上存在重复 seq），不是严格递增；新 seq 空间内才是严格递增。
- 代价：启动时要读一遍落盘目录（最坏 256MB），与 `sweepDisk()` / `compressOldLogs()` 同量级。

**② 导出物清理入口（界面逐个删 + agent 只列不删）**

导出物是**用户主动产物**，不受自动淘汰策略影响 —— 以前只能自己去文件夹里删。
现在有入口，但**删除权只给界面**：

| 层 | 改动 |
|---|---|
| 主进程 | `listHostEventExports()` / `removeHostEventExport(name)`；`EXPORT_FILE_RE = /^ecclaw-events-\d{8}-\d{6}\.(jsonl\|csv)$/` |
| 宿主桥 | op `event-exports` —— **只列，没有删** |
| MCP | 新工具 `ecclaw_export_list`（23 → 24），返回 `{dir, files:[{name,file,bytes,modifiedAt}]}` |
| 界面 | 「导出物（自己清理）」面板：逐个列出 + **两段式删除**（先点「删除」变「确认删除？」，再点才真删） |

红线实现方式：

- 删除只接受 `EXPORT_FILE_RE` 认得的**精确文件名** → 通配符 / 批量 / 路径穿越全部无效；
- 再校验解析后的目录仍是导出目录（双保险）；
- 程序任何路径都**不自动删**导出物（`sweepDisk` / `trimToSize` 也不碰 `exports/`）；
- MCP 侧**只列不删** —— 删除权留在人手上。

**③ 趋势图（零依赖 SVG）**

`src/views/HostEvents.tsx` 的 `TrendChart`：每桶一根 `<rect class="trend-bar">`，
峰值桶加 `peak` class（橙色 `#ffb020`），其余蓝色 `#4c8dff`；每根柱挂 `<title>`
（hover 原生提示「时间 · N 条」）；y 轴三条刻度线、x 轴标签抽稀（最多 6 个 + 最后一个）；
`data-testid="trend-bar-{i}"` / `data-count` / `data-start` 便于 e2e 断言。
原有文字列表保留（图表在上、列表在下）。

---

### 5.19 店铺登录态 profile（多店铺登录隔离）

第十五阶段。**一个 profile = 一个独立 partition**；切店铺 = 换 partition + 重建宿主页面。

**问题**：第十阶段起宿主只有一个持久化 partition（`persist:ecclaw-host`）。
电商场景常常同时登好几个店 —— 同一个 partition 里登第二个店，第一个店的登录态会被顶掉。

**红线（最重要的一条）**：默认 profile 的 partition **就叫 `persist:ecclaw-host`，一个字符都不改** ——
所以升级后原有的登录态（淘宝已真机验证过）不会丢、不会被搬家。
实测（e2e）：切到别的店铺再切回来，默认店铺的登录态 cookie 仍在。

| 改动 | 位置 | 说明 |
|---|---|---|
| profile 存储层（新建） | `electron/main/host-profiles.ts` | 落盘 `<stateDir>/host-profiles.json`（`{version, profiles[], activeId}`），tmp + `renameSync` 原子写 |
| 宿主换 partition | `electron/main/browser-host.ts` | 构造器多收一个 `partition`；新增 `usePartition()` —— partition 是 `webPreferences` 的**创建期参数**，换它必须重建 view |
| 服务层 | `electron/main/host-service.ts` | `hostProfiles` / `hostCreateProfile` / `hostUseProfile` / `hostRemoveProfile` |
| IPC | `electron/main/index.ts` | `host:profiles` / `host:profile-create` / `host:profile-use` / `host:profile-remove` |
| 宿主桥 | `electron/main/host-bridge.ts` | op `profiles`（只读清单）/ `profile-use`（切换）—— **没有** create / remove |
| preload | `electron/preload/index.ts` | `listProfiles` / `createProfile` / `useProfile` / `removeProfile` |
| MCP | `resources/mcp/host-server.mjs` | 新增 `ecclaw_profile_list`（无参数）/ `ecclaw_profile_use`（参数 `id`），工具 **24 → 26** |
| 界面 | `src/App.tsx` | 「平台包」视图的宿主卡片里加：店铺下拉 + 新建店铺 + **两段式移除** + 当前 partition |

**几条设计取舍**：

- **agent 侧只读 + 切换**：新建要人起名、移除涉及用户登录数据 → 这两个动作**留在界面**，
  MCP 侧只有 `ecclaw_profile_list` / `ecclaw_profile_use`。
- **partition 名白名单**：只认程序自己生成的两种形态
  （`persist:ecclaw-host` / `^persist:ecclaw-profile-[a-z0-9-]{1,64}$`），不接受外部任意字符串 → 堵死注入。
- **移除 = 只删配置记录**：`<userData>/Partitions/<name>/` 下的登录数据是**用户文件**，
  程序**一律不删**（删除权在用户手上）。删掉的若是当前 profile，激活项复位到默认并把 partition 切回去。
- **内置默认店铺不可移除**（`removeProfile('default')` 抛错）。
- **切换店铺会关闭当前页面**（换 partition 必须重建 view）—— 界面给提示，viewport 存-恢复，
  切换后内嵌浏览器仍显示在原位（占位盒在、页面也在屏上）。

**实证发现**：Chromium 的 **session cookie（无 `Max-Age` / `Expires`）本来就不跨浏览器重启保留** ——
与 partition 机制无关，与 Chrome 行为一致。真实站点登录态通常是 persistent cookie（`Max-Age`），
所以「重启后登录态仍在」这条结论对真实登录成立；e2e 里的 cookie 夹具也因此改成了带 `Max-Age` 的写法。

---

### 5.20 写操作事件落盘（真实站点闭环复验 + 审计留痕）

第十六阶段。**复验真实站点（淘宝）写操作闭环 → 撞出一个真缺口 → 补齐。**

**① 复验结论：护栏闭环全通**

`ecclaw_scroll` → `{status:'pending', approvalId}` → 界面弹护栏卡 → 选信任范围 → 点「允许」→
票据转 `executed`（`result={ok:true, mode:'dom-scroll', deltaY:400, scrollY:400}`）→ 页面真滚动（scrollY 0→400）→
session 档信任进会话组 → 第二次 scroll **免确认直接放行** → `ecclaw-settings.json` 持久白名单仍是 `[]`（session 档不落盘）。
淘宝登录态在 `persist:ecclaw-host` 分区里**跨 Electron 重启保住**（昵称「密氪viva63」、购物车 189、无「请登录」）。

**② 真缺口：写操作根本不产生事件**

事件流 / 汇总 / 导出这套设施原本只覆盖 `kind:'observe'`。`HostEvent['kind']` 里明明有 `'approval'`，
但**全项目没有任何一处 push 过它** —— agent 真的动了页面，事件流里查无此案、导出物里也没有。
闭环缺最后一环：写操作是唯一会**改变用户页面**的动作，却没有审计痕迹。

**③ 补齐：五处落点 + stage 语义**

| 层 | 改动 |
|---|---|
| 共享类型 | `ApprovalEventStage`（requested / executed / rejected / timeout / failed）+ `ApprovalEventValue`（stage / op / url / host / scope / source / via / approvalId / ok / error / result） |
| 主进程 | `electron/main/write-guard.ts`：新增 `emitApprovalEvent()`（try/catch 包住 —— 事件系统挂了不影响写操作）；票据 Entry 增记 `source` / `scope` |
| 渲染层 | `src/views/HostEvents.tsx`：`summarize()` 对 `kind==='approval'` 走可读摘要（不再甩 JSON）；`APPROVAL_STAGE_TEXT` / `APPROVAL_VIA_TEXT` / `APPROVAL_SCOPE_TEXT` 三张文案表 |
| MCP | `ecclaw_events_since` 加可选 `kind` 过滤（observe / approval / page，缓冲与落盘回放两条路都过滤）。**工具数不变（26）** |

**事件条数口径**：

| 场景 | 落几条 |
|---|---|
| 被护栏拦下的写 | **2 条**：`requested`（用户答复**前**就落盘，实时可见）+ `executed`（via='user'，scope=用户选的范围） |
| 站点信任放行 | **1 条**：`executed`（via='site-trust'） |
| 用户拒绝 / 票据超时 / 执行报错 | 各 1 条：`rejected` / `timeout` / `failed` |

**'approved' 不单独落事件** —— 否则一次写变 3 条；答复信息折进 `executed` 的 `scope` / `via`。

**界面渲染实测**（宿主事件视图）：

```
09:27:34 · 已请求确认 · 点击 · 127.0.0.1
09:27:35 · 已执行 · 点击 · 127.0.0.1 · 用户放行 · 永久信任（当前路径）
09:27:44 · 已请求确认 · 点击 · 127.0.0.1
09:27:45 · 已执行 · 点击 · 127.0.0.1 · 用户放行 · 本次会话
```

**实测计数**：`phase3q-e2e.cjs` **23/23 全绿**；回归 `phase3p-e2e.cjs` 44/44、`phase3o-e2e.cjs` 44/44、
`phase3m-e2e.cjs` 69/69、`sse-e2e.cjs` 14/14 全绿。工具数断言仍是 26（未新增工具）。

---

### 5.21 事件流 kind 多选筛选 + 导出物按 kind 拆分

第十七阶段。把「事件流按类型筛」「只导出某一类事件」「按类型拆成多份文件」三件事做成一条**语义统一**的链路。

**① 为什么要有**

事件流里现在混着两类东西：「机器看到的观察事件」（`observe`，量最大，一次持续观察 800ms 一条）
和「人批过的写操作审计」（`approval`，一次写 1~2 条）。两类混在一列里既看不过来，
也没法只把其中一类交给别处分析 —— 单选的 `kind` 只能选一类，多选没有出口，导出更是一股脑全导出。

**② 过滤语义：kinds（多选）优先于 kind（单选）**

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

**③ 导出拆分**

`splitByKind: true` → 每类一个文件，文件名 `ecclaw-events-<kind>-YYYYMMDD-HHMMSS.<ext>`：

```
ecclaw-events-approval-20261103-103318.jsonl
ecclaw-events-observe-20261103-103318.jsonl
```

- kind 放在**时间戳前面**：文件名里一眼可见，正则也能稳定解析出来。
- 不拆分时文件名**一字未改**（`ecclaw-events-YYYYMMDD-HHMMSS.ext`），历史导出物照旧可列可删。
- **同秒导出两次不覆盖**：时间戳只精确到秒，撞名会加 `-2` / `-3` 后缀 ——
  覆盖等于把用户的一份产物弄没了（红线：禁删用户文件）。
- 导出结果从 `{file, count, bytes, format, truncated, dir}` 扩成
  `{file, files:[{name,file,bytes,kind}], count, bytes, format, truncated, dir, kinds, split}`。

**④ 分层落点**

| 层 | 改动 |
|---|---|
| 共享类型 | `HostEventKind`；`HostEventFilter.kinds`；`HostEventExportOptions.{kinds,splitByKind}`；`HostEventExportResult.{files,kinds,split}`；`HostEventExportFile.kind` |
| 主进程 | `host-events.ts`：`scanDiskEvents` 加 kinds 过滤、`uniqueExportPath()` 去重、`renderEvents()` 渲染、`exportHostEvents` 按 kind 分组导出；`host-bridge.ts` / `main/index.ts` 各自解析 `kinds`（只认三种已知 kind，脏数据当没传） |
| preload | `exportHostEvents` 的 IPC 契约从 `(filter, format)` 改成 `(filter, {format, splitByKind})` |
| 渲染层 | `src/views/HostEvents.tsx`：`KindPicker` 多选控件（增量事件流 / 历史回放 / 导出 三处各一个）+「按 kind 拆成多个文件」开关 + 拆分结果文件列表 + 导出物清单的 kind 标签 |
| MCP | `ecclaw_event_replay` / `ecclaw_event_summary` / `ecclaw_event_export` / `ecclaw_events_since` 全部支持可选 `kinds`；`ecclaw_event_export` 另加 `splitByKind`。**工具数不变（26）** |

**⑤ 界面**

「宿主事件」视图三处都有 kind 多选（空选 = 不限），事件流上方实时显示各类型条数：

```
60 条中显示 1 条 · observe=59 · approval=1 · page=0
```

勾选「写操作审计」后只剩审计条目；勾选「按 kind 拆成多个文件」再导出，界面列出每个拆分文件并可「在文件夹中显示」。

**实测计数**：`phase3r-e2e.cjs` **31/31 全绿**；回归 `phase3q-e2e.cjs` 23/23、`phase3p-e2e.cjs` 45/45、
`phase3o-e2e.cjs` 44/44、`phase3m-e2e.cjs` 69/69、`sse-e2e.cjs` 14/14 全绿。工具数断言仍是 26（未新增工具）。

> `phase3o-e2e.cjs` 的导出物文件名断言已随新命名放宽为
> `ecclaw-events[-kind]-YYYYMMDD-HHMMSS.ext`（单文件形态不变，拆分形态多一段 kind）。

### 5.22 写操作 rejected / timeout / failed 三 stage 真实站点复验（淘宝）

第十八阶段。第十六阶段补上了写操作事件落盘，但 `rejected` / `timeout` / `failed` 三条终态 stage
只在夹具站验过 —— 本阶段在**淘宝真站**把三条 stage 全部打出磁盘事件实锤。

**① 真站实锤的三 stage 语义**

| stage | 触发 | 磁盘事件要点 | 真机结论 |
|---|---|---|---|
| `rejected` | 卡片上点「拒绝」 | `{stage:rejected, scope, ok:false, error:用户拒绝了本次写操作, approvalId}` | 拒绝后 winY 恒不变（fail-closed）、不留任何信任规则 |
| `failed`(via=user) | 批准后执行器抛错（不存在容器） | `{stage:failed, via:user, scope:once, error:滚动失败：未找到元素…}` | 批准失败同样不留规则 |
| `failed`(deny 分支) | `hostWriteGuard=deny` 下 agent 直接 scroll | `{stage:failed, 无 approvalId, 无 via, error:写操作已被策略禁用…}` | 策略分支不弹卡、不建票据，与 via=user 分支在事件里可区分 |
| `timeout` | 10 分钟无人答复 | `{stage:timeout, ok:false, 无 via}` | 真定时器误差 <1s、fail-closed、超时不留信任（再 scroll 仍被拦） |

**② 复验挖出的两个界面层结论**

- **卡片堆栈必须有可寻址锚点**：多卡并存时按 `.approval-card` 抓卡看运气 →
  `App.tsx` 给每张卡落 `data-approval-id={req.id}`（一行，React `key` 不落 DOM）。
- **终态卡片 12s 自动收是设计语义**：`App.tsx` 渲染层每 3s 清扫一次（`updatedAt` 超 12s 的终态卡收掉），
  活体复验窗口 hidden 态下 18.4s 内生效。卡片信任范围下拉是 **App 级全局粘滞 state**
  （记住上次选择，跨卡共享）——不是每卡重置，属设计行为。

**③ 无人值守 e2e 的防污染纪律**（`phase3s-e2e.cjs` v4）

锚定卡片 / 只等真终态集合（`approved` 是瞬态）/ 回放断言必须带 seq 基线 / 开局 `ecclaw_guard_clear_session`
清会话信任残留 / **跑期间勿碰 GUI 卡片**（人工点「允许」会吞掉 timeout 场景并留下会话信任）。

**实测计数**：`phase3s-e2e.cjs` **49/49 全绿**（v1 37→v2 34→v3 45→v4 49）；回归 `phase3r` **31**、
`phase3q` **26**、`phase3p` **45**、`phase3o` **44**、`phase3m` **69**、`sse` **14** 全绿。工具数仍 **26**，
MCP / 主进程 / preload 零改动（唯一产品改动 = 渲染层一行锚点属性）。

> **回归欠账修正（2026-11-03 晚）**：本节原先写「六套回归全绿」并引 `run49-*.log`，但那轮是「环境全灭」；
> 实际最新一轮（`run49b-*`）是 **3r 30/31 · 3q 17/23**。两处红都不是产品 bug：
> ① `phase3r` G3 断言把 DOM 条目 `.slice(0,20)` 却要求等于计数行的 `approval=38` → 恒假；
> ② `phase3q` 旧脚本用 `querySelector('.approval-card')` 取「第一张卡」→ 点中上一套件遗留的 pending 卡 →
> 批准了别的站点 → 本套件 6 条连环红（**跨套件污染**）。
> 已修（脚本级、零产品改动）并复跑全绿（`run50-*` / `run50b-*`）；
> `phase3q` 断言数由 23 → 26（新增开局清场 A6/A7 与收尾清场 Z1）。
> **两条通用纪律**：断言要比对总数就别给 DOM 条目加 `.slice(0,N)`；
> 每个 e2e 套件的**开局与收尾**都要「拒绝遗留 pending 卡 + `ecclaw_guard_clear_session` 清会话信任」。

---

### 5.23 页面事件（kind:'page'）补产生点 + 导出物面板归类视图

第十九阶段。第十八阶段收尾时留下的两个小尾巴。

**① kind:'page' 从「只有类型没有事件」到真有事件**

`HostEvent['kind']` 里一直有 `'page'`，界面筛选器与 MCP schema 也都列了它 ——
但**全项目没有任何一处 push 过**，于是「页面事件」这个筛选选项永远选不出东西。
更要紧的是：开页面**不走写操作护栏**（护栏只管 click / scroll），
所以「agent 打开了哪些页面」此前**完全无痕**。

产生点选在 `electron/main/browser-host.ts` 的 `open()` —— 宿主开页的唯一漏斗
（`hostOpen` / `hostReadDom` / `hostRunDataQuery` / `hostRunAction` / `hostRunExtract` / `hostRunObserve`
六处 `h.open()` 全汇聚到它，未来新增调用点也不会漏）：

```ts
pushHostEvent({
  kind: 'page',
  pageId: String(info.tabId),
  value: { action: 'open', url: info.url, tabId: info.tabId, title: info.title }
})
```

- 事件系统挂了不该影响开页 → `pushHostEvent` 包 try/catch（与 write-guard 的落点同一纪律）
- **零契约改动**：共享类型 / preload / MCP schema 的 `'page'` 早已声明 → **工具数仍 26**
- 界面摘要新增 page 分支 → 「打开页面 · 127.0.0.1 · ECCLAW 宿主验证页」（否则会甩一坨 JSON）

**② 导出物面板按日期 / 按类型归类**

导出物已经近百个，清单是一条平铺的长列表。按两种维度归类一下会好找：

| 归类方式 | 分组键 |
|---|---|
| 按日期 | 文件名里的 `YYYYMMDD`（主进程 `exportStamp()` 用本地时间拼的 = 导出那天的本地日历日）；文件名认不出来才退回 `modifiedAt` |
| 按类型 | 拆分产物有 `kind`（observe / approval / page）；单文件导出（里面混着多种）归「混合（未拆分）」 |

- 纯前端算：**不改 IPC、不改导出清单结构** —— 清单还是那一份文件列表，只是界面上摆一下
- 默认「不分组」= 现状一字不差 → 老断言不破、回归零风险
- **删除按钮 testid `export-remove-{文件名}` 在两种视图下一字不变** —— 归类只是摆放方式变了，
  不能让「点哪个文件删哪个」跟着视图变
- agent 侧 `ecclaw_export_list` 保持扁平（只列不删，不加工具）

**③ 实测**

`phase3t-e2e.cjs` **16/16 全绿**：A 组工具面（26 个工具 / `kinds` 枚举含 page）·
B 组 page 事件产生点（开页 → 落 1 条 page 事件 → `ecclaw_event_replay` 带 `kinds:['page']` 取到 →
汇总 `byKind.page` → `ecclaw_events_since` 带 kind → 导出物含 `"kind":"page"`）·
C 组归类视图（三种模式 + 文件守恒 + 删除 testid 不变）· D 组红线（导出物只增不删 / 护栏设置无污染）。

回归八套**实测全绿**（数字逐条取自 `C:\Temp\ecclaw-verify\run51-summary.txt`，非预期值）：
phase3t **16** · phase3s **49** · phase3r **31** · phase3q **26** ·
phase3p **45** · phase3o **44** · phase3m **69** · sse **14**（FAIL 全 0）。

---

### 5.24 远程包仓库灰度发布（rollout）

第二十阶段。远程包仓库已有全链（拉 `index.json` → 下载 → sha256 → 安全解包 → `current.json` 指针），
本阶段只补「**新版本先给一部分客户端**」这一层。

**① 清单扩展（全可选，向后兼容）**

```jsonc
{
  "packageId": "taobao",
  "version": "1.0.68",
  "channel": "canary",
  "packageUrl": "https://…",
  "rollout": { "id": "taobao-1.0.68-canary-1", "percent": 10,
               "allowClientIds": ["…"], "denyClientIds": ["…"] }
}
```

- **没有 `rollout` 字段 = 100% 可见** → 老 `index.json` 行为一字不变
- `rollout` 写坏（缺 id / percent 非数字）→ **fail-closed 按 percent=0 处理**：
  灰度是放量闸门，清单写坏了宁可少放，不能误放给全量
- `denyClientIds` 优先于 `allowClientIds`，二者都优先于 percent

**② 客户端分桶（本地、无遥测）**

- 首次拉清单时在 `ecclaw-settings.json` 惰性生成匿名 `clientId`（UUID），**只落本地、绝不上传**
- `bucket = parseInt(sha256(clientId + ':' + rollout.id).slice(0, 8), 16) % 100`
- 同一 `clientId` + 同一 `rollout.id` 桶位恒定（重启不变）；换 `rollout.id` 即重新洗牌
- `eligible = bucket < percent`

**③ 准入双保险**

- `fetchRepoIndex()` 给每个条目补只读派生字段 `eligible / bucket / eligibleReason`（界面据此显示原因）
- `installRemotePackage()` **在安装路径再判一次** —— 不能只靠界面禁用按钮；
  `version` 参数只用于选条目，**不等于放行**；只有显式 `{ bypassRollout: true }` 才越过灰度
  （仍照旧校验 sha256 / manifest / zip 安全规则）
- 未指定版本时，在 eligible 集合里取最高版本；集合为空 → 明确报错「灰度未放行（bucket=…, percent=…）」，
  不静默降级、不删已安装版本
- 保持「旧版本目录只增不删」；不加 MCP 工具（**工具数仍 26**）

**④ 界面**

远程包仓库条目显示 `灰度命中 / 未灰度到（bucket/percent%）/ 内测名单 / 已排除`；
未放行的条目安装按钮禁用，文案「未放行」（主进程仍会二次拒绝）。

---

### 5.25 文档预览（先 PDF）

第二十一阶段。文件库里的 **PDF** 现在可以直接看：点文件 → 抽页数 + 逐页文本；agent 也能读（新增只读 MCP 工具）。

- **判定**：按文件头 `%PDF-` 判定，不靠扩展名（改名的 PDF 也认）。
- **抽取**：`pdfjs-dist` 的 legacy 构建（纯 JS，无原生编译）在主进程本地解析，
  文本按 `hasEOL` 换行，并做 **NFKC 归一化**（PDF 的 ToUnicode 常把「色」映成部首「⾊」，归一化后才是人能读、agent 能用的文本）。
- **只读且本地**：不联网、不外发、不改用户文件；解析在主进程完成。
- **路径守卫**：只允许文件库根目录（`<stateDir>\file-library\files`）内的文件，
  越界与符号链接逃逸一律拒绝（fail-closed）。
- **明确错误**：损坏 PDF / 加密 PDF / 非 PDF 都返回人话原因（不抛栈），界面上直接显示。
- **本轮不做**：PDF 位图渲染 —— Electron 不内置 PDF 插件，渲染成图需引入原生 canvas 依赖。

**MCP 工具**（26 → **27**）：
`ecclaw_document_preview({ path? , name? , maxPages? , maxChars? })`
- 不传 `path`/`name` → 返回**文件库文档清单**（name / kind / size / modifiedAt）；
- 传 `path` 或 `name` → 返回该文档的**页数 + 逐页文本**（`pages[]`）+ 全文 `text` + `truncated` 标记。

> 为什么必须加工具：此前 agent **没有任何文件读取工具**，不加这个工具就完全读不到 PDF。

**界面**：文件库里的 PDF 条目带「PDF 预览」标签；点开后右侧显示
「PDF · N 页 · 体积」、逐页文本（`doc-preview-page-N`）、以及解析失败原因（`doc-preview-error`）。

### 5.26 DOCX 抽取 + PDF 位图预览

第二十二阶段。在 §5.25 之上补齐两块：

- **DOCX**：按 zip magic + `word/document.xml` 条目判定，`fflate` **只解正文条目**（图片/媒体不落内存，
  天然规避 zip 炸弹）；段落、制表符、换行、表格（按 `"a | b | c"` 行展开）、XML 实体（`&amp;`、`&#x989C;`）
  都会被还原，再做 NFKC。`ecclaw_document_preview` 直接返回全文 `text`（`pageCount=null`、`pages=[]`）。
- **PDF 位图**：`@napi-rs/canvas`（N-API，Electron 直接加载）+ pdfjs `page.render()` 渲染单页 PNG，
  **只在界面显示**（`doc-preview-image`，带 `scale` 0.5–3、页码与尺寸），**不返回给 agent**——
  避免把几百 KB base64 灌进模型上下文。agent 仍然读文本。
- **工具数不变**：仍是 **27**（只更新 `ecclaw_document_preview` 的描述）。
- **只读且本地**：不联网、不外发、不改用户文件；路径守卫与错误语义同 §5.25。

**界面**：DOCX 条目带「DOCX 预览」标签，点开显示 `doc-preview-text`；
PDF 点开后先显示位图（`doc-preview-image` / `doc-preview-image-meta` / `doc-preview-prev` / `doc-preview-next`），
下方仍保留逐页文本。

### 5.27 PPTX / XLSX 抽取

第二十三阶段。在 §5.26 之上把「Office 三兄弟」补齐：**PPTX（PPT）与 XLSX（Excel）也能预览、agent 也能读**。

- **判定**：仍是 zip magic，但**不再靠「头部/尾部探子串」** —— 改读 **zip 中央目录**（EOCD → 中央目录条目表）。
  中央目录里一定列着全部条目名，读它最准也最省（只读目录，不碰正文）。按条目名判：
  `word/document.xml` → docx，`ppt/presentation.xml` → pptx，`xl/workbook.xml` → xlsx。
  读不出中央目录时**回退**到老的子串探测（两头各 128KB）。
- **PPTX**：`fflate` 只解 `ppt/presentation.xml`、`ppt/_rels/presentation.xml.rels` 与 `ppt/slides/slideN.xml`。
  幻灯片**顺序**优先按 `presentation.xml` 的 `sldIdLst`（那是真实放映顺序），读不到再按 `slideN.xml` 编号排。
  文字取 DrawingML 的 `<a:t>`（`<a:br/>` 记为换行），XML 实体照旧解码。
- **XLSX**：解 `xl/workbook.xml` + `xl/_rels/workbook.xml.rels` + `xl/sharedStrings.xml` + `xl/worksheets/sheetN.xml`。
  工作表**顺序与表名**取自 `workbook.xml` 的 `<sheets>`（表名只在这里）；单元格分三类：
  `t="s"` 走 **sharedStrings** 下标、`t="inlineStr"` 走内联字符串、其余是 `<v>` 里的原始值
  （数字就是数字；日期因为要读样式表才能还原，**本轮不还原**，原样给）。
  单元格按**引用列号**落位（`B7` → 第 2 列），中间缺列补空 → 每行渲染成 `a | b | c`。
- **格式**：PPTX 每页前加 `[幻灯片 N]`，XLSX 每张表前加 `[工作表 表名]`；全文走同一套 NFKC + 空白归一化。
- **只读且本地**：不联网、不外发、不改用户文件；路径守卫与错误语义同 §5.25（`maxChars` 截断、空文档给明确错误）。
- **工具数不变**：仍是 **27**（只更新 `ecclaw_document_preview` 的描述）。

**界面**：PPTX / XLSX 条目带「PPTX 预览」/「XLSX 预览」标签，点开显示 `doc-preview-text`（与 DOCX 同一个 testid）。

### 5.28 XLSX 日期还原

第二十四阶段。补上 §5.27 明确留下的欠账：**XLSX 里的日期以前是「序列号原样给」**（`45000`），
本轮按单元格的**数字格式**还原成人能读的日期。

- **怎么找到格式**：单元格 `s="i"` → `xl/styles.xml` 的 `<cellXfs>` 第 i 个 `<xf>` 的 `numFmtId`
  → 内置表（14–22、27–33、45–47、50–56）或 `<numFmts>` 里的自定义 `formatCode`。
- **怎么判断是日期**：扫描格式码（先剔掉引号字面量 `"年"`、反斜杠转义 `\-`、方括号段 `[$-409]`）：
  `y`/`d` 是年/日，`h`/`s` 是时/秒，`m` 看邻居 —— 紧跟小时之后或紧邻秒之前是「分」，否则是「月」。
  方括号里的 `[h]` 是「已用时数」（时长）→ **不当日期**，原样留数字。
- **怎么转**：序列号 → 日历。**1900 历元**（默认）以 1899-12-31 为基准，号 ≥ 61 的要减 1 天
  （Excel 塞了个不存在的 1900-02-29，号 60 按字面输出）；**1904 历元**（`workbookPr@date1904="1"`）
  以 1904-01-01 为基准、号 0 就是那天。小数部分是时分秒。
- **输出**：统一成 `YYYY-MM-DD`，带时间的补 ` HH:MM`（有秒再补 `:SS`），纯时分给 `HH:MM[:SS]`。
  **不照搬 Excel 的显示样式**（`m/d/yy` 也给 `2023-03-15`）—— 无歧义、可排序、对 agent 更友好。
  > 第二十五阶段已改为**照搬 Excel 显示样式**（`m/d/yy` → `3/15/23`），见 §5.29；本节的序列号/历元算法不变。
- **只转数值型单元格**：共享字符串 / 内联字符串 / 布尔 / 公式字符串一律不动（哪怕它挂了日期样式）。
- **工具数不变**：仍是 **27**（`ecclaw_document_preview` 描述与参数都没改）。

**界面**：无变化（XLSX 条目仍带「XLSX 预览」标签），只是抽出来的文本里日期已经是日期。

### 5.29 XLSX 照搬 Excel 显示样式 + DOCX 表格转 Markdown

第二十五阶段。两项一起做：

1. **XLSX 从「统一 ISO」改为「照搬 Excel 显示样式」**（改口径，见 §5.28 的备注）。
   同一个 `formatCode` 渲染器同时负责日期与数字：
   - **日期/时间**：`y/yy/yyyy`、`m/mm/mmm/mmmm`、`d/dd/ddd/dddd`、`h/hh`、`s/ss`、`AM/PM`、`A/P`；
     `m` 的月/分歧义仍靠邻居判（前 h 后 s = 分）；月名/星期名固定英文（不依赖系统 locale）。
     例：`m/d/yy` → `3/15/23`、`mmm-yy` → `Mar-23`、`h:mm AM/PM` → `1:30 PM`、
     `yyyy"年"m"月"d"日"` → `2023年3月15日`、`dddd` → `Wednesday`。
   - **时长**：`[h]:mm:ss` 按已用时长渲染（`1.5` → `36:00:00`），不再原样留数字。
   - **数字**：整数/小数位（`0.00` → `12.50`）、千分位（`#,##0.00` → `1,234,567.89`）、
     百分比（`0.00%` → `12.34%`）、货币（`"¥"#,##0.00` → `¥1,234.50`）、
     负数分段与括号（`#,##0.00;[Red](#,##0.00)` → `(1,234.50)`）、取整（`0` → `13`）。
   - **回退**：General（无样式）保留原值；科学计数法、分数等不支持的模式也保留原值，不擅自改写。
   - 仍然**只处理数值型单元格**：字符串即使挂了日期/数字样式也不动。
2. **DOCX 表格 → Markdown 表格**：首行作表头，补 `| --- |` 分隔行，缺的列补空；
   单元格内竖线转义成 `\|`、换行转 `<br>`；表格前后的正文段落顺序不变。

**工具数不变**：仍是 **27**（`ecclaw_document_preview` 的参数与描述未改）。

### 5.30 DOCX 合并单元格 → Markdown 表格

第二十六阶段。Markdown 表格没有 colspan / rowspan，本轮把 Word 的两种合并落到管道表上：

- **横向 `w:gridSpan="N"`**：内容只放合并区首格，其余 `N-1` 格补空 —— 后续列位因此与其它行对齐，
  不会被挤错列。跨度上限 **32 列**（`MAX_GRID_SPAN`），畸形文件写 `999` 也不会把表格撑爆；
  `w:val` 缺失 / 非数字 / `0` 一律按 1 列处理。
- **纵向 `w:vMerge`**：`restart` 格正常输出内容；续格通常没有正文 → 输出空格，值只在起始行出现一次。
  续格若自带文本则照常输出，**不丢数据**（fail-safe）。
- 属性只读**单元格自己的 `w:tcPr`**（必须紧跟 `<w:tc>`），嵌套表格的 `tcPr` 不参与判定。
- 首行表头 / 分隔行 / 缺列补空 / `\|` 转义 / `<br>` 沿用 §5.29；空行（无 `w:tc`）跳过。

已知限制：单元格里再嵌一层表格时，`<w:tc>` 的非贪婪匹配会在内层 `</w:tc>` 提前收尾（**已在 §5.31 修掉**）。

**工具数不变**：仍是 **27**；**无新增依赖**。

### 5.31 DOCX 单元格内嵌表格 → 深度感知抽取

第二十七阶段。修 §5.30 末尾那条已知限制。

**根因**：DOCX 抽取原先全部用**非贪婪正则配对标签**（`<w:tc>…</w:tc>`、`<w:tr>…</w:tr>`、`<w:tbl>…</w:tbl>`）。
这假设标签不嵌套，但 Word 里**单元格套表格**是常规排版手法 → 外层的闭合标签实际落在**内层**，
非贪婪匹配提前收尾，结果是外层列位错乱、外层后续行被整段吃掉。

**改法**：新增 `docxChildElements()`，按容器标签做**栈式深度感知**配对，只取**直接子级**：

- 只跟踪 `w:tbl` / `w:tr` / `w:tc` / `w:p` 四种容器标签，`w:r` / `w:t` / `w:sdt` 等叶子不参与层级判定；
- 错配的闭标签直接忽略（不猜配对）；自闭合标签（`<w:p/>`）按空子元素处理；
- 表格 / 行 / 单元格 / 段落**四层全部改走它**，不再有非贪婪正则。

**呈现口径**：Markdown 套不了表格（没有嵌套管道表）→ 内嵌表**按行摊平进所在格**，
每行占一行、行内各列以 ` \| ` 分隔（渲染成 `<br>` 换行）。内容与位置都不丢，
内层列也**不会把外层列撑开**。合并格（`w:gridSpan`）里再嵌表时，跨度补空规则照旧生效。

**工具数不变**：仍是 **27**；**无新增依赖**。

### 5.32 XLSX 颜色信息 + 条件格式

第二十八阶段。以前数字格式里的颜色标记（`[Red]`）只被剥掉、不输出任何信息；本轮把**颜色**作为单元格文本的附加信息补上。
呈现口径统一为**值后追加标记**，无颜色时输出与以前一字不差：

- 字体色：` [颜色:红]`；底色：` [底色:黄]`；两者都有：` [颜色:红;底色:黄]`。
- 常见 8 色用中文名（红/绿/蓝/黄/品红/青/黑/白），其它显式 rgb 输出 `#RRGGBB`（不猜近似色）。
- 优先级：**条件格式 > 数字格式段颜色 > 静态字体色**；底色来自条件格式或静态填充。

三个来源：

1. **数字格式段颜色**：`[Red]` / `[Blue]` / `[Color10]` 等按 Excel 的分段规则取色
   （正数第 1 段 / 负数第 2 段 / 零第 3 段），所以 `#,##0.00;[Red](#,##0.00)` 只有负数带红色；
   文本单元格取第 4 段（`[Blue]@`）。`[ColorN]` 原样输出 `ColorN`，不臆测调色板。
2. **静态字体色 / 填充色**：`cellXfs[i]` 的 `fontId`/`fillId` → `fonts.xml` / `fills.xml`。
   只认**显式 rgb**；`theme` / `indexed` 色（需要 theme1.xml 才能解析）一律不报（fail-safe）。
   默认黑字、`patternType="none"`、白色填充不报。
3. **条件格式**：读工作表 `<conditionalFormatting sqref>` + `styles.xml` 的 `<dxfs>`。
   支持 `cellIs`（greaterThan / greaterThanOrEqual / lessThan / lessThanOrEqual / equal / notEqual /
   between / notBetween）、`containsText` / `notContainsText` / `beginsWith` / `endsWith`；
   按 `priority` 升序、`stopIfTrue` 截断。**图形类规则**（colorScale / dataBar / iconSet）、
   `expression` **跳过**（不猜公式结果），不影响其它规则的输出；
   **区间级规则**（top10 / aboveAverage / duplicateValues / uniqueValues）见 §5.36。

**工具数不变**：仍是 **27**；**无新增依赖**。

### 5.33 XLSX 科学计数法 / 分数格式渲染

第二十九阶段。§5.29 的数字渲染一直把科学计数法与分数格式当「不支持」→ 直接保留原值
（`0.00E+00` 渲出来是 `12345`），本轮补上这两类格式。

- **科学计数法**：`0.00E+00` → `1.23E+04`；内置格式 11 同样生效。
- **工程计数法**：`##0.0E+0` → `12.3E+3`；内置格式 48 同样生效。
  - 判据：**小数点前至少 2 个数字占位槽**（`##0` / `###`）→ 算工程格式，指数**向下取 3 的倍数**、
    尾数落在 `[1, 1000)`（`12345` → `12.3E+3`，不是 `1.23E+4`）；只有 1 个槽（`0.0E+0`）→ 仍是科学计数法。
  - 尾数按格式的小数位四舍五入；四舍五入进位到 10（9.999 → 10.00）时尾数归 1、指数加 1。
  - 指数位数取格式里 `0` 的个数（`E+00` 两位、`E+0` 一位）；`E+` 时正指数也带 `+` 号，
    `E` / `E-` 只有负指数带号（`1.23E+04` vs `1.23E-04`）。
  - 负数走格式的第 2 段（`0.00E+00;(0.00E+00)` → `(1.23E+04)`）；只有 1 段时自动补 `-`。
- **分数**：`# ?/?` → `2 1/2`、`?/?` → `1/2`、`# ?/4`（固定分母）→ `0 1/4`。
  - 分子 / 分母的槽位宽度当作**位数上限**（`?/?` → 分子分母各最多 1 位）。
  - 取**最佳有理逼近**（连分数收敛分数），不是就近取整 —— 就近取整会把 0.3 取成 `2/7`，
    Excel 给的是 `1/3`。
  - 固定分母按 `round(小数部分 × 分母)` 取分子，**不约分**（0.5 → `2/4`）。
  - 小数部分四舍五入成 1（2.999）时进位到整数；整数值的分数部分为空 → 只给整数（`2`）。
  - 槽位宽度**不做对齐补空格**（预览文本里不留悬空空格）—— 与 Excel 的差异仅在对齐空格。
- **字面量不算结构**：新增「掩码」层 —— 引号里的 `E`、斜杠不会被当成科学计数法 / 分数
  （`"E"0.00` → `E12.50`，`"a/b"0.00` → 保留原值 `12.5`）。
- **回退**：解析不了（分子放不下、畸形格式）一律保留原值，不硬解。

**工具数不变**：仍是 **27**；**无新增依赖**。

### 5.34 PDF 多页缩略图 + 指定页 / 缩放渲染参数

第三十阶段。以前 PDF 预览只有「第 1 页 + 上一页 / 下一页」，渲染倍率固定 1.5 且界面调不了；
长文档要翻到第 50 页只能一格格点。本轮把渲染参数暴露到界面，并加一条缩略图导航条。

- **缩略图导航条**：以当前页为中心的**连续 12 页**，每页一张缩略图，点击即切页；
  窗口随当前页滑动（跳到远处时窗口跟着挪），**已渲染过的页命中缓存、不重复渲染**
  （主进程每渲染一次都要重解 PDF）。
  - 缩略图按**目标宽度**（默认 132 px）归一，**不按固定 scale** —— PDF 页面尺寸不一
    （A4 595 / Letter 612 / 横向），固定 scale 会让缩略图宽窄不一、排不齐；
    宽度归一后高度按各页高宽比走，所以缩略图高度会有轻微差异。
  - 一次最多 **24 张**（`MAX_THUMBS`）；页码越界 / 非法值直接过滤；缩略图宽度夹在 48–400 px。
  - 缩略图**先铺白底再渲染**：PDF 页面本身不画背景（透明），不铺底会发黑。
- **指定页**：页码输入框 + 「跳转」按钮（也可用上一页 / 下一页）；页码越界由主进程夹到有效范围。
- **缩放**：50% / 75% / 100% / 150% / 200% / 300% 七档，主进程夹在 0.5–3；
  换档后当前页按新倍率重渲。
- **agent 侧口径不变**：位图仍然**只给界面**，不返回给 agent（不把 base64 灌进上下文）；
  `ecclaw_document_preview` 的参数与描述一字未改。

**工具数不变**：仍是 **27**；**无新增依赖**。

### 5.35 PDF 目录（书签）导航 + 页码范围抽取

第三十一阶段。PDF 预览与 agent 侧预览各补一件事：**能看见目录**、**能只抽一段页码**。

- **目录（书签）**：解析 PDF 的 outline（支持多级），输出 `[{ title, page, children }]`。
  - `page` 是目标页码（1 起）；**解析不出来时是 `null`，不猜页码** —— 猜错了点一下会跳到别的页，比不跳更糟。
  - **界面**：PDF 预览顶部出现目录面板，**点目录项直接跳到对应页**；没有书签就不显示面板（不占地方）。
  - **agent 侧**：`ecclaw_document_preview` 的返回里带 `outline`，agent 能看到「章节标题 + 页码」。
  - 目录是**加分项**：解析失败一律当「没有目录」，绝不影响正文抽取。
- **页码范围抽取**：`ecclaw_document_preview` 新增可选参数 `startPage` / `endPage`（PDF 专用）：
  - 越界一律**夹住**：`startPage` 夹到 `[1, 总页数]`，`endPage` 夹到 `[startPage, 总页数]`；
    只给 `startPage` 就从该页抽到末尾，只给 `endPage` 就从第 1 页抽到该页；
    `startPage > endPage` 夹成同一页；非数字（NaN）退回全文。
  - `maxPages`（单次最多抽多少页，上限 200）与范围**叠加**生效。
  - 返回里带 `pageStart` / `pageEnd`，agent 知道自己拿到的是哪一段；
    范围没覆盖全文时 `truncated` 为 true（内容不完整，如实说）。

**工具数不变**：仍是 **27**（未新增工具）；**无新增依赖**。

### 5.36 XLSX 区间级条件格式（top10 / 均值 / 重复值）

第三十二阶段。§5.32 的条件格式只支持「看当前一个格子就能判定」的规则；
Excel 里另一大类**必须看整段范围**的规则（Top 10、高于均值、高亮重复项）此前**一律静默丢弃**。

- **top10**：`rank`（默认 10）取前 / 后 N 项；`percent="1"` 时 `rank` 是百分比
  （取名次 = `ceil(个数 × 百分比)`）；`bottom="1"` 取最小的 N 项。
  并列按「≥ 阈值」判定（bottom 为「≤ 阈值」）—— 名次不够时**多出来的一档也一起高亮**（与 Excel 一致）。
- **aboveAverage**：范围内**数值**的均值；`aboveAverage="0"` 改为低于均值；
  `equalAverage="1"` 把「恰好等于均值」也算命中；`stdDev="1"` 改成「偏离均值超过 1 个样本标准差」。
- **duplicateValues / uniqueValues**：范围内出现两次 / 只出现一次的单元格。
  文本比较**大小写不敏感**；**数字与文本不同类**（数字 `5` 与文本 `"5"` 不算重复）。
- **多区域 sqref 按每段独立统计**：`sqref="A1:A5 C1:C5"` 时两段各自排名
  （单区域是绝大多数情况，两种口径等价）。
- **fail-safe**：范围内没有数值 / 数据不足 → 规则不命中（不猜）。

**实现上的关键改动**：条件格式从「逐格判定」改成**三趟** ——
①解析全部单元格 → ②按范围算出每条区间级规则的命中集合 → ③逐格套颜色。
命中与否**预先算成一张「行:列 → 命中」表**，逐格渲染时查表。

**输出通道不变**：仍走既有 `[颜色:X;底色:Y]` 标记 —— 不新增文本标记、不破坏既有输出。

**工具数不变**：仍是 **27**；**无新增依赖**。

### 5.37 XLSX 单位 / 工程 / 会计格式 + 日期 locale 本地化

第三十三阶段。§5.29–§5.33 把数字格式做了一轮，本轮补上剩下的三块 —— **单位**、
**工程计数法**、**会计格式**，外加**日期 locale 本地化**。

- **单位**：引号 / 反斜杠字面量紧跟数字（`0.0"kg"` → `12.5kg`、`#,##0" 件"` → `1,234 件`）。
  这类字面量本身之前就能出，本轮是把它和**缩放**一起测全。
- **缩放逗号**：小数点**之后**的每个尾逗号 = 除以 1000
  （`#,##0,,` → 12345678 出 `12`；`#,##0.0,,` → `12.3`；`0.0,` → 1234 出 `1.2`）。
  - 整数位**中间**的逗号仍是千分位；小数点后的尾逗号此前**被漏掉**
    （`0.0,` 原来出 `1234.0,`）。
- **工程计数法**：小数点前**至少 2 个数字占位槽**（`##0` / `###`）→ 算工程格式，
  指数**向下取 3 的倍数**、尾数落在 `[1, 1000)`。
  - `##0.0E+0` → 12345 出 `12.3E+3`（不是科学计数的 `1.2E+4`）；`##0.00E+00` → `12.35E+03`。
  - 只有 1 个槽（`0.0E+0`）→ 仍是科学计数法（`1.2E+4`），行为不变。
  - 内置格式 48（`##0.0E+0`）同样生效。
- **会计格式**：`_($* #,##0.00_);_($* \(#,##0.00\);_($* "-"??_);_(@_)` 这类四段式。
  - 正 `$1,234.50` / 负 `$(1,234.50)` / 零 `$-`
    （**零段不补 `0`** —— Excel 会计零段靠 `??` 槽不吃掉那个 0，只留横线）。
  - `*` 填充、`_` 宽度占位**丢弃**（`_` 只是右对齐留白，纯文本里不可见）；
    括号段落照常出 `(1,234.50)`。
- **日期 locale**：`[$-804]`（zh-CN）→ `3月` / `三月` / `周三` / `星期三` / `上午`·`下午`；
  `[$¥-804]` 货币也认 locale。
  - **只有带 locale 前缀才本地化**；没前缀（`mmm d, yyyy` → `Mar 15, 2023`）或
    英文 locale（`[$-409]`）**一律保持英文** —— 避免误伤既有输出。
  - 本条只描述 zh-CN 行为；locale 范围（zh-TW / 日 / 德 / 法）已在 §5.38 扩展。
- **整数位按 Excel 槽位语义渲染**：`0` 槽没数字显示 `0`、`#` 槽不显示、`?` 槽显示空格；
  数字右对齐填最右槽；槽不够**不截断**。
  - 代价：槽位补出来的**对齐空格在纯文本里看不见**（`normalizeText()` 会把连续空格压成 1 个）→
    会计格式只能**紧凑输出**（这是设计取舍，不是漏做）。

**回归影响**：`##0.0E+0` 从 `1.2E+4` 变成 `12.3E+3`（Excel 本来就是工程格式）→
phase4d 自测 / e2e 的两条期望值已同步更新，README §5.33 一并注明。

**工具数不变**：仍是 **27**；**无新增依赖**。

---

### 5.38 XLSX 日期 locale 扩展 + 文本格 `@` 字面量

第三十四阶段。§5.37 把 `[$-804]`（zh-CN）做进日期渲染，本轮把 locale **扩到 5 种**，
并补上**文本格**的 `@` 占位符语义。

- **locale 扩展**（LCID → 月 / 星期 / 上下午）：
  - zh-CN `804`（已有）· zh-TW `404` · ja-JP `411` · de-DE `407` · fr-FR `40C`；
    en-US `409` **显式支持**（保持英文）。
  - 日语：月名走中文式 `3月`，星期走 `水曜日` / `水`，上下午 `午後`；
    德语 `Mär` / `März` / `Mittwoch` / `Mi`；法语 `mars` / `mercredi` / `mer.`。
  - **认不出的 locale 一律回落英文**（如 `[$-999]`）—— 不猜、不误本地化。
  - **不连带改日期先后顺序**：格式码怎么写就怎么输出（保持可复现），
    locale 只影响**名称**。
- **文本格 `@` 字面量**（Excel 的文本占位符）：
  - `"¥"@` → `¥abc`；`"预"@"后"` → `预abc后`（此前一律输出裸 `abc`）。
  - 判定靠**掩码串**里的**结构 `@`**（真占位符）—— 字面量里的 `@` 不算
    （`"a@b"@` → `a@bx`）。
  - 纯数字格式对文本格**仍然不生效**（`0.00` 套文本 → `abc`）。
  - 格式码第 4 段优先（`General;General;General;"段"@` → `段abc`），
    不足 4 段时取第 1 段。
- **duration 取数一致性小修**：`[h]:mm:ss` / `[m]:ss` / `[ss]` 语境下，
  `mm` / `ss` 改为从**总秒数取模**（原先取当天时钟的分钟 / 秒，
  亚秒舍入边界会差 1 秒）。**输出实测不变**（`1.5011574074` → `36:01:40`）。

**探针先行**：本轮开打前实测发现，§5.37 handoff 候选清单里的
「日期 duration」与「科学计数法负指数」**早已实现且与 Excel 一致**（候选过期），
真正的缺口只有 locale 扩展与文本 `@` 两项 —— 候选清单**先探针再选题**。

**回归影响**：zh-CN 与英文输出**一字未动**；纯数字格式对文本格行为不变。

**工具数不变**：仍是 **27**；**无新增依赖**。

---

### 5.39 DOCX 结构保真（标题层级 / 多级列表编号 / 粗斜体 / 页眉页脚脚注）

第三十五阶段。§5.26 起 DOCX 只能抽出**扁平纯文本**（标题层级、列表编号、强调、页眉页脚全丢），
本轮把 DOCX 的**结构信息**补回来，输出走 Markdown 标记（与既有表格 Markdown 风格一致）。

- **标题层级**：读 `word/styles.xml` 判定 —— style 自带 `outlineLvl` 优先，
  否则从 style 名取数字（认 `heading 1` / `标题 1`）；输出 `#` ~ `######`。
- **多级列表编号**：读 `word/numbering.xml`（`numId` → `abstractNumId` → `ilvl`），
  按 `numFmt` 渲染 decimal / lowerLetter / upperLetter / lowerRoman / upperRoman / 中文数字，
  按 `lvlText` 的 `%1` / `%2` 槽位拼多级前缀；本级 +1、更深层计数器清零；
  缩进按层级每级 2 空格（用哨兵占位，归一化后再还原成空格）。
- **粗体 / 斜体**：run 级 `w:b` / `w:i` → `**x**` / `*x*` / `***x***`；
  **表格单元格内同样应用**（标题与列表标记不应用）。
- **页眉 / 页脚 / 脚注**：页眉置顶 `[页眉] …`、页脚置底 `[页脚] …`；
  脚注在正文后出 `[脚注]` 块（按引用顺序编号），正文引用处内联 `[N]`。

**探针先行**：本轮开打前实测发现，上轮 handoff 候选清单里的
「XLSX `expression` 条件格式」是真缺口但价值中、「文本 `@` 剩余形状」是真缺口但价值低，
而 DOCX / PPTX 这条**新轴**上结构丢失最明显 —— 标题层级、列表编号、粗斜体、页眉、脚注全丢，
因此本轮改选 DOCX 结构保真（候选清单**先探针再选题**）。

**范围**：只改 `electron/main/document-preview.ts`；契约 / `host-bridge.ts` / `host-server.mjs` /
`src/App.tsx` 不动。

**工具数不变**：仍是 **27**；**无新增依赖**。

---

### 5.40 PPTX 结构保真（表格列关系 / 演讲者备注 / 图片 alt）

第三十六阶段。§5.27 起 PPTX 只能抽出**每页每段一行**的扁平纯文本 ——
表格被摊平成一堆独立行（**列关系全丢**）、演讲者备注整页丢失、图片 alt 丢失。
本轮把 PPTX 的**结构信息**补回来，表格走 Markdown 管道表（与 DOCX 表格风格一致）。

- **表格 → Markdown 管道表**：`p:graphicFrame` 里的 `a:tbl` 按 `a:tr` / `a:tc` 取出，
  首行作表头 + `| --- |` 分隔行，**缺列补空**（复用既有 `markdownCell()`）。
- **合并单元格口径与 DOCX 一致**：横向 `gridSpan="N"` → 内容只放首格、其余 N−1 格补空
  （后续列位因此与其它行对齐）；纵向 `rowSpan` / `hMerge` / `vMerge` → 内容留在起始格、续格补空。
- **演讲者备注**：按幻灯片自己的 `ppt/slides/_rels/slideN.xml.rels` 找 `notesSlide`，
  取**正文占位符**（`p:ph@type="body"`）的多段文字，落在**该页正文末尾** `[备注] …`。
- **图片 alt**：`p:pic` 的 `p:nvPicPr` 里 `cNvPr@descr` → `[图片: 营收趋势折线图]`；
  **没有 descr 的图片不产生噪音行**。
- **占位符降噪**：`sldNum` / `dt` / `hdrFtr` / `ftr` 四类占位形状**整页跳过** ——
  否则页码域文字（`<a:fld><a:t>2</a:t>`）会混进正文变成孤立的一行「2」。

**范围**：只改 `electron/main/document-preview.ts`；契约 / `host-bridge.ts` / `host-server.mjs` /
`src/App.tsx` 不动。

**工具数不变**：仍是 **27**；**无新增依赖**。

---

## 6. 技能与文件库

- **技能**：`<stateDir>/skills`（托管）与 `<stateDir>/user-skills`（用户自建），
  每项一个目录，入口 `SKILL.md`，frontmatter 解析 `name` / `description`。
  「技能」页可直接编辑并保存到 `user-skills`。
- **文件库**：`<stateDir>/file-library`，「文件库」页列出并预览文本内容。

---

## 7. 内核接缝

- 内核解析顺序：`ECCLAW_OPENCLAW_BIN` → 应用内 `node_modules/openclaw/openclaw.mjs` → PATH 上的 `openclaw`。
- **必须带 `ELECTRON_RUN_AS_NODE=1`**：Electron 主进程里的 `process.execPath` 是 `electron.exe`，
  直接 `electron.exe openclaw.mjs` 会以「Electron 应用」模式启动，gateway 会停在 bootstrap 之后
  永不监听端口。加上该变量后 `electron.exe` 退化为纯 Node，gateway 正常起来（实测监听 `127.0.0.1:<port>`）。
- 启动内核：`openclaw gateway --port 43117`（HTTP + WebSocket 服务，**没有 /health**，
  故 ecclaw 用 TCP 端口探测判活）。
- **冷启动约 20–30 秒**（首次要建 SQLite 状态库与运行时索引），健康探测窗口设为 60s；
  超时则杀掉子进程并在侧栏报错，避免留下假「运行中」状态。
- 对话：`openclaw agent --local --json --message <text> --session-id <id>`；
  `--local` 走内嵌 agent，不依赖 gateway 进程，失败自动回落到带 gateway 的调用。
- 子进程环境：`HOME` / `USERPROFILE` / `OPENCLAW_STATE_DIR` / `OPENCLAW_CONFIG_PATH`
  全部指向 ecclaw 的 openclaw 根目录，保证与 dabi 的目录语义一致。
- openclaw 要求配置里显式声明 `gateway.mode`（`local` / `remote`），否则直接拒绝启动
  （`Gateway start blocked: existing config is missing gateway.mode`）。
  ecclaw 写配置时自动补 `gateway.mode: "local"`。
- gateway 鉴权：未配置时 openclaw 每次启动生成一次性 runtime token（日志里会提示
  `auth token was missing`）；想固定下来执行
  `openclaw config set gateway.auth.mode token` + `openclaw config set gateway.auth.token <token>`。

---

## 8. 当前状态与第二阶段候选

**已验证**：两段 typecheck 通过、三段 build 通过、`openclaw config validate` 对生成的配置返回 `valid:true`、
Provider 增删改写入 openclaw.json 并通过上游 schema 校验。

**已实现（实验）**：内嵌浏览器宿主（数据查询 / 页面动作 / 页面提取 / observe 网络事件四通道，见 §5.8）、
远程包仓库（OSS 分发 + 版本渠道 + 清单拉取 + 安装，见 §5.7）、
**宿主接入对话链路**（MCP 服务 + loopback 桥，agent 可直接执行平台包能力，见 §5.9）、
**宿主写操作**（click / scroll / interceptNext / waitForNavigation，可见走真实鼠标手势、隐藏走 DOM 事件，见 §5.10）、
**写操作确认护栏**（ask / allow / deny 三档 + 60 秒超时自动拒绝，见 §5.11）、
**宿主桥 op 面直暴露成 MCP 工具**（8 → 12 个工具，含 `ecclaw_click` / `ecclaw_scroll`）、
**UI 暴露宿主桥就绪状态与护栏开关**（见 §5.11）、
**两段式写操作确认**（票据化 + `ecclaw_approval_status` 轮询，见 §5.12）、
**站点白名单**（一次授权一批，见 §5.12）、
**poll 订阅式持续刷新**（宿主事件总线 + 长轮询 + 界面增量更新，MCP 工具 12 → 16，见 §5.13）、
**护栏信任范围四档**（once / session / persistent / persistent-scroll + 白名单粒度 `match × ops × ttl`，
见 §5.14）、
**事件落盘与回放**（按天 JSONL + `ecclaw_event_replay`，MCP 工具 16 → 17，见 §5.14）、
**登录态持久 partition**（`persist:ecclaw-host`，重启后 cookie 仍在，见 §5.14）、
**事件汇总视图**（按平台包 / 类型 / 天聚合，`ecclaw_event_summary` + 界面「事件汇总」面板，
MCP 工具 17 → 18，见 §5.15）、
**落盘保留策略细化**（单文件 8MB 滚动分片 + 目录 256MB 上限，见 §5.15）、
**事件导出 + 信任规则可视化 + 白名单路径维度**（`ecclaw_event_export` / `ecclaw_guard_rules` /
`ecclaw_guard_clear_session`，MCP 工具 18 → 21 + 第五档信任范围 `persistent-path`，见 §5.16）、
**压缩归档 + 时间序列趋势 + 护栏粒度 + 事件推送通道**（先压后删的保留策略、day/hour 趋势、
`ecclaw_guard_remove`、宿主桥 `GET /events` SSE + `ecclaw_events_since`，MCP 工具 21 → 23，见 §5.17）、
**事件 seq 全局单调 + 导出物清理入口 + 趋势图**（启动续号 + 回放按 seq 升序、界面逐个删导出物（agent 只列不删）、
零依赖 SVG 柱状图，MCP 工具 23 → 24，见 §5.18）、
**店铺登录态 profile**（一个店铺一个独立 partition、多店登录态互不串味；默认 partition 名一字不改，
老登录态不丢；界面建店 / 切店 / 两段式移除，agent 侧只读清单 + 切换，MCP 工具 24 → 26，见 §5.19）、
**写操作事件落盘**（`kind:'approval'` 五处落点 + stage 语义 requested/executed/rejected/timeout/failed；
被拦下的写 2 条、站点信任放行 1 条；界面可读摘要；`ecclaw_events_since` 加 `kind` 过滤，工具数仍 26，见 §5.20）、
**事件流 kind 多选筛选 + 导出物按 kind 拆分**（`kinds` 多选优先于 `kind` 单选、脏值丢弃；
回放 / 汇总 / 导出共用同一套过滤语义；导出可按类型拆成多份文件、文件名带 kind 前缀、同秒重名不覆盖；
界面三处 kind 多选 + 拆分开关，MCP 四个事件工具加 `kinds`、导出工具加 `splitByKind`，工具数仍 26，见 §5.21）、
**写操作三终态真实站点复验**（rejected / failed(via=user) / failed(deny 分支) / timeout 全部在淘宝真站落盘实锤，
均 fail-closed、均不留信任；渲染层卡片堆栈加 `data-approval-id` 锚点；12s 终态自动收 + 全局粘滞 scope 定性，见 §5.22）、
**e2e 跨套件污染纪律**（每套件开局/收尾拒绝遗留 pending 卡 + 清会话信任；卡片按 approvalId 锚定；断言别用 `.slice(0,N)` 比总数）、
**页面事件补产生点 + 导出物面板归类视图**（开页落 `kind:'page'` 事件 = 「agent 开了哪些页面」不再无痕；
导出物可按日期/按类型归类，纯前端算不改 IPC；工具数仍 26；e2e 16/16 + 回归八套全绿，见 §5.23）、
**远程包仓库灰度发布**（`rollout` 可选字段 + 匿名 clientId 分桶 + 安装路径二次准入；
清单写坏 fail-closed 按 percent=0 放行；工具数仍 26，见 §5.24）、
**文档预览（先 PDF）**（文件库 PDF → 页数 + 逐页文本，界面可看、agent 可读；新增只读工具
`ecclaw_document_preview`，MCP 工具 26 → 27，见 §5.25）、
**DOCX 抽取 + PDF 位图预览**（DOCX 段落/表格/XML 实体还原成全文；PDF 单页 PNG 只给界面看、不返回 agent；
工具数仍 27，见 §5.26）、
**PPTX / XLSX 抽取**（zip 中央目录判类型；PPTX 按 `sldIdLst` 排版序，XLSX 走 sharedStrings + 单元格引用落位、
缺列补空；工具数仍 27，见 §5.27）、
**XLSX 日期还原**（单元格 `s="i"` → styles.xml 的 numFmtId → 内置表/自定义格式码判是否日期 →
序列号转 `YYYY-MM-DD [HH:MM[:SS]]`；1900/1904 双历元；时长与自定义非日期格式不误转；工具数仍 27，见 §5.28）、
**XLSX 照搬 Excel 显示样式 + DOCX Markdown 表格**（日期/时间按格式码渲染：`3/15/23`、`Mar-23`、`1:30 PM`、
`2023年3月15日`、`36:00:00`；数字渲染千分位/百分比/货币/负数分段/取整；不支持的模式回退原值；
DOCX 表格首行作表头转 Markdown；工具数仍 27，见 §5.29）、
**DOCX 合并单元格**（`gridSpan` 内容在首格、其余补空，上限 32 列；`vMerge` 值只出现一次；工具数仍 27，见 §5.30）、
**DOCX 单元格内嵌表格**（栈式深度感知取直接子级，内嵌表按行摊平进所在格；工具数仍 27，见 §5.31）、
**XLSX 颜色信息 + 条件格式**（`[Red]` 等格式段颜色 / 静态字体色与底色 / cellIs 与文本类条件格式，
值后追加 `[颜色:红;底色:黄]`；图形类规则跳过；工具数仍 27，见 §5.32）、
**XLSX 科学计数法 / 分数格式**（`0.00E+00` → `1.23E+04`、`# ?/?` → `2 1/2`；
最佳有理逼近取分数、字面量不误判、解析不了回退原值；工具数仍 27，见 §5.33）、
**PDF 多页缩略图 + 指定页 / 缩放渲染参数**（缩略图按目标宽度归一并以当前页为中心成窗口、
点击切页、页码跳转、倍率可调；位图仍只给界面；工具数仍 27，见 §5.34）、
**PDF 目录（书签）导航 + 页码范围抽取**（outline 多级书签 → 界面目录面板点击跳页；
agent 侧 `ecclaw_document_preview` 新增可选 `startPage` / `endPage` 越界夹住、
返回 `pageStart` / `pageEnd` / `outline`，范围不覆盖全文时 `truncated` 为 true；
解析不出目标页码时 `page` 为 `null` 不猜；工具数仍 27，见 §5.35）、
**XLSX 区间级条件格式**（top10 含 percent/bottom、aboveAverage 含 equalAverage/stdDev、
duplicateValues / uniqueValues；判定前先按范围算命中集合，逐格渲染时查表；
多区域 sqref 每段独立统计、数字与文本不同类、范围内无数据则不命中；
输出仍走既有 `[颜色:X;底色:Y]` 不新增标记；工具数仍 27，见 §5.36）、
**XLSX 单位 / 工程 / 会计格式 + 日期 locale**（引号与反斜杠单位字面量、小数点后尾逗号缩放、
`##0.0E+0` 工程计数法指数取 3 的倍数、四段式会计格式零段出横线、
`[$-804]` 触发中文月/星期/上下午且无 locale 保持英文；
整数位按 Excel 槽位语义渲染、对齐空格在纯文本里不可见故会计格式紧凑输出；
工具数仍 27，见 §5.37）、
**XLSX 日期 locale 扩展 + 文本格 `@` 字面量**（locale 扩到 zh-CN / zh-TW / 日 / 德 / 法
共 5 种，认不出的一律回落英文、不连带改日期先后顺序；
文本格 `"¥"@` → `¥abc`、`"预"@"后"` → `预abc后`，靠掩码串区分**结构 `@`** 与字面量里的 `@`，
纯数字格式对文本格仍不生效；
`[h]:mm:ss` 语境下 `mm`/`ss` 改从总秒取模（输出实测不变）；
工具数仍 27，见 §5.38）、
**DOCX 结构保真**（标题层级读 `styles.xml` 判定并输出 `#` ~ `######`、多级列表编号读 `numbering.xml`
按 `lvlText` 真实渲染（decimal / 字母 / 罗马 / 中文数字，每级 2 空格缩进）、
run 级粗斜体转 `**` / `*` 标记（单元格内同样应用）、
页眉页脚脚注分别以 `[页眉]` / `[页脚]` / `[脚注]` 落位、正文脚注引用内联 `[N]`；
工具数仍 27，见 §5.39）、
**PPTX 结构保真**（`p:graphicFrame` 里的 `a:tbl` → Markdown 管道表（首行表头 + 分隔行、缺列补空）；
合并单元格沿用 DOCX 口径（`gridSpan` 首格放内容其余补空、`rowSpan` / `hMerge` / `vMerge` 续格留空）；
演讲者备注按 slide 的 rels 找 `notesSlide` 取 body 占位符、落在页内末尾 `[备注] …`；
图片 alt 取 `p:nvPicPr` 的 `cNvPr@descr` → `[图片: …]`（无 descr 不出噪音行）；
`p:ph@type` 为 `sldNum` / `dt` / `hdrFtr` / `ftr` 的占位形状整页跳过，页码域文字不混进正文；
工具数仍 27，见 §5.40）。

**真机实测（2026-11-02）**：四个 scope 各走一遍全部符合预期（once 每次都问 / session 重启即失效 /
persistent 重启仍放行 / persistent-scroll 只放行滚动、点按仍问）；事件回放 12/12 断言通过，
磁盘 `events-*.jsonl` 逐行合法 JSON；登录态 cookie 跨**正常退出**重启后仍在；
事件汇总 **22/22** 断言通过（工具数 18、聚合三维度、按 packageId / kind 过滤、桥 op 同形、
界面面板渲染、单文件超 8MB 滚动出 `.1` 分片），超期日志文件启动时被 `sweepDisk()` 清掉；
第十二阶段导出与护栏可视化 **46/46** 断言通过；
第十三阶段压缩归档 / 趋势 / 护栏粒度 **69/69** 断言通过，SSE 推送通道 **14/14** 断言通过
（含 `source=push` 取件与「无新事件立即返回空数组」）；
第十四阶段 seq / 导出物 / 趋势图 **44/44** 断言通过
（跨重启续号、回放非递减排序、导出物只删自己造的那一个、界面两段式删除、趋势图 DOM）；
第十五阶段店铺登录态 profile **45/45** 断言通过
（工具面 26、默认 partition 名未变、A 店登录态默认店读不到 / 切回还在、跨 Electron 重启仍在、
内置默认不可移除、界面下拉 / 新建 / 两段式移除 / 移除后磁盘登录数据仍在）；
**第十六阶段（真实站点写操作闭环 + 写操作事件落盘）23/23 断言通过**
（淘宝登录态跨 Electron 重启仍在 → `ecclaw_scroll` 被护栏拦下 → 界面卡片 → 选「本次会话内信任本站」→
点「允许」→ 票据 executed + 页面真滚 scrollY 0→400 → 第二次 scroll 免确认直放行 →
session 档进会话组且持久白名单仍空 → 磁盘落 3 条 approval 事件
（requested / executed via=user scope=session / executed via=site-trust）→
`ecclaw_events_since` 带 kind=approval 取得到、汇总 byKind.approval=3、导出物含 `"kind":"approval"` →
界面渲染为「已请求确认 / 已执行 · 用户放行 · 本次会话」可读摘要）；
回归：第十五阶段 **44/44**、第十四阶段 **44/44**、第十三阶段 **69/69**、SSE 推送 **14/14** 全绿；
**第十七阶段（事件流 kind 筛选 + 导出物按 kind 拆分）31/31 断言通过**
（四个事件工具的 `kinds` 多选过滤 —— 多选优先于单选、脏 kind 丢弃不报错、回放/汇总/导出三条路语义一致；
导出 `splitByKind` 拆成多份且每份只含自己那类、文件名带 kind 前缀、同秒两次导出得到两个文件**不覆盖**；
界面三处 kind 多选 + 拆分开关生效，勾选后事件流从 60 条收到 1 条）；
回归：第十六阶段 **23/23**、第十五阶段 **45/45**、第十四阶段 **44/44**、第十三阶段 **69/69**、SSE 推送 **14/14** 全绿；
**第十八阶段（写操作三终态真实站点复验）49/49 断言通过**
（淘宝真站逐 stage：拒绝 → `{stage:rejected}` 且 winY 不变、不留规则；批准后执行器抛错 →
`{stage:failed, via:user, scope:once}`；deny 策略分支 → `{stage:failed}` 无 approvalId 无 via 且堆栈无卡；
10 分钟无人答复 → `{stage:timeout}` 真定时器误差 <1s、fail-closed、超时后再 scroll 仍被拦；
Z 组口径：`requested=4·rejected=2·failed=2·timeout=1·executed=0`、summary=replay=9、导出含三终态）。
回归：第十七阶段 **31/31**、第十六阶段 **26/26**（断言数由 23 增至 26：开局清场 A6/A7 + 收尾清场 Z1）、
第十五阶段 **45/45**、第十四阶段 **44/44**、第十三阶段 **69/69**、SSE 推送 **14/14** 全绿
（2026-11-03 晚复跑 `run50-*`；期间修掉两处 e2e 脚本缺陷 —— `phase3r` G3 的 `.slice(0,20)` 恒假断言、
`phase3q` 按「第一张卡」点中上一套件遗留卡的跨套件污染，均非产品 bug）。

**第二十一阶段（文档预览 · 先 PDF）29/29 断言通过**
（工具数 27、`ecclaw_document_preview` 无必填参数；不传 path/name → 文件库文档清单（PDF 标 `kind:'pdf'`、txt 标 `other`）；
按 name/path 预览报价单 → 1 页 + 抽出「供应商报价单…款号 颜色 尺码 单价 数量 A102 米白…」；
**NFKC 归一化生效（是「颜色」不是「颜⾊」）**；`maxChars=10` → `truncated=true`；
假 PDF → 「PDF 解析失败：Invalid PDF structure.」；txt → 「暂只支持 PDF 预览」；
越界路径 → 「路径越界：只允许访问文件库内的文件」；不存在 → 「文件库里没有这个文件」；
界面：文件库列出 PDF、显示「PDF 预览」标签、预览面板显示「PDF · 1 页 · 138481 B」与第 1 页文本、损坏 PDF 显示错误原因）。
回归：第二十一阶段 **29/29**、第二十阶段 **24/24**、第十九阶段 **16/16**、第十七阶段 **31/31**、
第十五阶段 **45/45**、第十四阶段 **44/44**、第十三阶段 **69/69**、SSE 推送 **14/14** 全绿
（2026-11-03 晚复跑 `run53-*`，摘要 `run53-summary.txt`；**真站套件 phase3s / phase3q 本轮未跑** —— 红线不碰淘宝）。
另定性：第十四阶段（phase3o）曾报两条红 = **测试脚本 bug 而非产品 bug**
（`ecclaw_event_replay` 的 `limit` 截断的是 **seq 最小的前 N 条**，旧脚本拿「第 500 小」当新事件 seq；
落盘实测 900013→900568 连续无空洞 → 产品侧 seq 续号正常），**只改脚本、未改产品代码**，复验 44/44。

**未实现（下一轮候选）**：真实站点的 **click 类**写操作闭环（真机只用 `ecclaw_scroll` 验过 ——
淘宝点一下可能下单，click 的真实站点复验需另找不会产生下单的页面）；
亚马逊仍被 AWS WAF 反爬挑战页拦下（只读开页 + 读 DOM 都没过）。

**未实现（第二阶段候选）**：邮件 worker、画布宿主、PDF **位图**预览 / Docx/Pptx/PSD 预览、OCR、
团队/账号/计费、遥测、数据迁移框架、社媒自动化脚本执行器。
逆向报告中这些均为 dabi 的第二层外壳能力，与内核无关。

> 本项目刻意不做账号 / 计费 / 遥测 —— 那是 dabi 私有商业系统的部分。
