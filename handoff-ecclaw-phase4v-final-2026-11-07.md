# handoff · ecclaw phase4v（第四十七阶段）· FINAL

> 上阶段：`F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase4u-final-2026-11-07.md`。
> 本轮状态：✅ **全部收官（2026-11-07 下一会话补完）**：run80 三十四套回归绿（phase4v 17/17、phase4m 改断言后 50/50、phase3u 复位 graytest 指针后 24/24，唯一失败 phase3r C3 既有环境红）；feat + docs 两笔提交完成；MEMORY.md 索引行已补；task.md 第四十七段已移到第四十六段之后。**下一会话任务 = §5 探针复验 → 第四十八阶段选题。**

## 1. 完成摘要
第四十七阶段 = DOCX 域代码标记 + XLSX 数组/共享公式范围 + XLSX 外部链接目标。
只改 `F:\soft\00selfmade\ecclaw\electron\main\document-preview.ts`；工具数仍 27；无新增依赖。

## 2. 改动清单（均已落盘，未 commit）
- `docxFieldMarks()` 新增（栈式 fldChar/instrText/fldSimple；separate 即出；HYPERLINK→`[链接: URL]`；80 字符截断）+ 挂 `docxExtras()`。
- `Cell.formulaKind/formulaRef` + 标记 `[公式: …(数组→C1:C3)]` / `(共享→D1:D3)`（follower/普通不变）。
- `XLSX_EXT_LINK_RE` / `XLSX_EXT_LINK_RELS_RE` + `parseXlsxExternalLinks()` → 置顶 `[外部链接] [N] Sheet1 → 路径`。
- README §5.51 + 能力清单一行；task.md 状态行 + 第四十七段（**暂插在第四十六段之前**，顺手后移）。

## 3. 测试证据（已跑部分）
- `C:\Temp\ecclaw-verify\phase4v-selftest.cjs` 20/20；`phase4u-selftest.cjs` 27/27；`phase4m-selftest.cjs` 改断言后 72/72（改的两行：`40 [公式: SUM(A1:A3)(数组→A4:A6)]`、`2 [公式: B1*2(共享→A1:A3)]`）。
- `C:\Temp\ecclaw-verify\phase4v-e2e.cjs` 17/17 —— 用法 `node phase4v-e2e.cjs "C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw\mcp\host-server.mjs" "C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw\host-bridge.json"`（Electron 9222 需已起，代码已 `pnpm build`）。

## 4. 下一轮必交付（按序）
1. **全量回归 run80**：先起 fixture server 8898（`fixture-server.cjs`）+ 8897（`fixture-writer.cjs`），复制 `C:\Temp\ecclaw-verify\rerun-and-regress79.cjs` → `rerun-and-regress80.cjs`（前缀 run79→run80，套清单加 phase4v；phase3r C3 是既有环境红别追；不跑 phase3s/3q 真站套件）。
2. **提交**（feat 一条含 document-preview.ts；docs 一条含 README/task.md/handoff/prompt/记忆）；**精确 git add，禁 add -A**。
   补遗：`E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\MEMORY.md` 索引行未加（闸门拦 Read 致 Edit 前置不满足），请补一行：
   `- [ecclaw 第四十七阶段：DOCX 域代码 + XLSX 公式范围/外部链接](ecclaw_phase4v_fields_extlinks.md) — 域指令 separate 即出；HYPERLINK 域归[链接:]；f@ref 只在 master；外部链接[N]=次序；run80 回归与提交遗留下一会话`
3. 探针复验本节候选 → 选题第四十八阶段。

## 5. 下一轮候选清单（**本轮未做探针复验，全部待验，会过期**）
| 候选 | 本轮证据 | 预判 |
|---|---|---|
| PPTX 母版/版式文本 | 上上轮判低价值 | 探针复验 |
| DOCX OLE / 自定义 XML | 中缺口工程量大 | 探针复验 |
| PDF 内嵌附件（GetEmbeddedFiles） | **未扫过的新轴**（不可再生信息，类比外部链接） | 优先探针 |
| DOCX 文本框位置标记 | 内容已出、只丢「这是文本框」标记 | 低价值 |
| XLSX 外部链接缓存值 | 本轮只出路径；`sheetDataSet` 缓存未出 | 探针看信息量 |
| 图表数据标签/图例开关 | 未扫 | 扫一遍 |

## 6. 环境基线
- 分支 main，HEAD = `81c3be3`（上轮 docs 提交）；本轮改动**全部未提交**。
- 已 `pnpm build` 且 Electron(9222) 已载新代码（e2e 17/17 即证）。
- 临时产物：`C:\Temp\ecclaw-verify\phase4v-*`（make.py / probe.cjs / selftest.cjs / e2e.cjs / 夹具目录 `phase4v/`）。

## 7. 避坑（本轮新增）
1. 域标记挂 `docxExtras()` 尾部 → 表格单元格/页眉同样生效；无域文档逐字不变（回归红线已断言）。
2. openpyxl `ArrayFormula` 文本带 `=`；`<c>` 放进所属 `<row>`；rels 部件放 `_rels/` 目录。
3. host-server.mjs 在 `.openclaw/mcp/` 子目录。
4. 改 `[公式: ]` 格式会红旧套件：phase4m 已改；回归若 phase4t/4u 有相关断言同样先看实际输出。

## 8. 必读顺序
1. 本篇。2. `handoff-ecclaw-phase4u-final-2026-11-07.md` §6/§8。
3. `electron/main/document-preview.ts`：`docxFieldMarks` / `parseXlsxExternalLinks` / `rangeTail` 处。
4. `C:\Temp\ecclaw-verify\phase4v-selftest.cjs` + `phase4v-make.py`。
