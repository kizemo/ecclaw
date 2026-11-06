# handoff · ecclaw 第三十八阶段（phase4m）· WIP：探针完成 + 设计已确认，未改码 · 2026-11-06

> **一句话状态**：本轮只做了八步法的第 1、2 步 —— **13 轴探针实测完成** → **选题 + 设计经用户确认**
> （「XLSX 公式 + DOCX 修订痕迹」）。**未动一行产品代码**（额度 99% 撞顶，停手交接）。
> 下一会话从 §4 改码指引开始执行。

---

## 1. 基线

- 项目根 `F:\soft\00selfmade\ecclaw`；HEAD = `3a53961`（phase4l docs 回填）；工作区干净
  （只有未跟踪 hook 占位 `handoff-2026-11-06.md`，**别动、别提交**）
- phase4l 已收官提交：feat `198f3e8` + docs `3a53961`，全量回归 run70 二十四套 792/792 全绿
- MCP 工具数 **27**；本阶段预期不变

## 2. 探针实测结果（13 轴，候选清单第 5 次被推翻）

phase4l §8 清单实测后：**XLSX 公式、DOCX 修订痕迹是全新发现的更大缺口**；
文本框 / 内容控件实测**根本不是缺口**（已有输出天然覆盖）；expression 条件格式确认真缺口但要公式求值器。

| 轴 | 文件里有 | 抽取输出 | 判定 |
|---|---|---|---|
| A XLSX 普通公式 | `SUM(B1:B9)` / `CONCAT(A1,"元")` | 只剩值 `30`/`30元` | **真缺口** → 入选 |
| I XLSX 共享/数组公式 | master `B1*2`(ref+体) + follower(只有 si) + 数组 `SUM(A1:A3)` | 只剩值 | **真缺口** → 入选 |
| E DOCX 插入 | `<w:ins 张三>` 新增的内容 | 混入正文、无标记 | **真缺口+误导** → 入选 |
| E2 DOCX 删除 | `<w:del 李四>` 删掉的内容 | **整段消失** | **真缺口+误导** → 入选 |
| K DOCX 移动 | `moveFrom/moveTo 王五` | 只剩 moveTo | **真缺口** → 入选 |
| F DOCX 尾注 | endnote 正文 | 无 | 真缺口，未选（下轮候选） |
| H PPTX 超链接 | `https://example.com/slide` | 无 | 真缺口，未选（下轮候选） |
| L PPTX 批注 | 批注正文+作者 | 无 | 真缺口，未选（下轮候选） |
| B XLSX 定义名称 | `销售额=数据!$A$1:$A$10` | 无 | 真缺口，中低价值，未选 |
| C XLSX 数据有效性 | 下拉 `"是,否,待定"` | 无 | 低-中，未选 |
| D XLSX expression CF | `$A1>10` 应标红 | 无颜色 | 真缺口但要公式求值器，未选 |
| D2 colorScale | 规则 | 无 | 表现层，未选 |
| G 文本框 / J w:sdt | 框内/控件内文字 | **已输出** | **非缺口**（排除） |

**探针资产**（`C:\Temp\ecclaw-verify\`，不进仓库）：`phase4m-probe.cjs` / `phase4m-probe2.cjs`，
夹具落 `probe4m\`（a-formula / b-definedname / c-dataval / d-cf / e-tracked / f-endnote / g-textbox /
h-pptxlink / i-sharedform / j-sdt / k-move / l-pptxcmt）。可直接改造为本阶段自测夹具。

## 3. 已确认设计（用户 2026-11-06 确认，勿重开）

| 项 | 决定 |
|---|---|
| 范围 | ① XLSX 单元格公式（普通/共享/数组）② DOCX 修订痕迹（插入/删除/移动）。**不含** PPTX 链接批注、expression CF、定义名称、数据有效性、DOCX 尾注 |
| 标记 | 公式 `[公式: SUM(B1:B9)]` · 插入 `[修订+张三: 新增的内容]` · 删除 `[修订-李四: 删掉的内容]` |
| 顺序 | XLSX：值 → 公式 → 链接/批注 extras → **颜色最末**；DOCX：宿主文本 → **修订** → 链接 → 批注 |
| 落位 | XLSX 附单元格值后；DOCX 附段落文本后（`#` 前缀之后），表格单元格同理 |
| 作者/日期 | 只输出 `w:author`，不输出日期 |
| 共享公式 follower | 输出 `[公式: 共享 <master公式体>]`，**不做相对引用重写** |
| 判定依据 | XLSX：`<c>` 内 `<f>` 文本（decode 实体、trim、不加 `=`）；`t="shared"` 有体=mater、空体=follower 按 si 找回 master；`t="array"` 按普通公式<br>DOCX：`<w:ins w:author>` 内含 run→正文照常+段末 `[修订+…]`；`<w:del>` 文本在 `<w:delText>`→正文不含+段末 `[修订-…]`；moveFrom/moveTo 按删除/插入；**`w:pPr/w:rPr` 里的 ins/del（段落标记修订）不算**；`rPrChange/pPrChange` 不处理 |
| 不变项 | 无公式/无修订文件**输出逐字不变**；MCP 27 不变；**只改 `electron/main/document-preview.ts`**；无新增依赖 |

**目标输出样例**：
```
30 [公式: SUM(B1:B9)] | 5          ← a-formula
4 [公式: 共享 B1*2]                ← i-sharedform follower
新增的内容中间 [修订+张三: 新增的内容] [修订-李四: 删掉的内容]
移动后文字 [修订-王五: 移动前文字] [修订+王五: 移动后文字]
```

## 4. 改码指引（本轮唯一产品文件）

`electron/main/document-preview.ts`：

**XLSX 侧**
- `parseXlsxSheet` 的 Cell 增加 `formula: string` / `sharedSi: string` 字段：单元格循环里
  `/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/` 取体、`\bt="shared"`、`\bsi="(\d+)"` 取属性；
  **先全表扫完再拼**（master 总在 document order 前，但要建 si→master体 的 Map 再回填 follower）
- 数组公式 `t="array"` 按普通公式输出
- 渲染拼接处（现 `parseXlsxSheet` 末尾 `const text = ...`）：值 + 公式 + extras（链接/批注）+ 颜色，
  空值格有公式也要进 `filled` 过滤（改 `c.value !== '' || c.formula !== '' || extras.has(...)`）

**DOCX 侧**
- 新函数 `docxRevisionMarks(paragraph)`：正则取 `<w:ins ...>…</w:ins>` / `<w:del ...>…</w:del>` 块
  （块内文本用现成 `docxRuns` / `<w:delText>` 扫描），要求**含 run 文本**才算（天然排除段落标记
  `<w:pPr><w:rPr><w:ins/></w:rPr></w:pPr>` 这种空壳）；`w:moveFrom`/`w:moveTo` 并入 del/ins 两路
- `docxExtras` 开头插入修订标记（修订在链接、批注**之前**）
- 正文流**不用动**：`docxRuns` 全局扫 `<w:r>` 天然已把 w:ins 内容计入正文、把 w:delText 排除在外
  （探针 E/E2 实测证实），修订标记只做「署名 + 找回删除内容」

## 5. 验证计划（下轮执行）

1. tsout 编译（命令见 §7）→ 秒级自测 `phase4m-selftest.cjs`（把 probe4m 的 a-formula / i-sharedform /
   e-tracked / k-move 改造成夹具 + 逐字不变的负向 plain 件；**断言数按实际数写**）
2. 交叉复验 `phase4j-selftest.cjs` / `phase4k-selftest.cjs` / `phase4l-selftest.cjs` 全绿（既有输出逐字不变）
3. `pnpm build` + grep `out/main/index.js` 新代码
4. `taskkill //F //IM electron.exe` → `C:\Temp\ecclaw-verify\start-electron.ps1`（CDP 9222，杀干净）
5. e2e `phase4m-e2e.cjs <hostServerPath> <bridgeFile>`（send() 必带 90s 超时）
6. 全量回归：复制 `rerun-and-regress22.cjs` → `rerun-and-regress23.cjs`，前缀 `run70-*` → **`run71-*`**，
   24+1=25 套；**不跑真站 phase3s / phase3q**
7. 收尾：README **§5.42** · task.md 第三十八阶段交付表 + 实证发现 · 项目记忆
   `ecclaw_phase4m_*.md` + MEMORY.md 索引 · `handoff-ecclaw-phase4m-final-2026-11-06.md` ·
   `prompt-ecclaw-phase4m-next.md`
8. 提交：精确 `git add`（document-preview.ts + README + task.md + 两份 handoff + prompt）→
   feat 一条 → docs 回填 hash 一条，**不 amend、禁 `git add -A`**

## 6. 环境 / 命令

- tsout：`npx tsc electron/main/document-preview.ts --module commonjs --target ES2022 --moduleResolution node --esModuleInterop --skipLibCheck --outDir C:/Temp/ecclaw-verify/tsout --rootDir electron`
- 跑自测前 `export NODE_PATH="F:/soft/00selfmade/ecclaw/node_modules"`（不能省）
- stateDir `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw`；
  hostServer `.../mcp/host-server.mjs`，bridge `.../host-bridge.json`
- 库目录（自测拷贝目标）：`C:/Temp/ecclaw-verify/fake-userdata/openclaw/.openclaw/file-library/files`

## 7. 避坑（沿用 + 本轮新增）

- 沿用：正则常量改完立刻 typecheck（4l 漏尾斜杠事故）；Edit 写 `\u0000` 会落真 NUL；
  `--outDir` 别写成 `tsout/main`（会多套一层→require 旧文件→假绿）；断言数按实际写；
  e2e send() 90s 超时；改主进程必重启 Electron；9222 只占一个实例
- **DOCX 修订最大坑**：正文流**别重复加 w:ins 文本** —— `docxRuns` 全局扫 `<w:r>` 已含 ins 内容
  （探针实测正文有「新增的内容」），本阶段只加段末署名标记，勿动正文渲染路径
- **段落标记修订过滤**：`<w:pPr><w:rPr><w:ins .../></w:rPr></w:pPr>` 也是 w:ins，必须靠
  「块内含 run 文本」判定排除，否则纯格式段落会冒出空修订标记
- **共享公式 follower**：document order 里 master 先出现，但拼行在收集之后 —— 用
  si→master 体 Map 在渲染前回填，别在单元格循环里就地解析（follower 无体）
- **delText 转义**：`<w:delText>` 也要 decodeXmlEntities（复用 `docxParagraphText` 的口径）
- **空值格带公式**：`filled` 过滤记得放行（`=0` 单元格值为空但公式是信息）
- 额度纪律：本块（10:00–15:00）99% 撞顶才交接的；新会话开工前先看 quota，剩余时间不够跑完整
  八步就只做「改码+自测+交叉复验」，e2e/回归留再下一会话

## 8. 下下轮候选（phase4n 备选，会过期，先探针）

PPTX 超链接+批注（同构复用 parseRelEntries/isExternalTarget，最便宜）· DOCX 尾注（脚注同构）·
XLSX 定义名称 · expression CF（需公式求值器，慎选）

## 9. 必读顺序

1. 本文件 §3（已确认设计，勿重开）· §4（改码指引）· §5（验证计划）
2. `handoff-ecclaw-phase4l-final-2026-11-06.md` §2–§4（extras 通道现状，本轮直接复用）
3. `electron/main/document-preview.ts`：`docxExtras` / `docxRuns`（DOCX 段）·
   `parseXlsxSheet`（单元格循环 + 末尾拼接两处）· `xlsxCellExtras`
4. 探针脚本与夹具：`C:\Temp\ecclaw-verify\phase4m-probe*.cjs` / `probe4m\`