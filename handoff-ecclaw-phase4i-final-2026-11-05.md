# handoff · ecclaw 第三十四阶段（phase4i）· 收官 · XLSX locale 扩展 + 文本 @ 字面量 · 2026-11-05

> **一句话结论**：第三十四阶段**已完成并真机验证**——
> 代码落地 ✅ · typecheck ✅ · build ✅ · 秒级自测 **47/47** ✅ · e2e **53/53** ✅ ·
> 全量回归 **run67 二十套 681/681 全绿** ✅ · README / task.md / 项目记忆 / handoff / prompt 已写 ✅。
> 只改 `electron/main/document-preview.ts` 一个产品文件，**MCP 工具数仍 27**，无新增依赖。

---

## 1. 本轮选题与已确认设计（用户逐项确认，勿重开讨论）

从 `handoff-ecclaw-phase4h-final-2026-11-05.md` §9 候选里选 **A：XLSX 渲染层补齐**，
但**开打前先探针实测**，结果推翻了候选清单的两条（详见 §3）。

| 项 | 用户确认的决定 |
|---|---|
| locale 范围 | **5 种**：zh-CN(804, 已有) + zh-TW(404) + ja-JP(411) + de-DE(407) + fr-FR(40C)；en-US(409) 显式支持 |
| 文本格 `@` 字面量 | **做**（`"¥"@` → `¥abc`） |
| locale 是否改日期先后顺序 | **不改**（格式码怎么写就怎么输出，保持可复现） |
| duration 一致性小修 | **做**（mm/ss 改从 `totalSec` 取模） |

**范围**：只改 `electron/main/document-preview.ts`；契约 / `host-bridge.ts` / `host-server.mjs` /
`src/App.tsx` 全不动 → **MCP 工具数仍 27**，输出通道不变。
**不做**：`containsBlanks`（空白格输出结构改动，回归面大）、图形类条件格式、邮件 worker、画布宿主、真站套件。

---

## 2. 已落地的代码改动（`electron/main/document-preview.ts`）

| # | 位置 | 改动 |
|---|---|---|
| ① | 原 `isZhLocale()` 处 | 删掉 `isZhLocale()`；新增 `MONTH_JA/WEEK_JA_*`、`MONTH_DE_*`、`MONTH_FR_*` 表；新增 `type LocaleLang = 'zh'\|'zhTW'\|'ja'\|'de'\|'fr'\|'en'`、`interface LocaleNames`（含 `monthStyle: 'latin'\|'zh'\|'cjkNum'`、`weekStyle: 'latin'\|'zh'`）、`LOCALE_NAMES` 表；新增 `localeKind(localeId)`（LCID 去前导 0 + 小写 → locale，**认不出返回 null 落英文**）；新增 `renderMonthName()` / `renderWeekName()` |
| ② | `renderDateCode()` 头部 | `zh` 布尔 → `lang: LocaleLang` + `names = LOCALE_NAMES[lang]` + `cjkAmPm` |
| ③ | `renderDateCode()` switch | `'m'`/`'d'` 改走 `renderMonthName`/`renderWeekName`；`'h'`/`'s'` 加 `inDuration` 分支；`'ampm'`/`'ap'` 用 `names.am/pm`；`'eh'/'em'/'es'` 置 `inDuration = true`；新增 `let inDuration = false` |
| ④ | 新增 `renderTextCell()` + 表格文本格分支 | 文本格（`t="s"`/`inlineStr`/`str`）走 `renderTextCell(value, code)`：取第 4 段（不足 4 段取第 1 段）→ `flattenFormatSection` → 找**结构** `@`（掩码串）→ 输出 `前缀字面量+文本+后缀字面量`；无结构 `@` 的格式段不生效 |

**行为不变的部分（phase4h 的既有断言必须继续绿）**：zh-CN 的 `mmm`/`mmmm`/`dddd`/`AM-PM` 输出**一字未动**；
英文输出**一字未动**；纯数字格式对文本格**不生效**（`0.00` 套文本仍是 `abc`）。

---

## 3. 探针结论（本轮最大收获：§9 候选清单有两条已过期）

`C:\Temp\ecclaw-verify\make-phase4i-probe.cjs` + `probe-4i.cjs` + `make-phase4i-probe2.cjs` 实测：

| §9 候选 | 探针实测 | 判定 |
|---|---|---|
| 日期 duration `[h]:mm:ss` | `1.5011574074` → `36:01:40`；`[m]:ss` → `2160:00`；`[ss]` → `43200`；负值 → `-12:00:00` —— **与 Excel 一致** | ✅ **早已实现**（§9 这条候选过期） |
| 科学计数法负指数 / `E-` | `0.00E+00` → `1.23E-04`；`0.00E-00` → `1.23E-04` / `1.23E04`；`0.00E00` → `1.23E04` —— **与 Excel 一致** | ✅ **早已实现**（§9 这条候选过期） |
| locale 扩展 | `[$-411]/[$-407]/[$-40C]/[$-404]` 全部回落英文 `Mar` | ❌ **真缺口** → 本轮做 |
| 文本格 `@` 字面量 | `"¥"@` → `abc`（Excel 是 `¥abc`）；`"预"@"后"` → `abc` | ❌ **真缺口** → 本轮做 |

**顺带纠正 handoff §9 的 LCID 错误**：`[$-407]` 是**德语**不是法语；法语是 **0x40C**；日语是 **0x411**
（§9 写的 `[$-041]` 无此 LCID）。

**duration 的取数改动**（本轮唯一的行为修正，且实测输出不变）：
旧实现里 `mm`/`ss` 取的是**当天时钟**的 `p.mi`/`p.ss`（平时恰等于总时长的 mod 60，亚秒舍入边界会差 1 秒）；
改成进入 duration 上下文（`eh`/`em`/`es` 之后）后从 `totalSec` 取：`h`=总小时、`m`=总分钟 mod 60、`s`=总秒 mod 60。

---

## 4. 验证结果（全部已跑）

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 无错 |
| `pnpm build` | ✅ 三段全过（out/main · out/preload · out/renderer） |
| 秒级自测 `phase4i-selftest.cjs` | ✅ **47/47**（41 条整行相等 + 行数 + kind + error + 4 条负向断言） |
| e2e `phase4i-e2e.cjs` | ✅ **53/53**（工具面 3 · 抽取 45 · 界面 5） |
| 全量回归 run67 | ✅ **二十套 681/681 全绿**（FAIL = 0，以 `run67-*.log` 逐个数 `[*] PASS` / `[*] FAIL` 为准） |
| README / task.md / 项目记忆 / handoff / prompt | ✅ 已写 |

**回归明细**（`run67-summary.txt`）：
4i 53 · 4h 48 · 4g 30 · 4f 26 · 4e 21 · 4d 31 · 4c 26 · 4b 18 · 4a 20 ·
3z 37 · 3y 31 · 3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14
→ 合计 **681**；**未跑真站 phase3s / phase3q**（本阶段红线：不碰淘宝）。

**自测的 4 条负向断言**（防「误本地化」的主力）：
① 非中文/日语/文本的**数值行**值里不得出现任何 CJK；② 英文/未知 locale 行必须保持英文；
③ 德/法行不得出现 CJK；④ 负向扫描只扫**值**（切掉 `label | ` 前缀）—— 标签本身含中文会误伤。

---

## 5. 收尾产物清单

| 文件 | 状态 |
|---|---|
| `electron/main/document-preview.ts` | ✅ 唯一产品改动 |
| `README.md` | ✅ 新增 §5.38；§5.37 补一句「locale 范围已在 §5.38 扩展」；底部能力清单加一条 |
| `task.md` | ✅ 顶部状态段加「第三十四阶段」；新增「第三十四阶段」交付表 + 8 条实证发现 |
| `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/ecclaw_phase4i_locale.md` | ✅ 新建 |
| 同目录 `MEMORY.md` | ✅ 加索引一行 |
| `handoff-ecclaw-phase4i-final-2026-11-05.md` | ✅ 本文件（收官版） |
| `prompt-ecclaw-phase4i-next.md` | ✅ <30 行，只做指针 |
| `handoff-ecclaw-phase4i-wip-2026-11-05.md` | ⚠️ WIP 版，**已被本收官版取代**，可保留不删 |

---

## 6. 环境基线

- 项目根：`F:\soft\00selfmade\ecclaw`（git 仓库）
- stateDir：`C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw`
- MCP 工具数：**27**（本轮不变）；依赖：**无新增**
- 临时资产目录：`C:\Temp\ecclaw-verify\`（**不进仓库**）

**本轮临时资产清单**：
`make-phase4i-fixtures.cjs`（夹具：34 数值用例 + 7 文本用例 → `fmt4i.xlsx`）·
`phase4i-selftest.cjs`（47 项）· `phase4i-e2e.cjs`（端到端 53 项）·
`make-phase4i-probe.cjs` / `probe-4i.cjs`（探针：duration / 科学计数法 / locale）·
`make-phase4i-probe2.cjs`（探针：文本 @）· `rerun-and-regress19.cjs`（run67 驱动，20 套）

---

## 7. 本轮踩坑（留给下一轮）

1. **上下文 160K 硬闸门拦了一次**（164K 时 Bash 被拒，只放行 Write/Edit）→ 被迫在收尾前落 WIP handoff。
   → **写代码前先估「还要读多少」**；长文件读一次后**只引用路径**；大改动前先把设计敲定、少回头读。
   → 本轮的具体成因：读了 phase4h handoff（240 行）+ `document-preview.ts` 的 700 行渲染层 + phase4h e2e 全文（270 行）。
2. **§9 的候选清单会过期**：phase4h 留下的「duration / 科学计数法负指数」两条**早已实现**。
   → 下一轮**先探针实测再选题**，别直接照抄上一份 handoff 的候选表。
3. **§9 的 LCID 写错了**（`[$-407]` 当成法语）：locale 类需求**先核 LCID 表**再动手。
4. **自测的负向断言要扫「值」不扫整行**：标签 `文本-第四段` 本身含中文 → 整行扫会误伤；
   且**文本用例**（自带中文字面量）要从 CJK 负向检查里排除。
5. `renderTextCell` 靠**掩码串**区分「结构 @」与「字面量里的 @」：`"a@b"@` → `a@bx`（掩码挖空字面量位置）。
6. `flattenFormatSection` 的 text 与 masked **等长**，所以掩码下标可直接当字面量下标用。
7. **e2e 断言数要按实际数**：本轮实际 **53**（不是预估的 51）—— 工具面 3 + 抽取 45 + 界面 5。

---

## 8. 下一阶段候选（**先探针实测再选题**）

1. **文本格 `@` 的剩余形状**：`@` 在中间（`"a"@ "b"` 之外还有 Excel 的 `@` 与颜色段组合）、
   第 4 段的 `@` 与前 3 段的交互、`_(@_)` 这类会计文本段。
2. **日期 locale 的边角**：`[$-x-sysdate]`（系统日期格式）、`[$-F800]`（日期替换）、
   `L` 标签（`L` / `LL`）。
3. **`containsBlanks`**（区间条件格式的空白格规则）—— 需改空白格渲染结构，回归面大，
   做之前先评估。
4. **图形类条件格式**（colorScale / dataBar / iconSet）—— 需引入刻度映射，输出通道要扩。
5. **真站套件**（phase3s / phase3q）—— 只在用户明确放开红线时做。

> ⚠️ **下一轮第一件事：先写探针脚本实测候选清单**，别照抄 §8（见 §7.2 —— 候选会过期）。

---

## 9. 提交与收尾清单

| 提交 | 内容 |
|---|---|
| `__FEAT_COMMIT__` | `feat(document-preview): add XLSX locale expansion and text placeholders` —— 本次回填 |
| `__DOC_COMMIT__` | `docs: record phase 4i commit hash in handoff` —— 本次回填 |

已精确 `git add` 下列文件提交（**未用 `git add -A`**）：
`electron/main/document-preview.ts` · `README.md` · `task.md` ·
`handoff-ecclaw-phase4i-final-2026-11-05.md` · `handoff-ecclaw-phase4i-wip-2026-11-05.md` ·
`prompt-ecclaw-phase4i-next.md`

**未提交（禁入仓库）**：`openclaw.json` / `host-bridge.json` / `C:\Temp\ecclaw-verify\*` 全部临时资产。

收尾核对：

1. ✅ `pnpm typecheck` 无错
2. ✅ `pnpm build` 三段全过
3. ✅ 秒级自测 **47/47**
4. ✅ e2e **53/53**
5. ✅ 全量回归 run67 二十套 **681/681**（摘要 `run67-summary.txt`；未跑真站 phase3s/3q）
6. ✅ README §5.38 + §5.37 补注 + 底部能力清单；task.md 第三十四阶段表 + 顶部状态段；
   项目记忆 `ecclaw_phase4i_locale.md` + `MEMORY.md` 索引
7. ✅ `prompt-ecclaw-phase4i-next.md`（<30 行，只做接力指针）
8. ✅ **git commit** —— `__FEAT_COMMIT__`（feat）+ `__DOC_COMMIT__`（docs 回填 hash，**不 amend**）
