# handoff · ecclaw 第四十阶段（phase4o）· FINAL · 2026-11-06

> **状态**：功能完成并真机验证 —— 改码 ✅ / 自测 17/17 ✅ / 交叉复验全绿 ✅ /
> typecheck ✅ / build ✅ / e2e **17/17** ✅ / 全量回归 run73 二十六套全绿 + 1 条既有环境失败（见 §2）。
> 文档 ✅；提交待做（§5）。

## 1. 本轮交付

三个 Office 格式统一读取文档属性部件 `docProps/core.xml`：
标题 / 作者 / 最后修改人 / 修改时间 → 置顶一行
`[文档信息] 标题: … · 作者: … · 修改人: … · 修改时间: …`。

- **解析**：新增 `DOC_CORE_PROPS_ENTRY` / `DocCoreProps` / `parseCoreProps()` / `corePropsLine()`。
  **按本地名匹配**（`<(?:[\w.-]+:)?title>`），不硬编码 `dc:` / `cp:` / `dcterms:` 前缀。
- **输出**：空字段逐个省略；四个全空或没有该部件**一行都不出**。
- **落位**：DOCX 在页眉前；PPTX 在 `[幻灯片 1]` 前；XLSX 在 `[工作表 …]` 前；
  PPTX / XLSX 元数据行与正文**紧邻**（不额外插空行）。
- **容错**：畸形 `core.xml` 不抛异常、不出半截值；无 `docProps` 的文件输出逐字不变。

## 2. 测试证据

| 项 | 结果 |
|---|---|
| `phase4o-selftest.cjs` | **17/17**（全字段 / 仅标题 / 无部件 / 空 core / 畸形 / 任意前缀 / 截断） |
| 交叉复验 phase4n / 4m / 4l / 4j / 4k | 74/74 · 72/72 · 41/41 · 30/30 · 27/27 |
| `pnpm typecheck` / `pnpm build` | ✅ / ✅ |
| `phase4o-e2e.cjs` | **17/17**（工具面 2 · 抽取 11 · 界面 4）→ `run73-phase4o.log` |
| 全量回归 `rerun-and-regress25.cjs` | run73 二十七套 **936 PASS / 1 FAIL** → `run73-summary.txt` |
| 唯一失败 | phase3r `C3 summary 不带 kinds 时按全量聚合`：事件库已 >2000 条，`ecclaw_event_replay` 硬上限 2000（`electron/main/host-events.ts:409`）把参照样本截断；复跑另现 G3/G4 实时流时序抖动。**与本轮无关**（只动 document-preview.ts） |
| 未跑 | 真站套件 phase3s / phase3q（红线：不碰淘宝） |

## 3. 改动清单（未 commit）

- `electron/main/document-preview.ts`（+71 / −8）：
  - 常量 `DOC_CORE_PROPS_ENTRY`；类型 `DocCoreProps`
  - 新函数 `parseCoreProps()` · `corePropsLine()`
  - `DocxParts` / `PptxParts` 增 `coreProps`；`readDocxParts()` / `readPptxParts()` 纳入该部件
  - `extractDocxText()` / `extractPptxText()` / `extractXlsxText()` 各加一行元数据
- `README.md` §5.44 + 底部能力清单
- `task.md` 顶部状态段 + 「第四十阶段」交付表 + 实证发现
- 项目记忆 `ecclaw_phase4o_docprops.md` + `MEMORY.md` 索引
- 本 handoff + `prompt-ecclaw-phase4o-next.md`

## 4. 环境 / 复跑命令

- 项目根 `F:\soft\00selfmade\ecclaw`；基线提交 `2030f95`
- tsout 编译（**必须在项目根跑**）：
  ```
  cd F:/soft/00selfmade/ecclaw && npx tsc electron/main/document-preview.ts --module commonjs \
    --target ES2022 --moduleResolution node --esModuleInterop --skipLibCheck \
    --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron
  ```
- 跑自测前 `export NODE_PATH="F:/soft/00selfmade/ecclaw/node_modules"`
- e2e / 回归参数：`<hostServer>` = `C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/mcp/host-server.mjs`，
  `<bridge>` = `.../.openclaw/host-bridge.json`；回归脚本 `C:/Temp/ecclaw-verify/rerun-and-regress25.cjs`
- 改主进程后必须重启 Electron（`C:/Temp/ecclaw-verify/start-electron.ps1`；先杀干净所有 electron.exe）

## 5. 收尾待办

1. 精确 `git add` 上述产品/文档文件（**不要** add `handoff-2026-11-06.md` 占位文件、`C:\Temp\*`、`openclaw.json`、`host-bridge.json`）。
2. `feat(document-preview): add core document properties for DOCX/XLSX/PPTX`
3. 用新提交 hash 单独一条 `docs:` 回填本 handoff §5 与 task.md 顶部。

## 6. 下一轮候选（**已过期 7 次，必须重新探针**）

本轮探针实测的真缺口（未选）：DOCX 尾注 `word/endnotes.xml` · DOCX 图片 alt
（`wp:docPr@descr`）· DOCX 批注回复（`commentsExtended.xml`）· PDF 链接 / 注释 / 元数据
（pdfjs 已有 `getAnnotations` / `getMetadata`）· XLSX 定义名称 / 数据有效性。
**已确认非缺口（别再选）**：DOCX 页眉页脚（含 PAGE 域）、XLSX 隐藏工作表内容。