# handoff · ecclaw 第二十一阶段（phase3v）· 文档预览（先 PDF）· 2026-11-03

> **一句话结论**：本轮两件事——
> ① **phase3o 两条红已定性并修掉：是测试脚本 bug，不是产品 bug**（`ecclaw_event_replay` 的 `limit` 截断的是
> **seq 最小的前 N 条**，旧脚本拿「第 500 小」当新事件 seq；落盘实测 900013→900568 连续无空洞，产品侧 seq 续号正常）；
> ② 新交付 **文档预览（先 PDF）**：文件库里点 PDF → 抽页数 + 逐页文本 → 界面可看、agent 可读
> （新增**只读** MCP 工具 `ecclaw_document_preview`，工具数 **26 → 27**），`phase3v-e2e.cjs` **29/29 全绿（实测）**。
>
> **本轮状态**：代码 / typecheck / build / phase3v e2e 已就绪；**回归 run53 已实测八套全绿**
> （数字逐条取自 `C:\Temp\ecclaw-verify\run53-summary.txt`，见 §4.4）。
> README §5.25 / §8 状态段 / task.md 第二十·二十一阶段表 / 项目记忆索引 **本轮已补齐**。

---

## 1. 本轮必读顺序

1. `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3v-final-2026-11-03.md` ← **本文档**
2. `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3u-final-2026-11-03.md` ← 上一阶段（灰度发布）
3. `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3r-final-2026-11-03.md` §0/§6/§10（架构 / 复现 / 红线权威）
4. `F:\soft\00selfmade\ecclaw\README.md` §5.24 / §5.7 / §8
5. `F:\soft\00selfmade\ecclaw\task.md`（阶段表 + 顶部状态段）
6. `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\MEMORY.md`
7. `F:\soft\00selfmade\ecclaw\prompt-ecclaw-phase3v-next.md` ← 下一阶段一句话 prompt

---

## 2. 交付清单（**全部未 commit**；项目非 git 仓库）

### 2.1 产品代码（本轮改动 7 个文件 + 1 个新依赖）

| 文件 | 改动 |
|---|---|
| `electron/main/document-preview.ts`（**新建**） | ①`resolveLibraryFile()` 路径守卫（`path.relative` 判越界 + realpath 防符号链接逃逸）；②`detectDocumentKind()`（PDF magic `%PDF-`）；③`loadPdfjs()`（`createRequire` 加载 pdfjs legacy 构建）；④`itemsToText()`（按 `hasEOL` 换行 + **NFKC 归一化**）；⑤`listDocuments()` 清单；⑥`previewDocument()` 抽页数 / 逐页文本 / 截断标记 / 明确错误 |
| `electron/shared/types.ts` | 新增 `DocumentKind` / `DocumentPreviewPage` / `DocumentPreview`；`EcclawApi.files` 增 `preview(path)` |
| `electron/main/index.ts` | 新增 IPC `files:preview` |
| `electron/preload/index.ts` | `files.preview` 暴露给渲染层 |
| `electron/main/host-bridge.ts` | 新增 op `document-list` / `document-preview` |
| `resources/mcp/host-server.mjs` | 新增工具 `ecclaw_document_preview`（26 → **27**） |
| `src/App.tsx` | 文件库视图：PDF 条目加「PDF 预览」标签；点开 PDF → 预览面板（`doc-preview-meta` / `doc-preview-page-N` / `doc-preview-text-N` / `doc-preview-error`）；非 PDF 维持原文本读取 |
| `src/api.ts` | 导出 `DocumentPreview` 类型 |
| `package.json` | 新增依赖 `pdfjs-dist@6.5.438`（纯 JS，无原生编译） |

### 2.2 临时资产（`C:\Temp\ecclaw-verify\`，非项目文件）

- `phase3v-e2e.cjs`（**29 条断言**，自带夹具：把中文报价单 PDF / 英文 PDF / 假 PDF / txt 写进文件库；界面段已改轮询等待，见 §4.2 提示框）
- `pdf-spike.cjs`（技术验证：Node 端 pdfjs 抽文本）
- `cn.html` + `cn.pdf`（中文报价单夹具，**Edge headless `--print-to-pdf` 生成**，含中文与表格）
- `dummy.pdf`（w3c 英文样例）
- `rerun-and-regress5.cjs`（**run53-\*** 驱动：加入 phase3v 28；**不跑真站套件 phase3s / phase3q**）
- 改：9 个老 e2e 脚本的「MCP 工具数 = 26」断言改成 **27**（phase3m/o/p/q/r/s/t/u + sse）

### 2.3 phase3o 的定性结论（**不是产品 bug**）

- 根因：`ecclaw_event_replay` 的 `limit` 截断的是 **seq 最小的前 N 条**（`SeqSelector` 取「最小的前 N」）。
  旧 `makeEvent()` 用 `sinceSeq=900000, limit=500` 再取 max → 事件攒过 500 条后拿到的永远是「第 500 小」那条。
- 实测证据（改前）：`limit=500` → 条数 500、最大 seq **900500**；`limit=2000` → 条数 568、最大 seq **900568**；磁盘直读 = **900568**。
- 落盘体检：`events-2026-11-03.jsonl` = 556 行，seq **900013→900568 连续、无重复、无空洞** → 启动续号（`maxSeqOnDisk`）正常。
- 修法（**只改测试脚本，未改产品代码**）：加 `diskMaxSeq()` 直读磁盘作地面真相；`makeEvent(floorSeq)` 只取 `sinceSeq=floor` 之后的新事件；`limit` 提到 2000。
- 复验：**44/44 全绿**。
- **可迁移规则**：任何「取最大值」的断言都不能靠有上限的回放列表 —— 回放给的是**最小的前 N 条**，不是最新的 N 条。

---

## 3. 关键设计决策（**可迁移**）

1. **主进程是 CJS 产物**，打包器会把 `import()` 改写成 `require()`，而 `pdfjs-dist` 只发 ESM（`.mjs`）→ 会炸。
   解法：`createRequire(app.getAppPath()+'/…')` + **Electron 的 Node 24 支持 `require(ESM)`**（实测通过，pdfjs 无顶层 await）。
   **通用规则：主进程要用 ESM-only 依赖，要么 createRequire，要么把它排除出 externalize 让打包器自己转译。**
2. **不做 PDF 位图渲染**（本轮明确取舍）：Electron **不内置 PDF 插件**，渲染成图要引入原生 canvas 依赖（`@napi-rs/canvas`），
   收益不抵成本；渲染层跑 pdfjs 也会踩 `file://` 下 Worker 被拦的坑。→ 本轮做**文本/结构化预览**（页数 + 逐页文本）。
   后续若要做「看版面」，再单独评估原生 canvas 或外部查看器。
3. **NFKC 归一化**：PDF 的 ToUnicode 常把「色」映成康熙部首「⾊」（U+2F4A）。归一化后才是人能读、agent 能用的文本（实测 `颜⾊` → `颜色`）。
4. **路径守卫 fail-closed**：只允许文件库根目录内的文件，越界/符号链接逃逸一律拒绝（e2e 实测报错含「路径越界」）。
5. **出错不抛栈**：解析失败/加密/非 PDF 都返回**人话 error 字段**，界面与 agent 都能读；只有「越界/不存在」这种调用错误才报错。
6. **只加 1 个 MCP 工具，且是必要的**：agent 此前**没有任何文件读取工具**，不加就完全读不到 PDF（工具面 26 → 27）。
   本轮**未新增任何事件 kind**（预览是纯只读，不产生事件）。

---

## 4. 验证证据（实测）

### 4.1 typecheck / build

- `pnpm typecheck` ✅ 两段 tsc 均 exit 0
- `pnpm build` ✅（preload 6.27 kB；renderer `index-DHlm20D6.js` 654.37 kB）
- 已重启 Electron（`stop-electron.cjs` + `start-electron.ps1`），MCP 侧副本 `<stateDir>/mcp/host-server.mjs` 已刷新（含新工具）

### 4.2 phase3v e2e：**29/29 全绿**

```
A 工具面 5 · B 清单 4 · C 预览 11 · D 路径守卫 2 · E 界面 6
```

关键实测：工具数 **27**；`ecclaw_document_preview` 无必填参数；
不传 path/name → 返回清单（PDF 标 `kind:'pdf'`、txt 标 `other`）；
按 name/path 预览报价单 → **1 页 / 抽出「供应商报价单…款号 颜色 尺码 单价 数量 A102 米白…」**；
**NFKC 生效（是「颜色」不是「颜⾊」）**；`maxChars=10` → `truncated=true`；
假 PDF → `error="PDF 解析失败：Invalid PDF structure."`；txt → 「暂只支持 PDF 预览」；
越界路径 → 报「路径越界：只允许访问文件库内的文件」；不存在的文件 → 「文件库里没有这个文件」；
界面：文件库列出 PDF、显示「PDF 预览」标签、预览面板显示「PDF · 1 页 · 138481 B」与第 1 页文本、损坏 PDF 显示错误原因。

> ⚠️ **首轮回归曾红 5 条界面断言（时序型假红）**：phase3v 是回归链的**第一套**，紧跟 Electron 冷启动，
> 原脚本固定 `sleep(3000)` 后点「文件库」—— 冷启动时 React 还没挂好，按钮不存在 → 5 条界面断言全红，
> 而 MCP 侧 23 条全绿、单跑却 28/28 全绿。**修法（只改 e2e 脚本）**：把固定 sleep 换成**轮询等待**
> 「文件库」导航按钮出现 → 点击 → 轮询等文件名出现在页面上 → 轮询等 `doc-preview-meta` / `doc-preview-error` 出现。
> 复跑 → 29/29。**可迁移规则：e2e 界面断言不要用固定 sleep 当同步手段。**

### 4.3 phase3o 复验：**44/44 全绿**（改测试脚本后单跑）

### 4.4 回归

**驱动**：`C:\Temp\ecclaw-verify\rerun-and-regress5.cjs`（产物前缀 **run53-\***）
**套件**（数字逐条取自 `C:\Temp\ecclaw-verify\run53-summary.txt` 实测，非预期值）：

| 套件 | PASS | FAIL |
|---|---|---|
| phase3v | 29 | 0 |
| phase3u | 24 | 0 |
| phase3t | 16 | 0 |
| phase3r | 31 | 0 |
| phase3p | 45 | 0 |
| phase3o | 44 | 0 |
| phase3m | 69 | 0 |
| sse | 14 | 0 |

**未跑**：phase3s 49 / phase3q 26 —— **本阶段红线「不碰淘宝」**（这两套是真站写操作套件），已在 `run53-summary.txt` 末行注明。

> 收官数字只认 `C:/Temp/ecclaw-verify/run53-summary.txt`。

---

## 5. 环境基线（收官时实测）

| 项 | 值 |
|---|---|
| 平台 | Windows 11 Pro 10.0.26300（shell = bash / Git Bash） |
| 项目根 | `F:\soft\00selfmade\ecclaw`（**非 git 仓库**） |
| Node / pnpm | 系统 node v26.13.0；**Electron 内 Node = v24.22.1**（支持 `require(ESM)`） |
| Electron | `npx electron . --remote-debugging-port=9222` |
| userData | `C:\Users\Duanyi\AppData\Roaming\ecclaw` |
| stateDir | `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw` |
| 文件库 | `<stateDir>\file-library\files`（平铺文件） |
| 夹具 | 8898 `fixture-server.cjs` · 8897 `fixture-writer.cjs` |
| CDP | `http://127.0.0.1:9222` |
| 新依赖 | `pdfjs-dist@6.5.438`（已在 `package.json` dependencies） |

**e2e 遗留物**（本轮写进用户文件库，**只增不删**，需要清理时由用户自己动手）：
`<stateDir>\file-library\files\` 下 4 个 `ecclaw-phase3v-*` 文件（报价单.pdf / sample.pdf / broken.pdf / note.txt）。

---

## 6. 复现命令

```bash
cd /f/soft/00selfmade/ecclaw && pnpm typecheck && pnpm build

cd /c/Temp/ecclaw-verify && node fixture-server.cjs &   # 8898（phase3m 回归还需 8897）
node C:/Temp/ecclaw-verify/stop-electron.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Temp/ecclaw-verify/start-electron.ps1"

node C:/Temp/ecclaw-verify/phase3v-e2e.cjs \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs" \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json"
node C:/Temp/ecclaw-verify/phase3o-e2e.cjs <hostServer> <bridge>   # 44
node C:/Temp/ecclaw-verify/rerun-and-regress5.cjs                   # run53-*
```

**收尾**：`node C:/Temp/ecclaw-verify/stop-electron.cjs`（优雅关）+ 按**精确 PID** 停夹具（禁通配符）。

---

## 7. 文档补齐（**本轮收官时已全部写入，下列为留档正文**）

> 已落地位置：README §5.25（新增小节）· README §8「已实现（实验）」追加两条（phase3u 灰度 + phase3v 预览）
> 与「真机实测」追加 phase3v 数字段 · README「未实现（第二阶段候选）」修正 ·
> `task.md` 顶部状态段 + **第二十阶段表** + **第二十一阶段表** + 实证发现 6 条 ·
> 记忆 `memory/ecclaw_phase3v_document_preview.md` + `MEMORY.md` 索引一行。

### 7.1 README §5.25（插在 §5.24 之后、`## 6. 技能与文件库` 之前）

```markdown
### 5.25 文档预览（先 PDF）

文件库里的 **PDF** 现在可以直接看：点文件 → 抽页数 + 逐页文本；agent 也能读（新增只读 MCP 工具）。

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
```

### 7.2 README §8 状态段（在「**已实现（实验）**」列表末尾追加一条）

```markdown
**文档预览（先 PDF）**（文件库 PDF → 页数 + 逐页文本，界面可看、agent 可读；新增只读工具
`ecclaw_document_preview`，MCP 工具 26 → 27，见 §5.25）、
```

### 7.3 task.md

- 顶部状态段：补「第二十一阶段：文档预览（先 PDF）已交付」+ 实测数字（取 `run53-summary.txt`）。
- 补**第二十阶段表**（远程包仓库灰度发布，phase3u：rollout 字段 / clientId 分桶 / 安装二次准入 / 5 个文件改动）——
  **上一轮因上下文见底跳过了，本轮补上**。
- 补**第二十一阶段表**（phase3v，8 行：新模块 / 类型 / IPC / preload / 桥 op / MCP 工具 / 界面 / 依赖）。
- 「实证发现」补 3 条：
  1. `ecclaw_event_replay` 的 `limit` 截断的是**seq 最小的前 N 条** → 任何「取最大值」的断言都要直读磁盘作地面真相（phase3o 假红根因）。
  2. 主进程（CJS 产物）要用 ESM-only 依赖：`createRequire` + Electron 的 Node 24 `require(ESM)`；或把它排出 externalize。
  3. PDF 抽文本必须 NFKC 归一化，否则康熙部首字会让 agent 读到乱码。

### 7.4 项目记忆

- 新建 `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\ecclaw_phase3v_document_preview.md`
  （type: project；含 phase3o 假红定性与 pdfjs/require(ESM) 经验）
- `MEMORY.md` 索引加一行：
  `- [ecclaw 第二十一阶段：文档预览（先 PDF）](ecclaw_phase3v_document_preview.md) — 回放 limit 截断语义致 phase3o 假红；pdfjs 在 CJS 主进程要 createRequire+require(ESM)；NFKC 归一化`

---

## 8. 红线（照旧，全量见 phase3r final §10）

- **禁删用户文件**（文件库里的 `ecclaw-phase3v-*` 是本轮 e2e 写的，**也留着别删**；`platform-packages` 旧版本、exports 均只增不删）。
- 禁 `git init` / `git commit`（项目非 git 仓库）。
- `openclaw.json`（明文 relay key）与 `host-bridge.json`（token）勿外传。
- Electron 内 spawn 内核/MCP 必须带 `ELECTRON_RUN_AS_NODE=1`；护栏默认 `ask`；别去掉 `persist:` 前缀。
- **真实站点只用 `scroll` 做写操作验证**；本阶段一律不碰淘宝（真站套件 phase3s / phase3q 未跑）。
- 临时产物写 `C:\Temp\`；记忆写 `memory/` 文件夹，**handoff / task 文档不得放进 memory 文件夹**。
- GUI 验证走 **CDP**（`--remote-debugging-port=9222`），不用 computer-use。
- **无人值守 e2e 期间提醒用户勿碰 GUI 卡片**。

---

## 9. 下一阶段候选（供 AskUserQuestion 拍板）

- **C-2 续作**：PDF **位图预览**（引 `@napi-rs/canvas` 或改走外部查看器）· Docx / Pptx / Xlsx 抽取。
- **C-3 邮件 worker**（含外发副作用 → 必须显式确认账号与收件人）。
- **C-4 画布宿主**（新的宿主页面类型 + 会引入新事件 kind）。
- **OCR**（图片转文字；依赖体积大）。
- **数据迁移框架**（导入导出 + 版本化）。
- **收尾欠账**：`run53` 的真站套件（phase3s / phase3q）本轮未跑 —— 需要时单独补一轮（且要先问过淘宝）。
