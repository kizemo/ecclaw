# handoff · ecclaw 第三十九阶段（phase4n）· FINAL · 2026-11-06

> **状态：全部完成** —— 改码 ✅ / 秒级自测 74/74 ✅ / 交叉复验全绿 ✅ / typecheck ✅ / build ✅ /
> e2e **78/78** ✅ / 全量回归 **run72 二十六套 920/920** ✅ / 文档 ✅ / 两条提交 ✅（hash 见末尾）。

## 1. 本轮交付

`electron/main/document-preview.ts` 补回 **PPTX 超链接 + PPTX 批注**，补齐 §5.41（phase4l）
留下的**三格式一致性缺口**：DOCX / XLSX 已有链接与批注，PPTX 独缺。

- **链接**：slide rels 里 Type 以 `/hyperlink` 结尾 → `rId` → Target；`a:hlinkClick` 按 `r:id` 查表
  → `[链接: <目标>]`。**只有带协议的外部目标才输出**，内部跳转不输出。
- **批注**：slide rels 里 Type 以 `/comments` 结尾 → 部件（`comment1.xml` / `modernComment_*.xml`）；
  **两代格式都认**（`p:cm` / `p188:cm`）；作者按 `authorId` 查作者表，查不到留空，只出作者不出日期。
- **落位**：段落级链接 → 该段落行末；形状级链接 + 归属批注 → 该形状首个块末尾；
  无归属批注 → 该页末尾；备注仍在最后一行。顺序恒为 **文本 → 链接 → 批注**。

## 2. 测试证据

| 项 | 结果 |
|---|---|
| `phase4n-selftest.cjs` | **74/74**（先 RED 58/74） |
| 交叉复验 phase4m / 4l / 4j / 4k | 72/72 · 41/41 · 30/30 · PPTX 输出逐字不变 |
| `pnpm typecheck` / `pnpm build` | ✅ / ✅ |
| `phase4n-e2e.cjs` | **78/78**（工具面 3 · 抽取 54 · 负向 6 · 界面 4）→ `run72-phase4n.log` |
| 全量回归 `rerun-and-regress24.cjs` | **run72 二十六套 920/920**，FAIL 全 0 → `run72-summary.txt` |
| 未跑 | 真站套件 phase3s / phase3q（红线：不碰淘宝） |

## 3. 改动清单

只有 `electron/main/document-preview.ts` 一个产品文件（+190 / −13）：

- 常量 `PPTX_COMMENTS_RE` / `PPTX_AUTHORS_RE`；`PptxParts` 增 `comments` / `authors`
- 新类型 `PptxComment` / `PptxRenderCtx`
- 新函数 `pptxLinkTargets` · `pptxLinkMarks` · `pptxShapeId` · `pptxShapeLinkMarks` ·
  `pptxCommentText` · `parsePptxComments` · `parsePptxAuthors` · `pptxRenderCtx` · `relTargetsByType`
- 改 `pptxShapeLines(shapeXml, ctx?)` · `pptxTreeBlocks(treeXml, ctx)` · `pptxSlideBlocks(slideXml, ctx)` ·
  `readPptxParts` · `extractPptxText`

文档：`README.md` §5.43 + 底部能力清单 · `task.md` 顶部状态段 + 「第三十九阶段」交付表 + 实证发现 ·
项目记忆 `ecclaw_phase4n_pptx_links_comments.md` + `MEMORY.md` 索引。

## 4. 环境 / 复跑命令

- 项目根 `F:\soft\00selfmade\ecclaw`；本轮功能提交 = `701d6d0`
- tsout 编译（**必须在项目根跑**）：
  ```
  cd F:/soft/00selfmade/ecclaw && npx tsc electron/main/document-preview.ts --module commonjs \
    --target ES2022 --moduleResolution node --esModuleInterop --skipLibCheck \
    --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron
  ```
- 跑自测前 `export NODE_PATH="F:/soft/00selfmade/ecclaw/node_modules"`
- e2e / 回归参数：`<hostServer>` = `C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs`，
  `<bridge>` = `.../.openclaw/host-bridge.json`；回归脚本 `C:/Temp/ecclaw-verify/rerun-and-regress24.cjs`

## 5. 踩坑（本轮新增，详见项目记忆）

1. PPTX 批注有两代格式（`p:cm` / `p188:cm`），**只认一种就丢另一代**。
2. 作者表容器标签 `p:cmAuthorLst` / `p188:authorLst` **不能当作者**（正则靠 `\b` 卡住）。
3. 形状级链接只在 `p:cNvPr` 里，与段落级**分开取**。
4. 一页可能挂**多个**批注部件 → 用 `relTargetsByType()` 取全部。
5. `p:graphicFrame` 表格**不挂**形状级标记（会破坏 Markdown 表）。
6. 自闭合 `p:cNvPr` 匹配要分支处理（第三次踩同一坑）。

## 6. 下一轮候选（**已过期 6 次，必须重新探针**）

探针实测的真缺口（本轮未选）：DOCX 尾注 `word/endnotes.xml` · `docProps/core.xml` 元数据
（DOCX / XLSX / PPTX 全丢）· DOCX 图片 alt（`wp:docPr@descr`）· DOCX 批注回复
（`commentsExtended.xml`）· PDF 链接 / 注释 / 元数据（pdfjs 已有 `getAnnotations` / `getMetadata`）·
XLSX 定义名称 / 数据有效性。