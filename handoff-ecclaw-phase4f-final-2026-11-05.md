# handoff · ecclaw 第三十一阶段（phase4f）· PDF 目录导航 / 页码范围抽取 · 2026-11-05

> **一句话结论**：PDF 预览补上**目录（书签）面板**（点目录项直接跳页）；
> agent 侧 `ecclaw_document_preview` 补上**页码范围抽取**（`startPage` / `endPage`，越界夹住）。
> 工具数仍 **27**（未新增工具，只加了两个**可选**参数），无新增依赖。
> 秒级自测 **38/38**、**phase4f e2e 26/26**、**run64 十八套 550/550 全绿**、typecheck/build ✅。

---

## 1. 本轮必读顺序

1. 本文档
2. `handoff-ecclaw-phase4e-final-2026-11-05.md`（上一阶段：PDF 缩略图 / 缩放）
3. `README.md` §5.34（缩略图）· **§5.35（本轮）**
4. `task.md` 顶部状态段 + 第三十一阶段表
5. `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\ecclaw_phase4f_pdf_outline.md`

---

## 2. 交付清单

| 文件 | 改动 |
|---|---|
| `electron/main/document-preview.ts` | ①`PdfDocument` 接口增可选 `getOutline?` / `getDestination?` / `getPageIndex?`，新增 `PdfOutlineItem`；②新增 `clampInt(value, fallback, min, max)`；③新增 `outlineDestPage(doc, dest)` + `readPdfOutline(doc)`（限深 `MAX_OUTLINE_DEPTH = 8`）；④`previewDocument()` 增 `startPage` / `endPage`，返回带 `pageStart` / `pageEnd` / `outline`，范围未覆盖全文时 `truncated = true` |
| `electron/shared/types.ts` | 新增 `DocumentOutlineNode { title, page: number \| null, children }`；`DocumentPreview` 增 `pageStart?` / `pageEnd?` / `outline?` |
| `electron/main/host-bridge.ts` | `document-preview` 分支透传 `startPage` / `endPage` |
| `resources/mcp/host-server.mjs` | `ecclaw_document_preview` 描述补「outline 目录 / startPage / endPage」；`inputSchema` 增两个**可选** number 参数；调用处透传。**工具数仍 27，仍无必填参数** |
| `src/App.tsx` | 新增 `flattenOutline()`；PDF 预览顶部渲染目录面板（`data-testid="doc-preview-outline"`，条目 `doc-preview-outline-{i}`，带 `data-page` / `data-depth`）；点目录项 → `showPage(path, page)` |
| `src/styles.css` | `.doc-preview-outline*` 配套样式 |
| `src/api.ts` | 再导出 `DocumentOutlineNode` |
| `README.md` | 新增 §5.35；底部能力清单补一条 |
| `task.md` | 顶部状态段 + 新增「第三十一阶段」表 + 实证发现 7 条 |
| `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/` | 新增 `ecclaw_phase4f_pdf_outline.md`；`MEMORY.md` 加索引 |
| `handoff-ecclaw-phase4f-final-2026-11-05.md` | 本文档 |
| `prompt-ecclaw-phase4f-next.md` | 接力指针（<30 行） |

### 临时资产（`C:\Temp\ecclaw-verify\`）

- `make-phase4f-fixtures.cjs` → `outlined.pdf`（**6 页**，两级书签：Chapter One→p1 [Section 1.1→p2, Section 1.2→p3]、Chapter Two→p4、Appendix→p6）
  + `plain.pdf`（**3 页**，无书签）。手写 PDF 对象：页对象 `4+2*(i-1)`，书签根 `3+2N+1`。
- `phase4f-selftest.cjs`（不走 Electron，**38 项**）
- `phase4f-e2e.cjs`（**26 条断言**：工具面 5 · 抽取 11 · 界面 9 · 不报错 2）
- `rerun-and-regress15.cjs`（**run64-\*** 驱动，18 套，不跑真站）
- `run64-summary.txt`（十八套摘要）· `run64-phase4f.log`（本轮 e2e 产物）· `run64-phase3v.log`（复跑产物）
- `tsout/`（tsc 单文件转译产物）

---

## 3. 关键设计决策

1. **夹页码时两个端点的默认值必须分开**：`clampInt(value, fallback, min, max)` ——
   `startPage` 不给 → fallback = 1；`endPage` 不给 → fallback = **total**（最后一页）。
   早先两端共用同一个「非法值退回 min」→ `endPage` 不给时退回第 1 页，**整篇只剩 1 页**（秒级自测一轮抓出 6 条红）。
2. **书签目标页解析不出来就置 `page = null`，不猜**：猜错了点一下会跳到别的页，**比不跳更糟**。
   解析不出 → 面板里该项不跳页。
3. **目录是加分项，不能拖累正文**：outline 解析失败一律当「没有目录」，**绝不让整份预览失败**。
4. **目录树先摊平成带层级的扁平列表再渲染**：递归组件不好定位（测试没法按序号点），
   摊平后既能按缩进显示层级，也能按序号稳定定位。
5. **用 pdfjs 现成能力，不自己解析 xref**：`getOutline()` + `getPageIndex()` 直接给页码；
   自己按对象号反推页序反而容易错（**对象号 ≠ 页序**）。
6. **`pageStart` / `pageEnd` 一并回传**：agent 侧才知道自己拿到的到底是哪一段；`truncated` 如实标记内容不完整。
7. **不新增 MCP 工具**：只给 `ecclaw_document_preview` 加**两个可选参数** → 工具数仍 27，仍无必填参数。

---

## 4. 验证证据（实测）

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 两遍均无错 |
| `pnpm build` | ✅ renderer `out/renderer/assets/index-wunPmYW7.js` 665.75 kB、`index-BNztoMKE.css` 8.97 kB |
| 秒级自测 `phase4f-selftest.cjs` | **38/38** |
| e2e `phase4f-e2e.cjs` | **26/26**（工具面 5 / 抽取 11 / 界面 9 / 不报错 2），产物 `run64-phase4f.log` |
| 全量回归 run64 十八套 | **550/550 全绿**（FAIL 全 0），摘要 `run64-summary.txt` |

回归明细（run64-\*）：phase4f 26 · 4e 21 · 4d 31 · 4c 26 · 4b 18 · 4a 20 · 3z 37 · 3y 31 · 3x 41 ·
3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14。
**未跑真站 phase3s / phase3q**（本阶段红线：不碰淘宝）。

**首轮唯一一条红 = 脚本 bug 而非产品 bug**：phase3v 断言
`document_preview 参数 = path/name/maxPages/maxChars（都可选）` 用 `props.length === 4` 把参数个数**写死**，
本轮新增 `startPage` / `endPage` 后必然红（实测 28/29）。
本轮 e2e 自己断言了这两个参数**存在**且范围抽取生效 → 产品侧没问题。
**只改脚本**（`=== 4` → `>= 4`，保留「四个老参数都还在」的原意，只去掉易碎的个数钉死），复跑 **29/29**。
教训：**断言「某参数存在」别断言「参数总数恰好是 N」**。

---

## 5. 环境基线

- 项目根：`F:\soft\00selfmade\ecclaw`（git 仓库）
- stateDir：`C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw`
- MCP 工具数：**27**
- 依赖：**无新增**
- 回归驱动：`C:\Temp\ecclaw-verify\rerun-and-regress15.cjs` → 产物前缀 `run64-*`

---

## 6. 复现命令

```bash
cd /f/soft/00selfmade/ecclaw && pnpm typecheck && pnpm build
node C:/Temp/ecclaw-verify/make-phase4f-fixtures.cjs
pnpm exec tsc electron/main/document-preview.ts electron/main/paths.ts electron/shared/types.ts \
  --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron --module commonjs --target ES2022 \
  --moduleResolution node --esModuleInterop --skipLibCheck
NODE_PATH=F:/soft/00selfmade/ecclaw/node_modules node C:/Temp/ecclaw-verify/phase4f-selftest.cjs
node C:/Temp/ecclaw-verify/stop-electron.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Temp/ecclaw-verify/start-electron.ps1"
node C:/Temp/ecclaw-verify/phase4f-e2e.cjs \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs" \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json"
node C:/Temp/ecclaw-verify/rerun-and-regress15.cjs
```

---

## 7. 红线（照旧）

- 禁删用户文件；e2e 写进文件库的 `ecclaw-phase4f-目录.pdf`、`ecclaw-phase4f-无目录.pdf`、
  `ecclaw-phase4e-多页.pdf` 都**留着别删**。
- `openclaw.json` / `host-bridge.json` 勿外传，且**不得提交**（真实路径在 stateDir，不在仓库根）。
- 本阶段**不碰淘宝**（phase3s / phase3q 未跑）。
- 临时产物写 `C:\Temp\`；handoff/task **不进** `memory/`。
- GUI 验证走 **CDP**（不要用 computer-use 截 Electron 屏）；无人值守 e2e 期间勿碰 GUI 卡片。
- 提交只 `git add` **精确文件**，**禁止 `git add -A`**。

---

## 8. 下一阶段候选

- 邮件 worker（外发副作用，需显式确认）。
- 画布宿主（新事件 kind）。
- 条件格式扩展：top10 / aboveAverage / duplicateValues / dataBar 区间文字标注（图形类仍不建议硬算）。
- XLSX 余量：单位/工程/会计格式、日期格式的 `mmm` 之外本地化。
- PDF 余量：缩略图窗口大小可调、缩略图懒加载、目录项页码为 `null` 时的降级提示。
- 欠账：真站套件 phase3s / phase3q（需先问过淘宝）。

---

## 9. 提交记录

| 提交 | 内容 |
|---|---|
| `9db8c51` | `feat(document-preview): add PDF outline navigation and page-range extraction` —— 11 files changed, 449 insertions(+), 12 deletions(-) |

已精确 `git add` 下列文件提交（**未用 `git add -A`**）：

| 文件 | 说明 |
|---|---|
| `F:\soft\00selfmade\ecclaw\electron\main\document-preview.ts` | 目录解析 + 页码范围抽取 |
| `F:\soft\00selfmade\ecclaw\electron\shared\types.ts` | `DocumentOutlineNode` + `DocumentPreview` 扩字段 |
| `F:\soft\00selfmade\ecclaw\electron\main\host-bridge.ts` | 透传 startPage / endPage |
| `F:\soft\00selfmade\ecclaw\resources\mcp\host-server.mjs` | 工具描述 + 两个可选参数 |
| `F:\soft\00selfmade\ecclaw\src\App.tsx` | 目录面板 + 跳页 |
| `F:\soft\00selfmade\ecclaw\src\styles.css` | 目录面板样式 |
| `F:\soft\00selfmade\ecclaw\src\api.ts` | 类型再导出 |
| `F:\soft\00selfmade\ecclaw\README.md` | §5.35 + 能力清单 |
| `F:\soft\00selfmade\ecclaw\task.md` | 第三十一阶段表 + 顶部状态段 |
| `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase4f-final-2026-11-05.md` | 本文档 |
| `F:\soft\00selfmade\ecclaw\prompt-ecclaw-phase4f-next.md` | 接力指针 |

**未提交**：`node_modules/`、`out/`、`C:\Temp\ecclaw-verify\*`（不在仓库内）、
`openclaw.json` / `host-bridge.json`（在 stateDir）、任何 `.env` / 密钥。

---

## 10. 收尾清单

1. ✅ 主进程 `readPdfOutline()` / `outlineDestPage()` / `clampInt()` + `previewDocument` 范围参数
2. ✅ 契约 / host-bridge / MCP 参数打通（工具数仍 27，仍无必填参数）
3. ✅ 界面：目录面板（摊平渲染 + 点击跳页）
4. ✅ `pnpm typecheck` ✅ / `pnpm build` ✅
5. ✅ 秒级自测 `phase4f-selftest.cjs` **38/38**
6. ✅ `phase4f-e2e.cjs` **26/26**
7. ✅ 全量回归 run64 十八套 **550/550**（摘要 `run64-summary.txt`；未跑真站 phase3s/3q）
8. ✅ README §5.35 + 能力清单；task.md 第三十一阶段表 + 顶部状态段；项目记忆 `ecclaw_phase4f_pdf_outline.md` + `MEMORY.md` 索引
9. ✅ `prompt-ecclaw-phase4f-next.md`（<30 行，只做接力指针）
10. ✅ **git commit 已执行** —— `9db8c51`（11 files, +449/−12），hash 已回填 §9
