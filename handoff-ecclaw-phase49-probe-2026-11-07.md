# handoff · phase49 探针结论（10:00 块收尾件 · 实现留到 15:00 块）

> 上阶段交接：`handoff-ecclaw-phase4w-final-2026-11-07.md`（§7 候选清单）。
> 基线：main@`58783ba` 干净、已 push；本探针轮**零产品改动**。12:28 时本块额度 94%（15:00 重置），
> 按「先探针、15:00 后全速」推进（该方式为超时自动选中的推荐项，非用户直接确认）。

## 1. 探针实测结论（phase49-probe.cjs，夹具全在 `C:\Temp\ecclaw-verify\phase49\`）

| 轴 | 现状 | 判定 |
|---|---|---|
| DOCX 修订 `w:date` | `[修订+alice: …]` 作者已在，日期 ABSENT | ✅ 真缺口（候选1收窄为「只差日期」） |
| XLSX `mergeCells` | 零输出（grep + 行为双确认） | ✅ 真缺口（**新轴扫出**） |
| XLSX `sheetProtection` | 零输出 | ✅ 真缺口（**新轴扫出**） |
| DOCX 图片尺寸 `wp:extent` | 只有 `[图片: alt]`，无尺寸 | ✅ 真缺口（候选4 DOCX 半边） |
| PPTX 图片尺寸 `a:ext` | 只有 `[图片: alt]`，无尺寸 | ✅ 真缺口（候选4 PPTX 半边） |
| XLSX 组合图次级维度 | **三个系列（含次轴 l1）其实都已出**；缺的是：次 valAx 标题 ABSENT、grouping/组合修饰 ABSENT | ✅ 真缺口但很小（候选5改口径：只补「次轴+类型」，不是「补漏系列」） |
| XLSX 线程批注状态 | `[批注(王五)(已解决): …]` 早已输出 | ❌ **伪缺口**（phase4s 已做，候选3出局） |
| PDF 表格结构 | 未探针（pdfjs 无表格 API，坐标重建工程量大） | ⏸ 本轮缓做，记入下轮候选 |

## 2. 第四十九阶段任务面（T1–T6，只改 `electron/main/document-preview.ts`）

- **T1 修订日期**：`[修订+alice(2026-11-01T08:30:00Z): 文本]`；无 date 属性 → 与现状逐字一致（红线）。
- **T2 合并单元格**：表末（或 `[工作表]` 行后）出 `[合并单元格] A1:B2 · C5:E5`；上限常量；无 mergeCells 部件 → 不变（array.xlsx 等旧夹具是红线样本）。
- **T3 工作表保护**：`[工作表 S1]` 行尾追加 `(受保护)`（对齐 `(隐藏)` 先例）；无 protection → 不变。
- **T4/T5 图片尺寸**：`[图片: alt (8.9×6.7cm)]`（EMU÷360000，round 2 位；DOCX 读 `wp:extent`、PPTX 读 `p:pic//a:xfrm/a:ext`）；读不到 extent → 保持 `[图片: alt]` 原样（红线）。像素/DPI 暂不做（可选扩展记下）。
- **T6 图表次轴+类型**：`[坐标轴]` 行在存在第二个 valAx 时追加 ` · 次数值轴: 标题`；plotArea 多 plot 组或 grouping≠clustered/standard 时补类型行（如 `[图表类型] 堆积柱形 · 组合`）。单组 clustered（phase4w chart.xlsx 基线）→ 逐字不变（红线）。

## 3. 装置与命令（本轮已跑通）

- 夹具：`phase49-make.py`（rev/pic.docx/pic.pptx/merged）+ `phase49-make2.py`（combo_full/combo_min 注入）。
- 探针：`phase49-probe.cjs`（electron stub + tsout require 套路同 phase4w-selftest）。
- tsc 重编（tsout 会被清掉，直接复用）：
  `npx tsc electron/main/document-preview.ts --module commonjs --moduleResolution node --target es2022 --lib es2022,dom --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron --esModuleInterop --skipLibCheck --resolveJsonModule`
- 跑自测：`$env:NODE_PATH='F:/soft/00selfmade/ecclaw/node_modules'`（必须）。

## 4. 本轮新增避坑

1. openpyxl 3.1.5 `BarChart()+LineChart()` 抛 `Cannot combine instances of different types` → 组合图夹具只能**手工注入 chart1.xml**。
2. 注入的 chart 必须带完整 drawing 链（worksheet `<drawing r:id>` → drawing1.xml → chart1.xml + 三处 rels/CT）——**只有 chart 部件时产品完全不出图**（combo_min 实证）。后续夹具注意。
3. 线程批注 `(已解决)` 早已实现——别按旧候选清单重做。
4. combo 探针 GAPCHECK 的 `s1/s2/l1` 在 min 夹具里被表头行假阳命中——判读要看块内容，别只看 FOUND。

## 5. 下一步（15:00 块）

1. 按 §2 T1–T6 实现（八步法第 3 步起）；2. `phase49-selftest.cjs`（含 6 条红线断言）；3. `phase49-e2e.cjs`（先起 8898+8897、重启 Electron）；4. `rerun-and-regress82.cjs` 全量回归（run81 副本加 phase49 套件；phase3r B3/C3 既有环境红可接受）；5. README §5.53 + task.md + 记忆 + final handoff + 两条提交（feat/docs，精确 add）。

## 6. 必读顺序

1. 本篇（T1–T6 设计已定稿，逐项确认从简——用户已授权自主选择）。
2. `handoff-ecclaw-phase4w-final-2026-11-07.md` §4/§7/§8。
3. `document-preview.ts` 相关处：修订行 ~L1028、`parseChartInfo` ~L1617-1711、图片 alt（DOCX/PPTX 各一）、XLSX sheet 解析。
