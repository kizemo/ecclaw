# handoff · ecclaw phase4s WIP(XLSX 四缺口 + DOCX alt 兜底)· 2026-11-06

> **状态**:功能代码已写完,秒级自测全绿,**尚未 commit**(本轮 ctx 63%→70% 触发收尾纪律,
> e2e / 全量回归 / 文档收尾全部未做)。下一会话第一件事 = 补 e2e + run77 回归,全绿后才提交。

## 1. 本轮交付(五件事,只改 `electron/main/document-preview.ts`)

选题经探针复验(probe4p 装置复用,结果 `C:/Temp/ecclaw-verify/probe4p-result5.txt` / 改码后 `probe4p-result6.txt`):

1. **定义名称**(E1):新函数 `parseXlsxDefinedNames`;`workbook.xml` 的 `definedNames` → 置顶一行
   `[定义名称] 销售额 → 数据!$A$1:$A$10 · Print_Area (工作表「数据」) → …`;`_xlnm.` 前缀剥离、
   `localSheetId` 越界不标、空值跳过、name 实体解码;与 docProps meta 行叠在一起(空行省)。
2. **数据校验**(E2):`parseXlsxDataValidations`;sheet 末行 `[数据校验] C2:C20: 列表(是,否,待定)`;
   类型/操作符译名表 `DATAVAL_TYPE_TEXT` / `DATAVAL_OPERATOR_TEXT`(认不出原样);`type=none/any` 跳过;
   list 引号内=字面选项、否则原样公式;between/notBetween 拼 `f1~f2`。
3. **表格对象**(E3):`parseXlsxTableLine`;sheet rels Type 结尾 `/table` → `[表格] 名字 (区间)` 行,
   紧跟 `[工作表 X]` 表头行;多表「 · 」拼;name 空退 displayName;外部 Target 跳过。
4. **线程批注 Excel365**(E4):`parseXlsxPersons` + `parseXlsxThreadedComments`;格内联
   `[批注(王五): …] [回复(赵六): …]`,回复摊平挂根(同 DOCX phase4r 套路);rels 缺失按命名约定
   `xl/threadedComments/threadedComment{N}.xml` 兜底;`resolutionState` resolved→(已解决)、accepted→(已接受)、
   未知态不标;成环 seen 兜底退化为独立批注;`xlsxCellExtras` 加第三参 `threaded`。
5. **DOCX alt 第三兜底源**:`docxRuns` 里 `wp:docPr` descr/title 全空时退读 `pic:cNvPr@descr`
   (WPS/LibreOffice 常见写法);优先级 descr>title>cNvPr descr 不动。

部件读取:`readZipEntries` 过滤器加 `XLSX_TABLES_RE` / `XLSX_THREADED_COMMENTS_RE` / `XLSX_PERSONS_ENTRY`。
契约 / host-bridge / host-server / App.tsx **未动**;**MCP 工具数仍 27**;无新依赖。

## 2. 证据(已有)

- 自测 `C:/Temp/ecclaw-verify/phase4s-selftest.cjs` → **45/45**(fixture 复用 probe4p + 手造 8 个)
- 探针复跑(改码后)result6:a4/a5/b5/b9/a2(含 cNvPr)全转绿,其余 14 项与改码前一致无回归
- tsout 编译口径同 phase4r(handoff-ecclaw-phase4r-final §证据),`tsc exit=0`

## 3. 下一会话必做(按顺序)

1. 重启 Electron:`C:/Temp/ecclaw-verify/start-electron.ps1`(先 `taskkill //F //IM electron.exe`,9222 单实例)
2. 写 `phase4s-e2e.cjs`(结构照抄 `phase4r-e2e.cjs`:CDP 9222 + MCP stdio 走 `ecclaw_document_preview`;
   覆盖五新轴真文件预览 + 红线对照;**断言数按实际数写**,别预估)→ 跑绿
3. 复制 `rerun-and-regress76.cjs` → `rerun-and-regress77.cjs`(前缀 run77,SUITES 首位加 ['phase4s', N])
   → 全量三十余套;phase3r C3 = 事件库 >2000 既有环境失败,判环境不判产品;**禁跑真站 phase3s/3q**
4. 全绿后提交(精确 git add,禁 -A):
   `git add electron/main/document-preview.ts` → feat 一条 → docs 回填 hash 一条(不 amend)
5. README §5.48(第四十四阶段;落笔前核 README 实际尾号)+ 底部能力清单
6. task.md 顶部状态段 + 第四十四阶段交付表(注意 task.md 极长,只追加顶部与表,勿全读)
7. 项目记忆 `ecclaw_phase4s_xlsx_extras.md` + MEMORY.md 索引;`handoff-*-final` + `prompt-*-next`(纯指针)

## 4. 避坑(本轮实测)

1. **`previewDocument` 只收文件库内路径**(resolveLibraryFile 越界即抛)→ 秒级自测对 probe4p 真文件
   必须先 `copyToLib` 拷进 `fake-userdata/.../file-library/files`;手造 xlsx 可直调导出的
   `extractXlsxText`;**DOCX 无导出函数**,必须走 previewDocument。
2. b9 同格「旧式批注 + 线程批注」共存输出是两个 marker 空格拼接——e2e 断言用 `includes`,别断全行。
3. 探针里 a2「图片标题属性」(descr 在时 title 不输出)与 b8「Microsoft PowerPoint」(厂商串实为
   "Microsoft Office PowerPoint")**都是伪缺口,别再修**;B 组图表(b2/b4/b7)是真缺口,排在 phase4s 之后。
4. `threadedComment` 属性里 `id=` 正则靠大小写天然避开 `personId/parentId`(都大写 Id)。
5. c2 控制文件逐字断言在自测第 7 组(`'[工作表 数据]\n状态\n超时 [颜色:红]'`),回归时它红了先看 E2/E3 装配。

## 5. 环境 / 基线

- 项目根 `F:\soft\00selfmade\ecclaw`;基线 HEAD=`7130c4e`(main,工作区有未提交改动 = 本轮全部代码)
- e2e 参数:`<hostServer>`=`C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs`,
  `<bridge>`=同目录上层 `host-bridge.json`;`node <suite>.cjs <hostServer> <bridge>`
- NODE_PATH=`F:/soft/00selfmade/ecclaw/node_modules`;产物前缀 **run77**

## 6. 相关

`handoff-ecclaw-phase4r-final-2026-11-06.md` · `handoff-ecclaw-phase4p-pdf-2026-11-06.md` §4 ·
`probe4p-result5/6.txt` · 项目记忆 `ecclaw_phase_workflow.md`(八步法)。
