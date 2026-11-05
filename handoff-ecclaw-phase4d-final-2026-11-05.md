# handoff · ecclaw 第二十九阶段（phase4d）· XLSX 科学计数法 / 分数格式 · 2026-11-05

> **一句话结论**：XLSX 预览补上**科学计数法**与**分数格式**两类此前「不支持 → 保留原值」的格式 ——
> `0.00E+00` → `1.23E+04`、`# ?/?` → `2 1/2`、`?/?` → `1/2`、`# ?/4` → `0 1/4`。
> 工具数仍 **27**，无新增依赖，**只改 `electron/main/document-preview.ts` 一个产品文件**。
> 秒级自测 **24/24**、**phase4d e2e 31/31**、typecheck/build ✅。
>
> **本轮状态（已收尾）**：实现、自测、e2e、README §5.33、task.md 表格、项目记忆、
> **phase3z 旧断言修复**、**全量回归 run62 十六套 503/503 全绿**、**git commit** 全部完成。
> 下一会话可直接从 §8 挑候选开工。

---

## 1. 本轮必读顺序

1. 本文档
2. `handoff-ecclaw-phase4c-final-2026-11-05.md`（上一阶段：XLSX 颜色 + 条件格式）
3. `README.md` §5.29（Excel 显示样式）· §5.32（上阶段）· **§5.33（本轮）**
4. `task.md` 顶部状态段 + 第二十九阶段表
5. `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\ecclaw_phase4d_xlsx_numbers.md`

---

## 2. 交付清单

| 文件 | 改动 |
|---|---|
| `electron/main/document-preview.ts` | ①新增 `flattenFormatSection()`：一次产出**等长的 text + masked**（掩码层区分字面量与结构字符）；②新增科学计数法层：`parseScientificPattern` / `renderScientific`；③新增分数层：`parseFractionPattern` / `renderFraction` / `bestFraction` / `formatInt`；④新增 `trimDecSlots()`（小数位槽位收尾，与既有渲染共用）；⑤`parseNumberPattern` 改用摊平函数并加 masked 兜底；⑥`renderNumberCode` 分派：科学计数法 → 分数 → 普通数字 |
| `README.md` | 新增 §5.33（两类格式口径 + 回退口径 + 与 Excel 的差异）；底部能力清单补一条 |
| `task.md` | 顶部状态段 + 新增「第二十九阶段」表 |
| `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/` | 新增 `ecclaw_phase4d_xlsx_numbers.md`；`MEMORY.md` 加索引 |

### 临时资产（`C:\Temp\ecclaw-verify\`）

- `make-phase4d-fixtures.cjs`（`nums.xlsx` 2660 B：22 行，覆盖科学计数法 8 例 + 分数 10 例 + 回退 3 例）
- `phase4d-selftest.cjs`（不走 Electron，**24 项**）
- `phase4d-e2e.cjs`（**31 条断言**：工具面 3 · 抽取 23 · 界面 4 · 不报错 1）
- `rerun-and-regress12.cjs`（**run61-\*** 驱动，16 套，不跑真站）· `rerun-and-regress13.cjs`（**run62-\*** 驱动，收官复跑）
- `run62-phase4d.log`（本轮 e2e 产物）· `run62-summary.txt`（十六套摘要）
- `tsout/`（tsc 单文件转译产物；`tsout/node_modules/electron/index.js` 是 electron 桩，指向 `fake-userdata`）

---

## 3. 关键设计决策

1. **掩码层是本轮的技术核心**：格式段里引号中的 `E`、斜杠是**字面量**，不是结构。
   摊平时同时产出 `text`（字面量保留内容）与 `masked`（字面量位置换成掩码符），
   **两个串下标一一对应** → 结构判定全走 `masked`，取字面量全走 `text`。
   没有这层，`"E"0.00` 会被当科学计数法、`"a/b"0.00` 会被当分数格式。
2. **分数用连分数最佳有理逼近（收敛分数），不是就近取整**：
   就近取整会把 `0.3` 取成 `2/7`，Excel 给的是 `1/3`。
   收敛分数分子超限时退一步「分子分母都不超上限的就近取」，仍无解 → 保留原值。
3. **槽位宽度当位数上限，不当对齐宽度**：`?/?` → 分子分母各最多 1 位；
   输出**不做对齐补空格**（预览文本里不留悬空空格）——
   **与 Excel 的差异仅在对齐空格**，已在 README §5.33 明写。
4. **固定分母不约分**：`# ?/4` 遇 0.5 → `2/4`（Excel 同样不约分）。
5. **科学计数法尾数进位要回补**：9.999 按两位小数四舍五入 → 10.00 → 尾数归 1、指数加 1。
6. **指数位数取格式里 `0` 的个数**（`E+00` 两位、`E+0` 一位）；`E+` 时正指数也带 `+`，
   `E` / `E-` 只有负指数带号。
7. **解析不了一律保留原值**：分子放不下（`?/?` 遇 12.5）、畸形格式都不硬解。
8. **`parseNumberPattern` 加 masked 兜底**：原来只按摊平文本判 `E+` / `/`，
   漏掉**裸 `E`**（`0.00E0` 会被当普通数字渲成 `1.23E0`）→ 现在这类一律回退原值。

---

## 4. 验证证据（实测）

- `pnpm typecheck` ✅ / `pnpm build` ✅（renderer `index-ChwETOxq.js` 658.13 kB；本轮只改主进程，renderer 产物 hash 不变）
- **秒级自测**（`phase4d-selftest.cjs`，直调 `previewDocument`）：**24/24**
  —— 科学两位/负数/小数/零/一位尾数/括号负段/内置 11/内置 48、
  分数混合/一半/四分之三/三分之一/两位槽位/纯分数/纯分数带整数/固定分母/整数/负数/负段、
  字面量 E 不误判/字面量斜杠回退/分子放不下回退/不报错。
- **phase4d e2e：31/31**（工具面 3 · 抽取 23 · 界面 4 · 不报错 1），产物 `run61-phase4d.log`
- **全量回归 run62：十六套 503/503 全绿**（FAIL 全 0），摘要 `C:\Temp\ecclaw-verify\run62-summary.txt`：
  phase4d 31 · phase4c 26 · phase4b 18 · phase4a 20 · **phase3z 37** · phase3y 31 · phase3x 41 ·
  phase3w 27 · phase3v 29 · phase3u 24 · phase3t 16 · phase3r 31 · phase3p 45 · phase3o 44 ·
  phase3m 69 · sse 14。
  > run61（修脚本前）唯一那条红 = `phase3z` 断言「科学计数不支持 → 保留原值 1234.5」**按旧口径写的**，
  > 本轮实现科学计数法后它变成 `科学计数 | 1.23E+03` → **旧断言已作废，属预期口径变更，不是产品 bug**
  > （与第二十四/二十五阶段改日期输出口径时同型：只改测试脚本、不改产品）。
  > 已按 §10 步骤 1 改 `phase3z-e2e.cjs` 一行断言 → 复跑 **phase3z 37/37**，run62 全绿。
  **未跑真站套件 phase3s / phase3q**（红线「不碰淘宝」）。

---

## 5. 环境基线

| 项 | 值 |
|---|---|
| 项目根 | `F:\soft\00selfmade\ecclaw`（**已是 git 仓库**，首个提交 `f5c1da4`） |
| 新依赖 | **无**（沿用 `fflate@0.8.3`） |
| stateDir | `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw` |
| MCP 工具数 | **27**（本轮未新增） |
| e2e 遗留物 | 文件库新增 `ecclaw-phase4d-数字格式.xlsx`（只增不删） |

---

## 6. 复现命令

```bash
cd /f/soft/00selfmade/ecclaw && pnpm typecheck && pnpm build
node C:/Temp/ecclaw-verify/make-phase4d-fixtures.cjs
pnpm exec tsc electron/main/document-preview.ts electron/main/paths.ts electron/shared/types.ts --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron --module commonjs --target ES2022 --moduleResolution node --esModuleInterop --skipLibCheck
NODE_PATH=F:/soft/00selfmade/ecclaw/node_modules node C:/Temp/ecclaw-verify/phase4d-selftest.cjs
node C:/Temp/ecclaw-verify/stop-electron.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Temp/ecclaw-verify/start-electron.ps1"
node C:/Temp/ecclaw-verify/phase4d-e2e.cjs "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs" "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json"
node C:/Temp/ecclaw-verify/rerun-and-regress13.cjs   # run62-*
```

> 改主进程代码必须重启 Electron；`stop-electron.cjs` 的 fetch 报错是正常现象。
> **本轮踩过的坑**：`curl` 在这台机的 git-bash 里不一定存在，等 CDP 就绪请用
> `node -e "fetch('http://127.0.0.1:9222/json/list')..."` 判断；e2e 输出别用 `| tail` 包
> （管道会缓冲到结束才落盘，看起来像卡死）。

---

## 7. 红线（照旧）

- 禁删用户文件；e2e 写进文件库的 `ecclaw-phase4d-数字格式.xlsx`、`ecclaw-phase4c-颜色.xlsx` 都留着别删。
- `openclaw.json` / `host-bridge.json` 勿外传，且**不得提交**（真实路径在 stateDir，不在仓库根）。
- 本阶段不碰淘宝（phase3s / phase3q 未跑）。
- 临时产物写 `C:\Temp\`；handoff/task 不进 `memory/`。
- GUI 验证走 CDP；无人值守 e2e 期间勿碰 GUI 卡片。
- 提交只 `git add` 精确文件，**禁止 `git add -A`**。

---

## 8. 下一阶段候选

- PDF 多页缩略图 / 指定页渲染参数（`scale` 已支持，界面未暴露）。
- 邮件 worker（外发副作用，需显式确认）。
- 画布宿主（新事件 kind）。
- 条件格式扩展：top10 / aboveAverage / duplicateValues / dataBar 区间文字标注（图形类仍不建议硬算）。
- XLSX 余量：单位/工程/会计格式、日期格式的 `mmm` 之外本地化、千分位缩放（`#,##0,`）已支持。
- 欠账：真站套件 phase3s / phase3q（需先问过淘宝）。

---

## 9. 提交记录

本轮改动文件（**逐个精确 `git add`**）：

| 文件 | 说明 |
|---|---|
| `F:\soft\00selfmade\ecclaw\electron\main\document-preview.ts` | 唯一改动的产品源文件 |
| `F:\soft\00selfmade\ecclaw\README.md` | §5.33 + 能力清单 |
| `F:\soft\00selfmade\ecclaw\task.md` | 第二十九阶段表 + 顶部状态段 |
| `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase4d-final-2026-11-05.md` | 本文档 |
| `F:\soft\00selfmade\ecclaw\prompt-ecclaw-phase4d-next.md` | 接力指针 |

**不提交**：`node_modules/`、`out/`、`C:\Temp\ecclaw-verify\*`（不在仓库内）、
`openclaw.json` / `host-bridge.json`（在 stateDir）、任何 `.env` / 密钥。

commit message（Conventional Commits）：

```
feat(document-preview): render XLSX scientific notation and fractions

Render 0.00E+00 as 1.23E+04 and fraction formats (# ?/? -> 2 1/2, ?/? -> 1/2)
in XLSX previews. Add a mask layer so quoted literals (E, slash) are not
mistaken for format structure. Fractions use continued-fraction best
rational approximation; unparsable formats keep the raw value.
Tools stay at 27.
```

> commit hash 见本节下方「提交 hash」（提交后回填，用 `docs:` 小提交补记，不 amend）。

**提交 hash**：

| hash | 说明 |
|---|---|
| `d896d85` | `feat(document-preview): render XLSX scientific notation and fractions`（本轮 5 个文件，+567 / −26） |

---

## 10. 收尾清单（**本会话已全部完成**）

1. ✅ **修 phase3z 已作废的断言**（只改测试脚本，不改产品）：
   文件 `C:\Temp\ecclaw-verify\phase3z-e2e.cjs`，原行：
   ```js
   record('科学计数不支持 → 保留原值 1234.5', text.includes('科学计数 | 1234.5'), line('科学计数'))
   ```
   改成：
   ```js
   record('科学计数 → 1.23E+03（第二十九阶段起支持；原「保留原值」口径作废）', text.includes('科学计数 | 1.23E+03'), line('科学计数'))
   ```
2. ✅ **复跑全量回归**：`node C:/Temp/ecclaw-verify/rerun-and-regress13.cjs`
   → 实测 **16 套 503/503 全绿**（phase4d 31 · phase4c 26 · phase4b 18 · phase4a 20 · phase3z 37 ·
   phase3y 31 · phase3x 41 · phase3w 27 · phase3v 29 · phase3u 24 · phase3t 16 · phase3r 31 ·
   phase3p 45 · phase3o 44 · phase3m 69 · sse 14）；摘要 `C:\Temp\ecclaw-verify\run62-summary.txt`。
3. ✅ **把实测数字回填**：本文件 §4、§9；`task.md` 第二十九阶段表第 7 行 + 顶部状态段；
   `README.md` §5.33 不含数字（已核对，无需改）。
4. ✅ **按 §9 精确 `git add` 5 个文件后提交**（Conventional Commits，message 见 §9），
   再把 commit hash 回填 §9 并向用户汇报。
5. ✅ **写 `prompt-ecclaw-phase4d-next.md`**（<30 行，只做接力指针：承接哪份 handoff + 下一轮候选 + 期限/约束变化）。

