# handoff · ecclaw 第三十三阶段（phase4h）· WIP · XLSX 单位/工程/会计格式 + 日期 locale · 2026-11-05

> **状态：进行中（未完成，未提交）**。上下文撞 160K 硬闸门被拦 → 强制开新会话。
> 代码改动**已落盘**（`electron/main/document-preview.ts`），但**尚未验证、未跑测试、未提交**。
> 接手第一件事：跑 §6 的探针命令，确认工程格式那处修复是否生效。

---

## 1. 一句话结论

选题：**XLSX 单位 / 工程 / 会计格式 + 日期 locale 本地化**（用户从 phase4g §9 候选里选定，
并逐项确认了三个口径：会计紧凑输出、日期仅 locale 前缀触发、设计认可开工）。
只改 `electron/main/document-preview.ts`，不动契约 / host-bridge / MCP / UI → **工具数仍 27**。

---

## 2. 基线与工作区状态

- 项目根：`F:\soft\00selfmade\ecclaw`（git 仓库）
- **HEAD = `1d58bc6`**（`docs: note stale regression driver can clobber run65 artifacts`）
- 上一阶段实质改动：`0d99c96`（phase4g XLSX 区间级条件格式）
- **工作区：脏** —— `electron/main/document-preview.ts` 有本轮未提交改动（见 §4）。
  其余文件未动；**没有**新建仓库内文件（探针/夹具都在 `C:\Temp\ecclaw-verify\`）。

---

## 3. 已获用户确认的设计（不要重新讨论）

| 项 | 决定 |
|---|---|
| 会计格式输出口径 | **紧凑**：正 `$1,234.50` / 负 `$(1,234.50)` / 零 `$-`；`*` 填充与 `_` 宽度占位丢弃 |
| 日期本地化触发 | **仅 locale 前缀触发**：格式码含 `[$-804]` / `[$-0804]` → 中文（`3月`/`三月`/`周三`/`星期三`/`上午`）；否则保持英文（不破坏 3y/3z/4d 既有断言） |
| 工程格式 | 尾数整数位槽 ≥2（`##0.0E+0`）→ 指数向下取 3 的倍数；`0.00E+00` 科学格式行为不变 |
| 单位/缩放 | 小数点后尾逗号算缩放逗号；小数位槽位只数 `0/#/?` |
| 范围 | 只改数字格式渲染层；输出通道不变（仍 `[颜色:X;底色:Y]`）；**不做** `containsBlanks`、图形类条件格式、真站套件 |

**为什么会计格式只能紧凑输出**：`normalizeText()` 会把连续空格压成 1 个、删行尾空格 →
Excel 会计格式的对齐留白（`_(` `_)` 的宽度占位、`*` 填充）在纯文本里**本来就不可见**。

---

## 4. 已落盘的代码改动（`electron/main/document-preview.ts`）

按改动顺序：

1. **`DateTokenType`**（约 1194 行）加了 `'locale'`。
2. **`tokenizeDateCode()`** 的 `[` 分支：新增 locale 判定
   `const locale = /^\$-([0-9A-Fa-f]+)$/.exec(inner)` → 命中就 push `{type:'locale', text:locale[1]}`，
   **不产生字面量**；否则走原来的时长 / 货币分支。
3. **`MONTH_ZH` / `WEEK_ZH` / `isZhLocale()`**（紧跟 `WEEK_LONG` 之后）：
   `MONTH_ZH = ['一'…'十二']`、`WEEK_ZH = ['日','一','二','三','四','五','六']`；
   `isZhLocale(id)` 去掉前导 0 后比 `'804'`。
4. **`renderDateCode()`**：`const zh = localeToken !== undefined && isZhLocale(localeToken.text)`；
   `m` token → zh 时 `mmm`=`` `${p.mo}月` ``、`mmmm`=`` `${MONTH_ZH[p.mo-1]}月` ``、`mmmmm`=首字；
   `d` token → zh 时 `ddd`=`` `周${WEEK_ZH[w]}` ``、`dddd`=`` `星期${WEEK_ZH[w]}` ``；
   `ampm`/`ap` → zh 时 `上午`/`下午`。
5. **`flattenFormatSection()`** 的 `[` 分支：locale 前缀显式跳过
   （`if (!/^\$-[0-9A-Fa-f]+$/.test(inner))` 才取货币符号）——行为不变，但不再是「碰巧不漏」。
6. **`parseNumberPattern()` 整体重写**：
   - 数值占位段改为**在掩码串 `masked` 上扫描**（`#0?` / `,` / `.`），字面量位置已挖空 →
     `"12"0.00` 的 12 不再被当成占位段（顺带修了旧 regex 在 flat 上匹配的隐患）。
   - 占位段**末尾的逗号 = 缩放逗号**（每个 ÷1000）；整数位中间的逗号 = 千分位。
   - `prefix`/`suffix` 取自 flat、`start`/`end` 取自 masked（两者等长）。
   - `percent` 改用 masked 统计（引号里的 `%` 不算）。
   - **旧行为差异**：旧的 `core` regex 不含小数点后的尾逗号 → `0.0,` / `#,##0.0,,` 的缩放失效（已修）。
7. **新增 `groupThousands()` / `renderIntSlots()`**：
   - `renderIntSlots(intPattern, digits, grouping, zeroValue)` 按 Excel 槽位语义渲染整数位：
     `0` 槽没数字显示 0、`#` 槽不显示、`?` 槽显示空格；数字右对齐填最右槽；槽不够不截断。
   - `zeroValue && digits === '0' && !intPattern.includes('0')` → 该 0 不占槽
     （**Excel 会计零段 `_($* "-"??_)` 靠这个只出横线**）。
8. **`renderNumberCode()`** 整数位改走 `renderIntSlots(...)`（删掉旧的 `padStart(minInt,'0')` + 千分位拼接）。
9. **科学计数法 → 工程格式**：
   - `SciPattern` 加 `engineering: boolean`；`parseScientificPattern()` 里
     `engineering: (intPat.match(/[#0?]/g) ?? []).length >= 2`。
   - `renderScientific()`：对齐后 `exp = Math.floor(exp / 3) * 3; mant = abs / 10^exp`。
   - **尾数归一化改成 `if (!pat.engineering && Math.abs(mantRounded) >= 10)`** ——
     工程格式尾数落在 [1,1000)，不能按 10 归一（否则 12.3E+3 会被压回 1.2E+4）。
     **这条是最后改的、还没验证过。**

---

## 5. 实测证据（探针，改造前后）

探针脚本已在 `C:\Temp\ecclaw-verify\`：
`probe-4h.cjs`（单位/工程/会计主表）、`probe-4h-b.cjs`（locale/缩放/`?`/工程细项）。
两者都直接 `require('C:/Temp/ecclaw-verify/tsout/main/document-preview.js')` 的 `previewDocument`。

**改造后（`probe-4h.cjs`）实测**：

```
单位-引号kg | 12.5kg          ✅ 本来就对
单位-引号件 | 1,234 件        ✅
单位-中文元 | 3.50万元        ✅
单位-反斜杠 | 12.5kg          ✅
单位-缩放逗号 | 12.3百万      ✅ 新修复（原来 12,345,678.0,,百万）
单位-缩放尾逗号 | 12          ✅
单位-小数后逗号 | 1.2          ✅ 新修复（原来 1234.0,）
工程-内置48 | 1.2E+4         ❌ **待修**（期望 12.3E+3）
工程-一位E | 1.2E+4           ❌ 同上
工程-两位E | 1.23E+04         ❌ 同上（期望 12.35E+03）
工程-负数 | -1.2E+4           ❌
工程-小数 | 12.3E-5           ❌ 归一化 bug 的症状
会计-美元四段 | $1,234.50     ✅
会计-美元负 | $(1,234.50)     ✅
会计-美元零 | $-              ✅ 新修复（原来 $-0）
会计-无币种 | 1,234.50        ✅
会计-人民币 | ¥1,234.50       ✅
会计-四段-正 | $1,234.50      ✅
会计-负段括号 | (1,234.50)    ✅
货币-美元 | $1,234.50         ✅
货币-人民币 | ¥1,234.50       ✅
日期-mmm中文 | 2023年3月15日   ✅（引号字面量路径）
日期-EEEE | 2023-03-15 Wednesday  ✅（无 locale → 英文，符合设计）
日期-中文AMPM | 12:00 PM      ✅（无 locale → 英文，符合设计）
```

> ⚠️ 上表是**尾数归一化修复之前**的输出。修复已落盘（§4 第 9 条），**必须重跑确认**。

---

## 6. 接手第一步（复现命令）

```bash
cd /f/soft/00selfmade/ecclaw
pnpm typecheck
pnpm exec tsc electron/main/document-preview.ts electron/main/paths.ts electron/shared/types.ts \
  --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron --module commonjs --target ES2022 \
  --moduleResolution node --esModuleInterop --skipLibCheck
NODE_PATH=F:/soft/00selfmade/ecclaw/node_modules node C:/Temp/ecclaw-verify/probe-4h.cjs
NODE_PATH=F:/soft/00selfmade/ecclaw/node_modules node C:/Temp/ecclaw-verify/probe-4h-b.cjs
```

**期望（`probe-4h.cjs`）**：
`工程-内置48 | 12.3E+3` · `工程-一位E | 12.3E+3` · `工程-两位E | 12.35E+03` ·
`工程-负数 | -12.3E+3` · `工程-小数 | 123.0E-6` · 其余同 §5。

**期望（`probe-4h-b.cjs`）**：
`locale-前缀 | 1234.50`（`[$-804]` 不漏字面量）· `locale-中文日期 | 2023年3月15日` ·
`locale-mmm | 3月 15, 2023`（**zh-CN locale 触发中文**）· `locale-货币 | ¥1,234.50` ·
`locale-欧元 | €1,234.50` · `缩放-小点后1 | 1.2` · `缩放-小点后2 | 12.3` · `缩放-尾逗号 | 12` ·
`问号-整数槽 |  5.00`（`?` 槽补空格）· `问号-零段 | $-` · `问号-整格 | 5` ·
`工程-3倍数 | 12.3E+3` · `工程-负 | -12.3E+3` · `科学-对照 | 1.23E+04`（科学不变）· `工程-无参 | 0.0E+0`。

若 `工程-*` 仍不对：**先查尾数归一化那处**（§4 第 9 条），
再查 `parseScientificPattern()` 的 `intPat` 是否真是 `##0`（工程判据 = 整数位槽数 ≥2）。

---

## 7. 剩余必交付（按序）

1. ✅ 设计（用户已确认）
2. ⬜ 跑通 §6 探针，工程格式全部对上
3. ⬜ **回归防线**：`node C:/Temp/ecclaw-verify/phase4d-selftest.cjs` 必须仍 **全绿**
   （phase4d 断言了 `科学两位 1.23E+04` / `科学内置48 1.2E+4` / `字面量E E12.50` /
   `字面量斜杠 12.5` / 分数系列 —— **本轮改了整数位与科学归一化，这些必须逐条复核**，
   尤其 `科学内置48`：旧期望 `1.2E+4`，按新工程规则 `##0.0E+0` 应变成 `12.3E+3` →
   **若 phase4d-selftest 因此变红，属预期（行为修正），要改 phase4d-selftest 的期望值并在
   README §5.33 注明「`##0.0E+0` 属工程格式，指数取 3 的倍数」**）。
   先跑一遍看它红几条，再决定。
4. ⬜ 新夹具 `C:\Temp\ecclaw-verify\make-phase4h-fixtures.cjs` → `fmt4h.xlsx`
   （照抄 `make-phase4d-fixtures.cjs` 的骨架：contentTypes / rootRels / workbook / workbookRels /
   styles(numFmts+cellXfs) / sheetData）
5. ⬜ 秒级自测 `C:\Temp\ecclaw-verify\phase4h-selftest.cjs`（照抄 `phase4d-selftest.cjs` 骨架，
   **整行相等**比对 + 行数 + kind + error；含负向断言：不该出中文的格式不能出中文）
6. ⬜ e2e `C:\Temp\ecclaw-verify\phase4h-e2e.cjs`（照抄 `phase4g-e2e.cjs` 骨架）
7. ⬜ 全量回归：复制 `rerun-and-regress17.cjs` → 新前缀 `run66-*`（**别覆盖 run65**），
   十九套，不跑真站 phase3s/3q。摘要 `run66-summary.txt`。
8. ⬜ `README.md` 新增 §5.37 + 底部能力清单一条；§5.33 补工程格式说明
9. ⬜ `task.md` 第三十三阶段表 + 顶部状态段
10. ⬜ 项目记忆 `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/ecclaw_phase4h_xlsx_formats.md`
    + `MEMORY.md` 索引一行
11. ⬜ `handoff-ecclaw-phase4h-final-2026-11-05.md`（收官）+ `prompt-ecclaw-phase4h-next.md`（<30 行）
12. ⬜ **精确 `git add` + Conventional Commits**（禁止 `git add -A`）

---

## 8. 红线（沿用 phase4g §8）

- 禁删用户文件；e2e 写进文件库的 `ecclaw-phase4h-*.xlsx` 等**留着别删**。
- `openclaw.json` / `host-bridge.json` 在 stateDir，**不得提交**。
- **不跑真站 phase3s / phase3q**（不碰淘宝）。
- 临时产物写 `C:\Temp\`；handoff/task **不进** `memory/`。
- GUI 验证走 **CDP**，不要 computer-use 截 Electron 屏。
- 提交只 `git add` 精确文件。

## 9. 踩坑（phase4g 遗留，本轮务必照做）

- **跑回归前先手动起 Electron**：`powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Temp/ecclaw-verify/start-electron.ps1"`，
  并确认 `curl http://127.0.0.1:9222/json/list` 能出 `out/renderer/index.html`，
  否则驱动第一套会被判 `ENV-DEAD skip`。
- **别把旧驱动留在后台跑**：它会用同一前缀覆盖 summary / log（曾把 580/580 污染成 26/31）。
  跑新驱动前先确认没有旧驱动进程。
- **收尾以日志文件为准重建摘要**（数 `[*] PASS` / `[*] FAIL`），别只信 summary 文本。
- e2e 的 `send()` 已由 `patch-e2e-timeout.cjs` 打过 90s 超时补丁（新写的 e2e 也要带超时）。

## 10. 必读顺序

1. 本文档
2. `handoff-ecclaw-phase4g-final-2026-11-05.md`
3. `README.md` §5.32 / §5.33 / §5.36
4. `electron/main/document-preview.ts` 的格式渲染段（约 1150–1850 行）
