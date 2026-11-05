# prompt · ecclaw 第十一阶段（phase3k）· 承接 phase3j

> 承接：`handoff-ecclaw-phase3j-2026-11-02.md`（第十阶段收官 · 真机已验 15/15 + 12/12）
> 权威背景：`handoff-ecclaw-phase2-2026-11-01.md`；细节看 `docs/ecclaw-护栏中间档与事件落盘-2026-11-02.md`

## 基线

- 第十阶段已全部完成并验证：护栏四档 scope（once/session/persistent/persistent-scroll）、
  白名单粒度 `match×ops×ttl`、事件按天 JSONL 落盘 + `ecclaw_event_replay`（MCP 工具 **17** 个）、
  宿主 partition `persist:ecclaw-host`（登录态跨重启保留）。
- **Electron 当前没在跑**；启动必须用：
  `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"`
- settings：`hostWriteGuard=ask`、`hostWriteGuardAllowlist=[]`（干净基线）。
- fixture：8897 写操作页（含 `/api/writer/stats`、`/set-probe`、`/api/writer/probe`）、8898 只读页。
- GUI 验证走 CDP 9222，**不要用 computer-use**；重启 Electron 前先把旧实例杀干净。

## 必交付（按优先级）

1. **真实站点登录态闭环**（需用户本人账号，写操作风险自负）：先只读复验淘宝，再在真实站点上
   走一遍护栏（建议先 `session`）；amazon 已知是 AWS WAF 挑战页，不必重试。
2. **事件落盘后续**：给 agent 一个「按 packageId 汇总」视图；清理策略细化（现在按天 + 14 天）。
3. **护栏后续**：白名单是否要「精确路径」维度；`session` 规则是否要单独可视化。

## 禁止事项

不重做逆向 · 不改平台包协议（`runtime.cjs` 一律子进程加载）· 不删 `C:/Temp/rea-dabi`
与 `C:/Temp/ecclaw-verify` · 禁止删除用户文件 · 不 git init/commit · relay key 勿外传 ·
宿主页面 sandbox + contextIsolation + nodeIntegration=false · 临时产物写 `C:/Temp/` ·
Electron 内 spawn 带 `ELECTRON_RUN_AS_NODE=1` · 护栏默认保持 `ask` ·
别去掉 partition 的 `persist:` 前缀。

## 收尾

写 `handoff-ecclaw-phase3k-2026-11-02.md` + `prompt-ecclaw-phase3k-next.md`，
并更新 `task.md`（新增第十一阶段小节，保持倒序）+ `README.md`（§5.9 工具数、§8 状态）。
