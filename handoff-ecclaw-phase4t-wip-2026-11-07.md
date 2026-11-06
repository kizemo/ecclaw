# handoff · ecclaw phase4t（WIP）· 2026-11-07

> 承接 `handoff-ecclaw-phase4s-final-2026-11-07.md`。本轮做 **phase4t：图形内容轴**。
> 状态：**实现已写完并通过编译 + 全部旧自测；新自测已写但还没跑；e2e / 全量回归 / 收尾文档未做。**
> 上一个会话在写完 handoff 与 prompt 后被 ctx-budget-guard 160K 硬闸门拦下（只放行 Write/Edit），故必须**开新会话**继续。

## 1. 基线

- 分支 `main`；基线 commit：功能 `f99ab3d`（phase4s）、文档 `3757813`。
- 工作区改动：**只有 `electron/main/document-preview.ts` 被改**（未 commit）。
- 仓库根另有 3 个未跟踪文件（本轮之前就存在）：`handoff-2026-11-06.md` / `handoff-2026-11-07.md` / `prompt-ecclaw-phase4p-next.md`。**禁止 `git add -A`**。
- 契约不动：MCP 工具数保持 **27**，无新增依赖，`electron/main/host-bridge.ts` / `host-server.mjs` / `src/App.tsx` 未动。

## 2. 本轮范围（用户已确认的设计）

4 组全做，图表深度 = **标题 + 系列名**（不含坐标轴标题 / 类别 / 数值），落位 = **就地内联**：

| 组 | 内容 | 输出标记 |
|---|---|---|
| B | 三格式图表 chart parts 文本化 | `[图表: 标题 · 系列1, 系列2]` |
| 新轴 | SmartArt 文本 | `[SmartArt: 节点1, 节点2]` |
| 新轴 | XLSX 数据透视表 | `[透视表: 名称 · 字段: …]`（无字段则 `[透视表: 名称]`） |
| 新轴 | PPTX 现代线程批注**回复** | 根 `[批注(作者): 正文]` + 回复 `[回复(作者): 正文]`（与 DOCX/XLSX 既有口径一致） |

落位细则：DOCX 挂**图表所在段落**（段落无文字时自成一块）；PPTX 挂 **graphicFrame 所在位置**；XLSX 挂**所属工作表末尾**。

## 3. 已完成的代码改动（全部在 `electron/main/document-preview.ts`）

### 3.1 新增共享解析层（放在 `/* ---- PPTX / XLSX 抽取 ---- */` 之前）

- `xmlElements(xml, local, prefixes?)`：按**本地名**取元素（忽略命名空间前缀），不限深度；自闭合记空体；同名嵌套按栈配对；`prefixes` 可限定前缀（`'a'` = DrawingML 文本节点）。
- `joinXmlTexts(fragment)`：片段里所有 `<a:t>` 拼起来。
- `firstXmlText(els)`：第一个非空文本。
- `parseChartInfo(xml)` → `{ title, series }`：
  - 标题只取**图表级** `c:title`（在 `c:plotArea` 之前的那一段）→ 坐标轴标题（在 plotArea 内）不算；
  - 标题两种写法都认：`c:tx/c:rich` 富文本、`c:tx/c:strRef` 缓存值；
  - 系列名取 `c:ser/c:tx`：`c:strRef` 缓存值或字面量 `c:v`。
- `chartMarker` / `smartArtMarker` / `pivotTableMarker`：产出上面三种标记。
- `graphicRefMarks(xml, graphics)`：DOCX 段落 / PPTX graphicFrame **共用**的引用扫描（`<c:chart r:id>` / `<dgm:relIds r:dm>`）。

### 3.2 DOCX

- 新常量 `DOCX_CHART_RE = /^word\/charts\/chart\d*\.xml$/`、`DOCX_DIAGRAM_RE = /^word\/diagrams\/data\d*\.xml$/`。
- `DocxParts` 加 `graphics: Record<string, string>`；`readDocxParts` 多解这两类部件。
- `DocxRenderCtx` 加 `graphics: Map<string, string>`（r:id → 标记）；`docxGraphicMarkMap(rels, graphics)` 按 rels 类型 `/chart`、`/diagramData` 建映射。
- `docxExtras` 末尾追加图形标记。

### 3.3 PPTX

- 新常量 `PPTX_CHART_RE`、`PPTX_DIAGRAM_RE`。
- `PptxParts` 加 `graphics`；`readPptxParts` 多解图表/SmartArt 部件。
- `PptxRenderCtx` 加 `graphics`；`pptxGraphicMarkMap(slide.rels, parts.graphics)`（baseDir `ppt/slides`）。
- `pptxTreeBlocks` 的 `p:graphicFrame` 分支在表格后追加图表/SmartArt 标记。
- `PPTX_AUTHORS_RE` 放宽为 `/^ppt\/(?:[^/]*[Aa]uthor[^/]*\.xml|[Aa]uthors\/[^/]+\.xml)$/`（覆盖 `ppt/authors.xml` 与 `ppt/authors/p188.xml`）。
- **现代线程批注重写** `parsePptxComments`：两种真实写法都认
  - 注解版 `http://schemas.microsoft.com/office/powerpoint/2018/annotation`：回复是独立 `p188:cm`，用 `paraIdParent` 指回父批注；
  - 规范版 `http://schemas.microsoft.com/office/powerpoint/2018/8/main`：回复是 `p188:replyLst` 里的 `p188:reply`；
  - 多级回复**摊平挂根批注**；父批注找不到 → 按独立批注输出（不猜）；`p188:replyLst` 会先从根批注正文里摘掉，避免正文与回复文字粘连。
  - `PptxComment` 加 `replies: PptxComment[]`；新增 `pptxCommentMarks(c)` 统一出 `[批注(…)]` / `[回复(…)]`，两个发射点（形状挂载、页面末尾孤儿）都改用它。

### 3.4 XLSX

- 新常量 `XLSX_CHART_RE`、`XLSX_DRAWING_RE`、`XLSX_DRAWING_RELS_RE`、`XLSX_PIVOT_RE`。
- 新函数 `xlsxSheetGraphics(sheetXml, relEntries, entries)`：
  - 图表走**两层关系**：工作表 → `xl/drawings/drawingN.xml` → `xl/charts/chartN.xml`；
  - 透视表一层：工作表 → `xl/pivotTables/pivotTableN.xml`（靠 sheet 里的 `<pivotTablePart r:id>`）。
- `extractXlsxText` 结尾把两者挂在**工作表末尾**（数据校验行之后）。

## 4. 已跑的验证（全部通过）

**编译**（必须在项目根跑，口径同 phase4s handoff）：
```
cd F:/soft/00selfmade/ecclaw && npx tsc electron/main/document-preview.ts electron/main/paths.ts electron/shared/types.ts --rootDir electron --outDir C:/Temp/ecclaw-verify/tsout --module commonjs --target es2022 --lib es2022,dom --esModuleInterop --skipLibCheck
```
→ **0 error**，产物 `C:/Temp/ecclaw-verify/tsout/main/document-preview.js`。

**探针**（`NODE_PATH=F:/soft/00selfmade/ecclaw/node_modules`）：
- `phase4t-probe.cjs`（probe4p 的 b2/b4/b7）：DOCX/XLSX/PPTX 图表标题+系列名 **全命中**（之前 0 命中）。
- `phase4t-probe2.cjs`：`real2.pptx` / `real3.docx` 命中；`sa1.pptx` ❌（**旧夹具缺 slide rels，见 §6**）。
- `phase4t-make2.cjs`：`sa2.docx`（DOCX SmartArt）命中 ✅；`pv1.xlsx` ❌（**旧夹具缺 sheet rels + pivotTableParts，见 §6**）。
- `phase4t-make3.cjs`：`ch-ref` / `ch-notitle` / `ch-two` 三种图表边界 **全命中**；`mc1.pptx` ❌（**伪结构，见 §6**）。
- `phase4t-make4.cjs`（本轮新建的补正夹具）：`sa3.pptx` ✅、`pv2.xlsx` ✅、`mc2.pptx`（规范版回复）✅、`mc3.pptx`（注解版 paraIdParent）✅。

**旧自测全绿**（无回归）：4n 74/74、4o 17/17、4p 18、4q 23、4r 19、4s 45/45；4a~4d JSON 全 true；4e 33/33、4f 38/38、4g 55/55、4h 42、4i 47、4j 30、4k 27、4l 41、4m 72/72。

## 5. 产物清单（都在 `C:/Temp/ecclaw-verify/`）

- `phase4t-selftest.cjs` —— **本轮新写的自测，已写好但还没跑**（7 组：图表三格式 / 真结构与边界 / SmartArt / 透视表 / 线程批注 / 负向逐字一致 / 坏部件容错）。
- `phase4t-make4.cjs` —— 补正夹具 `sa3.pptx`（PPTX SmartArt 带 rels）、`pv2.xlsx`（透视表带 sheet rels + pivotTableParts）、`mc2.pptx`（规范版 p188:reply）、`mc3.pptx`（注解版 paraIdParent），并自带探针。
- `phase4t-make.py` / `phase4t-make2.cjs` / `phase4t-make3.cjs` / `phase4t-probe.cjs` / `phase4t-probe2.cjs` —— 沿用。
- 夹具目录：`st4t/`（含 sa3/pv2/mc2/mc3）、`probe4p/`。

## 6. 已知「❌」是夹具/伪结构，不是 bug（新会话别去追）

- `mc1.pptx`：用了 `mc:AlternateContent` + `ppt/threadedComments/threadedComment_1.xml`。**真实 PPTX 现代批注不在这个部件里**，正文在 `ppt/comments/modernComment_1.xml` 的 `p188:cm`，作者表在**演示者级** `/ppt/authors.xml`。该夹具永远出不来，属**伪缺口**。
- `sa1.pptx`：zip 里没有 `ppt/slides/_rels/slide1.xml.rels`，`r:dm="rId5"` 悬空 → 不出标记。真实 PPTX 必有该 rels（`sa3.pptx` 是补正的）。
- `pv1.xlsx`：`xl/pivotTables/pivotTable1.xml` 是孤儿部件，sheet 里没有 `<pivotTableParts>`、也没有 sheet rels。真实 XLSX 必有（`pv2.xlsx` 是补正的）。
- `sd1.docx`：`w:sdt` 的 `w:tag`（`cust_name`）未命中 —— 低价值，不在本轮范围，**不要顺手做**。

**结构依据（可复查）**：
- `OfficeDev/open-xml-docs` → `docs/includes/presentation/modern-comment-description.md`（`p188:cm` 的属性/子元素、示例 XML）。
- `iOfficeAI/OfficeCLI` → `src/officecli/Handlers/Pptx/PowerPointHandler.ModernComments.cs`（作者部件在 `/ppt/authors.xml`；回复在 `p188:replyLst` / `p188:reply`）。
- `dotnet/Open-XML-SDK` → `data/typed/schemas_microsoft_com_office_powerpoint_2018_8_main.json`（`p188:cm` / `p188:reply` / `p188:author` / `p188:commentRel` 的 schema）。

## 7. 下一步必做（新会话按序做）

1. **跑新自测**（Bash 目前被闸门拦着，新会话应已放开）：
   ```
   cd C:/Temp/ecclaw-verify && NODE_PATH=F:/soft/00selfmade/ecclaw/node_modules node phase4t-selftest.cjs
   ```
   期望 `phase4t-selftest: N/N`。若失败，先看是不是「负向逐字一致」那几条被新标记污染。
2. **e2e**：沿用 `phase4s-e2e.cjs` 模板写 `phase4t-e2e.cjs`（`send()` 必须带 90s 超时），产物前缀 `run78-*`。
3. **全量回归**：跑 `run78-*` 全套 + 旧套件（4a~4s 全绿已确认，但改动后需再确认一次 e2e）。
4. **收尾**：`pnpm typecheck`、`pnpm build`（改的是主进程，Electron 跑 `out/main/index.js`，真机验证前必须 build；起前 `taskkill //F //IM electron.exe`，9222 单实例）。
5. **文档**：写 `handoff-ecclaw-phase4t-final-2026-11-07.md` + `prompt-ecclaw-phase4t-next.md`（<30 行，只留指针）；更新 `task.md`、README 能力清单；项目记忆 `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/ecclaw_phase4t_*.md` + `MEMORY.md` 索引。
6. **commit**：Conventional Commits；只 add 本轮改动的文件，**不要 `git add -A`**（那 3 个未跟踪 handoff/prompt 是别人的）。

## 8. 避坑（phase4s handoff 沿用 + 本轮新增）

- `previewDocument` 只收**文件库内路径** → DOCX 无导出函数，夹具必须拷进 `fake-userdata/openclaw/.openclaw/file-library/files`；XLSX 也可直调 `extractXlsxText(path)`。
- **旧套件的位置锁死断言会过期**：本轮给 DOCX 段落 / PPTX 页 / XLSX 工作表**追加了行**，回头检查 phase4o 等旧套件有没有锁死行号（phase4o 已因此假红过一次）。本轮 4a~4s 全绿已说明暂无冲突，但 e2e 里若有行号断言要复查。
- PPTX 图表在 `p:graphicFrame` 里、SmartArt 也在 `p:graphicFrame` 里，两者都要走 `graphicRefMarks`；表格 graphicFrame 与之并存不冲突。
- `xmlElements` 与 `xmlChildElements` 区别：前者不限深度、按本地名；后者只取**直接子级**、按固定容器标签。新代码别混用。
- `joinXmlTexts` 只收前缀 `a` 或无前缀的 `t` —— 否则 `<dgm:t>` 会被当文本节点把内层 XML 当文字取出来。
- ctx 预算：`ctx-budget-guard` 在 **160K 硬阻断**（只放行 Write/Edit）。本会话就是被它拦下的。新会话第一件事是跑 §7.1，不要重新大范围探查。
