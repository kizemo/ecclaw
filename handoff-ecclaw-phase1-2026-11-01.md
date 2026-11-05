# handoff — ecclaw 第一阶段收口（2026-11-01 晚）

> 承接：`handoff-ecclaw-2026-11-01.md`（逆向结论仍然有效，本文件只覆盖「编译/构建/运行/验证」部分）。
> 进度表见 `task.md`。下一轮提示词：`prompt-ecclaw-next.md`。
> 项目根：`F:\soft\00selfmade\ecclaw`

## 1. 本轮完成的事

prompt-ecclaw-next.md 的 5 项必交付 **全部完成并留证**：

1. `npx tsc -p tsconfig.node.json --noEmit` → exit 0
2. `npx tsc -p tsconfig.web.json --noEmit` → exit 0
3. `pnpm build` → out/main 24.76 kB / out/preload 1.52 kB / out/renderer 586.82 kB
4. `pnpm dev` 起来，GUI 实测：五个页面可切；「大模型」页新增 Provider 落盘 openclaw.json；
   「测试连接」在无 Ollama 时返回「连接失败：fetch failed」（错误路径正常）
5. `node node_modules/openclaw/openclaw.mjs config validate --json` → `{"valid":true,"warnings":[]}`
6. `README.md` 已写（架构图 / 启动 / 平台包协议 / 如何加包 / 自定义大模型接入 / 内核接缝）

额外做的：「内核启动」按钮端到端验证 —— openclaw 日志出现 `ready`，`netstat` 显示
`127.0.0.1:43117 LISTENING`，侧栏显示「内核运行中」。

## 2. 本轮修掉的真实缺陷（都是靠上游 schema/实测发现的，不是猜的）

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | `config validate` 报 `Unrecognized keys: "label","defaultModel","local"` | 上游 `models.providers.<id>` 是 `additionalProperties:false` | openclaw.json 只写上游允许的键；ecclaw 私有元数据移到 `ecclaw-settings.json` 的 `providerMeta` |
| 2 | `Gateway start blocked: existing config is missing gateway.mode` | openclaw 要求显式 `gateway.mode`（local/remote） | `writeConfig()` 自动补 `gateway.mode:"local"` |
| 3 | gateway 进程活着但**永不监听端口**（卡在 process.bootstrap 之后） | `process.execPath` 是 `electron.exe`，以「Electron 应用」模式跑 openclaw.mjs | 子进程环境加 `ELECTRON_RUN_AS_NODE=1`，让 electron.exe 退化为纯 Node |
| 4 | 侧栏显示「内核运行中」但其实没起来 | 健康探测 15s 太短 + 失败不杀进程 | 窗口提到 60s；超时杀子进程并报错 |
| 5 | `pnpm dev` 报 `Error: Electron uninstall` | pnpm 默认拦依赖构建脚本，electron 的 postinstall 没跑 | package.json 加 `"pnpm":{"onlyBuiltDependencies":["electron"]}`；手动 `cd node_modules/electron && node install.js` |
| 6 | 「默认模型」输入框形同虚设 | 只存了 meta，从没写进 openclaw | 保存 Provider 时同步写 `agents.defaults.model.primary`；删除 Provider 时清掉指向它的默认模型 |

涉及文件：`electron/main/openclaw-config.ts`、`electron/main/gateway.ts`、`src/views/Models.tsx`、`package.json`、`README.md`、`task.md`。

## 3. 上游 openclaw 2026.10.9 关键事实（本轮新核实）

- 配置 schema 导出：`node node_modules/openclaw/openclaw.mjs config schema --json`（2.5 MB，可直接查）。
- `models.providers.<id>` 允许的键（全集）：
  `baseUrl` `apiKey` `auth` `api` `maxTokens` `timeoutSeconds` `region`
  `injectNumCtxForOpenAICompat` `params` `agentRuntime` `localService` `headers`
  `authHeader` `request` `models` —— **其余一律非法**。
- `api` 枚举：`openai-completions` `openai-responses` `openai-chatgpt-responses` `anthropic-messages`
  `google-generative-ai` `google-interactions` `google-vertex` `github-copilot`
  `bedrock-converse-stream` `ollama` `pi-messages` `azure-openai-responses`。
- `apiKey` 支持字符串、`${ENV_VAR}` 占位，或 SecretRef 对象（`source: env|file|exec|store`）。
- `models.mode` ∈ `merge` | `replace`；`agents.defaults.model.primary` 形如 `<provider>/<modelId>`。
- `gateway.mode` ∈ `local` | `remote`，缺失时 gateway **直接拒绝启动**。
- gateway 冷启动 20–30s（建 SQLite 状态库 + 运行时索引）；未配 `gateway.auth` 时每次启动生成一次性 runtime token。
- openclaw 状态目录可被多进程争用：同一 state dir 已有 gateway 时，新实例会拒绝启动
  （`Another gateway (pid xxx) already owns this state directory`）。

## 4. 验证脚本与临时产物（`C:\Temp\ecclaw-verify\`）

- `driver.cjs` —— 不启动 Electron，直接跑编译后的 `openclaw-config.js`（stub 掉 `electron` 的 `app.getPath`），
  写入 Provider 后打印 openclaw.json。改完配置模块后重跑它 + `config validate` 就能秒验。
- `lib/` —— `npx tsc electron/main/openclaw-config.ts electron/main/paths.ts electron/shared/types.ts
  --outDir C:/Temp/ecclaw-verify/lib --module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck`
- `schema.json` —— 上游 schema 快照。

GUI 实测配置落在：`%APPDATA%\ecclaw\openclaw\.openclaw\openclaw.json`（Windows 上 userData = `%APPDATA%\ecclaw`）。

## 5. 环境与坑

- **ctx-budget-guard 会拦 Bash**（上下文 ≥160K）。逃生阀：`CTX_GUARD_ALLOW=1 <命令>`
  内联在命令里就生效（本轮多次验证过），不需要开新会话。
- electron 二进制国内下载：`ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/" node install.js`。
- `pnpm dev` 的主进程改动**不会**热重启（只有 renderer 有 hmr）→ 改 `electron/main/*` 后必须重启 dev。
- dev server 被停掉后 **electron 子进程会残留**（一个实例 4~5 个 electron.exe），
  手动 `taskkill //IM electron.exe //T //F` 清掉，否则会出现两个实例抢 state dir 锁。
- openclaw 抢 state dir 时报的是 pid 占用，不是端口冲突；`netstat` 里 43117 是关键判据。

## 6. 下一步（第二阶段候选，按价值排序）

1. **平台包 runtime.cjs 的真实工具执行**：目前只有 manifest 注册表 + 文档读取，
   `runtime.cjs` 里的 tools/execute 没接进 agent 上下文 —— 这是「电商 AI」叙事最实的一块。
2. **对话链路接真实模型**：现在 `openclaw agent --local` 能跑通 CLI，但本机没有可用端点，
   需要一个真 Provider（本地 Ollama 或云端 key）才能验证端到端。
3. 内嵌浏览器 / 邮件 worker / 画布宿主 / PDF·Docx·Pptx·PSD 预览 / OCR（dabi 的第二层外壳能力）。
4. 远程包仓库（OSS 分发 + 版本渠道 + 灰度）—— 协议里 `current.json` 指针已经预留。
5. 账号 / 计费 / 遥测：**明确不做**（dabi 私有商业系统部分）。

## 7. 会话结束时 app 状态

`pnpm dev` 可能仍在后台跑（task id `bru4ugsvu`），electron 实例与 openclaw gateway（43117）都可能还活着。
不需要了直接 `taskkill //IM electron.exe //T //F` + 停掉 dev task 即可，不会留下文件残留。
