# handoff · ecclaw 第三十五阶段（phase4j）· WIP · DOCX 结构保真 · 2026-11-06

> **一句话状态**：设计已与用户逐项确认 ✅；代码主体已落地 `electron/main/document-preview.ts` 且 `pnpm typecheck` 通过 ✅；
> **尚未**：自测 / e2e / 全量回归 / 收尾文档 / 提交 ❌。上一会话在 160K 上下文硬闸门被拦（只放行 Write/Edit）。
> **本文件是下一会话的唯一入口**，读完直接接着干，不要重新设计。

---

## 1. 已确认设计（用户逐项确认，**勿重开讨论**）

| 项 | 决定 |
|---|---|
| 主题 | **DOCX 结构保真** |
| 范围 | 标题层级 + 列表编号 + 粗体/斜体 + 页眉/页脚/脚注（四项全做） |
| 输出风格 | Markdown 标记（`#` 标题 / 列表编号 / `**粗**` `*斜*`），与既有表格 markdown 风格一致 |
| 列表编号 | **真实多级编号**（读 numbering.xml，替换 lvlText 的 `%1`/`%2`） |
| 标题判定 | **读 styles.xml 按 style 名判定**（认「heading 1」「标题 1」） |
| 页眉脚注落位 | 页眉置顶 `[页眉] …`、页脚置底 `[页脚] …`、脚注在正文后 `[脚注]` 块（按引用顺序编号），正文引用处内联 `[N]` |
| 表格单元格 | 单元格内**也**应用粗斜体（标题/列表标记不应用） |

**范围约束**：只改 `electron/main/document-preview.ts`；契约 / `host-bridge.ts` / `host-server.mjs` / `src/App.tsx` 不动 → **MCP 工具数仍 27**，无新增依赖。

---

## 2. 已落地的代码（**代码已在工作区，未 commit**）

文件：`electron/main/document-preview.ts`（DOCX 抽取层，`/* ---- DOCX 结构 ---- */` 区块）

**新增**：
- `DocxParts` 接口 + `readDocxParts(filePath)`：一次解出 `word/document.xml` + `styles.xml` + `numbering.xml` + `footnotes.xml` + `header*.xml` + `footer*.xml`（**替换**原 `readDocxXml`）
- `parseDocxStyles()` + `headingLevelFromStyleName()`：styleId → 标题级别（style 自带 `outlineLvl` 优先，否则从名字取数字；认 `heading N` 与 `标题 N`）
- `parseDocxNumbering()`：`numId → abstractNumId → ilvl → {numFmt, lvlText, start}`
- `toAlpha()` / `toRoman()` / `toChineseNumber()` / `formatListNumber()` / `docxListLabel()`：真实多级编号（本级 +1、更深层清零、`%n` 替换）
- `docxParagraphProps()` / `docxToggleOn()` / `docxRuns()` / `docxRunsText()`：run 级粗斜体 → `**x**` / `*x*` / `***x***`；run 内 `w:footnoteReference` → 内联 `[N]`
- `renderDocxParagraph(paragraph, ctx, structure)`：标题 `#`~`######`、列表编号 + 缩进（哨兵 `DOCX_INDENT = '\u0000'` 占位，归一化后还原空格）
- `docxFootnoteNumbers()` / `parseDocxFootnotes()` / `docxHeaderLines()`
- `DocxRenderCtx`（styles / numbering / counters / footnoteNumbers）

**改动**：`extractDocxText(parts)`（页眉→正文→脚注→页脚）、`docxCellText(cell, ctx)`、`docxTableMarkdown(xml, ctx)`、previewDocument 调用点（`extractDocxText(readDocxParts(resolved))`）

**`pnpm typecheck` 已通过** ✅

---

## 3. 下一步必做（按顺序）

### 3.1 复查并修 NUL 字节 ⚠️
Edit 工具写入 `\u0000` 时会落成**真 NUL 字节**（源码变 binary，grep 报 `Binary file matches`）。
已用 node 脚本替换过 1 处，但**上次 grep 仍报 binary**，必须再扫一遍：

```bash
node -e "const fs=require('fs');const p='electron/main/document-preview.ts';let s=fs.readFileSync(p,'utf8');const idx=[];for(let i=0;i<s.length;i++)if(s.charCodeAt(i)===0)idx.push(i);console.log('NUL',idx.length);for(const i of idx){const ls=s.lastIndexOf('\n',i)+1;console.log(JSON.stringify(s.slice(ls,s.indexOf('\n',i))));}if(idx.length){s=s.split('\u0000').join('\\\\u0000');fs.writeFileSync(p,s);console.log('patched');}"
```
（把真 NUL 换成源码里的转义文本 `\u0000`；引号里出现 `\u0000` / 正则里出现 `\u0000` 两种位置都能用）

### 3.2 重建 tsout（秒级自测依赖它）
**必须加 `--rootDir electron`**，否则产物多套一层 `main/`，自测 require 的是旧文件：

```bash
npx tsc electron/main/document-preview.ts electron/main/paths.ts --rootDir electron --outDir C:/Temp/ecclaw-verify/tsout/main --module commonjs --moduleResolution node --target ES2022 --esModuleInterop --skipLibCheck
```

### 3.3 看抽取结果
```bash
cd /c/Temp/ecclaw-verify && export NODE_PATH="F:/soft/00selfmade/ecclaw/node_modules" && node dump-4j.cjs
```
- `dump-4j.cjs` 把 DOCX 夹具 `struct4j.docx` 的抽取结果按行 JSON 打印（看缩进最准）
- **`export NODE_PATH` 不能省**：tsout 在仓库外，`require('fflate')` 找不到（仓库 `node_modules` 里才有）
- 夹具生成：`node make-phase4j-fixtures.cjs` → `C:/Temp/ecclaw-verify/struct4j.docx`

### 3.4 期望输出（自测的 EXPECT，照此写断言）
```
[页眉] 合同编号 2026-001
# 项目概述
## 背景与目标
### 术语
# 中文标题
1. 第一章
2. 第二章
  2.1. 第二节
    a) 条款
3. 第三章
• 要点一
普通**粗体***斜体***粗斜***
| **名称** | 数量 |
| --- | --- |
| 甲 | 3 |
脚注引用[1]
结尾段落
[脚注]
1. 脚注内容
[页脚] 第 1 页
```
（`  2.1.` 前 **2 空格**（ilvl=1）、`    a)` 前 **4 空格**（ilvl=2）；`• 要点一` 无缩进）

### 3.5 秒级自测 + e2e
- 写 `C:\Temp\ecclaw-verify\phase4j-selftest.cjs`：骨架照抄 `phase4i-selftest.cjs`（整行相等 + 行数 + kind + error + 负向断言）
- e2e：`cp phase4i-e2e.cjs phase4j-e2e.cjs` 再按需改（DOCX 预览通路 + 界面 5 项）；注意 phase4h 踩坑：**e2e 的 send() 必须带超时**，否则 Electron 掉线会把整轮回归挂死
- 断言数按**实际数**写，别预估

### 3.6 全量回归（**run68-\*** 前缀，phase4i 用的是 run67）
- 驱动脚本：复制 phase4i 的 `C:\Temp\ecclaw-verify\rerun-and-regress19.cjs`（run67 驱动，20 套）→ 改前缀为 run68
- 摘要落 `run68-summary.txt`；**不跑真站 phase3s / phase3q**（红线：不碰淘宝）
- 二十套：4j · 4i · 4h · 4g · 4f · 4e · 4d · 4c · 4b · 4a · 3z · 3y · 3x · 3w · 3v · 3u · 3t · 3r · 3p · 3o · 3m · sse

### 3.7 收尾 + 提交
- `README.md` 新增 §5.39 + 底部能力清单加一条
- `task.md` 顶部状态段 + 「第三十五阶段」交付表
- 项目记忆 `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/ecclaw_phase4j_docx.md` + `MEMORY.md` 索引一行
- `handoff-ecclaw-phase4j-final-2026-11-06.md`（收官版）+ `prompt-ecclaw-phase4j-next.md`（<30 行，只做指针）
- `git add` **精确列文件**（禁 `git add -A`）；`openclaw.json` / `host-bridge.json` / `C:\Temp\*` **不得提交**
- 提交用 Conventional Commits，**不 amend**；feat 提交后再单独一条 docs 回填 hash

---

## 4. 探针结论（handoff §8 候选实测，**别照抄上一份候选表**）

| §8 候选 | 实测 | 判定 |
|---|---|---|
| 文本 `@` 剩余形状 | `"a"@ "b"` → `aabc b`（**空格被当结构符**，位置错，Excel 是 `a abc`）；`\@` → `abc`（转义字面 `@` 被丢，Excel 是 `@abc`）；`_(@_)` → 无留白；双 `@` 第二个当字面量 | 真缺口，**价值低**（边角） |
| 日期 locale 边角 | `[$-x-sysdate]` / `[$-F800]` → 落回原值；locale 不改顺序/分隔符（phase4i 已定"不改"）；builtin47 `mmss.0` → `0000.0` 不对 | 大半被既有决定**排除** |
| `containsBlanks` | 空白格 E1 **完全不出现**（`10 \| \| 30`）→ Excel 会给空白格上底色 | 真缺口，改空白格输出结构，回归面大、价值中低 |
| 图形类 CF | colorScale / dataBar / iconSet 全跳过 | 按设计跳过（纯文本无从表达） |
| **`expression` 规则** | `$E5>40`、`MOD(ROW(),2)=0` 两条**都不生效**（cellIs 正常） | **真缺口，价值中 → 下一轮候选** |
| 合并单元格 | `I1:K1` 合并后列位保留正常 | 无缺口 |

**新轴实测（DOCX/PPTX）—— 本轮选题依据**：
- DOCX：标题层级丢失、列表编号丢失（`numbering.xml` 未读）、粗斜体丢失、**页眉丢失**、**脚注内容丢失**、超链接只留文字不留 URL
- PPTX：表格被摊平成独立行（**列关系丢失**）、演讲者备注丢失（`notesSlide` 未读）、图片 alt 丢失
→ **PPTX 表格 + 备注** 是下一轮候选（比 XLSX 边角价值高）

探针脚本：`make-phase4j-probe.cjs`（24 用例 XLSX）/ `probe-4j.cjs` / `probe-4j-office.cjs`（DOCX+PPTX），都在 `C:\Temp\ecclaw-verify\`。

---

## 5. 环境基线

- 项目根 `F:\soft\00selfmade\ecclaw`（git 仓库）；HEAD = `42de99d`（phase4i docs 回填），上一 feat = `05f5857`
- 工作区未提交：`electron/main/document-preview.ts`（本轮改动）+ `handoff-ecclaw-phase4j-wip-2026-11-06.md`（本文件）+ `handoff-2026-11-06.md`（hook 建的占位，可留）
- stateDir `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw`；MCP 工具数 **27**（不变）；无新增依赖
- 临时资产 `C:\Temp\ecclaw-verify\`（不进仓库）：`make-phase4j-fixtures.cjs` · `dump-4j.cjs` · `make-phase4j-probe.cjs` · `probe-4j.cjs` · `probe-4j-office.cjs`

---

## 6. 本轮踩坑

1. **上下文 160K 硬闸门拦了一次**（Bash 被拒，只放行 Write/Edit）→ 被迫落本 WIP handoff。教训：写代码前估「还要读多少」，长文件读一次后只引用路径。
2. **Edit 写入 `\u0000` 会落成真 NUL 字节** → 源码变 binary（grep 报 `Binary file matches`）；必须扫一遍并替换成转义文本。
3. **`tsc` 显式列文件时必须 `--rootDir electron`**，否则产物落到 `tsout/main/main/`，自测 require 到旧文件 → 假绿。
4. **`normalizeText` 会把连续空格压成一个** → 列表缩进必须用哨兵（`\u0000`）占位，归一化后再还原成空格。
5. **run 前缀不能重名**：phase4i 是 run67-*，本轮用 run68-*（别覆盖 run67 产物）。
6. 回归驱动要**新前缀 + 精确 git add**，别 `git add -A`。
