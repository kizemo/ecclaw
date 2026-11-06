# handoff · ecclaw phase4r FINAL（DOCX 尾注 + 图片 alt + 批注回复）· 2026-11-06

## 状态：已收官

- 只改 `electron/main/document-preview.ts`；契约 / `host-bridge.ts` / `host-server.mjs` / `src/App.tsx` 未动；
  **MCP 工具数仍 27**；无新增依赖。
- 基线：phase4q = `c25e6a2`；功能提交 **`e448f2d`**。

## 交付内容

1. **尾注**：`word/endnotes.xml` 入抽取清单；脚注管道参数化（`docxNoteNumbers` / `parseDocxNotes` 带 kind）。
   正文内联 `[N]`（按引用顺序**独立计数**，与脚注可同为 `[1]`），`[尾注]` 段恒排 `[脚注]` 段之后，
   分隔符 id≤0 不进段，多段正文空格连接。
2. **图片 alt**：`docxRuns` 识别 `<wp:docPr>`：`descr` 优先、`title` 兜底，实体解码内联 `[图片: …]`；
   全空不出标记；`name`（「图片 N」）不进输出。表格单元格自动覆盖（走 run 渲染路径）。
3. **批注回复**：`parseDocxComments` 附带首段 `paraId`（本地名匹配）；`buildDocxCommentThreads` 解析
   `commentsExtended.xml` 的 `commentEx paraId→paraIdParent`；回复按 comments.xml 文档顺序**摊平挂根**
   输出 `[回复(作者): 文本]`；回复自带 `commentRangeStart` 跳过不重复出；父未知 → 独立批注；成环 seen 兜底。
4. **回归红线**：无 endnotes / 无 docPr alt / 无 commentsExtended 的文档，输出与改动前**逐字一致**
   （selftest th3/mix1 + e2e 断言锁死）。

## 证据

- 秒级自测 `C:/Temp/ecclaw-verify/phase4r-selftest.cjs` → **19/19**
- e2e `C:/Temp/ecclaw-verify/phase4r-e2e.cjs` → **26/26**（`run76-phase4r.log`）
- 全量回归 `C:/Temp/ecclaw-verify/run76-summary.txt`（三十套）：全达标；
  phase3r C3 仍为**事件库 >2000 条 / 回放硬上限 2000**（`host-events.ts:409`）既有环境失败。
  未跑真站 phase3s / phase3q（红线）。
- tsout 编译口径（本轮验证可用）：
  `npx tsc electron/main/document-preview.ts electron/main/paths.ts electron/shared/types.ts --rootDir electron --outDir C:/Temp/ecclaw-verify/tsout --module commonjs --target es2022 --lib es2022,dom --esModuleInterop --skipLibCheck`
  + `NODE_PATH=F:/soft/00selfmade/ecclaw/node_modules`。

## 下一轮

按 `handoff-ecclaw-phase4p-pdf-2026-11-06.md` §4 剩余候选：**E（XLSX）→ B（图表）**

- 候选清单已过期 8 次：**先探针复验 + 扫新轴**，别照抄。
- E 组：XLSX 定义名称 / 数据有效性 / 表格对象（ListObject）/ 线程批注（threaded comment 的 modernComment 决议态）。
- B 组：三格式图表（chart parts 文本化）。
- 本轮没碰的邻近轴（下一轮若选要先探针）：PPTX / XLSX 的批注回复（PPTX 线程批注 phase4n 做过一代、
  XLSX 线程批注未做）；PPTX 图片 alt 已有（phase4k）。
- 已证伪：DOCX 文本框、PPTX 新版批注回复正文 —— 别再选。
- 产品改动仍只落 `document-preview.ts`；工具数保持 27。

## 避坑

1. 脚注与尾注独立计数 → `脚[1]尾[1]` 同段出现是**正常**，别当 bug 修。
2. `paraId="` 正则天然不误配 `paraIdParent="`（`Parent` 挡在 `="` 前）；批注首段 paraId 取**第一个**匹配。
3. 回复跳过逻辑在 `docxExtras` 的 rangeStart 循环里做（`commentReplyIds.has(id) continue`），
   不要在 `docxCommentIds` 里过滤——那个函数保持纯提取。
4. alt 标记进 `docxRuns` 会随粗斜体 run 合并被包进 `**…**` —— 可接受，别为此加特殊分支。

## 相关

`handoff-ecclaw-phase4q-final-2026-11-06.md` · `handoff-ecclaw-phase4p-final-2026-11-06.md` ·
项目记忆 `ecclaw_phase4r_docx_notes_alt.md`。
