# handoff · ecclaw 第三十四阶段（phase4i）· WIP · XLSX locale 扩展 + 文本 @ 字面量 · 2026-11-05

> **一句话结论**：代码**已全部落地并通过秒级自测 47/47 + typecheck ✅**，但**卡在上下文 160K 硬闸门**，
> `pnpm build` / e2e / 十九套回归 / 收尾 / commit **全部未做**。新会话**从 §5 的命令清单接手即可**。
> ⚠️ 工作区有**未提交**改动（`electron/main/document-preview.ts`），**不要 reset/checkout**。

---

## 1. 本轮选题与已确认设计（用户已逐项确认，勿重开讨论）

从 `handoff-ecclaw-phase4h-final-2026-11-05.md` §9 候选里选 **A：XLSX 渲染层补齐**，
但**开打前先探针实测**，结果推翻了候选清单的两条（详见 §3）：

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

## 2. 已落地的代码改动（`electron/main/document-preview.ts`，未提交）

| # | 位置 | 改动 |
|---|---|---|
| ① | 原 `isZhLocale()` 处 | 删掉 `isZhLocale()`；新增 `MONTH_JA/WEEK_JA_*`、`MONTH_DE_*`、`MONTH_FR_*` 表；新增 `type LocaleLang = 'zh'\|'zhTW'\|'ja'\|'de'\|'fr'\|'en'`、`interface LocaleNames`（含 `monthStyle: 'latin'\|'zh'\|'cjkNum'`、`weekStyle: 'latin'\|'zh'`）、`LOCALE_NAMES` 表；新增 `localeKind(localeId)`（LCID 去前导 0 + 小写 → locale，**认不出返回 null 落英文**）；新增 `renderMonthName()` / `renderWeekName()` |
| ② | `renderDateCode()` 头部 | `zh` 布尔 → `lang: LocaleLang` + `names = LOCALE_NAMES[lang]` + `cjkAmPm` |
| ③ | `renderDateCode()` switch | `'m'`/`'d'` 改走 `renderMonthName`/`renderWeekName`；`'h'`/`'s'` 加 `inDuration` 分支；`'ampm'`/`'ap'` 用 `names.am/pm`；`'eh'/'em'/'es'` 置 `inDuration = true`；新增 `let inDuration = false` |
| ④ | 新增 `renderTextCell()` + 表格文本格分支 | 文本格（`t="s"`/`inlineStr`/`str`）走 `renderTextCell(value, code)`：取第 4 段（不足 4 段取第 1 段）→ `flattenFormatSection` → 找**结构** `@`（掩码串）→ 输出 `前缀字面量+文本+后缀字面量`；无结构 `@` 的格式段不生效 |

**行为不变的部分（phase4h 的既有断言必须继续绿）**：zh-CN 的 `mmm`/`mmmm`/`dddd`/`AM-PM` 输出**一字未动**；
英文输出**一字未动**；纯数字格式对文本格**不生效**（`0.00` 套文本仍是 `abc`）。

---

## 3. 探针结论（阶段 4i 的最大收获：§9 候选清单有两条已过期）

`C:\Temp\ecclaw-verify\probe-4i.cjs` + `make-phase4i-probe.cjs` 实测：

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

## 4. 已验证 / 未验证

| 项 | 状态 |
|---|---|
| `pnpm typecheck` | ✅ 无错 |
| 秒级自测 `phase4i-selftest.cjs` | ✅ **47/47**（41 条整行相等 + 行数 + kind + error + 4 条负向断言） |
| `pnpm build` | ❌ **未跑**（被上下文闸门拦下） |
| e2e `phase4i-e2e.cjs` | ❌ **未跑**（文件已写好） |
| 全量回归 run67 | ❌ **未跑** |
| README / task.md / 项目记忆 / 收官 handoff / commit | ❌ **未做** |

**自测的 4 条负向断言**（防「误本地化」的主力）：
① 非中文/日语/文本的**数值行**值里不得出现任何 CJK；② 英文/未知 locale 行必须保持英文；
③ 德/法行不得出现 CJK；④ 负向扫描只扫**值**（切掉 `label | ` 前缀）—— 标签本身含中文会误伤。

---

## 5. 下一步必做（命令清单，按序）

```bash
cd /f/soft/00selfmade/ecclaw

# ① 编译 + 秒级自测（先复跑，确认基线没被环境改动）
pnpm typecheck && pnpm build
node C:/Temp/ecclaw-verify/make-phase4i-fixtures.cjs
pnpm exec tsc electron/main/document-preview.ts electron/main/paths.ts electron/shared/types.ts \
  --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron --module commonjs --target ES2022 \
  --moduleResolution node --esModuleInterop --skipLibCheck
NODE_PATH=F:/soft/00selfmade/ecclaw/node_modules node C:/Temp/ecclaw-verify/phase4i-selftest.cjs

# ② 起 Electron + e2e（务必先手动起，确认 9222 能出 out/renderer/index.html）
node C:/Temp/ecclaw-verify/stop-electron.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Temp/ecclaw-verify/start-electron.ps1"
curl http://127.0.0.1:9222/json/list
node C:/Temp/ecclaw-verify/phase4i-e2e.cjs \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs" \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json"

# ③ 全量回归：复制 rerun-and-regress18.cjs → rerun-and-regress19.cjs
#    · 产物前缀 run66-* → run67-*（**不许覆盖 run66**）
#    · 套件列表加 phase4i-e2e.cjs（19 套 → 20 套）
#    · 跑前查 Get-CimInstance Win32_Process 确认没有旧驱动残留（它会用同前缀覆盖 summary/log）
node C:/Temp/ecclaw-verify/rerun-and-regress19.cjs
#    收尾**以日志文件为准**重建摘要（数 [*] PASS / [*] FAIL），别只信 summary 文本

# ④ 收尾
#    README 新增 §5.38 + §5.37 补一句 locale 扩展；底部能力清单补一条
#    task.md 顶部状态段 + 「第三十四阶段」表
#    项目记忆 ~/.claude/projects/F--soft-00selfmade-ecclaw/memory/ecclaw_phase4i_locale.md + MEMORY.md 索引
#    handoff-ecclaw-phase4i-final-2026-11-05.md（收官版）+ prompt-ecclaw-phase4i-next.md（<30 行）
#    git add 精确文件（**禁止 git add -A**）；openclaw.json / host-bridge.json **不得提交**
```

**e2e 断言数**：工具面 3 + 抽取 42（41 条期望 + kind + error + 2 条负向）+ 界面 6 → 预期 **51** 条。

---

## 6. 环境基线

- 项目根：`F:\soft\00selfmade\ecclaw`（git 仓库，HEAD = `c90fe27` docs: record phase 4h commit hash）
- 工作区：**有未提交改动**（`electron/main/document-preview.ts`）→ 提交前先 `git diff` 复核
- stateDir：`C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw`
- MCP 工具数：**27**（本轮不变）；依赖：**无新增**
- 临时资产目录：`C:\Temp\ecclaw-verify\`（**不进仓库**）

**本轮临时资产清单**：
`make-phase4i-fixtures.cjs`（夹具：34 数值用例 + 7 文本用例 → `fmt4i.xlsx`）·
`phase4i-selftest.cjs`（47 项）· `phase4i-e2e.cjs`（端到端）·
`make-phase4i-probe.cjs` / `probe-4i.cjs`（探针：duration / 科学计数法 / locale）·
`make-phase4i-probe2.cjs`（探针：文本 @）

---

## 7. 本轮踩坑（留给下一轮）

1. **上下文 160K 硬闸门又拦了一次**（164K 时 Bash 被拒，只放行 Write/Edit）。
   → **写代码前先估「还要读多少」**；长文件读一次后**只引用路径**；大改动前先把设计敲定、少回头读。
   → 本轮的具体成因：读了 phase4h handoff（240 行）+ `document-preview.ts` 的 700 行渲染层 + phase4h e2e 全文（270 行）。
2. **§9 的候选清单会过期**：phase4h 留下的「duration / 科学计数法负指数」两条**早已实现**。
   → 下一轮**先探针实测再选题**，别直接照抄上一份 handoff 的候选表。
3. **§9 的 LCID 写错了**（`[$-407]` 当成法语）：locale 类需求**先核 LCID 表**再动手。
4. **自测的负向断言要扫「值」不扫整行**：标签 `文本-第四段` 本身含中文 → 整行扫会误伤；
   且**文本用例**（自带中文字面量）要从 CJK 负向检查里排除。
5. `renderTextCell` 靠**掩码串**区分「结构 @」与「字面量里的 @」：`"a@b"@` → `a@bx`（掩码挖空字面量位置）。
6. `flattenFormatSection` 的 text 与 masked **等长**，所以掩码下标可直接当字面量下标用。

---

## 8. 待办清单（新会话照此推进）

1. `pnpm build` ✅ → 2. e2e（先起 Electron、确认 9222）→ 3. 全量回归 run67（19 → 20 套）→
4. 收尾五件套（README / task.md / 项目记忆 / handoff-final / prompt）→ 5. **精确 `git add` + commit**
（提交建议拆两个：`feat(document-preview): add XLSX locale expansion and text placeholders` +
`docs: record phase 4i commit hash in handoff`）。
