# handoff · ecclaw 第二十阶段（phase3u）· 收官 · 2026-11-03

> **一句话结论**：远程包仓库灰度发布已落地——可选 `rollout` 字段 + 本地匿名 clientId 分桶 +
> **安装路径二次准入**；产品改动 5 个文件，**零新增 MCP 工具（仍 26）**、零新事件 kind；
> `phase3u-e2e.cjs` **24/24 全绿（实测）**。
> 回归 **8 套中 7 套全绿**，`phase3o` **42/44**（2 条 seq 断言红，疑似进程序/双实例环境问题，非本阶段改动引入）。

---

## 1. 交付清单

| 文件 | 改动 |
|---|---|
| `electron/shared/types.ts` | 新增 `PackageRollout` / `PackageEligibilityReason`；`RemotePackageEntry` 增可选 `rollout` + 只读派生 `eligible/bucket/eligibleReason`；`repoInstall` 类型加可选 `opts.bypassRollout` |
| `electron/main/package-repository.ts` | ①`normalizeRollout()`（**写坏 fail-closed 按 percent=0**）；②`readOrCreateClientId()` 惰性写 settings；③`rolloutBucket()` / `decideRollout()`（deny > allow > percent）；④`fetchRepoIndex()` 给条目补派生字段；⑤`installRemotePackage()` **二次准入** + eligible 集合取最高版本 + 明确报错 |
| `electron/main/index.ts` | `packages:repo-install` 透传第 4 个可选参数 |
| `electron/preload/index.ts` | 同上，签名同步 |
| `src/App.tsx` | 远程包仓库条目显示 `灰度命中 / 未灰度到（bucket/percent%）/ 内测名单 / 已排除`；未放行禁用按钮、文案「未放行」；新增 data-testid |
| `README.md` | 新增 **§5.24** |

**临时资产**（`C:\Temp\ecclaw-verify\`）：`phase3u-e2e.cjs`（24 条，自带 8899 夹具与 zip 写入器）；
`rerun-and-regress4.cjs` 改为 `run52-*` 前缀并加入 phase3u 24。

## 2. 两处对原设计的修正（**重要，可迁移**）

1. **`version` 参数不能兼作放行开关**。原设计写「显式 version 绕过灰度」，但界面安装总会带 version
   → 照此实现等于灰度对 UI 完全失效。改为：version 只用于选条目；只有显式 `{ bypassRollout: true }`
   才越过灰度（仍校验 sha256 / manifest / zip 安全）。
   **通用规则：选择器/过滤参数不能兼作授权开关，放行必须是独立且显式的。**
2. **rollout 写坏一律 fail-closed（percent=0）**：灰度是放量闸门，清单写坏宁可少放，不能误放全量。

## 3. 验证证据（实测）

### 3.1 typecheck / build
`pnpm typecheck` exit 0；`pnpm build` ✅（renderer `index-BB2S9VW2.js`），已重启 Electron。

### 3.2 phase3u e2e：24/24
A 工具面 1 · B 向后兼容 4 · C 分桶确定性 5 · D 准入强制 5 · E 选择与安全 4 · F 只增不删 3 · G 界面 2。
关键实测：clientId 桶位 46；边界 percent=46 不放行 / 47 放行；deny 压过 allow；
坏 rollout → percent=0；指定不可见版本仍被拒；zip slip 与坏 sha256 仍被拒。

### 3.3 回归（`run52-summary.txt`，实测原文）
```
phase3u: PASS=24 FAIL=0
phase3t: PASS=16 FAIL=0
phase3s: PASS=49 FAIL=0
phase3r: PASS=31 FAIL=0
phase3q: PASS=26 FAIL=0
phase3p: PASS=45 FAIL=0
phase3o: PASS=42 FAIL=2
phase3m: PASS=69 FAIL=0
sse:     PASS=14 FAIL=0
```
phase3o 两条红（原文）：
- `本轮产生新事件（seq 高于历史最大值）· seqA=900500 历史最大=900548`
- `重启后新事件 seq 继续往上走（不归零）· seqB=900500 seqA=900500`

**判读**：同轮 `重启后落盘最大 seq 未归零 · 重启后最大=900550`、`新空间内 seq 严格递增` 都 PASS
→ `maxSeqOnDisk()` 机制本身正常。红点是**运行中进程的内存计数器（900500）落后于磁盘最大值（900548）**，
典型成因是同一 events 目录存在**两个 Electron 实例**（各自独立计数器）或进程启动早于那段历史落盘。
本阶段改动只碰包仓库与包面板 IPC，与 `host-events` seq 无交集。
**下一步必须做的定性**：干净重启（确认只剩一个 Electron 进程）后单跑 `phase3o-e2e.cjs`；
若 44/44 → 定性环境/双实例污染；若仍红 → 按产品 bug 查。

## 4. 已知尾巴 / 风险

- `phase3o` 的 2 条红**未定性**（见 §3.3），下一会话第一件事是复验，不许直接引用本轮结论。
- 测试安装落在 `ECCLAW_LOCAL_PACKAGES_DIR`（当前 = `C:/Users/Duanyi/AppData/Roaming/com.dabiai.desktop/platform-packages`）
  的 `ecclaw-graytest/`（1.0.0 / 1.1.0 两目录，**只增未删**）。
- `ecclaw-settings.json` 因灰度新增了 `clientId`（设计如此）；UI 测试写过的 `packageRepo` 已按原文还原。
- 未新增 MCP 工具、未新增事件 kind、未做真站写操作、未 git。

## 5. 复现命令

```bash
cd /f/soft/00selfmade/ecclaw && pnpm typecheck && pnpm build
node C:/Temp/ecclaw-verify/stop-electron.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Temp/ecclaw-verify/start-electron.ps1"
node C:/Temp/ecclaw-verify/phase3u-e2e.cjs \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs" \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json"
node C:/Temp/ecclaw-verify/rerun-and-regress4.cjs   # run52-*
```

## 6. 必读顺序

本文件 → `handoff-ecclaw-phase3t-final-2026-11-03.md` → `handoff-ecclaw-phase3r-final-2026-11-03.md` §0/§6/§10
→ README §5.7 / §5.24 → `electron/main/package-repository.ts` → `prompt-ecclaw-phase3u-next.md`

## 7. 红线（照旧，全量见 phase3r final §10）

禁删用户文件（`platform-packages` 旧版本、exports 均只增不删）；禁 git；密钥/token 只以指纹出现；
真实站点只用 `scroll` 做写操作验证；GUI 走 CDP；临时产物写 `C:\Temp\`；handoff/task 不进 `memory/`；
Electron 内 spawn 带 `ELECTRON_RUN_AS_NODE=1`；改 main 必须重启 Electron；
无人值守 e2e 期间提醒用户勿碰 GUI 卡片。