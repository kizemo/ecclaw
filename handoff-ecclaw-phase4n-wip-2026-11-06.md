# handoff · ecclaw 第三十九阶段（phase4n）· WIP · 2026-11-06

> **状态**：选题已定 + 设计已确认 + 改码完成 + 秒级自测 **74/74** GREEN + 交叉复验全绿 +
> 项目 `typecheck` ✅ / `build` ✅ + **Electron 已用新码重启**（CDP 9222 已就绪）。
> **未完成**：e2e 未跑（脚本已写好）、全量回归（run72）、收尾文档、两条提交。
> **中断原因**：上下文撞 160K 硬闸门（Bash 被拦，只放行 Write/Edit）→ 新会话从 §5 接着干。

## 0. 新会话第一步（照抄执行）

```bash
# ① e2e（Electron 已在跑；若 9222 不通先重启，见 §6）
cd C:/Temp/ecclaw-verify && export NODE_PATH="F:/soft/00selfmade/ecclaw/node_modules" && \
node phase4n-e2e.cjs "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs" \
  "C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json" > run72-phase4n.log 2>&1; \
echo "exit=$?"; grep -E "^\[\*\]|^断言|FATAL" run72-phase4n.log | tail -70
```
（e2e 断言共 55 条：9 个夹具 × 6 条 + 6 条负向 + 4 条界面；**断言数按实际数写**，别预设。）


---

## 1. 选题依据（探针实测 · 候选清单第 6 次被推翻）

先探针扫 13 根**新轴**（不照抄 4m 候选表），实测缺口：

| 轴 | 实测结果 | 判定 |
|---|---|---|
| PPTX 超链接 | run 级 `a:hlinkClick` 全丢 | **入选** |
| PPTX 批注 | `ppt/comments/comment1.xml` 全丢 | **入选** |
| DOCX 尾注 | `word/endnotes.xml` 全丢（脚注已支持） | 真缺口，未选 |
| `docProps/core.xml` 元数据 | 标题/作者/时间全丢（DOCX/XLSX/PPTX） | 真缺口，未选 |
| DOCX 图片 alt | `wp:docPr@descr` 丢（PPTX 已有） | 真缺口，未选 |
| DOCX 批注回复 | `commentsExtended.xml` 的回复丢 | 真缺口，未选 |
| PDF 链接 / 注释 / 元数据 | `getAnnotations`/`getMetadata` 没调 → 全丢（pdfjs 已有该 API） | 真缺口，未选 |
| XLSX 定义名称 / 数据有效性 | 丢 | 真缺口，未选 |
| DOCX TOC 域 | 域结果文本已在输出（域指令不泄漏） | 非缺口 |
| XLSX 隐藏行/列 · 富文本 | 内容照常输出 / 文本拼接完整 | 非缺口 |

**选题**：PPTX 超链接 + 批注 —— 把 4l 的「链接/批注」能力补齐到 PPTX
（DOCX/XLSX 已有，PPTX 独缺 = 三格式里唯一的**一致性缺口**），且完全复用现成的
`parseRelEntries` / `isExternalTarget` / `resolveRelTarget`。

## 2. 已确认设计（勿重开）

| 项 | 决定 |
|---|---|
| 范围 | ① PPTX 超链接（run 级 / 段落级 / 形状级 `a:hlinkClick`）② PPTX 批注（旧格式 `p:cm` + 新格式 `p188:cm`）|
| 标记 | 链接 `[链接: https://…]`（与 DOCX/XLSX 4l 同格式）· 批注 `[批注(作者): 正文]`（只出作者，不出日期）|
| 落位 | run/段落级链接 → 该段落行末；形状级链接 → 该形状首个块末尾（图片挂 `[图片: alt]` 行）；批注 → 被评论形状首行末（按 `p:cm@idx` 匹配形状 id），匹配不到 → 该页末尾单行（备注仍保持最后一行）|
| 顺序 | 文本 → 链接 → 批注 |
| 判定依据 | 链接：slide rels 中 Type 以 `/hyperlink` 结尾 → rId → Target，**只有带协议（外部）才输出**；内部跳转（`ppaction://hlinksldjump`、Target 指向其它 slide）**不输出**；批注：slide rels 中 Type 以 `/comments` 结尾 → 部件（旧的 `comment1.xml` / 新的 `modernComment_*.xml`），作者从 `ppt/commentAuthors.xml` / `ppt/authors.xml` 按 `authorId` 查，查不到**留空**（`[批注(): 正文]`）|
| 不变项 | 无链接/批注的 PPTX 输出**逐字不变**；MCP 工具数仍 **27**；只改 `electron/main/document-preview.ts`；无新增依赖 |

## 3. 改动清单（**只有这一个产品文件**）

`electron/main/document-preview.ts`：

- 常量：`PPTX_COMMENTS_RE`（`ppt/comments/*.xml`）· `PPTX_AUTHORS_RE`（`ppt/*author*.xml`）
- `PptxParts` 增 `comments` / `authors` 两个 `Record<string,string>`；`readPptxParts` 多读这两类部件
- 新增 `relTargetsByType()`（按类型找**全部**目标；`relTargetByType` 留给备注页用）
- 新增 `PptxComment` / `PptxRenderCtx` 两个类型
- 新增函数：`pptxLinkTargets` · `pptxLinkMarks` · `pptxShapeId` · `pptxShapeLinkMarks` · `pptxCommentText` · `parsePptxComments` · `parsePptxAuthors` · `pptxRenderCtx`
- 改 `pptxShapeLines(shapeXml, ctx?)`：段落内链接挂该行末尾（备注页调用不传 ctx → 行为不变）
- 改 `pptxTreeBlocks(treeXml, ctx)`：形状级链接 + 该形状批注挂到它的首个块末尾（**表格不挂**，会破坏 Markdown 表）
- 改 `pptxSlideBlocks(slideXml, ctx)` / `extractPptxText`：建 ctx、收集无归属批注 → 该页末尾

## 4. 测试证据（已完成）

| 项 | 结果 |
|---|---|
| 秒级自测 `phase4n-selftest.cjs` | **74/74** GREEN（先 RED **58/74**，红得全是链接/批注标记）|
| 交叉复验 4m | 72/72 ✅ |
| 交叉复验 4l | 41/41 ✅ |
| 交叉复验 4j | 30/30 ✅ |
| 交叉复验 4k | ✅（输出逐字不变）|

夹具 9 个（`make-phase4n-fixtures.cjs`）：link4n / shape4n / comment4n / modern4n / mix4n /
orphan4n / jump4n / pic4n / plain4n（.pptx）。

## 5. 待办（本会话剩余）

1. `pnpm typecheck` + `pnpm build`（项目级）
2. e2e：照 `phase4m-e2e.cjs` 复制改前缀 → `phase4n-e2e.cjs`（**`send()` 必须带 90s 超时**）
3. 全量回归：`rerun-and-regress24.cjs`（复制 `rerun-and-regress23.cjs` 改前缀 + 加 4n 套件）→ 产物前缀 **run72-***（不能覆盖 run71）
4. 收尾：`README.md` **§5.43** + 底部能力清单 · `task.md` 顶部状态段 + 「第三十九阶段」交付表 + 实证发现 · 项目记忆 `ecclaw_phase4n_pptx_links_comments.md` + MEMORY.md 索引 · `handoff-ecclaw-phase4n-final-2026-11-06.md` · `prompt-ecclaw-phase4n-next.md`
5. 提交：精确 `git add`（**禁 -A**）→ feat 一条 + docs 回填 hash 一条（不 amend）

## 6. 环境 / 基线 / 命令

- 项目根 `F:\soft\00selfmade\ecclaw`；基线 HEAD = `437cb16`（phase4m docs 回填）
- tsout 编译（**必须在项目目录下跑**，否则 `npx tsc` 会装到假的 `tsc@2.0.3`）：
  ```
  cd F:/soft/00selfmade/ecclaw && npx tsc electron/main/document-preview.ts --module commonjs \
    --target ES2022 --moduleResolution node --esModuleInterop --skipLibCheck \
    --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron
  ```
- 跑自测前：`export NODE_PATH="F:/soft/00selfmade/ecclaw/node_modules"`（不能省）
- MCP 工具数 **27**（不变）；stateDir `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw`
- e2e 参数：`<hostServerPath>` = `C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs`，
  `<bridgeFile>` = `C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json`

## 7. 本轮踩坑（别再踩）

1. **夹具里 `p:cNvPr` 别写成自闭合又带子元素**：`<p:cNvPr id="2" ...><a:hlinkClick/></p:cNvPr/>` 是错结构
   → 模板写成 `<p:cNvPr id=".." name="..">${cnv}</p:cNvPr>`，`cnv` 只放**内部内容**。
2. **`npx tsc` 必须在项目根跑**：在 `C:\Temp` 下跑会装 `tsc@2.0.3`（假的「这不是你要的 tsc」提示），
   编译静默失败 → 自测对着**旧 tsout** 跑，红的全是新功能，误判成「改码没生效」。
3. **PPTX 批注两代格式**：旧 `p:cm` + `ppt/commentAuthors.xml`；新 `p188:cm`（正文在 `p188:txBody` 里的
   `a:t`）+ `ppt/authors.xml`。作者表标签两种写法都要认（`p:cmAuthor` / `p188:author`），
   但 `p:cmAuthorLst` / `p188:authorLst` 里的容器标签**不能**被当成作者（靠 `\b` 卡住）。
4. **形状级链接要单独从 `p:cNvPr` 里取**：段落级扫描 `a:p` 抓不到形状级（它挂在 `p:cNvPr` 上）；
   反过来直接全文扫 `a:hlinkClick` 会把形状级混进段落级。
5. **自闭合标签的坑**（第三次踩）：`<p:cNvPr .../>` 用裸 `[^>]*` 匹配会一路吞到后面的 `</p:cNvPr>`
   → 用 `(\/>|>[\s\S]*?<\/p:cNvPr>)` 分支（与 DOCX 修订同一套路）。
