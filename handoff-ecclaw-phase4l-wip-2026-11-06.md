# handoff · ecclaw 第三十七阶段（phase4l）· WIP · 2026-11-06

> **一句话状态**：主题「**链接 + 批注（DOCX / XLSX 双格式）**」已定 → **代码已改完** ✅ →
> typecheck ✅ · 秒级自测 **41/41** ✅ · 交叉复验 4j **30/30** / 4k **27/27** ✅（既有 DOCX/PPTX 输出逐字不变）；
> **卡在上下文 160K 硬闸门**：e2e / 全量回归 run70 / 收尾 / 提交**尚未做**，下一会话接手。
>
> ⚠️ 本会话**未 commit**（工作区有 `electron/main/document-preview.ts` 的改动）。

---

## 1. 选题依据（探针实测 · 别再重做）

**handoff phase4k §4 的候选清单第 4 次被推翻**。本轮实测 9 条轴，真实缺口如下：

| 轴 | 实测结果 | 证据夹具 |
|---|---|---|
| XLSX `expression` 条件格式 | 规则被解析但**永不命中**（`matchCfRule` 无 expression 分支） | probe-exp.xlsx |
| XLSX `colorScale`/`dataBar`/`iconSet` | `parseConditionalFormatting` 只收带 dxfId → 图形类整条丢弃 | probe-cfscale.xlsx |
| XLSX 超链接 URL | **URL 丢失** | probe-link.xlsx |
| DOCX 超链接 URL | **URL 丢失** | probe-docxlink.docx |
| XLSX 批注 | `xl/comments1.xml` 完全不读 | probe-comment.xlsx |
| DOCX 批注 | `word/comments.xml` 完全不读 | probe-docxcomment.docx |
| XLSX 图表 | `xl/charts/*.xml` 完全不读 | probe-chart.xlsx |
| XLSX 合并单元格 | 值天然落首格 + 列补空 → **已隐式处理**，只是看不出合并 | probe-merge.xlsx |
| XLSX 数据有效性 | 不读 | probe-dv.xlsx |

**用户已确认选题**：「链接 + 批注（DOCX/XLSX 双格式）」——理由是这两类是**不可再生信息**
（URL / 审阅意见丢了就真没了，agent 也算不出来），而条件格式 / 图表属表现层。

**标记格式用户已确认**（自动选中推荐项）：带作者的方括号标记。

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
- 新 `RelEntry` 接口 + `parseRelEntries(xml)`（Id/Target/Type，Target 走 `decodeXmlEntities`）
- `parseRels` 改为在 `parseRelEntries` 之上实现（**行为不变**）
- 新 `isExternalTarget(target)`（`/^[a-zA-Z][a-zA-Z0-9+.\-]*:/`）

**XLSX 侧**
- 新常量 `XLSX_SHEET_RELS_RE` / `XLSX_COMMENTS_RE`
- 新函数 `xlsxRefCellKeys(ref)`（区间展开上限 `MAX_LINK_CELLS = 4096`）/ `parseXlsxHyperlinks` / `parseXlsxComments` / `xlsxCellExtras`
- `parseXlsxSheet` 增参数 `extras: Map<string,string>`；`filled` 过滤改为「有值 **或** 有标记」；单元格文本 = 值 + ' ' + extra；颜色标记仍最末
- `extractXlsxText` 读 sheet rels 与 comments 部件；批注部件路径优先取 rels 里 Type 以 `/comments` 结尾者，**兜底按命名约定找 `xl/comments{N}.xml`**（N 取工作表序号）

---

## 4. 测试证据（已完成部分）

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 通过 |
| tsc → tsout | ✅ 通过（命令见 §6） |
| 秒级自测 `phase4l-selftest.cjs` | **41 / 41**（4 个夹具：整行相等 + 行数 + kind + error + 正向标记计数 + 负向「无标记文档不产生标记」） |
| 交叉复验 `phase4j-selftest.cjs` | **30 / 30** ✅（DOCX 既有输出逐字不变） |
| 交叉复验 `phase4k-selftest.cjs` | **27 / 27** ✅（PPTX 既有输出逐字不变） |

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

---

## 5. 下一步必交付（下一会话按此顺序做）

1. **`pnpm build`** —— 本会话后台起过一次（task `b0ztclh9r`），**结果没确认**，重跑并 grep `out/main/index.js` 确认含新代码。
2. **重启 Electron**：先 `taskkill //F //IM electron.exe`，再 `C:\Temp\ecclaw-verify\start-electron.ps1`（CDP 9222，工作目录 `F:\soft\00selfmade\ecclaw`）。
   —— 主进程代码改完**必须重启**，9222 只占一个实例。
3. **e2e**：`C:\Temp\ecclaw-verify\phase4l-e2e.cjs` **已写好、未跑**。
   参数同 phase4k：`<hostServerPath> <bridgeFile>`（host-server.mjs / host-bridge.json 在
   `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw\` 下）。
   脚本内断言数按设计写的 **30 条**（工具面 3 + 抽取 24 + 界面 4）——**实跑后按实际数改**。
4. **全量回归**：复制 `rerun-and-regress21.cjs` → `rerun-and-regress22.cjs`，前缀 `run69-*` → **`run70-*`**，
   加入 phase4l 套件（23 套 + 1 = 24 套）。**不跑真站 phase3s / phase3q（不碰淘宝）**。
5. **收尾**：
   - `README.md` 新增 **§5.41** + 底部能力清单加一条
   - `task.md` 顶部状态段加第三十七阶段 + 「第三十七阶段」交付表 + 实证发现
   - 项目记忆 `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/ecclaw_phase4l_links_comments.md`（新建）+ `MEMORY.md` 索引加一行
   - `handoff-ecclaw-phase4l-final-2026-11-06.md`（收官版）
   - `prompt-ecclaw-phase4l-next.md`（<30 行，只做接力指针）
6. **提交**：**精确 `git add`**（禁 `git add -A`）：
   `electron/main/document-preview.ts` · `README.md` · `task.md` ·
   `handoff-ecclaw-phase4l-final-2026-11-06.md` · `prompt-ecclaw-phase4l-next.md` ·
   （本 WIP handoff 也要不要提交由你定）
   → feat 一条 → **docs 回填 hash 一条，不 amend**。
   **禁提交**：`openclaw.json` / `host-bridge.json` / `C:\Temp\*` / 未跟踪的 `handoff-2026-11-06.md`（hook 占位，别动）。

---

## 6. 环境 / 基线 / 命令

- 项目根 `F:\soft\00selfmade\ecclaw`；基线 HEAD = **`94e447d`**（phase4k docs 回填）；feat = `ff1107a`
- **tsout 编译命令**（秒级自测必须先跑，产物在 `tsout/main/*.js`）：
  ```
  npx tsc electron/main/document-preview.ts --module commonjs --target ES2022 \
       --moduleResolution node --esModuleInterop --skipLibCheck \
       --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron
  ```
- 跑自测前：`export NODE_PATH="F:/soft/00selfmade/ecclaw/node_modules"`（**不能省**，否则 require('fflate') 找不到）
- MCP 工具数 **27**（不变）；stateDir `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw`
- 临时资产（全在 `C:\Temp\ecclaw-verify\`，**不进仓库**）：
  - `make-phase4l-probe.cjs` + `make-phase4l-probe2.cjs`（探针夹具）
  - `make-phase4l-fixtures.cjs`（自测夹具：linkcomment.xlsx / plain4l.xlsx / linkcomment.docx / plain4l.docx）
  - `phase4l-selftest.cjs`（41/41）· `phase4l-e2e.cjs`（**已写未跑**）

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
5. **断言数按实际数写**（本轮自测实测 41，e2e 预估 30 待实测）。
6. **e2e 的 `send()` 必须带 90s 超时**，否则 Electron 掉线会把整轮回归挂死。
7. **上下文 160K 硬闸门会拦 Bash/Read**（只放行 Write/Edit）→ 被拦时唯一正确动作：写 handoff 后开新会话。

---

## 8. 必读顺序

1. 本文件 §2（设计，勿重开）· §3（改动清单）· §4（测试证据）· §5（下一步）
2. `README.md` §5.40（上一轮对外口径）
3. `task.md`「第三十六阶段」交付表 + 实证发现
4. `electron/main/document-preview.ts` 新增区块：
   `DOCX 超链接 / 批注`（DOCX 段附近）· `parseRelEntries` / `isExternalTarget`（PPTX/XLSX 段附近）·
   `XLSX 超链接 / 批注`（`parseXlsxSheet` 之前）
