# handoff — ecclaw 第四阶段（GUI 抽查 + 缺陷修复 + 候选 4 远程包仓库）

> 权威背景沿用 `handoff-ecclaw-phase2-2026-11-01.md`（项目背景/平台包协议/能力边界/全部绝对路径）
> 与 `handoff-ecclaw-phase3a-2026-11-01.md`（必做 1 托管技能）、`handoff-ecclaw-phase3b-2026-11-01.md`（必做 2 真 Provider）。
> 本文件只记 2026-11-02 这一轮增量。

## 1. 本次交付（已完成并验证）

| # | 交付项 | 证据 |
|---|---|---|
| 1 | `setDefaultModel` 同步 `ecclaw-settings.json` 的 `providerMeta.<id>.defaultModel`（并清掉上一个 provider 的） | 函数级：切 qwen3.6-flash → primary+meta 同步 → 还原 qwen3.8-max；GUI：按钮态即时变「默认：qwen3.6-flash」，无需刷新 |
| 2 | **GUI 抽查**（真 Electron + CDP 驱动，非截图目测） | 「设为默认」按钮 → IPC 通；对话页发一句话 → 模型回 `Test passed`（provider=aliyun-maas / model=qwen3.8-max / stopReason=stop / durationMs≈11906） |
| 3 | **缺陷修复**：对话页把整个 JSON 信封显示给用户 | 旧 `extractReply` 只认 `reply/content/text/…`；真实信封是 `{payloads:[{text,mediaUrl}], meta:{…}}` → 重写（payloads 优先 + 递归取文本 + `meta.terminalReply` / `finalAssistantVisibleText` 兜底）；修复后页面只显示 `Test passed` |
| 4 | **候选 4：远程包仓库** | 新增 `electron/main/package-repository.ts`（清单 → 下载 → 安全解包 → 校验 → 落盘 + `current.json` 指针）；10/10 单测 + GUI 端到端通过 |

## 2. 改动清单（工作区文件，无 git）

| 文件 | 改动 |
|---|---|
| `electron/main/package-repository.ts` | **新建**：远端清单解析 / 归档下载（限 200 MB）/ 自研最小 zip 解析（stored + deflate、CRC32、zip slip 与符号链接防护、文件数与体积上限）/ manifest 校验 / 落盘 + `current.json` 指针 / `readRepoSettings`+`saveRepoBaseUrl` |
| `electron/main/openclaw-config.ts` | `setDefaultModel` 增加 `syncProviderMetaDefault`（同步 + 清旧） |
| `electron/main/gateway.ts` | `extractReply` 重写 + 新增 `collectText`（修对话页显示信封的缺陷） |
| `electron/main/paths.ts` | `localPackagesDir()` 支持 `ECCLAW_LOCAL_PACKAGES_DIR` 覆盖 |
| `electron/main/index.ts` | 新增 IPC `packages:repo-index` / `packages:repo-install` |
| `electron/preload/index.ts` | 暴露 `packages.repoIndex` / `packages.repoInstall` |
| `electron/shared/types.ts` | 新增 `RemotePackageEntry` / `RemoteRepoIndex` / `RemotePackageInstallResult` + `EcclawApi.packages` 两个方法 |
| `src/api.ts` | 导出上述类型 |
| `src/App.tsx` | 平台包页新增「远程包仓库」面板（地址输入 + 拉取清单 + 安装 + 仓库地址存 settings） |
| `README.md` | 新增 §5.7「远程包仓库」（仓库侧 index.json 形态 + 客户端流程 + 安全约束） |
| `task.md` | 新增「第四阶段（2026-11-02）」表 + 5 条实证发现；更新「尚未做」里远程包仓库的状态 |
| `C:/Temp/ecclaw-verify/`（勿删） | 新增 `meta-driver.cjs` / `gui-driver.cjs` / `gui-repo.cjs` / `repo-driver.cjs` / `repo-server.cjs` |

## 3. 关键运行事实（下次直接复用）

### 3.1 GUI 自动化：CDP 驱动真 Electron（computer-use 不可用）

computer-use MCP 在本机**截屏全黑且拒绝输入**（Electron dev 应用不在它的 app 白名单，
`open_application('ecclaw')` → not found；`key` → "Refusing input until a supported application
is brought to the front"）。替代方案（已验证）：

```bash
cd F:/soft/00selfmade/ecclaw && pnpm build
npx electron . --remote-debugging-port=9222            # 后台启动
cd C:/Temp/ecclaw-verify && node gui-driver.cjs        # CDP 驱动真实渲染进程
```

- 驱动方式：Node 26 自带 `WebSocket` → `http://127.0.0.1:9222/json/list` 取 page target
  → `Runtime.evaluate`（`awaitPromise`）真实点按钮 / 填输入框。
- 填 React 受控输入要用原生 setter：
  `Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(inp, v)`
  + `dispatchEvent(new Event('input',{bubbles:true}))`。
- 验证期隔离本地包目录：`ECCLAW_LOCAL_PACKAGES_DIR=C:/Temp/...`（不改真实 userData）。

### 3.2 openclaw `agent --json` 真实信封（2026-11-02 实测）

```jsonc
{ "payloads": [{ "text": "Test passed", "mediaUrl": null }],
  "meta": { "terminalReply": { "disposition": "visible", "text": "Test passed" },
            "finalAssistantVisibleText": "Test passed", "stopReason": "stop", ... } }
```

### 3.3 远程仓库协议（ecclaw 侧定案）

- 仓库根目录提供 `index.json`，`packages[]` 条目含 `packageId/version/channel/match/packageUrl`，
  可选 `sha256`（整包）与 `manifestSha256`（manifest.json）。
- 安装落盘：`<userData>/platform-packages/<packageId>/<channel>-<version>-<hash8>/`，
  并写 `current.json` = `{version, channel, dir}`（与包扫描器既有约定一致，`platform-packages.ts` 直接认）。
- **不删旧版本目录**（全局红线）。
- 零第三方依赖：zip 解析是自研最小实现（避免本机 pnpm 装包慢）。

### 3.4 relay 对话仍然很贵

一次「只回复四个字」的验收对话：`input 6 / output 175 / cacheWrite 16850 / total 17031` tokens。
验收对话务必最小化。

## 4. 下一步（候选 3：内嵌浏览器宿主）

这是当前**唯一的大价值缺口**：643 项能力只能被模型「知道」，不能被「执行」。
已知事实（来自 phase2 handoff 与 docs/逆向分析补充 §9.4，**不要重做逆向**）：

- dabi 的动作执行链：`sidePanelStrategyManager.actionHandler(context, capability, strategyId)`
  → `page.actions[capability]`；`context` 携带 `webContents` / `tabId`。
- dabi 包内 `runtime.cjs`（908 KB）是带 DOM 选择器的浏览器操作运行时，不是声明式工具清单。
- dabi 侧栏内置 OCR（tesseract-runtime + tesseract-worker）→ 说明宿主能跑 worker。

建议的起步路径（本项目证据路线：不跑 REA，直接读真实 runtime.cjs）：

1. **摸清宿主契约**：直接 Grep 本机真实 dabi 包里的 `runtime.cjs`
   （`C:/Users/Duanyi/AppData/Roaming/com.dabiai.desktop/platform-packages/<pkg>/<ver>/runtime.cjs`），
   统计它对 `context` 的实际依赖面（用了哪些字段：`webContents`/`tabId`/`url`/`executeJavaScript`/…）。
   这是纯文本检索，成本低。
2. **定义 ecclaw 最小宿主**：Electron `BrowserWindow`/`WebContentsView` + 一个把
   `webContents`/`tabId` 适配成 dabi 形状的 `context` 层。
3. **先跑通一条只读动作**（打开某页面 → 读 DOM → 返回结果），
   再考虑批量接 576 项动作；不要一上来就追求全量。
4. 边界提醒：动作执行会涉及真实站点登录态，ecclaw 目前**没有**店铺登录态 profile
   （明确列为「刻意不做」），起步阶段建议只在本地/无账号站点验证。

其余剩余项：远程仓库的灰度/回滚策略；托管技能的文档正文（dabi 包内无 .md，
当前 SKILL.md 只能用 manifest 元数据 + 能力 id 构成）。

## 5. 红线与避坑（沿用，勿违）

- 不重做逆向（REA 已结案）；不改已定案的平台包协议；不删 `C:/Temp/rea-dabi`、`C:/Temp/ecclaw-verify`。
- 禁止删除用户文件（含「版本目录清理」这类看似合理的清理，一律不自动执行）。
- 临时产物写 `C:/Temp/`；项目不是 git 仓库，不要 `git init` / commit。
- 能力探测缓存按 `包id@版本`，改探测逻辑须重启进程；Electron 内 spawn 内核必带 `ELECTRON_RUN_AS_NODE=1`。
- openclaw.json 含明文 relay key，勿复制进仓库/文档/截图。
- 停 dev 后 `taskkill //IM electron.exe //T //F` 清残留，否则两个实例抢 openclaw state dir 锁。

## 6. 环境状态（交接时）

- 本会话已 `taskkill` 清掉全部 electron.exe；本地仓库服务（8899 端口）已停。
- `ecclaw-settings.json` 里的测试用 `packageRepo` 键已清除（不留 127.0.0.1:8899 残值）。
- 用户真实状态未被本轮污染：本地包安装全部落在 `C:/Temp/ecclaw-verify/repo-*`。
- 两段 typecheck（NODE_OK / WEB_OK）与 `pnpm build` 均通过。
