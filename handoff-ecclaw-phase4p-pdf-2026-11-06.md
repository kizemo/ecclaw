# handoff · ecclaw phase4p（PDF 全家桶）· WIP · 2026-11-06

> **状态**：功能代码已写完并本地验证通过，**但尚未 commit**（写 handoff 时撞上 ctx-budget-guard
> 160K 硬闸门，Bash 被禁）。下一会话第一件事就是补 commit（命令见 §6）。
>
> 验证：`phase4p-selftest.cjs` **18/18** · phase4p 探针 PDF 项 **11/11** ·
> `pnpm typecheck` ✅ · `pnpm build` ✅ · 现有 PDF 三套 e2e 全绿（phase3v 29/29 · phase4e 21/21 · phase4f 26/26，0 FAIL）。
> **未做**：phase4p 专属 e2e、全量回归 run74、README §5.45、task.md、项目记忆索引。

## 1. 本轮交付（只做了 A 组：PDF 全家桶）

用户在「实测缺口列表」上勾选了 A/C/B/D+E+F 四组（自动选择）。因上下文预算，
**本轮只落 A 组（PDF 链接 / 注释 / 表单域 / 元数据，10 项）**，其余 29 项按 §4 排期留给后续会话。

改动文件：**只改 `electron/main/document-preview.ts`**（契约 / host-bridge / host-server.mjs / App.tsx 未动，
**MCP 工具数仍 27**）。

- 新增 `interface PdfAnnotation`（subtype / url / contentsObj / titleObj / fieldName / fieldValue / dest）。
- `PdfPage` 加可选 `getAnnotations?()`；`PdfDocument` 加可选 `getMetadata?()`。
  （跟 `getOutline` 一个套路：别的实现没有这两个方法就跳过，不崩。）
- 新函数：`pdfDateText()` · `pdfInfoLine()` · `pdfMetadataLine()` · `pdfDestPage()` · `pdfAnnotationMarks()`。
- `previewDocument()` 的 PDF 分支：注释标记挂在**每页正文后面**；元数据行置顶。

## 2. 输出口径（本轮定的，后续组沿用同一套约定）

| 类别 | 标记 | 落位 |
|---|---|---|
| PDF 元数据 | `[文档信息] 标题: … · 作者: … · 主题: … · 关键词: … · 创建工具: … · 生成器: … · 创建时间: …` | 置顶一行，空字段逐个省略，全空不出行 |
| PDF 外部链接 | `[链接: https://…]` | 页正文后 |
| PDF 内部跳转 | `[跳转: 第 N 页]`（页号解析不出 → `[跳转: 内部链接]`） | 页正文后 |
| PDF 便笺 | `[注释(作者): 正文]`（无作者 → `[注释: 正文]`） | 页正文后 |
| PDF 表单域 | `[表单: 字段名 = 值]`（无值 → `[表单: 字段名]`） | 页正文后 |

- PDF 日期串 `D:20260101120000Z` → `2026-01-01 12:00:00`（`pdfDateText`；认不出来原样返回）。
- **没有注释、没有元数据的 PDF，输出与改动前逐字一致**（自测第 2 组守这条）。

## 3. 实测证据

- 探针（复验 + 新轴）：`C:/Temp/ecclaw-verify/phase4p-probe.cjs` → 结果 `probe4p-result.txt`（改码前）
  与 `probe4p-result2.txt`（改码后）。fixture 在 `C:/Temp/ecclaw-verify/probe4p/`。
  生成器 `phase4p-make.cjs`。**19 fixture / 51 探针串 / 3 个控制组全绿**（DOCX 脚注 · XLSX 条件格式 · PPTX 备注）。
- 自测：`C:/Temp/ecclaw-verify/phase4p-selftest.cjs` → 18/18。
- e2e 日志：`C:/Temp/ecclaw-verify/run74-phase3v.log` / `run74-phase4e.log` / `run74-phase4f.log`。

## 4. 还没做的 29 项缺口（探针实测为真缺口，下轮候选）

> 探针脚本与 fixture 已在 `C:/Temp/ecclaw-verify/`，**直接复用，不要重造**。
> 候选清单已过期 8 次；下轮仍要**先探针复验 + 扫新轴**再选题。

| 组 | 项 | 部件 | 探针命中 |
|---|---|---|---|
| **C** docProps 扩展 | app.xml（应用/公司/页数/字数） | `docProps/app.xml` | 0/6（三格式） |
| **C** docProps 扩展 | custom.xml（自定义属性） | `docProps/custom.xml` | 0/6（三格式） |
| **B** Office 图表 | DOCX 图表标题 + 系列名 | `word/charts/chart1.xml` | 0/2 |
| **B** Office 图表 | XLSX 图表 | `xl/charts/chart1.xml` | 0/2 |
| **B** Office 图表 | PPTX 图表 | `ppt/charts/chart1.xml` | 0/2 |
| **D** DOCX | 尾注 | `word/endnotes.xml` | 0/1 |
| **D** DOCX | 图片 alt | `wp:docPr@descr` / `@title` / `pic:cNvPr@descr` | 0/3 |
| **E** XLSX | 定义名称 | `xl/workbook.xml` 的 `definedNames` | 0/2 |
| **E** XLSX | 数据有效性 | worksheet 的 `dataValidations` | 0/1 |
| **E** XLSX | 表格对象 | `xl/tables/table1.xml` | 0/1 |
| **E** XLSX | 线程批注（Excel 365） | `xl/threadedComments/*` + `xl/persons/person.xml` | 0/2 |
| **F** DOCX | 批注回复 | `word/commentsExtended.xml`（paraIdParent） | 0/1 |

**已被探针证伪（别再选）**：
- DOCX 文本框 `w:txbxContent` → **已覆盖 3/3**（正则意外命中，还独立成行）
- PPTX 新版批注回复**正文** → **已覆盖 2/2**（只缺「回复关系」标记，价值低）
- 此前已确认非缺口：DOCX 页眉页脚、XLSX 隐藏工作表

**建议排期**：C（12 项，改动最小，接 phase4o 最自然）→ D+F（5 项，纯 DOCX）→ E（6 项，纯 XLSX）→ B（6 项，三格式各一个部件）。

## 5. 环境 / 复跑命令

- 项目根 `F:\soft\00selfmade\ecclaw`；基线提交 `382bc93`（phase4o docs）。
- tsout 编译（**必须在项目根跑**）：
  ```
  cd F:/soft/00selfmade/ecclaw && npx tsc electron/main/document-preview.ts --module commonjs \
    --target ES2022 --moduleResolution node --esModuleInterop --skipLibCheck \
    --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron
  ```
- 跑自测/探针前 `export NODE_PATH="F:/soft/00selfmade/ecclaw/node_modules"`。
- e2e 参数：`<hostServer>` = `C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs`，
  `<bridge>` = `.../.openclaw/host-bridge.json`；套件脚本吃 `node <suite>.cjs <hostServer> <bridge>`。
- 改主进程后必须重启 Electron（`C:/Temp/ecclaw-verify/start-electron.ps1`；先 `taskkill //F //IM electron.exe`）。
- 产物前缀下一轮用 `run74-*`（run73 已被 phase4o 用掉）。

## 6. 下一会话必做（按顺序）

1. **补 commit**（本轮被 ctx 闸门挡住，代码还在工作区）：
   ```
   cd F:/soft/00selfmade/ecclaw
   git add electron/main/document-preview.ts
   git commit -m "feat(document-preview): add PDF links, annotations, form fields and metadata"
   ```
   然后单独一条 `docs:` 回填 hash（**不 amend**）。
2. README §5.45 + 底部能力清单（补 PDF 链接 / 注释 / 表单域 / 元数据）。
3. task.md 顶部状态段 + 「第四十一阶段」交付表 + 实证发现。
4. 项目记忆 `ecclaw_phase4p_pdf.md` + `MEMORY.md` 索引（**本轮也没写成**）。
5. 写 `phase4p-e2e.cjs`（真 Electron + MCP stdio，走 `ecclaw_document_preview` 验 PDF 标记）+ 全量回归 `run74-*`。
   已知环境问题：**事件库已 >2000 条**，`electron/main/host-events.ts:409` 回放硬上限 2000 会让 phase3r 的 C3 假红 ——
   **当环境失败判读，别当产品回归**；复跑另见 G3/G4 实时流时序抖动。
6. 后续轮次做 §4 的 C → D+F → E → B 四组。

## 7. 踩坑（本轮实测）

1. **手搓 PDF fixture 的对象编号容易错位**：catalog=1 pages=2 page=3 font=4 content=5，**注释从 6 开始**。
   我第一次把注释写成 5 → `/Annots` 指到 content stream → 表单域整段丢失（误判成产品 bug）。
2. **PDF 里的中文串要按 UTF-16BE + BOM 写成十六进制串**（`<FEFF…>`）。直接 `Buffer.from(s,'latin1')`
   会把中文截成低字节 → pdfjs 读出来是乱码（`Title: "PDF ⁄c\u0007Ÿ"`），**不是产品问题**。
3. **表单域必须要有 `/AcroForm`**（catalog 里 `<< /AcroForm << /Fields [...] >> >>`），
   否则 pdfjs 不把 Widget 当表单域，`fieldName` / `fieldValue` 都是空。
4. **DOCX 文本框文字其实抽得到**：`docxRuns` 的正则 `<w:r>…</w:r>` 非贪婪匹配到内层 `</w:r>`，
   把文本框里的 `w:t` 一起吞了 —— 别再把「文本框」当缺口。
5. ctx-budget-guard 160K 是**硬闸门**：拦 Bash/Read/Grep/Glob/Task/Agent/WebFetch，只放行 Write/Edit。
   被拦时唯一正确动作就是写 handoff + 开新会话（本轮就是这么断的）。

## 8. 相关

`handoff-ecclaw-phase4o-final-2026-11-06.md`（上一轮 FINAL）· `prompt-ecclaw-phase4p-next.md`（下一轮指针）·
项目记忆 `ecclaw_phase4o_docprops.md`（docProps 口径的来龙去脉）。
