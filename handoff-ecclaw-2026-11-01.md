# handoff — ecclaw（基于 OpenClaw 的电商 AI 桌面端）2026-11-01

> 承接：无（项目首份实质交接）。占位文件 `handoff-2026-11-01.md` 为自动生成，可忽略。
> 会话结束时上下文触顶（ctx-budget-guard 81%，Bash 被拦），故在此收口。

## 1. 用户原始任务

1. 用 REA 逆向 `F:/soft/10ecommercial/dabi-desktop-Setup-3.0.18-x64.exe`（安装于 `D:/Program Files/dabi`），
   分析它在开源 openclaw 基础上做了哪些二次开发、除了自定义技能外增加了哪些模块。
2. 逆向生成同功能软件，命名 **ecclaw**，并**增加"可自定义大模型接入"**。

## 2. 已交付结论（详见 `docs/逆向分析-dabi-vs-openclaw.md`）

**架构三层：**

| 层 | 真相 | 证据 |
|---|---|---|
| 内核 | **上游 OpenClaw 原版**（Rust `app-worker` crate + TS gateway），基本未改 | `resources/dabiai-agentworkerd.exe` 含 `crates/app-worker/src/worker/service.rs`、`OpenClaw conversation seed rejected…`；全量关键词扫描无任何电商业务词（淘宝/千牛/抖店/小红书… 全 MISS） |
| 外壳 | **dabi 自研 Electron 桌面端**：`app.asar` → `dist-electron/electron/main.js`（4,658,136 B），`ipcMain.handle` 共 **326** 个 | IPC 分组：files 44 / browser 39 / team 30 / system 24 / account 21 / conversation-share 12 / window 12 / migration 11 / mail 10 / catalog 10 / skills 8 / client-web 8 / systemFiles 9 / prompt-snippets 5 / preferences 4 / updates 5 / gateway 4 / filePreview 4 / resource-preview 4 / telemetry 5 / remote-capabilities 3 / share-import 3 / desktop-notifications 3 / dialog 5 / media 8 / worker-skills 6 / skill-share 14 / shop-login 2 / path-access 2 / elicit 2 / report 2 / billing 1 / bootstrap 1 |
| 业务 | **17 个平台技能包 + 内置业务包 + 社媒自动化脚本 + MCP + DuckDB** | `AppData/Roaming/com.dabiai.desktop/platform-packages/`、索引 `index.json` |

**平台包清单（packageId / 显示名 / 版本）：** taobao 1.0.67、sycm 1.0.85、bi 1.0.91、dmp 0.0.18、wxt 0.0.15、
doudian-compass 0.0.19、doudian 0.0.13、douyin 0.1.18、xhs 0.0.10、pddmms 0.0.5、qianniu 0.0.9、
txsale 0.0.3、1688 0.2.5、jd 0.0.14、amazon 0.0.4、crm 0.0.3、databank 0.0.3。

**包协议（已实现为 ecclaw 同构协议）：** `manifest.json`（packageId/displayName/version/platform/sites/
match[]/matchPriority/pages[]/minClientVersion/runtime）+ `runtime.cjs`（导出 manifest/tools/execute）
+ `docs/**.md`（站点知识文档）+ 可选 `current.json` 版本指针。

**dabi 与 openclaw 的接缝：** `openclawConfigDir=<userData>/openclaw`，`openclawStateDir=<userData>/openclaw/.openclaw`，
`openclawConfigFile=<state>/openclaw.json`；skills 分层（bundled / managed / user / catalog-staging）。

**dabi 的模型接入是白名单式**：前端只有 openai/anthropic/deepseek/moonshot/modelId，
**没有 baseURL / apiBase / apiKey / openai-compatible** 关键字 → 这正是 ecclaw 的增量点。

## 3. 已完成的 ecclaw 实现（代码已写，**尚未 typecheck / build / 运行**）

项目根：`F:\soft\00selfmade\ecclaw`

```
package.json                 electron-vite + react19 + openclaw 依赖
electron.vite.config.ts      main / preload / renderer 三段构建
tsconfig.json / node / web
electron/shared/types.ts     IPC 契约（EcclawApi、ModelProvider、PlatformPackageManifest…）
electron/main/paths.ts       openclaw 状态根、skills、platform-packages、文件库路径
electron/main/openclaw-config.ts  ★ 自定义大模型：openclaw.json 读写 + Provider CRUD + 连通性测试
electron/main/gateway.ts     openclaw 进程管理（gateway/agent CLI 适配）
electron/main/platform-packages.ts  包注册表（两种目录布局 + 站点匹配 + 文档读取）
electron/main/library.ts     技能（managed/user）与文件库
electron/main/index.ts       窗口 + 全部 IPC handler
electron/preload/index.ts    contextBridge 白名单 API
src/{index.html,main.tsx,api.ts,App.tsx,styles.css}
src/views/Chat.tsx           对话
src/views/Models.tsx         ★ 大模型接入页（新增/编辑/测试/删除 Provider）
resources/platform-packages/{taobao,1688,douyin}/   示例包（manifest + runtime.cjs + docs）
docs/逆向分析-dabi-vs-openclaw.md                  完整逆向报告
```

### 已核实的上游 OpenClaw 事实（2026.10.9，npm `openclaw`）
- 配置 schema（来自 `node_modules/openclaw/docs/providers/baseten.md`）：
  ```json5
  { models: { mode: "merge", providers: { <id>: {
      baseUrl, apiKey, api: "openai-completions",
      models: [{ id, name, reasoning, input, contextWindow, maxTokens }] } } },
    agents: { defaults: { model: { primary: "<provider>/<modelId>" } } } }
  ```
  `apiKey` 支持 `"${ENV_VAR}"` 占位。
- CLI：`openclaw agent --local --json --message <text> --session-id <id>`（内嵌 agent 单轮，**不依赖 gateway 进程**）；
  `openclaw gateway --port N`（**WebSocket** 服务，非 HTTP，无 /health）；
  `openclaw config get|set|patch|unset|file|schema|validate`；`openclaw models`、`openclaw dashboard`、`openclaw browser`。
- 状态目录 env：`OPENCLAW_STATE_DIR` / `OPENCLAW_CONFIG_PATH`（`--profile` 文档所述）→ ecclaw 已按此设置。

## 4. 下一步必做（按序）

1. **验证编译**（上下文已恢复后第一件事）：
   `cd F:/soft/00selfmade/ecclaw && npx tsc -p tsconfig.node.json --noEmit && npx tsc -p tsconfig.web.json --noEmit`
   → 修类型错误（已知风险点：React 19 无全局 `JSX`，已加 `import type { JSX } from 'react'`；`noUnusedLocals` 对未用的 `setDefaultModel` 导出不报错）。
2. `pnpm build`（electron-vite 三段构建），产物 `out/main|out/preload|out/renderer`。
3. `pnpm dev` 冒烟：窗口能起、侧栏五页可切、「大模型」页能增删改 Provider 并写 `openclaw.json`。
4. **配置校验**：写完 Provider 后跑 `node node_modules/openclaw/openclaw.mjs config validate`，
   确认 `models.providers` 通过 schema（对应上游 CI 的 `docs:check-config-examples`）。
5. 真实对话链路验证：`openclaw agent --local --json --message "hi"` 走通后，再在 UI 里验证。
6. README.md（未写）：架构、启动方式、平台包协议、如何加包、自定义大模型接入说明。
7. 补 `electron/main/openclaw-config.ts` 的 `setDefaultModel` 到 IPC + UI（设默认模型）。

## 5. 环境与坑（务必先读）

- **REA MCP 在本会话不可见**：它被绑在 `E:/RE` 的 local scope（`.claude.json → projects["E:/RE"].mcpServers.rea`）。
  本项目 cwd 不在 E:/RE → 只能用全局 CLI `rea`（`C:/Users/Duanyi/AppData/Roaming/npm/rea`，6.8.0）。
- **REA 只接受目录或 .asar**，单文件会报 `unsupported_target`；`--source-path` 必须是 inventory 中的精确路径（不带前导 `/`）。
  44MB asar 全量分析曾跑 >25 分钟无产出 → 改为抽目录分析更划算。
- **asar 内容基址 = `16 + headerSize`**（不是常见的 `8 + headerSize`）。按 `8+` 读会全部读成垃圾，
  表现为"关键词 0 命中"的假阴性（我踩过：所有 provider 关键字都 MISS）。校验方法：读 `dist-electron/build-environment.json` 看是否 JSON 完整。
- **openclaw 安装很慢**（unpackedSize ≈ 250MB）；pnpm 需先 `npm i -g pnpm`（已装 12.16.1）。
- Node 26.13.0 满足 openclaw engines（`>=26.12.1`）。
- 用户全局约定：pnpm 优先、Python 用 uv、临时产物写 `C:\Temp`、不硬编码密钥、禁删用户文件。

## 6. REA 证据现状

- 后台任务 `bbdbh1wvc`（对 `C:/Temp/rea-dabi/app` 解包目录做整树分析）**在会话结束时可能仍在跑**，
  产物路径 `C:/Temp/rea-dabi/evidence-app.json`；`C:/Temp/rea-dabi/` 下还有：
  `main.js`（抽出）、`scan.txt`（IPC 全表）、`worker.strings.txt`（内核 589,609 条字符串）、`extract-asar.js`、`scan.js`。
- 报告第 7 节已列出"未解事项"（平台包 runtime.cjs 工具清单、renderer UI 结构、openclaw.json 实际字段、内核通信协议）。

## 7. 与 dabi 的差距（第二阶段候选，尚未实现）

内嵌浏览器（39 IPC）、邮件 worker、画布宿主、PDF/Docx/Pptx/PSD 预览、OCR（tesseract）、
团队/账号/计费、遥测（Sentry）、数据迁移框架、社媒自动化脚本执行器、店铺登录态 profile/partition、
远程包仓库（OSS 分发 + 版本渠道 + 灰度）。
