# handoff · ecclaw 第三十八阶段（phase4m）· 收官 · 2026-11-06

> **一句话状态**：主题「**XLSX 公式 + DOCX 修订痕迹**」→ 代码 ✅ → typecheck ✅ →
> 秒级自测 **72/72** ✅ → 交叉复验 4l/4j/4k 全绿 ✅ → e2e **50/50** ✅ →
> **全量回归 run71 二十五套 842/842 全绿** ✅ → 收尾文档 ✅ → **已提交**（feat `ecb43a4`）。
>
> MCP 工具数仍 **27**；无新增依赖；**只改 `electron/main/document-preview.ts` 一个产品文件**。

---

## 1. 选题依据（探针实测 · 候选清单第 5 次被推翻）

**phase4l handoff §8 的候选清单第 5 次被推翻** —— 先探针扫 13 条新轴再选题。实测缺口：

| 轴 | 实测结果 | 判定 |
|---|---|---|
| A XLSX 普通公式 | `<f>SUM(B1:B9)</f>` 只剩值 `30` | **入选** |
| I XLSX 共享 / 数组公式 | master 有体 + follower 只有 si + 数组 `SUM(A1:A3)`，全只剩值 | **入选** |
| E DOCX 插入 | `<w:ins 张三>` 混入正文、无标记 | **入选（正文在骗人）** |
| E2 DOCX 删除 | `<w:del 李四>` **整段消失** | **入选（正文在骗人）** |
| K DOCX 移动 | `moveFrom` / `moveTo` 只剩 moveTo | **入选** |
| G 文本框 / J 内容控件 `w:sdt` | 框内 / 控件内文字**已在输出里** | **非缺口（排除）** |
| F DOCX 尾注 | endnote 正文无 | 真缺口，未选（下轮候选） |
| H PPTX 超链接 / L PPTX 批注 | 无 | 真缺口，未选（下轮候选） |
| B XLSX 定义名称 / C 数据有效性 | 无 | 真缺口，中低价值，未选 |
| D XLSX expression 条件格式 | `$A1>10` 不标红 | 真缺口但要公式求值器，未选 |
| D2 colorScale 等图形规则 | 无 | 表现层，未选 |

**选题**：「XLSX 公式 + DOCX 修订痕迹」——理由是这两类是**不可再生信息**：
公式丢了 agent 无法重算（也不知道改公式会连带哪些格）；修订痕迹丢了则**正文在骗人**
（插入内容混在正文里看不出是谁加的，删除内容整段消失）。

**标记格式**（用户逐项确认，勿重开）：公式 `[公式: <体>]`、共享 follower `[公式: 共享 <master体>]`；
修订 `[修订+<作者>: <文本>]` / `[修订-<作者>: <文本>]`。

---

## 2. 已确认设计（勿重开）

| 项 | 决定 |
|---|---|
| 范围 | ① XLSX 单元格公式（普通 / 共享 / 数组）② DOCX 修订痕迹（插入 / 删除 / 移动）。**不含** PPTX 链接批注、expression CF、定义名称、数据有效性、DOCX 尾注 |
| 标记 | 公式 `[公式: SUM(B1:B9)]` · 插入 `[修订+张三: 新增的内容]` · 删除 `[修订-李四: 删掉的内容]` |
| 顺序 | XLSX：值 → 公式 → 链接 / 批注 extras → **颜色恒在最末**；DOCX：宿主文本 → **修订** → 链接 → 批注 |
| 落位 | XLSX 附**单元格值**后；DOCX 附**段落文本**后（`#` 前缀之后），表格单元格同理 |
| 作者 / 日期 | 只输出 `w:author`，**不输出日期** |
| 共享公式 follower | 输出 `[公式: 共享 <master公式体>]`，**不做相对引用重写** |
| 判定依据 | XLSX：`<c>` 内 `<f>` 文本（decode 实体、trim、不带 `=`）；`t="shared"` 有体 = master、空体 = follower 按 si 找回 master；`t="array"` 按普通公式<br>DOCX：`<w:ins w:author>` 内含 run → 正文照常 + 段末 `[修订+…]`；`<w:del>` 文本在 `<w:delText>` → 正文不含 + 段末 `[修订-…]`；moveFrom / moveTo 按删除 / 插入；**`w:pPr/w:rPr` 里的 ins/del（段落标记修订）不算**；`rPrChange` / `pPrChange` 不处理 |
| 不变项 | 无公式 / 无修订的文件**输出逐字不变**；MCP 工具数仍 **27**；只改 `electron/main/document-preview.ts`；无新增依赖 |

---

## 3. 改动清单（**只有这一个产品文件**）

`electron/main/document-preview.ts`（+77 / −6）：

**DOCX 侧**
- 新函数 `docxDeletedText(body)`：删除类修订的文本取 `<w:delText>`（decode 实体），无则回退 `docxParagraphText(body)`
- 新函数 `docxRevisionMarks(paragraph)`：正则
  `/<w:(ins|del|moveFrom|moveTo)\b([^>]*?)(\/>|>([\s\S]*?)<\/w:\1>)/g`，
  按文档顺序取块；`ins` / `moveTo` = 插入（+），`del` / `moveFrom` = 删除（−）；
  **靠 `(\/>|>…)` 分支排除自闭合标签**；块体为空 → 跳过（排除段落标记修订空壳）
- `docxExtras()` 开头插入 `docxRevisionMarks(paragraph)`（修订在链接 / 批注**之前**）
- **正文流一字未动** —— `docxRuns` 全局扫 `<w:r>` 天然已含 `w:ins` 内容、已排除 `w:delText`

**XLSX 侧**
- `parseXlsxSheet` 的 Cell 接口增 `formula` / `formulaSi` / `sharedFollower`
- 单元格循环用 `/<f\b([^>]*?)(\/>|>([\s\S]*?)<\/f>)/` 取公式体与属性（`si`）
- 单元格循环**之后**两遍扫描建 `si → master 公式体` Map 再回填 follower
- 渲染处改为 `[c.value, ...markers].filter(s => s !== '').join(' ')`，
  markers = 公式标记 + extras（链接 / 批注）；颜色标记仍拼在最末
- `filled` 过滤加 `|| c.formula !== ''`（空值但有公式的格要放行）

**公共 / 契约 / 界面**：`host-bridge.ts` / `host-server.mjs` / `src/App.tsx` 全不动 → MCP 工具数仍 **27**。

---

## 4. 测试证据（全绿）

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 通过 |
| `pnpm build` | ✅ 通过（`out/main/index.js` grep 命中新代码 3 处） |
| 秒级自测 `phase4m-selftest.cjs` | **72 / 72**（先 RED **57/72**，红得全是公式 / 修订标记 → 改码后 GREEN） |
| 交叉复验 `phase4l-selftest.cjs` | **41 / 41** ✅（既有 DOCX / XLSX 输出逐字不变） |
| 交叉复验 `phase4j-selftest.cjs` | **30 / 30** ✅（既有 DOCX 输出逐字不变） |
| 交叉复验 `phase4k-selftest.cjs` | **27 / 27** ✅（既有 PPTX 输出逐字不变） |
| e2e `phase4m-e2e.cjs` | **50 / 50** ✅（工具面 3 · 抽取 32 · 负向 9 · 界面 6；产物 `run71-phase4m.log`） |
| 全量回归 `run71-*` | **25 套 842 / 842 全绿**（FAIL 全 0；摘要 `run71-summary.txt`） |

**实际输出**（夹具 formula4m.xlsx / shared4m.xlsx）：

```
[工作表 公式]
30 [公式: SUM(B1:B9)] | 5
30元 [公式: CONCAT(A1,"元")]
10 [公式: B1*2]
40 [公式: SUM(A1:A3)]
```

```
[工作表 共享]
2 [公式: B1*2]
4 [公式: 共享 B1*2]
6 [公式: 共享 B1*2]
```

**实际输出**（夹具 tracked4m.docx / move4m.docx / mix4m.docx）：

```
新增的内容中间 [修订+张三: 新增的内容] [修订-李四: 删掉的内容]
普通段落
```

```
移动后文字 [修订-王五: 移动前文字] [修订+王五: 移动后文字]
```

```
新插入链接文字普通 [修订+张三: 新插入] [链接: https://example.com/x] [批注(审阅人): 批注正文]
```

**回归 run71 明细**：4m 50 · 4l 37 · 4k 35 · 4j 39 · 4i 53 · 4h 48 · 4g 30 · 4f 26 · 4e 21 · 4d 31 ·
4c 26 · 4b 18 · 4a 20 · 3z 37 · 3y 31 · 3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 ·
3p 45 · 3o 44 · 3m 69 · sse 14 —— **未跑真站 phase3s / phase3q**（红线：不碰淘宝）。

---

## 5. 收尾产物

| 文件 | 内容 |
|---|---|
| `README.md` | 新增 **§5.42**「XLSX 公式 + DOCX 修订痕迹（计算依据 + 谁改的）」；底部能力清单加一条 |
| `task.md` | 顶部状态段加第三十八阶段；新增「第三十八阶段」交付表（6 行）+ 实证发现（8 条） |
| `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/ecclaw_phase4m_formula_revisions.md` | 项目记忆（新建） |
| `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/MEMORY.md` | 索引加一行 |
| `handoff-ecclaw-phase4m-final-2026-11-06.md` | 本文件（收官版） |
| `handoff-ecclaw-phase4m-wip-2026-11-06.md` | WIP 版（探针结果 + 设计确认） |
| `prompt-ecclaw-phase4m-next.md` | 接力指针（<30 行） |

---

## 6. 环境 / 基线 / 命令

- 项目根 `F:\soft\00selfmade\ecclaw`；基线 HEAD = `3a53961`（phase4l docs 回填）
- **tsout 编译命令**（秒级自测必须先跑，产物在 `tsout/main/*.js`）：
  ```
  npx tsc electron/main/document-preview.ts --module commonjs --target ES2022 \
       --moduleResolution node --esModuleInterop --skipLibCheck \
       --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron
  ```
- 跑自测前：`export NODE_PATH="F:/soft/00selfmade/ecclaw/node_modules"`（**不能省**）
- MCP 工具数 **27**（不变）；stateDir `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw`
- e2e / 回归参数：`<hostServerPath>` = `C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs`，
  `<bridgeFile>` = `C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json`
- 临时资产（全在 `C:\Temp\ecclaw-verify\`，**不进仓库**）：
  - `phase4m-probe.cjs` / `phase4m-probe2.cjs`（探针）+ `probe4m\`（夹具）
  - `make-phase4m-fixtures.cjs`（8 夹具：formula4m / shared4m / tracked4m / move4m / mix4m / pmark4m / plain4m.xlsx / plain4m.docx）
  - `phase4m-selftest.cjs`（72/72）· `phase4m-e2e.cjs`（50/50）· `rerun-and-regress23.cjs`（run71 驱动）

---

## 7. 本轮踩坑（别再踩）

1. **XLSX 公式三形态要分开处理**：普通 / 数组公式**都有公式体**；
   只有共享公式的 **follower 只有 `si` 没有体** → 必须**两遍扫描**建 `si → master 体` Map 再回填
   （**别在单元格循环里就地解析**，那时还没遇到 master）。
2. **共享公式不做相对引用重写**：follower 真实公式是 `A2*2` 这类相对引用，
   重写要实现引用平移（易错且对 agent 无意义）→ 统一标「共享 <master 体>」，宁粗勿错。
3. **DOCX 修订最大坑：正文流别重复加 `w:ins` 文本** —— `docxRuns` 全局扫 `<w:r>`
   **已经包含**插入内容（探针实测正文有「新增的内容」），本轮只加署名标记，否则输出两遍。
4. **段落标记修订（`<w:pPr><w:rPr><w:ins/></w:rPr></w:pPr>`）也是 `w:ins`**：
   必须靠「块内含 run 文本」判定排除，否则纯格式段落冒出空修订标记。
5. **自闭合标签不能用裸 `[^>]*` 匹配**：`<w:ins .../>` 会一路吞到后面某个 `</w:ins>`，
   把别人的内容算成自己的 → 用「属性段是否以 `/` 结尾」判定（正则里用 `(\/>|>…<\/w:\1>)` 分支）。
6. **`<w:delText>` 也要 decode 实体**（复用 `docxParagraphText()` 的口径）。
7. **空值格带公式要放行**：XLSX `filled` 过滤若仍按「有值」过滤 → `=0` 的公式格整格消失。
8. **删除内容靠标记找回**，不混进正文流（正文流里没有 `w:delText`）。
9. **顺序一次定死**：XLSX 值 → 公式 → 链接 / 批注 → **颜色恒在最末**；
   DOCX 文本 → 修订 → 链接 → 批注（修订在最前，因为它解释的是正文本身）。
10. **上下文 160K 硬闸门会拦 Bash/Read**（只放行 Write/Edit）→ 被拦时唯一正确动作：写 handoff 后开新会话。
    （本阶段 WIP 交接见 `handoff-ecclaw-phase4m-wip-2026-11-06.md`。）
11. **e2e 的 `send()` 必须带 90s 超时**，否则 Electron 掉线会把整轮回归挂死。

---

## 8. 下一阶段候选（留给 phase4n）

1. **PPTX 超链接 + 批注** —— 与 phase4l 的 DOCX/XLSX 同构，直接复用
   `parseRelEntries` + `isExternalTarget`，**最便宜**。
2. **DOCX 尾注 / 脚注** —— 与本轮 DOCX 修订同构（部件 + 正文引用标记）。
3. **XLSX 定义名称** —— 真缺口，价值中低。
4. **expression 条件格式** —— 真缺口但要公式求值器，工作量大，价值中。
5. **候选清单会过期（第 5 次印证）** —— **下一轮务必先探针扫新轴再选题**，别照抄本文件 §1 的表。

---

## 9. 提交与收尾清单

| 提交 | 内容 |
|---|---|
| `ecb43a4` | `feat(document-preview): add XLSX formulas and DOCX revision marks` —— 本阶段 feat |
| `__DOC_COMMIT__` | `docs: record phase 4m commit hash in handoff` —— 本次回填 |

已精确 `git add` 下列文件提交（**未用 `git add -A`**）：

```
electron/main/document-preview.ts
README.md
task.md
handoff-ecclaw-phase4m-final-2026-11-06.md
handoff-ecclaw-phase4m-wip-2026-11-06.md
prompt-ecclaw-phase4m-next.md
```

**未提交（禁入仓库）**：`openclaw.json` / `host-bridge.json` / `C:\Temp\ecclaw-verify\*` 全部临时资产；
未跟踪的 `handoff-2026-11-06.md`（hook 占位，别动）。

---

## 10. 必读顺序

1. 本文件 §2（设计，勿重开）· §3（改动清单）· §4（测试证据）· §7（踩坑）· §8（下一轮候选）
2. `README.md` §5.42（对外口径）
3. `task.md`「第三十八阶段」交付表 + 实证发现
4. `electron/main/document-preview.ts` 新增区块：
   `docxDeletedText` / `docxRevisionMarks`（DOCX 段）· `docxExtras` 开头 ·
   `parseXlsxSheet` 的 Cell 接口 / 单元格循环 / 共享公式回填 / 渲染拼接四处
