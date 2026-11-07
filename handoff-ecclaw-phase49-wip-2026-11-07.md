# handoff · ecclaw phase49（第四十九阶段）· WIP（代码完成+探针验证绿 · 剩自测/e2e/回归/收口）

> 接力自：`handoff-ecclaw-phase49-probe-2026-11-07.md`（探针轮定稿的 T1–T6 设计与结论表）。
> 本轮状态：🟡 **T1–T6 全部实现完毕，探针复验 6/6 翻转 FOUND、基线红线逐字不变；未提交、正式自测/e2e/run82 未跑**。
> 停手原因：会话上下文到 135K（≥120K 软提醒），按纪律收尾换新会话。

## 1. 已实现（产品改动只在 `electron/main/document-preview.ts`，13 处编辑）

| # | 任务 | 实现 | 输出实证（探针 A1–A6） |
|---|---|---|---|
| T1 | DOCX 修订日期 | `docxRevisionMarks` 读 `w:date`，有则 `作者(日期)` | `[修订+alice(2026-11-01T08:30:00Z): INS_BODY_TEXT]` |
| T2 | XLSX 合并单元格 | `parseXlsxMergeCells` + `PreparedSheet.mergeLine`，tail 顺序 = 数据校验 → 合并单元格 → 图表 | `[合并单元格] A1:B2 · C5:E5`（`MAX_MERGE_RANGES=30`，超出 `…(共N处)`） |
| T3 | XLSX 工作表保护 | `sheetProtection` 部件存在 → 表头标记 | `[工作表 S1(受保护)]`（与 `(隐藏)`/`(veryHidden)` 叠加） |
| T4 | DOCX 图片尺寸 | `emuToCm` + `docxImageSize`（docPr 前最近的 `wp:extent`） | `[图片: DOCX_PIC_ALT (8.89×6.67cm)]` |
| T5 | PPTX 图片尺寸 | `pptxPictureSize`（p:pic 内 `a:ext@cx/cy`） | `[图片: PPTX_PIC_ALT (12.7×12.7cm)]` |
| T6 | 图表次轴+类型 | `parseChartInfo` 加 `secValAxisTitle`/`typeLabel`；`CHART_PLOT_TYPES` 9 种绘制组；`chartMarkerLines` 加 `[图表类型]` 行与 `次数值轴` 段 | `[图表类型] 组合: 堆积柱形 + 折线` · `[坐标轴] … · 次数值轴: SECOND_VAL_AX_T` |

**新常量**：`MAX_MERGE_RANGES=30`、`CHART_PLOT_TYPES`。
**红线实证**：基线 `phase4w/chart.xlsx` 输出与改动前**逐字一致**（单组 clustered 默认 → 不出 `[图表类型]`、无次轴 → 坐标轴行不变）。

## 2. 新口径设计决策（写测试断言前必看）

1. 修订日期原样输出 ISO 串（不截断日期部分）——无 `w:date` 时输出与旧版逐字一致。
2. `[合并单元格]` 在 `[数据校验]` **之后**、图表行**之前**（dvLine/mergeLine 同走 tail）。
3. `[图表类型]` 只在：多绘制组（组合），或单组 grouping ∈ {stacked, percentStacked} 时出现。
4. 图片尺寸：`EMU/360000` → `Number(toFixed(2))`（尾零去掉：12.7、8.89）；读不到 extent → 原样。
5. 次轴标题只认 plotArea 里**最后一根** valAx 的 title（无 title 不输出、也不猜）。
6. PPTX 母版/版式里的图片走同一条 `pptxTreeBlocks` → 同样带尺寸。

## 3. 剩余任务（新会话按八步法第 4 步起）

1. **正式自测** `phase49-selftest.cjs`（照 phase4w-selftest 套路：electron stub + tsout + LIB 拷库）：
   - 正断言：§1 表里的六条输出各 1 条 + `…(共N处)` 截断口径可选。
   - **红线 6 条**：无日期修订（旧口径逐字）/ 无 mergeCells 表 / 无保护表 / 无 extent 图片 / 单组 clustered 图 / `phase4v/array.xlsx`、`phase4w/plainchart.xlsx` 输出不变。
2. **e2e** `phase49-e2e.cjs`：先起 8898+8897、**重启 Electron**（tsout 变了主进程才生效）、工具数恒 27。
3. **run82 全量回归**：`rerun-and-regress81.cjs` → 复制为 `rerun-and-regress82.cjs`，产物前缀 `run82-*`，套清单加 phase49；phase3r B3/C3 既有环境红可接受；**旧套件里若有图片 alt / 修订 / 表头逐字断言，可能因新标记变红 → 脚本级修断言，勿改产品**（先跑看实际输出再改）。
4. **收口五件套**：README §5.53、task.md（状态行 + 阶段节）、项目记忆 + MEMORY.md 索引、`handoff-ecclaw-phase49-final`、`prompt-ecclaw-phase50-next`。
5. **提交两条**：feat（仅 document-preview.ts）+ docs（回填 hash，不 amend）；精确 `git add`。

## 4. 避坑（本轮新增）

1. **组合图夹具必须手工注入**：openpyxl 3.1.5 `BarChart()+LineChart()` 抛 `Cannot combine instances of different types`；`phase49-make2.py` 用 zipfile 向纯数据 xlsx 注入 chart1.xml。
2. **chart 部件要完整 drawing 链才出图**：worksheet `<drawing r:id>` → drawing1.xml → chart1.xml + rels + ContentTypes；只塞 chart 部件时产品零输出（combo_min 实证，GAPCHECK 的 s1/s2/l1 是表头假阳）。
3. tsc 编译命令见探针 handoff §3（tsout 产物会被清，直接复用该命令）。
4. `emuToCm` 用 `Number(toFixed(2))` 去尾零——断言按 `12.7`、`8.89` 写，别写 `12.70`。
5. 会话上下文 120K 起 hook 每轮提醒；Edit/Write 在 160K 硬闸门前仍可用，Bash 会被拦。

## 5. 环境基线

- 仓库：main@`58783ba`（干净已 push）+ **工作区有未提交的 `electron/main/document-preview.ts`**（§1 的 13 处编辑）。
- tsout 已按新代码编译过；探针/夹具全绿：`C:\Temp\ecclaw-verify\phase49\`（rev/pic.docx、pic.pptx、merged.xlsx、combo_full.xlsx、combo_min.xlsx、_combo_base.xlsx）。
- 探针脚本：`phase49-make.py` + `phase49-make2.py` + `phase49-probe.cjs`（跑法见探针 handoff §3）。

## 6. 必读顺序

1. 本篇（§2 设计决策 + §3 剩余任务）。
2. `handoff-ecclaw-phase49-probe-2026-11-07.md`（T1–T6 定稿依据 + tsc 命令 + 夹具跑法）。
3. `handoff-ecclaw-phase4w-final-2026-11-07.md` §4/§8（通用避坑 + 装置）。
4. `document-preview.ts` 改动处：`docxImageSize`/`emuToCm`、`docxRevisionMarks`、`pptxPictureSize`、`CHART_PLOT_TYPES`+`parseChartInfo` 轴/类型段、`parseXlsxMergeCells`、`extractXlsxText` 的 PreparedSheet/assembly。
