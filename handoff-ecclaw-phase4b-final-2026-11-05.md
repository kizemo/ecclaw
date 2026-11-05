# handoff · ecclaw 第二十七阶段（phase4b）· DOCX 单元格内嵌表格 → 深度感知抽取 · 2026-11-05

> **一句话结论**：Word 表格**嵌套**时的抽取错乱已修掉 —— 根因是全用**非贪婪正则配对标签**
> （外层的 `</w:tc>` 实际落在内层），改用**栈式深度感知**取直接子级后，
> 内嵌表**按行摊平进所在格**（内容与位置都不丢，内层列不撑开外层列）。
> **仍未新增 MCP 工具（27）**，**无新增依赖**。`phase4b-e2e.cjs` **18/18**；
> 全量回归 **run59 十四套**（数字见 §4）。
>
> **本轮状态**：代码 / typecheck / build / e2e / 全量回归均已就绪；**全部未 commit**（项目非 git 仓库）。

---

## 1. 本轮必读顺序

1. 本文档
2. `handoff-ecclaw-phase4a-final-2026-11-04.md`（上一阶段：DOCX 合并单元格）
3. `README.md` §5.29（表格基线）· §5.30（合并单元格）· **§5.31（本轮）**
4. `task.md` 第二十七阶段表 + 顶部状态段
5. `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\ecclaw_phase4b_docx_nested.md`

---

## 2. 交付清单（全部未 commit）

| 文件 | 改动 |
|---|---|
| `electron/main/document-preview.ts` | ①新增 `DOCX_CONTAINER_TAGS` + `DocxElement` 接口 + `docxChildElements()`（栈式深度感知取直接子级）；②`docxCellText()` 改走栈式取子级，并支持**内嵌表按行摊平**；③`docxCellSpan()` 入参从字符串改为 `DocxElement`（取 `body` 而非整段）；④`docxTableMarkdown()` 行列改走栈式；⑤`extractDocxText()` 正文块改走栈式 |
| `README.md` | 新增 §5.31（根因 + 改法 + 呈现口径）；§5.30 的「已知限制」标注已修；底部能力清单补两条 |
| `task.md` | 顶部状态段 + 新增「第二十七阶段」表 + 实证发现 3 条 |
| `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/` | 新增 `ecclaw_phase4b_docx_nested.md`；`MEMORY.md` 加索引 |

> **只改了这一个产品源文件**（`electron/main/document-preview.ts`）。

### 临时资产（`C:\Temp\ecclaw-verify\`）

- `make-phase4b-fixtures.cjs`（`nested.docx` 1202B：4 张表，含内嵌表 / 合并格内嵌表 / 三层嵌套 / 纯内嵌表）
- `phase4b-e2e.cjs`（**18 条断言**）
- `phase4b-selftest.cjs`（不走 Electron 的秒级自测，**10 项**）
- `phase4b-before.cjs`（**旧实现取证**：原样照抄 phase4a 旧代码跑同一份夹具，证明根因）
- `rerun-and-regress10.cjs`（**run59-\*** 驱动，14 套，不跑真站）
- `tsout/`（tsc 单文件转译产物）

---

## 3. 关键设计决策

1. **根因不在「表格解析」，在「标签配对方式」**：非贪婪正则隐含假设「标签不嵌套」，
   而 Word 的**单元格套表格**是常规排版手法 → 外层闭合标签落在内层，匹配提前收尾。
   任何 OOXML / HTML / SVG 这类「A 里可以嵌 B」的格式都适用这条。
2. **栈式只跟踪四种容器**：`w:tbl|w:tr|w:tc|w:p`。`w:r` / `w:t` / `w:sdt` / `w:tcPr` 等
   不参与层级判定 → 它们包住的内容仍算「直接子级」（`w:sdt` 里的段落照样抽得到）。
   错配闭标签忽略不猜（fail-safe，不硬凑）。
3. **内嵌表按行摊平，不丢弃也不塞成纯文本**：Markdown 没有嵌套管道表 →
   每行占一行、行内列以 ` \| ` 分隔（渲染成 `<br>` 换行）。
   这样**位置和内容都不丢**，agent 也能读出结构；比"整段塞成一坨"或"直接跳过"都可用。
4. **内层列不许撑开外层列**：摊平后内层的多列只出现在**自己那一行文本里**，
   外层表格的列数仍由外层 `w:tc` 决定（e2e 有断言钉住）。
5. **gridSpan 合并格里嵌表仍按跨度补空**：`docxCellSpan()` 只读**单元格自己的** `w:tcPr`
   （紧跟 `<w:tc>` 的首个），嵌套表格的 `tcPr` 不参与（沿用 §5.30 口径，本轮实测仍成立）。

---

## 4. 验证证据（实测）

- `pnpm typecheck` ✅ / `pnpm build` ✅（renderer `index-CtyLIrxR.css` / `index-ChwETOxq.js` 658.13 kB）
- **秒级自测**（`phase4b-selftest.cjs`，直调 `previewDocument`）：**10/10**
  —— 外层摊平 / 外层第二行不被吃掉 / 合并格内嵌表 / 合并格后续行 / 三层嵌套 /
  纯内嵌表 / 段落顺序 / 四个分隔行 / 列数不被撑开 / 预览不报错。
- **根因取证**（`phase4b-before.cjs`）：旧实现在同一份夹具上把外层表拆成两行、
  内层列被当外层列、`外层B` 被甩出表格 —— **修复前后的差异即根因证据**。
- **phase4b e2e：18/18**（工具面 3 · 内嵌表 9 · 界面 4 · kind/报错 2）
- **run59 全量回归（`C:\Temp\ecclaw-verify\run59-summary.txt`，实测）**：
  phase4b 18 · phase4a 20 · phase3z 37 · phase3y 31 · phase3x 41 · phase3w 27 · phase3v 29 ·
  phase3u 24 · phase3t 16 · phase3r 31 · phase3p 45 · phase3o 44 · phase3m 69 · sse 14
  → **合计 446 PASS / 0 FAIL**。
  **未跑真站套件 phase3s / phase3q**（红线「不碰淘宝」）。
  期间 stderr 的 `事件推送通道断开：terminated / fetch failed` 是套件结束时 MCP 子进程收尾的正常现象。

---

## 5. 环境基线（收官实测）

| 项 | 值 |
|---|---|
| 项目根 | `F:\soft\00selfmade\ecclaw`（非 git） |
| 新依赖 | **无**（沿用 `fflate@0.8.3`） |
| stateDir | `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw` |
| MCP 工具数 | **27**（本轮未新增） |
| e2e 遗留物 | 文件库新增 `ecclaw-phase4a-合并.docx` + `ecclaw-phase4b-嵌套.docx`（只增不删） |

---

## 6. 复现命令

```bash
cd /f/soft/00selfmade/ecclaw && pnpm typecheck && pnpm build
cd /c/Temp/ecclaw-verify && node make-phase4b-fixtures.cjs
node C:/Temp/ecclaw-verify/stop-electron.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Temp/ecclaw-verify/start-electron.ps1"
node C:/Temp/ecclaw-verify/phase4b-e2e.cjs <hostServer> <bridge>
node C:/Temp/ecclaw-verify/rerun-and-regress10.cjs   # run59-*
```

> 改主进程代码必须重启 Electron；`stop-electron.cjs` 的 fetch 报错是正常现象。
> 秒级自测要用 `NODE_PATH=F:/soft/00selfmade/ecclaw/node_modules`，且 tsout 的 electron 桩把 userData
> 指到 `C:/Temp/ecclaw-verify/fake-userdata`（夹具必须放到那里的 file-library）。
> tsout 重生成：`pnpm exec tsc electron/main/document-preview.ts electron/main/paths.ts electron/shared/types.ts --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron --module commonjs --target ES2022 --moduleResolution node --esModuleInterop --skipLibCheck`

---

## 7. 红线（照旧）

- 禁删用户文件；e2e 写进文件库的 `ecclaw-phase4*-*` 也留着别删。
- 禁 `git init` / `commit`；`openclaw.json` / `host-bridge.json` 勿外传。
- 本阶段不碰淘宝（phase3s / phase3q 未跑）。
- 临时产物写 `C:\Temp\`；handoff/task 不进 `memory/`。
- GUI 验证走 CDP；无人值守 e2e 期间勿碰 GUI 卡片。

---

## 8. 下一阶段候选

- XLSX 条件格式 / 颜色（`[Red]` 目前只剥掉，不输出颜色信息）。
- XLSX 科学计数法 / 分数格式渲染。
- PDF 多页缩略图 / 指定页渲染参数（`scale` 已支持，界面未暴露）。
- 邮件 worker（外发副作用，需显式确认）。
- 画布宿主（新事件 kind）。
- 欠账：真站套件 phase3s / phase3q（需先问过淘宝）。
