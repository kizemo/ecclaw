# handoff · ecclaw 第三十六阶段（phase4k）· 收官 · 2026-11-06

> **一句话状态**：PPTX 结构保真（表格列关系 + 演讲者备注 + 图片 alt）**三项全做完** ✅；
> 秒级自测 **27/27** · e2e **35/35** · **全量回归 run69 二十三套 755/755 全绿** ✅；
> README §5.40 / task.md / 项目记忆 / 收尾文档 **已补齐**，提交见 §2。

---

## 1. 本轮做成了什么

**选题**：承接 phase4j handoff §4 候选 1（**PPTX 表格 + 演讲者备注**）——
该候选的探针**上一轮已实测确认**（§5.27 起 PPTX 只抽扁平纯文本，表格列关系 / 备注 / alt 全丢），
故本轮**不重做探针**，直接做；`expression` 条件格式留作下一轮候选（价值中）。

**已确认设计（用户逐项确认，勿重开）**：

| 项 | 决定 |
|---|---|
| 范围 | 表格 + 演讲者备注 + 图片 alt（三项全做；**不含**标题 `#` 标记 / 列表缩进 / 单元格粗斜体） |
| 表格输出 | **Markdown 管道表**（首行表头 + `\| --- \|` 分隔行，缺列补空，复用 `markdownCell()`） |
| 备注落位 | **页内末尾 `[备注] …`**（每页幻灯片正文之后） |
| 合并单元格 | **同 DOCX 口径**：gridSpan 首格放内容、其余补空；纵向合并（rowSpan/hMerge/vMerge）内容留起始行、续格补空 |

**范围约束**：只改 `electron/main/document-preview.ts`；契约 / `host-bridge.ts` / `host-server.mjs` / `src/App.tsx` 不动
→ **MCP 工具数仍 27**，无新增依赖。

---

## 2. 改动清单

| 文件 | 改动 |
|---|---|
| `electron/main/document-preview.ts` | **唯一产品改动**：① `docxChildElements` 抽成通用 `xmlChildElements(content, containerTags, wanted)`，`DocxElement` 更名 `XmlElement` 并加 `open` 字段（开始标签原文，用来读属性）；DOCX 版仍走原容器标签，行为逐字不变。② 新增 PPTX 结构区块：`PPTX_CONTAINER_TAGS` / `PPTX_SLIDE_RELS_RE` / `PPTX_NOTES_RE` / `PPTX_SKIP_PLACEHOLDERS` / `PptxParts` / `pptxShapeLines` / `pptxPlaceholderType` / `pptxPictureAlt` / `pptxCellText` / `pptxCellGridSpan` / `pptxTableMarkdown` / `pptxNotesText` / `pptxSpTreeBody` / `pptxTreeBlocks` / `pptxSlideBlocks` / `relTargetByType` / `readPptxParts`。③ `extractPptxText` 重写：按放映顺序输出 `[幻灯片 N]` + 形状文字 + 表格 Markdown + `[图片: alt]`，页内末尾挂 `[备注] …`；删除旧的 `pptxSlideText` |
| `README.md` | 新增 **§5.40**；底部能力清单加一条（指 §5.40） |
| `task.md` | 顶部状态段加第三十六阶段；新增「第三十六阶段」交付表 + 实证发现 8 条 |
| `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/ecclaw_phase4k_pptx.md` | 项目记忆（新建）+ `MEMORY.md` 索引加一行 |
| `handoff-ecclaw-phase4k-final-2026-11-06.md` | 本文件（收官版） |
| `prompt-ecclaw-phase4k-next.md` | 下一轮接力指针（<30 行） |

**临时资产**（`C:\Temp\ecclaw-verify\`，**不进仓库**）：
`make-phase4k-fixtures.cjs`（→ `struct4k.pptx`，5328 B）· `probe-4k.cjs` · `dbg-4k.cjs`（可删）·
`phase4k-selftest.cjs` · `phase4k-e2e.cjs` · `rerun-and-regress21.cjs`（run69 驱动）。

---

## 3. 测试证据

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 通过 |
| `pnpm build`（electron-vite 三段） | ✅ 通过（out/main/index.js 重建，已 grep 确认含新代码） |
| 秒级自测 `phase4k-selftest.cjs` | **27/27**（16 行整行相等 + 行数 + kind + error + 8 条负向断言） |
| e2e `phase4k-e2e.cjs` | **35/35**（工具面 3 · 抽取 19 · 负向 8 · 界面 5），产物 `run69-phase4k.log` |
| 交叉复验 `phase4j-selftest.cjs` | **30/30**（证明扫描器通用化没伤 DOCX） |
| 全量回归 **run69** | **二十三套 755/755 全绿**（FAIL 全 0），摘要 `run69-summary.txt` |

**run69 明细**：4k 35 · 4j 39 · 4i 53 · 4h 48 · 4g 30 · 4f 26 · 4e 21 · 4d 31 · 4c 26 · 4b 18 · 4a 20 ·
3z 37 · 3y 31 · 3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14
（**未跑真站 phase3s / phase3q —— 本阶段红线：不碰淘宝**）

**抽取实际输出**（夹具 `struct4k.pptx`）：

```
[幻灯片 1]
季度经营回顾
要点说明
| 季度 | 指标(合并两列) | |
| --- | --- | --- |
| Q1 | 营收 | 同比 |
| | 120 | +8% |
[图片: 营收趋势折线图]
[备注] 这页先讲整体营收,再看明细。 第二行备注

[幻灯片 2]
第二条要点
| 项目 | 数值 |
| --- | --- |
| 甲 | 1 |
[备注] 补充说明
```

---

## 4. 下一步必交付（第三十七阶段）

**下一轮候选**：

1. **XLSX `expression` 条件格式**（真缺口、价值中，已连续两轮留候选）：`$E5>40`、
   `MOD(ROW(),2)=0` 两条都不生效（`cellIs` 正常）；要接进 §5.36 的三趟式抽取（先算命中集合）。
2. **PPTX 剩余项**：幻灯片标题 `#` 标记、列表层级缩进、单元格粗斜体（本轮用户明确没选，可作下轮候选）。
3. 次要：XLSX 空白格（`containsBlanks` 真缺口，回归面大）；DOCX 超链接只留文字不留 URL；
   文本 `@` 剩余形状（价值低）。

**纪律（沿用）**：
- **候选清单会过期（已三次印证）** → 下一轮仍**先探针实测 + 扫新轴再选题**，别照抄本表。
- 回归用**新前缀**（phase4k 用的是 `run69-*`，下一轮用 `run70-*`），别覆盖旧产物。
- 提交只 `git add` **精确文件**（禁 `git add -A`）；`openclaw.json` / `host-bridge.json` / `C:\Temp\*` **不得提交**。
- 提交用 Conventional Commits，**不 amend**；feat 提交后再单独一条 docs 回填 hash。
- 红线：**不跑真站 phase3s / phase3q**（不碰淘宝）。
- **上下文 160K 硬闸门**仍会拦 Bash → 长文件读一次后只引用路径，别在写代码前堆上下文。

---

## 5. 环境 / 分支基线

- 项目根 `F:\soft\00selfmade\ecclaw`（git 仓库）；基线 HEAD = `a92fbc3`（phase4j docs 回填），
  上一 feat = `2065ecb`
- stateDir `C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw`；MCP 工具数 **27**（不变）；无新增依赖
- Electron 启动：`C:\Temp\ecclaw-verify\start-electron.ps1`（`npx electron . --remote-debugging-port=9222`，
  工作目录 `F:\soft\00selfmade\ecclaw`）；e2e 走 CDP 9222
- 回归驱动：`C:\Temp\ecclaw-verify\rerun-and-regress21.cjs`（run69 驱动，23 套，每套前 ensureEnv）
- **主进程代码改动后必须重启 Electron**（9222 只占一个实例，先 `taskkill //F //IM electron.exe` 再启）

---

## 6. 本轮踩坑（别再踩）

1. **`PPTX_CONTAINER_TAGS` 不能含 `p:sld`**：`p:sld` 是最外层包装，跟踪它会让 `<p:cSld>` 落在**深度 1**
   → `xmlChildElements` 只在「栈空」时收节点 → 直接子级扫描**全空且不报错**（最难查的一类）。
2. **单元格文字体是 `a:txBody`（不是 `p:txBody`）** → 容器标签表必须**同时**含 `p:txBody` 与 `a:txBody`；
   否则表格全空而形状文字正常（症状分裂，易误判）。
3. **属性只能从开始标签读**：`gridSpan` 挂在 `<a:tc gridSpan="2">` 上、**不在 body 里**
   → `XmlElement` 加 `open` 字段存开始标签原文。
4. **备注要按 slide 自己的 rels 找**：`notesSlide` 编号与 slide 编号**不一定对得上**
   → 按 rels 里 `Type` 以 `notesSlide` 结尾匹配 + `resolveRelTarget()` 拼路径，**不能按编号猜**。
5. **占位符不降噪就漏出页码**：`<a:fld><a:t>2</a:t>` 是域代码不是正文
   → `sldNum` / `dt` / `hdrFtr` / `ftr` 四类 `p:ph@type` 整页跳过。
6. **`p:sp` 在 `p:grpSp` 内**要靠 `p:grpSp` 被跟踪才不会误判为 spTree 直接子级 → 容器标签表要含 `p:grpSp`。
7. **通用化扫描器是复利**：`docxChildElements` → `xmlChildElements` 只多一个参数，
   DOCX 行为逐字不变（selftest 30/30 复验）→ **不要为第二个格式复制一份扫描器**。
8. **调试断点靠复刻扫描器**：`dbg-4k.cjs` 复刻一份 `xmlChildElements` 逐步打印
   「cSld 几个 / spTree 几个 / 子形状标签列表」，比在产品代码里插日志快且不污染工作区。
9. **NFKC 归一化会改中文全角标点**：期望值里的「，」「。」在输出里是「,」「.」→ 断言按**实际输出**写。
10. **e2e 的 `send()` 必须带超时**（沿用 90s），否则 Electron 掉线会把整轮回归挂死。
11. **断言数按实际数写，别预估**（本轮预估 35、实测 35）。

---

## 7. 必读顺序

1. 本文件 §1（已确认设计，**勿重开**）· §3（测试证据）· §4（下一轮候选）· §6（踩坑）
2. `README.md` §5.40（本轮对外口径）
3. `task.md`「第三十六阶段」交付表 + 实证发现
4. 项目记忆 `~/.claude/projects/F--soft-00selfmade-ecclaw/memory/ecclaw_phase4k_pptx.md`
5. `electron/main/document-preview.ts` 的 `/* ---- PPTX 结构：表格 / 备注 / 图片 alt ---- */` 区块（实现细节）

---

## 8. 提交与收尾清单

| 提交 | 内容 |
|---|---|
| `__FEAT_COMMIT__` | `feat(document-preview): add PPTX table and notes fidelity` |
| `__DOC_COMMIT__` | `docs: record phase 4k commit hash in handoff` —— 本次回填 |

已精确 `git add` 下列文件提交（**未用 `git add -A`**）：
`electron/main/document-preview.ts` · `README.md` · `task.md` ·
`handoff-ecclaw-phase4k-final-2026-11-06.md` · `prompt-ecclaw-phase4k-next.md`

**未提交（禁入仓库）**：`openclaw.json` / `host-bridge.json` / `C:\Temp\ecclaw-verify\*` 全部临时资产；
`handoff-2026-11-06.md` 是 hook 生成的未跟踪占位文件，**不要动它**。

收尾核对：

1. ✅ `pnpm typecheck` 无错
2. ✅ `pnpm build`（electron-vite 三段）全过
3. ✅ 秒级自测 **27/27**
4. ✅ e2e **35/35**
5. ✅ 全量回归 run69 二十三套 **755/755**（摘要 `run69-summary.txt`；未跑真站 phase3s/3q）
6. ✅ README §5.40 + 底部能力清单；task.md 第三十六阶段表 + 顶部状态段；
   项目记忆 `ecclaw_phase4k_pptx.md` + `MEMORY.md` 索引
7. ✅ `prompt-ecclaw-phase4k-next.md`（<30 行，只做接力指针）
8. ✅ **git commit** —— feat + docs 回填 hash（**不 amend**）
