# handoff · ecclaw 第二十三阶段（phase3x）· PPTX / XLSX 抽取 · 2026-11-04

> **一句话结论**：在 phase3w 的文档预览上补 **PPTX / XLSX 文本抽取**（复用 DOCX 同一条 `fflate` zip+XML 路线，
> **不引新依赖**）。MCP 工具数**仍是 27**（只改 `ecclaw_document_preview` 描述）。
> `phase3x-e2e.cjs` **41/41 全绿**，全量回归 **run55 十套 340/340 全绿**（实测，见 §4）。
>
> **本轮状态**：代码 / typecheck / build / e2e / 全量回归均已就绪；**全部未 commit**（项目非 git 仓库）。

---

## 1. 本轮必读顺序

1. 本文档
2. `handoff-ecclaw-phase3w-final-2026-11-03.md`（上一阶段：DOCX 抽取 + PDF 位图）
3. `handoff-ecclaw-phase3v-final-2026-11-03.md`（文档预览起点：PDF 文本预览 + 路径守卫）
4. `README.md` §5.27 / §8 · `task.md` 顶部状态段与第二十三阶段表
5. `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\ecclaw_phase3x_pptx_xlsx.md`
   （中央目录偏移 / PPTX 版式序 / XLSX 三类值 / 空白归一化 / tsc 单文件自测法）
6. `prompt-ecclaw-phase3x-next.md`（下一阶段指针）

---

## 2. 交付清单（全部未 commit）

| 文件 | 改动 |
|---|---|
| `electron/main/document-preview.ts` | ①`listZipEntryNames()`（读 **zip 中央目录** 取条目名，取代「探头部/尾部找子串」）；②`detectZipDocumentKind()`（docx/pptx/xlsx 判定，**读不出中央目录时回退**老的子串探测）；③`detectDocumentKind()` 改走新路径；④`readZipEntries()`（`unzipSync` + `filter` + `originalSize <= MAX_ENTRY_BYTES`(16MB)）；⑤`parseRels()` / `resolveRelTarget()` / `decodeEntry()`；⑥`extractPptxText()` / `pptxParagraphText()` / `pptxSlideText()` / `slideNo()`；⑦`extractXlsxText()` / `parseSharedStrings()` / `colFromRef()` / `cellRawValue()` / `parseXlsxSheet()`；⑧`previewDocument()` 合并 DOCX/PPTX/XLSX 分支（错误文案 `X 里没有可抽取的文字` / `X 解析失败：`）；⑨提示语改为「暂只支持 PDF / DOCX / PPTX / XLSX 预览」 |
| `electron/shared/types.ts` | `DocumentKind` 增 `'pptx' \| 'xlsx'` |
| `src/App.tsx` | 文件库条目加「PPTX 预览」/「XLSX 预览」标签；`open()` 路由 `/\.(docx\|pptx\|xlsx)$/i`；`doc-preview-meta` 增加 `PPTX · 文本预览` / `XLSX · 文本预览`；文本预览块 docx/pptx/xlsx **共用** `doc-preview-text` |
| `resources/mcp/host-server.mjs` | **只改描述**（支持 PDF/DOCX/PPTX/XLSX）。**MCP 工具数仍 27** |
| `README.md` | 新增 §5.27「PPTX / XLSX 抽取」；§8 状态列表补 §5.26 / §5.27 两条 |

### 临时资产（`C:\Temp\ecclaw-verify\`）

- `make-office.cjs`（生成 `deck.pptx` 2063B / `table.xlsx` 2388B / `empty.xlsx` 2195B 夹具，fflate 现场打 zip）
- `phase3x-e2e.cjs`（**41 条断言**）
- `rerun-and-regress7.cjs`（**run55-\*** 驱动，10 套，不跑真站）
- `tsout/`（`tsc` 单文件转译产物 + 假 `node_modules/electron` stub，用于秒级自测，见 §3.6）

---

## 3. 关键设计决策（可迁移）

1. **判 Office 类型改读 zip 中央目录**（不再「探头部/尾部各 128KB 找条目名子串」）：
   文件尾找 **EOCD**（`PK\x05\x06`）→ `cdSize @12` / `cdOffset @16` → 逐条读中央目录取条目名。
   判据：`word/document.xml` → docx；`ppt/presentation.xml` → pptx；`xl/workbook.xml` → xlsx。
   **读不出中央目录时回退老的子串探测**（保底，未删）。
2. **中央目录文件头偏移 ≠ 本地文件头偏移（本轮最大的坑）**：
   文件名长度 **@28**、扩展长度 **@30**、注释长度 **@32**、**文件名 @46**。
   （本地文件头才是 26/28/30 + 名字 @30 —— 写混了会把条目名读成乱码，
   症状是 `kind` 全判成 `other` 而解压却仍正常，**病因与症状分离**，极难一眼看出。）
3. **PPTX 版式顺序看 `sldIdLst`，不是文件名**：
   `ppt/presentation.xml` 里只有 `r:id`，真实路径在 `ppt/_rels/presentation.xml.rels`；
   放映顺序取 `<p:sldIdLst>`，读不到再按 `slideN.xml` 编号排。文字取 DrawingML 的 `<a:t>`，
   `<a:br/>` 记为换行。输出以 `[幻灯片 N]` 分隔。
4. **XLSX 表名在 workbook，单元格值有三种来源**：
   顺序 + 表名只在 `xl/workbook.xml` 的 `<sheets>`（路径经 `xl/_rels/workbook.xml.rels` 映射）；
   值：`t="s"` → sharedStrings 下标；`t="inlineStr"` → `<is><t>`；其余（数字 / `t="str"` / `t="b"`）→ `<v>` 原始值。
   **按单元格引用列号落位**（`B7` → 第 2 列，A=0、AA=26），缺列**补空**，行渲染成 `a | b | c`，尾部空列剪掉。
   输出以 `[工作表 表名]` 分隔。
5. **本轮明确不做 XLSX 日期还原**：日期在 xlsx 里是序列号，还原要读 `styles.xml` 的 numberFormat → 本轮原样给数字。
6. **快速验证姿势（值得复用）**：改完解析代码**不要直接进 Electron 循环**。用 `tsc` 把
   `electron/main/document-preview.ts` 单独转成 CJS，配一个假 `node_modules/electron`（导出 `app.getPath/getAppPath`）
   + `NODE_PATH` 指到项目 `node_modules`，就能在普通 node 里直接调
   `detectDocumentKind` / `extractPptxText` / `extractXlsxText`，**秒级**发现「类型全判成 other」这类问题
   （真实 e2e 走 Electron 一轮要几分钟）。本轮正是靠它避免了带着 bug 进 Electron。
7. **`normalizeText` 会吃掉「双空格」**：`/[ \t\u00a0]+/ → ' '` 是全局行为（PDF/DOCX 一致），
   「缺列补空」渲染出的 `合计 |  | 58` 会变成 `合计 | | 58` → **e2e 断言按归一化后的样子写**。

---

## 4. 验证证据（实测）

- `pnpm typecheck` ✅ / `pnpm build` ✅（renderer `index-ChwETOxq.js` 658.13 kB）
- **phase3x e2e：41/41 全绿**
  工具面 3 · 清单 4 · PPTX 11 · XLSX 12 · DOCX/PDF 回归 2 · 界面 9
  关键实测：`kind=pptx` / `kind=xlsx`；清单里 DOCX/PDF 判定未回归；
  PPTX 抽出「季度复盘」「营收 & 利润」「要点一↵要点二」「下季度计划」「渠道 A <华东>」，
  含 `[幻灯片 1]` / `[幻灯片 2]` 分隔；`pageCount=null` / `pages=[]` / `truncated=false`；
  XLSX 抽出「[工作表 报价] 款号 | 颜色 | 单价」「A102 | 米白 | 58」「合计 | | 58」「[工作表 说明] 报价以人民币计」；
  空 XLSX → `XLSX 里没有可抽取的文字`；`maxChars=8` → `truncated=true`；
  界面 `PPTX · 文本预览` / `XLSX · 文本预览` 且文本可见。
  （首轮 40/41，唯一红 = **断言写了双空格** `合计 |  | 58`，实际归一化后是 `合计 | | 58` → 改断言后全绿，
  **产品代码零改动**。）
- **run55 全量回归（`C:\Temp\ecclaw-verify\run55-summary.txt`，实测）**：
  phase3x 41 · phase3w 27 · phase3v 29 · phase3u 24 · phase3t 16 · phase3r 31 · phase3p 45 · phase3o 44 · phase3m 69 · sse 14
  → **合计 340 PASS / 0 FAIL**。
  **未跑真站套件 phase3s / phase3q**（本阶段红线「不碰淘宝」，summary 末行已注明）。

---

## 5. 环境基线（收官实测）

| 项 | 值 |
|---|---|
| 项目根 | `F:\soft\00selfmade\ecclaw`（非 git） |
| Node | 系统 v26.13.0；Electron 内 Node v24.22.1 |
| 新依赖 | **无**（沿用 phase3w 引入的 `fflate@0.8.3`） |
| stateDir | `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw` |
| 文件库 | `<stateDir>\file-library\files` |
| MCP 工具数 | **27**（本轮未新增） |
| e2e 遗留物 | 文件库新增 `ecclaw-phase3x-汇报.pptx` / `-报价表.xlsx` / `-empty.xlsx` / `-报价单.docx` / `-sample.pdf`（只增不删） |

---

## 6. 复现命令

```bash
cd /f/soft/00selfmade/ecclaw && pnpm typecheck && pnpm build
cd /c/Temp/ecclaw-verify && node make-office.cjs
node C:/Temp/ecclaw-verify/stop-electron.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Temp/ecclaw-verify/start-electron.ps1"
node C:/Temp/ecclaw-verify/phase3x-e2e.cjs <hostServer> <bridge>
node C:/Temp/ecclaw-verify/rerun-and-regress7.cjs   # run55-*
```

> 注意：`stop-electron.cjs` 失败会中断 `&&` 链，其 fetch 报错是**正常现象**。

---

## 7. 红线（照旧）

- 禁删用户文件；e2e 写进文件库的 `ecclaw-phase3x-*` 也留着别删。
- 禁 `git init` / `commit`；`openclaw.json` / `host-bridge.json` 勿外传。
- 本阶段不碰淘宝（phase3s / phase3q 未跑）。
- 临时产物写 `C:\Temp\`；handoff/task 不进 `memory/`。
- GUI 验证走 CDP；无人值守 e2e 期间勿碰 GUI 卡片。

---

## 8. 下一阶段候选（写进 prompt 时只留指针）

- XLSX **日期还原**（读 `styles.xml` 的 numberFormat，本轮明确未做）。
- DOCX 表格保留结构（现在已按行列展开，若要 markdown 表格可增强）。
- PDF 多页缩略图 / 指定页渲染参数（`scale` 已支持，界面未暴露）。
- 邮件 worker（外发副作用，需显式确认）。
- 画布宿主（新事件 kind）。
- 欠账：真站套件 phase3s / phase3q（需先问过淘宝）。
