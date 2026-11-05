# prompt — ecclaw 下一轮（候选 3：内嵌浏览器宿主）

承接：`handoff-ecclaw-phase3c-2026-11-02.md`（本轮增量）；权威背景看
`handoff-ecclaw-phase2-2026-11-01.md` + `handoff-ecclaw-phase3a/3b-2026-11-01.md`。

## 基线（已完成，勿重做）
- 必做 1：643 项能力 → 17 个托管技能落真实 stateDir，模型可见（实测点名 taobao/doudian 等）。
- 必做 2：真 Provider aliyun-maas/qwen3.8-max 端到端对话 ✓；`providers:set-default` IPC/UI ✓
  （2026-11-02 已补：切默认时同步 `providerMeta`，按钮态不再滞后）。
- 对话页信封显示缺陷已修（`gateway.ts` 的 `extractReply` 重写）。
- 候选 4：远程包仓库已上线（清单/下载/安全解包/校验/落盘/指针），单测 10/10 + GUI 端到端通过。

## 必交付（本轮）
1. **摸清 dabi 宿主契约**（不做 REA，直接读真实 runtime.cjs）：
   Grep `C:/Users/Duanyi/AppData/Roaming/com.dabiai.desktop/platform-packages/<pkg>/<ver>/runtime.cjs`
   里对 `context` 的依赖字段（webContents / tabId / url / executeJavaScript / …），
   产出一份字段清单（写进 `docs/`）。
2. **ecclaw 最小宿主原型**：Electron `BrowserWindow`/`WebContentsView` + 适配成 dabi 形状的
   `context` 层；先跑通**一条只读动作**（打开页面 → 读 DOM → 返回结果）。
3. 全程：`tsc -p tsconfig.node.json/web.json --noEmit` + `pnpm build` 通过；GUI 验证用 CDP 驱动。

## GUI 验证配方（computer-use 在本机不可用）
`pnpm build` → `npx electron . --remote-debugging-port=9222` → Node 26 内置 `WebSocket` 调
`Runtime.evaluate` 点按钮。脚本范例：`C:/Temp/ecclaw-verify/gui-driver.cjs`、`gui-repo.cjs`。

## 禁止事项
不重做逆向；不改已定案平台包协议；不删 `C:/Temp/rea-dabi`、`C:/Temp/ecclaw-verify`；
不自动删旧版本目录（红线）；不 git init/commit；relay 验收对话保持最小（一次约 17K tokens）；
openclaw.json 含明文 key 勿外传。

## 边界提醒
动作执行需要真实站点登录态，ecclaw **没有**店铺登录态 profile（明确不做）——
起步阶段只在无账号/本地场景验证。
