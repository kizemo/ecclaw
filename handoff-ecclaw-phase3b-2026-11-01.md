# handoff — ecclaw 第三阶段必做 2 收口（真 Provider 端到端对话 + setDefaultModel 入口）

> 权威背景仍看 `handoff-ecclaw-phase2-2026-11-01.md`（项目背景/协议/边界/避坑全在里面）；
> 必做 1 增量看 `handoff-ecclaw-phase3a-2026-11-01.md`。本文件只记必做 2 的增量与下一步。

## 1. 本次交付（已完成并验证）

**必做 2：接真 Provider 跑通端到端对话 + setDefaultModel 独立 IPC/UI 入口。**

| # | 交付项 | 证据 |
|---|---|---|
| 1 | 真 Provider `aliyun-maas`（anthropic-messages，baseUrl=阿里云 MaaS relay）写入 ecclaw 真实 openclaw.json；primary=`aliyun-maas/qwen3.8-max`；清掉遗留 `local-ollama` | ping → HTTP 200 "pong"（驱动内验证，密钥不落日志） |
| 2 | `openclaw agent --local` 一轮真实对话 | EXIT=0；`model-fetch provider=aliyun-maas api=anthropic-messages model=qwen3.8-max status=200 elapsedMs=2447`；stopReason=stop |
| 3 | 17 个托管技能落 ecclaw 真实 stateDir（`<userData>/openclaw/.openclaw/skills/`） | 17/17、capSum 643；模型答「共加载 38 个技能。淘宝相关：taobao；抖店相关：doudian、doudian-compass（另有 sycm、qianniu 等淘系配套）」→ **技能对模型可见** |
| 4 | setDefaultModel 独立入口：IPC `providers:set-default` + preload `providers.setDefaultModel()` + Models 页每模型「设为默认」按钮 | 两段 typecheck OK；`pnpm build` ✓；函数级验证：切 `qwen3.6-flash` → 还原 `qwen3.8-max`，primary 均正确落盘 |

## 2. 改动清单（工作区文件，无 git）

| 文件 | 改动 |
|---|---|
| `electron/shared/types.ts` | `EcclawApi.providers.setDefaultModel(providerId, modelId): Promise<ModelProvider[]>` |
| `electron/main/index.ts` | import `setDefaultModel`；注册 `ipcMain.handle('providers:set-default', …)`（写 primary 后返回 `listProviders()`） |
| `electron/preload/index.ts` | 暴露 `providers.setDefaultModel()` |
| `src/views/Models.tsx` | `setDefault()` 函数 + Provider 卡片内每模型「设为默认/默认：」按钮（当前 meta.defaultModel 时 disabled） |
| `task.md` | 补第三阶段必做 2 表格 + 5 条新实证发现 |
| `C:/Temp/ecclaw-verify/e2e-driver.cjs` | **新建** e2e 验证驱动（勿删）：require.cache 注入 stub userData=ecclaw（不改原 stub，原 stub 仍默认指向 dabi）；ping relay → saveProvider → 移除 local-ollama → syncPackageSkills 落真实 stateDir |

未改：openclaw-config.ts（`setDefaultModel` 函数第一阶段已存在，本次只是给它独立 IPC/UI 入口）。

## 3. 关键运行事实（下次直接复用）

- **relay**：`ANTHROPIC_BASE_URL=https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic`，
  凭据用 `ANTHROPIC_AUTH_TOKEN`（Bearer + x-api-key 双头都带即可）。
  **模型 id 白名单**：`qwen3.8-max` / `qwen3.6-flash` / `deepseek-v4-pro` / `auto`（其他名字报 `Model not exist`）。
  ⚠️ openclaw.json 里明文存了该 relay key —— 勿把此文件复制进仓库/文档/截图。
- **CLI 直跑内核**（不经 Electron）：
  ```bash
  cd F:/soft/00selfmade/ecclaw
  OPENCLAW_STATE_DIR="C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw" \
  OPENCLAW_CONFIG_PATH="C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/openclaw.json" \
  node node_modules/openclaw/openclaw.mjs agent --message "…" --session-id <id> --local
  ```
  首次运行有 stale-lease 告警（owner-pid-dead 自愈），无害。纯文本输出=最终回复；`--json` 给信封。
- **技能可见性**：openclaw 会把 `<stateDir>/skills/<id>/SKILL.md` 注入 agent（本次实测模型能点名
  taobao/doudian/doudian-compass/sycm/qianniu；共 38 技能 = 17 托管 + 内核自带）。
- **e2e 驱动重跑**：先按 phase3a §4 的 tsc 命令重编 lib2（本次已加 `openclaw-config.ts` 进编译清单），
  再 `cd C:/Temp/ecclaw-verify && node e2e-driver.cjs`（需 env 里有 ANTHROPIC_BASE_URL/AUTH_TOKEN）。

## 4. 下一步（第三阶段剩余）

- **GUI 抽查**（低优先）：`pnpm dev` → 大模型页看 aliyun-maas 卡片 + 点「设为默认」按钮验证 IPC 通路；
  对话页发一句话验证 chatViaCli（同一条 `agent --local` 链路，应已通）。
- **候选 3：内嵌浏览器宿主**（动作执行硬前提，成本最高；线索 = dabi 侧栏内置 tesseract OCR）。
- **候选 4：远程包仓库**（`current.json` 已预留；dabi `taobao-launch-packages` 线索见 phase2 handoff §9）。
- 可选打磨：setDefaultModel 成功后同步更新 `ecclaw-settings.json` 的 `providerMeta.<id>.defaultModel`
  （当前按钮 disabled 态只看 meta，切换内核默认后 meta 不更新，显示会滞后一次刷新）。

## 5. 红线与避坑（沿用，勿违）

- 不重做逆向（REA 已结案）；不改已定案的平台包协议；不删 `C:/Temp/rea-dabi`、`C:/Temp/ecclaw-verify`。
- 能力探测缓存按 `包id@版本`，改探测逻辑须重启进程；Electron 内 spawn 内核必带 `ELECTRON_RUN_AS_NODE=1`。
- 禁止删除用户文件（全局红线）；临时产物写 `C:/Temp/`。项目不是 git 仓库，不要 init/commit。
- 测试 relay 对话即烧当日 Token Plan 额度（与 cc-haha 同池），验收类对话保持最小 max_tokens。
