承接：handoff-ecclaw-phase4j-final-2026-11-06.md（第三十五阶段收官 · DOCX 结构保真）

基线：HEAD = a817300（docs 回填）/ 2065ecb（feat）；工作区应干净。
工具数 27；stateDir C:\Users\Duanyi\AppData\Roaming\ecclaw\openclaw\.openclaw。

本轮选哪个候选：**PPTX 表格 + 演讲者备注**（handoff §4 候选 1；探针已实测，勿重做）——
  表格被摊平成独立行 → 列关系丢失；notesSlide 未读 → 备注丢失。
  备选：XLSX `expression` 条件格式（真缺口、价值中）。

本轮变化 / 期限约束：
- 无新期限；沿用红线：不跑真站 phase3s / phase3q（不碰淘宝）。
- 回归用新前缀 run69-*（phase4j 用的是 run68，别覆盖）。
- 提交只 git add 精确文件，禁 git add -A；openclaw.json / host-bridge.json 不得提交。

必做（详见 handoff §2/§3/§4/§6）：
1) 探针先行：候选清单会过期（已两次印证）→ 先实测再选题
2) 改 electron/main/document-preview.ts（产品改动只此一文件）
3) 秒级自测 + e2e（e2e 的 send() 必须带超时；断言数按实际数写）
4) 全量回归二十二套 run69
5) 收尾 README §5.40 / task.md / 项目记忆 / handoff-final / prompt → 精确提交

必读：handoff §1（已确认设计）· §4（下一轮候选）· §6（踩坑）。
