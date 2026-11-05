# handoff · ecclaw 第二十六阶段（phase4a）· DOCX 合并单元格 → Markdown 表格 · 2026-11-04

> **一句话结论**：Word 表格的横向合并（`w:gridSpan`）与纵向合并（`w:vMerge`）现在能正确落到 Markdown 管道表上：
> 横向合并内容只在首格、其余补空（**跨度上限 32**）；纵向合并续格输出空、续格自带文本不丢。
> **仍未新增 MCP 工具（27）**，**无新增依赖**。`phase4a-e2e.cjs` **20/20**；全量回归 **run58 十三套**（数字见 §4）。
>
> **本轮状态**：代码 / typecheck / build / e2e / 全量回归均已就绪；**全部未 commit**（项目非 git 仓库）。

---

## 1. 本轮必读顺序

1. 本文档
2. `handoff-ecclaw-phase3z-final-2026-11-04.md`（上一阶段：Excel 显示样式 + DOCX Markdown 表格）
3. `README.md` §5.29（表格基线口径）与 §5.30（本轮合并单元格口径）
4. `task.md` 第二十六阶段表 + 顶部状态段
5. `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\ecclaw_phase4a_docx_merge.md`

---

## 2. 交付清单（全部未 commit）

| 文件 | 改动 |
|---|---|
| `electron/main/document-preview.ts` | ①新增 `MAX_GRID_SPAN = 32`；②新增 `docxCellSpan()`（只认紧跟 `<w:tc>` 的首个 `w:tcPr`，解析 `w:gridSpan`）；③`docxTableMarkdown()` 按跨度展开单元格并补空；④补注释说明 vMerge 口径 |
| `README.md` | 新增 §5.30（合并单元格口径 + 已知限制，并引用 §5.29 的表格基线） |
| `task.md` | 顶部状态段 + 新增「第二十六阶段」表 |
| `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/` | 新增 `ecclaw_phase4a_docx_merge.md`；`MEMORY.md` 加索引 |

### 临时资产（`C:\Temp\ecclaw-verify\`）

- `make-phase4a-fixtures.cjs`（`merged.docx` 1201B：两个表格）
- `phase4a-e2e.cjs`（**20 条断言**）
- `phase4a-selftest.cjs`（不走 Electron 的秒级自测，8 项）
- `rerun-and-regress9.cjs`（**run58-\*** 驱动，13 套，不跑真站）
- `tsout/`（tsc 单文件转译产物）

---

## 3. 关键设计决策

1. **横向合并 = 首格放内容 + 其余补空**：Markdown 没有 colspan，宁可空着的格子，也不把内容复制 N 份
   （复制会让 agent 误以为有多个值，也会放大 token）。补空同时保证后续列位与其它行对齐。
2. **跨度上限 32**：`w:gridSpan="999"` 这类畸形值不能把表格撑爆；32 已远超正常报表。
   缺失 / 非数字 / `0` 一律按 1 列处理（fail-safe，不猜）。
3. **纵向合并不需要专门代码**：`restart` 格照常输出；续格通常没有正文 → 天然输出空串；
   续格若自带文本也照常输出，**不丢数据**。用测试锁住这条不变量，而不是加分支。
4. **只读单元格自己的 `w:tcPr`**：正则锚定 `<w:tc ...>` 之后的首个 `w:tcPr`，嵌套表格的 `tcPr` 不参与。
5. **spacing 断言写单空格**：`normalizeText()` 会把连续空格压成一个，所以是 `| 合并表头 | | 备注 |`。

---

## 4. 验证证据（实测）

- `pnpm typecheck` ✅ / `pnpm build` ✅（renderer `index-CtyLIrxR.css` / `index-ChwETOxq.js` 658.13 kB）
- **秒级自测**（`phase4a-selftest.cjs`，直调 `previewDocument`）：8/8 —— 合并表头 / 整行跨 3 列 / 续行对齐 /
  vMerge 起始 / 续格带文本 / `gridSpan=0` 视 1 / `999` 截 32 / 两表格各一行分隔线。
- **phase4a e2e：20/20**（工具面 3 · gridSpan 6 · vMerge 3 · 上限与边界 2 · 界面 4 · kind/报错 2）
- **run58 全量回归（`C:\Temp\ecclaw-verify\run58-summary.txt`，实测）**：
  phase4a 20 · phase3z 37 · phase3y 31 · phase3x 41 · phase3w 27 · phase3v 29 · phase3u 24 · phase3t 16 ·
  phase3r 31 · phase3p 45 · phase3o 44 · phase3m 69 · sse 14 → **合计 428 PASS / 0 FAIL**。
  **未跑真站套件 phase3s / phase3q**（红线「不碰淘宝」）。
  期间 stderr 的 `事件推送通道断开：terminated / fetch failed` 是套件结束时 MCP 子进程收尾的正常现象，不影响断言。

---

## 5. 环境基线（收官实测）

| 项 | 值 |
|---|---|
| 项目根 | `F:\soft\00selfmade\ecclaw`（非 git） |
| 新依赖 | **无**（沿用 `fflate@0.8.3`） |
| stateDir | `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw` |
| MCP 工具数 | **27**（本轮未新增） |
| e2e 遗留物 | 文件库新增 `ecclaw-phase4a-合并.docx`（只增不删） |

---

## 6. 复现命令

```bash
cd /f/soft/00selfmade/ecclaw && pnpm typecheck && pnpm build
cd /c/Temp/ecclaw-verify && node make-phase4a-fixtures.cjs
node C:/Temp/ecclaw-verify/stop-electron.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Temp/ecclaw-verify/start-electron.ps1"
node C:/Temp/ecclaw-verify/phase4a-e2e.cjs <hostServer> <bridge>
node C:/Temp/ecclaw-verify/rerun-and-regress9.cjs   # run58-*
```

> 改主进程代码必须重启 Electron；`stop-electron.cjs` 的 fetch 报错是正常现象。
> 秒级自测要用 `NODE_PATH=F:/soft/00selfmade/ecclaw/node_modules`，且 tsout 的 electron 桩把 userData
> 指到 `C:/Temp/ecclaw-verify/fake-userdata`（夹具必须放到那里的 file-library）。

---

## 7. 红线（照旧）

- 禁删用户文件；e2e 写进文件库的 `ecclaw-phase4a-*` 也留着别删。
- 禁 `git init` / `commit`；`openclaw.json` / `host-bridge.json` 勿外传。
- 本阶段不碰淘宝（phase3s / phase3q 未跑）。
- 临时产物写 `C:\Temp\`；handoff/task 不进 `memory/`。
- GUI 验证走 CDP；无人值守 e2e 期间勿碰 GUI 卡片。

---

## 8. 下一阶段候选

- DOCX 单元格内嵌表格（当前 `<w:tc>` 非贪婪匹配会在内层 `</w:tc>` 提前收尾）。
- XLSX 条件格式 / 颜色（`[Red]` 目前只剥掉，不输出颜色信息）。
- XLSX 科学计数法 / 分数格式渲染。
- PDF 多页缩略图 / 指定页渲染参数（`scale` 已支持，界面未暴露）。
- 邮件 worker（外发副作用，需显式确认）。
- 画布宿主（新事件 kind）。
- 欠账：真站套件 phase3s / phase3q（需先问过淘宝）。