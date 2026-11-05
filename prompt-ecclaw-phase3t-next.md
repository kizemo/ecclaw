# 下一阶段接力 prompt · ecclaw 第二十阶段（承 phase3t 收官）

## 承接
- 上一阶段 handoff：`F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3t-final-2026-11-03.md`（**先读它**）
- 架构/复现/红线权威：`handoff-ecclaw-phase3r-final-2026-11-03.md` §0/§6/§10
- 上上阶段：`handoff-ecclaw-phase3s-final-2026-11-03.md`

## 基线（第十九阶段 = phase3t）
- 范围：`kind:'page'` 事件补产生点 + 导出物面板归类视图（候选 D）
- 产品改动：**主进程 1 处**（`electron/main/browser-host.ts` 的 `open()` 落 page 事件）
  + **渲染层 1 处**（`src/views/HostEvents.tsx`：page 摘要 + 归类视图）→ **零契约改动，工具数仍 26**
- e2e：`C:\Temp\ecclaw-verify\phase3t-e2e.cjs` **16/16 全绿**（实测）
- 回归：**八套实测全绿** —— phase3t 16 · phase3s 49 · phase3r 31 · phase3q 26 ·
  phase3p 45 · phase3o 44 · phase3m 69 · sse 14（FAIL 全 0）；
  驱动 `C:\Temp\ecclaw-verify\rerun-and-regress4.cjs`，产物前缀 **`run51-*`**，
  摘要 `C:\Temp\ecclaw-verify\run51-summary.txt`（数字**逐条取自该摘要**，非预期值）

## 必交付（第二十阶段开工前）
1. 下一轮回归**换新前缀 `run52-*`**（并同步改驱动里的产物名）→ 别覆盖已核过的 run51 证据；
   收官时仍以 `run52-summary.txt` 实测值为准，别拿预期值当实测值
   （第十八阶段栽过：引的 `run49-*` 其实是「环境全灭」那轮）
2. 用 AskUserQuestion 拍板第二十阶段范围（**超时自动选中 ≠ 批准**，但候选均不含真站写操作时合规照做）
3. 收尾：`node C:/Temp/ecclaw-verify/stop-electron.cjs` + 按**精确 PID** 停 8898/8897 夹具（禁通配符）

## 候选（供 AskUserQuestion）
- **A. 真实站点 click 类写操作闭环**：需另找不会下单的页面（淘宝点一下可能下单）→ 含真站写操作，**必须重新确认**
- **C. 第二阶段外壳**：远程包仓库灰度发布 / 邮件 worker / 画布宿主 / PDF·Docx·Pptx·PSD 预览 /
  OCR / 社媒自动化脚本执行器 / 数据迁移框架（团队·账号·计费·遥测刻意不做）
- **卡片收定时器尾巴**（phase3s §4）：visibilitychange 立即清扫 / 每卡独立 setTimeout(12s) /
  评估 `backgroundThrottling:false` —— 已定性「当前工作正常、无 bug」，属预防性收紧；
  动 `App.tsx` 需 `pnpm typecheck && pnpm build` 后**重启 Electron**
- **本阶段新尾巴（可选）**：page 事件目前只有 `action:'open'`，可扩 navigate / close
  （`did-navigate` / `close()`）—— **会产生噪声，谨慎**

## 红线（照旧，全量见 phase3r final §10）
禁删用户文件（exports 只增不删）；禁 `git init`/`git commit`；密钥/token 不外传（只以指纹）；
**真实站点只用 `scroll` 做写操作验证**；GUI 走 CDP（不用 computer-use）；
临时产物写 `C:\Temp\`；handoff/task 文档不得放进 memory 文件夹；
Electron 内 spawn 必须带 `ELECTRON_RUN_AS_NODE=1`；改 main 代码必须重启 Electron；
无人值守 e2e 跑期间**提醒用户勿碰 GUI 卡片**。
