# handoff · ecclaw 第二十二阶段（phase3w）· DOCX 抽取 + PDF 位图预览 · 2026-11-03

> **一句话结论**：在 phase3v 的文档预览上补了两件事——
> ① **DOCX 文本抽取**（fflate 只解 `word/document.xml`，段落 + 表格 + XML 实体 + NFKC）；
> ② **PDF 单页位图渲染**（`@napi-rs/canvas` + pdfjs，只在界面显示，**不返回给 agent**）。
> MCP 工具数**仍是 27**（未新增工具）。`phase3w-e2e.cjs` **27/27 全绿**，
> 全量回归 **run54 九套 299/299 全绿**（实测，见 §4）。
>
> **本轮状态**：代码 / typecheck / build / e2e / 全量回归均已就绪；**全部未 commit**（项目非 git 仓库）。

---

## 1. 本轮必读顺序

1. 本文档
2. `handoff-ecclaw-phase3v-final-2026-11-03.md`（上一阶段：PDF 文本预览 + phase3o 假红定性）
3. `handoff-ecclaw-phase3u-final-2026-11-03.md`、`handoff-ecclaw-phase3r-final-2026-11-03.md` §0/§6/§10
4. `README.md` §5.25 / §5.26 / §8 · `task.md` 顶部状态段与第二十二阶段表
5. `E:\Users\Duanyi\.claude\projects\F--soft-00selfmade-ecclaw\memory\MEMORY.md`
6. `prompt-ecclaw-phase3w-next.md`（下一阶段指针）

---

## 2. 交付清单（全部未 commit）

| 文件 | 改动 |
|---|---|
| `electron/main/document-preview.ts` | ①`detectDocumentKind` 增 DOCX（zip magic + 探头部/尾部各 128KB 找 `word/document.xml`）；②`extractDocxText`（段落 / 制表符 / 换行 / 表格按 `列 \| 列` 展开 / XML 实体解码 / NFKC）；③`readDocxXml`（`unzipSync({filter})` **只解正文**，拒 zip 炸弹）；④`loadCanvas()`（`@napi-rs/canvas` + 补 `DOMMatrix/ImageData/Path2D` 全局）；⑤`renderDocumentPage()`（PNG data URL）；⑥预览文案改为 PDF/DOCX |
| `electron/shared/types.ts` | `DocumentKind` 增 `'docx'`；新增 `DocumentPageImage`；`files.renderPage()` |
| `electron/main/index.ts` | 新 IPC `files:preview-image` |
| `electron/preload/index.ts` | `files.renderPage(path, page?)` |
| `src/App.tsx` | DOCX 标签与文本预览（`doc-preview-text`）；PDF 位图（`doc-preview-image` / `-image-meta` / `-image-error` / `-prev` / `-next`） |
| `src/api.ts` | 导出 `DocumentPageImage` |
| `resources/mcp/host-server.mjs` | **只改描述**（支持 PDF/DOCX；位图不返回 agent），工具数不变 |
| `package.json` | 新增 `fflate@0.8.3`、`@napi-rs/canvas@1.1.0` |

### 临时资产（`C:\Temp\ecclaw-verify\`）

- `make-docx.cjs`（生成 `quote.docx` / `empty.docx` 夹具，fflate 现场打 zip）
- `phase3w-e2e.cjs`（**27 条断言**）
- `rerun-and-regress6.cjs`（**run54-\*** 驱动，9 套，不跑真站）
- `pdf-render-spike.mjs`（Node 下 pdfjs + canvas 渲染 spike）

---

## 3. 关键设计决策（可迁移）

1. **DOCX = zip + XML，不需要 Office**：`fflate.unzipSync(data, { filter: f => f.name === 'word/document.xml' })`
   **只解正文条目**，图片/媒体不落内存 → 天然规避 zip 炸弹。上限仍受 `MAX_FILE_BYTES = 64MB` 约束。
2. **表格展开规则**：单元格内多段用空格连接，同行单元格用 `" | "`，行间换行 → agent 能直接读成表。
3. **XML 实体必须解码**：`&amp;` / `&#x989C;`（数字实体）都要还原，否则 agent 读到的是源码。
4. **位图只给界面**：PNG base64 不返回 MCP（避免把几百 KB 塞进模型上下文）；agent 继续读文本。
5. **canvas 加载姿势**：`createRequire(app.getAppPath()/anchor)` → `@napi-rs/canvas`，
   并把 `DOMMatrix / ImageData / Path2D` 挂到 `globalThis`（pdfjs 在 Node 侧渲染需要）。
   `@napi-rs/canvas` 是 N-API，ABI 稳定，Electron 直接可加载（已实测）。
6. **本轮踩坑（重要）**：`detectDocumentKind` 为 PDF 读了 **5 字节**头，
   却拿整段 5 字节去比较 **4 字节**的 zip magic `PK\x03\x04` → DOCX 被判成 `other`。
   修法：`head.subarray(0, 4).toString('latin1') === ZIP_MAGIC`。
   **可迁移规则：magic 比较要按 magic 长度切片，不要拿整段缓冲区比。**
7. **制表符会被归一化成空格**：`normalizeText` 的 `/[ \t]+/ → ' '` 是既有行为（与 PDF 一致），
   e2e 断言按「款号 A102」写，别指望保留 `\t`。

---

## 4. 验证证据（实测）

- `pnpm typecheck` ✅ / `pnpm build` ✅（renderer `index-CqdbVrtm.js` 657.63 kB）
- **phase3w e2e：27/27 全绿**
  工具面 3 · 清单 3 · DOCX 抽取 9 · PDF 文本回归 1 · 界面 DOCX 4 · 界面 PDF 位图 4 · 其余 3
  关键实测：`kind=docx`；抽出「供应商报价单」；表格 `款号 | 颜色 | 单价`、`A102 | 米白 | 58`；
  实体 `备注 & 实体 颜色 OK`；空 DOCX → `DOCX 里没有可抽取的文字`；`maxChars=8` → truncated；
  界面 `DOCX · 文本预览 · 1079 B`；PDF 位图 `naturalWidth>0`、`data:image/png;base64`、`第 1 / 1 页 · 918×1188`。
- **phase3v 回归：29/29 全绿**
- **run54 全量回归（`C:\Temp\ecclaw-verify\run54-summary.txt`，实测）**：
  phase3w 27 · phase3v 29 · phase3u 24 · phase3t 16 · phase3r 31 · phase3p 45 · phase3o 44 · phase3m 69 · sse 14
  → **合计 299 PASS / 0 FAIL**。未跑真站 phase3s / phase3q（红线：不碰淘宝）。

---

## 5. 环境基线（收官实测）

| 项 | 值 |
|---|---|
| 项目根 | `F:\soft\00selfmade\ecclaw`（非 git） |
| Node | 系统 v26.13.0；Electron 内 Node v24.22.1 |
| 新依赖 | `fflate@0.8.3`、`@napi-rs/canvas@1.1.0`（N-API 预编译） |
| stateDir | `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw` |
| MCP 工具数 | **27**（本轮未新增） |
| e2e 遗留物 | 文件库新增 `ecclaw-phase3w-报价单.docx` / `-empty.docx` / `-sample.pdf`（只增不删） |

---

## 6. 复现命令

```bash
cd /f/soft/00selfmade/ecclaw && pnpm typecheck && pnpm build
cd /c/Temp/ecclaw-verify && node make-docx.cjs
node C:/Temp/ecclaw-verify/stop-electron.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Temp/ecclaw-verify/start-electron.ps1"
node C:/Temp/ecclaw-verify/phase3w-e2e.cjs <hostServer> <bridge>
node C:/Temp/ecclaw-verify/rerun-and-regress6.cjs   # run54-*
```

---

## 7. 红线（照旧）

- 禁删用户文件；e2e 写进文件库的 `ecclaw-phase3w-*` 也留着。
- 禁 `git init` / `commit`；`openclaw.json` / `host-bridge.json` 勿外传。
- 本阶段不碰淘宝（phase3s / phase3q 未跑）。
- 临时产物写 `C:\Temp\`；handoff/task 不进 `memory/`。
- GUI 验证走 CDP；无人值守 e2e 期间勿碰 GUI 卡片。

---

## 8. 下一阶段候选（写进 prompt 时只留指针）

- Pptx / Xlsx 抽取（同一套 zip+XML 思路，xlsx 需 sharedStrings + 单元格引用）。
- DOCX 表格保留结构（现在已按行列展开，若要 markdown 表格可增强）。
- PDF 多页缩略图 / 指定页渲染参数（`scale` 已支持，界面未暴露）。
- 邮件 worker（外发副作用，需显式确认）。
- 画布宿主（新事件 kind）。
- 欠账：真站套件 phase3s / phase3q（需先问过淘宝）。