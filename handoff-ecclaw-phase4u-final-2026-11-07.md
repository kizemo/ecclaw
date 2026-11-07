# handoff · ecclaw phase4u（第四十六阶段）· FINAL

> 承接：`handoff-ecclaw-phase4u-wip-2026-11-07.md`（本轮中途被 ctx 闸门拦下时写的 WIP，已被本篇取代）。
> 上一阶段：`handoff-ecclaw-phase4t-final-2026-11-07.md`。
> 本轮状态：**代码 + 文档 + 记忆 + 提交全部完成**。

---

## 1. 完成摘要

第四十六阶段 = **图表深度（坐标轴标题 / 类别 / 数值）+ XLSX 隐藏表标记**。
只改一个产品文件 `electron/main/document-preview.ts`，MCP 工具数仍 27，无新增依赖。

第四十五阶段把图表做成了 `[图表: 标题 · 系列名]`，**轴标题与全部数值仍然看不到**；
本轮把图表输出改成多行块，并把 XLSX 的 hidden / veryHidden 工作表标出来。

---

## 2. 已确认的设计（四项）

| 决策点 | 口径 | 原因 |
|---|---|---|
| 范围 | 图表深度 + 隐藏表标记 | 候选清单第 11 次过期后的探针结论；其余候选信息量低或工程量大 |
| 图表输出形态 | **多行块** `[图表: 标题]` / `[坐标轴] 类别轴: X · 数值轴: Y` / `[图表系列] 名: 类别=值, …` | 单行塞不下轴标题 + 全部数值 |
| 取值口径 | **缓存优先 + 公式回查兜底** | Excel/PowerPoint 存的文件有 `numCache`/`strCache`；openpyxl 只有 `c:f` |
| 隐藏表 | **照常输出 + 状态标记** | 隐藏表常是公式回查的源表，跳过会断取值链 |

---

## 3. 改动清单

### 3.1 产品代码 `electron/main/document-preview.ts`

| 位置 | 改动 |
|---|---|
| `ChartInfo` | 扩展为 `{ title, catAxisTitle, valAxisTitle, categories, seriesData }`；新增 `ChartSeriesData { name, values }` |
| `parseChartInfo(xml, resolveFormula?, resolveRange?)` | 新增 `cachePoints`（`c:pt` 按 `idx` 排序）、`refPoints`（`c:cat`/`c:val` → strRef/numRef → 缓存优先、`c:f` 区间回查兜底）、`titleText`（`c:rich` 与 `c:strRef` 两种标题写法）；坐标轴标题取 `c:plotArea` 内的 `c:catAx`/`c:valAx` |
| `chartMarker()` → `chartMarkerLines()` | 删旧函数，改返回 `string[]`；`MAX_CHART_POINTS = 12`（超限截断并标 `...(共N点)`）；系列无名用 `系列N` |
| `DocxRenderCtx.graphics` / `PptxRenderCtx.graphics` | `Map<string,string>` → `Map<string,string[]>`；`graphicRefMarks()` 改摊平数组 |
| `docxGraphicMarkMap()` / `pptxGraphicMarkMap()` | 改用 `chartMarkerLines()`，SmartArt 包成单元素数组 |
| `docxExtras()` | 移除行内 `graphicRefMarks` 调用（图表不再挤在段落行内） |
| `docxCellText()` | 表格单元格里的图形并进同一格（不破坏管道表） |
| `extractDocxText()` | 图表 / SmartArt 标记作为**段落之后的独立块** |
| `parseChartRange()` / `expandCellRange()` / `MAX_CHART_RANGE_CELLS = 200` | XLSX 区间回查（`'数据'!A2:A4` → 逐格引用） |
| `xlsxSheetGraphics()` | 增加 `resolveRange` 参数 |
| `extractXlsxText()` | 工作表 `sheet@state` → `[工作表 名(隐藏)]` / `[工作表 名(veryHidden)]`；新增 `resolveChartRange` 回查原表 |

### 3.2 文档 / 记忆

- `README.md`：新增 §5.50；§5.49 的图表格式加了指向 §5.50 的说明；底部能力清单加一条。
- `task.md`：顶部状态段加第四十六阶段；新增「## 第四十六阶段」段（改了什么 / 实证发现 / 验证）。
- 项目记忆：`ecclaw_phase4u_chart_depth.md` + `MEMORY.md` 索引一行。

---

## 4. 测试证据

| 项 | 结果 | 产物 |
|---|---|---|
| 本轮自测 | **27/27** | `C:\Temp\ecclaw-verify\phase4u-selftest.cjs` |
| 本轮 e2e（真机） | **43/43** | `run79-phase4u.log` |
| phase4t 自测（改断言后） | **42/42** | `phase4t-selftest.cjs` |
| phase4t e2e（改断言后） | **30/30** | `run79-phase4t.log` |
| 全量回归 | **32 套，唯一失败 phase3r C3** | `run79-summary.txt` / `run79b-*` / `run79c-*` |

**回归失败归因（都已在 task.md 记录）**：

- 首跑 `run79` 有 7 套中断 —— **8898 / 8897 fixture server 没启动**（`ERR_CONNECTION_REFUSED`）。
  补起 `fixture-server.cjs`（8898）与 `fixture-writer.cjs`（8897）后 `run79b-*` / `run79c-*` 全绿。
- phase3u A4 —— **上一轮自己留下的测试包指针**（套件 E0 装了 1.1.0 且不还原 `current.json`）。
  把测试包 `ecclaw-graytest` 的 `current.json` 复位到 1.0.0 后 24/24。与 phase4u 无关。
- phase3r C3 —— **既有环境失败**（事件库 >2000 条），run78 同样红，**别追**。
- phase3p —— 补跑后 45/45（首跑 44 是跨套件状态残留）。

---

## 5. 实证发现（六条）

1. **候选清单第 11 次过期**：phase4t §7 里「图表坐标轴标题 / 类别 / 数值」仍是真缺口，且是剩余图形轴里信息量最大的一条；但同批的「DOCX 页眉页脚」**早已支持**（`[页眉] …`），照单做就是白工。
2. **图表缓存两条路都得留**：Excel / PowerPoint 自己存的文件写 `numCache` / `strCache`（直接读）；openpyxl 生成的图表**只有 `c:f` 公式**（必须回查原表）。只做一条，另一类文件直接瞎。
3. **标题算出来不赋回去会静默丢标题**：`parseChartInfo()` 里局部 `title` 未写回 `info.title` 时，输出退化成 `[图表]`，**不报错也不崩** —— 断言必须盯住标题行本身。
4. **DOCX 图表块位置**：留在段落行内会与段落文字挤成一行、看不出图表挂在哪 → 改成段落之后的独立块；但表格单元格里的图表仍要并进同一格，否则管道表会被打断。
5. **隐藏表不能跳过**：隐藏表（尤其 `veryHidden`）常是公式回查的源表，跳过会断掉图表取值链。
6. **NFKC 会把 `…` 变成三个半角点**（`'\u2026'.normalize('NFKC') === '...'`），断言按半角写。

---

## 6. 下一轮候选清单（**探针复验结论，会过期**）

本轮探针（`phase4u-make.py` + `phase4u-fixtures.py` + `phase4u-probe.cjs`）对 phase4t §7 候选的复验：

| 候选 | 判定 | 说明 |
|---|---|---|
| XLSX 数组公式 | 小缺口 | 公式文本已出，溢出范围 `ref=` 不见 |
| XLSX 外部链接 | 中缺口 | 公式在，目标路径不在 |
| DOCX 域代码 | 中缺口 | 域结果文本在，域指令（TOC/PAGE/REF）丢失 |
| DOCX `w:sdt` 内容控件 | 低价值 | `sdtContent` 文本已抽出，只丢 alias/tag |
| DOCX OLE / 自定义 XML | 中缺口，工程量大 | — |
| PPTX 母版 / 版式文本 | 低价值 | 结构性读不到；页脚占位符上轮已降噪 |
| DOCX 页眉页脚 | **已支持** | 无缺口，别做 |
| 图表轴标题 / 类别 / 数值 | **本轮已做** | — |
| XLSX 隐藏表 | **本轮已做** | — |

**下一轮建议**：按「信息量 / 工程量」排，优先 **DOCX 域代码**（域指令丢失会让 TOC 文档结构不可见）
或 **XLSX 数组公式溢出范围**（`ref=` 是计算依据的一部分），
其次 **XLSX 外部链接目标**（链接是不可再生信息，历史阶段已有先例）。

**流程铁律不变**：候选清单照例会过期 → **先探针复验 + 扫新轴 → 逐项确认设计 → 只改一个文件 → 逐项验证**。

---

## 7. 环境与分支基线

- 分支：`main`；本轮提交见 §9。
- 依赖：无新增。
- 工具数：仍 27（`ecclaw_document_preview` 仍无必填参数）。
- 真机环境：`pnpm build` → `npx electron . --remote-debugging-port=9222`（9222 单实例，重启前先
  `taskkill //F //IM electron.exe`）。
- 回归前置：**8898（`fixture-server.cjs`）+ 8897（`fixture-writer.cjs`）两个 fixture server 都要起着**，
  否则 phase3t / phase3m / phase3p / phase3o / sse 会成片 `ERR_CONNECTION_REFUSED`（本轮踩过）。
- 临时产物：`C:\Temp\ecclaw-verify\`（`phase4u-*` / `run79-*` / `tsout/`）。

---

## 8. 避坑

1. **输出格式变了 → 旧断言必红**：`phase4t-selftest.cjs` / `phase4t-e2e.cjs` 的图表断言
   本轮已改成多行格式。**改断言前先跑一遍看实际输出，别凭记忆猜**。
2. **`zipSync` 不接受字符串**：fflate 的 `zipSync` 传字符串会递归字符 → `Maximum call stack size exceeded`。
   必须 `strToU8()` 转字节（自写夹具时踩过）。
3. **`…` 经 NFKC 变 `...`**：断言按半角写。
4. **fflate / `tsc` 口径**：`--rootDir electron --outDir ...` 必须配套，否则假绿。
5. **候选清单会过期**：第 11 次了，先探针。
6. **AskUserQuestion 超时自动选中 ≠ 用户批准**；本轮四项设计的确认结果均为**自动选中的推荐项**，
   下一轮若要沿用，请在 handoff 里明确标注这一点。
7. **提交纪律**：精确 `git add`，feat 与 docs 两条不 amend；仓库根有 4 个既存未跟踪文件
   （`handoff-2026-11-06.md` / `handoff-2026-11-07.md` / `prompt-ecclaw-phase4p-next.md`
   及本轮的 WIP/final/prompt 之外的旧文件），**禁止 `git add -A`**。

---

## 9. 本轮提交

- `feat(document-preview): 图表深度（轴标题/类别/数值）+ XLSX 隐藏表标记` —— `1b23344`
  （产品代码 `electron/main/document-preview.ts`）。
- `docs: 记录第四十六阶段并回填提交 hash` —— README / task.md / handoff / prompt。

---

## 10. 必读顺序

1. 本篇。
2. `handoff-ecclaw-phase4t-final-2026-11-07.md`（上一阶段基线 + §7 候选清单）。
3. `electron/main/document-preview.ts`：`parseChartInfo` / `chartMarkerLines` /
   `parseChartRange` / `xlsxSheetGraphics` / `extractDocxText` / `extractXlsxText`。
4. `C:\Temp\ecclaw-verify\phase4u-selftest.cjs`（本轮断言口径，含边界夹具）。
5. `task.md` 的「## 第四十六阶段」段（实证发现 + 验证记录）。
