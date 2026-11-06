# handoff · ecclaw phase4t（final）· 2026-11-07

> 承接 `handoff-ecclaw-phase4t-wip-2026-11-07.md`（同一轮的中途交接）。
> 本轮做 **phase4t：图形内容轴**。状态：**实现完成 + 全套验证通过 + 已 commit**。

## 1. 基线

- 分支 `main`；基线 commit：功能 `f99ab3d`（phase4s）、文档 `3757813`。
- 本轮改动文件（已 commit）：
  `electron/main/document-preview.ts`（唯一产品代码文件）、
  `README.md`、`task.md`、`handoff-ecclaw-phase4t-final-2026-11-07.md`、`prompt-ecclaw-phase4t-next.md`。
- 仓库根另有 3 个本轮之前就存在的未跟踪文件：`handoff-2026-11-06.md` / `handoff-2026-11-07.md` /
  `prompt-ecclaw-phase4p-next.md` —— **禁止 `git add -A`**。
- 契约不动：MCP 工具数保持 **27**，无新增依赖，`electron/main/host-bridge.ts` /
  `host-server.mjs` / `src/App.tsx` 未动。

## 2. 本轮范围（用户已确认的设计）

4 组全做，图表深度 = **标题 + 系列名**（不含坐标轴标题 / 类别 / 数值），落位 = **就地内联**：

| 组 | 内容 | 输出标记 | 落位 |
|---|---|---|---|
| B | 三格式图表 chart parts 文本化 | `[图表: 标题 · 系列1, 系列2]` | DOCX 图表所在段落 / PPTX graphicFrame 位置 / XLSX 工作表末尾 |
| 新轴 | SmartArt 文本 | `[SmartArt: 节点1, 节点2]` | 同上 |
| 新轴 | XLSX 数据透视表 | `[透视表: 名称 · 字段: …]` | 工作表末尾 |
| 新轴 | PPTX 现代线程批注**回复** | 根 `[批注(作者): 正文]` + 回复 `[回复(作者): 正文]` | 形状挂载处 / 页末孤儿处 |

## 3. 实现要点（全部在 `electron/main/document-preview.ts`）

### 3.1 新增共享解析层（`/* ---- PPTX / XLSX 抽取 ---- */` 之前）

- `xmlElements(xml, local, prefixes?)`：按**本地名**取元素（忽略命名空间前缀），不限深度；
  自闭合记空体；同名嵌套按栈配对；`prefixes` 可限定前缀（`'a'` = DrawingML 文本节点）。
- `joinXmlTexts(fragment)`：片段里所有 `<a:t>` 拼起来（只收前缀 `a` 或无前缀）。
- `firstXmlText(els)`、**`parseChartInfo(xml, resolveFormula?)`** → `{ title, series }`：
  - 标题只取**图表级** `c:title`（`c:plotArea` 之前那段）→ 坐标轴标题不算；
  - 标题认 `c:tx/c:rich` 富文本与 `c:tx/c:strRef` 缓存值；
  - 系列名取 `c:ser/c:tx`（`c:strRef` 缓存值或字面量 `c:v`）；
  - **`strRef` 无缓存值时按 `c:f` 公式回查**（`resolveFormula` 回调）。
- `chartMarker` / `smartArtMarker` / `pivotTableMarker`；`graphicRefMarks(xml, graphics)`
  （DOCX 段落与 PPTX graphicFrame 共用的引用扫描：`<c:chart r:id>` / `<dgm:relIds r:dm>`）。
- `parseChartFormula(formula)`：`'数据'!B1` / `Sheet1!$B$1` → `{ sheet, ref }`。

### 3.2 DOCX

- `DOCX_CHART_RE` / `DOCX_DIAGRAM_RE`；`DocxParts.graphics`；`DocxRenderCtx.graphics`；
  `docxGraphicMarkMap(rels, graphics)`（rels 类型 `/chart`、`/diagramData`）；`docxExtras` 末尾追加。

### 3.3 PPTX

- `PPTX_CHART_RE` / `PPTX_DIAGRAM_RE`；`PptxParts.graphics`；`PptxRenderCtx.graphics`；
  `pptxGraphicMarkMap(slide.rels, parts.graphics)`；`pptxTreeBlocks` 的 `p:graphicFrame` 分支追加标记。
- `PPTX_AUTHORS_RE` 放宽为 `/^ppt\/(?:[^/]*[Aa]uthor[^/]*\.xml|[Aa]uthors\/[^/]+\.xml)$/`
  （现代批注作者表在**演示者级** `/ppt/authors.xml`）。
- **`parsePptxComments` 重写**（两代真实写法都认）：
  - 注解版 ns `http://schemas.microsoft.com/office/powerpoint/2018/annotation`：回复是独立 `p188:cm`，
    用 `paraIdParent` 指回父批注；
  - 规范版 ns `http://schemas.microsoft.com/office/powerpoint/2018/8/main`：回复是 `p188:replyLst/p188:reply`；
  - 多级回复摊平挂根；父批注找不到 → 按独立批注输出（不猜）；
    `p188:replyLst` 先从根批注正文里摘掉，避免正文与回复文字粘连。
- `PptxComment` 加 `replies`；新增 `pptxCommentMarks(c)` 统一出 `[批注(…)]` / `[回复(…)]`，
  两个发射点（形状挂载、页面末尾孤儿）都改用它。

### 3.4 XLSX

- `XLSX_CHART_RE` / `XLSX_DRAWING_RE` / `XLSX_DRAWING_RELS_RE` / `XLSX_PIVOT_RE`；
  `xlsxSheetGraphics(sheetXml, relEntries, entries, resolveFormula?)`：
  - 图表走**两层关系**：工作表 → `xl/drawings/drawingN.xml` → `xl/charts/chartN.xml`；
  - 透视表一层：工作表 rels → `xl/pivotTables/pivotTableN.xml`（靠 sheet 的 `<pivotTablePart r:id>`）。
- `extractXlsxText()` 改成**两趟**：第一趟解析全部工作表并攒**全工作簿单元格索引**
  （`表名!A1` → 单元格文本；`parseXlsxSheet` 新增可选出参 `cellMap`），
  第二趟才出块并挂图表 / 透视表标记 → `strRef` 无缓存值时能回查系列名。
- 新增 `colLetters(col)`（列号 → 字母）。

## 4. 验证（全部通过）

**编译**（必须在项目根跑）：
```
cd F:/soft/00selfmade/ecclaw && npx tsc electron/main/document-preview.ts electron/main/paths.ts electron/shared/types.ts --rootDir electron --outDir C:/Temp/ecclaw-verify/tsout --module commonjs --target es2022 --lib es2022,dom --esModuleInterop --skipLibCheck
```
→ 0 error，产物 `C:/Temp/ecclaw-verify/tsout/main/document-preview.js`。

**自测**：`phase4t-selftest.cjs` **26/26**（7 组：三格式图表 / 真结构与边界 / SmartArt /
透视表 / 线程批注 / 负向逐字一致 / 坏部件容错）。

**e2e**：`phase4t-e2e.cjs` **29/29**（工具面 27 / 抽取 20 条 / 界面 3 条）。

**旧自测全绿**：4a~4d JSON 全 true；4e 33/33、4f 38/38、4g 55/55、4h 42、4i 47、4j 30、
4k 27、4l 41、4m 72/72、4n 74/74、4o 17/17、4p 18、4q 23、4r 19、4s 45/45。

**全量回归**：`run78-*` 三十一套（`rerun-and-regress78.cjs`）——
唯一失败 **phase3r C3**「summary 不带 kinds 时按全量聚合」，是**事件库 >2000 条的既有环境失败**
（run77 同样失败，绝对计数随事件累积漂移：1410 → 1439），与 phase4t 无关。

**`pnpm typecheck` / `pnpm build`**：均通过（build 后已重启 Electron 做真机 e2e）。

## 5. 产物清单（都在 `C:/Temp/ecclaw-verify/`）

- `phase4t-selftest.cjs`（26/26）、`phase4t-e2e.cjs`（29/29）、`rerun-and-regress78.cjs`。
- `phase4t-make4.cjs`（补正夹具 `sa3.pptx` / `pv2.xlsx` / `mc2.pptx` / `mc3.pptx` + 探针）；
  沿用 `phase4t-make.py` / `phase4t-make2.cjs` / `phase4t-make3.cjs` /
  `phase4t-probe.cjs` / `phase4t-probe2.cjs`。
- 夹具目录：`st4t/`（含 sa3/pv2/mc2/mc3）、`probe4p/`。
- 回归产物：`run78-summary.txt`、`run78-*.log`。

## 6. 已知「❌」是夹具 / 伪结构，不是 bug（别去追）

- `mc1.pptx`：用了 `mc:AlternateContent` + `ppt/threadedComments/threadedComment_1.xml`。
  **真实 PPTX 现代批注不在这个部件里**：正文在 `ppt/comments/modernComment_1.xml` 的 `p188:cm`，
  作者表在**演示者级** `/ppt/authors.xml`。
- `sa1.pptx`：zip 里没有 `ppt/slides/_rels/slide1.xml.rels`，`r:dm="rId5"` 悬空 → 不出标记。
- `pv1.xlsx`：`xl/pivotTables/pivotTable1.xml` 是孤儿部件，sheet 里没有 `<pivotTableParts>`。
- `sd1.docx`：`w:sdt` 的 `w:tag`（`cust_name`）未命中 —— 低价值，**不要顺手做**。

**结构依据（可复查）**：
- `OfficeDev/open-xml-docs` → `docs/includes/presentation/modern-comment-description.md`；
- `iOfficeAI/OfficeCLI` → `src/officecli/Handlers/Pptx/PowerPointHandler.ModernComments.cs`；
- `dotnet/Open-XML-SDK` → `data/typed/schemas_microsoft_com_office_powerpoint_2018_8_main.json`。

## 7. 下轮候选（**清单照例会过期，先探针复验再选题**）

1. **图表深度**（本轮明确排除的部分）：坐标轴标题、类别名、数值 —— 用户若要，可单独一轮。
2. **DOCX 内容控件** `w:sdt`：`w:tag` / `w:alias`（`sd1.docx` 已备好夹具，低价值）。
3. **PPTX 图形剩余**：图表**数值缓存**、`ppt/media` 图片 alt、layout / master 继承文本。
4. **XLSX 剩余**：数组公式 / 动态数组（`cm=` / `t="array"`）、外部链接与断链、
   工作表可见性（hidden / veryHidden）、图表的类别与数值。
5. **DOCX 剩余**：自定义 XML 部件、OLE 嵌入对象、页眉页脚非占位符内容。

## 8. 避坑

- `previewDocument` 只收**文件库内路径** → DOCX 无导出函数，夹具必须拷进
  `fake-userdata/openclaw/.openclaw/file-library/files`；XLSX 也可直调 `extractXlsxText(path)`。
- **旧套件的位置锁死断言会过期**：本轮给 DOCX 段落 / PPTX 页 / XLSX 工作表**追加了行**，
  回头检查旧套件有没有锁死行号（phase4o 曾因此假红过一次）。
- `xmlElements` 与 `xmlChildElements` 语义不同：前者不限深度、按本地名；
  后者只取**直接子级**、按固定容器标签。新代码别混用。
- `joinXmlTexts` 只收前缀 `a` 或无前缀的 `t` —— 否则 `<dgm:t>` 会把内层 XML 当文字取出来。
- **改主进程后必须 `pnpm build`**（Electron 跑 `out/main/index.js`）；起前
  `taskkill //F //IM electron.exe`，9222 单实例。
- ctx 预算：`ctx-budget-guard` 在 **160K 硬阻断**（只放行 Write/Edit）。被拦时唯一正确动作：
  写 `handoff-<topic>-<date>.md` + `prompt-<topic>-next.md` 后开新会话。
