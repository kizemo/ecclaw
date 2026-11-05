# prompt · ecclaw 第二十二阶段接力（2026-11-03）

承接：`F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3v-final-2026-11-03.md`（第二十一阶段收官）
再往前的权威文档：`handoff-ecclaw-phase3u-final-2026-11-03.md`、`handoff-ecclaw-phase3r-final-2026-11-03.md` §0/§6/§10

## 基线（已实测，勿改）
- 工具面 **27**（新增只读 `ecclaw_document_preview`）；MCP 工具数断言在 9 个老 e2e 脚本里已是 27
- 回归 `run53-*` 八套全绿：phase3v 29 · phase3u 24 · phase3t 16 · phase3r 31 · phase3p 45 · phase3o 44 · phase3m 69 · sse 14
  （**真站套件 phase3s / phase3q 未跑** —— 红线不碰淘宝）
- 摘要文件：`C:\Temp\ecclaw-verify\run53-summary.txt`（收官数字只认它）
- 新依赖 `pdfjs-dist@6.5.438` 已在 `package.json`；主进程用 `createRequire` + Node 24 `require(ESM)` 加载

## 本轮必做
1. 用 **AskUserQuestion** 拍板下一阶段范围（候选见下），**自动选中 ≠ 批准**；含真站写操作/外发副作用的方向必须显式确认。
2. 实现选定范围 + 写 `phase3w-e2e.cjs`（自带夹具、断言全绿、**界面断言用轮询不用固定 sleep**）。
3. 回归换前缀 **`run54-*`**（同步改驱动 `rerun-and-regress6.cjs` 的产物名），收官数字只引用 `run54-summary.txt`。
4. 更新 `task.md`（顶部状态段 + 新阶段表 + 实证发现）、README（新小节 + §8 状态段）、项目记忆 `memory/` + `MEMORY.md` 索引。
5. 收尾：`node C:/Temp/ecclaw-verify/stop-electron.cjs` + 按**精确 PID** 停夹具 8898/8897（禁通配符）；写收官 handoff + 下一阶段 prompt。

## 候选（待拍板）
- **C-2 续作**：PDF **位图**预览（需 `@napi-rs/canvas` 原生依赖或改走外部查看器）· Docx / Pptx / Xlsx 抽取
- **C-3 邮件 worker**（含外发副作用 → 必须显式确认账号与收件人）
- **C-4 画布宿主**（新的宿主页面类型 + 会引入新事件 kind）
- **OCR**（图片转文字；依赖体积大）
- **数据迁移框架**（导入导出 + 版本化）
- **补跑真站套件**（phase3s / phase3q，须先问过淘宝）

## 禁止
- 真站写操作（未获批准前一律不碰淘宝）· 禁 git · 禁删用户文件（文件库里 `ecclaw-phase3v-*` 是 e2e 写的，**留着别删**）
- 密钥（`openclaw.json` relay key / `host-bridge.json` token）勿外传
- 临时产物写 `C:\Temp\`；**handoff / task 文档不得放进 `memory/`**
- GUI 验证走 **CDP**（`--remote-debugging-port=9222`），不用 computer-use
- 无人值守 e2e 期间提醒用户勿碰 GUI 卡片
