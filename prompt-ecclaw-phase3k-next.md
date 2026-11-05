# prompt · ecclaw 第十二阶段（phase3l）· 承接 phase3k

> 一句话：读 `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3k-2026-11-02.md`（第十一阶段收官，含下一阶段必交付与红线），
> 再按需查 `F:\soft\00selfmade\ecclaw\docs\ecclaw-事件汇总与落盘保留策略-2026-11-02.md`、
> `F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase3j-2026-11-02.md`、`F:\soft\00selfmade\ecclaw\handoff-ecclaw-phase2-2026-11-01.md`，
> 然后推进 handoff §7 的必交付项，收尾写 `handoff-ecclaw-phase3l-2026-11-02.md` + `prompt-ecclaw-phase3l-next.md`。

## 背景（读完 handoff 就够，这里只给定位）

项目 `F:\soft\00selfmade\ecclaw` = 基于 OpenClaw 的电商 AI 桌面端（**不是 git 仓库**）；
第十一阶段刚收官（事件汇总工具 + 落盘保留策略，真机 22/22，MCP 工具 **18** 个）；阶段编号 phase3a→phase3k 已完成，本轮 **phase3l**。

## 基线

- 启动 Electron：`powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"`
- **Electron 可能还在跑**（CDP 9222）：先 `node C:/Temp/ecclaw-verify/stop-electron.cjs` 或杀干净再重启。
- GUI 验证走 **CDP**，**不要用 computer-use**；改 MCP 工具后**必须重启 Electron**（`<stateDir>/mcp/` 是副本）。

## 禁止事项

不重做逆向 · 不改平台包协议（`runtime.cjs` 一律子进程加载）· 不删 `C:/Temp/rea-dabi` 与 `C:/Temp/ecclaw-verify` ·
禁止删除用户文件 · 不 git init/commit · relay key 勿外传 · 宿主页面 sandbox + contextIsolation + nodeIntegration=false ·
临时产物写 `C:/Temp/` · Electron 内 spawn 带 `ELECTRON_RUN_AS_NODE=1` · 护栏默认保持 `ask` ·
别去掉 partition 的 `persist:` 前缀 · 真机验证脚本会污染日志目录，测完要清理。

## 收尾

更新 `task.md`（新增第十二阶段小节，保持倒序）与 `README.md`（§5.9 工具数、§8 状态），
必要时补 `docs/` 与记忆目录 `E:/Users/Duanyi/.claude/projects/F--soft-00selfmade-ecclaw/memory/`。
