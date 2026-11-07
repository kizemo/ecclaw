# handoff · ecclaw phase4u（第四十六阶段）· WIP

> 状态：**代码已改完并编译通过，但自测 / e2e / 回归 / 收尾 / commit 全部未做**。
> 原因：会话上下文 ≥160K，ctx-budget-guard 硬阻断 Bash/Read/Grep/Glob/Task/Agent，只剩 Write/Edit。
> 承接：`handoff-ecclaw-phase4t-final-2026-11-07.md`（基线与禁止事项以那份为准，本篇只写本轮增量）。

---

## 1. 本轮交付范围（已与用户确认）

**范围 = 图表深度 + XLSX 隐藏表标记**，只改一个产品文件：`electron/main/document-preview.ts`。

设计四项（AskUserQuestion 结果为自动选中的推荐项）：

| 决策点 | 选定口径 |
|---|---|
| 范围 | 图表深度（轴标题 / 类别 / 数值）+ 隐藏表标记 |
| 图表输出形态 | **多行块**：`[图表: 标题]` / `[坐标轴] 类别轴: X · 数值轴: Y` / `[图表系列] 名: 类别=值, …` |
| 取值口径 | **缓存优先 + 公式回查兜底**（numCache/strCache 优先，缺则按 `c:f` 区间回查原表） |
| 隐藏表 | **照常输出但加状态标记**：`[工作表 名(隐藏)]` / `[工作表 名(veryHidden)]` |

---

## 2. 探针复验结论（phase4t §7 候选清单第 11 次过期，照例先探针）

产物：`C:\Temp\ecclaw-verify\phase4u-make.py`（夹具检查器，输出 `phase4u-inspect.json`）、`phase4u-fixtures.py`（生成 `st4u/` 夹具）、`phase4u-probe.cjs`（打印现状输出）。

| 候选 | 判定 | 说明 |
|---|---|---|
| 图表轴标题 / 类别 / 数值 | **真缺口（本轮做，最大）** | PPTX/DOCX 图表的 `numCache`/`strCache`/轴标题都在文件里，旧输出只有 `[图表: 标题 · 系列]` |
| XLSX 隐藏表 | **真缺口（本轮做）** | hidden/veryHidden 与普通表输出完全一样 |
| XLSX 数组公式 | 小缺口 | 公式文本已出，溢出范围 `ref=` 不见 → 本轮不做 |
| XLSX 外部链接 | 中缺口 | 公式在，目标路径不在 → 本轮不做 |
| DOCX `w:sdt` 内容控件 | 低价值 | `sdtContent` 文本已抽出，只丢 alias/tag → 不做 |
| DOCX 页眉页脚 | **已支持** | 已有 `[页眉] …`，无缺口 |
| DOCX 域代码 | 中缺口 | 域结果文本在，域指令（TOC/PAGE/REF）丢失 → 本轮不做 |
| PPTX 母版 / 版式文本 | 低价值 | 结构性读不到，且页脚占位符上轮已降噪 |
| DOCX OLE / 自定义 XML | 中缺口但工程量大 | 不做 |

---

## 3. 已完成的代码改动（`electron/main/document-preview.ts`，**未 commit**）

### 3.1 图表数据结构

- `ChartInfo` 扩展为 `{ title, catAxisTitle, valAxisTitle, categories, seriesData }`。
- 新增 `ChartSeriesData { name, values }`。
- `parseChartInfo(xml, resolveFormula?, resolveRange?)` 新增/改造：
  - `cachePoints`：按 `idx` 排序取 `c:pt`。
  - `refPoints`：处理 `c:cat` / `c:val` → strRef/numRef → **numCache/strCache 优先**，`c:f` 区间回查兜底。
  - `titleText`：`c:rich` 与 `c:strRef` 两种标题形态。
  - 坐标轴标题：取 `c:plotArea` 内的 `c:catAx` / `c:valAx`。
- 新增 `chartMarkerLines()`，返回**多行**数组；旧 `chartMarker()` 已删除。
- `MAX_CHART_POINTS = 12`：超限截断并追加 `…(共N点)`；系列无名时用 `系列N`。
- 三处调用改为 `chartMarkerLines`：`docxGraphicMarkMap`、`pptxGraphicMarkMap`、`xlsxSheetGraphics`。

### 3.2 类型与落位

- `DocxRenderCtx.graphics` / `PptxRenderCtx.graphics`：`Map<string,string>` → `Map<string,string[]>`。
- `graphicRefMarks` 改为摊平数组。
- **DOCX**：图表块从 `docxExtras`（行内）**移出**，改为在 `extractDocxText` 中作为**段落之后的独立块**；`docxCellText` 里表格单元格中的图形并进同一格（不破坏管道表）。
- **XLSX**：`xlsxSheetGraphics` 增加 `resolveRange` 参数；新增 `parseChartRange` / `expandCellRange` / `MAX_CHART_RANGE_CELLS = 200`；`extractXlsxText` 里工作表 `state` 属性 → `(隐藏)` / `(veryHidden)` 标记；新增 `resolveChartRange` 回查 `表名!A2:A4`。

### 3.3 本轮踩坑（已修，勿回退）

新代码里算出的局部 `title` **没有赋回 `info.title`**，导致图表标题丢失（输出退化成 `[图表]`）。已在 `parseChartInfo` 内补 `info.title = title`。

---

## 4. 已确认的实际输出（探针复跑结果，供改断言时对照）

- `px-chart.pptx` →
  - `[图表: 季度营收走势]`
  - `[坐标轴] 类别轴: 季度 · 数值轴: 金额(万元)`
  - `[图表系列] 营收: Q1=120, Q2=150, Q3=180`
  - `[图表系列] 成本: Q1=80, Q2=95, Q3=110`
- `real1.xlsx`（openpyxl 真图表，无轴标题）→
  - `[图表: 月度销售与成本对比]`
  - `[图表系列] 销售额: 1月=120, 2月=150, 3月=180`
  - `[图表系列] 成本: 1月=80, 2月=95, 3月=110`
  - **不出 `[坐标轴]` 行**（源文件本就无轴标题）
- `px-hidden.xlsx` →
  - `[工作表 可见数据]` / `[工作表 隐藏辅助表(隐藏)]` / `[工作表 严格隐藏表(veryHidden)]`

⚠️ **NFKC 归一化**会把 `（万元）` 变成 `(万元)`，断言按半角写。

---

## 5. 已写但**未执行**的产物

- `C:\Temp\ecclaw-verify\phase4u-selftest.cjs`（自带夹具：notitle / noaxis / big / bad 四个 PPTX，6 组断言）：
  1. PPTX / DOCX 图表深度；
  2. XLSX 无缓存按公式区间回查；
  3. XLSX hidden / veryHidden 标记；
  4. 边界：无标题出 `[图表]`、无轴标题不出 `[坐标轴]`、20 点截断出 `…(共20点)`、坏图表部件不崩且不出半截 `[图表系列]`；
  5. 负向：旧单行格式 `[图表: 标题 · 系列]` 不再出现；
  6. SmartArt 标记不受影响。

---

## 6. 下一步必做（按顺序）

### 6.1 编译（必须项目根跑）

```bash
npx tsc electron/main/document-preview.ts electron/main/paths.ts electron/shared/types.ts \
  --rootDir electron --outDir C:/Temp/ecclaw-verify/tsout \
  --module commonjs --target es2022 --lib es2022,dom --esModuleInterop --skipLibCheck
```

产物落在 `C:/Temp/ecclaw-verify/tsout/main/`。**`--rootDir` 与 `--outDir` 必须配套**，否则会假绿。

### 6.2 跑本轮自测

```bash
export NODE_PATH="F:/soft/00selfmade/ecclaw/node_modules" && node C:/Temp/ecclaw-verify/phase4u-selftest.cjs
```

### 6.3 更新旧套件断言（**输出格式变了，必做**）

`phase4t-selftest.cjs` / `phase4t-e2e.cjs` 里的图表断言要从旧格式 `[图表: 标题 · 系列]` 改成新多行格式。

涉及夹具与旧期望值（先跑一遍看实际输出再改，**不要凭记忆猜**）：

| 夹具 | 旧标题 | 旧系列 |
|---|---|---|
| `b2-docxchart.docx` | 月度销售趋势图 | 销售额系列 |
| `b4-xlsxchart.xlsx` | 月度销售趋势 | 销售额 |
| `b7-pptxchart.pptx` | 季度利润走势 | 净利润 |
| `real1.xlsx` | 月度销售与成本对比 | 销售额 / 成本 |
| `real2.pptx` | 季度经营指标走势 | 收入 / 利润 |
| `real3.docx` | 季度经营指标走势 | 收入 / 利润 |
| `ch-notitle.pptx` | （无标题） | — |

负向断言里含 `·` 分隔符的（如「旧单行格式应消失」类）同样要改。

### 6.4 e2e

复制 `phase4t-e2e.cjs` → `phase4u-e2e.cjs`，改前缀。真机需 `pnpm build` + `taskkill //F //IM electron.exe` 后重启（9222 单实例）。

### 6.5 全量回归

复制 `rerun-and-regress78.cjs` → `rerun-and-regress79.cjs`，加入 phase4u 套件，产物前缀 `run79-*`（**不能覆盖 run78**）。

- `phase3r C3` 是**既有环境失败**（事件库 >2000 条），别追。
- **不跑 phase3s / phase3q**（真站）。

### 6.6 收尾

- README §5.40 + 底部能力清单。
- `task.md` 顶部状态段 + 阶段交付表 + 实证发现。
- 项目记忆：新增 `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/ecclaw_phase4u_chart_depth.md`，并在 `MEMORY.md` 加一行索引。
- `handoff-ecclaw-phase4u-final-2026-11-07.md` + `prompt-ecclaw-phase4u-next.md`（<30 行，只留指针）。

### 6.7 提交

精确 `git add electron/main/document-preview.ts README.md task.md handoff-*.md prompt-*.md` → **feat 一条** → **docs 回填 hash 一条**，**不 amend**。

⚠️ 仓库根另有 3 个既存未跟踪文件（`handoff-2026-11-06.md` / `handoff-2026-11-07.md` / `prompt-ecclaw-phase4p-next.md`），**禁止 `git add -A`**。

---

## 7. 避坑

1. **ctx 闸门**：本会话只剩 Write/Edit 能用，Bash/Read 全被拦。看到 guard 提示就立刻写 handoff + 开新会话，不要试图绕过。
2. **改断言别猜**：输出格式本轮变了，先跑自测/旧套件看实际文本再改断言。
3. **NFKC**：`（` `）` `，` 等全角标点会被归一化成半角，断言字符串按半角写。
4. **图表块在 DOCX 里独立成块**，排在所在段落之后；表格单元格里的图表并进同一格文本。
5. **XLSX 图表取值**：openpyxl 生成的图没有 `strCache`/`numCache`，必须靠 `c:f` 公式区间回查原表才拿得到类别和数值；`MAX_CHART_RANGE_CELLS = 200` 是回查上限。
6. **tsc 必须项目根跑**，且 `--rootDir electron --outDir ...` 配套。
7. **阶段文档铁律**：feat 与 docs 分两条提交，docs 那条回填 feat 的 hash，不 amend。

---

## 8. 必读顺序

1. 本篇。
2. `handoff-ecclaw-phase4t-final-2026-11-07.md`（§8 避坑 + §7 候选清单）。
3. `electron/main/document-preview.ts` 里 `parseChartInfo` / `chartMarkerLines` / `xlsxSheetGraphics` / `extractDocxText` 四处。
4. `C:\Temp\ecclaw-verify\phase4u-selftest.cjs`（本轮自测断言口径）。
