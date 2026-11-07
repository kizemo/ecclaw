# handoff · ecclaw phase4w（第四十八阶段）· FINAL（已验证 + 已收口）

> 上阶段：`F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase4v-final-2026-11-07.md`（第四十七阶段，169564d feat / 3efb790 docs）。
> 本轮状态：🟢 **phase4v §5 六条候选全部实现并验证完毕（自测 33/33 + e2e 34/34 + 全量回归 run81）；产品代码只改 `electron/main/document-preview.ts`。**
> 本文件取代同日的 `handoff-ecclaw-phase4w-wip-2026-11-07.md`（该 WIP 版已被重命名为本文件）。

## 1. 本轮做了什么（第四十八阶段 = phase4w，候选清单「全部做完，不选」）

phase4v §5 的六条候选**全部实现**（另加一条文本框标记），只改 `F:\soft\00selfmade\ecclaw\electron\main\document-preview.ts`。

| # | 候选 | 实现 | 输出口径 |
|---|---|---|---|
| 1 | PDF 内嵌附件 | `pdfAttachmentLines()` + `attachmentText()`；`PdfDocument` 加 `getAttachments?` / `getAttachmentContent?` | `[附件] data.txt (47 B): ATTACHED_TEXT_CONTENT…`（二进制只给大小；附件行排在正文前） |
| 2 | PPTX 母版/版式文本 | `pptxTemplateText()` / `pptxTemplateNoise()` / `pptxTemplateLines()`；`PptxParts` 加 `masters` / `layouts` | `[母版] MASTER_TITLE_TEXT` · `[版式: Title Slide] LAYOUT0_TEXT`（排在 `[幻灯片 1]` 之前） |
| 3 | DOCX OLE 嵌入对象 | `docxOleObjects()` + `docxOleMarks()`；`DocxParts` 加 `embeddings`，`DocxRenderCtx` 加 `oleObjects` | `[嵌入对象: Excel.Sheet.12 → oleObject1.bin (680 B)]` |
| 4 | DOCX 自定义 XML | `customXmlHasContent()`；`DocxParts` 加 `customXml` | `[自定义XML] item1.xml: <probe …>`（尾部块，空容器部件过滤） |
| 5 | DOCX 文本框标记 | `docxExtras()` 里判 `<w:txbxContent` / `<wps:txbx` | 正文行尾追加 `[文本框]` |
| 6 | XLSX 外部链接缓存值 | `xlsxExtLinkCached()`；挂在 `parseXlsxExternalLinks()` 每条链接后 | `[外部链接] [1] Sheet1 → https://… (缓存值: A1=100) · [2] … (缓存值: A1=200)` |
| 7 | 图表数据标签/图例 | `parseChartInfo()` 加 `hasDataLabels` / `dataLabels` / `hasLegend` / `legendPos`；`CHART_LABEL_FLAGS` / `isXmlOn()` / `chartLegendPosLabel()` | `[图表标签] 数据标签: 数值 · 图例: 底部`（**没有 dLbls 也没有 legend 就不出这行**） |

新常量：`DOCX_EMBEDDING_RE` / `DOCX_CUSTOM_XML_RE` / `MAX_DOCX_EMBEDDINGS=20` / `MAX_CUSTOM_XML_CHARS=400` /
`PPTX_MASTER_RE` / `PPTX_LAYOUT_RE` / `MAX_EXT_LINK_CACHE=20` / `MAX_PDF_ATTACHMENTS=20` / `MAX_ATTACHMENT_CHARS=2000`。

## 2. 验证证据（本轮全部跑过）

- **秒级自测**：`phase4w-selftest.cjs` **33/33**（含 6 条回归红线）。
  跑法：`cd /c/Temp/ecclaw-verify && NODE_PATH="F:/soft/00selfmade/ecclaw/node_modules" node phase4w-selftest.cjs`
- **真机 e2e**：`phase4w-e2e.cjs` **34/34**（真 Electron + MCP stdio；工具数仍 **27**）。
  跑法：`cd /c/Temp/ecclaw-verify && node phase4w-e2e.cjs`
  （注意 host-server.mjs 在 `<stateDir>/openclaw/.openclaw/**mcp**/host-server.mjs`，不在 `.openclaw/` 根下。）
- **全量回归 `run81-*`**（三十五套，摘要 `run81-summary.txt`）：
  phase4w 34/34 · phase4v 17/17 · phase4u **43/43** · phase4t **30/30** · phase4s 36 · phase4r 26 · phase4q 22 ·
  phase4p 22 · phase4o 17 · phase4n 78 · phase4m 50 · phase4l 37 · phase4k 35 · phase4j 39 · phase4i 53 ·
  phase4h 48 · phase4g 30 · phase4f 26 · phase4e 21 · phase4d 31 · phase4c 26 · phase4b 18 · phase4a 20 ·
  phase3z 37 · phase3y 31 · phase3x 41 · phase3w 27 · phase3v 29 · phase3u 24 · phase3t 16 ·
  phase3p 45 · phase3o 44 · phase3m 69 · sse 14 —— **除 phase3r 外全绿**。
  - **phase3r B3/C3 红 = 既有环境红**（不是本轮改动）：`host-events.ts:409` 回放 limit 上限 2000，
    落盘事件已累积到 observe+approval=2031 → 并集被截断成 2000；run80 时尚未越线（C3 当时已红）。
  - **phase4u / phase4t 各补跑一次**：它们各有一条 `b1-textbox.docx` 的「原文逐字不变」红线，
    因本轮新增 `[文本框]` 标记而过期 → **脚本级**更新断言为含标记口径，**零产品改动**。
  - 未跑真站套件 phase3s / phase3q（红线：不碰淘宝）。

## 3. 探针结论（phase4w-probe.cjs 实测，六条缺口**全部为真**）

- PDF：`pdfjs.getAttachments()` 只给**元信息**（`{rawFilename, filename, description}`），**没有 content**；
  内容要用 `getAttachmentContent(name)` 单独拉（返回 `Uint8Array | null`）。第一版按 `item.content` 读 → 全是 0 B，已改成两段式。
- PPTX：母版里有真文字（`MASTER_TITLE_TEXT`）也有 PowerPoint 提示语（`Click to edit Master text styles` / `Second level` / `‹#›` / 日期占位）→ 提示语必须过滤，否则每次都刷屏。
- DOCX：包里确实有 `word/embeddings/oleObject1.bin` 与 `customXml/item1.xml`，正文 `<o:OLEObject … r:id>` 能定位 → OLE 与自定义 XML 都是真缺口。
- DOCX 文本框：`w:txbxContent` 里的文字**早已被抽出**，只是没有「这是文本框」标记 → 只补标记。
- XLSX：`externalLink1.xml` 的 `<sheetDataSet>` 里有缓存值 `A1=100` / `A1=200`，之前只出路径 → 真缺口。
- 图表：openpyxl 把 `<dLbls>` / `<legend>` 写成**无前缀**（默认命名空间），且 `dLbls` 在 **`<barChart>` 级**（不是 chart 级、也不是 ser 级）→ 解析必须按本地名 + 全深度找。

## 4. 避坑（本轮新增）

1. `getAttachments()` **没有 content**，必须再调 `getAttachmentContent(key)`（id = 名字树 key，不是文件名）。
2. 母版/版式里的 `Click to edit Master…` / `Second level` / `‹#›` / 日期占位是提示语 → 必须过滤（否则每个 PPTX 都刷屏）。
3. python-docx 模板里 `customXml/item1.xml` 是**空的参考文献表**（`<b:Sources …/>`）→ 自定义 XML 要过滤空容器（元素标签数 ≤ 1）。
4. 图表 `dLbls` 在 `<c:barChart>` 级，openpyxl 写成**无前缀**标签 → 必须按本地名 + 全深度找，不能只找 chart 级。
5. 回归红线：七条新标记**只在对应部件存在时出现**（无附件 PDF / 无母版文字 PPTX / 普通 DOCX / 无外部链接 XLSX / 无 dLbls 无 legend 图表）——phase4w-selftest.cjs 里已各有一条断言。
6. **旧套件的位置锁死断言会过期**：phase4u / phase4t 的 `b1-textbox.docx` 逐字不变断言因 `[文本框]` 标记变红 → 改脚本断言（不要改产品）。
7. **夹具脚本**：Windows 上 `os.replace` 偶发 `PermissionError`（文件锁）→ `phase4w-make.py` 已加 20 次重试。

## 5. 夹具与装置（全在 `C:\Temp\ecclaw-verify\`，不进仓库）

- `phase4w-make.py` → 生成 `phase4w/`：`emb.pdf`（pypdf 加两个附件）、`master.pptx`（母版/版式有文字）、`plain.pptx`（回归红线：无用户文字）、`ole.docx`（OLE + customXml）、`chart.xlsx`（dLbls + legend）、`plainchart.xlsx`（回归红线：无 dLbls 无 legend）。
  跑法：`cd /c/Temp/ecclaw-verify && python phase4w-make.py`
- `phase4w-probe.cjs`（六条轴现状实测）、`phase4w-selftest.cjs`（33 条断言）、`phase4w-e2e.cjs`（34 条断言）。
- 复用旧夹具：`phase4v/txbx.docx`（文本框）、`phase4v/extlink.xlsx`（外部链接）、`phase4v/array.xlsx`（回归红线）、`dummy.pdf`（无附件 PDF）。
- 回归装置：`rerun-and-regress81.cjs`（run80 副本 → run81，套清单加 phase4w）。

## 6. 环境基线

- 分支 main：本轮已提交 `026fe21`（feat document-preview.ts）+ `d6c675d`（docs 收口），已 push 至
  `https://github.com/kizemo/ecclaw.git` origin/main。接力新会话请先 `git pull` 核对本仓最新。
- 夹具站：8898（fixture-server.cjs）+ 8897（fixture-writer.cjs），**回归前两个都要起**。
- Electron：`npx electron . --remote-debugging-port=9222`（改完主进程必须重启，否则 e2e 跑的是旧代码）。

## 7. 下一轮候选（**先探针再选题 —— 候选清单已过期 12 次**）

以下只是线索，不保证是真缺口，必须先用探针实测复验：

1. **DOCX 修订痕迹的作者与日期**：`w:ins` / `w:del` 的 `w:author` / `w:date` 属性（第三十八阶段只抽了插入/删除文本）。
2. **PDF 表格结构**：目前 PDF 只出按页文本流，表格的行列结构被拍平。
3. **XLSX 单元格批注 / 线程批注**：`xl/comments*.xml` 的作者与线程（第三十七阶段做过 sheet rels 兜底，作者维度待查）。
4. **DOCX / PPTX 图片本身**：目前只有 alt 文字，没有尺寸 / DPI / 位置序列（位图不 agent 上下文是既定约束）。
5. **XLSX 图表的次级维度**：多轴 / 堆积图 / 组合图（双轴）现在只出第一组系列。

## 8. 必读顺序

1. 本篇。
2. `handoff-ecclaw-phase4v-final-2026-11-07.md` §5（上一轮候选清单的来源，已全部做完）。
3. `electron/main/document-preview.ts`：`pdfAttachmentLines` / `pptxTemplateLines` / `docxOleMarks` /
   `customXmlHasContent` / `xlsxExtLinkCached` / `CHART_LABEL_FLAGS` 六处。
4. `C:\Temp\ecclaw-verify\phase4w-selftest.cjs` + `phase4w-e2e.cjs` + `phase4w-make.py` + `phase4w-probe.cjs`。
