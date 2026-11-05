# prompt — ecclaw 下一轮（承接 phase3g）

承接 `handoff-ecclaw-phase3g-2026-11-02.md`（第七阶段收官：宿主写操作）。
权威背景仍看 `handoff-ecclaw-phase2-2026-11-01.md`。

基线状态（**勿重做**）：
- 第三/四/五阶段：托管技能 18 包、真 Provider 端到端、远程包仓库、内嵌浏览器宿主四通道
- 第六阶段：宿主接进 openclaw MCP 服务（`ecclaw-host`），agent 可直接调 8 个 `ecclaw_*` 工具
- 第七阶段：**写操作已落地** —— `browser.click` / `scroll` / `interceptNext` / `waitForNavigation`
  （可见走真实鼠标/滚轮手势，隐藏走 DOM 事件；示例包 `ecclaw-writer-demo` 8/8 全绿）

本轮候选（**任选或组合，勿全铺**）：
1. **真实站点复验写操作**：用真实 dabi 包（taobao 的 `performInteraction`→click+waitForNavigation、
   amazon 的 search 分页）打一次真站点，验证真实鼠标路径在登录态页面上也成立。
2. **写操作护栏 + 直接工具面**：把 `host-bridge` 的 click/scroll 暴露成 MCP 工具
   （`ecclaw_click` / `ecclaw_scroll`），并加 agent 写操作前的确认机制。
3. **poll 持续刷新**：当前 poll 只触发一次，dabi 是持续刷新（侧栏联动），可加订阅式形态。
4. **UI 暴露宿主桥状态**：把 `host:bridge-status` 接到 UI（宿主桥就绪 / MCP 已注册）。
5. **真实站点复验 observe**：doudian-compass 的 `urlIncludes:["/compass_api/shop/common/homepage/"]`。

约束（红线，勿违）：
- 不重做逆向（REA 已结案）；不改已定案的平台包协议；`runtime.cjs` 一律子进程加载
- 不删 `C:/Temp/rea-dabi`、`C:/Temp/ecclaw-verify`；不删任何用户文件；临时产物写 `C:/Temp/`
- 项目非 git 仓库 → 不 `git init` / 不 commit
- `openclaw.json` 含明文 relay key → 勿外传；relay 对话保持最小
- Electron 内 spawn 必带 `ELECTRON_RUN_AS_NODE=1`；宿主页面 sandbox + contextIsolation + nodeIntegration=false
- 宿主桥 token（`host-bridge.json`）不外传
- 写操作是「替用户操作页面」：接 agent 直连前先做确认护栏

验证配方（照抄 phase3g §4）：
```bash
cd F:/soft/00selfmade/ecclaw && pnpm build && pnpm typecheck
ECCLAW_LOCAL_PACKAGES_DIR="C:/Users/Duanyi/AppData/Roaming/com.dabiai.desktop/platform-packages" \
  npx electron . --remote-debugging-port=9222
cd C:/Temp/ecclaw-verify && node fixture-writer.cjs      # 8897（8899 被占）
node C:/Temp/ecclaw-verify/bridge-rpc.cjs action \
  '{"packageId":"ecclaw-writer-demo","capability":"ecclaw-writer-demo.click","url":"http://127.0.0.1:8897/writer"}'
node C:/Temp/ecclaw-verify/cdp-viewport.cjs 0 0 900 600   # 可见（真实鼠标路径）；hide 还原
```
坑：CDP 多 target 按 `index\.html$` 选主应用；8898/8899 常被占；隐藏 widget 不收 CDP 输入事件。

收尾：更新 `task.md` + README + 相关 docs，并写 `handoff-ecclaw-phase3h-<date>.md` 与
`prompt-ecclaw-phase3h-next.md`（<30 行）。
