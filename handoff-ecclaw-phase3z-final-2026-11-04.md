# handoff · ecclaw 第二十五阶段（phase3z）· Excel 显示样式 + DOCX Markdown 表格 · 2026-11-04

> **一句话结论**：XLSX 从「统一 ISO」改为**照搬 Excel 显示样式**（同一个格式码渲染器管日期与数字），
> DOCX 表格从「竖线拼行」改为 **Markdown 表格**。**仍未新增 MCP 工具（27）**，**无新增依赖**。
> `phase3z-e2e.cjs` **37/37**；`phase3y-e2e.cjs` 更新断言后 **31/31**；全量回归 **run57 十二套 408/408 全绿**。
>
> **本轮状态**：代码 / typecheck / build / e2e / 全量回归均已就绪；**全部未 commit**（项目非 git 仓库）。

---

## 1. 本轮必读顺序

1. 本文档
2. `handoff-ecclaw-phase3y-final-2026-11-04.md`（上一阶段：XLSX 日期还原）
3. `README.md` §5.28（旧口径）与 §5.29（本轮口径）
4. `task.md` 第二十五阶段表 + 顶部状态段
5. `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\ecclaw_phase3z_excel_display.md`

---

## 2. 交付清单（全部未 commit）

| 文件 | 改动 |
|---|---|
| `electron/main/document-preview.ts` | ①`BUILTIN_NUM_FMT_CODES` 补普通数字内置格式；②`splitFormatSections()`；③`tokenizeDateCode()` / `renderDateCode()`（日期+时长）；④`parseNumberPattern()` / `renderNumberCode()`（数字）；⑤`renderNumericCell()`；⑥`resolveFormatCode()` 取代 `resolveFormatInfo()`；⑦`parseXlsxSheet()` 数值分支改走统一渲染；⑧`markdownCell()` / `docxTableMarkdown()`，`extractDocxText()` 表格分支改 Markdown |
| `README.md` | 新增 §5.29；§5.28 输出条目加「旧口径」备注；§8 状态列表补一条 |
| `task.md` | 顶部状态段 + 新增「第二十五阶段」表 |
| `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/` | 新增 `ecclaw_phase3z_excel_display.md`；`MEMORY.md` 加索引 |

### 临时资产（`C:\Temp\ecclaw-verify\`）

- `make-phase3z-fixtures.cjs`（`formats.xlsx` 2411B / `markdown.docx` 1055B）
- `phase3z-e2e.cjs`（**37 条断言**）
- `phase3y-e2e.cjs`（**已更新显示样式断言**，仍 31 条）
- `rerun-and-regress8.cjs`（**run57-\*** 驱动，12 套，不跑真站）
- `tsout/`（tsc 单文件转译产物）

---

## 3. 关键设计决策

1. **一个渲染器管两类值**：先 `isDateFormat(code)`，是日期走 `renderDateCode()`，否则走 `renderNumberCode()`；
   两者都从同一个 `formatCode` 分发，避免「日期表」与「数字表」两套口径。
2. **日期 token 化**：引号字面量 / `\x` 转义 / `_x` 宽度 / `*x` 填充 / `[...]` 元信息先摊平；
   `m` 的月/分靠最近的非字面量邻居判定（前 `h`/`[h]` 或后 `s` = 分）。
3. **月名/星期名固定英文**：不依赖系统 locale，结果可复现（`Mar-23`、`Wednesday`）。
4. **`[h]:mm:ss` 归为时长**：`totalSec = Math.round(serial * 86400)`，`[h]` 输出 `36`，`mm`/`ss` 取余。
5. **数字渲染只做常用子集**：小数位（`0` 必填 / `#` 可选去零 / `?` 可选补空格）、千分位、
   `%`、`[$\u00a5-804]` 与引号货币、`;` 负数/零分段、尾部逗号缩进千位、`0` 取整。
   **科学计数 / 分数 / `@` / 无法解析 → 返回 null，保留原值**（fail-safe，不猜）。
6. **DOCX 表格**：首行作表头（用户选定）；缺列补空；`|` → `\|`；单元格内换行 → `<br>`；
   空行（无 `w:tc`）跳过。合并单元格（`gridSpan`/`vMerge`）**本轮不做**。
7. **只处理数值型单元格**：字符串即使挂了格式也不渲染（沿用 phase3y 反例纪律）。

---

## 4. 验证证据（实测）

- `pnpm typecheck` ✅ / `pnpm build` ✅（renderer `index-ChwETlxR.css` / `index-ChwETOxq.js` 658.13 kB）
- **秒级自测**（tsout + `previewDocument`，不进 Electron）：
  `1,234,567.89` / `12.34%` / `¥1,234.50` / `(1,234.50)` / `2023年3月15日` / `1:30 PM` / `36:00:00` /
  `Wednesday` / `13` / `25%` / 科学计数与 General 回退原值；Markdown 表格四行符合预期。
- **phase3z e2e：37/37**（工具面 3 · 格式 14 · 日期口径 4 · DOCX 8 · 回归 2 · 界面 6）
- **phase3y e2e：31/31**（口径改后：`3/15/23` · `3/15/23 13:30` · `Mar-23` · `36:00:00` · `12.50` · `1/1/04`）
- **run57 全量回归（`C:\Temp\ecclaw-verify\run57-summary.txt`，实测）**：
  phase3z 37 · phase3y 31 · phase3x 41 · phase3w 27 · phase3v 29 · phase3u 24 · phase3t 16 ·
  phase3r 31 · phase3p 45 · phase3o 44 · phase3m 69 · sse 14 → **合计 408 PASS / 0 FAIL**。
  **未跑真站套件 phase3s / phase3q**（红线「不碰淘宝」）。

---

## 5. 环境基线（收官实测）

| 项 | 值 |
|---|---|
| 项目根 | `F:\soft\00selfmade\ecclaw`（非 git） |
| 新依赖 | **无**（沿用 `fflate@0.8.3`） |
| stateDir | `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw` |
| MCP 工具数 | **27**（本轮未新增） |
| e2e 遗留物 | 文件库新增 `ecclaw-phase3z-格式.xlsx` / `-表格.docx` / `-排期.xlsx` / `-报价表.xlsx`（只增不删） |

---

## 6. 复现命令

```bash
cd /f/soft/00selfmade/ecclaw && pnpm typecheck && pnpm build
cd /c/Temp/ecclaw-verify && node make-phase3z-fixtures.cjs
node C:/Temp/ecclaw-verify/stop-electron.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Temp/ecclaw-verify/start-electron.ps1"
node C:/Temp/ecclaw-verify/phase3z-e2e.cjs <hostServer> <bridge>
node C:/Temp/ecclaw-verify/rerun-and-regress8.cjs   # run57-*
```

> 改主进程代码必须重启 Electron；`stop-electron.cjs` 的 fetch 报错是正常现象。

---

## 7. 红线（照旧）

- 禁删用户文件；e2e 写进文件库的 `ecclaw-phase3z-*` 也留着别删。
- 禁 `git init` / `commit`；`openclaw.json` / `host-bridge.json` 勿外传。
- 本阶段不碰淘宝（phase3s / phase3q 未跑）。
- 临时产物写 `C:\Temp\`；handoff/task 不进 `memory/`。
- GUI 验证走 CDP；无人值守 e2e 期间勿碰 GUI 卡片。

---

## 8. 下一阶段候选

- DOCX 合并单元格（`gridSpan` / `vMerge`）在 Markdown 里的表示。
- XLSX 条件格式 / 颜色（`[Red]` 目前只剥掉，不输出颜色信息）。
- XLSX 科学计数法 / 分数格式渲染。
- PDF 多页缩略图 / 指定页渲染参数（`scale` 已支持，界面未暴露）。
- 邮件 worker（外发副作用，需显式确认）。
- 画布宿主（新事件 kind）。
- 欠账：真站套件 phase3s / phase3q（需先问过淘宝）。