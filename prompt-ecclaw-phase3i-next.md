# prompt · 下一阶段（承接 phase3i）

承接：`handoff-ecclaw-phase3i-2026-11-02.md`（第九阶段收官：两段式确认 + 站点白名单 + poll 持续刷新）
基线：第八阶段 `handoff-ecclaw-phase3h-2026-11-02.md`；权威背景 `handoff-ecclaw-phase2-2026-11-01.md`

## 必交付（按优先级）

1. **真实站点登录态复验**（需用户自己的登录态；写操作风险自负）：
   - 只读先行：`ecclaw_open_page` + `ecclaw_read_dom` / `ecclaw_run_extract` 在真实站点跑通；
   - 已知：淘宝只读正常；**亚马逊返回 AWS WAF 挑战页**（反爬，非宿主 bug）；
   - 再考虑写操作闭环（登录态下点搜索 / 加购），先跟用户确认风险。
2. **白名单的更多形态**：目前只有「本站点全放行」，可加「本页一次」「只放行只读操作」等中间档。
3. **事件持久化 / 回放**：`electron/main/host-events.ts` 目前是进程内环形缓冲（200 条），崩了即丢。

## 环境

- 启动 Electron（**必须**用脚本，后台 bash 任务方式会被回收）：
  `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Temp\ecclaw-verify\start-electron.ps1"`
- 宿主桥端口每次随机，端点文件：`C:/Users/Duanyi/AppData/Roaming/ecclaw/openclaw/.openclaw/host-bridge.json`
- fixture：8897 写操作页（服务端计数 `/api/writer/stats`）、8898 只读页（`/demo`）；**先 netstat 确认在监听**
- GUI 验证走 **CDP**（`/json/list` 选 `out/renderer/index.html` 的 target），**不要用 computer-use**
- `host:read-dom` 会重开 URL → 验证页面变化用 fixture 服务端计数

## 禁止事项

- 不重做逆向；不改平台包协议（`runtime.cjs` 一律子进程加载）
- 不删 `C:/Temp/rea-dabi`、`C:/Temp/ecclaw-verify`；临时产物写 `C:/Temp/`
- 不 git init / commit；openclaw.json 含明文 relay key，勿外传
- 护栏策略默认保持 `ask`；测试白名单残留 `127.0.0.1`，需要干净状态就清空 `hostWriteGuardAllowlist`

## 收尾

改完先 `pnpm typecheck && pnpm build`，再真机验证，然后更新
`task.md`（新增阶段小节，插在最新阶段之前，保持倒序）、`README.md`（§5.9 工具数、§8 状态）、
`memory/ecclaw_host_contract.md`，最后写 `handoff-<phase>-<date>.md` + `prompt-<phase>-next.md`（<30 行）。
