# handoff · ecclaw phase4q FINAL（docProps 扩展：app.xml + custom.xml）· 2026-11-06

## 状态：已收官

- 只改 `electron/main/document-preview.ts`；契约 / `host-bridge.ts` / `host-server.mjs` / `src/App.tsx` 未动；
  **MCP 工具数仍 27**；无新增依赖。
- 基线：phase4p = `7001922`；功能提交 **`c25e6a2`**。

## 交付内容

`docProps/core.xml` 之外，补齐同目录两部件：

- **`docProps/app.xml`**：`Application` / `Company` / `Pages` / `Words` 并入 core 的**同一行**
  `[文档信息] 标题 · 作者 · 修改人 · 修改时间 · 应用 · 公司 · 页数 · 字数`。
- **`docProps/custom.xml`**：`<property name="…">` → **单独一行**
  `[自定义属性] 名称: 值 · 名称: 值`，紧跟文档信息行。
- 空字段逐个省略、全空不出行；**没有 app/custom 的文档输出与改动前逐字一致**（回归红线）。
- 三格式共用同一套解析（部件路径相同）；按**本地名**匹配不硬编码 XML 前缀；
  XML 实体解码；`vt:vector` 多段值按 `A, B` 拼接；空名/空值跳过。
- PPTX 的 `<Slides>` 不输出（与实际页数重复）。

## 证据

- 秒级自测 `C:/Temp/ecclaw-verify/phase4q-selftest.cjs` → **23/23**
- e2e `C:/Temp/ecclaw-verify/phase4q-e2e.cjs` → **22/22**（`run75-phase4q.log`）
- 全量回归 `C:/Temp/ecclaw-verify/run75-summary.txt`（二十九套）；
  phase3r C3 仍为**事件库超 2000 条 / 回放硬上限 2000**（`host-events.ts:409`）的既有环境失败。
  未跑真站 phase3s / phase3q（红线）。
- 探针：b3/b6/b8 三格式 fixture 从 0/4 变全覆盖（`probe4p-result4.txt`）。

## 下一轮

按 `handoff-ecclaw-phase4p-pdf-2026-11-06.md` §4：**D+F（DOCX）→ E（XLSX）→ B（图表）**

- 候选清单已过期 8 次：**先探针复验 + 扫新轴**，别照抄。
- 真缺口：D 组 DOCX 尾注 / 图片 alt；F 组 DOCX 批注回复；
  E 组 XLSX 定义名称 / 数据有效性 / 表格对象 / 线程批注；B 组三格式图表。
- 已证伪：DOCX 文本框、PPTX 新版批注回复正文 —— 别再选。
- 产品改动仍只落 `document-preview.ts`；工具数保持 27。

## 避坑

1. `Application` 厂商串别写死（`Microsoft Office Word` vs `Microsoft Word`）。
2. custom.xml 值类型任意；先剥标签再解实体，vector 多段拼 `A, B`。
3. 给旧 fixture 补 app.xml 会改变既有断言，必须同步更新。

## 相关

`handoff-ecclaw-phase4p-final-2026-11-06.md` · `handoff-ecclaw-phase4o-final-2026-11-06.md` ·
项目记忆 `ecclaw_phase4q_docprops_ext.md`。