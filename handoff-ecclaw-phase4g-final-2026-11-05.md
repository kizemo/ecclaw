# handoff · ecclaw 第三十二阶段（phase4g）· XLSX 区间级条件格式（top10 / 均值 / 重复值） · 2026-11-05

> **一句话结论**：XLSX 条件格式从「逐格判定」扩到「区间级判定」——
> 补上此前被**静默丢弃**的 4 类规则（`top10` / `aboveAverage` / `duplicateValues` / `uniqueValues`）。
> 抽取流程改成**三趟**（解析全部单元格 → 按范围算命中集合 → 逐格套颜色）。
> **工具数仍 27**，未新增依赖，只改 `electron/main/document-preview.ts` 一个文件，输出格式不变。
> 秒级自测 **55/55**、**phase4g e2e 30/30**、typecheck/build ✅。
> ✅ **全量回归 run65 十九套 580/580 全绿**（`run65-summary.txt`；未跑真站 phase3s/3q）。
> 上一轮跑到 phase3y 时 **Electron 进程中途消失**导致 MCP 调用挂死 —— 根因是 e2e 的 `send()`
> **无超时**；本轮给全部 19 套的 `send()` 打了 90s 超时补丁（**只改 `C:\Temp` 下的测试脚本，
> 不涉及产品代码**），挂死变 fail-fast，phase3y 现 31/31 通过。详见 **§12**。

---

## 1. 本轮必读顺序

1. 本文档
2. `handoff-ecclaw-phase4f-final-2026-11-05.md`（上一阶段：PDF 目录 / 页码范围抽取）
3. `README.md` §5.32（XLSX 颜色 + 条件格式）· **§5.36（本轮）**
4. `task.md` 顶部状态段 + 第三十二阶段表
5. `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\ecclaw_phase4g_xlsx_range_cf.md`

---

## 2. 本轮选题与基线

- **选题**：从 `handoff-ecclaw-phase4f-final-2026-11-05.md` §8「下一阶段候选」里选
  **「条件格式扩展：top10 / aboveAverage / duplicateValues」**（用户确认取 **4 类区间级规则**这一档，
  不含 `containsBlanks`）。
- **基线**：`HEAD = f85cdd3`（`docs: record phase 4f commit hash in handoff`），
  工作区干净树；上一阶段的实质改动在 `9db8c51`。
- **上一份 handoff 记录的实现 commit**：`9db8c51`（11 files, +449/−12）。

---

## 3. 交付清单

| 文件 | 改动 |
|---|---|
| `electron/main/document-preview.ts` | ①`XlsxCfRule` 增 `id` / `rank` / `percent` / `bottom` / `aboveAverage` / `equalAverage` / `stdDev`；②新增 `RANGE_LEVEL_CF_TYPES` / `isRangeLevelCf()` / `cfCellKey()` / `dupKey()` / `sampleStdDev()` / `matchRangeLevelCf()` / `rangeLevelCfMatches()`；③`conditionalColors()` 增 `rangeMatches` 参数（区间级查命中集合，逐格规则照旧）；④`parseXlsxSheet()` 拆成**三趟**；⑤`parseConditionalFormatting()` 解析新属性 |
| `README.md` | 新增 §5.36；§5.32 末尾「top10 等跳过」改为指向 §5.36；底部能力清单补一条 |
| `task.md` | 顶部状态段 + 新增「第三十二阶段」表 + 实证发现 10 条 |
| `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/` | 新增 `ecclaw_phase4g_xlsx_range_cf.md`；`MEMORY.md` 加索引 |
| `handoff-ecclaw-phase4g-final-2026-11-05.md` | 本文档 |
| `prompt-ecclaw-phase4g-next.md` | 接力指针（<30 行） |

**未改动**：契约 `electron/shared/types.ts`、`electron/main/host-bridge.ts`、
`resources/mcp/host-server.mjs`、`src/App.tsx`、`src/styles.css` —— 本轮**不需要**（输出通道不变）。

### 临时资产（`C:\Temp\ecclaw-verify\`）

- `make-phase4g-fixtures.cjs` → `rangecf.xlsx`（**52 行 / 14 条规则**：14 个区块覆盖
  top2 / percent25 / bottom1 / aboveAverage / equalAverage / belowAverage / stdDev /
  duplicateValues / uniqueValues / 数字-文本不同类 / 多区域 sqref / rank>个数 / 单值均值 / percent50）
- `phase4g-selftest.cjs`（不走 Electron，**55 项**）
- `phase4g-e2e.cjs`（**30 条断言**：工具面 3 · 抽取 23 · 界面 4）
- `rerun-and-regress17.cjs`（**run65-\*** 驱动，19 套，不跑真站；单套 12 分钟超时 + 摘要逐套落盘）
- `patch-e2e-timeout.cjs`（给全部 `*-e2e.cjs` 的 `send()` 打 90s 超时补丁 → 见 §12）
- `run65-summary.txt`（十九套摘要 · **580/580 全绿**）· `run65-phase4g.log`（本轮 e2e 产物）
- `tsout/`（tsc 单文件转译产物）

---

## 4. 关键设计决策

1. **逐格判定是架构天花板 → 改三趟**：原 `conditionalColors()` 拿到一个格子就判一次，
   **看不到别的格子的值**；而 top10 / 均值 / 重复值**必须先看整段范围**。
   正解是把 `parseXlsxSheet()` 拆成 **①解析全部单元格 → ②按 sqref 每段范围算命中集合 → ③逐格套颜色**；
   命中与否**预先算成一张「行:列 → 命中」表**，逐格渲染时查表。逐格规则不用改逻辑。
2. **规则要有稳定 id**：命中集合按规则索引，但规则数组会先 `map` → `filter` → `sort`（按 priority），
   数组下标容易错位 → 在解析时发 `id`（`out.length`），命中集合按 `id` 索引，与排序无关。
3. **排名并列按「≥ 阈值」，不是「取前 k 个」**：`rank=2` 而前两名相等时，按名次切会漏掉并排的那一格；
   `rank` 大于个数时**全部命中**（阈值退化为最小值）。`percent` 的名次 = `ceil(个数 × 百分比)`。
4. **`aboveAverage` 三个开关**：`aboveAverage="0"` → 低于均值；`equalAverage="1"` → 含等于均值；
   `stdDev="1"` → 偏离均值超过 1 个**样本**标准差（n−1，不是总体标准差）。
   **「等于均值」不能用 `===` 比**（均值是除法结果）→ 用 `1e-9` 容差。
5. **重复值比较：数字与文本不同类、文本大小写不敏感**（键前缀 `n:` / `t:`）。
   数字 `5` 与文本 `"5"` **不算重复**。
6. **多区域 sqref 按每段独立统计**：Excel 对 `sqref="A1:A5 C1:C5"` 是「合起来排名」还是「各段独立」
   没有明确文档 → 本轮选**各段独立**；单区域是绝大多数情况，两种口径等价。**已写明，别当成既定事实**。
7. **fail-safe**：范围内无数值 / 数据不足 → 规则不命中（不猜）。
8. **输出通道不变**：仍走既有 `[颜色:X;底色:Y]`，**不新增文本标记、不破坏既有输出**；
   契约 / host-bridge / MCP 参数**未动** → **工具数仍 27**，仍无必填参数。
9. **本轮明确不做**：`containsBlanks` / `notContainsBlanks`（要改空白格渲染，回归面大）；
   图形类 `colorScale` / `dataBar` / `iconSet`（硬算易错）与 `expression`。

---

## 5. 验证证据（实测）

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 无错（改完代码即跑过一次） |
| `pnpm build` | ✅ renderer `out/renderer/assets/index-wunPmYW7.js` 665.75 kB、`index-BNztoMKE.css` 8.97 kB |
| 秒级自测 `phase4g-selftest.cjs` | **55/55**（52 行按**整行相等**比对 + 行数 + kind + error） |
| e2e `phase4g-e2e.cjs` | **30/30**（工具面 3 / 抽取 23 / 界面 4），产物 `run65-phase4g.log` |
| 全量回归 run65 十九套 | ✅ **580/580 全绿，FAIL 全 0**（摘要 `C:\Temp\ecclaw-verify\run65-summary.txt`；未跑真站 phase3s/3q）。上轮跑到 phase3y 时 Electron 中途消失导致整套挂死，根因是 e2e `send()` 无超时 → 本轮打 90s 超时补丁后 phase3y 31/31 通过（见 §12） |

回归明细（run65-\*）：phase4g 30 · 4f 26 · 4e 21 · 4d 31 · 4c 26 · 4b 18 · 4a 20 · 3z 37 · 3y 31 · 3x 41 ·
3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14。
**未跑真站 phase3s / phase3q**（本阶段红线：不碰淘宝）。

**负向断言是本轮的主要防回归手段**：夹具 52 行的期望值全部按「**整行相等**」比对 ——
未命中的格子必须**一个颜色标记都没有**。只断言命中项的话，「本不该有颜色的格子多了个颜色」根本测不出来。

---

## 6. 环境基线

- 项目根：`F:\soft\00selfmade\ecclaw`（git 仓库）
- stateDir：`C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw`
- MCP 工具数：**27**
- 依赖：**无新增**
- 回归驱动：`C:\Temp\ecclaw-verify\rerun-and-regress17.cjs` → 产物前缀 `run65-*`

---

## 7. 复现命令

```bash
cd /f/soft/00selfmade/ecclaw && pnpm typecheck && pnpm build
node C:/Temp/ecclaw-verify/make-phase4g-fixtures.cjs
pnpm exec tsc electron/main/document-preview.ts electron/main/paths.ts electron/shared/types.ts \
  --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron --module commonjs --target ES2022 \
  --moduleResolution node --esModuleInterop --skipLibCheck
NODE_PATH=F:/soft/00selfmade/ecclaw/node_modules node C:/Temp/ecclaw-verify/phase4g-selftest.cjs
node C:/Temp/ecclaw-verify/stop-electron.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Temp/ecclaw-verify/start-electron.ps1"
node C:/Temp/ecclaw-verify/phase4g-e2e.cjs \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs" \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json"
node C:/Temp/ecclaw-verify/patch-e2e-timeout.cjs
node C:/Temp/ecclaw-verify/rerun-and-regress17.cjs
```

---

## 8. 红线（照旧）

- 禁删用户文件；e2e 写进文件库的 `ecclaw-phase4g-区间条件格式.xlsx`
  （以及 `ecclaw-phase4c-颜色.xlsx`、`ecclaw-phase4e-多页.pdf` 等）都**留着别删**。
- `openclaw.json` / `host-bridge.json` 勿外传，且**不得提交**（真实路径在 stateDir，不在仓库根）。
- 本阶段**不碰淘宝**（phase3s / phase3q 未跑）。
- 临时产物写 `C:\Temp\`；handoff/task **不进** `memory/`。
- GUI 验证走 **CDP**（不要用 computer-use 截 Electron 屏）；无人值守 e2e 期间勿碰 GUI 卡片。
- 提交只 `git add` **精确文件**，**禁止 `git add -A`**。

---

## 9. 下一阶段候选

- **`containsBlanks` / `notContainsBlanks`**（本轮留下的尾巴）：需要让**空白单元格也渲染出来**并带底色
  —— 会改变既有空白格输出，回归面比本轮大，动手前先想清楚空格的渲染口径。
- 邮件 worker（外发副作用，需**显式确认**才能开工）。
- 画布宿主（新事件 kind，属架构级改动）。
- 图形类条件格式：`dataBar` / `colorScale` 的**区间文字标注**（不硬算渲染值，只标注阈值）。
- XLSX 余量：单位 / 工程 / 会计格式、日期格式的 `mmm` 之外本地化。
- PDF 余量：缩略图窗口大小可调、缩略图懒加载、目录项页码为 `null` 时的降级提示。
- 欠账：真站套件 phase3s / phase3q（需先问过淘宝）。

---

## 10. 提交记录

| 提交 | 内容 |
|---|---|
| `0d99c96` | `feat(document-preview): add XLSX range-level conditional formats`（5 files, +480/−19） |
| `__DOC_COMMIT__` | `docs: record phase 4g commit hash in handoff` —— 本次回填 |

已精确 `git add` 下列文件提交（**未用 `git add -A`**）：

| 文件 | 说明 |
|---|---|
| `F:\soft\00selfmade\ecclaw\electron\main\document-preview.ts` | 区间级条件格式判定 + 三趟式抽取 |
| `F:\soft\00selfmade\ecclaw\README.md` | §5.36 + 能力清单 + §5.32 交叉引用 |
| `F:\soft\00selfmade\ecclaw\task.md` | 第三十二阶段表 + 顶部状态段 |
| `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase4g-final-2026-11-05.md` | 本文档 |
| `F:\soft\00selfmade\ecclaw\prompt-ecclaw-phase4g-next.md` | 接力指针 |

**未提交**：`node_modules/`、`out/`、`C:\Temp\ecclaw-verify\*`（不在仓库内）、
`openclaw.json` / `host-bridge.json`（在 stateDir）、任何 `.env` / 密钥。

---

## 11. 收尾清单

1. ✅ 主进程 `rangeLevelCfMatches()` / `matchRangeLevelCf()` / `sampleStdDev()` / `dupKey()` + `XlsxCfRule` 新属性
2. ✅ `parseXlsxSheet()` 三趟式抽取；`conditionalColors()` 接命中集合
3. ✅ 输出通道不变（仍 `[颜色:X;底色:Y]`）；契约 / host-bridge / MCP 未动 → 工具数仍 27
4. ✅ `pnpm typecheck` ✅ / `pnpm build` ✅
5. ✅ 秒级自测 `phase4g-selftest.cjs` **55/55**
6. ✅ `phase4g-e2e.cjs` **30/30**
7. ✅ 全量回归 run65 十九套 **580/580**（摘要 `run65-summary.txt`；未跑真站 phase3s/3q）
8. ✅ README §5.36 + 能力清单；task.md 第三十二阶段表 + 顶部状态段；项目记忆 `ecclaw_phase4g_xlsx_range_cf.md` + `MEMORY.md` 索引
9. ✅ `prompt-ecclaw-phase4g-next.md`（<30 行，只做接力指针）
10. ✅ **git commit** —— `0d99c96`（feat）+ 本 `docs:` 小提交回填 hash（**未 amend**）

---

## 12. 本轮新增的测试基建改动（临时资产，**不进仓库**）

上一轮全量回归在 **phase3y** 挂死（Electron 进程中途消失 → MCP 调用等不到响应 → **永久等待**），
根因不在产品代码，而在**测试 harness**：

- `C:\Temp\ecclaw-verify\*-e2e.cjs` 里的 `send()` 是
  `return new Promise((resolve) => waiters.set(id, resolve))` —— **没有超时**。
  一旦 MCP 服务器或 Electron 掉线，这个 promise 永远不 resolve，整套 e2e 挂到驱动超时为止。
- 修法：`patch-e2e-timeout.cjs` 批量给 19 套的 `send()` 加 **90s 超时**：
  超时后以 `{ result: { content: [{ text: 'TIMEOUT-90s' }], isError: true } }` resolve
  → 断言转成**可读的 FAIL**，而不是静默挂死。补丁**只动 `C:\Temp` 下的测试脚本**。
- 驱动 `rerun-and-regress17.cjs` 相应加固：单套超时 32min → **12min**；
  **摘要逐套落盘**（中途被打断也能看到已跑部分）；`ensureEnv()` 每套前检查
  8898/8897 fixture 与 CDP 9222，Electron 掉了自动重启。

**踩坑**：driver 第一次起 Electron 时 `npx electron` 冷启动 >90s → 第一套被判 `ENV-DEAD skip`。
→ **接手跑回归前先手动 `start-electron.ps1` 并确认 `curl http://127.0.0.1:9222/json/list`
能出 `out/renderer/index.html`，再跑驱动**，否则第一套会被跳过（后面 18 套不受影响）。
