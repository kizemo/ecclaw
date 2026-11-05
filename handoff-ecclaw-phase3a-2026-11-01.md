# handoff — ecclaw 第三阶段必做 1 收口（能力目录喂给 Agent · 路线 A）

> 权威背景仍看 `handoff-ecclaw-phase2-2026-11-01.md`（项目背景/协议/边界/避坑全在里面）。
> 本文件只记第三阶段必做 1 的增量与下一步。

## 1. 本次交付（已完成并验证）

**必做 1 路线 A：把 643 项平台包能力目录写成 openclaw 托管技能。**

| # | 交付项 | 证据 |
|---|---|---|
| 1 | `electron/main/package-skills.ts`（新建）：`syncPackageSkills()` 对每个已安装包渲染 `<stateDir>/skills/<packageId>/SKILL.md` | 真机 17 包全部生成，能力合计 **643**（与第二阶段基线一致），0 失败 |
| 2 | 接线：`packages:sync-skills` IPC → preload `packages.syncSkills()` → `PackagesView`「生成 Agent 技能」按钮 + 结果提示 | NODE_OK / WEB_OK / `pnpm build` ✓ |
| 3 | `paths.managedSkillsDir()` 支持 `ECCLAW_SKILLS_DIR` 覆盖（对齐 `ECCLAW_PACKAGES_DIR` 模式） | 验证写入 `C:/Temp/ecclaw-verify/skills-out/`，未碰 dabi 真实状态根 |

SKILL.md 结构：frontmatter `name`/`description`（显示名+站点匹配+能力计数）；正文含
使用边界（只给知识、不执行动作）/ 站点匹配 / 页面→动作能力 id（关联 manifest path/type）/
观察器 / 数据查询 / 工具清单 / 文档指针 / 随包 docs 拷贝（若有）/ 探测提示。

## 2. 改动清单（工作区文件，无 git）

| 文件 | 改动 |
|---|---|
| `electron/main/package-skills.ts` | **新建**（渲染 + 同步逻辑） |
| `electron/main/paths.ts` | `managedSkillsDir()` 加 `ECCLAW_SKILLS_DIR` 覆盖 |
| `electron/shared/types.ts` | 新增 `PlatformPackageSkillSyncResult`；`EcclawApi.packages.syncSkills()` |
| `electron/main/index.ts` | 注册 `ipcMain.handle('packages:sync-skills', …)` |
| `electron/preload/index.ts` | 暴露 `packages.syncSkills()` |
| `src/api.ts` | 重导出 `PlatformPackageSkillSyncResult` |
| `src/App.tsx` | `PackagesView` 加按钮/结果提示 |
| `README.md` | §5 新增 5.5「能力目录喂给 Agent」，原 5.5 顺延为 5.6 |
| `task.md` | 补第三阶段必做 1 条目 + 2 条新实证发现 |
| `C:/Temp/ecclaw-verify/skills-driver.cjs` | **新建**验证驱动（勿删） |

## 3. 新实证发现（写进了 task.md）

1. **真实 dabi 安装包内 0 个 `.md`** —— `manifest.pages[].docs`（如 `docs/tx/taobao/product-detail.md`）
   未随包分发。→ SKILL.md 的「适用场景」只能由 manifest 页面元数据 + 能力 id 清单构成。
2. **真实动作能力 id 是点分形**（`taobao.product.downloadInfo`、`taobao.product.collectReviews`）；
   此前静态字符串里的连字符形（`taobao-search-price-ranges`）混有页面/选择器 id。以运行时探测为准。

## 4. 验证方法（不启 Electron）

```bash
cd F:/soft/00selfmade/ecclaw
npx tsc electron/main/package-skills.ts electron/main/platform-packages.ts \
  electron/main/platform-runtime.ts electron/main/paths.ts electron/shared/types.ts \
  --outDir C:/Temp/ecclaw-verify/lib2 --module commonjs --target es2022 \
  --moduleResolution node --esModuleInterop --skipLibCheck
cd C:/Temp/ecclaw-verify && node skills-driver.cjs
# → {"total":17,"ok":17,"capSum":643} + 每包一行
```

GUI 验证（可选）：`pnpm dev` → 「平台包 → 生成 Agent 技能」→「技能」页应出现 17 个托管技能。
注意改主进程后必须重启 dev；停 dev 后 `taskkill //IM electron.exe //T //F` 清残留。

## 5. 下一步（第三阶段剩余）

- **必做 2：接真 Provider 跑通端到端对话**（本地 Ollama 或云端 key；验收 =
  `openclaw agent --local` 完成一轮真实对话；配套 `setDefaultModel` 独立 IPC/UI 入口）。
  生成技能后正好用它验证「模型能看到能力目录」。
- 候选 3：内嵌浏览器宿主（动作执行硬前提，成本最高；线索 = dabi 侧栏内置 tesseract OCR）。
- 候选 4：远程包仓库（`current.json` 已预留；dabi `taobao-launch-packages` 线索见 phase2 handoff §9）。
- MCP stdio 路线（必做 1 的备选 B）未做：托管技能路线已满足「模型知道有能力」，
  若将来要「模型直接调用查询类能力」再走 `mcp.servers` stdio。

## 6. 红线与避坑（沿用，勿违）

- 不重做逆向（REA 已结案）；不改已定案的平台包协议；不删 `C:/Temp/rea-dabi`、`C:/Temp/ecclaw-verify`。
- 能力探测缓存按 `包id@版本`，改探测逻辑须重启进程；`ELECTRON_RUN_AS_NODE=1` 必带。
- 禁止删除用户文件（全局红线）；临时产物写 `C:/Temp/`。
- 项目不是 git 仓库，不要 init/commit。
