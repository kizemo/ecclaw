# handoff · ecclaw 第十五阶段（phase3p）· 代码就绪、**待验证** · 2026-11-03

> 阶段名：**第十五阶段 / phase3p** —— 店铺登录态 profile（多店铺登录隔离，第二阶段外壳候选第一项）
> 上一阶段：`handoff-ecclaw-phase3o-final-2026-11-02.md`（第十四阶段收官）
> 本文件是**中途交接**：代码六层全部写完，**typecheck / build / 真机 e2e / 文档都还没跑**。

---

## 1. 状态速览

| 项 | 值 |
|---|---|
| 阶段范围 | 用户在 4 个候选里选了「第二阶段外壳候选」，落地子项由我定：**店铺登录态 profile** |
| 代码 | ✅ 六层全部写完（主进程 / 共享类型 / preload / 渲染层 / MCP / 文档**未写**） |
| typecheck | ⚠️ 上一次跑绿是在**追加 UI 与 hostRemoveProfile 抛错之前**，**必须重跑** |
| build | ❌ 未跑（preload / renderer 都改了，必须 build） |
| 真机 e2e | ❌ 未跑（脚本已写好：`C:/Temp/ecclaw-verify/phase3p-e2e.cjs`） |
| MCP 工具数 | 24 → **26**（新增 `ecclaw_profile_list` / `ecclaw_profile_use`） |
| 文档 | ❌ 未写（README §5.19 / task.md / memory / 收官 handoff） |
| 代码未 commit | ✅（项目非 git 仓库，禁 git init/commit） |

---

## 2. 设计（为什么这么做）

**问题**：第十阶段起宿主只有一个持久化 partition（`persist:ecclaw-host`）。电商要同时登好几个店，
同一个 partition 里登第二个店，第一个店的登录态会被顶掉。

**解法**：一个 profile = 一个 partition。切 profile = 换 partition + **重建宿主 view**
（partition 是 `webPreferences` 的创建期参数，改不动已有 view）。

**关键红线**：默认 profile 的 partition **就叫 `persist:ecclaw-host`，一个字符都不改** ——
所以升级后原有的登录态（淘宝已真机验证过）不会丢。

---

## 3. 改动清单（**全部未 commit**）

| 文件 | 改动 |
|---|---|
| `electron/main/host-profiles.ts` | **新建**。profile 存储层：`<stateDir>/host-profiles.json`（`{version,profiles[],activeId}`）。默认 profile id=`default` / partition=`persist:ecclaw-host` / `builtin=true`。`createHostProfile`（id=`p-<slug>-<ts36>`，partition=`persist:ecclaw-profile-<id>`）、`removeHostProfile`（**只删配置记录，不删磁盘登录数据**；拒删内置）、`setActiveProfile`（不存在则抛错）、`getProfileState`。partition 名白名单正则 `^persist:ecclaw-profile-[a-z0-9-]{1,64}$`，默认 profile 只认 `persist:ecclaw-host`（防注入任意 partition）。落盘用 tmp + `renameSync` |
| `electron/main/browser-host.ts` | `HOST_PARTITION` 不动。新增 `private partition = HOST_PARTITION`；构造器 `constructor(owner, partition = HOST_PARTITION)`；`ensureView()` 改用 `this.partition`；新增 `async usePartition(partition)`：换 partition 前先 `close()` 销毁旧 view（cookie 落盘不受影响），**并把 viewport 存下来再恢复**（`close()` 会把 viewport 清成 null，不恢复的话占位盒还在、页面却「看不见」） |
| `electron/main/host-service.ts` | `initHost()` 改成 `new BrowserHost(win, getActiveProfile().partition)`；新增 `hostProfiles()` / `hostCreateProfile(name)` / `hostUseProfile(id)`（切 profile + 换 partition）/ `hostRemoveProfile(id)`（**移除失败会抛错**：不存在或内置默认 → `未找到该店铺，或内置默认店铺不可移除`；删掉的是当前 profile 时激活项复位到默认并把 partition 切回去） |
| `electron/shared/types.ts` | 新增 `HostProfile` / `HostProfileState`；`EcclawApi.host` 加 `listProfiles()` / `createProfile(name)` / `useProfile(id)` / `removeProfile(id)` |
| `electron/main/index.ts` | 新增 IPC：`host:profiles` / `host:profile-create` / `host:profile-use` / `host:profile-remove` |
| `electron/main/host-bridge.ts` | 新增桥 op：`profiles`（只读清单）/ `profile-use`（切换）。**没有** `profile-create` / `profile-remove`（新建要人起名、移除涉及用户登录数据 → 都留在界面） |
| `electron/preload/index.ts` | `listProfiles` / `createProfile` / `useProfile` / `removeProfile` 四个方法 + `HostProfileState` 类型导入 |
| `src/api.ts` | 导出 `HostProfile` / `HostProfileState` |
| `src/App.tsx` | 「平台包」视图的**内嵌浏览器宿主卡片**里加：店铺下拉（`data-testid="host-profile-select"`）、新建店铺（`host-profile-name` + `host-profile-create`）、**两段式移除**（`host-profile-remove-<id>`，第一次点只改文案「确认移除「X」？」，第二次才真删）、当前 partition 展示 |
| `resources/mcp/host-server.mjs` | 新增 2 个工具（24 → **26**）：`ecclaw_profile_list`（无参数）、`ecclaw_profile_use`（参数 `id`） |
| `C:/Temp/ecclaw-verify/fixture-server.cjs` | **验证脚手架**（非项目代码）：加 `?setcookie=NAME=VALUE` 下发 cookie + 页面回显收到的 cookie（`<p id="ecclaw-cookie">COOKIE:…</p>`），用来证明 partition 之间登录态互不串味。**重启 fixture server 才生效** |
| `C:/Temp/ecclaw-verify/phase3p-e2e.cjs` | **新建**（未跑过）：36 条断言，见 §5 |

---

## 4. 接手步骤（按顺序）

```bash
cd /f/soft/00selfmade/ecclaw
pnpm typecheck          # ① 必须重跑（追加过 UI + hostRemoveProfile 抛错）
pnpm build              # ② preload / renderer 都改了

# ③ 重启 fixture server（8898，新代码才有 cookie 回显）
#    先杀掉占用 8898 的旧进程：netstat -ano | grep 8898 → taskkill /PID <pid> /F
node C:/Temp/ecclaw-verify/fixture-server.cjs > C:/Temp/ecclaw-verify/fixture-8898-p3p.log 2>&1 &

# ④ 起 Electron（启动时会自动把 resources/mcp/host-server.mjs 同步到 <stateDir>/mcp/）
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"

# ⑤ 跑 e2e
node C:/Temp/ecclaw-verify/phase3p-e2e.cjs \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs" \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json"
```

> e2e 里会**真重启一次 Electron**（验证 profile 与登录态跨重启持久），所以它自己会调
> `stop-electron.cjs` / `start-electron.ps1`。
> 收尾仍用 `node C:/Temp/ecclaw-verify/stop-electron.cjs`（强杀会丢 cookie）。

**⑤ 之后还要补的文档**：
- `README.md` 新增 **§5.19**（并把 §8 的状态与实测数字同步）
- `task.md` 顶部状态段 + **第十五阶段**表格 + 实证发现
- memory：`E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\ecclaw_phase3p_profiles.md`
  + `MEMORY.md` 索引一条
- 收官：`handoff-ecclaw-phase3p-final-2026-11-03.md` + `prompt-ecclaw-phase3p-next.md`

---

## 5. e2e 断言清单（36 条，已写好待跑）

- **A 工具面**：工具数 = 26；`ecclaw_profile_list` / `ecclaw_profile_use` 已注册；
  **agent 侧只有这两个**（无新建 / 无删除）；list 无参数；use 只有 `id`
- **B 默认 profile 不变**：清单返回 `{profiles, activeId}`；存在 `id=default` 且 `builtin=true`；
  **partition 仍是 `persist:ecclaw-host`**（老登录态没被改名）
- **C 新建**：走 renderer 的 `createProfile` → 清单多一个、`partition=persist:ecclaw-profile-*`、
  `builtin=false`、`<stateDir>/host-profiles.json` 落盘且含新 id
- **D 隔离（核心）**：在 A 店「登录」（`?setcookie=shopProbe=A`）→ A 店读到 cookie；
  切默认 → **读不到**；切回 A → **还在**；A 店 partition 目录已建；默认 partition 目录仍在
- **E 负例**：切到不存在的 id 报错；**移除内置默认被拒**；负例后默认店铺还在
- **F 跨重启**：重启 Electron → profile 清单还在、激活项仍是 default、隔离仍成立、A 店登录态仍在
- **G 界面**：切到「平台包」视图 → 店铺下拉存在、选项数 = profile 数、含「测试店铺A」；
  界面「新建店铺」可用；**两段式移除**（第一次只改文案、第二次真删）；
  **移除 profile 后磁盘上的 partition 目录仍在**（不删用户数据）

---

## 6. 红线（照旧）

- **禁删用户文件**：`<userData>/host-events/exports/` 15 个导出物一条都不许删；
  **新增**：`<userData>/Partitions/ecclaw-profile-*` 也是用户数据 ——
  `removeHostProfile` **只删配置记录**，不删磁盘目录（e2e 已断言）。
- 禁 `git init` / `git commit`（项目非 git 仓库）。
- `openclaw.json`（明文 relay key）与 `host-bridge.json`（token）勿外传。
- Electron 内 spawn 内核/MCP 必须带 `ELECTRON_RUN_AS_NODE=1`；护栏默认 `ask`；别去掉 `persist:` 前缀。
- **真实站点只用 `scroll` 做写操作验证**。
- 临时产物写 `C:\Temp\`；记忆写 `memory/` 文件夹，**handoff / task 文档不得放进 memory 文件夹**。
- GUI 验证走 **CDP**（`--remote-debugging-port=9222`），不用 computer-use。

---

## 7. 已知风险 / 待确认点

1. **工具数断言**：e2e 断言工具数 = 26。如果实际不是 26（多了别的工具），
   先查清是「本阶段多加了什么」还是「历史遗留多了一个」，**不要直接改断言迁就**。
2. **cookie 回显依赖新 fixture**：8898 上的旧进程不重启就**没有** cookie 回显，
   D 段隔离断言会全红 —— 先重启 fixture 再跑。
3. **`usePartition` 的 viewport 恢复**：`close()` 会清 viewport，不恢复的话切完 profile
   内嵌浏览器「看不见」（占位盒在、页面不在屏上）。已实现存-恢复，但真机要看一眼
   「切换店铺后内嵌浏览器是否还显示」。
4. **切换 profile 会关掉当前页面**（换 partition 必须重建 view）—— 界面要提示用户。
5. **profile 记录会跨轮次累积**：e2e 开头会清掉名字以「测试店铺 / 界面店铺」开头的旧记录，
   但磁盘上的 `Partitions/ecclaw-profile-*` 目录会留下（**不删，红线**）。长期需要用户手动清理。
6. `hostRemoveProfile` 移除失败 → 抛错（IPC reject）→ 界面 `removeProfile` 会 reject，
   App.tsx 里**没有 catch**（当前 UI 只有 testid 按钮，失败会变成 unhandled rejection）。
   建议下一轮给界面加个错误提示，或 catch 住。
