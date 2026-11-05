# dabi 3.0.18 逆向分析：相对开源 OpenClaw 的二次开发

> 分析日期：2026-11-01
> 目标：`F:/soft/10ecommercial/dabi-desktop-Setup-3.0.18-x64.exe`（安装于 `D:/Program Files/dabi`）
> 上游对照：`openclaw/openclaw`（TypeScript，npm `openclaw@2026.10.9`）
> 工具：REA（morluto/rea-agents 6.8.0）、Ghidra 12.1.4、asar 直读、字符串取证

---

## 1. 结论速览

**dabi 不是"给 openclaw 换了个皮"，而是"用 openclaw 当内核 + 自研一套电商桌面外壳 + 一整套电商站点技能包体系"。**

三层结构：

| 层 | 实现 | 证据 |
|---|---|---|
| 内核 | **上游 OpenClaw 原版**（Rust `app-worker` crate + TS gateway），几乎未改 | `dabiai-agentworkerd.exe` 内含 `crates/app-worker/src/worker/service.rs` 路径与 `OpenClaw conversation seed rejected…` 字符串；全量关键词扫描无任何电商中文业务词 |
| 外壳 | **dabi 自研 Electron 桌面端**（Vite renderer + 4.6MB 打包的 `main.js`），326 个 IPC handler | `app.asar` → `dist-electron/electron/main.js`（4,658,136 B） |
| 业务 | **平台技能包（platform-packages）17 个 + 内置业务包 + 自动化脚本 + MCP + DuckDB** | `AppData/Roaming/com.dabiai.desktop/platform-packages/` 等 |

关键结论：**模型/大模型接入能力来自上游 openclaw**（`openclaw.json` 配置 + openclaw 自己的 model-catalog / provider-runtime），dabi 只是把它包了一层 UI + 账号体系；**这正是 ecclaw 应当补齐/增强的地方**。

---

## 2. 取证方法与证据链

### 2.1 REA

- `rea analyze-javascript-application` 对 `app.asar` 全量分析：44MB / 828 个文件，超出单次分析预算（长时间无产出，已终止）。
- 改为抽出 `dist-electron/electron/main.js` 单文件做 REA 静态重建（`evidence-main.json`），拿模块图与路由证据。
- REA 侧确认 `app.asar` 是标准 Electron 包（`dist-electron` + `dist/renderer` 双树）。

### 2.2 直接静态取证（asar / PE）

- asar 头部解析：headerSize=221908，内容基址 = `16 + headerSize`（注意：不是常见的 `8+headerSize`，直接按 `8+` 读会全部读成垃圾，导致"关键词 0 命中"的假阴性）。
- `dabiai-agentworkerd.exe`（110,639,816 B）→ 提取 589,609 条可打印字符串（`worker.strings.txt`，9.3MB）。

### 2.3 运行时产物取证（最有价值）

`D:/Program Files/dabi/resources` 与 `C:/Users/Duanyi/AppData/Roaming/com.dabiai.desktop` 暴露了 dabi 的完整模块清单与包协议，这部分是"功能等价的真正蓝图"。

---

## 3. 架构详解

### 3.1 内核：上游 OpenClaw（几乎原封不动）

`resources/dabiai-agentworkerd.exe` = OpenClaw 的 Rust `app-worker` crate 编译产物。

- 字符串证据：`crates/app-worker/src/worker/service.rs:3723`、`OpenClaw conversation seed rejected becaus…`
- 上游 `openclaw/openclaw` 仓库根目录同样存在 `crates/` 目录 → **该 Rust 内核本身属于上游，不是 dabi 自研**。
- 该二进制内含 `anthropic` / `openai` / `deepseek` / `qwen` / `minimax` / `moonshot` / `duckdb` / `mcp` / `gateway` 等标记。
- **全量关键词扫描无任何电商业务词**（淘宝/千牛/直通车/生意参谋/小红书/抖店… 全部 MISS）→ 电商能力不在内核里，而在下面的包与外壳里。
- 上游 `openclaw` 自身即具备：`src/gateway`、`src/cli`、`src/channels`、`src/skills`、`src/plugins`、`src/mcp`、`src/memory`、`src/canvas`、`src/browser` 相关能力、`src/model-catalog`、`src/provider-runtime`、`src/llm`、`src/web-search`、`src/mcp` 等。

**判断**：dabi 直接以 OpenClaw 内核为底座，未改其 agent/gateway 逻辑。

### 3.2 外壳：dabi 自研 Electron 桌面端

结构（`app.asar`）：

```
app.asar (44MB)
├── dist-electron/electron/
│   ├── main.js                       4.66 MB  ← 主进程（全部业务编排）
│   ├── preload.js                    58 KB
│   ├── browser/…                     内嵌浏览器（账号/书签/历史/密码/下载/导入/媒体/侧边栏）
│   ├── canvas/host/main-runtime.js   673 KB  ← 画布宿主
│   ├── mail/worker.js                3.42 MB  ← 邮件 worker
│   ├── sidepanel-platform-runtime/    exceljs / spreadsheet / tesseract(OCR) / rolling-video
│   ├── taobao-launch/runtime/entry.js 13.7 KB ← 淘宝上架业务包入口
│   ├── telemetry/sentry-runtime.js   887 KB
│   ├── thumbnail-utility.js / pinyin-runtime.js / prompt-snippets-store.js …
└── dist/renderer/assets/             Vite 打包的前端（PDF/Docx/Pptx/Xls/PSD 预览、图表、Mermaid、聊天流式桥）
```

**IPC 能力面（`ipcMain.handle` 共 326 个）**——这是 dabi 相对上游 openclaw 的外壳增量清单：

| 分组 | 数量 | 含义 |
|---|---|---|
| files | 44 | 文件库 / 工作区文件操作 |
| browser | 39 | 内嵌浏览器（多开、标签页、账号、密码、下载、导入） |
| team | 30 | 团队 / 成员体系 |
| system | 24 | 系统路径、剪贴板、外部打开 |
| account | 21 | **账号体系**（手机号注册/登录、短信、密码、登出、重置本地数据） |
| conversation-share | 12 | 会话分享（prepare/publish/revoke/list） |
| migration | 11 | 数据迁移（含 `dabi-api-key-migration-v1.json`） |
| mail | 10 | 邮箱接入 |
| catalog | 10 | 技能目录（catalog） |
| window / updates / media / skills / worker-skills / skill-share / systemFiles / prompt-snippets / client-web / settings-client-web / preferences / telemetry / resource-preview / remote-capabilities / desktop-notifications / shop-login / path-access / elicit / report / billing / bootstrap / dialog / filePreview / gateway | 2–12 each | 其余模块 |

其中 **`gateway:*`（status/start/stop/restart）** 表明外壳把 openclaw gateway 当受管子进程拉起。

### 3.3 dabi 与 OpenClaw 的接缝

`main.js` 中的路径函数直接暴露了接缝设计：

```
openclawConfigDir()      → <userData>/openclaw
openclawStateDir()       → <userData>/openclaw/.openclaw
openclawConfigFile()     → <userData>/openclaw/.openclaw/openclaw.json   ← 用上游自己的配置格式
openclawExecApprovalsFile() → …/.openclaw/exec-approvals.json
managedSkillsDir() / userSkillsDir() / catalogSkillStagingDir() / bundledSkillsBlackhole()
platformSkillCatalogCacheDir()
browserHistory.sqlite / browserPasswords.sqlite / browserDownloads.sqlite / browser-tabs-v2.json
mail/config.json
taobaoLaunchRuntimeEntry() → resources/taobao-launch/runtime/entry.js
```

即：**dabi 不改 openclaw 的配置语义**，而是把 openclaw 的 `.openclaw` 目录当作自己的状态根，技能目录分层（bundled / managed / user / catalog-staging）。

### 3.4 电商业务层：平台技能包体系（dabi 最大的自研资产）

安装态清单（`AppData/Roaming/com.dabiai.desktop/platform-packages/`）：

| packageId | 显示名 | 版本 | 站点匹配 |
|---|---|---|---|
| taobao | 淘宝/天猫 | 1.0.67 | taobao.com / tmall |
| 1688 | 1688 | 0.2.5 | 1688.com |
| sycm | 生意参谋 | 1.0.85 | — |
| qianniu | 千牛 | 0.0.9 | — |
| wxt | 万相台 | 0.0.15 | — |
| dmp | DMP | 0.0.18 | — |
| doudian | 抖店 | 0.0.13 | — |
| doudian-compass | 抖店罗盘 | 0.0.19 | — |
| douyin | 抖音 | 0.1.18 | — |
| xhs | 小红书 | 0.0.10 | — |
| pddmms | 拼多多 | 0.0.5 | — |
| jd | 京东 | 0.0.14 | — |
| txsale | 淘宝客 | 0.0.3 | — |
| amazon | Amazon | 0.0.4 | amazon.com |
| bi | BI 系统 | 1.0.91 | ecbis.cn / ecbis.com |
| crm | 边界 CRM | 0.0.3 | ltly.abujlb.com |
| databank | 天猫数据银行 | 0.0.3 | databank.tmall.com |

**包协议（每包 `manifest.json` + `runtime.cjs` + `node_modules`）：**

```json
{
  "schemaVersion": 1,
  "packageId": "taobao",
  "displayName": "淘宝/天猫",
  "version": "1.0.67",
  "platform": "taobao-family",
  "sites": ["taobao", "tmall"],
  "pages": [
    { "id": "builtin:taobao-detail", "path": "detail", "type": "product",
      "docs": "docs/tx/taobao/product-detail.md" },
    { "id": "builtin:taobao-search", "path": "search", "type": "search",
      "docs": "docs/tx/taobao/search-results.md" },
    { "id": "builtin:taobao-shop",   "path": "shop",   "type": "shop",
      "docs": "docs/tx/taobao/shop.md" }
  ],
  "minClientVersion": "3.0.15",
  "runtime": "runtime.cjs"
}
```

要点：
- **站点匹配驱动**（`match` / `matchPriority`，如 `databank.tmall.com` 优先级 30 高于通配）→ 打开某站点时自动挂载对应工具。
- **页面描述 + 站点知识文档**（`docs/tx/taobao/*.md`）→ 把"怎么操作这个后台"作为知识注入 agent，而不是硬编码。
- 包来自 OSS 仓库 `xishui-oc.oss-cn-shanghai.aliyuncs.com/prod/skillManage/platform-packages/<id>/<channel>/<uuid>/<id>-<ver>.xspkg`（南京西水网络科技）。
- `runtime.cjs` 里带 `node_modules` 依赖 → 每个包自带运行时依赖（sharp / node:sqlite / fetch 等）。

### 3.5 内置业务包：淘宝商品上架（tool-contract 模式）

`resources/taobao-launch-package/1.0.0-<hash>/`：

```
manifest.json      packageId=taobao-launch-business, hostApiVersion=2,
                   requiredRuntimeFeatures=[node:sqlite, sharp, fetch, FormData, Blob]
runtime.cjs        业务运行时
sku-source-parser-worker.js   SKU 源解析 worker（子线程）
tool-contract.json 工具契约（宿主 API v2）
```

`tool-contract.json` 暴露的**工具契约式设计**（dabi 特有、值得复刻）：

```json
{ "name": "taobao_launch_list_targets", "label": "列出可用店铺",
  "description": "【商品上架店铺查询】…只返回公开店铺摘要，不返回 targetRef、Cookie、Profile 或 partition；
                  选择本次任务店铺仍必须调用 resolve_target。" }
```

即：**工具以 JSON Schema 契约注册，参数/描述面向模型优化，敏感凭证（Cookie/targetRef/partition）有显式边界声明**。

### 3.6 社媒自动化脚本

`resources/automation-scripts/*.json`：`douyin` / `kuaishou` / `xiaohongshu`(+`xiaohongshu-search` / `-author-notes` / `-video`) / `web-article` / `douyin-image`。

```json
{ "id": "xiaohongshu", "platform": "xiaohongshu",
  "name": "小红书 · 发布图文笔记",
  "taskName": "xiaohongshu_publish_note",
  "dedupeWindowMs": 300000,
  "startUrl": "https://creator.xiaohongshu.com/new/home",
  "humanize": { "mouseSpeed": "normal", "typingSpeed": "normal",
                "mistakeRate": 0.03, "extraPauseRate": 0.1 },
  "variables": [ { "key": "title", "label": "笔记标题（生成时含标点不超过 20 个 UTF-16 字符…）", ... } ] }
```

含 **humanize**（打字速度/误码率/额外停顿）与 **dedupeWindow**（幂等窗口）→ dabi 把"像人一样操作浏览器"的参数做成了产品化配置。

### 3.7 其他 dabi 自研外围模块

| 模块 | 位置 | 作用 |
|---|---|---|
| dbqs-mcp | `resources/dbqs-mcp/gateway.cjs` | MCP server（自研打包），数据库查询能力 |
| duckdb | `resources/duckdb/excel.duckdb_extension` | Excel 扩展，列式分析 |
| psd-preview | `resources/psd-preview/psd-preview.exe` | Photoshop PSD 渲染预览 |
| browser-extensions | `resources/browser-extensions/{dabi-helper,frame-bridge}` | 注入网页的浏览器扩展（dabi-helper / frame-bridge） |
| browser-config | `resources/browser-config/default.json` | 浏览器默认配置 |
| ffmpeg / python-runtime / uv / npm | `resources/` | 内置媒体与脚本运行时（沙箱内跑 Python/Node） |
| tray / elevate | `resources/tray/*`, `elevate.exe` | 托盘 + 提权 |
| telemetry | `dist-electron/electron/telemetry/sentry-runtime.js` | Sentry 遥测 |
| 账号/计费 | IPC `account:*` / `billing:*` / `team:*` / `remote-capabilities:*` | 登录、套餐、团队、远程能力开关 |

---

## 4. "在 OpenClaw 基础上增加了哪些模块"（不含自定义技能）

按"上游 openclaw 没有 / dabi 自研"归类：

1. **桌面外壳与窗口体系**：Electron 主/渲染/preload、窗口管理、托盘、全屏栏、更新器（`updates:*`、`window:*`）。
2. **内嵌浏览器**：39 个 browser IPC —— 多开、竖向标签、分组面板、书签、密码库、历史库、下载、私密浏览桥、验证码/证书警告页、跨设备同步。这是 dabi 最大的 UX 资产，上游 openclaw 无内嵌浏览器壳。
3. **社媒/电商自动化脚本引擎**：`automation-scripts/*.json` + humanize + 去重窗口 + 变量表单。
4. **平台技能包（Platform Package）体系**：站点匹配（match/matchPriority）、页面描述（pages）、站点知识文档（docs）、包版本渠道（stable/beta）、OSS 分发、灰度与回滚。
5. **业务包与工具契约**：`tool-contract.json`（hostApiVersion=2）+ 声明式工具 + 敏感字段边界规则。
6. **SKU 解析 worker**：独立子线程做 SKU 源解析（`sku-source-parser-worker.js`）。
7. **账号 / 登录 / 计费 / 团队**：`account:*`(21)、`billing:*`、`team:*`(30)、`remote-capabilities:*`。
8. **会话分享**：`conversation-share:*`(12)，含发布/撤销/任务状态。
9. **技能目录与分享**：`catalog:*`(10)、`skill-share:*`(14)、`share-import:*`、`worker-skills:*`、`skills:*`。
10. **多形态文件预览**：PDF/Docx/Pptx/Xls/PSD 预览 + 画布宿主 + 缩略图 + 附件编排（`media:*`、`filePreview:*`、`resource-preview:*`）。
11. **OCR 与表格运行时**：tesseract、exceljs、spreadsheet runtime（侧边栏内直接处理）。
12. **邮件**：独立 mail worker + `mail/config.json`。
13. **数据侧**：DuckDB + Excel 扩展 + 自研 dbqs MCP。
14. **遥测与崩溃**：Sentry runtime。
15. **数据迁移框架**：`migration:*`(11) + `dabi-api-key-migration-v1.json`（含 API Key 迁移）。
16. **平台登录态**：每个电商平台的店铺登录态（`browser-merchant-profiles.json` 的 profile/partition 机制 + `shop-login:*`）。

---

## 5. 自定义大模型接入：现状与 ecclaw 的机会点

**现状（dabi）**
- 模型与 Provider 配置**不在 dabi 壳里**，落在 openclaw 的 `openclaw.json`（`openclawConfigFile()`）→ 能力上限取决于 openclaw。
- 前端 UI 里出现 `openai` / `anthropic` / `deepseek` / `moonshot` / `modelId`（`dist/renderer/assets/index-BX-lVTVH.js`），但**没有** `baseURL` / `apiBase` / `apiKey` / `openai-compatible` 等自建端点关键字 → dabi 的模型接入是**预置 provider 白名单式**，不支持用户自填 OpenAI 兼容网关/自建代理/本地推理。
- API Key 由 `dabi-api-key-migration-v1.json` + `account:modelGatewayToken` 管理 → Key 绑定 dabi 账号体系，不能自由填任意 baseURL。

**ecclaw 的增量（本次要做的"增加功能"）**
1. 自定义 Provider：任意 `baseURL + apiKey + modelId`（OpenAI 兼容 / Anthropic 兼容 / 自建），落 `openclaw.json` 的 `models.providers`，UI 可增删改、可测试连通性。
2. 本地推理：Ollama / LM Studio / vLLM 一键接入。
3. 多 Key 池 + 失败切换、并发限流、用量统计。
4. 保留 dabi 的电商平台包体系 + 自动化脚本 + 工具契约三件套（这是"同样功能"的主体）。

---

## 6. 逆向复现建议（ecclaw）

- **不重写内核**：直接依赖 npm `openclaw`（上游开源），把 dabi 的价值点重新实现为"壳 + 包体系"。
- **三件套复用**：
  1. `platform-packages` 包协议（manifest + pages + docs + runtime.cjs）—— dabi 私有 OSS，可自建同构包仓库；
  2. `tool-contract.json` 声明式工具契约；
  3. `automation-scripts` JSON 流程（humanize / dedupe / variables）。
- **壳层最小可用集**：Electron + openclaw gateway 子进程管理 + 聊天 UI + 设置（含自定义大模型）+ 浏览器（可选第二阶段）。
- **不做**：dabi 的账号/计费/团队/遥测（私有商业系统）。

---

## 7. 未解 / 后续取证建议

| 事项 | 状态 | 建议方法 |
|---|---|---|
| `platform-packages` 各包 runtime.cjs 的具体工具清单 | 未展开（包为私有 OSS 产物，本地只装到 `runtime.cjs`+`node_modules`，工具名未在 manifest 中） | 用 REA 对 `runtime.cjs` 做 `analyze_javascript_application`，读工具注册点 |
| dabi 前端 200+ renderer chunk 的完整 UI 结构 | 未展开 | REA 对 `dist/renderer` 做视图分页 |
| `openclaw.json` 实际写入的字段 | 未取证（用户未登录，尚未生成） | 登录后从 `openclaw/.openclaw/openclaw.json` 取样 |
| 内核 worker 与外壳的通信协议 | 部分（HTTP/WS + 子进程） | REA `capture-electron-scenario` 运行时抓取 |
| 平台包内 `docs/*.md` 站点知识文档 | 未展开 | 解包 `.xspkg` 后直接读 |

---

## 附：关键路径速查

```
安装根        D:/Program Files/dabi
Electron 包   D:/Program Files/dabi/resources/app.asar
主进程        app.asar → dist-electron/electron/main.js (4.66 MB)
前端          app.asar → dist/renderer/assets/*.js (Vite)
内核 worker   resources/dabiai-agentworkerd.exe (110 MB, Rust app-worker = OpenClaw)
内置业务包    resources/taobao-launch-package/1.0.0-<hash>/
平台包        resources/dbqs-mcp/gateway.cjs
社媒脚本      resources/automation-scripts/*.json
浏览器扩展    resources/browser-extensions/{dabi-helper,frame-bridge}
用户态数据    C:/Users/Duanyi/AppData/Roaming/com.dabiai.desktop
  ├── platform-packages/   (17 个平台技能包)
  ├── openclaw/.openclaw/  (openclaw 状态根: openclaw.json/skills/user-skills/browser-*.sqlite/mail)
  ├── browser-merchant-profiles.json (店铺登录态 profile/partition)
  ├── account.json / preferences.json / catalog-cache/
```
