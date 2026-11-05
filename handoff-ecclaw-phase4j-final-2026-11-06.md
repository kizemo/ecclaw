# handoff · ecclaw 第三十五阶段（phase4j）· 收官 · 2026-11-06

> **一句话状态**：DOCX 结构保真（标题层级 + 多级列表编号 + 粗斜体 + 页眉/页脚/脚注）**四项全做完** ✅；
> 秒级自测 **30/30** · e2e **39/39** · **全量回归 run68 二十二套 720/720 全绿** ✅；
> README §5.39 / task.md / 项目记忆 / 收尾文档 **已补齐**，提交见 §2。

---

## 1. 本轮做成了什么

**选题（探针先行，第二次印证「候选清单会过期」）**：phase4i handoff §9 的候选实测后大半被推翻 ——
「文本 `@` 剩余形状」是真缺口但价值低；「日期 locale 边角」被既有决定排除；「`containsBlanks`」回归面大；
「`expression` 条件格式」是真缺口但价值中。**新轴（DOCX / PPTX）**实测发现结构丢失最明显 →
本轮改选 **DOCX 结构保真**（PPTX 表格 + 备注 = 下一轮候选）。

**已确认设计（用户逐项确认，勿重开）**：

| 项 | 决定 |
|---|---|
| 范围 | 标题层级 + 列表编号 + 粗体/斜体 + 页眉/页脚/脚注（四项全做） |
| 输出风格 | Markdown 标记（`#` 标题 / 列表编号 / `**粗**` `*斜*`），与既有表格 markdown 风格一致 |
| 列表编号 | **真实多级编号**（读 numbering.xml，替换 lvlText 的 `%1`/`%2`） |
| 标题判定 | **读 styles.xml 按 style 名判定**（认「heading 1」「标题 1」） |
| 页眉脚注落位 | 页眉置顶 `[页眉] …`、页脚置底 `[页脚] …`、脚注在正文后 `[脚注]` 块（按引用顺序编号），正文引用处内联 `[N]` |
| 表格单元格 | 单元格内**也**应用粗斜体（标题/列表标记不应用） |

**范围约束**：只改 `electron/main/document-preview.ts`；契约 / `host-bridge.ts` / `host-server.mjs` / `src/App.tsx` 不动
→ **MCP 工具数仍 27**，无新增依赖。

---

## 2. 改动清单

| 文件 | 改动 |
|---|---|
| `electron/main/document-preview.ts` | **唯一产品改动**：新增 `DocxParts` + `readDocxParts()`（一次解 document/styles/numbering/footnotes/header*/footer*，**替换** `readDocxXml()`）、`parseDocxStyles()` + `headingLevelFromStyleName()`、`parseDocxNumbering()`、`toAlpha/toRoman/toChineseNumber/formatListNumber/docxListLabel`、`docxParagraphProps/docxToggleOn/docxRuns/docxRunsText`、`renderDocxParagraph()`、`docxFootnoteNumbers/parseDocxFootnotes/docxHeaderLines`、`DocxRenderCtx`；改 `extractDocxText(parts)`（页眉→正文→脚注→页脚）、`docxCellText(cell, ctx)`、`docxTableMarkdown(xml, ctx)`、previewDocument 调用点 |
| `README.md` | 新增 **§5.39**；底部能力清单加一条（指 §5.39） |
| `task.md` | 顶部状态段加第三十五阶段；新增「第三十五阶段」交付表 + 实证发现 8 条 |
| `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/ecclaw_phase4j_docx.md` | 项目记忆（新建）+ `MEMORY.md` 索引加一行 |
| `handoff-ecclaw-phase4j-final-2026-11-06.md` | 本文件（收官版） |
| `prompt-ecclaw-phase4j-next.md` | 下一轮接力指针（<30 行） |

**临时资产**（`C:\Temp\ecclaw-verify\`，**不进仓库**）：
`make-phase4j-fixtures.cjs`（→ `struct4j.docx`）· `dump-4j.cjs` · `phase4j-selftest.cjs` · `phase4j-e2e.cjs` ·
`make-phase4j-probe.cjs` · `probe-4j.cjs` · `probe-4j-office.cjs` · `fix-nul.cjs` · `rerun-and-regress20.cjs`（run68 驱动）。

---

## 3. 测试证据

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 通过 |
| `pnpm build`（electron-vite） | ✅ 通过（out/main/index.js 重建） |
| 秒级自测 `phase4j-selftest.cjs` | **30/30**（20 行整行相等 + 行数 + kind + error + 7 条负向断言） |
| e2e `phase4j-e2e.cjs` | **39/39**（工具面 3 · 抽取 23 · 负向 7 · 界面 6），产物 `run68-phase4j.log` |
| 全量回归 **run68** | **二十二套 720/720 全绿**（FAIL 全 0），摘要 `run68-summary.txt` |

**run68 明细**：4j 39 · 4i 53 · 4h 48 · 4g 30 · 4f 26 · 4e 21 · 4d 31 · 4c 26 · 4b 18 · 4a 20 ·
3z 37 · 3y 31 · 3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14
（**未跑真站 phase3s / phase3q —— 本阶段红线：不碰淘宝**）

**抽取实际输出**（夹具 `struct4j.docx`）：

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
普通**粗体***斜体****粗斜***
| **名称** | 数量 |
| --- | --- |
| 甲 | 3 |
脚注引用[1]
结尾段落
[脚注]
1. 脚注内容
[页脚] 第 1 页
```

---

## 4. 下一步必交付（第三十六阶段）

**下一轮候选（探针结论已给，直接可用）**：
1. **PPTX 表格 + 演讲者备注**（价值高于 XLSX 边角）：表格被摊平成独立行 → **列关系丢失**；
   `notesSlide` 未读 → 备注丢失；图片 alt 丢失。
2. **XLSX `expression` 条件格式**（真缺口、价值中）：`$E5>40`、`MOD(ROW(),2)=0` 两条都不生效（`cellIs` 正常）。
3. 次要：XLSX 空白格（`containsBlanks` 真缺口，回归面大）；DOCX 超链接只留文字不留 URL；
   文本 `@` 剩余形状（价值低）。

**纪律（沿用）**：
- **候选清单会过期（已两次印证）** → 下一轮仍**先探针实测 + 扫新轴再选题**。
- 回归用**新前缀**（phase4j 用的是 `run68-*`，下一轮用 `run69-*`），别覆盖旧产物。
- 提交只 `git add` **精确文件**（禁 `git add -A`）；`openclaw.json` / `host-bridge.json` / `C:\Temp\*` **不得提交**。
- 提交用 Conventional Commits，**不 amend**；feat 提交后再单独一条 docs 回填 hash。
- 红线：**不跑真站 phase3s / phase3q**（不碰淘宝）。

---

## 5. 环境 / 分支基线

- 项目根 `F:\soft\00selfmade\ecclaw`（git 仓库）；基线 HEAD = `42de99d`（phase4i docs 回填），上一 feat = `05f5857`
- stateDir `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw`；MCP 工具数 **27**（不变）；无新增依赖
- Electron 启动：`C:\Temp\ecclaw-verify\start-electron.ps1`（`npx electron . --remote-debugging-port=9222`，
  工作目录 `F:\soft\00selfmade\ecclaw`）；e2e 走 CDP 9222
- 回归驱动：`C:\Temp\ecclaw-verify\rerun-and-regress20.cjs`（run68 驱动，22 套，每套前 ensureEnv）

---

## 6. 本轮踩坑（别再踩）

1. **Edit 写入 `\u0000` 会落成真 NUL 字节** → 源码变 binary（grep 报 `Binary file matches`）。
   落笔后**必须扫一遍**：`node C:/Temp/ecclaw-verify/fix-nul.cjs`（把真 NUL 换成源码转义文本）。
2. **`tsc` 显式列文件时 `--rootDir` 与 `--outDir` 要配套**：
   `--rootDir electron --outDir .../tsout` → 产物在 `tsout/main/*.js`（自测 require 的路径）；
   `--rootDir electron --outDir .../tsout/main` → **多套一层 `main/`**，自测 require 到**旧文件** → **假绿**
   （坑在「旧文件仍在原地」不报错）。**旧目录 `tsout/main/main/` 是历史残留，可留但别 require 它。**
3. **`normalizeText` 会把连续空格压成一个** → 列表缩进必须用**哨兵**（`DOCX_INDENT = '\u0000'`）占位，
   归一化后再还原成空格。
4. **相邻 run 的 markdown 标记首尾相撞**：`普通`+`**粗体**`+`*斜体*`+`***粗斜***` → 整行是
   `普通**粗体***斜体****粗斜***`（4 个星号）。逐 run 语义正确（`**` / `*` / `***`），**断言按实际输出写**。
5. **e2e 的 `send()` 必须带超时**（本轮沿用 90s），否则 Electron 掉线会把整轮回归挂死（phase4h 踩坑）。
6. **断言数按实际数写，别预估**（phase4i 预估 51 实际 53；本轮 e2e 实际 39）。
7. **上下文 160K 硬闸门**会拦 Bash（只放行 Write/Edit）→ 被拦时唯一正确动作：写 handoff 后开新会话。

---

## 7. 必读顺序

1. 本文件 §1（已确认设计，**勿重开**）· §3（测试证据）· §4（下一轮候选）· §6（踩坑）
2. `README.md` §5.39（本轮对外口径）
3. `task.md`「第三十五阶段」交付表 + 实证发现
4. 项目记忆 `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/ecclaw_phase4j_docx.md`
5. `electron/main/document-preview.ts` 的 `/* ---- DOCX 结构 ---- */` 区块（实现细节）

---

## 8. 提交与收尾清单

| 提交 | 内容 |
|---|---|
| `2065ecb` | `feat(document-preview): add DOCX structure fidelity`（6 files, +849/−17） |
| `__DOC_COMMIT__` | `docs: record phase 4j commit hash in handoff` —— 本次回填 |

已精确 `git add` 下列文件提交（**未用 `git add -A`**）：
`electron/main/document-preview.ts` · `README.md` · `task.md` ·
`handoff-ecclaw-phase4j-final-2026-11-06.md` · `handoff-ecclaw-phase4j-wip-2026-11-06.md` ·
`prompt-ecclaw-phase4j-next.md`

**未提交（禁入仓库）**：`openclaw.json` / `host-bridge.json` / `C:\Temp\ecclaw-verify\*` 全部临时资产。

收尾核对：

1. ✅ `pnpm typecheck` 无错
2. ✅ `pnpm build`（electron-vite 三段）全过
3. ✅ 秒级自测 **30/30**
4. ✅ e2e **39/39**
5. ✅ 全量回归 run68 二十二套 **720/720**（摘要 `run68-summary.txt`；未跑真站 phase3s/3q）
6. ✅ README §5.39 + 底部能力清单；task.md 第三十五阶段表 + 顶部状态段；
   项目记忆 `ecclaw_phase4j_docx.md` + `MEMORY.md` 索引
7. ✅ `prompt-ecclaw-phase4j-next.md`（<30 行，只做接力指针）
8. ✅ **git commit** —— feat + docs 回填 hash（**不 amend**）

