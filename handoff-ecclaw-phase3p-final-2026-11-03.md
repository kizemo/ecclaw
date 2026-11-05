# handoff · ecclaw 第十五阶段（phase3p）· **收官** · 2026-11-03

> 阶段名：**第十五阶段 / phase3p** —— 店铺登录态 profile（多店铺登录隔离）
> 上一阶段：`handoff-ecclaw-phase3o-final-2026-11-02.md`（第十四阶段收官）
> 本文件是**收官交接**：代码 + 真机 e2e + 文档全部完成。
> 中途交接（实现细节）：`handoff-ecclaw-phase3p-2026-11-03.md`

---

## 1. 状态速览

| 项 | 值 |
|---|---|
| 阶段范围 | 用户在 4 个候选里选了「第二阶段外壳候选」，子项由我定：**店铺登录态 profile** |
| 代码 | ✅ 六层全部写完（主进程 / 共享类型 / preload / 渲染层 / MCP / 文档） |
| typecheck | ✅ `pnpm typecheck` 两段 tsc 均 exit 0 |
| build | ✅ `pnpm build`（main 173.30 kB / preload 6.12 kB / renderer 639.90 kB） |
| 真机 e2e | ✅ `phase3p-e2e.cjs` **45/45 全绿**（含一次真重启 Electron） |
| 回归 | ✅ `phase3o-e2e.cjs` 44/44 · `phase3m-e2e.cjs` 69/69 · `sse-e2e.cjs` 14/14 |
| MCP 工具数 | 24 → **26**（新增 `ecclaw_profile_list` / `ecclaw_profile_use`） |
| 文档 | ✅ README §5.19 + §8 · task.md 顶部状态 + 第十五阶段表 + 实证发现 · memory + 收官 handoff + next prompt |
| 代码未 commit | ✅（项目非 git 仓库，禁 git init/commit） |

---

## 2. 设计（为什么这么做）

**问题**：第十阶段起宿主只有一个持久化 partition（`persist:ecclaw-host`）。电商要同时登好几个店，
同一个 partition 里登第二个店，第一个店的登录态会被顶掉。

**解法**：一个 profile = 一个 partition。切 profile = 换 partition + **重建宿主 view**
（partition 是 `webPreferences` 的创建期参数，改不动已有 view）。

**关键红线**：默认 profile 的 partition **就叫 `persist:ecclaw-host`，一个字符都不改** ——
所以升级后原有的登录态（淘宝已真机验证过）不会丢、不会搬家。e2e 已断言。

---

## 3. 改动清单（**全部未 commit**）

| 文件 | 改动 |
|---|---|
| `electron/main/host-profiles.ts` | **新建**。profile 存储层：`<stateDir>/host-profiles.json`（`{version,profiles[],activeId}`）。默认 profile id=`default` / partition=`persist:ecclaw-host` / `builtin=true`。`createHostProfile`（id=`p-<slug>-<ts36>`，partition=`persist:ecclaw-profile-<id>`）、`removeHostProfile`（**只删配置记录，不删磁盘登录数据**；拒删内置）、`setActiveProfile`（不存在则抛错）、`getProfileState`。partition 名白名单正则 `^persist:ecclaw-profile-[a-z0-9-]{1,64}$`，默认 profile 只认 `persist:ecclaw-host`（防注入任意 partition）。落盘用 tmp + `renameSync` |
| `electron/main/browser-host.ts` | `HOST_PARTITION` 不动。新增 `private partition = HOST_PARTITION`；构造器 `constructor(owner, partition = HOST_PARTITION)`；`ensureView()` 改用 `this.partition`；新增 `async usePartition(partition)`：换 partition 前先 `close()` 销毁旧 view（cookie 落盘不受影响），**并把 viewport 存下来再恢复**（`close()` 会把 viewport 清成 null，不恢复的话占位盒还在、页面却「看不见」） |
| `electron/main/host-service.ts` | `initHost()` 改成 `new BrowserHost(win, getActiveProfile().partition)`；新增 `hostProfiles()` / `hostCreateProfile(name)` / `hostUseProfile(id)` / `hostRemoveProfile(id)`（**移除失败会抛错**：不存在或内置默认 → `未找到该店铺，或内置默认店铺不可移除`；删掉的是当前 profile 时激活项复位到默认并把 partition 切回去） |
| `electron/shared/types.ts` | 新增 `HostProfile` / `HostProfileState`；`EcclawApi.host` 加 `listProfiles()` / `createProfile(name)` / `useProfile(id)` / `removeProfile(id)` |
| `electron/main/index.ts` | 新增 IPC：`host:profiles` / `host:profile-create` / `host:profile-use` / `host:profile-remove` |
| `electron/main/host-bridge.ts` | 新增桥 op：`profiles`（只读清单）/ `profile-use`（切换）。**没有** `profile-create` / `profile-remove`（新建要人起名、移除涉及用户登录数据 → 都留在界面） |
| `electron/preload/index.ts` | `listProfiles` / `createProfile` / `useProfile` / `removeProfile` 四个方法 + `HostProfileState` 类型导入 |
| `src/api.ts` | 导出 `HostProfile` / `HostProfileState` |
| `src/App.tsx` | 「平台包」视图的**内嵌浏览器宿主卡片**里加：店铺下拉（`data-testid="host-profile-select"`）、新建店铺（`host-profile-name` + `host-profile-create`）、**两段式移除**（`host-profile-remove-<id>`，第一次点只改文案「确认移除「X」？」，第二次才真删）、当前 partition 展示、提示「切换店铺会关闭当前页面」；新增 `profileMsg` 状态 —— 切换/新建/移除的**结果与失败原因都显示出来**（原来 `removeProfile` 失败会变成 unhandled rejection） |
| `resources/mcp/host-server.mjs` | 新增 2 个工具（24 → **26**）：`ecclaw_profile_list`（无参数）、`ecclaw_profile_use`（参数 `id`） |
| `README.md` | 新增 **§5.19**；§8 状态段补本阶段实现与实测数字，并把「店铺登录态 profile」从第二阶段候选里划掉 |
| `task.md` | 顶部状态段 + **第十五阶段**表格（8 行）+ **实证发现 7 条** |
| `memory/ecclaw_phase3p_profiles.md` | 新建（项目记忆）+ `MEMORY.md` 索引一条 |

**验证脚手架（非项目代码，都在 `C:\Temp\ecclaw-verify\`）**：

| 文件 | 改动 |
|---|---|
| `fixture-server.cjs`（8898） | 加 `?setcookie=NAME=VALUE` 下发 cookie + 页面回显收到的 cookie。**本轮修正**：默认补 `Max-Age=86400`（persistent），`?maxage=0` 才是 session cookie —— 原版漏了 `Max-Age`，导致「跨重启留存」断言全红（见 §5 踩坑 1） |
| `phase3p-e2e.cjs` | 45 条断言（A 工具面 / B 默认 profile 不变 / C 新建 / D 隔离 / E 负例 / F 跨重启 / G 界面） |
| `phase3p-viewport-check.cjs` | 新建：切换店铺前后 viewport bounds 对比（风险 3 的专项验证） |
| `phase3m-e2e.cjs` / `phase3o-e2e.cjs` / `sse-e2e.cjs` | 工具数断言 24 → 26 |

---

## 4. 复现步骤（按顺序）

```bash
cd /f/soft/00selfmade/ecclaw
pnpm typecheck && pnpm build

# 夹具（两个都要起！phase3m 依赖 8897）
cd /c/Temp/ecclaw-verify
node fixture-server.cjs &   # 8898
node fixture-writer.cjs &  # 8897

# 起 Electron（启动时自动把 resources/mcp/host-server.mjs 同步到 <stateDir>/mcp/）
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"

# 跑 e2e
node C:/Temp/ecclaw-verify/phase3p-e2e.cjs \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs" \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json"
```

> e2e 内部会**真重启一次 Electron**（验证 profile 与登录态跨重启持久），自己会调
> `stop-electron.cjs` / `start-electron.ps1`。
> 收尾用 `node C:/Temp/ecclaw-verify/stop-electron.cjs`（强杀会丢 cookie）。

---

## 5. 本阶段踩到的坑（都写进 task.md 与 memory 了）

1. **session cookie 跨 Electron 重启必丢（Chromium 语义，与 partition 无关）**：
   夹具漏了 `Max-Age` → 重启后 cookie 全空，一度被误判成「partition 机制不持久」。
   要验「跨重启留存」必须用 persistent cookie；要验 session 语义单开 `?maxage=0`。
2. **断言不能挂在会过期的历史 cookie 上**：挂在 11-02 设的 `Max-Age=86400` 老 cookie 上 →
   它 11-03 08:57 整到期 → 前一轮绿、下一轮红（定时炸弹）。改成「重启前现设、重启后断言」。
3. **e2e 基线要在「清理上一轮遗留」之后取**，否则计数必然差一个。
4. **「没删用户数据」这条红线得先把目录造出来才能验**：从未激活过的 profile，Chromium 没建过它的
   partition 目录 → 「目录还在」是空断言。必须先切过去开一次页（目录落盘）→ 再移除 → 再断言目录仍在。
5. **换 partition 必须重建 view，viewport 要存-恢复**（`close()` 会清 viewport）。
6. **界面与 MCP 侧同源**：宿主桥是主进程内的 HTTP server，共享同一份 profile 状态；
   MCP 进程每次调用都重读 `host-bridge.json`（端口/token 每次重启都变，不用重启 MCP 进程）。
7. **phase3m 回归脚本依赖 8897 夹具**（`fixture-writer.cjs`），只起 8898 会挂在 `ERR_CONNECTION_REFUSED`。

---

## 6. 红线（照旧）

- **禁删用户文件**：`<userData>/host-events/exports/` **原 15 个导出物一条都不许删**（本轮复核：11-02 的 15 个 mtime 全未变；本阶段 e2e 新造 2 个 → 现 17 个，**没删过任何一个**）；
  `<userData>/Partitions/ecclaw-profile-*` 也是用户数据 —— `removeHostProfile` **只删配置记录**，
  不删磁盘目录（e2e 已断言）。
- 禁 `git init` / `git commit`（项目非 git 仓库）。
- `openclaw.json`（明文 relay key）与 `host-bridge.json`（token）勿外传。
- Electron 内 spawn 内核/MCP 必须带 `ELECTRON_RUN_AS_NODE=1`；护栏默认 `ask`；别去掉 `persist:` 前缀。
- **真实站点只用 `scroll` 做写操作验证**。
- 临时产物写 `C:\Temp\`；记忆写 `memory/` 文件夹，**handoff / task 文档不得放进 memory 文件夹**。
- GUI 验证走 **CDP**（`--remote-debugging-port=9222`），不用 computer-use。

---

## 6.5 收尾待办（✅ 已于 2026-11-03 下一会话全部做完）

写这份收官 handoff 时上下文已到 161.8K（`ctx-budget-guard` 硬闸门 160K，禁 Bash），
以下三步留给下个会话 —— **现已全部完成**：

1. ✅ **删掉 e2e 遗留的「测试店铺A」配置记录**（`id=p-a-mvzzdau9`）：
   走界面 API `window.ecclaw.host.removeProfile('p-a-mvzzdau9')`（CDP `Runtime.evaluate`）→
   返回 `{"profiles":[{"id":"default",…,"builtin":true}],"activeId":"default"}`；
   `host-profiles.json` 已只剩默认店铺一条。
   **磁盘 `Partitions/ecclaw-profile-p-a-mvzzdau9/` 目录仍在**（红线：只删配置记录，不删登录数据）。
2. ✅ **复核 `<userData>/host-events/exports/`**：实为 **17 个**（不是 15）——
   11-02 的**原 15 个一个没少、mtime 全是 11-02**；多出的 2 个是 11-03 09:00/09:01 本轮 e2e 新造的
   （`ecclaw-events-20261103-090051.jsonl`、`…-090116.jsonl`）。**本轮全程没执行过任何删除命令。**
   → 后续基线数字应按「15 + 后续 e2e 增量」计，不要当死数。
3. ✅ **优雅关停**：`node C:/Temp/ecclaw-verify/stop-electron.cjs` → `CLOSED`
   （走 `window.close()` → `window-all-closed` → `app.quit()`，cookie 已落盘）；
   夹具 8898 `fixture-server.cjs`（PID 412032）与 8897 `fixture-writer.cjs`（PID 280028）
   已按**精确 PID** 停掉，复查 `NO_NODE_ELECTRON_LEFT`。

---

## 7. 下一阶段候选（待用户拍板）

**A. 下一轮候选（真机闭环类）**

- **真实站点登录态下的写操作闭环复验**（唯一被用户手动卡住的一项）：
  淘宝页已在内嵌浏览器打开，仍显示「亲，请登录」—— **需用户本人手动登录**后，
  用 `ecclaw_scroll`（不是 click，淘宝点一下可能下单）触发护栏走一遍 session 档信任。

**B. 第二阶段外壳候选（dabi 第二层能力，与内核无关）**

| 候选 | 说明 |
|---|---|
| 远程包仓库**灰度发布** | 上一阶段留下的尾巴 |
| 邮件 worker | 后台轮询邮件 → 触发宿主动作 |
| 画布宿主 | 第二种宿主形态（画布而非页面） |
| PDF/Docx/Pptx/PSD 预览 | 文件库预览能力扩展 |
| OCR | 截图 / 图片转文字 |
| 社媒自动化脚本执行器 | 脚本驱动社媒动作（风险最高） |
| 数据迁移框架 | 事件落盘格式迁移、profile 数据迁移 |
| 团队 / 账号 / 计费 / 遥测 | dabi 私有商业系统部分，**本项目刻意不做** |

**C. 本阶段遗留的小尾巴（可搭车下一轮）**

1. **profile 记录与磁盘目录会跨轮次累积**：e2e 开头会清掉名字以「测试店铺 / 界面店铺」开头的旧**记录**，
   但磁盘上的 `Partitions/ecclaw-profile-*` 目录会留下（**不删，红线**）→ 长期需要用户手动清理。
   可考虑在界面上给一句「这些目录属于历史店铺，可自行删除」的提示。
2. **切换 profile 会关掉当前页面**（换 partition 必须重建 view）→ 已有提示文案，但可以做得更醒目。
3. **agent 侧没有「新建店铺」**：是有意为之（要人起名）；若用户觉得 agent 该能建，需要另开一个带确认的入口。
