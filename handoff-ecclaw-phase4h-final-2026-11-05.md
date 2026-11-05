# handoff · ecclaw 第三十三阶段（phase4h）· XLSX 单位/工程/会计格式 + 日期 locale · 2026-11-05

> **一句话结论**：XLSX 数字格式补上最后三块 —— **单位**、**工程计数法**、**会计格式**，外加**日期 locale 本地化**；
> 顺带修好**小数点后尾逗号缩放**此前完全失效的 bug。
> **工具数仍 27**，未新增依赖，只改 `electron/main/document-preview.ts` 一个文件，输出通道不变。
> 秒级自测 **42/42**、**phase4h e2e 48/48**、typecheck/build ✅。
> ✅ **全量回归 run66 十九套 628/628 全绿**（`run66-summary.txt`；未跑真站 phase3s/3q）。
> ⚠️ **一处行为修正**：工程格式 `##0.0E+0` 从 `1.2E+4` 变成 `12.3E+3`（Excel 本来就这样）→
> phase4d 自测 / e2e 的两条期望值已同步更新（详见 §4.2）。

---

## 1. 本轮必读顺序

1. 本文档
2. `handoff-ecclaw-phase4g-final-2026-11-05.md`（上一阶段：XLSX 区间级条件格式）
3. `README.md` §5.33（科学 / 工程计数法）· **§5.37（本轮）**
4. `task.md` 顶部状态段 + 第三十三阶段表
5. `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\ecclaw_phase4h_xlsx_formats.md`

---

## 2. 本轮选题与基线

- **选题**：从 `handoff-ecclaw-phase4g-final-2026-11-05.md` §9 候选里选
  **「XLSX 单位 / 工程 / 会计格式 + 日期格式本地化」**（用户确认）。
  - 候选里的 `containsBlanks` **不做**（要改空白格渲染，回归面大）；图形类条件格式**不做**。
- **基线**：`HEAD = 1d58bc6`（`docs: note stale regression driver can clobber run65 artifacts`），
  工作区干净树；上一阶段的实质提交 `0d99c96`。
- **中途上下文撞 160K 硬闸门被拦** → 中途写过一份 WIP 交接
  `handoff-ecclaw-phase4h-wip-2026-11-05.md`（代码已落盘但未验证）；本文档是**收官版**。

---

## 3. 交付清单

| 文件 | 改动 |
|---|---|
| `electron/main/document-preview.ts` | ①`DateTokenType` 增 `'locale'`；②`tokenizeDateCode()` 的 `[` 分支识别 locale 前缀（**不产生字面量**）；③新增 `MONTH_ZH` / `WEEK_ZH` / `isZhLocale()`；④`renderDateCode()` 加 zh 分支；⑤`flattenFormatSection()` 的 `[` 分支显式跳过 locale 前缀；⑥`parseNumberPattern()` **整体重写**（占位段改在**掩码串**上扫描 · 末尾逗号 = 缩放逗号 · percent 用 masked 统计）；⑦新增 `groupThousands()` / `renderIntSlots()`（Excel 槽位语义）；⑧`renderNumberCode()` 整数位改走 `renderIntSlots()`；⑨`SciPattern` 增 `engineering` + `renderScientific()` 指数对齐 3 的倍数 |
| `README.md` | 新增 §5.37；**§5.33 补工程计数法说明**（原文把 `##0.0E+0` 当科学计数法）；底部能力清单补一条 |
| `task.md` | 顶部状态段 + 新增「第三十三阶段」表 + 实证发现 10 条 |
| `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/` | 新增 `ecclaw_phase4h_xlsx_formats.md`；`MEMORY.md` 加索引 |
| `handoff-ecclaw-phase4h-final-2026-11-05.md` | 本文档 |
| `prompt-ecclaw-phase4h-next.md` | 接力指针（<30 行） |

**未改动**：契约 `electron/shared/types.ts`、`electron/main/host-bridge.ts`、
`resources/mcp/host-server.mjs`、`src/App.tsx`、`src/styles.css` —— 本轮**不需要**（输出通道不变）。

### 临时资产（`C:\Temp\ecclaw-verify\`，**不进仓库**）

- `make-phase4h-fixtures.cjs` → `fmt4h.xlsx`（**37 行用例**：单位 4 · 缩放 4 · 工程/科学 7 · 会计 8 · 货币 3 · locale 6 · **英文负向 4**）
- `phase4h-selftest.cjs`（不走 Electron，**42 项**）
- `phase4h-e2e.cjs`（**48 条断言**：工具面 3 · 抽取 40 · 界面 4）
- `rerun-and-regress18.cjs`（**run66-\*** 驱动，19 套，不跑真站；单套 12 分钟超时 + 摘要逐套落盘）
- `probe-4h.cjs` / `probe-4h-b.cjs`（探针，摸缺口用的）
- `run66-summary.txt`（十九套摘要 · **628/628 全绿**）· `run66-phase4h.log`（本轮 e2e 产物）
- `tsout/`（tsc 单文件转译产物）

---

## 4. 关键设计决策

### 4.1 已获用户确认的口径（不要重新讨论）

| 项 | 决定 |
|---|---|
| 会计格式输出口径 | **紧凑**：正 `$1,234.50` / 负 `$(1,234.50)` / 零 `$-`；`*` 填充与 `_` 宽度占位丢弃 |
| 日期本地化触发 | **仅 locale 前缀触发**：`[$-804]` / `[$-0804]` → 中文；否则保持英文 |
| 工程格式判据 | 尾数整数位槽 ≥2（`##0.0E+0`）→ 指数向下取 3 的倍数；`0.00E+00` 科学格式行为不变 |
| 单位/缩放 | 小数点后尾逗号算缩放逗号；小数位槽位只数 `0/#/?` |
| 范围 | 只改数字格式渲染层；输出通道不变；**不做** `containsBlanks`、图形类条件格式、真站套件 |

**为什么会计格式只能紧凑输出**：`normalizeText()` 会把连续空格压成 1 个、删行首行尾空格 →
Excel 会计格式的对齐留白（`_(` `_)` 的宽度占位、`*` 填充）在纯文本里**本来就不可见**。

### 4.2 ⚠️ 一处行为修正（不是回归）

`##0.0E+0` / `##0.00E+00` 在 Excel 里是**工程计数法**（小数点前 ≥2 个占位槽）→
指数取 3 的倍数、尾数落在 `[1,1000)`。旧实现一律当科学计数法 → `1.2E+4`。

| 格式 | 旧输出 | 新输出 | Excel |
|---|---|---|---|
| `0.00E+00` | `1.23E+04` | `1.23E+04`（不变） | `1.23E+04` |
| `0.0E+0` | `1.2E+4` | `1.2E+4`（不变，1 个槽） | `1.2E+4` |
| `##0.0E+0` | `1.2E+4` | **`12.3E+3`** | `12.3E+3` |
| `##0.00E+00` | `1.23E+04` | **`12.35E+03`** | `12.35E+03` |

→ phase4d 自测（`sciOne` / `sciBuiltin48`）与 e2e 两条期望值**已同步更新**；
README §5.33 已注明「`##0.0E+0` 属工程格式，指数取 3 的倍数」。

### 4.3 实现要点（踩坑点）

1. **掩码层不只是给字面量用的**：旧 `parseNumberPattern()` 在**扁平串**上用 regex 找占位段，
   `"12"0.00` 的 `12` 会被当成占位段；改成在**掩码串**（字面量位置挖空）上扫描才对。
   顺带修了缩放逗号 —— 旧 `core` regex **压根不含小数点后的尾逗号**，
   所以 `0.0,` / `#,##0.0,,` 的缩放是**整体失效**（不是判错）。
2. **尾数归一化必须按 `pat.engineering` 分叉**：科学计数法要「尾数 ≥10 就归 1、指数 +1」；
   工程格式尾数落在 `[1,1000)` —— 套同一条会把 `12.3E+3` 压回 `1.23E+4`。**本轮最后一个 bug**。
3. **会计零段 `$-` 靠「零不占 `?` 槽」**：Excel 的 `_($* "-"??_)` 里那个 0 不该渲染出来 →
   只留横线；不写这条会出 `$-0`。
4. **locale 前缀必须「不产生字面量」**：分词层发 `locale` token、展平层**显式跳过**
   （不是「碰巧不漏」）；否则 `[$-804]` 会在输出里漏出 `-804`。
5. **整数位按 Excel 槽位语义渲染**：`0` 槽没数字显示 0、`#` 槽不显示、`?` 槽显示空格；
   数字右对齐填最右槽；槽不够**不截断**。

---

## 5. 验证证据（实测）

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 无错 |
| `pnpm build` | ✅ renderer `out/renderer/assets/index-wunPmYW7.js` 665.75 kB、`index-BNztoMKE.css` 8.97 kB（资产哈希不变 —— 本轮只改主进程） |
| 秒级自测 `phase4h-selftest.cjs` | **42/42**（37 行按**整行相等**比对 + 行数 + kind + error + 2 条负向断言） |
| e2e `phase4h-e2e.cjs` | **48/48**（工具面 3 / 抽取 40 / 界面 4），产物 `run66-phase4h.log` |
| phase4d 自测 | ✅（期望值随 §4.2 同步更新后全绿） |
| 全量回归 run66 十九套 | ✅ **628/628 全绿，FAIL 全 0**（摘要 `C:\Temp\ecclaw-verify\run66-summary.txt`；未跑真站 phase3s/3q） |

回归明细（run66-\*）：phase4h 48 · 4g 30 · 4f 26 · 4e 21 · 4d 31 · 4c 26 · 4b 18 · 4a 20 · 3z 37 · 3y 31 ·
3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14。

**负向断言是本轮的主要防回归手段**：
① 除中文 locale 用例外，**整表**的值都不得出现中文月/星期/上下午；
② 无 locale 前缀（`mmm d, yyyy`）与英文 locale（`[$-409]`）必须**保持英文**（`Mar 15, 2023`）。
—— 扫描要**先切掉 `label | ` 前缀再扫值**，否则会被标签里的「月」字误伤（本轮踩过）。

---

## 6. 环境基线

- 项目根：`F:\soft\00selfmade\ecclaw`（git 仓库）
- stateDir：`C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw`
- MCP 工具数：**27**
- 依赖：**无新增**
- 回归驱动：`C:\Temp\ecclaw-verify\rerun-and-regress18.cjs` → 产物前缀 `run66-*`

---

## 7. 复现命令

```bash
cd /f/soft/00selfmade/ecclaw && pnpm typecheck && pnpm build
node C:/Temp/ecclaw-verify/make-phase4h-fixtures.cjs
pnpm exec tsc electron/main/document-preview.ts electron/main/paths.ts electron/shared/types.ts \
  --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron --module commonjs --target ES2022 \
  --moduleResolution node --esModuleInterop --skipLibCheck
NODE_PATH=F:/soft/00selfmade/ecclaw/node_modules node C:/Temp/ecclaw-verify/phase4h-selftest.cjs
node C:/Temp/ecclaw-verify/stop-electron.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Temp/ecclaw-verify/start-electron.ps1"
node C:/Temp/ecclaw-verify/phase4h-e2e.cjs \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs" \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json"
node C:/Temp/ecclaw-verify/rerun-and-regress18.cjs
```

---

## 8. 红线（照旧）

- 禁删用户文件；e2e 写进文件库的 `ecclaw-phase4h-数字格式.xlsx`
  （以及 `ecclaw-phase4c-颜色.xlsx`、`ecclaw-phase4e-多页.pdf` 等）都**留着别删**。
- `openclaw.json` / `host-bridge.json` 勿外传，且**不得提交**（真实路径在 stateDir，不在仓库根）。
- 本阶段**不碰淘宝**（phase3s / phase3q 未跑）。
- 临时产物写 `C:\Temp\`；handoff/task **不进** `memory/`。
- GUI 验证走 **CDP**（不要用 computer-use 截 Electron 屏）；无人值守 e2e 期间勿碰 GUI 卡片。
- 提交只 `git add` **精确文件**，**禁止 `git add -A`**。

---

## 9. 下一阶段候选

- **`containsBlanks` / `notContainsBlanks`**（phase4g 起就挂着）：需要让**空白单元格也渲染出来**并带底色
  —— 会改变既有空白格输出，回归面比本轮大，动手前先想清楚空格的渲染口径。
- XLSX 余量：**更多 locale**（`[$-407]` 法语月名 / `[$-041]` 日语）、
  **日期 duration** 格式（`[h]:mm:ss` 在数字渲染路径）、**科学计数法负指数与 `E-`**、**自定义 `0.0E+0` 变体**。
- XLSX 余量：**百分比带条件格式**、**数据验证提示**、**冻结窗格**。
- 邮件 worker（外发副作用，需**显式确认**才能开工）。
- 画布宿主（新事件 kind，属架构级改动）。
- PDF 余量：缩略图窗口大小可调、缩略图懒加载、目录项页码为 `null` 时的降级提示。
- 欠账：真站套件 phase3s / phase3q（需先问过淘宝）。

---

## 10. 提交记录

| 提交 | 内容 |
|---|---|
| `__FEAT_COMMIT__` | `feat(document-preview): add XLSX unit, engineering and accounting formats` —— 本次回填 |
| `__DOC_COMMIT__` | `docs: record phase 4h commit hash in handoff` —— 本次回填 |

已精确 `git add` 下列文件提交（**未用 `git add -A`**）：

| 文件 | 说明 |
|---|---|
| `F:\soft\00selfmade\ecclaw\electron\main\document-preview.ts` | 单位 / 缩放 / 工程格式 / 会计格式 / 日期 locale |
| `F:\soft\00selfmade\ecclaw\README.md` | §5.37 + §5.33 工程格式说明 + 能力清单 |
| `F:\soft\00selfmade\ecclaw\task.md` | 第三十三阶段表 + 顶部状态段 |
| `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase4h-final-2026-11-05.md` | 本文档 |
| `F:\soft\00selfmade\ecclaw\prompt-ecclaw-phase4h-next.md` | 接力指针 |

**未提交**：`node_modules/`、`out/`、`C:\Temp\ecclaw-verify\*`（不在仓库内）、
`openclaw.json` / `host-bridge.json`（在 stateDir）、任何 `.env` / 密钥。

---

## 11. 收尾清单

1. ✅ 主进程：缩放逗号 / 工程计数法 / 会计格式（槽位语义）/ 日期 locale
2. ✅ 输出通道不变；契约 / host-bridge / MCP 未动 → 工具数仍 27
3. ✅ `pnpm typecheck` ✅ / `pnpm build` ✅
4. ✅ 秒级自测 `phase4h-selftest.cjs` **42/42**
5. ✅ e2e `phase4h-e2e.cjs` **48/48**
6. ✅ 全量回归 run66 十九套 **628/628**（摘要 `run66-summary.txt`；未跑真站 phase3s/3q）
7. ✅ README §5.37 + §5.33 + 能力清单；task.md 第三十三阶段表 + 顶部状态段；项目记忆 `ecclaw_phase4h_xlsx_formats.md` + `MEMORY.md` 索引
8. ✅ `prompt-ecclaw-phase4h-next.md`（<30 行，只做接力指针）
9. ⬜ **git commit** —— `__FEAT_COMMIT__`（feat）+ `__DOC_COMMIT__`（docs 回填 hash，**不 amend**）

---

## 12. 本轮踩坑（留给下一轮）

1. **上下文 160K 硬闸门会真的拦人**：撞线后 PreToolUse 只放行 Write/Edit，Bash/Read/Grep 全被拒 →
   唯一出路是**提前写 handoff 再开新会话**。本轮中途中断过一次。
   → 写代码前先估一下「还要读多少」，长文件读一次后**只引用路径**。
2. **工程格式的尾数归一化**不能套科学计数法的「≥10 就归 1、指数 +1」——
   必须按 `pat.engineering` 分叉，否则 `12.3E+3` 会被压回 `1.23E+4`（本轮最后一个 bug）。
3. **掩码层的作用被低估了**：占位段识别搬到掩码串上以后，缩放逗号 bug 才顺带修好 ——
   说明「哪段是结构、哪段是文字」没分清时，**下游一串规则都会失灵**。
4. **负向断言扫「值」不是扫整行**：标签 `无locale-英文月` 里就有「月」字，
   整行扫会误伤 → 先切掉 `label | ` 前缀。
5. **改了行为要同步改旧断言**：phase4d 的两条期望值是**行为修正**（Excel 本来就是工程格式），
   不是回归 —— 改期望值 + 在 README 注明，两边都要做。
6. **跑回归前先手动起 Electron**：`powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Temp/ecclaw-verify/start-electron.ps1"`，
   并确认 `curl http://127.0.0.1:9222/json/list` 能出 `out/renderer/index.html`，
   否则驱动第一套会被判 `ENV-DEAD skip`。
7. **别把旧驱动留在后台跑**：它会用同一前缀覆盖 summary / log（曾把 580/580 污染成 26/31）。
   本轮跑前查过 `Get-CimInstance Win32_Process` 确认无残留。
   收尾时**以日志文件为准重建摘要**（数 `[*] PASS` / `[*] FAIL`），别只信 summary 文本。
8. **e2e 的 `send()` 必须带 90s 超时**：`patch-e2e-timeout.cjs` 已给 19 套打过补丁，
   新写的 e2e（`phase4h-e2e.cjs`）也自带该补丁。
