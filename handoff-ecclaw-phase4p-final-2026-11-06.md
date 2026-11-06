# handoff · ecclaw phase4p FINAL（PDF 链接 / 注释 / 表单域 / 元数据）· 2026-11-06

## 状态：已收官

- 功能提交 **`7001922`** `feat(document-preview): add PDF links, annotations, form fields and metadata`
- 本轮收尾提交：README §5.45 + 底部能力清单 · task.md（顶部状态 + 第四十一阶段）+ 本文件。
- 基线：上一阶段 phase4o = `d00268b`；本轮只改 `electron/main/document-preview.ts`（+131 / −3）。
- 契约 / `host-bridge.ts` / `host-server.mjs` / `src/App.tsx` 未动；**MCP 工具数仍 27**；无新增依赖。

## 交付内容（10 项）

PDF 预览此前只抽正文，本轮补齐：

- 外部链接 `[链接: URL]`
- 内部跳转 `[跳转: 第 N 页]`（解析不出 → `[跳转: 内部链接]`，不猜）
- 便笺注释 `[注释(作者): 正文]`（无作者 → `[注释: 正文]`）
- 表单域 `[表单: 字段名 = 已填值]`（无值 → `[表单: 字段名]`）
- 元数据置顶一行 `[文档信息] 标题 · 作者 · 主题 · 关键词 · 创建工具 · 生成器 · 创建时间 · 修改时间`
  （空字段逐个省略，全空不出行）

页后标记挂在**每页正文之后**；`getAnnotations` / `getMetadata` 均为**可选方法**（没有就跳过）。
**没有注释、没有元数据的 PDF 输出与改动前逐字一致**（回归红线）。
日期串 `D:20260101120000Z` → `2026-01-01 12:00:00`，认不出原样返回。

## 证据

- 秒级自测 `C:/Temp/ecclaw-verify/phase4p-selftest.cjs` → **18/18**
- e2e `C:/Temp/ecclaw-verify/phase4p-e2e.cjs` → **22/22**，日志 `run74-phase4p.log`
- 全量回归 `run74-summary.txt` → **二十八套 958 PASS / 1 FAIL**；
  唯一失败 phase3r C3 是**事件库 >2000 条 / 回放硬上限 2000**（`host-events.ts:409`）的既有环境问题，**非产品回归**。
  未跑真站 phase3s / phase3q（红线）。
- 探针：`phase4p-make.cjs` / `phase4p-probe.cjs` / `probe4p/`（19 fixture · 51 探针串 · 3 控制组全绿）。

## 下一轮

按 `handoff-ecclaw-phase4p-pdf-2026-11-06.md` §4 的排期做剩下四组：

**C（docProps 扩展）→ D+F（DOCX）→ E（XLSX）→ B（图表）**

- 候选清单已过期 8 次：**开打前先探针复验 + 扫新轴**，别照抄。
- 真缺口（探针实测）：C 组 app.xml / custom.xml（三格式各 6）；D 组 DOCX 尾注 1 + 图片 alt 3；
  F 组 DOCX 批注回复 1；E 组 XLSX 定义名称 2 / 数据有效性 1 / 表格对象 1 / 线程批注 2；
  B 组三格式图表各 2。
- 已证伪：DOCX 文本框、PPTX 新版批注回复正文 —— 别再选。
- 产品改动仍只落 `electron/main/document-preview.ts`；工具数保持 27。

## 避坑

1. 手搓 PDF fixture：catalog=1 / pages=2 / page=3 / font=4 / content=5，**注释从 6 开始**。
2. PDF 中文串按 **UTF-16BE + BOM** 写十六进制串；`latin1` 会乱码。
3. 表单域必须带 `/AcroForm`，否则 pdfjs 不认 Widget。
4. pdfjs 注释正文在 `contentsObj.str`、作者在 `titleObj.str`（不是 `contents` / `title`）。

## 相关

`handoff-ecclaw-phase4p-pdf-2026-11-06.md`（本轮 WIP 详细记录）·
`handoff-ecclaw-phase4o-final-2026-11-06.md`（上一轮 FINAL）·
项目记忆 `ecclaw_phase4p_pdf.md`。