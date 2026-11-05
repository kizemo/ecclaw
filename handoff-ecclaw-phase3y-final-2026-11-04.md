# handoff · ecclaw 第二十四阶段（phase3y）· XLSX 日期还原 · 2026-11-04

> **一句话结论**：在 phase3x 的 XLSX 抽取上补**日期还原** —— 按单元格的数字格式（`styles.xml` 的 numberFormat）
> 把序列号还原成日期。**只改 `electron/main/document-preview.ts` 一个文件**，MCP 工具数**仍是 27**。
> `phase3y-e2e.cjs` **31/31 全绿**，全量回归 **run56 十一套 371/371 全绿**（实测，见 §4）。
>
> **本轮状态**：代码 / typecheck / build / e2e / 全量回归均已就绪；**全部未 commit**（项目非 git 仓库）。

---

## 1. 本轮必读顺序

1. 本文档
2. `handoff-ecclaw-phase3x-final-2026-11-04.md`（上一阶段：PPTX / XLSX 抽取，本文 §3 的上下文）
3. `handoff-ecclaw-phase3w-final-2026-11-03.md`（DOCX 抽取 + PDF 位图 —— 抽取链路的起点）
4. `README.md` §5.28 · `task.md` 顶部状态段与第二十四阶段表
5. `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\ecclaw_phase3y_xlsx_dates.md`
   （链路 / 格式码判定 / 1900·1904 历元 / 「该不该转」反例清单）
6. `prompt-ecclaw-phase3y-next.md`（下一阶段指针）

---

## 2. 交付清单（全部未 commit）

| 文件 | 改动 |
|---|---|
| `electron/main/document-preview.ts` | ①`XLSX_STYLES_ENTRY` 常量；②`BUILTIN_NUM_FMT_CODES`（内置 numFmtId → 格式码）；③`parseXlsxStyles()`（`<numFmts>` + `<cellXfs>`）；④`analyzeFormatCode()`（格式码 → 日期/时间判定）；⑤`resolveFormatInfo()`（单元格样式索引 → 格式）；⑥`excelSerialToParts()`（序列号 → 日历字段，1900/1904 双历元）；⑦`formatSerialParts()`（→ `YYYY-MM-DD [HH:MM[:SS]]`）；⑧`parseXlsxSheet()` 增 `styles` / `date1904` 入参 + 仅 `type === 'n'` 才转换；⑨`extractXlsxText()` 增读 `xl/styles.xml` 与 `workbookPr@date1904` |
| `README.md` | 新增 §5.28「XLSX 日期还原」；§8 状态列表补 §5.28 一条 |
| `task.md` | 顶部状态段加第二十四阶段；新增「第二十四阶段」表 + 5 条实证发现 |
| `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/` | 新增 `ecclaw_phase3y_xlsx_dates.md`；`MEMORY.md` 加一行索引 |

### 临时资产（`C:\Temp\ecclaw-verify\`）

- `make-office.cjs`（新增两个夹具：`dates.xlsx` 2685B / `dates1904.xlsx` 2456B）
- `phase3y-e2e.cjs`（**31 条断言**）
- `rerun-and-regress8.cjs`（**run56-\*** 驱动，11 套，不跑真站）
- `quick-xlsx-dates.cjs`（秒级自测：直接调 tsout 的 `extractXlsxText`）
- `tsout/`（`tsc` 单文件转译产物 + 假 `node_modules/electron` stub）

---

## 3. 关键设计决策（可迁移）

1. **日期格式的判定走「扫描格式码」，不是查表**：
   单元格 `s="i"` → `styles.xml` 的 `<cellXfs>` 第 i 个 `<xf>` 的 `numFmtId` → 内置表或自定义 `formatCode`。
   扫格式码时先剔掉引号字面量（`"年"`）、反斜杠转义（`\-`）、方括号段（`[$-409]`），
   再认 `y`/`d`/`h`/`s`；**`m` 的月/分歧义靠邻居判**（紧跟在小时之后、或紧邻秒之前 = 分，否则 = 月）。
2. **内置 numFmtId 也走同一个分析器**：把 14–22 / 27–33 / 45–47 / 50–56 映射成格式码后
   喂给**和自定义格式同一个** `analyzeFormatCode()` → 只有一套判定口径，不会两处打架。
3. **Excel 的 1900 历元有假闰日**：号 ≥ 61 的要减 1 天才对上公历；号 60 是不存在的 1900-02-29（按字面输出）。
   1904 历元（Mac 老文件）基准不同，靠 `workbookPr@date1904="1"` 区分（号 0 = 1904-01-01）。
4. **只转数值型单元格**：日期样式挂到共享字符串 / 内联字符串 / 公式字符串上时**不能转**（转了就毁内容）
   → 转换放在 `type === 'n'` 分支内。
5. **「该不该转」比「怎么转」更容易错**（本轮最该记住的一条）：e2e 专门钉了三个反例 ——
   无样式的纯数字（`45000` 保持原样）、时长格式 `[h]:mm:ss`（`1.5` 保持原样）、自定义非日期格式 `0.00`（`12.5` 保持原样）。
6. **输出不照搬 Excel 显示样式**（2026-11-04 用户选定）：统一 ISO —— `m/d/yy` 也给 `2023-03-15`，
   无歧义、可排序、对 agent 最友好。代价是「只有年月」的格式（`mmm-yy`）也给完整日期（序列号里本来就有完整日期）。
7. **本轮明确不做**：照搬格式码渲染（Excel 显示样式）、时长（`[h]:mm:ss`）转时长、日期写入回 xlsx。

---

## 4. 验证证据（实测）

- `pnpm typecheck` ✅ / `pnpm build` ✅（renderer `index-ChwETOxq.js` 658.13 kB）
- **秒级自测**（`quick-xlsx-dates.cjs`，不进 Electron）→ 日期/自定义/时分/秒/纯数字/字符串/1904 全部符合预期。
- **phase3y e2e：31/31 全绿**
  工具面 3 · 清单 2 · 日期还原 15 · 1904 历元 2 · 回归 4 · 界面 5
  关键实测：`交期 | 2023-03-15`（内置 14）、`自定义格式 | 2023-03-15`（自定义 164）、
  `带时分 | 2023-03-15 13:30`（22）、`只有时分 | 12:00`（20）、`到秒 | 12:30:00`（21）、
  `纯数字 | 45000`（不误转）、`文本不转 | 交期文字`（字符串不转）、`时长不转 | 1.5`、`自定义非日期 | 12.5`；
  1904 历元 `1904 历元 | 1904-01-01` / `第二天 | 1904-01-02`；
  回归：原报价表仍 `A102 | 米白 | 58`、`合计 | | 58`，DOCX/PDF 不受影响；界面显示还原后的 `2023-03-15`。
- **run56 全量回归（`C:\Temp\ecclaw-verify\run56-summary.txt`，实测）**：
  phase3y 31 · phase3x 41 · phase3w 27 · phase3v 29 · phase3u 24 · phase3t 16 · phase3r 31 · phase3p 45 · phase3o 44 · phase3m 69 · sse 14
  → **合计 371 PASS / 0 FAIL**。
  **未跑真站套件 phase3s / phase3q**（本阶段红线「不碰淘宝」，summary 末行已注明）。

---

## 5. 环境基线（收官实测）

| 项 | 值 |
|---|---|
| 项目根 | `F:\soft\00selfmade\ecclaw`（非 git） |
| Node | 系统 v26.13.0；Electron 内 Node v24.22.1 |
| 新依赖 | **无**（沿用 `fflate@0.8.3`） |
| stateDir | `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw` |
| 文件库 | `<stateDir>\file-library\files` |
| MCP 工具数 | **27**（本轮未新增） |
| e2e 遗留物 | 文件库新增 `ecclaw-phase3y-排期.xlsx` / `-1904.xlsx` / `-报价表.xlsx` / `-报价单.docx` / `-sample.pdf`（只增不删） |

---

## 6. 复现命令

```bash
cd /f/soft/00selfmade/ecclaw && pnpm typecheck && pnpm build
cd /c/Temp/ecclaw-verify && node make-office.cjs
node C:/Temp/ecclaw-verify/stop-electron.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Temp/ecclaw-verify/start-electron.ps1"
node C:/Temp/ecclaw-verify/phase3y-e2e.cjs <hostServer> <bridge>
node C:/Temp/ecclaw-verify/rerun-and-regress8.cjs   # run56-*
```

> 注意：`stop-electron.cjs` 失败会中断 `&&` 链，其 fetch 报错是**正常现象**。
> **改完主进程代码必须重启 Electron**（build 不会自动重载主进程），否则 e2e 跑的是旧代码。

### 秒级自测（比 e2e 快得多，改解析代码先跑这个）

```bash
cd /f/soft/00selfmade/ecclaw && npx tsc electron/main/document-preview.ts \
  --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron \
  --module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck
cd /c/Temp/ecclaw-verify && NODE_PATH=F:/soft/00selfmade/ecclaw/node_modules node quick-xlsx-dates.cjs
```

---

## 7. 红线（照旧）

- 禁删用户文件；e2e 写进文件库的 `ecclaw-phase3y-*` 也留着别删。
- 禁 `git init` / `commit`；`openclaw.json` / `host-bridge.json` 勿外传。
- 本阶段不碰淘宝（phase3s / phase3q 未跑）。
- 临时产物写 `C:\Temp\`；handoff/task 不进 `memory/`。
- GUI 验证走 CDP；无人值守 e2e 期间勿碰 GUI 卡片。

---

## 8. 下一阶段候选（写进 prompt 时只留指针）

- XLSX **照搬 Excel 显示样式**（本轮明确选了统一 ISO，见 §3.6；若要改需实现格式码渲染器）。
- XLSX **时长格式**转时长（`[h]:mm:ss` 现在原样留数字）。
- DOCX 表格保留结构（现在已按行列展开，若要 markdown 表格可增强）。
- PDF 多页缩略图 / 指定页渲染参数（`scale` 已支持，界面未暴露）。
- 邮件 worker（外发副作用，需显式确认）。
- 画布宿主（新事件 kind）。
- 欠账：真站套件 phase3s / phase3q（需先问过淘宝）。
