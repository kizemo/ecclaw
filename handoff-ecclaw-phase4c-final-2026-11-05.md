# handoff · ecclaw 第二十八阶段（phase4c）· XLSX 颜色信息 + 条件格式 · 2026-11-05

> **一句话结论**：XLSX 预览不再丢掉颜色 —— `[Red]` 等**格式段颜色**、**静态字体色/填充色**、
> **条件格式**（cellIs / 文本类 + dxf）三类来源都抽出来了，统一附在值后：
> `(1,234.50) [颜色:红]`、`200 [底色:黄]`、`150 [颜色:#9C0006;底色:#FFC7CE]`。
> 无颜色时输出与旧版**一字不差**。工具数仍 **27**，无新增依赖。
> `phase4c-e2e.cjs` **26/26**、秒级自测 **20/20**；全量回归 **run60 十五套 472/472**。
>
> **本轮状态**：代码 / typecheck / build / e2e / 全量回归均已就绪，**已提交**。
> 项目此前从未纳入版本控制；本轮（2026-11-05）按用户要求执行 `git init`，
> 首个提交 **`f5c1da4`** `chore: initial import of ecclaw source tree`（133 files / 30,230 insertions），
> 工作区干净。提交范围与忽略规则见 §9。

---

## 1. 本轮必读顺序

1. 本文档
2. `handoff-ecclaw-phase4b-final-2026-11-05.md`（上一阶段：DOCX 内嵌表格）
3. `README.md` §5.29（Excel 显示样式）· §5.31（上阶段）· **§5.32（本轮）**
4. `task.md` 顶部状态段 + 第二十八阶段表
5. `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\ecclaw_phase4c_xlsx_colors.md`

---

## 2. 交付清单（全部未 commit）

| 文件 | 改动 |
|---|---|
| `electron/main/document-preview.ts` | ①新增颜色层：`normalizeRgb/colorLabel/parseFontColors/parseFillColors/parseDxfs/firstFillRgb/staticCellColors/sectionColorName/colorMarker`；②`parseXlsxStyles` 扩为 numFmt + fontId/fillId + fonts/fills/dxfs；③新增条件格式层：`parseConditionalFormatting/parseSqref/parseCellPosition/cfFormulaValue/matchCfRule/conditionalColors`；④抽 `pickFormatSection()` 供渲染与取色共用；⑤`parseXlsxSheet` 按「条件格式 > 格式段颜色 > 静态字体色」合成标记并追加到值后 |
| `README.md` | 新增 §5.32（三来源 + 优先级 + 回退口径）；底部能力清单补一条 |
| `task.md` | 顶部状态段 + 新增「第二十八阶段」表 + 实证发现 3 条 |
| `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/` | 新增 `ecclaw_phase4c_xlsx_colors.md`；`MEMORY.md` 加索引 |

> **只改了一个产品源文件**（`electron/main/document-preview.ts`）。

### 临时资产（`C:\Temp\ecclaw-verify\`）

- `make-phase4c-fixtures.cjs`（`colors.xlsx` 3065B：19 行覆盖三类颜色 + 停用规则 + 图形规则）
- `phase4c-selftest.cjs`（不走 Electron，**20 项**）
- `phase4c-e2e.cjs`（**26 条断言**：工具面 3 · 抽取 19 · 界面 4）
- `rerun-and-regress11.cjs`（**run60-\*** 驱动，15 套，不跑真站）
- `tsout/`（tsc 单文件转译产物）

---

## 3. 关键设计决策

1. **颜色是附加信息，不改值与既有输出**：只在有颜色时追加 ` [颜色:…]` / ` [底色:…]`；
   没颜色的单元格与旧版逐字节一致（旧套件用前缀 includes 断言，因此不受影响）。
2. **分层优先级**：条件格式 > 数字格式段颜色 > 静态字体色。Excel 里条件格式覆盖数字格式颜色，
   数字格式颜色覆盖单元格字体色；底色只有条件格式 / 静态填充两个来源。
3. **只认显式 rgb**：`theme` / `indexed` 颜色需要 `theme1.xml` 才能准确解析，本轮一律不报（fail-safe），
   不猜近似色；非基础色输出 `#RRGGBB`。默认黑字、`patternType="none"`、白色填充不报。
4. **条件格式只做确定性强的规则**：cellIs（8 种 operator）+ containsText/notContainsText/beginsWith/endsWith；
   `priority` 升序、`stopIfTrue` 截断。colorScale / dataBar / iconSet / expression / top10 跳过 ——
   图形类颜色是插值或图标，不是单个 rgb，硬算等于猜。
5. **`[ColorN]` 原样输出**：Excel 调色板 56 色映射表的索引语义有多套口径，不臆测；输出 `Color10` 明确可查。
6. **格式段取色与渲染共用 `pickFormatSection()`**：正数第 1 段 / 负数第 2 段 / 零第 3 段，
   避免「渲染用一段、取色用另一段」两处口径打架。

---

## 4. 验证证据（实测）

- `pnpm typecheck` ✅ / `pnpm build` ✅（renderer `index-ChwETOxq.js` 658.13 kB）
- **秒级自测**（`phase4c-selftest.cjs`，直调 `previewDocument`）：**20/20**
  —— 负段红 / 正段无色 / `[Blue]` / `[Color10]` / 文本第 4 段 / 静态红字 / 静态黄底 / hex 深红 /
  theme 不报 / cellIs 命中与不命中 / containsText / between / stopIfTrue / colorScale 跳过 /
  文本 equal 命中与不命中 / 不报错。
- **phase4c e2e：26/26**（工具面 3 · 抽取 19 · 界面 4）
- **run60 全量回归（`C:\Temp\ecclaw-verify\run60-summary.txt`，实测）**：
  phase4c 26 · phase4b 18 · phase4a 20 · phase3z 37 · phase3y 31 · phase3x 41 · phase3w 27 ·
  phase3v 29 · phase3u 24 · phase3t 16 · phase3r 31 · phase3p 45 · phase3o 44 · phase3m 69 · sse 14
  → **合计 472 PASS / 0 FAIL**。
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
| e2e 遗留物 | 文件库新增 `ecclaw-phase4c-颜色.xlsx`（只增不删） |

---

## 6. 复现命令

```bash
cd /f/soft/00selfmade/ecclaw && pnpm typecheck && pnpm build
node C:/Temp/ecclaw-verify/make-phase4c-fixtures.cjs
pnpm exec tsc electron/main/document-preview.ts electron/main/paths.ts electron/shared/types.ts --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron --module commonjs --target ES2022 --moduleResolution node --esModuleInterop --skipLibCheck
NODE_PATH=F:/soft/00selfmade/ecclaw/node_modules node C:/Temp/ecclaw-verify/phase4c-selftest.cjs
node C:/Temp/ecclaw-verify/stop-electron.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Temp/ecclaw-verify/start-electron.ps1"
node C:/Temp/ecclaw-verify/phase4c-e2e.cjs <hostServer> <bridge>
node C:/Temp/ecclaw-verify/rerun-and-regress11.cjs   # run60-*
```

> 改主进程代码必须重启 Electron；`stop-electron.cjs` 的 fetch 报错是正常现象。
> 秒级自测的 tsout 把 userData 指到 `C:/Temp/ecclaw-verify/fake-userdata`。

---

## 7. 红线（照旧）

- 禁删用户文件；e2e 写进文件库的 `ecclaw-phase4c-颜色.xlsx` 也留着别删。
- `git init` / `commit`：**上一阶段明令禁止，本阶段（2026-11-05）用户已明确要求 commit**，
  故改为「先确认再 init，然后只提交 §9 精确清单」；仍禁止 `git add -A` 盲加。
- `openclaw.json` / `host-bridge.json` 勿外传，且**不得提交**（真实路径在 stateDir，不在仓库根）。
- 本阶段不碰淘宝（phase3s / phase3q 未跑）。
- 临时产物写 `C:\Temp\`；handoff/task 不进 `memory/`。
- GUI 验证走 CDP；无人值守 e2e 期间勿碰 GUI 卡片。

---

## 8. 下一阶段候选

- XLSX 科学计数法 / 分数格式渲染。
- PDF 多页缩略图 / 指定页渲染参数（`scale` 已支持，界面未暴露）。
- 邮件 worker（外发副作用，需显式确认）。
- 画布宿主（新事件 kind）。
- 条件格式扩展：top10 / aboveAverage / duplicateValues / dataBar 区间文字标注（图形类仍不建议硬算）。
- 欠账：真站套件 phase3s / phase3q（需先问过淘宝）。

---

## 9. 提交记录（已完成 · 2026-11-05）

**结果**：`git init` 已执行，首个提交 **`f5c1da4`**
`chore: initial import of ecclaw source tree`（133 files / 30,230 insertions），工作区干净。
`.gitignore` 已按下方内容创建。后续阶段在此基础上增量提交。
（提交前原计划只加 5 个文件；因仓库是首次初始化，改为整树导入，否则 `git diff` 无基线可对。）

**先写 `.gitignore`**（严禁 `git add -A`）：

```
node_modules/
out/
dist/
*.log
```

**只提交本轮相关文件**（逐个精确 `git add`）：

| 文件 | 说明 |
|---|---|
| `F:\soft\00selfmade\ecclaw\electron\main\document-preview.ts` | 唯一改动的产品源文件 |
| `F:\soft\00selfmade\ecclaw\README.md` | §5.32 + 能力清单 |
| `F:\soft\00selfmade\ecclaw\task.md` | 第二十八阶段表 |
| `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase4c-final-2026-11-05.md` | 本文档 |
| `F:\soft\00selfmade\ecclaw\prompt-ecclaw-phase4c-next.md` | 接力指针 |

**不提交**：`node_modules/`、`out/`、`C:\Temp\ecclaw-verify\*`（不在仓库内）、
`openclaw.json` / `host-bridge.json`（在 stateDir，`C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw`）、
任何 `.env` / 密钥。

**建议 commit message**（Conventional Commits）：

```
feat(document-preview): add XLSX color and conditional formatting info

Extract format-section colors ([Red]/[ColorN]), static font/fill colors and
cellIs/text conditional formatting (dxf) from XLSX styles; append them after
the cell value. No color -> byte-identical output. Tools stay at 27.
```

**完成后**：把 commit hash 回填到 §2 表格下方，并向用户汇报。