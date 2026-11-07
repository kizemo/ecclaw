# handoff · ecclaw phase49（第四十九阶段）· FINAL（**全部完成 · 已提交并 push**）

> 上阶段：`F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase49-wip-2026-11-07.md`（代码完成 + 探针 6/6 绿）。
> 本轮状态：🟢 **产品实现 + 自测 + e2e + run82 全量回归 + 收口文档全部完成且全绿；两条提交已 push**
>（feat = `a9d9a5c`；docs 收口提交紧随其后，明细见 §6）。
> 产品改动**只改** `F:\soft\00selfmade\ecclaw\electron\main\document-preview.ts` 的实际路径
> `electron/main/document-preview.ts`（+108 / −14，MCP 工具数仍 27，无新增依赖）。

## 1. 本轮做了什么（第四十九阶段 = phase49，候选清单「全部做完，不选」）

第四十八阶段 handoff §7 的六条候选**全部实现**（另扫出两条新轴），只改 `electron/main/document-preview.ts`。

| # | 任务 | 实现 | 输出口径（探针 A1–A6 实证） |
|---|---|---|---|
| T1 | DOCX 修订日期 | `docxRevisionMarks()` 读 `w:date` | `[修订+alice(2026-11-01T08:30:00Z): INS_BODY_TEXT]` |
| T2 | XLSX 合并单元格 | 新增 `parseXlsxMergeCells()`；`PreparedSheet` 加 `mergeLine` | `[合并单元格] A1:B2 · C5:E5`（表尾，数据校验之后、图表之前；`MAX_MERGE_RANGES=30`，超出报 `...(共N处)`） |
| T3 | XLSX 工作表保护 | `<sheetProtection>` 部件存在 → 表头标记 | `[工作表 S1(受保护)]`（与 `(隐藏)`/`(veryHidden)` 叠加） |
| T4 | DOCX 图片尺寸 | 新增 `emuToCm()` / `docxImageSize()`（`wp:docPr` 之前最近的 `wp:extent`） | `[图片: DOCX_PIC_ALT (8.89×6.67cm)]` |
| T5 | PPTX 图片尺寸 | 新增 `pptxPictureSize()`（`p:pic` 内 `a:xfrm/a:ext` 的 cx/cy） | `[图片: PPTX_PIC_ALT (12.7×12.7cm)]` |
| T6 | 图表次轴 + 类型 | `parseChartInfo()` 加 `secValAxisTitle`/`typeLabel`；新增 `CHART_PLOT_TYPES`（9 种绘制组） | `[图表类型] 组合: 堆积柱形 + 折线` · `[坐标轴] 类别轴: CAT_AX_T · 数值轴: MAIN_VAL_AX_T · 次数值轴: SECOND_VAL_AX_T` |

**探针另证伪一条候选**：XLSX 线程批注状态 `(已解决)` **早已实现**（phase4s 做过）→ 候选出局（探针第 11 次推翻候选）。

## 2. 验证证据

- **秒级自测**：`phase49-selftest.cjs` **35/35** ✅（含 6 条回归红线，见 §3）。
  跑法：`cd /c/Temp/ecclaw-verify && NODE_PATH="F:/soft/00selfmade/ecclaw/node_modules" node phase49-selftest.cjs`
- **真机 e2e**：`phase49-e2e.cjs` **34/34** ✅（真 Electron + MCP stdio；工具数仍 **27**）。
  跑法：`cd /c/Temp/ecclaw-verify && node phase49-e2e.cjs`
  （host-server.mjs 在 `<stateDir>/openclaw/.openclaw/**mcp**/host-server.mjs`，不在 `.openclaw/` 根下。）
- **全量回归 `run82-*`**（三十六套，摘要 `C:\Temp\ecclaw-verify\run82-summary.txt`，装置 `rerun-and-regress82.cjs`）：
  **交接时已确认 34 套**——phase49 **34/34** · phase4w 34 · phase4u 43 · phase4t 30 · phase4s 36 · phase4r 26 ·
  phase4q 22 · phase4p 22 · phase4o 17 · phase4n 78 · phase4m **50** · phase4l 37 · phase4k **35** ·
  phase4j 39 · phase4i 53 · phase4h 48 · phase4g 30 · phase4f 26 · phase4e 21 · phase4d 31 · phase4c 26 ·
  phase4b 18 · phase4a 20 · phase3z 37 · phase3y 31 · phase3x 41 · phase3w 27 · phase3v 29 · phase3u 24 ·
  phase3t 16 · phase3p 45 · phase3o 44。
  - **phase4v 机器计数显示 0/0，实际 17/17 通过**（该套日志行首是 `PASS: ` 而非 `[*] PASS`，机器正则漏计；
    run80 / run81 同样如此，**既有现象，不是本轮问题**）。
  - **唯一红 phase3r B3/C3 = 既有环境红**（不是本轮改动）：`host-events.ts:409` 回放 limit 上限 2000，
    落盘事件已累积到 observe+approval=2031 → 并集被截断成 2000；run81 起即红。
  - ✅ **phase3m 69/69、sse 14/14 已确认全绿**（`run82-summary.txt` 落盘）→ `task.md` 里
    「全量回归 `run82-*` 三十六套」那句的括注已补成「三十六套全绿，唯一红 phase3r B3/C3（既有环境红）」。
  - 未跑真站套件 phase3s / phase3q（红线：不碰淘宝）。

## 3. 六条回归红线（phase49-selftest.cjs 里各有一条）

1. 无 `w:date` 的修订 → 旧口径逐字不变（`[修订+alice: …]`，不补空括号）。
2. 无 `mergeCells` 部件的表 → 不出 `[合并单元格]` 行。
3. 无 `sheetProtection` 部件的表 → 不出 `(受保护)` 标注。
4. 读不到尺寸的图片 → 保持 `[图片: alt]` 原样（DOCX 无 `wp:extent` / PPTX 无 `a:ext` 各一条）。
5. 单组 clustered 图表 → 不出 `[图表类型]`、不出 `次数值轴`，坐标轴行逐字不变。
6. `phase4v/array.xlsx` 与 `phase4w/plainchart.xlsx` → 输出逐字不变。

## 4. 口径设计决策（写断言前必看）

1. 修订日期**原样输出 ISO 串**（不截断日期部分）；无 `w:date` → 与旧版逐字一致。
2. `[合并单元格]` 在 `[数据校验]` **之后**、图表行**之前**（dvLine / mergeLine 同走 tail）。
3. `[图表类型]` 只在：多绘制组（组合），或单组 grouping ∈ {stacked, percentStacked} 时出现。
4. 图片尺寸：`EMU/360000` → `Number(toFixed(2))`（**去尾零**：`12.7`、`8.89`，别写 `12.70`）。
5. 次轴标题只认 plotArea 里**最后一根** valAx 的 title（无 title 不输出、也不猜）。
6. PPTX 母版/版式里的图片走同一条 `pptxTreeBlocks` → 同样带尺寸。

## 5. 避坑（本轮新增，复用价值高）

1. **openpyxl 造不出组合图**：`BarChart()+LineChart()` 抛 `Cannot combine instances of different types`
   → 夹具只能手工向 xlsx 注入 `chart1.xml`（`phase49-make2.py` 用 zipfile）。
2. **chart 部件必须带完整 drawing 链才出图**：worksheet `<drawing r:id>` → drawing1.xml → chart1.xml
   + drawing rels + sheet rels + ContentTypes；**只塞 chart 部件时产品零输出**（combo_min 实证）。
3. **DOCX 图片尺寸只认 `wp:extent`**：`pic:spPr/a:xfrm/a:ext` 的 cx/cy 是图形内部坐标，**不算显示尺寸**；
   取 `wp:docPr` **之前最近**的 `wp:extent`（schema 顺序 extent 先于 docPr）。
4. **EMU→cm 去尾零**；**NFKC 归一化把 `…` 变成 `...`** → 截断标记在输出里是三个 ASCII 点。
5. **openpyxl 写 mergeCell 的顺序不是升序** → 断言别假设「第 31 处是某个特定 ref」（本轮自测踩过一次）。
6. **旧套件的逐字不变断言又过期两处** → **脚本级**把新标记烘进期望字面量（沿用 phase4w `[文本框]` 先例），
   **零产品改动**：
   - `phase4m-selftest.cjs` / `phase4m-e2e.cjs`：修订夹具**带 `w:date`** → 期望串加 `(2026-01-01T00:00:00Z)` 等。
   - `phase4k-selftest.cjs` / `phase4k-e2e.cjs`：图片夹具**带 extent** → 期望串加 `(2.92×2.92cm)`。
   - `phase4s-selftest.cjs` / `phase4s-e2e.cjs`：图片夹具**带 extent** → 期望串加 `(7.62×5.08cm)`。
   （这三个套件的 `-selftest.cjs` / `-e2e.cjs` 都在 `C:\Temp\ecclaw-verify\`，**不在仓库里**。）
7. **夹具脚本**：Windows 上 `os.replace` 偶发 `PermissionError`（文件锁）→ 生成脚本加 20 次重试。

## 6. ✅ 收尾已全部完成（新会话 2026-11-07 续做完毕）

1. **run82 摘要复核**：`C:\Temp\ecclaw-verify\run82-summary.txt` 确认 **phase3m 69/69、sse 14/14 全绿**
   → `task.md` 的回归结论已补成「三十六套全绿，唯一红 phase3r B3/C3（既有环境红）」。
2. **feat 提交**：`a9d9a5c`（只含 `electron/main/document-preview.ts`，+108 / −14；精确 add，未用 `git add -A`）。
3. **docs 提交**（回填 feat hash，未 amend）：README §5.53 / `task.md` / 本文 / `prompt-ecclaw-phase49-next.md`
   + 同日的 `handoff-ecclaw-phase49-probe-2026-11-07.md` / `handoff-ecclaw-phase49-wip-2026-11-07.md` 一并入库 → 已 `git push`。
4. **prompt 处置**：按仓库既有约定（phaseX 收尾时写 `prompt-ecclaw-phaseX-next.md`，内容指向下一轮），
   `prompt-ecclaw-phase49-next.md` 已从「第四十九阶段收尾指针」改写为**第五十阶段接力指针**。
   `handoff-2026-11-07.md` 是 SessionStart hook 建的当日占位文件，保留在工作区、未入库。

## 7. 环境基线

- 仓库：main@`a9d9a5c`（feat）+ 其后的 docs 收口提交（**干净已 push**）；远端 `https://github.com/kizemo/ecclaw.git` origin/main。
- 夹具站：8898（`fixture-server.cjs`）+ 8897（`fixture-writer.cjs`）**回归前两个都要起**（交接时均在跑）。
- Electron：`npx electron . --remote-debugging-port=9222`（**改完主进程必须重启**，否则 e2e 跑的是旧代码）。
  交接时 Electron 已按新代码重启并跑完 e2e / run82。
- phase49 装置（全部在 `C:\Temp\ecclaw-verify\`，**不进仓库**）：
  - 夹具：`phase49-make.py`（rev.docx / pic.docx / pic.pptx / merged.xlsx）、
    `phase49-make2.py`（combo_full / combo_min / _combo_base）、
    `phase49-make3.py`（**红线夹具**：rev_nodate.docx / pic_noextent.docx / pic_noextent.pptx / manymerge.xlsx），
    全部落在 `C:\Temp\ecclaw-verify\phase49\`。
  - 脚本：`phase49-probe.cjs`（探针）、`phase49-selftest.cjs`（35 条）、`phase49-e2e.cjs`（34 条）、
    `rerun-and-regress82.cjs`（三十六套）。
  - tsc 重编（tsout 会被清掉，直接复用）：
    `npx tsc electron/main/document-preview.ts --module commonjs --moduleResolution node --target es2022 --lib es2022,dom --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron --esModuleInterop --skipLibCheck --resolveJsonModule`
  - 跑自测必须带 `NODE_PATH=F:/soft/00selfmade/ecclaw/node_modules`。

## 8. 下一轮候选（**先探针再选题 —— 候选清单已过期 13 次**）

以下只是线索，**必须先用探针实测复验**，别照抄：

1. **PDF 表格结构**：目前 PDF 只出按页文本流，表格行列结构被拍平（pdfjs 无表格 API，坐标重建工程量大）。
2. **图片的像素尺寸 / DPI**：本轮只给了 EMU→cm 的显示尺寸，没给原生像素与 DPI。
3. **XLSX 保护的具体规则**：`sheetProtection` 只标了「受保护」，没区分 `password` / `selectLockedCells` 等规则。
4. **DOCX 修订的其他维度**：`w:rPrChange`（格式修订）、`w:pPrChange`（段落属性修订）尚未抽。
5. **图表的数据表 / 透视缓存**：`chart1.xml` 之外的 `externalData`（内嵌 xlsx 里的数据表）还没读。

## 9. 必读顺序

1. 本篇（§1–§5 口径与避坑 + §6 剩余三步）。
2. `handoff-ecclaw-phase49-wip-2026-11-07.md`（T1–T6 的实现清单与探针依据）。
3. `handoff-ecclaw-phase49-probe-2026-11-07.md`（探针结论表 + tsc 命令 + 夹具跑法）。
4. `handoff-ecclaw-phase4w-final-2026-11-07.md` §4/§8（通用避坑 + 装置）。
5. `electron/main/document-preview.ts` 改动处：`emuToCm`/`docxImageSize`、`docxRevisionMarks`、
   `pptxPictureSize`、`CHART_PLOT_TYPES`+`parseChartInfo` 轴/类型段、`parseXlsxMergeCells`、
   `extractXlsxText` 的 PreparedSheet/assembly。
