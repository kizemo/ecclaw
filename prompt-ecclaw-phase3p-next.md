# prompt · ecclaw 下一阶段（接 phase3p 收官）· 2026-11-03

## 承接

- 必读：`handoff-ecclaw-phase3p-final-2026-11-03.md`（收官摘要 / 改动清单 / 复现步骤 / 踩坑）
  → `handoff-ecclaw-phase3p-2026-11-03.md`（第十五阶段实现细节）
- 基线：项目根 `F:\soft\00selfmade\ecclaw`；第十五阶段**代码已全部写完且真机验证通过**
  （`phase3p-e2e.cjs` 45/45；回归 phase3o 44/44、phase3m 69/69、sse 14/14），文档也已补齐。

## 第一步（必做）

用 **AskUserQuestion** 让用户拍板下一阶段范围，候选见
`handoff-ecclaw-phase3p-final-2026-11-03.md` §7：

- A. **真实站点登录态下的写操作闭环复验**（淘宝等，需用户本人手动登录后用 `ecclaw_scroll` 触发护栏）
- B. 第二阶段外壳候选：远程包仓库灰度发布 / 邮件 worker / 画布宿主 / PDF·Docx·Pptx·PSD 预览 /
  OCR / 社媒自动化脚本执行器 / 数据迁移框架（团队·账号·计费·遥测本项目刻意不做）
- C. 本阶段小尾巴：profile 磁盘目录累积提示 / 切换店铺提示更醒目 / agent 侧建店入口

## 然后按六层交付

主进程 → 共享类型 → preload → 渲染层 → MCP → 文档；
每层跑 `pnpm typecheck`（两段 tsc）+ `pnpm build`；再用 **CDP**（`--remote-debugging-port=9222`）
写 e2e 脚本跑到全绿，最后补 README §5.20 / task.md / memory / 收官 handoff + next prompt。

## 环境

```bash
cd /f/soft/00selfmade/ecclaw
pnpm typecheck && pnpm build
cd /c/Temp/ecclaw-verify && node fixture-server.cjs &   # 8898
cd /c/Temp/ecclaw-verify && node fixture-writer.cjs &  # 8897（phase3m 回归依赖它）
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"
```

## 禁止事项

- 禁 `git init` / `git commit`（项目非 git 仓库）。
- 禁删用户文件：`<userData>/host-events/exports/`（**原 15 个一条没删**，本阶段 e2e 新增 2 个 → 现 17 个；e2e 每跑一轮会新增，属正常）、
  `<userData>/Partitions/ecclaw-profile-*`（用户登录数据，程序只删配置记录）。
- `openclaw.json`（明文 relay key）/ `host-bridge.json`（token）勿外传。
- Electron 内 spawn 内核/MCP 必须带 `ELECTRON_RUN_AS_NODE=1`；护栏默认 `ask`；别去掉 `persist:` 前缀。
- 真实站点只用 `scroll` 做写操作验证（click 可能下单）。
- 临时产物写 `C:\Temp\`；handoff / task 文档放项目根，**不放 memory 文件夹**。
- 断言不要挂在会过期的 cookie 上；cookie 夹具默认带 `Max-Age=86400`（session cookie 跨重启必丢）。
