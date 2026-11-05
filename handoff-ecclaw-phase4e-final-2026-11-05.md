# handoff · ecclaw 第三十阶段（phase4e）· PDF 多页缩略图 / 指定页渲染参数 · 2026-11-05

> **一句话结论**：PDF 预览补上**多页缩略图导航条**与**指定页 / 缩放渲染参数** ——
> 缩略图以当前页为中心的连续 12 页、点击切页、窗口随当前页滑动；
> 页码输入跳转 + 缩放七档（50/75/100/150/200/300%）。
> 工具数仍 **27**，`ecclaw_document_preview` 参数与描述**一字未改**，位图仍**只给界面**、不返回 agent。
> 秒级自测 **33/33**、**phase4e e2e 21/21**、typecheck/build ✅。
>
> **本轮状态**：实现、自测、e2e、README §5.34、task.md 表格、项目记忆**均已完成**；
> **全量回归 run63 十七套 524/524 全绿**（见 §4）。
> **已提交**：`dade022`（feat），本 handoff 的 hash 回填用 `docs:` 小提交补记（不 amend）。

---

## 1. 本轮必读顺序

1. 本文档
2. `handoff-ecclaw-phase4d-final-2026-11-05.md`（上一阶段：XLSX 科学计数法 / 分数格式）
3. `README.md` §5.29（Excel 显示样式）· **§5.34（本轮）**
4. `task.md` 顶部状态段 + 第三十阶段表
5. `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\ecclaw_phase4e_pdf_thumbs.md`

---

## 2. 交付清单

| 文件 | 改动 |
|---|---|
| `electron/main/document-preview.ts` | ①抽出 `openPdfDoc()` 复用解析；②抽出 `renderPdfPageToPng()`；③新增 `renderDocumentThumbs()`（按目标宽度归一、铺白底、最多 24 张、过滤非法页码）；④新增常量 `THUMB_WIDTH/MIN_THUMB_WIDTH/MAX_THUMB_WIDTH/MAX_THUMBS`；⑤`Canvas2D` 补 `fillStyle` / `fillRect` |
| `electron/shared/types.ts` | 新增 `DocumentPageThumbs`；`EcclawApi.files` 加 `renderPage(path, page?, scale?)` + `renderThumbs(path, pages?, width?)` |
| `electron/preload/index.ts` | `renderPage` 加 `scale` 透传；新增 `renderThumbs` |
| `electron/main/index.ts` | `files:preview-image` 加 `scale`；新增 `files:preview-thumbs` |
| `src/App.tsx` | 缩略图条 + 页码跳转 + 缩放选择；缩略图缓存（`thumbsRef`）；窗口跟随当前页 |
| `src/styles.css` | `.doc-preview-pdf` / `.doc-preview-toolbar` / `.doc-preview-thumbs` / `.doc-preview-thumb` 等样式 |
| `src/api.ts` | 类型再导出加 `DocumentPageThumbs` |
| `README.md` | 新增 §5.34；底部能力清单补一条 |
| `task.md` | 顶部状态段 + 新增「第三十阶段」表 + 实证发现 6 条 |
| `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/` | 新增 `ecclaw_phase4e_pdf_thumbs.md`；`MEMORY.md` 加索引 |

### 临时资产（`C:\Temp\ecclaw-verify\`）

- `make-phase4e-fixtures.cjs`（生成 `multipage.pdf`：**30 页**，A4 595 / Letter 612 **混排**，每页文字 `PHASE4E PAGE <英文序数>`）
- `phase4e-selftest.cjs`（不走 Electron，**33 项**）
- `phase4e-e2e.cjs`（**21 条断言**：工具面 3 · 抽取 4 · 界面 13 · 不报错 1）
- `rerun-and-regress14.cjs`（**run63-\*** 驱动，17 套，不跑真站）
- `run63-summary.txt`（十七套摘要）· `run63-phase4e.log`（本轮 e2e 产物）
- `dbg4e.cjs`（临时调试脚本：CDP 点缩略图看 meta 变化；**可删**）
- `tsout/`（tsc 单文件转译产物；`tsout/node_modules/electron/index.js` 是 electron 桩，`getAppPath()` 指向项目根）

---

## 3. 关键设计决策

1. **缩略图按「目标宽度」归一，不按固定 scale**：PDF 页面尺寸不一（A4 595 / Letter 612 / 横向），
   固定 scale 渲出来宽窄不一、排不齐。做法：先取 `scale:1` 的 viewport 拿原始宽度，
   再用 `width / base.width` 反推 scale。宽度一致后高度按各页高宽比走 → 缩略图高度仍有轻微差异。
2. **画布尺寸用 `round` 而不是 `ceil`**：`scale` 是除法算出来的，`viewport.width` 常是
   `400.00000000000006` 这种值，`ceil` 顶成 **401** → 缩略图比目标宽 1 px，宽度就不归一了。
3. **PDF 页面本身透明**：不先 `fillStyle` + `fillRect` 铺白底，缩略图一片黑。
   （大图 `renderDocumentPage` 沿用旧行为不铺底 —— PNG 透明在浏览器里本来就是白底，不改既有输出。）
4. **缩略图窗口跟随当前页**：固定「前 N 页」对 30 页以上的文档等于没有导航 →
   窗口取「以当前页为中心的连续 12 页」，翻页/跳转后自动挪。
5. **缓存判断不能等 React 提交**：`setState` 的 updater 里读 `prev` 判断「缺哪几页」会读到旧值 →
   用 `thumbsRef` **同步**记缓存、`setState` 只负责渲染（两处都写）。
   主进程每渲染一次都要重解 PDF，所以复用很值。
6. **位图仍只给界面**：`ecclaw_document_preview` 的参数与描述一字未改，
   agent 侧拿到的还是纯文本 —— base64 不进模型上下文。
7. **越界一律夹住而不是报错**：页码夹到 `[1, numPages]`，缩放夹到 `[0.5, 3]`，
   缩略图宽度夹到 `[48, 400]`；非法页码（0 / 负数 / 非有限）直接从请求列表里剔除。

---

## 4. 验证证据（实测）

- `pnpm typecheck` ✅ / `pnpm build` ✅
  （renderer `out/renderer/assets/index-Dr7bMJlL.js` 663.96 kB、`index-DKKMPSXB.css` 7.98 kB）
- **秒级自测**（`phase4e-selftest.cjs`，直调 `previewDocument` / `renderDocumentPage` / `renderDocumentThumbs`）：**33/33**
  —— kind/pageCount/pages 长度 3 · 每页文字 2 · 预览不报错 1 ·
  单页渲染（宽度 595/612、scale 翻倍、页码越界夹 30、页码 0 夹 1、scale 上限 3、下限 0.5、默认 1.5、
  png data URL、不同页内容不同）9 ·
  缩略图（数量 3、pageCount、页码顺序、A4/Letter 两页都归一到 132、高度比、默认宽度、内容不同、
  不给页码取前 24 张、从第 1 页起、非法页码过滤、宽度上限 400、下限 48、一次最多 24 张）15 ·
  非 PDF 被拒 2。
- **phase4e e2e：21/21**（工具面 3 · 抽取 4 · 界面 13 · 不报错 1），产物 `run63-phase4e.log`
  —— 界面侧实测到的关键值：
  第 1 页 `893×1263`（A4 595 × 1.5）→ 点缩略图切到第 3 页 → 「下一页」到第 4 页（`918×1188`，Letter 612 × 1.5）
  → 页码输入 20 + 跳转 → 第 20 页 → 缩放 200% → `1224×1584`（612 × 2）；缩略图条 12 张、第 1 张 `data-active=true`。
- **全量回归 run63：十七套 524/524 全绿**（FAIL 全 0），摘要 `C:\Temp\ecclaw-verify\run63-summary.txt`：
  phase4e 21 · phase4d 31 · phase4c 26 · phase4b 18 · phase4a 20 · phase3z 37 · phase3y 31 ·
  phase3x 41 · phase3w 27 · phase3v 29 · phase3u 24 · phase3t 16 · phase3r 31 · phase3p 45 ·
  phase3o 44 · phase3m 69 · sse 14。
  **未跑真站套件 phase3s / phase3q**（红线「不碰淘宝」）。

> ⚠ **若 `run63-summary.txt` 与上表不符，以文件为准**，并回填本节 + `task.md` 第三十阶段表第 6 行。

---

## 5. 环境基线

| 项 | 值 |
|---|---|
| 项目根 | `F:\soft\00selfmade\ecclaw`（**已是 git 仓库**，上一阶段提交 `d896d85` / `15e36b7`） |
| 新依赖 | **无**（沿用 `fflate@0.8.3` + `pdfjs-dist` + `@napi-rs/canvas`） |
| stateDir | `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw` |
| MCP 工具数 | **27**（本轮未新增） |
| e2e 遗留物 | 文件库新增 `ecclaw-phase4e-多页.pdf`（只增不删） |

---

## 6. 复现命令

```bash
cd /f/soft/00selfmade/ecclaw && pnpm typecheck && pnpm build
node C:/Temp/ecclaw-verify/make-phase4e-fixtures.cjs
pnpm exec tsc electron/main/document-preview.ts electron/main/paths.ts electron/shared/types.ts --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron --module commonjs --target ES2022 --moduleResolution node --esModuleInterop --skipLibCheck
NODE_PATH=F:/soft/00selfmade/ecclaw/node_modules node C:/Temp/ecclaw-verify/phase4e-selftest.cjs
node C:/Temp/ecclaw-verify/stop-electron.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Temp/ecclaw-verify/start-electron.ps1"
node C:/Temp/ecclaw-verify/phase4e-e2e.cjs "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs" "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json"
node C:/Temp/ecclaw-verify/rerun-and-regress14.cjs   # run63-*
```

> 改主进程代码必须重启 Electron；`stop-electron.cjs` 的 fetch 报错是正常现象。
> 等 CDP 就绪请用 `node -e "fetch('http://127.0.0.1:9222/json/list')..."`（这台机的 git-bash 不一定有 `curl`）。
> e2e 输出别用 `| tail` 包（管道会缓冲到结束才落盘，看起来像卡死）。

---

## 7. 红线（照旧）

- 禁删用户文件；e2e 写进文件库的 `ecclaw-phase4e-多页.pdf` 留着别删。
- `openclaw.json` / `host-bridge.json` 勿外传，且**不得提交**（真实路径在 stateDir，不在仓库根）。
- 本阶段不碰淘宝（phase3s / phase3q 未跑）。
- 临时产物写 `C:\Temp\`；handoff/task 不进 `memory/`。
- GUI 验证走 CDP；无人值守 e2e 期间勿碰 GUI 卡片。
- 提交只 `git add` 精确文件，**禁止 `git add -A`**。

---

## 8. 下一阶段候选

- 邮件 worker（外发副作用，需显式确认）。
- 画布宿主（新事件 kind）。
- 条件格式扩展：top10 / aboveAverage / duplicateValues / dataBar 区间文字标注（图形类仍不建议硬算）。
- XLSX 余量：单位/工程/会计格式、日期格式的 `mmm` 之外本地化。
- PDF 余量：缩略图窗口大小可调、缩略图懒加载、PDF 目录（outline）跳转、页码范围抽取（agent 侧 `startPage`）。
- 欠账：真站套件 phase3s / phase3q（需先问过淘宝）。

---

## 9. 提交记录

| 提交 | 内容 |
|---|---|
| `dade022` | `feat(document-preview): add PDF page thumbnails and render controls` —— 11 files changed, 608 insertions(+), 64 deletions(-) |

已精确 `git add` 下列 11 个文件提交（**未用 `git add -A`**）：

| 文件 | 说明 |
|---|---|
| `F:\soft\00selfmade\ecclaw\electron\main\document-preview.ts` | 缩略图渲染 + `openPdfDoc` 抽取 |
| `F:\soft\00selfmade\ecclaw\electron\shared\types.ts` | `DocumentPageThumbs` + `files` 契约 |
| `F:\soft\00selfmade\ecclaw\electron\preload\index.ts` | `renderPage(scale)` + `renderThumbs` |
| `F:\soft\00selfmade\ecclaw\electron\main\index.ts` | 两个 IPC handler |
| `F:\soft\00selfmade\ecclaw\src\App.tsx` | 缩略图条 / 页码跳转 / 缩放 |
| `F:\soft\00selfmade\ecclaw\src\styles.css` | 预览样式 |
| `F:\soft\00selfmade\ecclaw\src\api.ts` | 类型再导出 |
| `F:\soft\00selfmade\ecclaw\README.md` | §5.34 + 能力清单 |
| `F:\soft\00selfmade\ecclaw\task.md` | 第三十阶段表 + 顶部状态段 |
| `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase4e-final-2026-11-05.md` | 本文档 |
| `F:\soft\00selfmade\ecclaw\prompt-ecclaw-phase4e-next.md` | 接力指针 |

**未提交**：`node_modules/`、`out/`、`C:\Temp\ecclaw-verify\*`（不在仓库内）、
`openclaw.json` / `host-bridge.json`（在 stateDir）、任何 `.env` / 密钥。

---

## 10. 收尾清单

1. ✅ 主进程 `renderDocumentThumbs` + `openPdfDoc` 抽取 + 白底 + 宽度归一（round 非 ceil）
2. ✅ IPC / preload / types 打通（`scale` + `renderThumbs`）
3. ✅ 界面：缩略图条（窗口跟随当前页 + 缓存）、页码输入跳转、缩放七档
4. ✅ `pnpm typecheck` ✅ / `pnpm build` ✅
5. ✅ 秒级自测 `phase4e-selftest.cjs` **33/33**
6. ✅ `phase4e-e2e.cjs` **21/21**
7. ✅ 全量回归 run63 十七套 **524/524**（摘要 `run63-summary.txt`；未跑真站 phase3s/3q）
8. ✅ README §5.34 + 能力清单；task.md 第三十阶段表 + 顶部状态段；项目记忆 `ecclaw_phase4e_pdf_thumbs.md` + `MEMORY.md` 索引
9. ✅ `prompt-ecclaw-phase4e-next.md`（<30 行，只做接力指针）
10. ✅ **git commit 已执行** —— `dade022`（11 files, +608/−64），hash 已回填 §9
