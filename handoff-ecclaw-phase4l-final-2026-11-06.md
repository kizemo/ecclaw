# handoff · ecclaw 第三十七阶段（phase4l）· 收官 · 2026-11-06

> **一句话状态**：主题「**链接 + 批注（DOCX / XLSX 双格式）**」→ 代码 ✅ → typecheck ✅ →
> 秒级自测 **41/41** ✅ → e2e **37/37** ✅ → **全量回归 run70 二十四套 792/792 全绿** ✅ →
> 收尾文档 ✅ → **已提交**（feat `198f3e8`）。
>
> MCP 工具数仍 **27**；无新增依赖；**只改 `electron/main/document-preview.ts` 一个产品文件**。

---

## 1. 选题依据（探针实测 · 候选清单第 4 次被推翻）

**phase4k handoff §4 的候选清单第 4 次被推翻** —— 先探针扫 9 条新轴再选题。实测缺口：

| 轴 | 实测结果 |
|---|---|
| XLSX `expression` 条件格式 | 规则被解析但**永不命中**（`matchCfRule` 无 expression 分支） |
| XLSX `colorScale` / `dataBar` / `iconSet` | `parseConditionalFormatting` 只收带 dxfId → 图形类整条丢弃 |
| XLSX 超链接 URL | **URL 丢失** |
| DOCX 超链接 URL | **URL 丢失** |
| XLSX 批注 | `xl/comments1.xml` 完全不读 |
| DOCX 批注 | `word/comments.xml` 完全不读 |
| XLSX 图表 | `xl/charts/*.xml` 完全不读 |
| XLSX 合并单元格 | 值天然落首格 + 列补空 → **已隐式处理**（不是真缺口） |
| XLSX 数据有效性 | 不读 |

**选题**：「链接 + 批注（DOCX/XLSX 双格式）」——理由是这两类是**不可再生信息**
（URL / 审阅意见丢了 agent 也算不出来），条件格式 / 图表属表现层。
**标记格式**（用户自动选中推荐项）：带作者的方括号标记。

---

## 2. 已确认设计（勿重开）

| 项 | 决定 |
|---|---|
| 范围 | ① XLSX 单元格超链接 ② XLSX 单元格批注 ③ DOCX 段落超链接 ④ DOCX 段落批注。**不含** PPTX 超链接 / 图表 / 条件格式 / 合并单元格标注 |
| 标记 | 链接 `[链接: <目标>]`、批注 `[批注(<作者>): <正文>]` |
| 顺序 | 宿主文本 → 链接 → 批注 → **颜色标记仍在最末**（既有输出前缀不变） |
| 落位 | XLSX：附在**单元格值**后；DOCX：附在**段落文本**后（`#` 标题前缀之后），表格单元格内同理（走 `markdownCell` 转义） |
| 判定依据 | XLSX 链接：`<hyperlink ref r:id>` + `xl/worksheets/_rels/sheetN.xml.rels` 的 Target（外部 URL 原样；内部 `location=` 原样；ref 是区间则区内每格都挂）<br>XLSX 批注：rels 里 Type 以 `/comments` 结尾 → `xl/commentsN.xml` → `<comment ref authorId>`（ref 精确匹配）<br>DOCX 链接：`<w:hyperlink r:id>` / `w:anchor` + `word/_rels/document.xml.rels`<br>DOCX 批注：`word/comments.xml` + 正文 `<w:commentRangeStart w:id>` 所在段落 |
| 不变项 | 无链接/无批注的文件**输出逐字不变**；MCP 工具数仍 **27**；只改 `electron/main/document-preview.ts`；无新增依赖 |

---

## 3. 改动清单（**只有这一个产品文件**）

`electron/main/document-preview.ts`：

**DOCX 侧**
- 新常量 `DOCX_RELS_ENTRY = 'word/_rels/document.xml.rels'`、`DOCX_COMMENTS_ENTRY = 'word/comments.xml'`
- `DocxParts` 增 `rels: string` / `comments: string`；`readDocxParts` 多读这两个条目
- 新函数 `docxHyperlinkTargets(paragraph, rels)` / `docxCommentIds(paragraph)` / `parseDocxComments(xml)` / `docxExtras(paragraph, ctx)`
- `DocxRenderCtx` 增 `hyperlinks: Map<string,string>` / `comments: Map<string,{author,text}>`
- `renderDocxParagraph` 末尾追加 extras（文本为空但有批注时只输出批注）
- `extractDocxText` 填 ctx 的两个新字段

**公共**
- 新 `RelEntry` 接口 + `parseRelEntries(xml)`（Id / Target / Type，Target 走 `decodeXmlEntities`）
- `parseRels` 改为在 `parseRelEntries` 之上实现（**行为不变**）
- 新 `isExternalTarget(target)`（`/^[a-zA-Z][a-zA-Z0-9+.\-]*:/`）

**XLSX 侧**
- 新常量 `XLSX_SHEET_RELS_RE` / `XLSX_COMMENTS_RE`
- 新函数 `xlsxRefCellKeys(ref)`（区间展开上限 `MAX_LINK_CELLS = 4096`）/ `parseXlsxHyperlinks` / `parseXlsxComments` / `xlsxCellExtras`
- `parseXlsxSheet` 增参数 `extras: Map<string,string>`；`filled` 过滤改为「有值 **或** 有标记」；单元格文本 = 值 + ' ' + extra；颜色标记仍最末
- `extractXlsxText` 读 sheet rels 与 comments 部件；批注部件路径优先取 rels 里 Type 以 `/comments` 结尾者，**兜底按命名约定找 `xl/comments{N}.xml`**（N 取工作表序号）

---

## 4. 测试证据（全绿）

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 通过 |
| `pnpm build` | ✅ 通过（`out/main/index.js` grep 命中 `批注(` / `链接: ` / `MAX_LINK_CELLS` / `isExternalTarget`） |
| 秒级自测 `phase4l-selftest.cjs` | **41 / 41** |
| 交叉复验 `phase4j-selftest.cjs` | **30 / 30** ✅（既有 DOCX 输出逐字不变） |
| 交叉复验 `phase4k-selftest.cjs` | **27 / 27** ✅（既有 PPTX 输出逐字不变） |
| e2e `phase4l-e2e.cjs` | **37 / 37** ✅（工具面 3 · 抽取 21 · 负向 7 · 界面 6） |
| 全量回归 `run70-*` | **24 套 792 / 792 全绿**（FAIL 全 0；摘要 `run70-summary.txt`） |

**实际输出**（夹具 linkcomment.xlsx / linkcomment.docx）：

```
[工作表 链接批注]
官网 [链接: https://example.com/docs] | 普通格
区间首格 [链接: https://example.com/range] | 内部链接 [链接: Sheet2!A1]
区间次格 [链接: https://example.com/range] | 两个批注 [批注(甲): 第一条] [批注(乙): 第二条]
红字链接 [链接: https://example.com/red] [颜色:红] | 链接加批注 [链接: https://example.com/both] [批注(甲): 同格批注]
```

```
参考 外部站点 结束 [链接: https://example.com/a]
内部锚点 [链接: #书签]
待复核段落 [批注(审阅人): 这段需要和法务确认]
| 表格链接 [链接: https://example.com/b] | 表格批注 [批注(甲): 表格里的意见] |
| --- | --- |
普通段落
```

**回归 run70 明细**：4l 37 · 4k 35 · 4j 39 · 4i 53 · 4h 48 · 4g 30 · 4f 26 · 4e 21 · 4d 31 ·
4c 26 · 4b 18 · 4a 20 · 3z 37 · 3y 31 · 3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 ·
3p 45 · 3o 44 · 3m 69 · sse 14 —— **未跑真站 phase3s / phase3q**（红线：不碰淘宝）。

---

## 5. 收尾产物

| 文件 | 内容 |
|---|---|
| `README.md` | 新增 **§5.41**「DOCX / XLSX 链接与批注」；底部能力清单加一条 |
| `task.md` | 顶部状态段加第三十七阶段；新增「第三十七阶段」交付表 + 实证发现 |
| `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/ecclaw_phase4l_links_comments.md` | 项目记忆（新建） |
| `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/MEMORY.md` | 索引加一行 |
| `handoff-ecclaw-phase4l-final-2026-11-06.md` | 本文件（收官版） |
| `prompt-ecclaw-phase4l-next.md` | 接力指针（<30 行） |

---

## 6. 环境 / 基线 / 命令

- 项目根 `F:\soft\00selfmade\ecclaw`；基线 HEAD = `94e447d`（phase4k docs 回填）
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
  - `make-phase4l-probe.cjs` / `make-phase4l-probe2.cjs`（探针夹具）
  - `make-phase4l-fixtures.cjs`（夹具：linkcomment.xlsx / plain4l.xlsx / linkcomment.docx / plain4l.docx）
  - `phase4l-selftest.cjs`（41/41）· `phase4l-e2e.cjs`（37/37）· `rerun-and-regress22.cjs`（run70 驱动）

---

## 7. 本轮踩坑（别再踩）

1. **一次 Edit 把 `/^word\/footer\d*\.xml$/` 写成 `/^word\/footer\d*\.xml$'`**（漏了收尾斜杠）→
   `TS1161: Unterminated regular expression literal`。**改完正则常量立刻 typecheck**。
2. **XLSX 批注部件不在 sheet rels 里就找不到**：真实 Excel 由 sheet rels 指向 `commentsN.xml`，
   但工具产出的文件可能不写 rels → 必须留**命名约定兜底**（`xl/comments{N}.xml`，N = 工作表序号）。
   两条路径都要有测试覆盖（probe-comment.xlsx 走 rels、probe-comment2.xlsx 走兜底）。
3. **`parseRelEntries` 要拿 Type**：`parseRels` 只返回 Target，认不出「哪条关系是 comments 部件」→
   拆成 `parseRelEntries`（带 Type）+ `parseRels`（薄封装，行为不变）。
4. **外部 Target 不能过 `resolveRelTarget`**：`https://…` 会被当成 zip 内路径拼坏 → 先判 `isExternalTarget`。
5. **断言数按实际数写**（本轮自测实测 41、e2e 实测 37，均与预估不同）。
6. **e2e 的 `send()` 必须带 90s 超时**，否则 Electron 掉线会把整轮回归挂死。
7. **上下文 160K 硬闸门会拦 Bash/Read**（只放行 Write/Edit）→ 被拦时唯一正确动作：写 handoff 后开新会话。
   （本阶段 WIP 交接见 `handoff-ecclaw-phase4l-wip-2026-11-06.md`，未提交。）

---

## 8. 下一阶段候选（留给 phase4m）

1. **XLSX `expression` 条件格式** —— 探针已实测「规则被解析但永不命中」，是**真缺口**；需要在 `matchCfRule` 加
   expression 分支（公式求值器，工作量不小，价值中）。
2. **XLSX 图表 / 数据有效性 / 合并单元格显式标注** —— 表现层，价值低中。
3. **PPTX 超链接 / 批注** —— 与本轮 DOCX/XLSX 同构，可直接复用 `parseRelEntries` + `isExternalTarget`。
4. **条件格式图形类**（colorScale / dataBar / iconSet）—— 表现层。
5. **候选清单会过期（第 4 次印证）** —— **下一轮务必先探针扫新轴再选题**，别照抄本文件 §1 的表。

---

## 9. 提交与收尾清单

| 提交 | 内容 |
|---|---|
| `198f3e8` | `feat(document-preview): add DOCX/XLSX links and comments` —— 本阶段 feat（6 files, +717/−17） |
| `__DOC_COMMIT__` | `docs: record phase 4l commit hash in handoff` —— 本次回填 |

已精确 `git add` 下列文件提交（**未用 `git add -A`**）：

```
electron/main/document-preview.ts
README.md
task.md
handoff-ecclaw-phase4l-final-2026-11-06.md
handoff-ecclaw-phase4l-wip-2026-11-06.md
prompt-ecclaw-phase4l-next.md
```

**未提交（禁入仓库）**：`openclaw.json` / `host-bridge.json` / `C:\Temp\ecclaw-verify\*` 全部临时资产；
未跟踪的 `handoff-2026-11-06.md`（hook 占位，别动）。

---

## 10. 必读顺序

1. 本文件 §2（设计，勿重开）· §3（改动清单）· §4（测试证据）· §8（下一轮候选）
2. `README.md` §5.41（对外口径）
3. `task.md`「第三十七阶段」交付表 + 实证发现
4. `electron/main/document-preview.ts` 新增区块：
   `DOCX 超链接 / 批注`（DOCX 段附近）· `parseRelEntries` / `isExternalTarget`（PPTX/XLSX 段附近）·
   `XLSX 超链接 / 批注`（`parseXlsxSheet` 之前）
