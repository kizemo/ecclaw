# handoff · ecclaw phase4s FINAL(XLSX 四缺口 + DOCX alt 兜底)· 2026-11-07

## 状态：已收官并提交

- 只改 `electron/main/document-preview.ts`；契约 / `host-bridge.ts` / `host-server.mjs` / `src/App.tsx` 未动；
  **MCP 工具数仍 27**；无新增依赖。
- 基线：phase4r = `7130c4e`；功能提交 **`f99ab3d`**；文档提交见 §6。

## 交付内容（五件事）

1. **定义名称**：`xl/workbook.xml` 的 `definedNames` → 文档级置顶行
   `[定义名称] 销售额 → 数据!$A$1:$A$10 · Print_Area (工作表「数据」) → 数据!$A$1:$D$20`；
   `_xlnm.` 内建前缀剥离、`localSheetId` 越界不标作用域、空值跳过、XML 实体解码。
2. **数据校验**：worksheet 的 `dataValidations` → 工作表末行 `[数据校验] C2:C20: 列表(是,否,待定)`；
   类型 / 操作符译中文短语（认不出原样）；`type=none/any` 跳过；list 引号内=字面选项，
   引用区域原样显示公式；`between/notBetween` 拼 `f1~f2`。
3. **表格对象**：工作表 rels Type 结尾 `/table` → `xl/tables/tableN.xml` → `[表格] 销售明细表 (A1:C10)`
   紧跟 `[工作表 X]` 表头行；多表「 · 」拼接；`name` 空退 `displayName`。
4. **线程批注（Excel 365）**：`xl/threadedComments/*.xml` + `xl/persons/person.xml` → 单元格内联
   `[批注(王五): …] [回复(赵六): …]`；作者经 `personId → displayName`；回复摊平挂根（DOCX 同套路）；
   `resolutionState` resolved→`(已解决)`、accepted→`(已接受)`、未知态不标；父未知与成环 → 独立批注；
   rels 缺失按命名约定 `xl/threadedComments/threadedComment{N}.xml` 兜底。
5. **DOCX 图片 alt 第三兜底源**：`wp:docPr` 的 `descr`/`title` 全空时退读 `pic:cNvPr@descr`
   （WPS / LibreOffice 写法）；优先序 descr → title → cNvPr@descr 不动。

**回归红线**：没有这些部件的文档，输出与改动前**逐字一致**（自测第 7 组 + e2e 断言锁死）。

## 证据

- 秒级自测 `C:/Temp/ecclaw-verify/phase4s-selftest.cjs` → **45/45**
- e2e `C:/Temp/ecclaw-verify/phase4s-e2e.cjs` → **36/36**（`run77-phase4s.log`）
- 全量回归 `C:/Temp/ecclaw-verify/run77-summary.txt`（三十一套，run77-* 日志）：
  全绿，**两处非产品红**：
  - `phase3r` C3 = 事件库 **2369 条 > 回放硬上限 2000**（`host-events.ts:409`）既有环境失败（与 run76 同因）。
  - `phase4o` C = **断言过期**（新增文档级 `[定义名称]` 行后，工作表行不再紧邻元数据行）→
    已把位置锁死断言改成顺序断言后复跑 **17/17**（脚本级、零产品改动）。
  未跑真站 phase3s / phase3q（红线）。
- 夹具 `C:/Temp/ecclaw-verify/st4s/`（复用 probe4p 真 fixture + 手造 8 个）；生成器 `phase4s-make.cjs`。
- tsout 编译口径（沿用 phase4r）：
  `npx tsc electron/main/document-preview.ts electron/main/paths.ts electron/shared/types.ts --rootDir electron --outDir C:/Temp/ecclaw-verify/tsout --module commonjs --target es2022 --lib es2022,dom --esModuleInterop --skipLibCheck`
  + `NODE_PATH=F:/soft/00selfmade/ecclaw/node_modules`。

## 下一轮

按 `handoff-ecclaw-phase4p-pdf-2026-11-06.md` §4 剩余候选：**B 组（三格式图表 chart parts 文本化）**

- 候选清单已过期 **9** 次：**先探针复验 + 扫新轴**，别照抄（phase4s 探针抓到 phase4r 残余真缺口
  `pic:cNvPr@descr`，同时证伪两条伪缺口）。
- B 组：DOCX `word/charts/chart1.xml` · XLSX `xl/charts/chart1.xml` · PPTX `ppt/charts/chart1.xml`
  → 图表标题 + 系列名文本化（probe 实测三格式各缺 2/2）。
- 相邻轴（选则先探针）：PPTX 线程批注（phase4n 做过一代）、PPTX/XLSX 图片 alt（本轮前均已覆盖）。
- 已证伪别再选：DOCX 文本框 · PPTX 新版批注回复正文 · DOCX `descr` 在时输出 title ·
  PPTX 厂商串 "Microsoft PowerPoint"（实为 "Microsoft Office PowerPoint"）。
- 产品改动仍只落 `document-preview.ts`；工具数保持 27。

## 避坑

1. **`previewDocument` 只收文件库内路径**（越界抛「路径越界」）→ 秒级自测对真 fixture 必须先拷进
   `fake-userdata/.../file-library/files`；XLSX 可直调导出的 `extractXlsxText(path)`，
   但 **DOCX 没有导出函数**（`extractDocxText` 只吃 parts）→ DOCX 只能走 `previewDocument`。
2. **旧套件的位置锁死断言会过期**：phase4o 断言 `lines[1] === '[工作表 数据]'`，
   新增文档级行后即失效 → 改成顺序断言（工作表行之前只允许文档级标记行）。
   以后新增**文档级**输出行时，记得回头看旧套件有没有锁死行号。
3. 同格「旧式批注 + 线程批注」共存是两个 marker 空格拼接 —— e2e 断言用 `includes`，别断全行。
4. `threadedComment` 属性里 `id=` 正则靠大小写天然避开 `personId` / `parentId`（都大写 Id）。
5. **真机验证前必须 `pnpm build`**：Electron 主进程跑的是 `out/main/index.js` 打包产物，
   只 `tsc` 到 tsout 不生效；改完主进程 → `pnpm build` → 全杀 electron 再起（9222 单实例，
   旧实例会占着端口导致测的是旧代码）。
6. e2e 的 `send()` 必须带超时（90s），否则 Electron 掉线会挂死整轮回归。

## 相关

`handoff-ecclaw-phase4s-wip-2026-11-06.md`（上一轮 WIP）· `handoff-ecclaw-phase4r-final-2026-11-06.md` ·
`handoff-ecclaw-phase4p-pdf-2026-11-06.md` §4 · 项目记忆 `ecclaw_phase4s_xlsx_extras.md`。
