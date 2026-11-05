# handoff · ecclaw 第二十阶段（phase3u）· 开工前选型 · 2026-11-03

> ⚠️ **本文不是收官 handoff，不含任何代码改动**。
> 本轮只完成「候选 C 拆解 + 取一个子方向」的拍板，产品代码**零改动**。
> 原因：本轮 MiniMax 额度块已用 97%（20:00 结块），按全局纪律只收尾不新起任务。
> 下一会话开工前必须重读本文 + `handoff-ecclaw-phase3t-final-2026-11-03.md`。

---

## 0. 一句话结论

候选 C「第二阶段外壳」是 **7 个互相独立的子系统**，不是一个任务；已拆解并选定
**「远程包仓库灰度发布」**作为第二十阶段子方向（AskUserQuestion 超时自动选中 = 默认值，
**不等于批准**，开工前需用户显式确认）。
它是 C 里唯一「现有流程的扩展」而非新建子系统：已有远程包仓库全链（拉清单 → 下载 → 校验 →
安全解包 → 落盘 → `current.json` 指针 → 界面安装），灰度只需在这条链上增加
**客户端分桶 + 版本可选性判定**，可全程用本地夹具验证，无外网副作用、无新原生依赖。

## 1. 候选 C 拆解（供后续阶段排队）

| 子项 | 性质 | 初期判断 |
|---|---|---|
| **远程包仓库灰度发布** | 扩展现有代码（`package-repository.ts`） | ✅ 本阶段选中：范围可控、可本地验证 |
| 文档预览（PDF/Docx/Pptx/PSD） | 渲染层新能力 + 新依赖 | 建议只先做 PDF（Chromium 原生），再分期 |
| 邮件 worker | 主进程新子系统 + 外发副作用 + 凭据 | 需额外红线：禁自动发信、只允许显式触发 |
| 画布宿主 | 新宿主形态 | 边界最模糊，先做概念收敛 |
| OCR | 新引擎/原生依赖 | 依赖与离线可用性要先定 |
| 社媒自动化脚本执行器 | 自动化 + 平台条款风险 | 风险最高，需单独评估 |
| 数据迁移框架 | 纯 infra | 当前无强需求，YAGNI |

（团队 / 账号 / 计费 / 遥测**刻意不做**，这是项目既有边界，见 README §8。）

## 2. 现状基线（灰度的落点，全部为实测文件事实）

- 远端清单拉取：`electron/main/package-repository.ts:78 fetchRepoIndex()`
  - 条目归一化：`:102 normalizeEntry()`，字段 = `packageId / version / channel / displayName /
    match / packageUrl / size / sha256 / manifestSha256`（`electron/shared/types.ts:85 RemotePackageEntry`）
  - 排序：`:94` 同 id 按 version 倒序（`numeric: true`）
- 安装：`package-repository.ts:124 installRemotePackage()`
  - **选版本逻辑在 `:130-136`：`candidates[0]`** —— 即「排序后的第一条」，目前**没有任何灰度/准入判断**
  - 下载 → sha256 → 安全解包（`:294 extractZip`，zip slip/符号链接/CRC/体积上限齐备）
  - `manifest` 校验（packageId / version / manifestSha256）
  - 落盘 `:168-177`：`<userData>/platform-packages/<packageId>/<channel>-<ver>-<hash8>/` +
    写 `current.json` 指针；**不删旧版本目录**（全局红线）
- 本地包扫描/匹配：`electron/main/platform-packages.ts:53 resolvePackageDir()` / `:114 listPackages()` /
  `:124 matchPackages()`；注册表 `index.json` 是 `match` 规则的权威来源
- IPC：`electron/main/index.ts:165 packages:repo-index` / `:167 packages:repo-install`；
  preload `electron/preload/index.ts:63/65`；共享契约 `electron/shared/types.ts:568/570`
- 界面：`src/App.tsx:345`（读 `settings.packageRepo.baseUrl`）/ `:396`（拉清单）/
  `:399`（保存仓库地址）/ `:411`（安装）/ `:816`（「远程包仓库」面板）
- 仓库地址持久化：`<userData>/ecclaw-settings.json` 的 `packageRepo.baseUrl`
- **MCP 不暴露包仓库** → 本阶段若只改包链路，**工具数应保持 26**

## 3. 建议设计（下一会话按 bounded 路径细化并取得用户批准后才可动码）

### 3.1 目标

同一个 packageId 的新版本可以只对一部分客户端可见；未命中灰度的客户端继续看到/安装旧版本，
且**行为可解释**（界面能说清「为什么没给我」）。

### 3.2 建议的 index.json 扩展（全部可选，向后兼容）

```jsonc
{
  "packageId": "taobao",
  "version": "1.0.68",
  "channel": "canary",
  "packageUrl": "https://…",
  "sha256": "…",
  "rollout": {
    "id": "taobao-1.0.68-canary-1",   // 灰度批次标识，参与分桶，换批次即重新洗牌
    "percent": 10,                     // 0-100
    "allowClientIds": ["…"],           // 可选：强制命中（本地调试/内测）
    "denyClientIds": ["…"]             // 可选：强制排除（优先级高于 allow）
  }
}
```

- **没有 `rollout` 字段 = 100% 可见**（老 index.json 行为一字不变 → 回归零风险）。
- `percent` 取 0 表示「已发布但暂不放量」，取 100 表示全量。

### 3.3 客户端分桶（无服务端、无遥测）

- 在 `ecclaw-settings.json` 生成一次性匿名 `clientId`（UUID，仅本地持久化）。
- `bucket = parseInt(sha256(clientId + ':' + rollout.id).slice(0, 8), 16) % 100`
- `eligible = bucket < percent`，`allowClientIds` 命中强制 true，`denyClientIds` 命中强制 false。
- 同一 clientId + 同一 rollout.id → 桶位恒定（重启不变）；换 `rollout.id` → 重新洗牌。
- **clientId 绝不上传**：分桶纯本地计算，符合「不做遥测」红线。

### 3.4 准入判定放在哪

- 判定函数（如 `isEntryEligible(entry, clientId)`）放 `package-repository.ts`，
  `fetchRepoIndex()` 返回条目时**同时带派生字段** `eligible` / `bucket` / `eligibleReason`（只读展示用）。
- **安装路径必须再判一次**（`:130-136` 的 `candidates[0]` 处）——不能只靠界面过滤。
- 选版本规则：在「同一 packageId + 同一 channel + eligible」集合里取版本最大者；
  显式 `version` 参数 = 用户主动指定，**绕过灰度**（但 sha256 / manifest 校验照旧）。
- 命中集合为空 → 明确报错（例如「当前批次未对客户端 X 开放，可用版本：…」），
  **不得静默回退到更低版本**、更不得删除已安装版本。

### 3.5 界面（最小改动）

- `src/App.tsx` 远程包仓库面板：每个条目显示 channel / 版本 / 「可选 / 未灰度到（桶位 n/percent%）」；
  未灰度到的条目安装按钮禁用并给出原因。
- 不改 IPC 通道数、不加 MCP 工具；仅给 `RemotePackageEntry` 增可选派生字段（preload 与主进程同步）。

### 3.6 刻意不做

- 不做服务端灰度开关/回滚接口（仓库是静态 index.json，改文件即回滚）。
- 不做自动升级/自动安装（只做「可见性与可选性」）。
- 不引入 `kind:'package'` 新事件类型（会牵动既有按 kind 的条数断言；真有需要另开阶段）。

## 4. 验收口径（下一会话用）

### 4.1 e2e（建议新建 `C:\Temp\ecclaw-verify\phase3u-e2e.cjs`，约 14-18 条）

需要新夹具：本地 HTTP 服务（如 8899）动态生成 `index.json` + zip，可按用例切换 `rollout.percent` /
`rollout.id` / 客户端 `clientId` / 坏哈希。建议断言分组：

- **A 向后兼容（3）**：无 rollout 字段的 index → 条目可见、安装成功；`current.json` 指针正确；
  工具数仍 26。
- **B 分桶确定性（4）**：同 clientId + 同 rollout.id 两次计算结果一致；跨 Electron 重启一致；
  不同 rollout.id 结果可不同；`percent=0` 全员不可见、`percent=100` 全员可见。
- **C 准入强制（4）**：`percent=0` 时 install 直接报错（不能只靠界面禁用）；
  `allowClientIds` 强制命中；`denyClientIds` 优先于 allow；空集合报错文案含原因。
- **D 选择与安全（3）**：eligible 集合内取最高版本；显式 version 绕过灰度仍校验 sha256；
  坏 sha256 / zip slip 仍被拒（回归）。
- **E 红线（2）**：旧版本目录只增不删；设置文件未被测试污染（`packageRepo.baseUrl` 复原或仅指向夹具）。

### 4.2 回归

- **必须换新前缀 `run52-*`** 并同步改驱动 `rerun-and-regress4.cjs` 里的产物名（别覆盖 run51 证据）。
- 串跑八套：phase3u（新）· phase3t 16 · phase3s 49 · phase3r 31 · phase3q 26 · phase3p 45 ·
  phase3o 44 · phase3m 69 · sse 14。
- 收官数字**以 `run52-summary.txt` 实测为准**，不得引用预期值（第十八阶段栽过）。

## 5. 开放问题（下一会话开工前用 AskUserQuestion 逐条确认）

1. 范围确认：第二十阶段就做「远程包仓库灰度发布」？
2. 灰度单位：只按 `packageId × version`，还是也要按 `channel` 整体放量？
3. 显式版本安装是否绕过灰度？（建议：绕过，但界面要标「手动指定」）
4. 是否接受在 `ecclaw-settings.json` 新增本地匿名 `clientId`？（不联网、不外传）

## 6. 红线（照旧，全量见 `handoff-ecclaw-phase3r-final-2026-11-03.md` §10）

- 禁删用户文件（`platform-packages` 旧版本目录、exports 均只增不删）；测试只删**自己新建的**临时目录。
- 禁 `git init` / `git commit`（项目非 git 仓库）。
- 密钥/token 不外传（输出只给指纹）；真实站点只用 `scroll` 做写操作验证；GUI 走 CDP。
- 临时产物写 `C:\Temp\`；handoff / task 文档不得放进 `memory/`。
- Electron 内 spawn 必须带 `ELECTRON_RUN_AS_NODE=1`；**改 main 代码必须重启 Electron**。
- 无人值守 e2e 跑期间提醒用户勿碰 GUI 卡片。
- 不改 `packageRepo` 之外的用户设置；夹具测试后恢复 `packageRepo.baseUrl`。

## 7. 环境 / 复现（同 phase3t）

```bash
cd /f/soft/00selfmade/ecclaw
pnpm typecheck && pnpm build
node C:/Temp/ecclaw-verify/stop-electron.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Temp/ecclaw-verify/start-electron.ps1"
# 夹具：8898（宿主验证页）/ 8897（writer）/ 新增 8899（包仓库灰度夹具）
```

## 8. 必读顺序

1. 本文件 → 2. `handoff-ecclaw-phase3t-final-2026-11-03.md`
→ 3. `handoff-ecclaw-phase3r-final-2026-11-03.md`（§0/§6/§10 权威）
→ 4. README §5.7（远程包仓库）+ §8（第二阶段候选与边界）
→ 5. `electron/main/package-repository.ts`（全文 333 行）
→ 6. `prompt-ecclaw-phase3u-next.md`