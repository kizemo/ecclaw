# task.md — ecclaw（基于 OpenClaw 的电商 AI 桌面端）

> 状态：2026-11-01 第一/二阶段已完成；第三阶段必做 1（能力目录→托管技能）、必做 2（真 Provider 端到端）已完成；
> 第四阶段（GUI 抽查 + 远程包仓库）已完成；第五阶段（候选 3 内嵌浏览器宿主）四通道全绿（数据查询/页面动作/页面提取/observe）；
> **第六阶段（宿主接进对话链路 · MCP）已完成：agent 可直接调用平台包能力**；
> **第七阶段（宿主写操作）已完成：`browser.click` / `scroll` / `interceptNext` / `waitForNavigation` 全部落地（可见/隐藏两条路径 8/8 全绿）**；
> **第八阶段（写操作护栏 + 直接工具面）已完成：ask/allow/deny 三档确认护栏 + MCP 工具 8→12 + UI 暴露宿主桥状态与护栏开关**；
> **第九阶段（两段式确认 + 护栏粒度 + 持续刷新）已完成：写操作票据化（`ecclaw_click` 立即返回 pending + `ecclaw_approval_status` 轮询）、站点白名单一次授权一批、poll 订阅式持续刷新（MCP 工具 12→16）**；
> **第十阶段（护栏中间档 + 事件落盘回放 + 登录态持久 partition）已完成并真机验证：信任范围四档（once/session/persistent/persistent-scroll）+ 白名单粒度 `match×ops×ttl`、事件按天 JSONL 落盘 + `ecclaw_event_replay`（MCP 16→17）、宿主 partition `persist:ecclaw-host`（重启后登录态保留）**；
> **第十一阶段（事件汇总 + 落盘保留策略细化）已完成并真机验证：`ecclaw_event_summary` 聚合工具（按平台包/类型/天，MCP 17→18）+ 界面「事件汇总」面板 + 单文件 8MB 滚动分片 + 目录 256MB 上限**；
> **第十二阶段（事件导出 + 信任规则可视化 + 白名单路径维度）已完成并真机验证：`ecclaw_event_export` / `ecclaw_guard_rules` / `ecclaw_guard_clear_session`（MCP 18→21）+ 界面「导出」面板 + 信任规则拆「本次会话 / 永久」两行 + 第五档信任范围 `persistent-path`（白名单第三维 path）**；
> **第十三阶段（压缩归档 + 时间序列趋势 + 护栏粒度 + 事件推送通道）①②③ 已完成并真机验证（`phase3m-e2e.cjs` 69/69 + `sse-e2e.cjs` 14/14 全绿）：明文 14 天→`.gz` 归档 90 天→删（先压后删）、`ecclaw_event_summary` 加 `bucket` 趋势（day/hour、补空桶 0、环比/峰值）、`ecclaw_guard_remove` 按站点/路径/作用域移除、宿主桥 `GET /events` SSE 主动推送 + 新工具 `ecclaw_events_since`（MCP 21→23）**；
> **第十三阶段 ④ 真实站点登录态闭环（淘宝）已于 2026-11-02 完成**：重启后 persist cookie 留存 + scroll 触发护栏 + session 档信任只落 session 组（见第十三阶段表 #8）。第十四阶段候选：事件 seq 空间遗留问题（seq 重启归零、回放按文件序）、导出物清理入口、趋势图形化。
> **第十四阶段（事件 seq 全局单调 + 导出物清理入口 + 趋势图）①②③ 已完成并真机验证（`phase3o-e2e.cjs` **44/44** + 回归 `phase3m-e2e.cjs` **69/69** + `sse-e2e.cjs` **14/14** 全绿）：启动续号（`maxSeqOnDisk()`）让 seq 跨重启全局单调、`SeqSelector` 让回放/导出按 seq 升序、界面「导出物（自己清理）」面板逐个两段式删除（agent 侧只列不删，新增 `ecclaw_export_list`，MCP 23→24）、零依赖 SVG 趋势柱状图（峰值高亮 + hover 提示）**；
> **第十五阶段（店铺登录态 profile · 多店铺登录隔离）已完成并真机验证（`phase3p-e2e.cjs` **45/45** + 回归 `phase3o-e2e.cjs` **44/44** / `phase3m-e2e.cjs` **69/69** / `sse-e2e.cjs` **14/14** 全绿）：一个 profile = 一个独立 partition（默认 profile 分区名 `persist:ecclaw-host` **一字不改** → 老登录态不丢）、界面建店 / 切店 / 两段式移除、agent 侧只读清单 + 切换（MCP 24 → 26，新增 `ecclaw_profile_list` / `ecclaw_profile_use`）**；
> **第十六阶段（真实站点写操作闭环复验 + 写操作事件落盘）已完成并真机验证（`phase3q-e2e.cjs` **23/23** + 回归 `phase3p-e2e.cjs` **44/44** / `phase3o-e2e.cjs` **44/44** / `phase3m-e2e.cjs` **69/69** / `sse-e2e.cjs` **14/14** 全绿）：淘宝登录态跨 Electron 重启仍在 → `ecclaw_scroll` 被护栏拦下 → 界面卡片 → 选「本次会话内信任本站」→ 点「允许」→ 票据 executed + 页面真滚（scrollY 0→400）→ 第二次 scroll 免确认直放行 → session 档进会话组且持久白名单仍空。复验撞出真缺口：**写操作完全不产生事件**（`kind:'approval'` 全项目从未 push 过）→ 补齐五处落点 + stage 语义（requested/executed/rejected/timeout/failed，被拦下的写 2 条、站点信任放行 1 条），界面可读摘要，`ecclaw_events_since` 加 `kind` 过滤（工具数仍 26）**；
> **第十七阶段（事件流 kind 多选筛选 + 导出物按 kind 拆分）已完成并真机验证（`phase3r-e2e.cjs` **31/31** + 回归 `phase3q-e2e.cjs` **23/23** / `phase3p-e2e.cjs` **45/45** / `phase3o-e2e.cjs` **44/44** / `phase3m-e2e.cjs` **69/69** / `sse-e2e.cjs` **14/14** 全绿）：过滤语义统一在 `scanDiskEvents`（`kinds` 多选**优先于** `kind` 单选，脏 kind 丢弃不报错）→ 回放 / 汇总 / 导出三条路天然一致；导出可 `splitByKind` 按类型拆成多份（文件名 `ecclaw-events-<kind>-YYYYMMDD-HHMMSS.ext`，同秒重名加 `-N` **不覆盖**用户产物）；界面三处 kind 多选 + 「按 kind 拆成多个文件」开关；MCP 四个事件工具加 `kinds`、`ecclaw_event_export` 加 `splitByKind`（工具数仍 26）**；
> **第十八阶段（写操作 rejected/timeout/failed 三终态真实站点复验）已完成并真机验证（`phase3s-e2e.cjs` **49/49** + 回归 `phase3r-e2e.cjs` **31/31** / `phase3q-e2e.cjs` **26/26** / `phase3p-e2e.cjs` **45/45** / `phase3o-e2e.cjs` **44/44** / `phase3m-e2e.cjs` **69/69** / `sse-e2e.cjs` **14/14** 全绿）：淘宝真站逐 stage 落盘实锤（rejected / failed(via=user) / failed(deny 分支，无 approvalId 无 via) / timeout 10 分钟真定时器误差 <1s），全部 fail-closed（winY 恒不变）、全部不留信任；Z 组口径 `requested=4·rejected=2·failed=2·timeout=1·executed=0`、summary=replay=9；唯一产品改动 = `App.tsx:193` 卡片堆栈加 `data-approval-id` 锚点（一行）；定性两个界面层结论：终态卡 12s 自动收工作正常（hidden 态复验 18.4s 收）、scope 下拉是 App 级全局粘滞 state（记住上次选择，设计行为）**；
> **第十九阶段开局 · 回归欠账已补（2026-11-03 晚）**：第十八阶段收官时写的「六套回归全绿」引的是 `run49-*.log`，
> 但那轮其实是「环境全灭」（phase3s 46/3、其余全崩）；最新一轮 `run49b-*` 实测 **3r 30/31 · 3q 17/23 · 3p 44/44**。
> 两处红**都不是产品 bug**：① `phase3r` G3 断言把 DOM 条目 `.slice(0,20)` 却要求等于 `approval=38` → 恒假；
> ② `phase3q` 旧脚本按「第一张卡」找卡 → 点中上一套件（phase3r）遗留的 pending 卡 → 批准了 8898 → 本套件 6 条连环红
> （**跨套件污染**）。已修（**脚本级、零产品改动**：approvalId 锚定 + 开局/收尾拒绝遗留 pending 卡 + 清会话信任）
> 并复跑全绿：**3s 49 · 3r 31 · 3q 26 · 3p 45 · 3o 44 · 3m 69 · sse 14**（`run50-*` / `run50b-*`），
> 且用「污染顺序」复验 phase3r → phase3q 串跑 = 31/31 + 26/26。
> **第十九阶段（kind:'page' 事件补产生点 + 导出物面板归类视图）主体完成并真机验证（`phase3t-e2e.cjs` **16/16** 全绿）**：
> `'page'` 此前在共享类型 / 界面筛选器 / MCP 四个事件工具的 kinds 枚举里**三处齐全**，却**全项目零 push 点**
> → 界面上那个「页面事件」筛选永远选不出东西（**界面在骗人**）；而开页面**不走写操作护栏**（护栏只管 click/scroll）
> → 「agent 打开了哪些页面」此前**完全无痕**。补产生点在 `electron/main/browser-host.ts` 的 `open()`
> （宿主开页的**唯一漏斗**：hostOpen / hostReadDom / hostRunDataQuery / hostRunAction / hostRunExtract / hostRunObserve
> 六处 `h.open()` 全汇聚到它），载荷 `{action:'open',url,tabId,title}`，`pushHostEvent` 包 try/catch（事件挂了不阻断开页），
> **零契约改动** → MCP 工具数仍 **26**；导出物面板新增「归类方式」（none/date/kind，**默认 none = 现状一字不差**、
> 删除按钮 testid `export-remove-{文件名}` 两视图一字不变、**纯前端算**不改 IPC 与导出清单结构），
> agent 侧 `ecclaw_export_list` 保持扁平。回归链**八套实测全绿**（产物前缀 `run51-*`，摘要 `run51-summary.txt`）：
> phase3t 16 · phase3s 49 · phase3r 31 · phase3q 26 · phase3p 45 · phase3o 44 · phase3m 69 · sse 14（FAIL 全 0）。
> 交接见 `handoff-ecclaw-phase3t-final-2026-11-03.md`（第十九阶段收官）、`prompt-ecclaw-phase3t-next.md`（下一阶段接力）。
> **第二十阶段（远程包仓库灰度发布 rollout）已完成并真机验证（`phase3u-e2e.cjs` **24/24** 全绿）**：
> 清单加**全可选** `rollout` 字段（`id` / `percent` / `allowClientIds` / `denyClientIds`），没有该字段 = 100% 可见 →
> 老 `index.json` 行为一字不变；`rollout` 写坏（缺 id / percent 非数字）→ **fail-closed 按 percent=0 放行**
> （灰度是放量闸门，清单坏了宁可少放不能误放）；客户端用**本地惰性生成**的匿名 `clientId`（UUID，落
> `ecclaw-settings.json`，**只落本地绝不上传**）分桶 `bucket = parseInt(sha256(clientId+':'+rollout.id).slice(0,8),16)%100`，
> 同 clientId + 同 rollout.id 桶位恒定（重启不变）、换 rollout.id 重新洗牌；
> **准入双保险**：`fetchRepoIndex()` 给条目补只读派生字段 `eligible/bucket/eligibleReason`（界面据此显示原因），
> `installRemotePackage()` **在安装路径再判一次**（不能只靠界面禁用按钮）—— `version` 参数只用于选条目、**不等于放行**，
> 只有显式 `{bypassRollout:true}` 才越过灰度（仍照旧校验 sha256 / manifest / zip 安全规则）；
> 未指定版本时在 eligible 集合里取最高版本，集合为空 → 明确报错「灰度未放行（bucket=…, percent=…）」，
> 不静默降级、不删已安装版本；旧版本目录**只增不删**；**不加 MCP 工具（工具数仍 26）**；
> 界面条目显示「灰度命中 / 未灰度到（bucket/percent%）/ 内测名单 / 已排除」，未放行条目安装按钮禁用、文案「未放行」。
> 交接见 `handoff-ecclaw-phase3u-final-2026-11-03.md`（第二十阶段收官）。
> **第二十一阶段（文档预览 · 先 PDF）已完成并真机验证（`phase3v-e2e.cjs` **29/29** 全绿）**：
> 文件库里的 **PDF** 可直接看 —— 界面点开即显示「PDF · N 页 · 体积」+ 逐页文本，agent 侧新增**只读** MCP 工具
> **`ecclaw_document_preview`**（工具数 26 → **27**，无参返回文件库文档清单，给 `path`/`name` 返回页数 + 逐页文本）；
> 判定按文件头 `%PDF-`（不靠扩展名，改名的 PDF 也认）；抽取用 `pdfjs-dist` legacy 构建（纯 JS，无原生编译）在主进程本地解析，
> 文本按 `hasEOL` 换行 + **NFKC 归一化**（PDF 的 ToUnicode 常把「色」映成部首「⾊」，归一化后才是人能读、agent 能用的文本）；
> **只读且本地**（不联网、不外发、不改用户文件）；**路径守卫 fail-closed**（`path.relative` 判越界 + realpath 防符号链接逃逸，
> 只允许 `<stateDir>\file-library\files` 内文件）；损坏/加密/非 PDF 一律返回**人话 error**（不抛栈）；
> **本轮不做 PDF 位图渲染**（Electron 不内置 PDF 插件，位图需原生 canvas 依赖）。
> 本轮另定性 phase3o 两条红 = **测试脚本 bug 而非产品 bug**（`ecclaw_event_replay` 的 `limit` 截断的是 **seq 最小的前 N 条**，
> 旧脚本拿「第 500 小」当新事件 seq；落盘实测 900013→900568 连续无空洞，产品侧 seq 续号正常）→ **只改脚本、未改产品代码**。
> 交接见 `handoff-ecclaw-phase3v-final-2026-11-03.md`（第二十一阶段收官）、`prompt-ecclaw-phase3v-next.md`（下一阶段接力）。
> **第二十二阶段（DOCX 抽取 + PDF 位图）已完成并真机验证（`phase3w-e2e.cjs` **27/27** 全绿，run54 九套 **299/299**）**：
> DOCX 走 `fflate` 只解 `word/document.xml`（段落 / 表格按 `列 | 列` 展开 / XML 实体 / NFKC），PDF 用 `@napi-rs/canvas` + pdfjs
> 渲染单页 PNG（**只在界面显示，不返回 agent**，避免 base64 灌上下文）；MCP 工具数**仍为 27**（未新增工具）。
> 交接见 `handoff-ecclaw-phase3w-final-2026-11-03.md`（第二十二阶段收官）、`prompt-ecclaw-phase3w-next.md`（下一阶段接力）。
> **第二十三阶段（PPTX / XLSX 抽取）已完成并真机验证（`phase3x-e2e.cjs` **41/41** 全绿，run55 十套 **340/340**）**：
> 复用 DOCX 同一条 `fflate` zip+XML 路线（**不引新依赖**）；判 Office 类型改读 **zip 中央目录**
> （EOCD → cdSize@12/cdOffset@16 → 逐条取条目名；**中央目录头偏移 ≠ 本地文件头**：文件名长度@28、扩展@30、注释@32、名字@46），
> 判据 `word/document.xml`→docx / `ppt/presentation.xml`→pptx / `xl/workbook.xml`→xlsx，读不出中央目录**回退**老的子串探测；
> PPTX 放映顺序看 `presentation.xml` 的 `<p:sldIdLst>`（路径经 `_rels` 映射），文字取 `<a:t>`、`<a:br/>` 记换行，输出 `[幻灯片 N]` 分隔；
> XLSX 表名/顺序在 `xl/workbook.xml` 的 `<sheets>`，值三类（`t="s"`→sharedStrings 下标、`t="inlineStr"`→`<is><t>`、其余→`<v>`），
> **按单元格引用列号落位**（`B7`→第 2 列）、缺列补空、行渲染 `a | b | c`，输出 `[工作表 表名]` 分隔；**日期未还原**（序列号，需读 styles.xml numberFormat）；
> MCP 工具数**仍为 27**（只改 `ecclaw_document_preview` 描述）。
> 交接见 `handoff-ecclaw-phase3x-final-2026-11-04.md`（第二十三阶段收官）、`prompt-ecclaw-phase3x-next.md`（下一阶段接力）。
> **第二十四阶段（XLSX 日期还原）已完成并真机验证（`phase3y-e2e.cjs` **31/31** 全绿，run56 十一套 **371/371**）**：
> 补上第二十三阶段明确留下的欠账 —— XLSX 里的日期以前是**序列号原样给**（`45000`），本轮按单元格的数字格式还原成日期。
> 链路：单元格 `s="i"` → `xl/styles.xml` 的 `<cellXfs>` 第 i 个 `<xf>` 的 `numFmtId` → 内置表（14–22、27–33、45–47、50–56）
> 或 `<numFmts>` 的自定义 `formatCode`；**判是否日期靠扫格式码**（剔掉引号字面量/反斜杠转义/方括号段）：
> `y`/`d`=年/日、`h`/`s`=时/秒、`m` 看邻居（紧跟小时后或紧邻秒前=分，否则=月）；方括号 `[h]` 是**时长**→不当日期、原样留数字。
> **序列号转日历**：1900 历元以 1899-12-31 为基准、号 ≥61 减 1 天（Excel 塞了假的 1900-02-29，号 60 按字面输出）；
> 1904 历元（`workbookPr@date1904="1"`）以 1904-01-01 为基准、号 0 即那天；小数部分是时分秒。
> 输出统一 `YYYY-MM-DD`（带时间补 ` HH:MM`/` HH:MM:SS`，纯时分给 `HH:MM[:SS]`）—— **不照搬 Excel 显示样式**
> （`m/d/yy` 也给 `2023-03-15`，无歧义可排序）；**只转数值型单元格**（共享/内联字符串、布尔、公式字符串一律不动）。
> MCP 工具数**仍为 27**（描述与参数都没改）；界面无变化。
> 交接见 `handoff-ecclaw-phase3y-final-2026-11-04.md`（第二十四阶段收官）、`prompt-ecclaw-phase3y-next.md`（下一阶段接力）。
> **第二十五阶段（XLSX 照搬 Excel 显示样式 + DOCX 表格转 Markdown）已完成并真机验证（`phase3z-e2e.cjs` **37/37** 全绿）**：
> XLSX 改口径 —— 同一个 `formatCode` 渲染器同时管日期与数字：日期按 `y/m/d/h/s/AM-PM` token 渲染
> （`m/d/yy`→`3/15/23`、`mmm-yy`→`Mar-23`、`h:mm AM/PM`→`1:30 PM`、`yyyy"年"m"月"d"日"`→`2023年3月15日`、`dddd`→`Wednesday`），
> `[h]:mm:ss` 按已用时长（`1.5`→`36:00:00`）；数字支持小数位/千分位/百分比/货币/负数分段括号/取整；
> 科学计数、分数、General 一律回退原值；仍只处理数值型单元格。DOCX 表格首行作表头转 Markdown（`| --- |` 分隔行、
> 缺列补空、`\|` 转义、`<br>`）；工具数仍 27。
> **第二十六阶段（DOCX 合并单元格 → Markdown 表格）已完成并真机验证（`phase4a-e2e.cjs` **20/20** 全绿）**：
> 横向 `w:gridSpan="N"` 内容只在首格、其余补空（列位与其它行对齐，上限 32 列，`0`/缺失/非法按 1）；
> 纵向 `w:vMerge` 起始格保留内容、续格为空（值不重复），续格自带文本照常输出不丢；属性只认单元格自己的
> `w:tcPr`。工具数仍 27，无新增依赖；run58 十三套 **428/428** 全绿（未跑真站 phase3s/3q）。
> 交接见 `handoff-ecclaw-phase4a-final-2026-11-04.md`（第二十六阶段收官）。
> **第二十七阶段（DOCX 单元格内嵌表格 → 深度感知抽取）已完成并真机验证（`phase4b-e2e.cjs` **18/18** 全绿）**：
> 根因 = DOCX 抽取全用**非贪婪正则配对标签**（`<w:tc>…</w:tc>` 等），表格一嵌套，外层就在**内层**闭合标签处提前收尾，
> 列位全错、外层后续行被吃掉。改法 = 新增 `docxChildElements()` **栈式深度感知**取直接子级（只跟踪
> `w:tbl|w:tr|w:tc|w:p` 四种容器，w:r / w:t 等叶子不参与层级判定），表格 / 行列 / 单元格 / 段落四层全部改走它；
> 内嵌表按**行摊平进所在格**（每行一行、行内列以 ` \| ` 分隔 → 渲染成 `<br>` 换行），位置与内容都不丢，
> 内层列不会再把外层列撑开。合并格（gridSpan）里再嵌表仍按跨度补空。工具数仍 27，无新增依赖。
> 交接见 `handoff-ecclaw-phase4b-final-2026-11-05.md`（第二十七阶段收官）。
> **第二十八阶段（XLSX 颜色信息 + 条件格式）已完成并真机验证（`phase4c-e2e.cjs` **26/26** 全绿）**：
> 数字格式段颜色（`[Red]` / `[Blue]` / `[Color10]`，按正/负/零段取色）、静态字体色与填充色（fontId/fillId →
> fonts/fills，只认显式 rgb）、条件格式（cellIs 比较 + containsText/beginsWith/endsWith，dxf 字体色/底色，
> priority 升序 + stopIfTrue 截断；colorScale 等图形规则跳过）。呈现口径 = 值后追加
> `[颜色:红]` / `[底色:黄]` / `[颜色:红;底色:黄]`，无颜色时输出与以前一字不差。
> 工具数仍 27，无新增依赖；run60 十五套 **472/472** 全绿。交接见 `handoff-ecclaw-phase4c-final-2026-11-05.md`。
> **第二十九阶段（XLSX 科学计数法 / 分数格式）已完成并真机验证（`phase4d-e2e.cjs` **31/31** 全绿）**：
> 补上第二十五阶段起一直「不支持 → 保留原值」的两类数字格式 ——
> 科学计数法（`0.00E+00` → `1.23E+04`、`##0.0E+0` → `1.2E+4`，内置 11/48 生效；
> 尾数按小数位四舍五入，进位到 10 时尾数归 1、指数加 1；`E+` 正指数带 `+`，`E`/`E-` 只负指数带号；
> 指数位数取格式里 `0` 的个数）与分数格式（`# ?/?` → `2 1/2`、`?/?` → `1/2`、`# ?/4` → `0 1/4` 固定分母不约分；
> 槽位宽度当**位数上限**、输出不做对齐补空格 → 与 Excel 的差异仅在对齐空格）。
> 分数用**连分数最佳有理逼近**（不是就近取整 —— 就近取整会把 0.3 取成 `2/7`，Excel 给 `1/3`）；
> 分子放不下或格式畸形一律**保留原值**。技术核心是新增的**掩码层** `flattenFormatSection()`
> （一次产出等长的 text + masked，字面量位置换成掩码符）—— 引号里的 `"E"` / `"a/b"` 是**字面量不是结构**，
> 没有这层会被误判成科学计数法 / 分数格式；`parseNumberPattern` 也因此加了 masked 兜底（裸 `E` 一律回退原值）。
> 工具数仍 27，无新增依赖；只改 `electron/main/document-preview.ts` 一个产品文件；
> 秒级自测 **24/24**；run62 十六套 **503/503** 全绿。交接见 `handoff-ecclaw-phase4d-final-2026-11-05.md`。
> **第三十阶段（PDF 多页缩略图 + 指定页 / 缩放渲染参数）已完成并真机验证（`phase4e-e2e.cjs` **21/21** 全绿）**：
> PDF 预览原来只能「第 1 页 + 上一页/下一页」，倍率固定 1.5 且界面调不了。本轮把渲染参数暴露到界面，
> 并加一条**缩略图导航条**：以当前页为中心的**连续 12 页**，点击切页，窗口随当前页滑动，
> 已渲染过的页命中缓存不重复渲染（主进程每渲染一次都要重解 PDF）。
> 缩略图按**目标宽度**（默认 132 px）归一、**不按固定 scale** —— PDF 页面尺寸不一（A4 595 / Letter 612 / 横向），
> 固定 scale 会让缩略图宽窄不一排不齐；宽度归一后高度按各页高宽比走。
> 一次最多 24 张；页码越界/非法直接过滤；宽度夹 48–400；缩略图**先铺白底**再渲染（PDF 页面本身透明，不铺底会发黑）。
> 界面另加**页码输入 + 跳转**与**缩放七档**（50/75/100/150/200/300%，主进程夹 0.5–3）。
> 位图仍**只给界面**、不返回 agent；MCP 工具数仍 27，无新增依赖。
> 秒级自测 **33/33**；run63 十七套 **524/524** 全绿。交接见 `handoff-ecclaw-phase4e-final-2026-11-05.md`。
> **第三十一阶段（PDF 目录（书签）导航 + 页码范围抽取）已完成并真机验证（`phase4f-e2e.cjs` **26/26** 全绿）**：
> PDF 预览与 agent 侧预览各补一件事：**能看见目录**、**能只抽一段页码**。
> 目录（书签）解析 PDF 的 outline（支持多级），`page` 解析不出来时是 `null` —— **不猜页码**（猜错了点了会跳到别的页）；
> 界面 PDF 预览顶部出现目录面板，**点目录项直接跳到对应页**，没有书签就不显示面板；
> agent 侧返回里带 `outline`（章节标题 + 页码）。目录是加分项：解析失败一律当「没有目录」，绝不影响正文抽取。
> `ecclaw_document_preview` 新增可选参数 `startPage` / `endPage`（PDF 专用）：越界一律夹住，
> 只给 `startPage` 就抽到末尾、只给 `endPage` 就从第 1 页抽起，`startPage > endPage` 夹成同一页，NaN 退回全文；
> 与 `maxPages`（上限 200）叠加生效；返回带 `pageStart` / `pageEnd`，范围没覆盖全文时 `truncated` 为 true。
> MCP 工具数仍 **27**，无新增依赖；秒级自测 **38/38**；e2e **26/26**；**run64 十八套 550/550 全绿**（FAIL 全 0；未跑真站 phase3s/3q）。
> 交接见 `handoff-ecclaw-phase4f-final-2026-11-05.md`。
> **第三十二阶段（XLSX 区间级条件格式：top10 / 均值 / 重复值）已完成并真机验证（`phase4g-e2e.cjs` **30/30** 全绿）**：
> §5.32 的条件格式只支持「看当前一个格子就能判定」的规则；Excel 里另一大类**必须看整段范围**的规则
> （Top 10、高于均值、高亮重复项）此前**一律静默丢弃**。本轮补齐 **4 类区间级规则**：
> `top10`（`rank` / `percent` / `bottom`）、`aboveAverage`（`aboveAverage="0"` / `equalAverage` / `stdDev` 样本标准差）、
> `duplicateValues` / `uniqueValues`（文本大小写不敏感、**数字与文本不同类**）。
> **判定前先按范围算命中集合**：条件格式从「逐格判定」改成**三趟**（解析全部单元格 → 按范围算命中集合 → 逐格套颜色），
> 命中与否**预先算成一张「行:列 → 命中」表**，逐格渲染时查表。
> **输出通道不变**：仍走既有 `[颜色:X;底色:Y]` 标记，不新增文本标记、不破坏既有输出。
> **多区域 sqref 按每段独立统计**（Excel 对多区域选择的语义有歧义，单区域是绝大多数情况，两种口径等价）；
> 范围内无数据 → 规则不命中（fail-safe）。`containsBlanks`（要改空白格渲染）与图形类规则（colorScale/dataBar/iconSet）本轮**不做**。
> 只改 `electron/main/document-preview.ts` 一个文件；MCP 工具数仍 **27**，无新增依赖；
> 秒级自测 **55/55**；e2e **30/30**；✅ **全量回归 run65 十九套 580/580 全绿**（FAIL 全 0，未跑真站 phase3s/3q）。
> 上轮跑到 phase3y 时 Electron 中途消失导致整套挂死 —— 根因是 e2e 的 `send()` **无超时**，
> 本轮给 19 套 `send()` 打 90s 超时补丁（只改 `C:\Temp` 测试脚本）后 phase3y 31/31 通过。
> 交接见 `handoff-ecclaw-phase4g-final-2026-11-05.md`。
> **第三十三阶段（XLSX 单位 / 工程 / 会计格式 + 日期 locale 本地化）已完成并真机验证（`phase4h-e2e.cjs` **48/48** 全绿）**：
> §5.29–§5.33 把数字格式做了一轮，本轮补上剩下的三块 —— **单位**、**工程计数法**、**会计格式**，外加**日期 locale**。
> **缩放逗号**：小数点**之后**的每个尾逗号 = ÷1000（`#,##0,,` → 12345678 出 `12`；`0.0,` → 1234 出 `1.2`），
> 整数位中间的逗号仍是千分位 —— 此前小数点后的尾逗号**被漏掉**（`0.0,` 原来出 `1234.0,`）。
> **工程计数法**：小数点前**至少 2 个数字占位槽**（`##0` / `###`）→ 指数**向下取 3 的倍数**、尾数落在 `[1,1000)`
> （`##0.0E+0` → 12345 出 `12.3E+3`，不是科学计数的 `1.2E+4`；`##0.00E+00` → `12.35E+03`）；
> 只有 1 个槽（`0.0E+0`）→ 仍是科学计数法；内置格式 48 同样生效。
> **会计格式**：四段式 `_($* #,##0.00_);…` → 正 `$1,234.50` / 负 `$(1,234.50)` / 零 `$-`
> （零段靠 `??` 槽**不吃掉那个 0**，只留横线）；`*` 填充与 `_` 宽度占位**丢弃**（对齐留白在纯文本里不可见）。
> **日期 locale**：`[$-804]`（zh-CN）→ `3月` / `三月` / `周三` / `星期三` / `上午`·`下午`；
> **只有带 locale 前缀才本地化**，没前缀或英文 locale（`[$-409]`）**一律保持英文**（不误伤既有输出）。
> 整数位改按 **Excel 槽位语义**渲染（`0` 槽补 0、`#` 槽不显示、`?` 槽补空格、右对齐填最右槽、槽不够不截断）。
> **回归影响**：`##0.0E+0` 从 `1.2E+4` 变成 `12.3E+3`（Excel 本来就是工程格式）→ phase4d 自测 / e2e 两条期望值已同步更新。
> 只改 `electron/main/document-preview.ts` 一个文件；MCP 工具数仍 **27**，无新增依赖；
> 秒级自测 **42/42**；e2e **48/48**；✅ **全量回归 run66 十九套 628/628 全绿**（FAIL 全 0，未跑真站 phase3s/3q）。
> 交接见 `handoff-ecclaw-phase4h-final-2026-11-05.md`。
> **第三十四阶段（XLSX 日期 locale 扩展 + 文本格 `@` 字面量）已完成并真机验证（`phase4i-e2e.cjs` **53/53** 全绿）**：
> §5.37 只做了 `[$-804]`（zh-CN），本轮把 locale **扩到 5 种**：zh-CN `804` / zh-TW `404` / ja-JP `411` /
> de-DE `407` / fr-FR `40C`，en-US `409` 显式支持；日语出 `水曜日`/`水`/`午後`，德语 `Mär`/`März`/`Mittwoch`/`Mi`，
> 法语 `mars`/`mercredi`/`mer.`；**认不出的 locale 一律回落英文**（`[$-999]` → `Mar 15, 2023`）。
> **不连带改日期先后顺序**（格式码怎么写就怎么输出），locale 只影响**名称**。
> **文本格 `@` 字面量**：`"¥"@` → `¥abc`、`"预"@"后"` → `预abc后`（此前一律裸 `abc`）；
> 靠**掩码串**里的**结构 `@`** 判定真占位符 —— 字面量里的 `@` 不算（`"a@b"@` → `a@bx`）；
> 纯数字格式对文本格**仍不生效**（`0.00` 套文本 → `abc`）；格式码第 4 段优先，不足 4 段取第 1 段。
> **duration 取数一致性小修**：`[h]:mm:ss` 语境下 `mm`/`ss` 改从**总秒取模**（原先取当天时钟的分钟/秒，
> 亚秒舍入边界会差 1 秒），**输出实测不变**。
> **本轮最大的收获是「候选清单会过期」**：开打前探针实测发现 §5.37 handoff §9 候选里的
> 「日期 duration」与「科学计数法负指数」**早已实现且与 Excel 一致**（候选过期），
> 真缺口只有 locale 扩展与文本 `@` 两项 → **先探针再选题**。
> 只改 `electron/main/document-preview.ts` 一个文件；MCP 工具数仍 **27**，无新增依赖；
> 秒级自测 **47/47**；e2e **53/53**；✅ **全量回归 run67 二十套 681/681 全绿**（FAIL 全 0，未跑真站 phase3s/3q）。
> 交接见 `handoff-ecclaw-phase4i-final-2026-11-05.md`。
> **第三十五阶段（DOCX 结构保真 · 标题层级 / 多级列表编号 / 粗斜体 / 页眉页脚脚注）已完成并真机验证（`phase4j-e2e.cjs` **39/39** 全绿）**：
> §5.26 起 DOCX 只能抽出**扁平纯文本**（标题层级、列表编号、强调、页眉页脚全丢），本轮把结构补回来，输出走 Markdown：
> **标题层级**读 `word/styles.xml` 判定（style 自带 `outlineLvl` 优先，否则从 style 名取数字，认 `heading 1` / `标题 1`）→ `#` ~ `######`；
> **多级列表编号**读 `word/numbering.xml`（`numId` → `abstractNumId` → `ilvl`），按 `numFmt` 渲染 decimal / 字母 / 罗马 / 中文数字，
> 按 `lvlText` 的 `%1` / `%2` 槽位拼多级前缀，本级 +1、更深层计数器清零，每级 2 空格缩进；
> **粗斜体**按 run 级 `w:b` / `w:i` → `**x**` / `*x*` / `***x***`（**表格单元格内同样应用**，标题与列表标记不应用）；
> **页眉 / 页脚 / 脚注**：页眉置顶 `[页眉] …`、页脚置底 `[页脚] …`、脚注在正文后出 `[脚注]` 块（按引用顺序编号），
> 正文引用处内联 `[N]`。
> **本轮再次印证「候选清单会过期」**：开打前探针实测发现上轮候选里「XLSX `expression` 条件格式」是真缺口但价值中、
> 「文本 `@` 剩余形状」是真缺口但价值低；而 DOCX / PPTX 这条**新轴**上结构丢失最明显 → **改选 DOCX 结构保真**。
> 只改 `electron/main/document-preview.ts` 一个文件；MCP 工具数仍 **27**，无新增依赖；
> 秒级自测 **30/30**；e2e **39/39**；✅ **全量回归 run68 二十二套 720/720 全绿**（FAIL 全 0，未跑真站 phase3s/3q）。
> 交接见 `handoff-ecclaw-phase4j-final-2026-11-06.md`。
> **第三十六阶段（PPTX 结构保真 · 表格列关系 / 演讲者备注 / 图片 alt）已完成并真机验证（`phase4k-e2e.cjs` **35/35** 全绿）**：
> §5.27 起 PPTX 只能抽出**每页每段一行**的扁平纯文本（表格列关系、演讲者备注、图片 alt 全丢），本轮把结构补回来：
> **表格**走 Markdown 管道表（`p:graphicFrame` → `a:tbl`，首行作表头 + `| --- |` 分隔行，缺列补空，复用 `markdownCell()`）；
> **合并单元格口径与 DOCX 一致**（横向 `gridSpan="N"` 首格放内容其余 N−1 格补空；纵向 `rowSpan` / `hMerge` / `vMerge`
> 内容留起始格、续格补空）；**演讲者备注**按幻灯片自己的 `ppt/slides/_rels/slideN.xml.rels` 找 `notesSlide`，
> 取 body 占位符多段文字，落在**该页正文末尾** `[备注] …`；**图片 alt** 取 `p:nvPicPr` 的 `cNvPr@descr` →
> `[图片: 营收趋势折线图]`（**没有 descr 的图片不产生噪音行**）；**占位符降噪** —— `p:ph@type` 为
> `sldNum` / `dt` / `hdrFtr` / `ftr` 的形状整页跳过（否则页码域文字 `<a:fld><a:t>2</a:t>` 会混进正文变成孤立一行「2」）。
> 只改 `electron/main/document-preview.ts` 一个文件；MCP 工具数仍 **27**，无新增依赖；
> 秒级自测 **27/27**；e2e **35/35**；✅ **全量回归 run69 二十三套 755/755 全绿**（FAIL 全 0，未跑真站 phase3s/3q）。
> 交接见 `handoff-ecclaw-phase4k-final-2026-11-06.md`。
> **第三十七阶段（DOCX / XLSX 链接与批注 · 超链接目标 + 审阅意见）已完成并真机验证（`phase4l-e2e.cjs` **37/37** 全绿）**：
> §5.27 起超链接的**目标 URL** 与批注的**审阅意见**整条丢失（DOCX 的 `w:hyperlink` / XLSX 的 `<hyperlink>` 只留显示文本，
> 链接指向哪里不可知；`word/comments.xml` / `xl/commentsN.xml` **完全不读**，审阅人的意见在 agent 眼里根本不存在）——
> 这两类是**不可再生信息**（条件格式 / 图表属表现层，丢了还能重算；URL 与审阅意见丢了就真没了），本轮补回：
> **XLSX 链接**走 `<hyperlink ref r:id>` → `xl/worksheets/_rels/sheetN.xml.rels` 的 Target（外部 URL 原样、
> 内部 `location="Sheet2!A1"` 原样，**区间 ref 区内每格都挂**，展开上限 `MAX_LINK_CELLS` = 4096 格）；
> **XLSX 批注**按 `<comment ref authorId>` 精确匹配单元格、作者取 `<authors>` 对应名、**同格多条批注全列**，
> 部件路径优先取 sheet rels 里 Type 以 `/comments` 结尾者、**兜底按命名约定找 `xl/comments{N}.xml`**（工具产出的文件常不写 sheet rels）；
> **DOCX 链接**走 `w:hyperlink r:id` → `word/_rels/document.xml.rels`、`w:anchor` → `#锚点`；
> **DOCX 批注**走 `word/comments.xml` 的 `w:comment w:id w:author` + 正文 `w:commentRangeStart` 落到**所在段落**；
> 标记为 `[链接: <目标>]` / `[批注(<作者>): <正文>]`，顺序 **宿主文本 → 链接 → 批注 → 颜色标记仍在最末**（既有输出前缀逐字不变）；
> 只改 `electron/main/document-preview.ts` 一个文件；MCP 工具数仍 **27**，无新增依赖；
> 秒级自测 **41/41**（另交叉复验 phase4j **30/30** / phase4k **27/27** —— 既有 DOCX / PPTX 输出逐字不变）；
> e2e **37/37**；✅ **全量回归 run70 二十四套 792/792 全绿**（FAIL 全 0，未跑真站 phase3s/3q）。
> 交接见 `handoff-ecclaw-phase4l-final-2026-11-06.md`。
> **第三十八阶段（XLSX 公式 + DOCX 修订痕迹 · 计算依据 + 谁改的）已完成并真机验证（`phase4m-e2e.cjs` **50/50** 全绿）**：
> 表格里的**计算依据**和文档里的**改动痕迹**整条丢失 —— XLSX 单元格只剩值（`SUM(B1:B9)` → 只剩 `30`，
> agent 既无法重算也不知道改公式会连带哪些格）；DOCX 的**插入内容混在正文里看不出是谁加的**、
> **删除内容整段消失**（`<w:del>` 不在正文流）—— **正文在骗人**。这两类是**不可再生信息**，本轮补回：
> **XLSX 公式**取 `<f>` 公式体（decode 实体 / trim / **不带 `=`**）→ 值后追加 `[公式: …]`；
> `t="array"` 按普通公式输出；`t="shared"` 的 follower **只有 si 没有体** → 两遍扫描建 `si → master 公式体` Map 再回填，
> 标 `[公式: 共享 <master公式体>]`（**不做相对引用重写**）；空值但有公式的格在 `filled` 里放行；
> **DOCX 修订**按文档顺序取 `<w:ins>` / `<w:del>` / `<w:moveFrom>` / `<w:moveTo>` 四类块，
> 插入类取 `<w:t>`、删除类取 `<w:delText>` → 段落末尾 `[修订+<作者>: <文本>]` / `[修订-<作者>: <文本>]`，
> **只输出作者不输出日期**，moveFrom / moveTo 分别按删除 / 插入语义处理；
> **段落标记修订**（`<w:pPr><w:rPr><w:ins/></w:rPr></w:pPr>`）与**空壳修订块**一律排除；
> **正文流一字未动**（`docxRuns` 天然已含 ins 内容、已排除 delText → 只加署名标记，勿重复加文本）；
> 顺序 XLSX **值 → 公式 → 链接 / 批注 → 颜色恒在最末**、DOCX **宿主文本 → 修订 → 链接 → 批注**；
> 只改 `electron/main/document-preview.ts` 一个文件；MCP 工具数仍 **27**，无新增依赖；
> 秒级自测 **72/72**（先 RED 57/72）；交叉复验 phase4l **41/41** / phase4j **30/30** / phase4k **27/27**
> （既有 DOCX / XLSX / PPTX 输出逐字不变）；e2e **50/50**；
> ✅ **全量回归 run71 二十五套 842/842 全绿**（FAIL 全 0，未跑真站 phase3s/3q）。
> 交接见 `handoff-ecclaw-phase4m-final-2026-11-06.md`。
> **第三十九阶段（PPTX 超链接 + PPTX 批注 · 点向哪里 + 谁说了什么）已完成并真机验证（`phase4n-e2e.cjs` **78/78** 全绿）**：
> §5.41（phase4l）把**链接目标**与**审阅意见**补给了 DOCX / XLSX，PPTX 成了**三格式里唯一的一致性缺口** ——
> 幻灯片上的 `a:hlinkClick` 点向哪里不可知、`ppt/comments/*.xml` 里的演讲者批注**整条不读**，本轮补齐：
> slide rels 里 Type 以 `/hyperlink` 结尾的关系 → `rId` → Target，`a:hlinkClick` 按 `r:id` 查表
> → `[链接: <目标>]`；**只有带协议的外部目标才输出**，内部跳转（`ppaction://hlinksldjump` / 指向其它 slide）**不输出**；
> 批注部件走 Type 以 `/comments` 结尾的关系（旧的 `comment1.xml` / 新的 `modernComment_*.xml`），
> **两代格式都认**（`p:cm` / `p188:cm`；正文旧的在 `p:text`、新的在 `p188:txBody` 的 `a:t`），
> 作者按 `authorId` 到 `ppt/commentAuthors.xml` / `ppt/authors.xml` 查、**查不到留空**、**只出作者不出日期**；
> **落位**：run/段落级链接 → 该段落行末、形状级链接 → 该形状**首个块**末尾（图片挂 `[图片: alt]` 行）、
> 批注按 `p:cm@idx` 匹配形状 `p:cNvPr@id` 挂被评论形状首行末、
> **挂不到形状的批注落该页末尾且备注仍在最后一行**；顺序恒为 **文本 → 链接 → 批注**；
> **表格不挂形状级标记**（会破坏 Markdown 表）；只改 `electron/main/document-preview.ts` 一个文件；
> MCP 工具数仍 **27**，无新增依赖；无链接无批注的 PPTX **输出逐字不变**；
> 秒级自测 **74/74**（先 RED 58/74）；交叉复验 phase4m **72/72** / phase4l **41/41** / phase4j **30/30** / phase4k（输出逐字不变）；
> e2e **78/78**；✅ **全量回归 run72 二十六套 920/920 全绿**（FAIL 全 0，未跑真站 phase3s/3q）。
> 交接见 `handoff-ecclaw-phase4n-final-2026-11-06.md`。
> **第四十阶段（三格式文档属性 · 谁写的、什么时候改的）已完成并真机验证（`phase4o-e2e.cjs` **17/17** 全绿）**：
> DOCX / XLSX / PPTX 都把标题、作者、最后修改人、修改时间写在同一个部件 `docProps/core.xml`，
> 抽取器此前**完全不读**，agent 拿到的是没有出处的正文、同名文件也无法区分。本轮用一个解析函数补齐三格式：
> `parseCoreProps()` **按本地名匹配**（不硬编码 `dc:` / `cp:` / `dcterms:` 前缀，前缀可任意绑定），
> 取 `title` / `creator` / `lastModifiedBy` / `modified` → 置顶一行
> `[文档信息] 标题: … · 作者: … · 修改人: … · 修改时间: …`；
> **空字段逐个省略，四个全空或无该部件一行不出**；DOCX 在页眉前、PPTX 在 `[幻灯片 1]` 前、XLSX 在 `[工作表 …]` 前，
> PPTX / XLSX 元数据与正文**紧邻不额外插空行**；畸形 `core.xml` 不抛异常不出半截，无 `docProps` 的文件输出逐字不变；
> 只改 `electron/main/document-preview.ts` 一个文件；MCP 工具数仍 **27**，无新增依赖；
> 秒级自测 **17/17**；交叉复验 phase4n **74/74** / phase4m **72/72** / phase4l **41/41** / phase4j **30/30** / phase4k **27/27**；
> e2e **17/17**；全量回归 run73 二十七套 **936 PASS / 1 FAIL** —— 唯一失败是 phase3r 的 C3，
> 根因为**事件库已超 2000 条而回放硬上限 2000**（`host-events.ts:409`）导致参照样本被截断，
> 与本轮改动无关（本轮只动 `document-preview.ts`）；其余二十六套全绿（未跑真站 phase3s/3q）。
> 功能提交 **`d00268b`**；交接见 `handoff-ecclaw-phase4o-final-2026-11-06.md`。
> **第四十一阶段（PDF 链接 / 注释 / 表单域 / 元数据）已完成并真机验证（`phase4p-e2e.cjs` **22/22** 全绿）**：
> PDF 此前只抽正文 —— 页面里的超链接、便笺批注、可填写表单域，以及 Info 字典里的标题作者全部拿不到。
> 本轮用 pdfjs 的 `page.getAnnotations()` 逐页补齐：外部链接 `[链接: URL]`、内部跳转 `[跳转: 第 N 页]`
> （页号解析不出写 `[跳转: 内部链接]`，不猜）、便笺 `[注释(作者): 正文]`、表单域 `[表单: 字段名 = 已填值]`，
> **标记挂在每页正文之后**；元数据走 `getMetadata()` 的 Info 字典 → **置顶一行**
> `[文档信息] 标题 · 作者 · 主题 · 关键词 · 创建工具 · 生成器 · 创建时间 · 修改时间`，
> **空字段逐个省略、全空不出行**；`getAnnotations` / `getMetadata` 都是**可选方法**（别的实现没有就跳过，不崩）；
> **没有注释、没有元数据的 PDF 输出与改动前逐字一致**（回归红线）；
> PDF 日期串 `D:20260101120000Z` → `2026-01-01 12:00:00`，认不出原样返回。
> 只改 `electron/main/document-preview.ts` 一个文件；MCP 工具数仍 **27**，无新增依赖；
> 秒级自测 **18/18**；e2e **22/22**；全量回归 run74 二十八套 **958 PASS / 1 FAIL** ——
> 唯一失败 phase3r C3 为**事件库超 2000 条**的既有环境问题（非产品回归）；其余二十七套全绿（未跑真站 phase3s/3q）。
> 功能提交 **`7001922`**；交接见 `handoff-ecclaw-phase4p-final-2026-11-06.md`。
> **第四十二阶段（docProps 扩展：app.xml + custom.xml）已完成并真机验证（`phase4q-e2e.cjs` **22/22** 全绿）**：
> §5.44 只读了 `docProps/core.xml`，同目录的 `app.xml`（应用 / 公司 / 页数 / 字数）与
> `custom.xml`（用户自定义属性）此前整份跳过。本轮把 **core + app 合成同一行**
> `[文档信息] 标题 · 作者 · 修改人 · 修改时间 · 应用 · 公司 · 页数 · 字数`，
> **custom 单独一行** `[自定义属性] 名称: 值 · 名称: 值`；
> **空字段逐个省略、全空不出行**，没有 app/custom 的文档输出与改动前**逐字一致**；
> 三格式共用同一套解析（部件路径相同），**按本地名匹配**不硬编码 XML 前缀，
> `vt:vector` 多段值按 `A, B` 拼接、空名/空值跳过。
> 只改 `electron/main/document-preview.ts` 一个文件；MCP 工具数仍 **27**，无新增依赖；
> 秒级自测 **23/23**；e2e **22/22**；全量回归 run75 二十九套 **980 PASS / 1 FAIL**（摘要 `run75-summary.txt`），
> 唯一失败 phase3r C3 为**事件库超 2000 条**的既有环境失败（非产品回归），其余二十八套全绿；未跑真站 phase3s/3q。
> 交接见 `handoff-ecclaw-phase4q-final-2026-11-06.md`。
> 交接见 `handoff-ecclaw-phase3s-final-2026-11-03.md`（第十八阶段收官）、`handoff-ecclaw-phase3s-2026-11-03.md`（第十八阶段进行中）、
> 交接见 `handoff-ecclaw-phase3r-final-2026-11-03.md`（第十七阶段收官）、
> 交接见 `handoff-ecclaw-phase3q-final-2026-11-03.md`（第十六阶段收官）、`handoff-ecclaw-phase3q-2026-11-03.md`（第十六阶段实施细节）、
> 交接见 `handoff-ecclaw-phase3p-final-2026-11-03.md`（第十五阶段收官）、`handoff-ecclaw-phase3p-2026-11-03.md`（第十五阶段实施细节）、
> 交接见 `handoff-ecclaw-phase3o-final-2026-11-02.md`（第十四阶段收官）、`handoff-ecclaw-phase3o-2026-11-02.md`（第十四阶段实施细节）、`handoff-ecclaw-phase3m-final-2026-11-02.md`（第十三阶段收官）、`handoff-ecclaw-phase3m-2026-11-02.md`（第十三阶段实施细节）、`handoff-ecclaw-phase3l-2026-11-02.md`（第十二阶段收官）、`handoff-ecclaw-phase3k-2026-11-02.md`（第十一阶段收官）、`handoff-ecclaw-phase3j-2026-11-02.md`（第十阶段收官）、`handoff-ecclaw-phase3i-2026-11-02.md`（第九阶段收官）、`handoff-ecclaw-phase3h-2026-11-02.md`（第八阶段收官）、`handoff-ecclaw-phase3g-2026-11-02.md`（第七阶段收官）、`handoff-ecclaw-phase3f-2026-11-02.md`（第六阶段收官）、`handoff-ecclaw-phase3e-2026-11-02.md`（第五阶段收官）、`handoff-ecclaw-phase3c-2026-11-02.md`（第四阶段）。

> **第四十三阶段（DOCX 尾注 + 图片替代文字 + 批注回复）已完成并真机验证（`phase4r-e2e.cjs` **26/26** 全绿 + 自测 **19/19**）**：
> `word/endnotes.xml` 此前整件被跳过 → 与脚注同口径补齐（正文内联 `[N]` 按引用顺序**独立计数**、
> `[尾注]` 段排在 `[脚注]` 段之后、分隔符 id≤0 不进段）；`wp:docPr` 的 alt 此前被丢 → `descr` 优先 `title`
> 兜底内联 `[图片: …]`（`name` 是「图片 N」噪音不进输出）；`commentsExtended.xml` 的回复链此前断在
> `commentRangeStart` 口径外 → 批注首段 `paraId` ↔ `paraIdParent` 建链，回复按文档顺序**摊平挂根**输出
> `[回复(作者): 文本]`、回复自带锚点不重复出、父未知按独立批注处理。无这三类部件的文档输出**逐字不变**
> （回归红线断言锁死）。只改 `document-preview.ts`，工具数仍 27。全量回归 `run76-*`（phase3r C3 为事件库
> >2000 条既有环境失败）。交接见 `handoff-ecclaw-phase4r-final-2026-11-06.md`。

## 第二十三阶段（2026-11-04）：PPTX / XLSX 抽取 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | zip 类型判定（中央目录） | ✅ | `listZipEntryNames()`：文件尾找 EOCD（`PK\x05\x06`）→ `cdSize @12` / `cdOffset @16` → 逐条读中央目录取条目名；`detectZipDocumentKind()` 按 `word/document.xml` / `ppt/presentation.xml` / `xl/workbook.xml` 判 docx/pptx/xlsx；**读不出时回退**老的子串探测（保底未删） |
| 2 | PPTX 抽取 | ✅ | `extractPptxText()`：放映顺序取 `presentation.xml` 的 `<p:sldIdLst>`（`r:id` → `ppt/_rels/presentation.xml.rels` 映射真实路径），读不到再按 `slideN.xml` 编号排；文字取 DrawingML `<a:t>`、`<a:br/>` 记换行；输出 `[幻灯片 N]` 分隔 |
| 3 | XLSX 抽取 | ✅ | `extractXlsxText()`：顺序+表名取 `xl/workbook.xml` 的 `<sheets>`（路径经 `xl/_rels/workbook.xml.rels` 映射）；值三类 `t="s"`→sharedStrings 下标 / `t="inlineStr"`→`<is><t>` / 其余→`<v>`；**按引用列号落位**（`B7`→第 2 列，A=0、AA=26）、缺列补空、行渲染 `a \| b \| c`、尾部空列剪掉；输出 `[工作表 表名]` 分隔 |
| 4 | 类型 / 界面 | ✅ | `DocumentKind` 增 `'pptx' \| 'xlsx'`；`src/App.tsx` 加「PPTX 预览」/「XLSX 预览」标签、`open()` 路由 `/\.(docx\|pptx\|xlsx)$/i`、`doc-preview-meta` 增 `PPTX · 文本预览` / `XLSX · 文本预览`，文本预览块三者共用 `doc-preview-text` |
| 5 | MCP | ✅ | **未新增工具，工具数仍 27**；只更新 `ecclaw_document_preview` 描述（支持 PDF/DOCX/PPTX/XLSX） |
| 6 | 依赖 | ✅ | **无新增**（沿用 phase3w 的 `fflate@0.8.3`）；zip 条目仍受 `MAX_ENTRY_BYTES = 16MB` + `unzipSync({filter})` 约束 |
| 7 | e2e + 回归 | ✅ | `phase3x-e2e.cjs` **41/41**；run55 十套 **340/340**（phase3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14，FAIL 全 0）；未跑真站 phase3s/3q（本阶段红线：不碰淘宝） |

第二十三阶段实证发现：

1. **zip 中央目录头偏移 ≠ 本地文件头偏移**（本轮最大的坑）：
   中央目录头 = 文件名长度 **@28**、扩展长度 **@30**、注释长度 **@32**、**文件名 @46**；
   本地文件头才是 26/28/30 + 名字 @30。写混了会把条目名读成乱码 →
   **症状是 `kind` 全判成 `other`，而解压却仍正常** → 病因与症状分离，极难一眼看出。
2. **改解析代码先做「秒级自测」再进 Electron**：用 `tsc` 把 `electron/main/document-preview.ts` 单独转成 CJS，
   配假 `node_modules/electron`（导出 `app.getPath/getAppPath`）+ `NODE_PATH` 指项目 `node_modules`，
   就能在普通 node 里直接调 `detectDocumentKind` / `extractPptxText` / `extractXlsxText`（真实 e2e 一轮要几分钟）。
3. **`normalizeText` 是全局行为**：`/[ \t\u00a0]+/ → ' '` 会把「缺列补空」产生的双空格压成单空格
   → e2e 断言要按 `合计 | | 58` 写，别抠两个空格（首轮唯一一条红就是这个）。
4. **PPTX 版式顺序不在文件名里**：`presentation.xml` 只有 `r:id`，放映顺序看 `<p:sldIdLst>`，
   真实路径在 `_rels`；只按 `slideN.xml` 编号排会在用户调整过顺序时排错。
5. **XLSX 日期本轮明确不还原**：日期是序列号，还原要读 `styles.xml` 的 numberFormat → 原样给数字（留给下一阶段候选）。

## 第二十四阶段（2026-11-04）：XLSX 日期还原 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 样式表解析 | ✅ | `parseXlsxStyles()`：读 `xl/styles.xml` 的 `<numFmts>`（自定义 `formatCode`，id ≥ 164）与 `<cellXfs>`（第 i 个 `<xf>` 的 `numFmtId`）；单元格 `s="i"` → 第 i 个 xf |
| 2 | 格式码判定 | ✅ | `analyzeFormatCode()`：剔掉引号字面量 / 反斜杠转义 / 方括号段；`y`/`d`=年日、`h`/`s`=时秒、`m` 看邻居分月；`[h]`（时长）→ 不当日期；内置表 14–22 / 27–33 / 45–47 / 50–56 |
| 3 | 序列号转日期 | ✅ | `excelSerialToParts()`：1900 历元基准 1899-12-31、号 ≥61 减 1 天、号 60 按字面输出 1900-02-29；1904 历元基准 1904-01-01；小数部分→时分秒；`formatSerialParts()` 输出 `YYYY-MM-DD [HH:MM[:SS]]` / 纯 `HH:MM[:SS]` |
| 4 | 接进抽取 | ✅ | `parseXlsxSheet()` 增加 `styles` / `date1904` 两个入参：仅 `type === 'n'` 且格式是日期/时间时才转；共享字符串 / 内联字符串 / 布尔 / 公式字符串不动；`extractXlsxText()` 增读 `xl/styles.xml` + `workbookPr@date1904` |
| 5 | MCP / 界面 | ✅ | **未新增工具，工具数仍 27**；`ecclaw_document_preview` 描述与参数一字未改；界面无变化（仍是「XLSX 预览」标签 + `doc-preview-text`） |
| 6 | 依赖 | ✅ | **无新增**（沿用 `fflate@0.8.3`）；新增的 `xl/styles.xml` 同样受 `MAX_ENTRY_BYTES = 16MB` 约束 |
| 7 | e2e + 回归 | ✅ | `phase3y-e2e.cjs` **31/31**；run56 十一套 **371/371**（phase3y 31 · 3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14，FAIL 全 0）；未跑真站 phase3s/3q（本阶段红线：不碰淘宝） |

第二十四阶段实证发现：

1. **`m` 在格式码里是「月」还是「分」要看邻居**：`mm:ss` 的 m 是分（紧邻秒之前）、`m/d/yy` 的 m 是月（既不挨着 h 也不挨着 s）。
   只认「有没有 m」会把 `mm:ss`（时长）误判成日期。
2. **内置 numFmtId 不能凭记忆写，要能被同一套分析器消化**：把 14/17/20/21/22/45/46 等内置 id 映射成格式码，
   再喂给**和自定义格式同一个** `analyzeFormatCode()` → 只有一套判定逻辑，不会两处口径打架。
3. **Excel 的 1900 历元有假闰日**：号 ≥ 61 的要减 1 天才能对上公历；号 60 是不存在的 1900-02-29（单独按字面输出）。
   1904 历元（Mac 老文件）基准不同，靠 `workbookPr@date1904="1"` 区分。
4. **只转数值型单元格**：日期样式挂到共享字符串上时**不能转**（转了就毁内容）→ 判断放在 `type === 'n'` 分支内。
5. **「该不该转」比「怎么转」更容易出错**：本轮专门造了三个反例钉住行为 —— 无样式的纯数字（`45000` 保持原样）、
    时长格式 `[h]:mm:ss`（`1.5` 保持原样）、自定义非日期格式 `0.00`（`12.5` 保持原样）。

## 第三十三阶段（2026-11-05）：XLSX 单位 / 工程 / 会计格式 + 日期 locale 本地化 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 缩放逗号 | ✅ | `parseNumberPattern()` **整体重写**：数值占位段改在**掩码串 `masked` 上扫描**（字面量位置已挖空 → `"12"0.00` 的 12 不再被当成占位段）；占位段**末尾的逗号 = 缩放逗号**（每个 ÷1000），整数位中间的逗号 = 千分位；`#,##0,,` → 12345678 出 `12`、`#,##0.0,,` → `12.3`、`0.0,` → 1234 出 `1.2`（此前小数点后的尾逗号**被漏掉**，出 `1234.0,`） |
| 2 | 工程计数法 | ✅ | `SciPattern` 增 `engineering`（判据 = **小数点前数字占位槽 ≥2**：`##0` / `###`）；`renderScientific()` 对齐后 `exp = floor(exp/3)*3`、尾数落在 `[1,1000)`；`##0.0E+0` → 12345 出 `12.3E+3`、`##0.00E+00` → `12.35E+03`、负数 `-12.3E+3`、小数 `123.0E-6`；**只有 1 个槽（`0.0E+0`）仍是科学计数法**（`1.2E+4`） |
| 3 | 会计格式 | ✅ | 整数位改走 `renderIntSlots()`：**Excel 槽位语义** —— `0` 槽没数字显示 0、`#` 槽不显示、`?` 槽显示空格、数字右对齐填最右槽、槽不够不截断；零值时整数位的 0 **不占 `?` 槽** → 会计零段 `_($* "-"??_)` 只出横线；四段式 → 正 `$1,234.50` / 负 `$(1,234.50)` / 零 `$-`；`*` 填充与 `_` 宽度占位**丢弃**（对齐留白在纯文本里不可见 → 紧凑输出） |
| 4 | 日期 locale | ✅ | `DateTokenType` 增 `'locale'`；`tokenizeDateCode()` 的 `[` 分支识别 `[$-804]` / `[$-0804]` → 命中即产生 locale token、**不产生字面量**（否则前缀会漏进输出）；`renderDateCode()` 按 zh 出 `3月` / `三月` / `周三` / `星期三` / `上午`·`下午`；`flattenFormatSection()` 的 `[` 分支**显式跳过** locale 前缀 |
| 5 | 触发口径（关键取舍） | ✅ | **只有带 locale 前缀才本地化**；没前缀（`mmm d, yyyy` → `Mar 15, 2023`）或英文 locale（`[$-409]`）**一律保持英文** —— 不误伤 phase3y/3z/4d 既有断言 |
| 6 | 输出与契约 | ✅ | **只改 `electron/main/document-preview.ts` 一个文件**；契约 / host-bridge / MCP 参数**未动** → **工具数仍 27**，仍无必填参数；**无新增依赖**；无 UI 改动 |
| 7 | e2e + 回归 | ✅ | `phase4h-selftest.cjs` **42/42**（37 行整行相等 + 行数 + kind + error + 2 条负向断言：除中文 locale 用例外整表不得出现中文月/星期/上下午）；`phase4h-e2e.cjs` **48/48**（工具面 3 · 抽取 40 · 界面 4；产物 `run66-phase4h.log`）；**全量回归 run66 十九套 628/628**（4h 48 · 4g 30 · 4f 26 · 4e 21 · 4d 31 · 4c 26 · 4b 18 · 4a 20 · 3z 37 · 3y 31 · 3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14，FAIL 全 0；摘要 `run66-summary.txt`）。phase4d 两条期望值随工程格式修正同步更新。未跑真站 phase3s/3q |

第三十三阶段实证发现：

1. **掩码层不只是给字面量用的**：旧 `parseNumberPattern()` 在**扁平串**上用 regex 找占位段，
   `"12"0.00` 的 `12` 会被当成占位段；改成在**掩码串**（字面量位置挖空）上扫描后，
   「哪里是结构」和「哪里是文字」彻底分开 —— 顺带修了旧 regex 在 flat 上匹配的隐患。
2. **缩放逗号被漏掉的根因是同一个**：旧 regex 的 `core` 模式**不含小数点后的尾逗号** →
   `0.0,` / `#,##0.0,,` 的缩放整体失效（不是判错，是压根没识别）。
3. **工程格式的尾数归一化不能套科学计数的规则**：科学计数法要「尾数 ≥10 就归 1、指数 +1」，
   工程格式的尾数落在 `[1,1000)` —— 套用同一条会把 `12.3E+3` 压回 `1.23E+4`。
   → 归一化条件必须**按 `pat.engineering` 分叉**，这是本轮最后一个 bug。
4. **工程 vs 科学的判据是「小数点前占位槽数 ≥2」**（Excel 的口径）：
   `##0.0E+0` / `##0.00E+00` 是工程格式，`0.0E+0` / `0.00E+00` 是科学计数法。
   内置格式 48 = `##0.0E+0` → 内置 48 同样要按工程走。
5. **会计零段 `$-` 靠的是「零不占 `?` 槽」**：Excel 的 `_($* "-"??_)` 里 `??` 是「两位、不够就补空格」，
   零值时那个 `0` 不该被渲染出来 → 只留横线。规则不写这一条就会出 `$-0`。
6. **`normalizeText()` 是全局行为，槽位补出来的对齐空格在纯文本里必然看不见**
   （`/[ \t\u00a0]+/ → ' '` 把连续空格压成 1 个，且行首空格被 `.trim()` 掉）。
   → 会计格式只能**紧凑输出**（`$1,234.50` 而不是 `$   1,234.50`）—— 这是**设计取舍，不是漏做**，
   已写进 README §5.37。
7. **locale 前缀必须「不产生字面量」**：`[$-804]` 若被当成普通 `[...]` 内容，会在输出里漏出 `-804`。
   修法是在分词层就发一个 `locale` token，并在展平层**显式跳过**（不是「碰巧不漏」）。
8. **本地化只在有 locale 前缀时触发**：Excel 里 `mmm` 默认跟随系统 locale，
   但本工具是**纯文本抽取**，没有系统 locale 概念 → 选了「无前缀保持英文」的口径，
   避免把 phase3y/3z/4d 已有的英文月份断言全改掉（改动面小、回归风险低）。
9. **负向断言要检查「值」而不是整行**：自测里用 `[月星期上下午…]` 扫整行会**误伤标签本身**
   （标签 `无locale-英文月` 里就有「月」）→ 必须先切掉 `label | ` 前缀再扫值。
10. **改了行为就必须同步改旧断言**：phase4d 断言的 `科学一位` / `科学内置48` 原本期望 `1.2E+4`，
    工程格式修正后应变成 `12.3E+3` —— 这是**行为修正**（Excel 本来就是这样），不是回归；
    已同步更新 phase4d 自测 / e2e 的期望值，并在 README §5.33 注明工程格式规则。

## 第三十四阶段（2026-11-05）：XLSX 日期 locale 扩展 + 文本格 `@` 字面量 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 选题（探针先行） | ✅ | 开打前用 `make-phase4i-probe.cjs` / `probe-4i.cjs` / `make-phase4i-probe2.cjs` **实测** phase4h handoff §9 的候选清单 → 「日期 duration `[h]:mm:ss`」与「科学计数法负指数 / `E-`」**早已实现且与 Excel 一致**（候选过期）；真缺口只有 **locale 扩展**（`[$-411]/[$-407]/[$-40C]/[$-404]` 全回落英文 `Mar`）与**文本格 `@`**（`"¥"@` → `abc`，Excel 是 `¥abc`）两项。顺带纠正 §9 的 LCID 错误：`[$-407]` 是**德语**不是法语（法语 `0x40C`，日语 `0x411`，§9 写的 `[$-041]` 无此 LCID） |
| 2 | locale 表 | ✅ | 删 `isZhLocale()`；新增 `MONTH_JA/WEEK_JA_*`、`MONTH_DE_*`、`MONTH_FR_*` 表；`type LocaleLang = 'zh'\|'zhTW'\|'ja'\|'de'\|'fr'\|'en'`；`interface LocaleNames`（`monthStyle: 'latin'\|'zh'\|'cjkNum'`、`weekStyle: 'latin'\|'zh'`）；`LOCALE_NAMES` 表；新增 `localeKind(localeId)`（LCID 去前导 0 + 小写 → locale，**认不出返回 null 落英文**）与 `renderMonthName()` / `renderWeekName()` |
| 3 | renderDateCode 改造 | ✅ | 头部 `zh` 布尔 → `lang: LocaleLang` + `names = LOCALE_NAMES[lang]` + `cjkAmPm`；switch 里 `'m'`/`'d'` 改走 `renderMonthName`/`renderWeekName`；`'ampm'`/`'ap'` 用 `names.am/pm`；`'eh'/'em'/'es'` 置 `inDuration = true`；新增 `let inDuration = false` |
| 4 | 文本格 `@` | ✅ | 新增 `renderTextCell(value, code)`：取格式码**第 4 段**（不足 4 段取第 1 段）→ `flattenFormatSection()` → 在**掩码串**上找**结构 `@`** → 输出 `前缀字面量 + 文本 + 后缀字面量`；**无结构 `@` 的格式段不生效**（`0.00` 套文本仍出 `abc`）。表格文本格分支（`t="s"`/`inlineStr`/`str`）接入 |
| 5 | duration 一致性小修 | ✅ | 进入 duration 上下文（`eh`/`em`/`es` 之后）后，`mm`/`ss` 改从 `totalSec` 取模（`h`=总小时、`m`=总分钟 mod 60、`s`=总秒 mod 60）；旧实现取的是**当天时钟**的 `p.mi`/`p.ss`（平时恰等于总时长的 mod 60，**亚秒舍入边界会差 1 秒**）。**输出实测不变** |
| 6 | 输出与契约 | ✅ | **只改 `electron/main/document-preview.ts` 一个文件**；契约 / `host-bridge.ts` / `host-server.mjs` / `src/App.tsx` **全不动** → **MCP 工具数仍 27**、仍无必填参数；**无新增依赖**；zh-CN 与英文输出**一字未动**（phase4h 既有断言继续绿） |
| 7 | e2e + 回归 | ✅ | `phase4i-selftest.cjs` **47/47**（41 行整行相等 + 行数 + kind + error + 4 条负向断言）；`phase4i-e2e.cjs` **53/53**（工具面 3 · 抽取 45 · 界面 5；产物 `run67-phase4i.log`）；**全量回归 run67 二十套 681/681 全绿**（4i 53 · 4h 48 · 4g 30 · 4f 26 · 4e 21 · 4d 31 · 4c 26 · 4b 18 · 4a 20 · 3z 37 · 3y 31 · 3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14，FAIL 全 0；摘要 `run67-summary.txt`）。未跑真站 phase3s/3q |

第三十四阶段实证发现：

1. **上一份 handoff 的 §9 候选清单会过期**：「日期 duration」与「科学计数法负指数」两条
   phase4h 就已经实现了（探针实测与 Excel 一致）→ **照抄候选表会白做一遍**。
   下一轮**先探针实测再选题**，别直接抄。
2. **§9 的 LCID 也可能写错**：`[$-407]` 被当成法语（实为德语），法语是 `0x40C`，日语是 `0x411`。
   locale 类需求**先核 LCID 表**再动手。
3. **文本格的 `@` 只能靠掩码串区分**：`"a@b"@` 里的 `@` 是字面量、`@` 是结构占位符 ——
   两者在扁平串上长得一样。`flattenFormatSection()` 产出的 `text` 与 `masked` **等长**，
   所以**掩码下标可直接当字面量下标用**（前缀 / 后缀字面量按掩码位置切）。
4. **`@` 的位置不限**：Excel 允许 `"预"@"后"`，所以不能只认「前缀 + @」一种形状，
   必须按掩码里 `@` 的位置切前后两段。
5. **纯数字格式对文本格不生效**是必须钉住的行为（Excel 也如此）：
   `0.00` 套文本 → `abc`，不能顺手把数字格式化逻辑套上去。
6. **locale 只影响「名称」，不连带改日期先后顺序**：格式码 `d/m/y` 就按 `d/m/y` 输出，
   不因 locale 变成 `m/d/y` → 输出**可复现**，也不会误伤 phase3y/3z 的既有英文断言。
7. **负向断言要扫「值」不扫整行，且文本用例要排除**：
   标签 `文本-第四段` 本身含中文 → 整行扫会误伤；文本用例自带中文字面量（`预abc后`）
   → 也不能进「非 CJK locale 行」的 CJK 检查。
8. **上下文 160K 硬闸门会拦 Bash**：本轮上半场就撞上一次（164K 时只放行 Write/Edit）。
   → **写代码前先估「还要读多少」**；长文件读一次后**只引用路径**；大改动前先把设计敲定、少回头读。

## 第三十五阶段（2026-11-06）：DOCX 结构保真（标题层级 / 多级列表编号 / 粗斜体 / 页眉页脚脚注） ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 选题（探针先行） | ✅ | 开打前用 `make-phase4j-probe.cjs` / `probe-4j.cjs` / `probe-4j-office.cjs` **实测** phase4i handoff §9 的候选清单 → 「文本 `@` 剩余形状」是真缺口但**价值低**（边角）；「日期 locale 边角」被既有决定排除；「`containsBlanks`」需改空白格输出结构、回归面大；**`expression` 条件格式**（`$E5>40` / `MOD(ROW(),2)=0`）是真缺口但**价值中** → 留作下一轮候选。**新轴实测（DOCX/PPTX）**发现结构丢失最明显（DOCX 标题层级 / 列表编号 / 粗斜体 / 页眉 / 脚注全丢；PPTX 表格被摊平成独立行、备注丢失）→ **本轮改选 DOCX 结构保真**（PPTX 表格 + 备注 = 下一轮候选） |
| 2 | DOCX 部件一次解出 | ✅ | 新增 `DocxParts` 接口 + `readDocxParts(filePath)`：**替换**原 `readDocxXml()`，一次解出 `word/document.xml` + `styles.xml` + `numbering.xml` + `footnotes.xml` + `header*.xml` + `footer*.xml`（仍走 `fflate`，`MAX_ENTRY_BYTES` 约束不变） |
| 3 | 标题层级 | ✅ | `parseDocxStyles()` → styleId → 标题级别（style 自带 `outlineLvl` **优先**，否则 `headingLevelFromStyleName()` 从名字取数字，认 `heading N` 与 `标题 N`）；`renderDocxParagraph()` 输出 `#` ~ `######` |
| 4 | 多级列表编号 | ✅ | `parseDocxNumbering()`：numId → abstractNumId → ilvl → `{numFmt, lvlText, start}`；`formatListNumber()` / `docxListLabel()` 按 `numFmt` 渲染 decimal / lowerLetter / upperLetter / lowerRoman / upperRoman / 中文数字（`toAlpha` / `toRoman` / `toChineseNumber`），按 `lvlText` 的 `%n` 槽位拼多级前缀；本级 +1、更深层计数器清零；缩进每级 2 空格（哨兵 `DOCX_INDENT = '\u0000'` 占位，`normalizeText` 归一化后再还原成空格） |
| 5 | 粗斜体 | ✅ | `docxRuns()` / `docxRunsText()`：run 级 `w:b` / `w:i` → `**x**` / `*x*` / `***x***`（`docxToggleOn()` 判 `w:val="0"` / `"false"` 关闭态）；**表格单元格内同样应用**（`docxCellText(cell, ctx)`），标题与列表标记不应用 |
| 6 | 页眉 / 页脚 / 脚注 | ✅ | `docxHeaderLines()` 取 `header*.xml` 段落置顶 `[页眉] …`、`footer*.xml` 置底 `[页脚] …`；`parseDocxFootnotes()` + `docxFootnoteNumbers()` 按**引用顺序**编号，正文引用处内联 `[N]`（`w:footnoteReference` 在 run 内），脚注块在正文后出 `[脚注]` |
| 7 | 输出与契约 | ✅ | **只改 `electron/main/document-preview.ts` 一个文件**；契约 / `host-bridge.ts` / `host-server.mjs` / `src/App.tsx` **全不动** → **MCP 工具数仍 27**、仍无必填参数；**无新增依赖**；界面 `DOCX · 文本预览` 标签沿用（`pre` 块保留换行） |
| 8 | e2e + 回归 | ✅ | `phase4j-selftest.cjs` **30/30**（20 行整行相等 + 行数 + kind + error + 7 条负向断言）；`phase4j-e2e.cjs` **39/39**（工具面 3 · 抽取 23 · 负向 7 · 界面 6；产物 `run68-phase4j.log`）；**全量回归 run68 二十二套 720/720 全绿**（4j 39 · 4i 53 · 4h 48 · 4g 30 · 4f 26 · 4e 21 · 4d 31 · 4c 26 · 4b 18 · 4a 20 · 3z 37 · 3y 31 · 3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14，FAIL 全 0；摘要 `run68-summary.txt`）。未跑真站 phase3s/3q |

第三十五阶段实证发现：

1. **候选清单会过期（第二次印证）**：phase4i handoff §9 的候选里，`expression` 条件格式是真缺口但价值中、
   文本 `@` 剩余形状是真缺口但价值低；而真正值得做的是**上轮没测过的新轴**（DOCX / PPTX 结构丢失）。
   → **每轮先探针实测 + 扫新轴，再选题**，别照抄上一份候选表。
2. **`normalizeText` 会把连续空格压成一个**：列表缩进（2 空格 / 4 空格）在归一化后全塌成 1 格。
   解法：**哨兵占位**（`DOCX_INDENT = '\u0000'`）→ 归一化后再替换成空格；断言要盯**缩进宽度**。
3. **Edit 工具写入 `\u0000` 会落成真 NUL 字节**：源码变 binary（grep 报 `Binary file matches`）。
   落笔后必须扫一遍 NUL 并替换成源码转义文本（引号内 / 正则内两种位置都成立）。
4. **`tsc` 显式列文件时 `--rootDir` 与 `--outDir` 要配套**：
   `--rootDir electron --outDir .../tsout` → 产物落在 `tsout/main/*.js`（自测 require 的路径）；
   `--rootDir electron --outDir .../tsout/main` → **多套一层 `main/`**，自测 require 到**旧文件** → **假绿**。
   坑点在于「旧文件仍在原地」不会报错。
5. **`outlineLvl` 优先于 style 名**：Word 的 `Heading1` 自带 `outlineLvl`；中文版 style 名是 `标题 1`。
   两条路都得认（`outlineLvl` 优先、名字兜底）。
6. **多级编号的计数器要按层级清零**：本级 +1、更深层归 1，否则 `2.1.` 之后会连成 `2.3.`。
7. **相邻 run 的 markdown 标记会首尾相撞**：`普通` + `**粗体**` + `*斜体*` + `***粗斜***` 拼出
   `普通**粗体***斜体****粗斜***`（斜体的收尾 `*` 与粗斜的开头 `***` 相连成 4 个星号）——
   逐 run 语义正确（`**` / `*` / `***`），但**整行**看是 4 星号，断言按**实际输出**写，别按直觉写。
8. **上下文 160K 硬闸门仍会拦 Bash**：上一会话在 164K 时被拦（只放行 Write/Edit）→ 被迫落 WIP handoff。
   教训不变：写代码前估「还要读多少」，长文件读一次后只引用路径。

## 第三十六阶段（2026-11-06）：PPTX 结构保真（表格列关系 / 演讲者备注 / 图片 alt） ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 选题（探针先行） | ✅ | 承接 phase4j handoff §4 候选 1（PPTX 表格 + 备注，探针已实测确认），**不重做探针**；`expression` 条件格式留作下一轮候选（价值中） |
| 2 | 扫描器通用化 | ✅ | 把 `docxChildElements` 抽成 `xmlChildElements(content, containerTags, wanted)`，**多存 `open` 字段**（开始标签原文 —— `gridSpan` 是 `a:tc` 自己的属性，只能从开始标签读）；DOCX 版仍走原容器标签，**行为逐字不变**（phase4j selftest 30/30 复验通过） |
| 3 | PPTX 表格 → Markdown | ✅ | `p:graphicFrame` → `a:tbl` → `a:tr` / `a:tc`；首行作表头 + `\| --- \|` 分隔行，**缺列补空**（复用 `markdownCell()`）；`pptxTableMarkdown()` |
| 4 | 合并单元格（与 DOCX 同口径） | ✅ | 横向 `gridSpan="N"` → 内容只放首格、其余 N−1 格补空（后续列位与其它行对齐）；纵向 `rowSpan` / `hMerge` / `vMerge` → 内容留起始格、续格补空；`gridSpan` 上限复用 `MAX_GRID_SPAN` = 32 |
| 5 | 演讲者备注 | ✅ | 按幻灯片自己的 `ppt/slides/_rels/slideN.xml.rels` 找 `notesSlide`（`relTargetByType()` 按 `Type` 结尾匹配 + `resolveRelTarget()` 拼路径，**不按编号猜**）；取 **body 占位符**多段文字（空格连接），落在**页内末尾** `[备注] …`；`pptxNotesText()` |
| 6 | 图片 alt | ✅ | `p:pic` 的 `p:nvPicPr` 里 `cNvPr@descr` → `[图片: 营收趋势折线图]`；**没有 descr 的图片不产生噪音行**；`pptxPictureAlt()` |
| 7 | 占位符降噪 | ✅ | `p:ph@type` 为 `sldNum` / `dt` / `hdrFtr` / `ftr` 的形状**整页跳过** → 页码域文字（`<a:fld><a:t>2</a:t>`）不混进正文；组合形状 `p:grpSp` 递归展开，`p:sp` 靠 `p:grpSp` 被跟踪才不会误判为直接子级 |
| 8 | 输出与契约 | ✅ | **只改 `electron/main/document-preview.ts` 一个文件**；契约 / `host-bridge.ts` / `host-server.mjs` / `src/App.tsx` **全不动** → **MCP 工具数仍 27**、仍无必填参数；**无新增依赖**；界面沿用 `PPTX · 文本预览` 标签 |
| 9 | e2e + 回归 | ✅ | `phase4k-selftest.cjs` **27/27**（16 行整行相等 + 行数 + kind + error + 8 条负向断言）；`phase4k-e2e.cjs` **35/35**（工具面 3 · 抽取 19 · 负向 8 · 界面 5；产物 `run69-phase4k.log`）；**全量回归 run69 二十三套 755/755 全绿**（4k 35 · 4j 39 · 4i 53 · 4h 48 · 4g 30 · 4f 26 · 4e 21 · 4d 31 · 4c 26 · 4b 18 · 4a 20 · 3z 37 · 3y 31 · 3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14，FAIL 全 0；摘要 `run69-summary.txt`）。未跑真站 phase3s/3q |

第三十六阶段实证发现：

1. **容器标签表里多一个 `p:sld` 就全灭**：`p:sld` 是最外层包装，跟踪它会让 `<p:cSld>` 落在**深度 1**
   → `xmlChildElements` 只在「栈空」时收节点，直接子级扫描直接空数组（**不报错、只是全空**，最难查）。
2. **单元格文字体是 `a:txBody`（不是 `p:txBody`）** → 容器标签表必须**同时**含 `p:txBody` 与 `a:txBody`，
   否则表格全空而形状文字正常（症状分裂，容易误判成「表格没抽到」而不是「标签写错」）。
3. **属性只能从开始标签读**：`gridSpan` 挂在 `<a:tc gridSpan="2">` 上，**不在 body 里**；
   把 `XmlElement` 加一个 `open` 字段存开始标签原文，比在 body 里正则瞎找靠谱。
4. **备注要按 slide 自己的 rels 找**：`notesSlide` 的编号与 slide 编号**不一定对得上**（可能有多张 notesSlide、
   可能缺）→ 只能按 rels 里的 `Type` 结尾匹配 + `resolveRelTarget()` 拼相对路径。
5. **占位符不降噪就会漏出页码**：`<a:fld><a:t>2</a:t>` 是**域代码**不是正文，
   不跳过就会在正文里多出一行孤零零的「2」（看着像页码污染，其实是形状类型没过滤）。
6. **通用化扫描器是复利**：`docxChildElements` → `xmlChildElements` 只多一个参数，
   DOCX 行为逐字不变（selftest 30/30 复验），PPTX 直接复用 —— **不要为第二个格式复制一份扫描器**。
7. **调试断点要靠复刻扫描器定位**：`dbg-4k.cjs` 复刻一份 `xmlChildElements` 逐步打印
   「cSld 找到几个 / spTree 找到几个 / 子形状标签列表」，**比在产品代码里插日志快**（且不污染工作区）。
8. **NFKC 归一化会改中文全角标点**：期望值里的「，」「。」在输出里是「,」「.」→ 断言按**实际输出**写。

## 第三十七阶段（2026-11-06）：DOCX / XLSX 链接与批注（超链接目标 + 审阅意见） ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 选题（探针先行） | ✅ | 承接 phase4k handoff §4 候选清单，**第 4 次被推翻** —— 实测 9 条轴后选定「链接 + 批注」；理由：URL / 审阅意见是**不可再生信息**，条件格式 / 图表属表现层 |
| 2 | 公共关系层 | ✅ | 新 `RelEntry` 接口 + `parseRelEntries(xml)`（Id / Target / **Type**，Target 走 `decodeXmlEntities`）；`parseRels()` 改为在其之上的**薄封装**（**行为不变**）；新 `isExternalTarget()`（`/^[a-zA-Z][a-zA-Z0-9+.\-]*:/`）—— 外部 Target 不能过 `resolveRelTarget()`（`https://…` 会被当 zip 内路径拼坏） |
| 3 | XLSX 超链接 | ✅ | `<hyperlink ref r:id>` → `xl/worksheets/_rels/sheetN.xml.rels` 的 Target（外部 URL 原样、内部 `location=` 原样）；**ref 是区间时区内每格都挂**（`xlsxRefCellKeys()`，上限 `MAX_LINK_CELLS` = 4096 格防爆炸）；`parseXlsxHyperlinks()` / `xlsxCellExtras()` |
| 4 | XLSX 批注 | ✅ | `xl/commentsN.xml` 的 `<comment ref authorId>` 按 ref **精确匹配**单元格、作者取 `<authors>` 里 `authorId` 对应名、**同格多条按出现顺序全列**；部件路径**优先**取 sheet rels 里 Type 以 `/comments` 结尾者，**兜底按命名约定找 `xl/comments{N}.xml`**（N 取工作表序号）—— 工具产出的文件常不写 sheet rels |
| 5 | DOCX 超链接 | ✅ | `<w:hyperlink r:id>` → `word/_rels/document.xml.rels` 的 Target；`<w:hyperlink w:anchor="书签">` → `#书签`；`docxHyperlinkTargets()` |
| 6 | DOCX 批注 | ✅ | `word/comments.xml` 的 `<w:comment w:id w:author>` + 正文里 `<w:commentRangeStart w:id>` **所在段落**；`parseDocxComments()` / `docxCommentIds()` / `docxExtras()`；段落文本为空但有批注时**只输出批注** |
| 7 | 落位与顺序 | ✅ | **宿主文本 → 链接 → 批注 → 颜色标记仍在最末**（既有输出前缀逐字不变）；XLSX 挂在单元格值后（`parseXlsxSheet()` 的 `filled` 过滤改为「有值 **或** 有标记」，否则纯标记格会被丢掉）；DOCX 挂在段落文本后（`#` 标题前缀之后），表格单元格内走 `markdownCell()` 转义 |
| 8 | 输出与契约 | ✅ | **只改 `electron/main/document-preview.ts` 一个文件**；契约 / `host-bridge.ts` / `host-server.mjs` / `src/App.tsx` **全不动** → **MCP 工具数仍 27**、仍无必填参数；**无新增依赖**；**无链接无批注的文件输出逐字不变** |
| 9 | e2e + 回归 | ✅ | `phase4l-selftest.cjs` **41/41**（4 夹具整行相等 + 行数 + kind + error + 正向标记计数 + 负向「无标记文档不产生标记」）；交叉复验 `phase4j-selftest.cjs` **30/30** / `phase4k-selftest.cjs` **27/27**（既有 DOCX / PPTX 输出逐字不变）；`phase4l-e2e.cjs` **37/37**（工具面 3 · 抽取 21 · 负向 7 · 界面 6；产物 `run70-phase4l.log`）；**全量回归 run70 二十四套 792/792 全绿**（4l 37 · 4k 35 · 4j 39 · 4i 53 · 4h 48 · 4g 30 · 4f 26 · 4e 21 · 4d 31 · 4c 26 · 4b 18 · 4a 20 · 3z 37 · 3y 31 · 3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14，FAIL 全 0；摘要 `run70-summary.txt`）。未跑真站 phase3s/3q |

第三十七阶段实证发现：

1. **候选清单会过期 —— 这是第 4 次**：phase4k handoff §4 的清单第 4 次被实测推翻。
   **先探针扫新轴再选题**，别照抄上一轮的清单（9 条轴实测：expression 条件格式解析了但永不命中、
   colorScale/dataBar/iconSet 整条丢弃、超链接 URL 丢失、批注部件完全不读、合并单元格其实已隐式处理）。
2. **`parseRels()` 只返回 Target 就认不出「哪条关系是 comments 部件」** → 必须拆出带 `Type` 的
   `parseRelEntries()`，`parseRels()` 做薄封装保持行为不变（PPTX 备注那套仍在用）。
3. **XLSX 批注部件可能根本不在 sheet rels 里**：真实 Excel 由 sheet rels 指向 `commentsN.xml`，
   但工具产出的文件**不写 rels** → 必须留**命名约定兜底**（`xl/comments{N}.xml`，N = 工作表序号），
   **两条路径都要有测试覆盖**（probe-comment.xlsx 走 rels / probe-comment2.xlsx 走兜底）。
4. **外部 Target 不能过 `resolveRelTarget()`**：`https://…` 会被当 zip 内相对路径拼坏 →
   先判 `isExternalTarget()` 再决定走哪条路。
5. **「有值 或 有标记」的过滤改动容易被漏**：纯批注格**没有值**，若 `filled` 仍按「有值」过滤 → 批注整格消失。
6. **区间 ref 要逐格展开**：`A2:A3` 的链接挂在**两格**上，不是只挂首格；展开上限防恶意大区间打爆内存。
7. **DOCX 批注要认 `w:commentRangeStart` 所在段落**：批注正文在 `comments.xml`，**落位**靠正文里的 range 标记，
   只读 comments.xml 会得到一堆无处安放的批注。
8. **改完正则常量立刻 typecheck**：一次 Edit 漏了收尾 `/` → `TS1161: Unterminated regular expression literal`。

## 第三十八阶段（2026-11-06）：XLSX 公式 + DOCX 修订痕迹（计算依据 + 谁改的） ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 选题（探针先行） | ✅ | 承接 phase4l handoff §8 候选清单，**第 5 次被推翻** —— 实测 **13 条轴**后选定「XLSX 公式 + DOCX 修订痕迹」；**文本框 / 内容控件（`w:sdt`）实测根本不是缺口**（已有输出天然覆盖）；expression 条件格式是真缺口但要公式求值器，未选 |
| 2 | XLSX 公式 | ✅ | `<f>` 公式体（decode 实体 / trim / **不带 `=`**）→ 值后追加 `[公式: …]`；`t="array"` 数组公式按普通公式输出；`t="shared"` 的 follower **只有 si 没有体** → 两遍扫描建 `si → master 公式体` Map 再回填，标 `[公式: 共享 <master公式体>]`（**不做相对引用重写**） |
| 3 | DOCX 修订 | ✅ | `<w:ins>` / `<w:del>` / `<w:moveFrom>` / `<w:moveTo>` 四类块**按文档顺序**取；插入类文本取 `<w:t>`、删除类取 `<w:delText>`（`docxDeletedText()`）→ 段落末尾 `[修订+<作者>: <文本>]` / `[修订-<作者>: <文本>]`；**只输出作者不输出日期**；moveFrom / moveTo 分别按删除 / 插入语义处理 |
| 4 | 落位与顺序 | ✅ | XLSX **值 → 公式 → 链接 / 批注 → 颜色标记最末**；DOCX **宿主文本 → 修订 → 链接 → 批注**；XLSX `filled` 过滤放行「空值但有公式」的格；DOCX 表格单元格同样走 `renderDocxParagraph()` → 修订标记自动落位 |
| 5 | 输出与契约 | ✅ | **只改 `electron/main/document-preview.ts` 一个文件**；契约 / `host-bridge.ts` / `host-server.mjs` / `src/App.tsx` 全不动 → **MCP 工具数仍 27**；**无新增依赖**；**无公式无修订的文件输出逐字不变** |
| 6 | e2e + 回归 | ✅ | `phase4m-selftest.cjs` **72/72**（8 夹具整行相等 + 行数 + kind + error + 正向标记计数 + 负向）；交叉复验 `phase4l-selftest.cjs` **41/41** / `phase4j-selftest.cjs` **30/30** / `phase4k-selftest.cjs` **27/27**（既有 DOCX / XLSX / PPTX 输出逐字不变）；`phase4m-e2e.cjs` **50/50**（工具面 3 · 抽取 32 · 负向 9 · 界面 6；产物 `run71-phase4m.log`）；**全量回归 run71 二十五套 842/842 全绿**（FAIL 全 0；摘要 `run71-summary.txt`）。未跑真站 phase3s/3q |

第三十八阶段实证发现：

1. **候选清单会过期 —— 这是第 5 次**：phase4l handoff §8 的清单第 5 次被实测推翻（13 条轴）。
   **先探针扫新轴再选题**。本轮还证伪了两条「疑似缺口」：
   **文本框**（`v:textbox`）与**内容控件**（`w:sdt`）里的文字**本来就已经在输出里**
   （`docxRuns` 全局扫 `<w:r>` 天然覆盖）→ 不是缺口。
2. **XLSX 公式的三种形态要分开处理**：普通公式 / 数组公式（`t="array"`）**都有公式体**，
   只有共享公式的 **follower 只有 `si` 没有体** → 必须两遍扫描建 `si → master 体` 的 Map 再回填；
   **别在单元格循环里就地解析**（那时还没遇到 master）。
3. **共享公式不做相对引用重写**：follower 的真实公式是 `A2*2` 这类相对引用，
   重写要实现引用平移（易错且对 agent 无意义）→ 统一标「共享 <master 公式体>」，宁粗勿错。
4. **DOCX 修订最容易踩的坑：正文流别重复加 `w:ins` 文本** —— `docxRuns` 全局扫 `<w:r>`
   **已经包含**插入内容（探针实测正文有「新增的内容」），本轮只加**署名标记**，
   否则插入文本会输出两遍。
5. **段落标记修订（`<w:pPr><w:rPr><w:ins/></w:rPr></w:pPr>`）也是 `w:ins`**：
   必须靠「块内含 run 文本」判定排除，否则纯格式段落会冒出空修订标记。
   **自闭合标签要用「属性段是否以 `/` 结尾」判定**，不能裸匹配 `[^>]*`
   （自闭合 `<w:ins/>` 会一路吞到后面某个 `</w:ins>`，把别人的内容算成自己的）。
6. **`<w:delText>` 也要 decode 实体**（复用 `docxParagraphText()` 的口径）。
7. **空值格带公式要放行**：XLSX `filled` 过滤若仍按「有值」过滤 → `=0` 的公式格整格消失。
8. **顺序要一次定死**：XLSX 值 → 公式 → 链接 / 批注 → **颜色恒在最末**；
   DOCX 文本 → 修订 → 链接 → 批注（修订在最前，因为它解释的是正文本身）。

## 第三十九阶段（2026-11-06）：PPTX 超链接 + PPTX 批注（点向哪里 + 谁说了什么） ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 选题（探针先行） | ✅ | 探针扫 **13 根新轴**（不照抄 4m 候选表）后选定 —— **候选清单第 6 次被推翻**。判据是**一致性缺口**：4l 已把链接/批注补给 DOCX / XLSX，PPTX 是三者里唯一缺的。同时实测确认真缺口但本轮不选：DOCX 尾注、`docProps/core.xml` 元数据、DOCX 图片 alt、DOCX 批注回复、PDF 链接/注释/元数据、XLSX 定义名称/数据有效性；非缺口：DOCX TOC 域（域结果已在输出）、XLSX 隐藏行列、XLSX 富文本 |
| 2 | PPTX 超链接 | ✅ | slide rels 里 Type 以 `/hyperlink` 结尾 → `rId` → Target（`pptxLinkTargets()`）；页面 `a:hlinkClick` 的 `r:id` 查表 → `[链接: <目标>]`（`pptxLinkMarks()`）；**只有带协议的外部目标才输出**，内部跳转（`ppaction://hlinksldjump` / 指向其它 slide）不输出。**形状级**链接单独从 `p:cNvPr` 取（`pptxShapeLinkMarks()`），段落级扫 `a:p` —— 两处分开，互不混入 |
| 3 | PPTX 批注 | ✅ | slide rels 里 Type 以 `/comments` 结尾 → 部件（旧的 `ppt/comments/comment1.xml` / 新的 `modernComment_*.xml`），用新增 `relTargetsByType()` 取**全部**（一页可能挂多个批注部件）；**两代格式都认**：旧 `p:cm`（正文 `p:text`）/ 新 `p188:cm`（正文 `p188:txBody` 的 `a:t`）；作者从 `ppt/commentAuthors.xml` / `ppt/authors.xml` 按 `authorId` 查，查不到留空，只出作者不出日期 |
| 4 | 落位与顺序 | ✅ | 段落内链接挂该段落行末；形状级链接与归属批注挂该形状**首个块**末尾（图片挂 `[图片: alt]` 行）；批注按 `p:cm@idx` 匹配形状 `p:cNvPr@id`；**挂不到形状的批注落该页末尾**，**备注仍在最后一行**；顺序恒为 **文本 → 链接 → 批注**；**`p:graphicFrame` 表格不挂形状级标记**（会破坏 Markdown 表） |
| 5 | 输出与契约 | ✅ | **只改 `electron/main/document-preview.ts` 一个文件**；契约 / `host-bridge.ts` / `host-server.mjs` / `src/App.tsx` 全不动 → **MCP 工具数仍 27**；**无新增依赖**；**无链接无批注的 PPTX 输出逐字不变**；备注页调用 `pptxShapeLines()` 不传 ctx → 行为不变 |
| 6 | e2e + 回归 | ✅ | `phase4n-selftest.cjs` **74/74**（9 夹具整行相等 + 行数 + kind + error + 正向标记计数 + 负向；先 RED 58/74）；交叉复验 `phase4m-selftest.cjs` **72/72** / `phase4l-selftest.cjs` **41/41** / `phase4j-selftest.cjs` **30/30** / `phase4k`（PPTX 输出逐字不变）；`phase4n-e2e.cjs` **78/78**（工具面 3 · 抽取 54 · 负向 6 · 界面 4；产物 `run72-phase4n.log`）；**全量回归 run72 二十六套 920/920 全绿**（FAIL 全 0；摘要 `run72-summary.txt`）。未跑真站 phase3s/3q |

第三十九阶段实证发现：

1. **候选清单会过期 —— 这是第 6 次**：phase4m handoff §8 的清单第 6 次被实测推翻（13 根新轴）。
   **先探针扫新轴再选题**，别照抄上轮候选表。
2. **选题看一致性缺口**：DOCX / XLSX 已有链接与批注、PPTX 独缺 —— 同类信息在三种格式间的不对称，
   是最好找也最好解释的选题；且能完全复用现成的 `parseRelEntries` / `isExternalTarget` / `resolveRelTarget`。
3. **PPTX 批注有两代格式**：旧 `p:cm` + `ppt/commentAuthors.xml`；新 `p188:cm`（正文在 `p188:txBody` 里的
   `a:t`）+ `ppt/authors.xml`。**只认一种就会让另一代格式的 PPTX 批注整条丢失**。
4. **作者表的容器标签不能当作者**：`p:cmAuthor` / `p188:author` 是作者，
   `p:cmAuthorLst` / `p188:authorLst` 是容器 → 正则必须靠 `\b` 卡住，否则会产出一个名字叫 "Lst" 的假作者。
5. **形状级链接必须单独从 `p:cNvPr` 里取**：段落级扫 `a:p` 抓不到它（它挂在形状属性上）；
   反过来全文扫 `a:hlinkClick` 又会把形状级混进段落级。**两处分开取、各自落位**。
6. **自闭合标签第三次踩**：`p:cNvPr .../>` 用裸 `[^>]*` 匹配会一路吞到后面某个 `</p:cNvPr>`
   → 用 `(\/>|>[\s\S]*?<\/p:cNvPr>)` 分支（与 DOCX 修订同一套路）。
7. **表格不能挂形状级标记**：`p:graphicFrame` 转出来的 Markdown 管道表，行尾追加任何标记都会破坏表结构
   → 显式 `continue` 跳过。
8. **一页可能有多个批注部件**：`relTargetByType()` 只返回第一个（留给备注页用），
   批注必须用新加的 `relTargetsByType()` 取全部。

## 第四十三阶段（2026-11-06）：DOCX 尾注 / 图片 alt / 批注回复 ✅

**改了什么**（只改 `electron/main/document-preview.ts`，MCP 工具数仍 27，无新增依赖）：

1. **尾注**：新部件 `word/endnotes.xml` 入抽取清单；脚注管道参数化（`docxNoteNumbers` /
   `parseDocxNotes` 按 kind），正文引用处内联 `[N]`、文末 `[尾注]` 段排在 `[脚注]` 段之后。
2. **图片 alt**：`docxRuns` 识别 `<wp:docPr>`，`descr` 优先、`title` 兜底，实体解码后内联
   `[图片: …]`；两者皆空不出标记；`name` 不进输出。
3. **批注回复**：`parseDocxComments` 附带每条批注首段 `paraId`；新函数 `buildDocxCommentThreads`
   解析 `commentsExtended.xml` 的 `commentEx paraId→paraIdParent`，回复摊平挂根输出
   `[回复(作者): 文本]`；回复自带的 `commentRangeStart` 跳过；父指向未知批注 → 独立批注；成环 seen 兜底。

**第四十三阶段实证发现**：
- 脚注与尾注**各自独立编号**，同段可出现 `脚[1]尾[1]` —— 属正常（靠段标题区分），不是 bug。
- `paraIdParent="` 接不上 `paraId="` 正则（`Parent` 挡在 `="` 前），本地名匹配天然安全。
- alt 标记进 `docxRuns` 后自动覆盖正文 + 表格单元格两条 run 渲染路径；
  `docxParagraphText` 纯文本路径（脚注/批注正文）不受影响 —— 正是既有口径。
- 无回复链部件的文档走不进新分支 → 输出逐字不变（th3/mix1 双断言锁死回归红线）。

## 第四十二阶段（2026-11-06）：docProps 扩展（app.xml + custom.xml） ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 选题（探针先行） | ✅ | `phase4p-probe.cjs` 实测 b3/b6/b8 三格式 fixture 各缺 4/4（Application / Company / 2 条自定义属性）；既有套件 fixture 无 app.xml（grep 确认），改动不会污染旧期望 |
| 2 | 解析 | ✅ | 新增 `DOC_APP_PROPS_ENTRY` / `DOC_CUSTOM_PROPS_ENTRY` / `parseAppProps()` / `parseCustomProps()` / `docPropsLines()`；三格式读取部件时一并解出 app/custom；**按本地名匹配**，XML 实体解码 |
| 3 | 落位与输出 | ✅ | core + app 合成一行 `[文档信息] … 应用 · 公司 · 页数 · 字数`；custom 单独一行 `[自定义属性] 名称: 值 · …`，紧跟其后；DOCX 在页眉前、PPTX 在 `[幻灯片 1]` 前、XLSX 在 `[工作表 …]` 前 |
| 4 | 容错与边界 | ✅ | 空字段逐个省略、全空不出行；无 app/custom 输出逐字不变；畸形 `app.xml` 不抛异常、不出半截值；`vt:vector` 按 `A, B` 拼接；空名/空值跳过；PPTX `<Slides>` 不输出（与实际页数重复） |
| 5 | 输出与契约 | ✅ | **只改 `electron/main/document-preview.ts` 一个文件**；契约 / `host-bridge.ts` / `host-server.mjs` / `src/App.tsx` 不动 → **MCP 工具数仍 27**；**无新增依赖**；无 UI 改动 |
| 6 | 自测 + e2e + 回归 | ✅ | `phase4q-selftest.cjs` **23/23**（合并 / 仅 app / 仅 custom / 无 docProps / 空部件 / 三格式落位 / 任意前缀 / 实体 / 畸形 / vector / 截断）；`phase4q-e2e.cjs` **22/22** → `run75-phase4q.log`；全量回归 run75 二十九套 **980 PASS / 1 FAIL**（`run75-summary.txt`）：唯一失败 phase3r C3 仍为事件库超 2000 条的既有环境失败，其余二十八套全绿；未跑真站 phase3s/3q |

第四十二阶段实证发现：

1. **`Application` 的值因厂商而异**：`Microsoft Office Word` / `Microsoft Word` / `LibreOffice` 都常见。
   探针里把预期写成 `Microsoft PowerPoint`、fixture 写 `Microsoft Office PowerPoint`，就产生一条假红 ——
   断言别把厂商串写死。
2. **`custom.xml` 的值类型任意**：`vt:lpwstr` / `vt:lpstr` / `vt:bool` / `vt:date` … 不能只认一种；
   先剥标签再解实体即可，`vt:vector` 的多段值要按 `A, B` 拼。
3. **app.xml / custom.xml 与 core.xml 同路径**（`docProps/`），三格式共用一套解析与同一套空值规则。
4. **新增元数据会改变所有带 app.xml 的既有输出**：本轮 grep 过全部 e2e 脚本，只有
   `phase4p-make.cjs` 造了 app.xml，既有套件 fixture 都没有 → 回归不受影响；
   以后给旧 fixture 补 app.xml 必须同步改断言。
5. **PPTX 的 `<Slides>` 不输出**：它可能与实际幻灯片数不一致，输出两个数字会打架；真实页数以抽取结果为准。

## 第四十一阶段（2026-11-06）：PDF 链接 / 注释 / 表单域 / 元数据 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 选题（探针先行） | ✅ | 探针 `phase4p-probe.cjs` 复验上轮候选并扫新轴（19 fixture / 51 探针串 / 3 个控制组全绿）；PDF 四类信息（链接 / 注释 / 表单域 / 元数据）均实测为真缺口；候选清单本轮**未出现新的过期项** |
| 2 | 解析 | ✅ | 新增 `PdfAnnotation` / `PdfPage.getAnnotations?()` / `PdfDocument.getMetadata?()`（跟 `getOutline` 同套路：可选方法 + 运行时兜底）；新函数 `pdfDateText()` / `pdfInfoLine()` / `pdfMetadataLine()` / `pdfDestPage()` / `pdfAnnotationMarks()` |
| 3 | 落位与输出 | ✅ | 元数据置顶一行 `[文档信息] 标题 · 作者 · 主题 · 关键词 · 创建工具 · 生成器 · 创建时间 · 修改时间`；链接 / 跳转 / 注释 / 表单域标记挂在**每页正文之后**；日期 `D:20260101120000Z` → `2026-01-01 12:00:00`，认不出原样返回；页号解析不出写 `[跳转: 内部链接]` 不猜 |
| 4 | 容错 | ✅ | `getAnnotations` / `getMetadata` 不存在或读失败 → 跳过、不影响正文；**没有注释、没有元数据的 PDF 输出与改动前逐字一致**（自测第 2 组守这条） |
| 5 | 输出与契约 | ✅ | **只改 `electron/main/document-preview.ts` 一个文件**（+131 / −3）；契约 / `host-bridge.ts` / `host-server.mjs` / `src/App.tsx` 不动 → **MCP 工具数仍 27**；**无新增依赖**；无 UI 改动 |
| 6 | 自测 + e2e + 回归 | ✅ | `phase4p-selftest.cjs` **18/18**；`phase4p-e2e.cjs` **22/22**（工具面 · 抽取 · 界面）→ `run74-phase4p.log`；全量回归 run74 二十八套 **958 PASS / 1 FAIL**（摘要 `run74-summary.txt`）：唯一失败 phase3r C3 为**事件库超 2000 条**导致回放硬上限截断（`host-events.ts:409`）的既有环境问题，与本轮无关；其余二十七套全绿。未跑真站 phase3s/3q |

第四十一阶段实证发现：

1. **手搓 PDF fixture 的对象编号容易错位**：catalog=1 / pages=2 / page=3 / font=4 / content=5，
   **注释从 6 开始**。把注释写成 5 → `/Annots` 指到 content stream → 表单域整段丢失（会被误判成产品 bug）。
2. **PDF 中文串要按 UTF-16BE + BOM 写成十六进制串**（`<FEFF…>`）：`Buffer.from(s,'latin1')`
   会把中文截成低字节 → pdfjs 读出来是乱码（`Title: "PDF ⁄c\u0007Ÿ"`），**不是产品问题**。
3. **表单域必须要有 `/AcroForm`**（catalog 里 `<< /AcroForm << /Fields [...] >> >>`），
   否则 pdfjs 不把 Widget 当表单域，`fieldName` / `fieldValue` 都是空。
4. **DOCX 文本框文字其实抽得到**：`docxRuns` 的非贪婪正则意外把文本框里的 `w:t` 一起吞了 ——
   **别再把它当缺口**（本轮探针第 4 次证伪候选）。
5. **PDF 注释取的是 `contentsObj.str` / `titleObj.str`**，不是 `contents` / `title`；
   表单域取 `fieldName` / `fieldValue`；这三点在 pdfjs 的类型里都容易看错。

## 第四十阶段（2026-11-06）：三格式文档属性（谁写的、什么时候改的） ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 选题（探针先行） | ✅ | 复验 7 根候选 + 扫 3 根新轴后选定 —— **候选清单第 7 次部分过期**。非缺口：DOCX 页眉页脚（含 `PAGE` 域）、XLSX 隐藏工作表内容（原本已覆盖）；真缺口：三格式 `docProps/core.xml`、DOCX 尾注、DOCX 图片 alt（`wp:docPr@descr`）、DOCX 批注回复、PDF 链接/注释/元数据、XLSX 定义名称/数据有效性。选 docProps 的判据：**三格式同时缺、一个函数即可共用、不改契约** |
| 2 | 解析 | ✅ | 新增 `DOC_CORE_PROPS_ENTRY` / `DocCoreProps` / `parseCoreProps()` / `corePropsLine()`；取 `title` / `creator` / `lastModifiedBy` / `modified`；**按本地名匹配**（`<(?:[\w.-]+:)?title>`），不硬编码 `dc:` / `cp:` / `dcterms:` 前缀 |
| 3 | 落位与输出 | ✅ | 置顶一行 `[文档信息] 标题: … · 作者: … · 修改人: … · 修改时间: …`；DOCX 在页眉前、PPTX 在 `[幻灯片 1]` 前、XLSX 在 `[工作表 …]` 前；**空字段逐个省略，四个全空或无部件一行不出**；PPTX / XLSX 元数据与正文紧邻（不额外插空行） |
| 4 | 容错 | ✅ | 畸形 `core.xml`（标签未闭合）不抛异常、不输出半截值；无 `docProps` 的文件**输出逐字不变**；`maxChars` 截断时元数据仍在（它在最前） |
| 5 | 输出与契约 | ✅ | **只改 `electron/main/document-preview.ts` 一个文件**（+71 / −8）；契约 / `host-bridge.ts` / `host-server.mjs` / `src/App.tsx` 不动 → **MCP 工具数仍 27**；**无新增依赖** |
| 6 | 自测 + e2e + 回归 | ✅ | `phase4o-selftest.cjs` **17/17**（全字段 / 仅标题 / 无部件 / 空 core / 畸形 / 任意前缀 / 截断）；交叉复验 phase4n **74/74** · phase4m **72/72** · phase4l **41/41** · phase4j **30/30** · phase4k **27/27**；`phase4o-e2e.cjs` **17/17**（工具面 2 · 抽取 11 · 界面 4）→ `run73-phase4o.log`；全量回归 run73 二十七套 **936 PASS / 1 FAIL**（摘要 `run73-summary.txt`）：唯一失败 phase3r C3，根因是**事件库超 2000 条、回放硬上限 2000** 导致参照样本截断（`host-events.ts:409`），与本轮改动无关；复跑还出现 G3/G4 实时事件流时序抖动，进一步说明是该套件在脏环境下的既有问题。其余二十六套全绿。未跑真站 phase3s/3q |

第四十阶段实证发现：

1. **候选清单第 7 次部分过期**：上轮列的「DOCX 页眉页脚」实测**早已覆盖**（含 `PAGE` 域），
   「XLSX 隐藏工作表」内容也已在输出里。**每轮都要重新探针**，不能照抄。
2. **XML 前缀不能硬编码**：`dc:` / `cp:` / `dcterms:` 只是惯例，前缀可任意绑定；
   解析 `core.xml` 必须按**本地名**匹配，否则非 Word 生成的文档元数据整段丢失。
3. **PPTX / XLSX 的块间用 `\n\n`**：元数据若 `push` 成独立 block，会在元数据行与 `[幻灯片 1]` /
   `[工作表 …]` 之间多一个空行（DOCX 用 `\n` 拼接不会）。正确做法是拼好 body 后前缀 `meta + '\n'`。
4. **同一个「图片 alt」在两种格式里位置不同**：DOCX 在 `wp:docPr@descr`，PPTX 在 `p:nvPicPr` 的
   `cNvPr@descr`。既有实现只做了 PPTX —— **别按概念推断“已完成”**。
5. **元数据要「有则出、无则不出」**：空字段逐个省略比整行照搬更重要，否则每份文档都带一串空标签。

## 第三十二阶段（2026-11-05）：XLSX 区间级条件格式（top10 / 均值 / 重复值） ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 主进程：区间级规则判定 | ✅ | 新增 `RANGE_LEVEL_CF_TYPES`（top10 / aboveAverage / duplicateValues / uniqueValues）、`rangeLevelCfMatches()`（按 sqref 每段范围算命中集合）、`matchRangeLevelCf()`、`sampleStdDev()`（样本标准差 n−1）、`dupKey()`；`XlsxCfRule` 增 `id` / `rank` / `percent` / `bottom` / `aboveAverage` / `equalAverage` / `stdDev` |
| 2 | 主进程：抽取流程改三趟 | ✅ | `parseXlsxSheet()` 由「一趟」拆成 **①解析全部单元格 → ②按范围算命中集合 → ③逐格套颜色**；`conditionalColors()` 增 `rangeMatches` 参数，区间级规则查命中集合、逐格规则照旧按当前格子的值判定；**命中与否预先算成一张「行:列 → 命中」表**，逐格渲染时查表 |
| 3 | 判定口径 | ✅ | `top10`：`rank` 默认 10、`percent` 时取名次 = `ceil(个数×百分比)`、`bottom` 取最小 N 项，并列按「≥ 阈值」（bottom 为「≤ 阈值」）；`aboveAverage`：范围内数值均值，`aboveAverage="0"` 改低于均值，`equalAverage` 含等于均值，`stdDev` 改「偏离均值超过 1 个样本标准差」；`duplicateValues` / `uniqueValues`：出现两次 / 只出现一次，文本大小写不敏感、**数字与文本不同类** |
| 4 | 边界与不做项 | ✅ | **多区域 sqref 按每段独立统计**（Excel 对多区域选择的语义有歧义，单区域是绝大多数情况）；范围内无数值 / 数据不足 → 规则不命中（fail-safe）；**`containsBlanks` / `notContainsBlanks` 本轮不做**（要改空白格渲染，回归面大）；**图形类规则**（colorScale / dataBar / iconSet）与 `expression` 仍跳过 |
| 5 | 输出与契约 | ✅ | **输出通道不变**：仍走既有 `[颜色:X;底色:Y]` 标记，不新增文本标记、不破坏既有输出；**只改 `electron/main/document-preview.ts` 一个文件**；契约 / host-bridge / MCP 参数**未动** → **工具数仍 27**，仍无必填参数；**无新增依赖**；无 UI 改动 |
| 6 | e2e + 回归 | ✅ | `phase4g-selftest.cjs` **55/55**（52 行整行相等，含全部「未命中不得带标记」的负向断言）；`phase4g-e2e.cjs` **30/30**（工具面 3 · 抽取 23 · 界面 4；产物 `run65-phase4g.log`）；**全量回归 run65 十九套 580/580**（4g 30 · 4f 26 · 4e 21 · 4d 31 · 4c 26 · 4b 18 · 4a 20 · 3z 37 · 3y 31 · 3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14，FAIL 全 0；摘要 `run65-summary.txt`）。上轮 phase3y 挂死的根因是 e2e `send()` 无超时，本轮打 90s 超时补丁后通过。未跑真站 phase3s/3q |

第三十二阶段实证发现：

1. **「逐格判定」的架构天花板**：§5.32 的条件格式是**拿到一个格子就判一次**，
   而 top10 / 均值 / 重复值**必须先看整段范围** —— 同一个 `conditionalColors()` 里根本拿不到别的格子的值。
   绕过办法（只判当前格、猜它是不是第一）必然错；正解是**先解析完全部单元格再回头判**。
2. **三趟式抽取是通用解法**：把「解析 → 判定 → 渲染」拆开，中间加一趟「按范围预聚合」，
   区间级规则就能查表命中；逐格规则不用改逻辑（继续走原来的 `matchCfRule`）。
   代价只是多一次遍历 —— 换来 4 类原本被丢弃的规则。
3. **规则要有稳定 id**：命中集合按规则索引，但 `conditionalColors()` 里规则数组会先 `map` 再 `filter` 再 `sort`，
   数组下标容易错位 → 给每条规则在解析时发一个 `id`（`out.length`），命中集合按 `id` 索引，与排序无关。
4. **排名并列要按「≥ 阈值」而不是「取前 k 个」**：`rank=2` 而前两名数值相同时，
   按名次切会漏掉并排的那一格，按阈值切才与 Excel 一致；`rank` 大于个数时**全部命中**（阈值退化为最小值）。
5. **`percent` 的名次要向上取整**：`ceil(个数 × 百分比)`；4 个值取前 25% → 1 个（不是 0 个）。
6. **重复值比较：数字与文本不同类**：数字 `5` 与文本 `"5"` **不算重复**（键前缀区分 `n:` / `t:`），
   文本比较**大小写不敏感**（与 Excel 一致）。
7. **`stdDev` 用的是样本标准差（n−1）**，不是总体标准差；差一个分母会直接改变命中边界。
8. **「等于均值」不能用 `===` 比**：均值是除法结果，浮点误差会让恰好等于均值的格子判成不等 → 用 `1e-9` 容差。
9. **多区域 sqref 的语义有歧义**：Excel 对 `sqref="A1:A5 C1:C5"` 到底是「两段合起来排名」还是「各段独立排名」
   没有明确文档。本轮选**各段独立**（条件格式的 sqref 区域本身是独立语义），
   单区域是绝大多数情况 → 两种口径等价；已在 README §5.36 与本表写明，避免以后当成既定事实。
10. **负向断言比正向断言值钱**：52 行期望全部按「整行相等」比对 —— 未命中的格子必须**一个颜色标记都没有**，
    只断言命中项的话，「本不该有颜色的格子多了个颜色」这类回归根本测不出来。

## 第三十一阶段（2026-11-05）：PDF 目录（书签）导航 + 页码范围抽取 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 主进程：目录解析 | ✅ | 新增 `readPdfOutline()` + `outlineDestPage()`：读 pdfjs 的 `getOutline()`，dest 三形态（命名目标 / 目标数组 / 其它）分别处理，页面引用经 `getPageIndex` 换成 1 起的页码；**解析不出来 → page = null（不猜页码）**；限深 `MAX_OUTLINE_DEPTH = 8` 防畸形文件自引用；**解析失败一律当「没有目录」，不影响正文抽取** |
| 2 | 主进程：页码范围抽取 | ✅ | `previewDocument()` 增 `startPage` / `endPage`：越界一律夹住（`startPage` → `[1,total]`，`endPage` → `[start,total]`），只给 start 抽到末尾、只给 end 从第 1 页抽起，`start > end` 夹成同一页，NaN 退回全文；与 `maxPages`（上限 200）叠加；返回带 `pageStart` / `pageEnd`；范围没覆盖全文 → `truncated = true` |
| 3 | 契约 / agent | ✅ | `electron/shared/types.ts` 增 `DocumentOutlineNode`，`DocumentPreview` 增 `pageStart?` / `pageEnd?` / `outline?`；`electron/main/host-bridge.ts` 透传 startPage / endPage；`resources/mcp/host-server.mjs` 的 `ecclaw_document_preview` 增两个可选参数并在描述里说明；**工具数仍 27**，仍无必填参数 |
| 4 | 界面：目录面板 | ✅ | `src/App.tsx`：目录树摊平成带层级的扁平列表（`flattenOutline`），PDF 预览顶部渲染目录面板，**点目录项 → `showPage(path, page)` 直接跳页**；没有书签就不显示面板；`src/styles.css` 配套样式 |
| 5 | 依赖 / 红线 | ✅ | **无新增依赖**（沿用 `pdfjs-dist`）；位图仍只给界面、不返回 agent；未跑真站 phase3s / phase3q（不碰淘宝） |
| 6 | e2e + 回归 | ✅ | `phase4f-selftest.cjs` **38/38**；`phase4f-e2e.cjs` **26/26**（产物 `run64-phase4f.log`）；**全量回归 run64 十八套 550/550 全绿**（FAIL 全 0，摘要 `run64-summary.txt`；未跑真站 phase3s/3q）。首轮 phase3v 红 1 条 = **套件断言陈旧**（把 `document_preview` 参数个数写死成 4，phase4f 新增 `startPage`/`endPage` 后必然红）→ **只改脚本**（`props.length === 4` → `>= 4`）、**零产品改动**，复跑 29/29 |

第三十一阶段实证发现：

1. **夹页码时两个端点的默认值要分开**：`startPage` 不给 → 默认第 1 页，`endPage` 不给 → 默认**最后一页**。
   早先两端共用同一个「非法值退回 min」→ `endPage` 不给时退回第 1 页，整篇只剩 1 页
   （秒级自测一轮就抓出 6 条红：全文页数 / pageEnd / truncated / 只给 startPage / NaN / 旧夹具回归）。
2. **`maxPages` 只能「从头取 N 页」**：agent 想看长文档第 80 页附近时，原来只能拿到前 200 页 →
   `startPage` / `endPage` 补上「只抽这一段」；两者**叠加**生效（范围再被 maxPages 截）。
3. **书签目标解析不出来就不给页码**：`page = null` 比猜一个页码安全 —— 猜错了点一下会跳到别的页，比不跳更糟。
4. **目录是加分项，不能拖累正文**：解析 outline 失败一律当「没有目录」，绝不让整份预览失败。
5. **目录树先摊平成带层级的扁平列表再渲染**：递归组件不好定位（测试没法按序号点），
   摊平后既能按缩进显示层级，也能按序号稳定定位。
6. **PDF 目录是现成能力，不用自己解析 xref**：pdfjs 的 `getOutline()` + `getPageIndex()` 直接给页码，
   自己按对象号反推页序反而容易错（对象号 ≠ 页序）。
7. **老套件把「工具参数个数」写死，新加可选参数就会假红**：phase3v 断言
   `document_preview 参数 = path/name/maxPages/maxChars` 用的是 `props.length === 4` —— 本轮新增
   `startPage` / `endPage` 后必然红（实测 28/29）。这是**脚本 bug 而非产品 bug**（本轮 e2e 自己断言了
   这两个参数存在且范围抽取生效）→ 改成 `props.length >= 4`（保留「四个老参数都还在」的原意，
   只去掉易碎的个数钉死），复跑 **29/29**。教训：断言「某参数存在」别断言「参数总数恰好是 N」。

## 第三十阶段（2026-11-05）：PDF 多页缩略图 + 指定页 / 缩放渲染参数 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 主进程缩略图渲染 | ✅ | 新增 `renderDocumentThumbs()`：抽 `openPdfDoc()` 复用解析；缩略图按**目标宽度**归一（默认 132 px，夹 48–400）而不是固定 scale —— 页面尺寸不一（A4 595 / Letter 612）时固定 scale 会让缩略图宽窄不一；**先铺白底再渲染**（PDF 页面本身透明，不铺底会发黑）；一次最多 `MAX_THUMBS = 24` 张；页码越界/非法值直接过滤 |
| 2 | 渲染参数打通 | ✅ | `renderDocumentPage` 的 `scale` 从 IPC 透到界面（`files:preview-image` 加第三个参数）；新增 `files:preview-thumbs`；preload `renderPage(path, page?, scale?)` + 新增 `renderThumbs(path, pages?, width?)`；`electron/shared/types.ts` 加 `DocumentPageThumbs` |
| 3 | 界面：缩略图条 | ✅ | 以当前页为中心的**连续 12 页**窗口，点击切页，当前页 `data-active` 高亮；窗口随当前页滑动；**已渲染过的页命中缓存不重复渲染**（`thumbsRef` 同步记缓存，不能等 React 提交）；缩略图条带 busy / error 提示 |
| 4 | 界面：指定页 / 缩放 | ✅ | 页码输入框 + 「跳转」按钮（越界由主进程夹住）；缩放七档 50/75/100/150/200/300%（主进程夹 0.5–3）；换档后当前页按新倍率重渲 |
| 5 | 工具 / 依赖 | ✅ | **工具数仍 27**；`ecclaw_document_preview` 的参数与描述**一字未改**；位图仍**只给界面**、不返回 agent（不把 base64 灌进上下文）；**无新增依赖**；改动跨 `document-preview.ts` / `types.ts` / `preload/index.ts` / `main/index.ts` / `App.tsx` / `styles.css` |
| 6 | e2e + 回归 | ✅ | `phase4e-e2e.cjs` **21/21**；秒级自测 **33/33**；run63 十七套 **524/524**（4e 21 · 4d 31 · 4c 26 · 4b 18 · 4a 20 · 3z 37 · 3y 31 · 3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14，FAIL 全 0）；未跑真站 phase3s/3q（本阶段红线：不碰淘宝） |

第三十阶段实证发现：

1. **缩略图要按「目标宽度」归一，不能按固定 scale**：PDF 页面尺寸不一（A4 595 / Letter 612 / 横向），
   固定 scale 渲出来的缩略图宽窄不一、排不齐；先取 `scale:1` 的 viewport 拿原始宽度，
   再用 `width / base.width` 反推 scale，宽窄才一致（高度按各页高宽比走，仍有轻微差异）。
2. **画布尺寸要用 `round` 而不是 `ceil`**：`scale` 是除法算出来的，`viewport.width` 常是
   `400.00000000000006` 这种值，`ceil` 会把它顶成 **401** → 缩略图比目标宽多 1 px，宽度就不归一了。
3. **PDF 页面本身是透明的**：不先铺白底，缩略图会是一片黑（`fillStyle` + `fillRect` 铺一层再渲染）。
4. **缩略图缓存判断不能等 React 提交**：用 `setState` 的 updater 判断「缺哪几页」会读到旧值 →
   改用 `thumbsRef` 同步记缓存、`setState` 只负责渲染（两处都写）。
5. **窗口跟随当前页，别固定在前 N 页**：长文档（30 页以上）固定前 12 页就没法用缩略图导航 →
   窗口取「以当前页为中心的连续 12 页」，翻页/跳转后窗口自动挪。
6. **e2e 里别把表达式当字符串嵌进表达式**（本轮踩的坑）：
   `(() => { const m = ${JSON.stringify(metaText)}; ... })()` 里 `m` 拿到的是**源码字符串**而不是求值结果，
   断言永远不成立 → 4 条假红。正确写法是直接把取值的代码内联进去。

## 第二十九阶段（2026-11-05）：XLSX 科学计数法 / 分数格式 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 掩码层（技术核心） | ✅ | `flattenFormatSection()`：一次产出**等长的 text + masked**（掩码符 `\u0001`）—— text 保留字面量内容、masked 把字面量位置换成掩码符，两串下标一一对应；结构判定全走 masked、取字面量全走 text。没有这层，`"E"0.00` / `"a/b"0.00` 会被误判成科学计数法 / 分数格式 |
| 2 | 科学计数法 | ✅ | `parseScientificPattern()` / `renderScientific()`：`0.00E+00` → `1.23E+04`、`##0.0E+0` → `1.2E+4`；内置 11/48 生效；尾数按格式小数位四舍五入，**进位到 10 时尾数归 1、指数加 1**；指数位数取格式里 `0` 的个数（至少 1）；`E+` 正指数带 `+`、`E`/`E-` 只负指数带号；负数走第 2 段，单段自动补 `-` |
| 3 | 分数格式 | ✅ | `parseFractionPattern()` / `renderFraction()` / `bestFraction()` / `formatInt()`：`# ?/?` → `2 1/2`、`?/?` → `1/2`、`# ?/4` → `0 1/4`（**固定分母不约分**）；槽位宽度当**位数上限**（分子分母各最多 N 位）；整数位单独拆出（`#` 空 → 整个值当分数）；小数四舍五入成 1 时进位到整数；**输出不做槽位对齐补空格**（与 Excel 差异仅在对齐空格） |
| 4 | 最佳有理逼近 | ✅ | `bestFraction()` 用**连分数收敛分数**（不是就近取整 —— 就近取整会把 `0.3` 取成 `2/7`，Excel 给 `1/3`）；分子超限时退一步「分子分母都不超上限的就近取」，仍无解 → 保留原值 |
| 5 | 回退口径 | ✅ | `parseNumberPattern()` 改用摊平函数并加 **masked 兜底**：原来只按摊平文本判 `E+` / `/`，漏掉**裸 `E`**（`0.00E0` 会被当普通数字渲成 `1.23E0`）→ 现在这类一律回退原值；分子放不下 / 畸形格式同样保留原值，不硬解 |
| 6 | 工具 / 依赖 | ✅ | **工具数仍 27**；无新增依赖（沿用 `fflate@0.8.3`）；只改 `electron/main/document-preview.ts` 一个产品文件；`trimDecSlots()`（小数位槽位收尾）从原 `renderNumberCode` 抽出，两处共用 |
| 7 | e2e + 回归 | ✅ | `phase4d-e2e.cjs` **31/31**；秒级自测 **24/24**；run62 十六套 **503/503**（4d 31 · 4c 26 · 4b 18 · 4a 20 · 3z 37 · 3y 31 · 3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14，FAIL 全 0）；未跑真站 phase3s/3q（本阶段红线：不碰淘宝） |

第二十九阶段实证发现：

1. **掩码层是这类需求的通解，不只是科学计数法专用**：格式段里**引号中的 `E`、斜杠是字面量不是结构**；
   摊平时同时产出 `text`（字面量保留内容）与 `masked`（字面量位置换成掩码符），**两串下标一一对应**
   → 结构判定走 masked、取字面量走 text，一步到位。（同理适用于将来加的会计 / 工程 / 单位格式。）
2. **「就近取整」不等于「最佳有理逼近」**：分数格式里 Excel 给的是**连分数收敛分数** ——
   就近取整会把 `0.3` 取成 `2/7`，Excel 给 `1/3`；这是本轮最容易做错的一步。
3. **槽位宽度当位数上限，不当对齐宽度**：`?/?` → 分子分母各最多 1 位；
   输出**不做对齐补空格**（预览文本里不留悬空空格）—— **与 Excel 的差异仅在对齐空格**，已写进 README §5.33。
4. **固定分母不约分**：`# ?/4` 遇 0.5 → `2/4`（Excel 同样不约分）。
5. **尾数进位要回补**：9.999 按两位小数四舍五入 → 10.00 → 尾数归 1、指数加 1。
6. **口径变更只改测试脚本、不改产品**：phase3z 那条「科学计数不支持 → 保留原值 1234.5」是**旧口径断言**，
   本轮实现科学计数法后变成 `科学计数 | 1.23E+03` → 改脚本断言即可（与第二十四/二十五阶段改日期输出口径同型）。

## 第二十八阶段（2026-11-05）：XLSX 颜色信息 + 条件格式 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 格式段颜色 | ✅ | `[Red]` / `[Blue]` / `[Color10]` 按正/负/零段取色（`pickFormatSection`）；文本取第 4 段 `[Blue]@`；`[ColorN]` 原样输出 |
| 2 | 静态字体色 / 填充色 | ✅ | `cellXfs[i].fontId/fillId` → `fonts.xml` / `fills.xml`；只认显式 rgb，theme/indexed 一律不报；黑字 / none / 白底不报 |
| 3 | 条件格式 | ✅ | `conditionalFormatting@sqref` + `dxfs`；cellIs 8 种 + containsText/notContainsText/beginsWith/endsWith；priority 升序 + stopIfTrue 截断；colorScale/dataBar/iconSet/expression 跳过 |
| 4 | 呈现口径 | ✅ | 值后追加 `[颜色:红]` / `[底色:黄]` / `[颜色:红;底色:黄]`；8 基础色中文名，其它 `#RRGGBB`；无颜色时输出与旧版一字不差 |
| 5 | 工具 / 依赖 | ✅ | **工具数仍 27**；无新增依赖；只改 `electron/main/document-preview.ts` 一个文件 |
| 6 | e2e + 回归 | ✅ | `phase4c-e2e.cjs` **26/26**；秒级自测 **20/20**；run60 十五套 **472/472**（4c 26 · 4b 18 · 4a 20 · 3z 37 · 3y 31 · 3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14，FAIL 全 0）；未跑真站 phase3s/3q |

第二十八阶段实证发现：

1. **dxf 的填充色不是 `<color>`**：字体色用 `<color rgb>`，填充色用 `<fgColor>/<bgColor>`；
   复用字体色提取器会让条件格式的底色全丢（首版实测 cfGreater / cfBetween / cfStop 三条红）。
2. **颜色必须分层定优先级**：条件格式 > 格式段颜色 > 静态字体色，否则同一格会冒出互相矛盾的颜色；
   底色只有条件格式 / 静态填充两个来源。
3. **图形类条件格式不要硬算**：colorScale / dataBar / iconSet 的颜色是插值或图标，不是单个 rgb；
   跳过并保留其余规则，比猜一个颜色更可靠。

## 第二十七阶段（2026-11-05）：DOCX 单元格内嵌表格 → 深度感知抽取 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 根因定位 | ✅ | 非贪婪正则 `/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g` 在**内层** `</w:tc>` 提前收尾；旧实现在同一份夹具上把外层表拆成两行、内层列被当外层列（`phase4b-before.cjs` 留证） |
| 2 | 深度感知取子级 | ✅ | 新增 `docxChildElements(content, wanted)`：栈式配对，只跟踪 `w:tbl\|w:tr\|w:tc\|w:p` 四种容器；错配闭标签忽略不猜；自闭合按空子元素 |
| 3 | 四层改走深度解析 | ✅ | `extractDocxText()`（正文段落 / 表格）、`docxTableMarkdown()`（行 / 格）、`docxCellText()`（段落 / 内嵌表）全部改用栈式取直接子级 |
| 4 | 内嵌表呈现口径 | ✅ | 内嵌表按**行摊平进所在格**（每行一行、行内列以 ` \| ` 分隔 → 渲染 `<br>` 换行）；内容与位置不丢；内层列不撑开外层列；合并格里嵌表仍按跨度补空 |
| 5 | 工具/依赖 | ✅ | **工具数仍 27**；无新增依赖；只改 `electron/main/document-preview.ts` 一个文件 |
| 6 | e2e + 回归 | ✅ | `phase4b-e2e.cjs` **18/18**；秒级自测 10/10；run59 十四套 **446/446**（4b 18 · 4a 20 · 3z 37 · 3y 31 · 3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14，FAIL 全 0）；未跑真站 phase3s/3q |

第二十七阶段实证发现：

1. **"非贪婪正则"在 XML 上不是安全默认**：它假设标签不嵌套，而 Word 表格**天然可嵌套**
   （单元格套表格是排版常规手法）→ 一旦嵌套，外层闭合标签在内层，匹配提前收尾。
   正确做法是按容器标签做栈式配对，只取**直接子级**。
2. **Markdown 套不了表格**：内嵌表无法再套一层管道表 → 按行摊平进所在格（`<br>` 分行、` \| ` 分列），
   位置与内容都不丢，比丢弃或塞成纯文本更可用。
3. **夹具本身也会骗人**：首版夹具把 `<w:tc>` 套了两层（`tcMix(tcSpan(...))`），
   断言「合并含子表」失败 —— 是**夹具 bug 不是产品 bug**，改成 `tcSpanMix()` 后通过。
   另有一处断言期望写错（三层嵌套那张表只有一列，行尾**无**补空格）。

## 第二十六阶段（2026-11-04）：DOCX 合并单元格 → Markdown 表格 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 横向合并 gridSpan | ✅ | `docxCellSpan()`：只认紧跟 `<w:tc>` 的首个 `w:tcPr`；内容在首格、其余补空（列位与其它行对齐）；上限 32；`0`/缺失/非数字 → 1 |
| 2 | 纵向合并 vMerge | ✅ | `restart` 格保留内容，续格空（值不重复出现）；续格自带文本照常输出（fail-safe）；无需专门分支 |
| 3 | 边界 | ✅ | 两个表格各自出分隔行；表格前后段落顺序不变；畸形跨度 `999` 截到 32 列 |
| 4 | 工具/依赖 | ✅ | **工具数仍 27**；无新增依赖 |
| 5 | e2e + 回归 | ✅ | `phase4a-e2e.cjs` **20/20**；秒级自测 8/8；run58 十三套 **428/428**（4a 20 · 3z 37 · 3y 31 · 3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14，FAIL 全 0）；未跑真站 phase3s/3q |

第二十六阶段实证发现：

1. **空格断言写单空格**：`normalizeText()` 把连续空格压成一个，首轮自测里 `| 合计 |  |  |` 全部假红，
   改成 `| 合计 | | |` 后通过。
2. **vMerge 不需要代码分支**：续格本来就没有正文 → `docxCellText()` 返回空串；用测试锁住
   「续格自带文本不丢」这条不变量即可，避免为不存在的场景加分支。
3. **跨度必须设上限**：`w:gridSpan="999"` 会生成 999 个空格的表格行，`MAX_GRID_SPAN = 32` 截断。

## 第二十五阶段（2026-11-04）：XLSX 显示样式 + DOCX Markdown 表格 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 日期/时间按格式码渲染 | ✅ | `tokenizeDateCode()` + `renderDateCode()`：`y/yy/yyyy`、`m/mm/mmm/mmmm`、`d/dd/ddd/dddd`、`h/hh`、`s/ss`、`AM/PM`、`A/P`；`m` 分/月看邻居；月/星期名固定英文；`[h]/[m]/[s]` 按已用时长 |
| 2 | 数字格式渲染 | ✅ | `parseNumberPattern()` + `renderNumberCode()`：小数位/千分位/百分比/货币/负数分段括号/取整；科学计数、分数、`@`、General → 返回 null 回退原值 |
| 3 | 内置格式表补齐 | ✅ | `BUILTIN_NUM_FMT_CODES` 从「只列日期」扩到 1–4 / 9–11 / 37–40 / 48–49 / 14–22 / 27–33 / 45–47 / 50–56 |
| 4 | DOCX Markdown 表格 | ✅ | `docxTableMarkdown()`：首行表头 + `\| --- \|` 分隔行、缺列补空、`\|` 转义、`<br>`；表格前后段落顺序不变 |
| 5 | 工具/依赖 | ✅ | **工具数仍 27**；无新增依赖 |
| 6 | e2e + 回归 | ✅ | `phase3z-e2e.cjs` **37/37**；`phase3y-e2e.cjs` 更新显示样式断言后 **31/31**；run57 十二套 **408/408**（3z 37 · 3y 31 · 3x 41 · 3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14，FAIL 全 0）；未跑真站 phase3s/3q |

## 第二十二阶段（2026-11-03）：DOCX 抽取 + PDF 位图预览 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | DOCX 判定 | ✅ | `detectDocumentKind()`：zip magic `PK\x03\x04` + 探头部/尾部各 128KB 找 `word/document.xml`（条目名明文，不解压）→ `kind='docx'` |
| 2 | DOCX 抽取 | ✅ | `extractDocxText()`：`w:t` 文本 / `w:tab` / `w:br` / 表格按行 `"a \| b \| c"` 展开 / XML 实体（`&amp;`、`&#x989C;`）/ NFKC；`unzipSync({filter})` **只解正文条目**（拒 zip 炸弹） |
| 3 | PDF 位图 | ✅ | `renderDocumentPage()`：`@napi-rs/canvas` + pdfjs `page.render()` → PNG data URL；补 `DOMMatrix/ImageData/Path2D` 全局；`scale` 0.5–3 |
| 4 | 类型 / IPC / preload | ✅ | `DocumentKind` 增 `'docx'`；新增 `DocumentPageImage`；IPC `files:preview-image`；`files.renderPage(path, page?)` |
| 5 | 界面 | ✅ | DOCX：「DOCX 预览」标签 + `doc-preview-text`；PDF：`doc-preview-image` / `-image-meta` / `-image-error` / `-prev` / `-next` |
| 6 | MCP | ✅ | **未新增工具，工具数仍 27**；只更新 `ecclaw_document_preview` 描述（支持 PDF/DOCX；位图不返回 agent） |
| 7 | 新依赖 | ✅ | `fflate@0.8.3`（纯 JS）、`@napi-rs/canvas@1.1.0`（N-API 预编译，Electron 可直接加载） |
| 8 | e2e + 回归 | ✅ | `phase3w-e2e.cjs` **27/27**；phase3v **29/29**；run54 九套 **299/299**（phase3w 27 · 3v 29 · 3u 24 · 3t 16 · 3r 31 · 3p 45 · 3o 44 · 3m 69 · sse 14）；未跑真站 phase3s/3q |

第二十二阶段实证发现：

1. **magic 比较要按 magic 长度切片**：`detectDocumentKind` 为 PDF 读了 5 字节头，却拿整段去比 4 字节的
   zip magic `PK\x03\x04` → DOCX 被误判为 `other`；改为 `head.subarray(0, 4)`。首轮 e2e 26/27 就是它。
2. **制表符会被归一化成空格**：`normalizeText` 的 `/[ \t]+/ → ' '` 是既有行为（与 PDF 一致），
   断言写「款号 A102」而不是 `款号\tA102`。
3. **位图不进 agent 上下文**：PNG base64 只走 UI；agent 继续用文本接口，避免每次预览烧几百 KB。

## 第二十一阶段（2026-11-03）：文档预览（先 PDF）✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 新模块 `electron/main/document-preview.ts` | ✅ | `resolveLibraryFile()`（`path.relative` 判越界 + realpath 防符号链接逃逸，fail-closed）/ `detectDocumentKind()`（magic `%PDF-`，不靠扩展名）/ `loadPdfjs()` / `itemsToText()`（`hasEOL` 换行 + **NFKC 归一化**）/ `listDocuments()` / `previewDocument()`（页数 + 逐页文本 + `truncated` + 人话 `error`） |
| 2 | 共享类型 | ✅ | `electron/shared/types.ts` 新增 `DocumentKind` / `DocumentPreviewPage` / `DocumentPreview`；`EcclawApi.files` 增 `preview(path)` |
| 3 | IPC + preload | ✅ | `electron/main/index.ts` 新增 IPC `files:preview`；`electron/preload/index.ts` 把 `files.preview` 暴露给渲染层；`src/api.ts` 导出 `DocumentPreview` 类型 |
| 4 | 宿主桥 op | ✅ | `electron/main/host-bridge.ts` 新增 op `document-list` / `document-preview`（与界面共用同一实现，不走旁路） |
| 5 | MCP 工具 | ✅ | `resources/mcp/host-server.mjs` 新增**只读**工具 `ecclaw_document_preview({path?, name?, maxPages?, maxChars?})` → 工具数 26 → **27**；不传 `path`/`name` 返回文件库文档清单（name/kind/size/modifiedAt），传则返回页数 + 逐页文本 + 全文 + `truncated`。**本轮未新增任何事件 kind**（预览是纯只读，不产生事件） |
| 6 | 界面 | ✅ | `src/App.tsx` 文件库视图：PDF 条目加「PDF 预览」标签；点开 PDF → 预览面板（`doc-preview-meta` / `doc-preview-page-N` / `doc-preview-text-N` / `doc-preview-error`）；非 PDF 维持原文本读取 |
| 7 | 新依赖 | ✅ | `pdfjs-dist@6.5.438`（**纯 JS，无原生编译**）；主进程是 CJS 产物而 pdfjs 只发 ESM → `createRequire` + Electron 的 Node 24 支持 `require(ESM)`（实测通过，pdfjs 无顶层 await） |
| 8 | e2e | ✅ | `C:\Temp\ecclaw-verify\phase3v-e2e.cjs` **29/29 全绿**（A 工具面 5 · B 清单 4 · C 预览 11 · D 路径守卫 2 · E 界面 6）：工具数 27；清单 PDF→`kind:'pdf'`、txt→`other`；报价单 PDF 抽出「供应商报价单…款号 颜色 尺码 单价 数量 A102 米白…」；**NFKC 生效（是「颜色」不是「颜⾊」）**；`maxChars=10`→`truncated=true`；假 PDF→「PDF 解析失败：Invalid PDF structure.」；txt→「暂只支持 PDF 预览」；越界→「路径越界：只允许访问文件库内的文件」；不存在→「文件库里没有这个文件」；界面 6 条（导航栏 / 列表列出 PDF / 「PDF 预览」标签 / 元信息 / 第 1 页文本 / 错误原因） |
| 9 | 回归串跑 | ✅ | 八套**实测全绿**（数字逐条取自 `C:\Temp\ecclaw-verify\run53-summary.txt`，非预期值）：phase3v **29** · phase3u **24** · phase3t **16** · phase3r **31** · phase3p **45** · phase3o **44** · phase3m **69** · sse **14**（FAIL 全 0）；驱动 `rerun-and-regress5.cjs`（产物前缀 `run53-*`）。**未跑真站套件 phase3s / phase3q** —— 本阶段红线「不碰淘宝」，summary 末行已注明 |
| 10 | phase3o 两条红定性 | ✅ | **测试脚本 bug，不是产品 bug**：`ecclaw_event_replay` 的 `limit` 截断的是 **seq 最小的前 N 条**（`SeqSelector` 取最小的前 N），旧 `makeEvent()` 用 `sinceSeq=900000, limit=500` 再取 max → 事件攒过 500 条后拿到的永远是「第 500 小」。落盘体检：`events-2026-11-03.jsonl` 556 行，seq **900013→900568 连续、无重复、无空洞** → `maxSeqOnDisk()` 续号正常。修法**只改脚本**（加 `diskMaxSeq()` 直读磁盘作地面真相；`makeEvent(floorSeq)` 只取新事件；limit 提到 2000），**产品代码零改动** → 复验 **44/44** |
| 11 | 红线复核 | ✅ | 全程未做真站写操作（本阶段不碰淘宝）；文件库只增不删（本轮 e2e 写的 4 个 `ecclaw-phase3v-*` 文件**留着别删**）；禁 git；密钥未外传；GUI 全程 CDP；未新增事件 kind |

第二十一阶段实证发现：

1. **`ecclaw_event_replay` 的 `limit` 截断的是「seq 最小的前 N 条」**，不是最新的 N 条 →
   任何「取最大值」的断言**不能靠有上限的回放列表**，必须直读磁盘作地面真相（phase3o 假红根因）。
   换句话说：**回放接口给的是「窗口最早的那批」，不是「最新窗口」**。
2. **主进程（CJS 产物）要用 ESM-only 依赖**：`pdfjs-dist` 只发 `.mjs`，而打包器会把主进程的 `import()` 改写成 `require()` → 会炸。
   解法 = `createRequire(app.getAppPath()+'/…')` + Electron 的 Node 24 支持 `require(ESM)`（pdfjs 无顶层 await，实测通过）；
   通用规则：**要么 createRequire，要么把它排出 `externalizeDepsPlugin` 让打包器自己转译**。
3. **PDF 抽文本必须 NFKC 归一化**：PDF 的 ToUnicode 常把「色」映成康熙部首「⾊」（U+2F4A），
   不归一化 agent 读到的是乱码（实测 `颜⾊` → `颜色`）。凡是把 PDF/Docx 文本给 agent 用，都得先归一化。
4. **Electron 不内置 PDF 插件** → 位图渲染要引原生 canvas（`@napi-rs/canvas`）；渲染层跑 pdfjs 会踩 `file://` 下 Worker 被拦。
   故本轮明确取舍为**文本/结构化预览**（页数 + 逐页文本），「看版面」后续单独评估。
5. **路径守卫要 fail-closed 且双保险**：`path.relative` 判越界 + realpath 防符号链接逃逸；越界/不存在是**调用错误**（报错），
   解析失败/加密/非 PDF 是**内容错误**（返回人话 error 字段）—— 两类错误不要混。
6. **e2e 界面断言要考虑冷启动**：文件列表是 App **挂载时拉一次**（无刷新按钮）→ 夹具写在启动之后时，
   用 CDP `Page.reload` 让列表重拉；且冷启动下 React 可能还没挂好，**固定 sleep 会偶发全红** → 改轮询等待元素出现。
   （本轮首轮回归 phase3v 就是这样红了 5 条界面断言，单跑 28/28 —— 典型的「时序型假红」。）

## 第二十阶段（2026-11-03）：远程包仓库灰度发布（rollout）✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 清单扩展（全可选、向后兼容） | ✅ | `rollout?: { id, percent, allowClientIds?, denyClientIds? }`；**没有 `rollout` 字段 = 100% 可见** → 老 `index.json` 行为一字不变；写坏（缺 id / percent 非数字）→ **fail-closed 按 percent=0 放行**（灰度是放量闸门，清单坏了宁可少放不能误放）；`denyClientIds` 优先于 `allowClientIds`，二者都优先于 percent |
| 2 | 客户端分桶（本地、无遥测） | ✅ | 首次拉清单时在 `ecclaw-settings.json` 惰性生成匿名 `clientId`（UUID），**只落本地、绝不上传**；`bucket = parseInt(sha256(clientId+':'+rollout.id).slice(0,8),16)%100`；同 clientId + 同 rollout.id 桶位恒定（重启不变），换 rollout.id 重新洗牌；`eligible = bucket < percent` |
| 3 | 准入双保险 | ✅ | `fetchRepoIndex()` 给每条目补**只读派生字段** `eligible / bucket / eligibleReason`（界面据此显示原因）；`installRemotePackage()` **在安装路径再判一次**（不能只靠界面禁用按钮）—— `version` 参数只用于选条目、**不等于放行**；只有显式 `{bypassRollout:true}` 才越过灰度（仍照旧校验 sha256 / manifest / zip 安全规则） |
| 4 | 版本选择与失败姿态 | ✅ | 未指定版本时在 **eligible 集合**里取最高版本；集合为空 → 明确报错「灰度未放行（bucket=…, percent=…）」，**不静默降级、不删已安装版本**；旧版本目录**只增不删** |
| 5 | 工具面 | ✅ | **不加 MCP 工具（工具数仍 26）**；**未新增事件 kind** |
| 6 | 界面 | ✅ | 远程包仓库条目显示「灰度命中 / 未灰度到（bucket/percent%）/ 内测名单 / 已排除」；未放行条目安装按钮禁用、文案「未放行」（主进程仍会二次拒绝） |
| 7 | e2e | ✅ | `C:\Temp\ecclaw-verify\phase3u-e2e.cjs` **24/24 全绿** |
| 8 | 回归 | ✅ | 见第二十一阶段回归行（run53 链内 phase3u **24/24**，FAIL 全 0） |

## 第十九阶段（2026-11-03）：kind:'page' 事件补产生点 + 导出物面板归类视图 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 范围拍板 | ✅ | phase3s 收官 §6 候选 D（kind:'page' 尾巴 + 导出物归类视图）由 AskUserQuestion **超时自动选中**（自动选择 ≠ 批准；D 不含真站写操作、无不可逆动作 → 合规照做）；三个子决策（补产生点 / 可切换归类 / MCP 保持扁平）同样自动选中，与推荐一致 |
| 2 | page 事件产生点 | ✅ | `electron/main/browser-host.ts` 的 `open()` 落 `kind:'page'` 事件，载荷 `{action:'open',url,tabId,title}`；`pushHostEvent` 包 try/catch；**零契约改动**（共享类型/preload/MCP schema 的 'page' 早已声明）→ 工具数仍 26 |
| 3 | 产生点选位论证 | ✅ | `open()` 是宿主开页的**唯一漏斗**：hostOpen / hostReadDom / hostRunDataQuery / hostRunAction / hostRunExtract / hostRunObserve 六处 `h.open()` 全汇聚到它，未来新增调用点也不会漏（grep 全项目无其他调用方） |
| 4 | 为什么值得补 | ✅ | 开页面**不走写操作护栏**（护栏只管 click/scroll）→ 「agent 打开了哪些页面」此前完全无痕；page 事件是唯一能留痕的地方。实证：B 组开页后 page 事件 0 条 → 1 条，载荷 `{action:'open',url:'http://127.0.0.1:8898/demo',tabId:1,title:'ECCLAW 宿主验证页'}` |
| 5 | 界面可读摘要 | ✅ | `summarize()` 加 page 分支 → 「打开页面 · 127.0.0.1 · ECCLAW 宿主验证页」（否则会甩一坨 JSON） |
| 6 | 导出物归类视图 | ✅ | `src/views/HostEvents.tsx` 新增 `exportGroupBy`（none/date/kind）+ select 控件（data-testid `export-groupby`）；按日期取文件名 `YYYYMMDD`（本地日历日，主进程 `exportStamp()` 用本地时间拼），认不出才退回 modifiedAt；按类型用 `f.kind`，单文件导出归「混合（未拆分）」 |
| 7 | 归类的工程纪律 | ✅ | 纯前端算（不改 IPC、不改导出清单结构）；默认「不分组」= 现状一字不差 → 回归零风险；**删除按钮 testid `export-remove-{文件名}` 在两种视图下一字不变**（归类只是摆放方式变了，不能让「点哪个文件删哪个」跟着视图变）；agent 侧 `ecclaw_export_list` 保持扁平 |
| 8 | e2e | ✅ | `C:\Temp\ecclaw-verify\phase3t-e2e.cjs` **16/16 全绿**（A 工具面 2 · B page 事件 5 · C 归类视图 7 · D 红线 2） |
| 9 | 回归串跑 | ✅ | 八套**实测全绿**（数字逐条取自 `C:\Temp\ecclaw-verify\run51-summary.txt`，非预期值）：phase3t **16** · phase3s **49** · phase3r **31** · phase3q **26** · phase3p **45** · phase3o **44** · phase3m **69** · sse **14**（FAIL 全 0）；驱动 `rerun-and-regress4.cjs`（产物前缀 `run51-*`） |
| 10 | 红线复核 | ✅ | 全程未做真站写操作（本阶段不碰淘宝）；导出物只增不删（97 → 98，脚本造的那一份）；护栏设置无污染（ask + 白名单 `[]`）；禁 git；密钥未外传；GUI 全程 CDP |

第十九阶段实证发现：

1. **「类型里声明了、界面也能选」≠ 有事件**：`'page'` 在类型 / 界面筛选器 / MCP schema 里三处齐全，
   但全项目零 push 点 → 界面上那个「页面事件」筛选永远选不出东西，是**界面在骗人**。
   补类型不等于补能力，产生点必须真的落。
2. **产生点要选在唯一漏斗上**：`browser-host.open()` 是宿主开页的唯一收口（grep 全项目 6 个调用点全在 host-service），
   选它而不是散在 6 个调用点各自落 —— 未来新增调用点也不会漏。
3. **开页面不走写操作护栏**（护栏只管 click/scroll）→ 页面级的行为此前**完全无痕**。
   「用户页面会不会被无痕改动」这类审计盲区，靠补事件类型解决不了，得看**动作本身有没有产生点**。
4. **事件系统不能影响主流程**：`pushHostEvent` 包 try/catch —— 事件落盘挂了不该阻断开页
   （与 write-guard 的落点同一纪律）。
5. **纯前端的展示层增强是零回归风险的做法**：归类视图默认「不分组」= 现状一字不差；
   组内条目复用同一个 `ExportFileRow` 组件 → 删除按钮的 testid 在两种视图下完全一致
   → 「点哪个文件删哪个」不因视图而变。
6. **导出物的日期语义取文件名而不是 mtime**：主进程 `exportStamp()` 用本地时间拼 `YYYYMMDD-HHMMSS`，
   文件名里的日期 = 导出那天的**本地日历日**；用 mtime 会被「拷走文件」等操作改写。
7. **新事件类型对既有断言的影响要先按 kind 推演**：phase3r/3s/3q 的条数断言都按 kind 取
   （`byKind.approval` / `kind=approval`），不按总数 → 新增 page 事件不会打破它们；
   唯一要盯的是「无新事件立即返回空数组」那类断言的窗口期内不能有开页动作。

## 第十八阶段（2026-11-03）：写操作 rejected/timeout/failed 三终态真实站点复验 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 范围拍板 | ✅ | 第十七阶段 §7.1 候选 B（三 stage 真站复验）由 AskUserQuestion **超时自动选中**（自动选择 ≠ 批准；B 只用 scroll 且三 stage 均不执行页面动作，无不可逆风险 → 合规照做） |
| 2 | rejected 真站实锤 | ✅ | R 组 9/9：拒绝后 `{stage:rejected, scope, ok:false, error:用户拒绝了本次写操作, approvalId}` 落盘、winY 恒不变（fail-closed）、R8 不留任何信任规则 |
| 3 | failed 双分支实锤 | ✅ | via=user：批准后 runner 抛错 → `{stage:failed, via:user, scope:once, error:滚动失败：未找到元素…}`、F8 不留规则；deny 分支：`{stage:failed, 无 approvalId, 无 via, error:写操作已被策略禁用（hostWriteGuard=deny）：scroll}`、不弹卡不建票、D3 堆栈无卡（两分支事件可区分，D4 坐实） |
| 4 | timeout 真站实锤 | ✅ | T 组 9/9：10 分钟真定时器误差 <1s、`{stage:timeout, ok:false, 无 via}`、fail-closed、T7 超时后再 scroll 仍被拦（不留信任）、T9 清场闭环 |
| 5 | 口径组（Z） | ✅ | Z1 计数 `requested=4·rejected=2·failed=2·timeout=1·executed=0`、Z3 越界 0、Z4 summary=replay=9、Z5 导出含三终态、Z6/Z7 红线（exports 只增、设置无污染） |
| 6 | 唯一产品改动 | ✅ | `src/App.tsx:193` 卡片加 `data-approval-id={req.id}`（堆栈多卡并存时可寻址锚定；React `key` 不落 DOM → v1 轮旧卡污染点击）。已 build + 实跑生效；主进程/preload/MCP/类型零改动 |
| 7 | 三轮跑分史 | ✅ | v1 37/48（无锚点，旧卡污染）→ v2 34/48（瞬态 approved 误判终态 / 回放没传 seqBase 混入 11-02 老事件 / **GUI 人工批准 T 卡污染无人值守跑**）→ v3 45/49（锚定/终态集合轮询/seqBase/A6 开局清会话信任）→ v4 49/49（waitCardGone 上限 30→45s + F3 放宽，定性见 #8） |
| 8 | 剩余疑点定性（本会话） | ✅ | 活体复验（`C:\Temp\ecclaw-verify\repro-card-throttle.cjs`，hidden 态同环境）：拒绝后 **18.4s 自动收**（3s tick + 12s cutoff，设计语义正确）→ R9/F9/D3 是 v3 时序竞态非逻辑 bug；**F3 之谜**：`App.tsx:57` scope 是全局单一 state（所有卡共享、记住上次选择），v2 人工选「本次会话」把粘滞值留在 session → 设计行为，断言放宽为「默认值 ∈ 合法档位」（F7 落事件 scope=once + F8 不留规则兜底实质） |
| 9 | 回归串跑 | ✅ | `phase3r` **31/31** · `phase3q` **26/26** · `phase3p` **45/45** · `phase3o` **44/44** · `phase3m` **69/69** · `sse` **14/14**（同一 Electron 串跑，驱动 `rerun-and-regress3.cjs`，日志 `C:\Temp\ecclaw-verify\run50-*.log` + `run50b-phase3{r,q}.log`；3q 断言 23 → 26） |
| 10 | 红线复核 | ✅ | 全程只用 scroll；拒绝/deny/timeout 均未执行页面动作（winY 恒 0 变化）；exports 只增不删；settings 无测试污染（ask + 白名单 `[]`）；禁 git；密钥未外传；GUI 全程 CDP |

第十八阶段实证发现：

1. **堆栈式浮层必须给每个条目可寻址锚点**：React `key` 不落 DOM → 多卡并存抓卡看运气，v1 轮旧卡污染点击。一行 `data-approval-id` 根治。
2. **`approved` 是瞬态不是终态**：pending→approved→executed/failed，轮询必须等真终态集合，否则拿中间快照。
3. **回放断言必须带 seq 基线**：`ecclaw_event_replay` 不传 sinceSeq = 全量，11-02 老事件混入让 Z 组整体误报；summary 与 replay 交叉验证是发现钥匙。
4. **GUI 手工答复会污染无人值守 e2e**：v2 的 T 卡被人点「允许」+ 选「本次会话」→ timeout 没验成 + 会话信任吞卡。e2e 跑期间别碰界面；脚本侧开局 `ecclaw_guard_clear_session` 兜底。
5. **全局粘滞 UI state 会跨测试轮留存**：卡片 scope 下拉是 App 级单一 state（设计行为），人工/脚本改过之后**下一张卡看到的默认值就是它**。断言别写死初始值，写「∈ 合法档位」+ 实质行为兜底。
6. **渲染层定时器在窗口 hidden 下仍正常工作**（本例 18.4s 收卡 < 30s），后台节流不是本环境收卡失效的原因 —— 定性要靠活体复验，别顺着「疑似节流」的直觉改代码。
7. **record 的 detail 不能传空串**：FAIL 时无线索（T8 教训）；断言失败明细必须自带现场（卡 id / select 值 / 计数）。
8. **正向结论：三 stage 真站语义全部正确** —— 拒绝/失败/超时均 fail-closed、均不留信任、界面三终态摘要正确（U1-U3）、timeout 真定时器误差 <1s。
9. **回归证据必须引「最后一轮」且前缀一致**：本阶段文档曾引 `run49-*.log`（环境全灭那轮）当全绿证据，实际最新是 `run49b-*` → 差一轮结论全错。**收官前先看摘要文件里套件名与被引前缀是否对得上。**
10. **断言里给 DOM 条目 `.slice(0,N)` 再拿长度跟总数比 = 恒假**（N < 总数时）：`phase3r` G3 在 approval=38 时拿 20 条比 → 必红。要比对总数就取全量。
11. **跨套件污染的通用形态**：上一套件留下「未答复的 pending 卡」或「本次会话信任」→ 下一套件按「第一张卡 / 第一条规则」找东西就找错 → 连环红（`phase3q` 6 条）。**纪律：每个 e2e 套件开局与收尾都做「拒绝遗留 pending 卡 + `ecclaw_guard_clear_session` 清会话信任」，卡片按 `data-approval-id` 锚定。**
12. **断言数 ≠ 卡片数**：终态卡 12s 自动收，收之前仍在 DOM 里 → 「堆栈无卡」类断言只该数 **pending 卡**（还带「允许」按钮的），否则会误红。

## 第十七阶段（2026-11-03）：事件流 kind 多选筛选 + 导出物按 kind 拆分 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 范围拍板 | ✅ | 用户在 A/B/C/D 四选项中**超时自动选中 D**（工具明示「自动选择 ≠ 用户直接输入」；D 不含不可逆动作与真实站点写操作）→ 第十七阶段 = 事件流筛选 + 导出物拆分 |
| 2 | 共享类型 | ✅ | `electron/shared/types.ts`：新增 `export type HostEventKind = HostEvent['kind']`；`HostEventFilter.kinds?: HostEventKind[]`；`HostEventExportOptions.{kinds?, splitByKind?}`；`HostEventExportResult.{files: HostEventExportFile[], kinds: string[], split: boolean}`；`HostEventExportFile.kind?: HostEventKind`。`src/api.ts` 同步 import / export |
| 3 | 主进程：过滤语义统一 | ✅ | `electron/main/host-events.ts`：`scanDiskEvents` 加 `kindFilter`（**kinds 非空优先于 kind**，都不给 = 不限）；回放 / 汇总 / 导出三条路**共用**这一处 → 不会出现「回放能筛、导出不能筛」的语义漂移 |
| 4 | 主进程：导出按 kind 拆分 | ✅ | 同文件：新增 `EXPORT_KIND_RE`（kind 文件名安全校验）、`uniqueExportPath(dir, stem, format)`（同秒撞名加 `-2`/`-3`，**绝不覆盖**用户产物）、`renderEvents(events, format)`（jsonl / csv）；`exportHostEvents` 重写为按 kind 分组 → `splitByKind` 时每类一文件、否则单文件（**旧名一字未改**）；`EXPORT_FILE_RE` 扩展为 `/^ecclaw-events-(?:([a-z0-9-]{1,32})-)?(\d{8})-(\d{6})(?:-\d{1,3})?\.(jsonl\|csv)$/`；`listHostEventExports` 解析 group1 → `HostEventExportFile.kind` |
| 5 | 主进程：桥 + IPC | ✅ | `host-service.ts`：`hostReplayEvents` 签名改 `HostEventFilter & { limit?: number }`（自动带上 kinds）；`host-bridge.ts` 新增本地 `parseKinds()`（只认 observe/approval/page，脏数据当没传），`event-replay` / `event-summary` / `event-export` 三个 op 都透传 `kinds`，`event-export` 另加 `splitByKind`；`main/index.ts` 新增本地 `parseEventKinds()`，同样三处透传，**`host:host-event-export` 的 IPC 契约从 `(filter, format)` 改成 `(filter, {format, splitByKind})`** |
| 6 | preload | ✅ | `electron/preload/index.ts`：`exportHostEvents` 改为 `ipcRenderer.invoke('host:host-event-export', filter ?? {}, { format: options?.format ?? 'jsonl', splitByKind: options?.splitByKind === true })`（与新 IPC 契约同步） |
| 7 | 渲染层 | ✅ | `src/views/HostEvents.tsx`：新增 `KIND_TEXT` / `ALL_KINDS` / `KindPicker`（三个 checkbox，`data-testid={prefix}-{kind}`，空选 = 不限）；三处各挂一个（增量事件流 `stream-kind-*`、历史回放 `replay-kind-*`、导出 `export-kind-*`）；事件流实时显示各类型条数（`stream-kind-count`）；导出面板加「按 kind 拆成多个文件」开关（`export-split`）；导出结果按文件逐条列出（文件名 / kind 标签 / 字节 / 在文件夹中显示）；导出物清单每条显示 kind 标签 |
| 8 | MCP | ✅ | `resources/mcp/host-server.mjs`：新增 `KNOWN_KINDS` + `parseKindFilter(kind, kinds)`（kinds 优先；脏值丢弃）；`ecclaw_events_since` / `ecclaw_event_replay` / `ecclaw_event_summary` / `ecclaw_event_export` 四个工具的 inputSchema 加可选 `kinds`（数组），`ecclaw_event_export` 另加 `splitByKind`（布尔）；`eventsSince` 支持多选（缓冲与落盘回放两条路都过滤）。**工具数不变（26）** |
| 9 | 真机验证 | ✅ | `phase3r-e2e.cjs` **31/31 全绿**（A 工具/schema / B 回放多选 / C 汇总多选 / D 导出过滤与拆分 / E 同秒不覆盖 / F events_since 多选 / G 界面三处控件 + 过滤生效 + 拆分导出）；回归 `phase3q-e2e.cjs` **23/23**、`phase3p-e2e.cjs` **45/45**、`phase3o-e2e.cjs` **44/44**、`phase3m-e2e.cjs` **69/69**、`sse-e2e.cjs` **14/14** |
| 10 | typecheck + build | ✅ | `pnpm typecheck` ✓（两段 tsc 均 exit 0）；`pnpm build` ✓（main 180.51 kB / preload 6.18 kB / renderer 646.76 kB） |
| 11 | 红线复核 | ✅ | `<userData>/host-events/exports/` **原 19 个一条没删**（本阶段 e2e 多轮新造 → 现 **45 个**，只增不删；`uniqueExportPath` 保证同秒导出也不覆盖）；`ecclaw-settings.json` 无污染（`hostWriteGuard=ask` / 持久白名单 `[]`）；禁 git init/commit（项目非 git 仓库）；`openclaw.json`（明文 relay key）与 `host-bridge.json`（token）未外传；本阶段**未做任何真实站点写操作**（真机写操作只做 scroll 仍是红线） |

第十七阶段实证发现：

1. **过滤语义必须收敛到一处实现**：如果回放、汇总、导出各写一套 kind 判断，迟早漂移成「回放能筛、汇总能筛、导出不能筛」。统一落进 `scanDiskEvents` 后，三条路**天然**一致 —— 新增一种筛选维度只要改一处。
2. **多选要能覆盖单选，且谁优先必须写死**：本项目里 `kinds`（多选）**优先于** `kind`（单选），两者都给时以 `kinds` 为准。否则同一份事件会出现「按 kind 筛出 A、按 kinds 筛出 B」的解释歧义。
3. **脏输入要丢弃而不是报错**：agent 可能传 `kinds:['bogus']`。桥层与 MCP 层各有一处解析器（只认 observe/approval/page），认不出就当没传 —— **脏数据不该让调用炸掉**。
4. **同秒导出撞名会覆盖用户产物**（红线：禁删用户文件）：时间戳只精确到秒，同一秒导出两次 → 后一次覆盖前一次 = 弄没了用户的一份产物。`uniqueExportPath` 加 `-2`/`-3` 后缀解决。**任何「自动生成文件名」的写入都要先想撞名**。
5. **新命名形态会让旧的文件名断言变红**：`phase3o-e2e.cjs` 断言导出物文件名符合 `ecclaw-events-YYYYMMDD-HHMMSS.ext`，拆分产物多一段 kind → 断言必须随约定放宽为 `ecclaw-events[-kind]-YYYYMMDD-HHMMSS.ext`（**单文件形态保持一字未改**，所以历史导出物照旧可列可删）。
6. **kind 放在时间戳前面**：文件名里一眼可见（不用打开文件就知道是哪类），正则也能稳定解析（`EXPORT_FILE_RE` 的 group1 就是 kind）。放在后面虽然也能解析，但人眼不友好。
7. **跨调用比较条数前必须先停掉遗留的持续观察**：`observe` 事件每 800ms 一条，上一轮 e2e 留下的 watch 会让「回放单类条数」与「并集条数」两次调用的快照漂移（实测 304 vs 305）→ 断言随机红。**e2e 开头先 `watch-list` + `watch-stop` 清场**。
8. **界面过滤断言要能观察出差异**：起初事件流里只有 observe，勾选后条数没变（过滤前后都是 N）→ 断言是「碰巧通过」的。补一次被护栏拦下的滚动造出 approval 事件，流里同时有两类后，勾选 approval → 「60 条中显示 1 条」，过滤才真正被观测到。
9. **改名 ≠ 改协议**：本阶段改了 `host:host-event-export` 的 IPC 契约（`(filter, format)` → `(filter, {format, splitByKind})`），preload 与主进程**必须同步改** —— 只改一侧会在运行时静默拿到 `splitByKind=undefined`（拆分永远不生效），而 tsc 不会报错。

## 第十六阶段（2026-11-03）：真实站点写操作闭环复验 + 写操作事件落盘 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 真实站点（淘宝）写操作闭环复验 | ✅ | `phase3q-e2e.cjs` A/B/C/D/E 组全绿：登录态在（购物车 189、无「请登录」）→ `ecclaw_scroll` 返回 `{status:'pending',approvalId:'w-mw00btfq-1'}` → 界面弹 `.approval-card` → 用 `HTMLSelectElement.prototype.value` 原生 setter 选「本次会话内信任本站」→ 点「允许」→ 票据 `executed`（`result={ok:true,mode:'dom-scroll',deltaY:400,scrollY:400}`）→ 页面真滚（scrollY 0→400）→ 第二次 scroll 免确认直放行 → `ecclaw_guard_rules` = `{session:[{host:'www.taobao.com',match:'domain',ops:'all',ttl:'session'}]}` → `ecclaw-settings.json` 持久白名单仍 `[]`（session 档不落盘）→ 界面「平台包」视图显示本次会话信任条目 |
| 2 | **真缺口定位：写操作完全不产生事件** | ✅ | 磁盘新事件 0 条、`kinds=[]`、`ecclaw_event_summary` total=0。根因：`HostEvent['kind']` 里定义了 `'approval'`，但**全项目没有任何一处 push 过它** → 事件流 / 汇总 / 导出三套设施只覆盖 `kind:'observe'` → agent 真动了页面却查无此案 |
| 3 | 共享类型 | ✅ | `electron/shared/types.ts`：`ApprovalEventStage`（requested/executed/rejected/timeout/failed）+ `ApprovalEventValue`（stage/op/url/host/scope/source/via/approvalId/ok/error/result）；`src/api.ts` 导出 |
| 4 | 主进程五处落点 | ✅ | `electron/main/write-guard.ts`：`import { pushHostEvent } from './host-events'`（host-events 不依赖 write-guard → 无循环引用）+ `emitApprovalEvent()`（try/catch 包住，事件系统挂了不影响写操作）+ 票据 Entry 增记 `source`/`scope` + `createEntry(op,details,source)`。落点：`requestWriteApproval`（两段式，答复前落 requested → executed/failed/timeout）/ `resolveWriteApproval`（用户答复 → rejected/executed/failed）/ `runWithWriteApproval`（阻塞式 → requested → executed/failed/timeout） |
| 5 | 渲染层可读摘要 | ✅ | `src/views/HostEvents.tsx`：`summarize()` 对 `kind==='approval'` 走文案摘要（不再甩 JSON）；新增 `APPROVAL_STAGE_TEXT` / `APPROVAL_VIA_TEXT` / `APPROVAL_SCOPE_TEXT`。实测渲染：「09:27:34 · 已请求确认 · 点击 · 127.0.0.1」「09:27:35 · 已执行 · 点击 · 127.0.0.1 · 用户放行 · 永久信任（当前路径）」 |
| 6 | MCP 侧 kind 过滤 | ✅ | `resources/mcp/host-server.mjs`：`ecclaw_events_since` 加可选 `kind`（observe/approval/page，缓冲与落盘回放**两条路都过滤**）+ 工具描述补 approval 语义。**工具数不变（26）**；preload **无需改**（事件读取 API 早已存在） |
| 7 | 事件条数口径 | ✅ | 被护栏拦下的一次写 = **2 条**（`requested` 答复前就落 + `executed` via='user' scope=用户选的范围）；站点信任放行 = **1 条**（`executed` via='site-trust'）；`rejected`/`timeout`/`failed` 各 1 条。**'approved' 不单独落事件**（否则一次写变 3 条）→ 答复信息折进 `executed` 的 scope/via。磁盘实证：淘宝 seq 900016/900017/900018 = requested / executed(user,session) / executed(site-trust) |
| 8 | 真机验证 | ✅ | `phase3q-e2e.cjs` **23/23 全绿**（A1–A5 前置 / B1 拦截 / C1–C4 界面卡 / D1–D2 执行与真滚 / E1–E4 session 信任 / F1–F7 事件落盘）；回归 `phase3p-e2e.cjs` **44/44**、`phase3o-e2e.cjs` **44/44**、`phase3m-e2e.cjs` **69/69**、`sse-e2e.cjs` **14/14** |
| 9 | typecheck + build | ✅ | `pnpm typecheck` ✓（两段 tsc 均 exit 0）；`pnpm build` ✓（preload 6.12 kB / renderer 641.38 kB） |
| 10 | 红线复核 | ✅ | `<userData>/host-events/exports/` **原 17 个一条没删**（本阶段 F7 新造 1 个 + 回归 phase3o 新造 1 个 → 现 **19 个**，只增不删）；`<userData>/Partitions/ecclaw-profile-*` 是用户数据 → 只删配置记录；禁 git init/commit（项目非 git 仓库）；`openclaw.json`（明文 relay key）与 `host-bridge.json`（token）未外传；真机只用 `scroll`（淘宝 click 可能下单） |

第十六阶段实证发现：

1. **「闭环」这个词得对着事件流验，护栏通了不代表闭环通了**：护栏本身（pending → 界面卡 → 选范围 → 允许 → 真执行 → session 信任 → 免确认放行）一次跑通、界面全对，但**事件流里一条写操作记录都没有** —— 事件设施原本只覆盖 `observe`。**凡是「会改变用户状态」的动作，都要在事件流里留痕**，否则事后无法对账。
2. **`hostOf` 早就存在**：write-guard.ts 里已有一个返回 `string | null` 的 `hostOf()`（hostname 小写、去掉端口）。我又定义了一个同名函数 → tsc 报 `string | null` 不可赋给 `string | undefined`。**写事件里的 host 直接复用它**（`hostOf(url) ?? undefined`）。**先 grep 再定义**。
3. **答复与执行分处两地**：用户在 `resolveWriteApproval` 点头，执行在两段式的 runner 回调或阻塞式的 `runWithWriteApproval` 里 —— scope / source 必须存在票据 Entry 上传递；`'approved'` 只能在**答复那一处**落，否则重复落两条。
4. **React 的 `<select>` 不能直接赋值**：`select.value = 'session'` 不触发 onChange → 必须用 `HTMLSelectElement.prototype.value` 的原生 setter + `dispatchEvent(new Event('change'))`，再**等一拍**让 React 重渲染，最后才点「允许」—— 否则按钮读到的还是旧 scope。
5. **「本次会话信任」面板在「平台包」视图**（不在宿主事件视图）—— 界面对账要先切视图。
6. **淘宝登录态跨 Electron 重启保住了**（昵称「密氪viva63」、购物车 189、无「请登录」）→ 第十阶段的 partition 持久化在真实站点上成立。
7. **改完 main 代码必须重启 Electron**：本次 e2e 首轮跑的是旧 main（进程 09:13 启动、构建 09:22 产出）→ 必须先 `stop-electron.cjs` 再 `start-electron.ps1`；MCP 侧同理（`ensureMcpServer()` 在启动时把 `resources/mcp/host-server.mjs` 复制进 stateDir，重启才生效）。
8. **导出物基线是「历史 15 + 逐轮增量」**：11-02 的 15 个一条没删；11-03 e2e 新造 2 个 → 17；本阶段 +1、回归 phase3o 再 +1 → 19。**只增不删**是红线。

## 第十五阶段（2026-11-03）：店铺登录态 profile（多店铺登录隔离）✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | profile 存储层（新建文件） | ✅ | `electron/main/host-profiles.ts`：落盘 `<stateDir>/host-profiles.json`（`{version:1, profiles[], activeId}`），tmp + `renameSync` 原子写；默认 profile `id=default` / `partition=persist:ecclaw-host` / `builtin=true`；新建 profile `id=p-<slug>-<ts36>` / `partition=persist:ecclaw-profile-<id>`；partition 名白名单 `^persist:ecclaw-profile-[a-z0-9-]{1,64}$`（默认分区只认 `persist:ecclaw-host`）→ 堵死任意 partition 注入 |
| 2 | 宿主换 partition | ✅ | `electron/main/browser-host.ts`：构造器多收 `partition`（默认仍是 `HOST_PARTITION`）；`ensureView()` 用 `this.partition`；新增 `async usePartition(partition)` —— partition 是 `webPreferences` **创建期参数**，换它必须重建 view；`close()` 会把 viewport 清成 null，故**存-恢复**（不恢复则内嵌浏览器看不见） |
| 3 | 服务层 + IPC + preload + 宿主桥 | ✅ | `host-service.ts`：`initHost()` 用 `getActiveProfile().partition` 建宿主；新增 `hostProfiles` / `hostCreateProfile` / `hostUseProfile` / `hostRemoveProfile`（移除失败**抛错**，删当前 profile 时激活项复位默认并切回 partition）；`index.ts` IPC `host:profiles` / `host:profile-create` / `host:profile-use` / `host:profile-remove`；`host-bridge.ts` op `profiles`（只读）/ `profile-use`（切换），**没有** create / remove；`preload/index.ts` 四个方法 |
| 4 | MCP 工具（24 → 26） | ✅ | `resources/mcp/host-server.mjs` 新增 `ecclaw_profile_list`（无参数）/ `ecclaw_profile_use`（参数 `id`）。**agent 侧只读 + 切换**：新建要人起名、移除涉及用户登录数据 → 留在界面 |
| 5 | 界面（平台包视图 · 宿主卡片） | ✅ | `src/App.tsx`：店铺下拉 `host-profile-select`、新建 `host-profile-name` + `host-profile-create`、**两段式移除** `host-profile-remove-<id>`（第一次只把文案变成「确认移除「X」？」）、当前 partition 展示、提示「切换店铺会关闭当前页面」；失败原因不再被吞成 unhandled rejection（`profileMsg` 显示出来） |
| 6 | 真机验证 | ✅ | `phase3p-e2e.cjs` **45/45 全绿**（工具数 26；agent 侧只有 list/use 两个；默认 partition 名仍是 `persist:ecclaw-host`；**隔离**：A 店 `?setcookie=shopProbe=A` → 默认店读不到 / 切回 A 还在；**跨 Electron 重启**：清单与激活项仍在、A 店登录态仍在、默认店登录态仍在；负例：切不存在的 id 报错、内置默认不可移除；界面：下拉 / 新建 / 切店 / 两段式移除 / 移除后磁盘登录数据仍在）；回归 `phase3o-e2e.cjs` **44/44**、`phase3m-e2e.cjs` **69/69**、`sse-e2e.cjs` **14/14**（三处工具数断言 24 → 26） |
| 7 | typecheck + build | ✅ | `pnpm typecheck` ✓（两段 tsc 均 exit 0）；`pnpm build` ✓（main 173.30 kB / preload 6.12 kB / renderer 639.90 kB） |
| 8 | 红线复核 | ✅ | `<userData>/host-events/exports/` **原 15 个导出物一条没删**（11-02 的 mtime 全未变；本阶段 e2e 新造 2 个 → 现 **17 个**）；`<userData>/Partitions/ecclaw-profile-*` 是用户数据 → `removeHostProfile` **只删配置记录**、不删磁盘目录（e2e 断言：先激活让目录落盘 → 移除 → 目录仍在）；禁 git init/commit（项目非 git 仓库） |
| 9 | 收尾（跨会话补做） | ✅ | ①删 e2e 遗留的「测试店铺A」**配置记录**（`id=p-a-mvzzdau9`）→ 界面 API `window.ecclaw.host.removeProfile(...)`（CDP `Runtime.evaluate`），`host-profiles.json` 已只剩默认店铺一条，**磁盘 partition 目录仍在**；②复核 exports = 17（原 15 + 新 2，无删除）；③优雅关停（`stop-electron.cjs` → `CLOSED`）+ 按精确 PID 停夹具 8898/8897，复查 `NO_NODE_ELECTRON_LEFT` |

第十五阶段实证发现：

1. **session cookie 跨 Electron 重启必丢（Chromium 语义，与 partition 无关）**：第十阶段验「重启后登录态仍在」用的是带 `Max-Age=86400` 的 persistent cookie；我第一版夹具漏了 `Max-Age` → 重启后 cookie 全空，一度被误判成「partition 机制不持久」。**验证夹具必须与被验证语义对齐**：要验「跨重启留存」就用 persistent cookie；要验「session cookie 不留存」单开 `?maxage=0`。
2. **断言不能挂在会过期的历史 cookie 上**：我一度断言「默认店铺里 11-02 设的老 cookie 还在」→ 那个 cookie `Max-Age=86400` 在 11-03 08:57 整到期，run4（08:54）绿、run5（08:57）红 —— **定时炸弹**。改成「重启前现设一个 persistent cookie，重启后断言它还在」，自给自足、不依赖历史残留。
3. **e2e 基线要在「清理遗留」之后取**：脚本开头会清掉上一轮遗留的测试 profile → 用清理前的 `profiles0.length + 1` 当期望值必然差一个。
4. **「没删用户数据」这条红线得先把目录造出来才能验**：新建且从未激活的 profile，Chromium 压根没为它建过 partition 目录 → 「目录还在」是空断言。必须先切到该 profile 开一次页（目录落盘）→ 再移除 → 再断言目录仍在。
5. **换 partition 必须重建 view，viewport 要存-恢复**：`close()` 会把 viewport 清成 null，不恢复的话内嵌浏览器「看不见」（占位盒在、页面不在屏上）。实测切换前后 bounds 完全一致（120,160,900,640）。
6. **界面与 MCP 侧同源，无跨进程缓存问题**：宿主桥是主进程**内**的 HTTP server（`http.createServer` + `listen(0)`），与界面 IPC 共享同一份 profile 状态 → 界面切完，MCP 侧立刻读到新的 activeId；MCP 进程每次调用都重读 `host-bridge.json`（端口/token 每次重启都变，不用重启 MCP 进程）。
7. **移除内置默认店铺被拒**：IPC reject「未找到该店铺，或内置默认店铺不可移除」；界面把失败原因显示出来而不是吞成 unhandled rejection。

## 第十四阶段（2026-11-02）：事件 seq 全局单调 + 导出物清理入口 + 趋势图 ✅（①②③ 全部完成）

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 启动续号（seq 全局单调） | ✅ | `host-events.ts` `maxSeqOnDisk()`：扫全部落盘文件（`.gz` 走 `readLog` 解压），行首正则 `{"seq":N` 取最大值（失败行退回 `JSON.parse`）；`initHostEventLog()` 末尾 `seq = Math.max(seq, maxSeqOnDisk())`；`index.ts` 在 `app.whenReady()` 里、注册 IPC 之前调用（早于任何事件产生） |
| 2 | 回放 / 导出按 seq 升序 | ✅ | 新增 `class SeqSelector`（大根堆，全量扫盘只保留 seq 最小的前 N 条，内存 O(N)）；`replayHostEvents` 用 `SeqSelector(limit≤2000)` → 结果 sort 后返回；`exportHostEvents` 用 `SeqSelector(50000)` 并另计 `matched`（超限 `truncated=true`）；**`scanDiskEvents` 回调由 `(e)=>boolean` 改为 `(e)=>void`**（不再提前停 —— 文件序 ≠ seq 序，提前停会漏） |
| 3 | 导出物清理入口 | ✅ | `host-events.ts` `listHostEventExports()` / `removeHostEventExport(name)` + `EXPORT_FILE_RE = /^ecclaw-events-\d{8}-\d{6}\.(jsonl\|csv)$/`；`host-service.ts` `hostEventExports()`（返回 `{dir, files}`）/ `hostRemoveEventExport()`；`index.ts` IPC `host:event-exports` / `host:event-export-remove`；桥 op `event-exports`（**只列不删**）；MCP `ecclaw_export_list`（23 → 24）；preload `listEventExports()` / `removeEventExport(name)`；`src/views/HostEvents.tsx` 导出物面板（逐个列出 + **两段式删除**） |
| 4 | 趋势图（零依赖 SVG） | ✅ | `src/views/HostEvents.tsx` `TrendChart`：`viewBox 0 0 760 190`、每桶一根 `rect.trend-bar`、峰值桶加 `peak` class（`#ffb020`，其余 `#4c8dff`）、每柱挂 `<title>` hover 提示、y 轴 3 条刻度、x 轴标签抽稀（≤6 + 最后一个）、`data-testid="trend-bar-{i}"` / `data-count` / `data-start`；`src/styles.css` `.trend-chart` / `.trend-bar` / `.trend-bar.peak`；原文字列表保留 |
| 5 | 真机验证 | ✅ | `phase3o-e2e.cjs` **44/44 全绿**（工具数 24；seq 跨重启续号 900009 → 900010；回放非递减 + `sinceSeq`/`untilSeq` 过滤可靠；导出物清单 14 个历史文件一条不少、只删本轮自己造的那一个；负例：桥上无 `event-export-remove` op、通配符/路径穿越/不存在文件名一律被拒；界面两段式删除；趋势图 46 根柱与 MCP 汇总点数/计数/桶键逐一相等）；回归 `phase3m-e2e.cjs` **69/69**（工具数断言 23 → 24）、`sse-e2e.cjs` **14/14**（工具数断言 23 → 24） |
| 6 | typecheck + build | ✅ | `pnpm typecheck` ✓（两段 tsc 均 exit 0）；`pnpm build` ✓（preload 5.81 kB / renderer 635.63 kB） |

第十四阶段实证发现：

1. **seq 续号起点会被历史夹具顶高**：本机落盘里有上上阶段的验证夹具 `events-2026-09-18.jsonl.gz`（8 条，seq 900001+）→ 续号起点被顶到 **900009**。**e2e 断言不能写死 seq 基线**，必须「相对落盘最大值」地断言（换台机器就红）。旧文件按红线**不改写**。
2. **回放必须全量扫盘才能保证升序**：原来 `scanDiskEvents` 扫到"够了"就停 —— 文件序 ≠ seq 序，提前停会漏掉 seq 更小的那批。回调签名因此从 `(e)=>boolean` 改成 `(e)=>void`。
3. **`SeqSelector` 的口径是「seq 最小的前 N 条」，不是「最新 N 条」**。`limit` 小的时候拿到的是**最老**的事件（与旧的「按文件序取前 N」一致）；要拿最新必须自己带 `sinceSeq`。导出的 5 万条上限口径据此改成「seq 最小的 5 万」。
4. **落盘里存在重复 seq（历史多 seq 空间）** → 「按 seq 升序」的断言口径是**非递减**（`seq[i] <= seq[i+1]`），不是严格递增；只有新 seq 空间内才严格递增。
5. **导出物删除必须「精确文件名 + 二次确认」**：只接受 `EXPORT_FILE_RE` 认得的文件名，通配符（`*.jsonl`）、路径穿越（`../events-x.jsonl`）、不存在的名字一律返回 `false`；再叠一层「解析后目录必须仍是导出目录」双保险。界面是**两段式**：第一次点只把文案变成「确认删除？」，文件不动。
   另：导出物目录里现存 **15 个导出物**（14 个历史 + 回归脚本每次新增的 1 个），**一条都不许删**（红线）；
   验证脚本只许删**自己本轮造的那一个**，删前删后都要断言其余文件一个不少。
6. **agent 侧只列不删**：`ecclaw_export_list` 是只读清单（连参数都没有）；宿主桥上**没有** `event-export-remove` 这个 op —— agent 想删也走不通，删除权只在界面。
7. **契约不一致要靠 e2e 抓**：`ecclaw_export_list` 的工具说明写「返回 `{dir, files[]}`」，实现却直接返回数组 → 已统一为 `{dir, files}`（界面那条 IPC 仍返回数组给 `HostEventExportFile[]`）。
8. **测试脚本自身的坑**：重启 Electron 后**桥接端口与 token 全变**（MCP 服务每次调用都重读 `host-bridge.json`，所以**不用**重启 MCP 进程）；重启后宿主**没有页面**，要先 `ecclaw_open_page` 再起 `ecclaw_watch`，否则观察事件起不来；bash 传中文参数被 locale 破坏 → 脚本写进 `.cjs` 再跑。

## 第十三阶段（2026-11-02）：压缩归档 + 时间序列趋势 + 护栏粒度 + 事件推送通道 ✅（①②③④ 全部完成）

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 压缩归档（先压后删） | ✅ | `host-events.ts`：`readLog(file, gz)` / `compressLogFile(f)`（先写 `.gz`→确认→再删明文）/ `compressOldLogs()`；`sweepDisk()` 改「明文超 14 天→压缩（不删）、归档超 90 天→删」；`trimToSize()` 仍按 256MB 整日删；`appendToDisk` 跨天压缩 + `initHostEventLog` 启动压缩；**所有读路径改走 `readLog`** |
| 2 | 趋势（day/hour 分桶） | ✅ | `summarizeHostEvents(filter, {bucket})` + `bucketOf`/`bucketKeyOf`/`nextBucketStart`/`bucketSpan`/`buildTrend`/`MAX_TREND_POINTS=500`；`HostEventTrendBucket|Point|Trend` 类型；补空桶 0、UTC 桶键、`deltaPct` 首桶与上桶为 0 时 null、`peak`、`overallDeltaPct`、非法 bucket 归一到 day |
| 3 | 护栏粒度 | ✅ | `write-guard.ts`：`removeGuardRules(host, path?, scope)`（path 缺省=整站，`''`≡`/`；scope=`session`/`persistent`/`all`）；**修真缺陷**：`removeGuardRule` 改为按 `ttl` 分组删除；`host-service.ts` `hostRemoveGuardRules`；桥 op `guard-rules-remove`；MCP `ecclaw_guard_remove` |
| 4 | 事件推送通道（SSE） | ✅ | `host-bridge.ts` 新增 `GET /events?sinceSeq=N`（`openEventStream`：token 鉴权、15s 心跳、断线补发内存增量）；`host-events.ts` 事件推送由单槽 `emitter` 改订阅者集合 `emitters` + `subscribeHostEvents(fn)`；MCP 常驻 SSE 客户端（`ensureEventStream`/`pushBuffered`/`eventsSince`，断线 2s 重连、缓冲上限 500）+ 新工具 `ecclaw_events_since` |
| 5 | 界面 | ✅ | `src/views/HostEvents.tsx`：按天/按小时下拉 + 趋势区块（峰值 / 末桶较首桶% / 逐桶环比）、留存文案「明文 14 天 → 归档 90 天」+ 明文/归档分片数；`src/App.tsx`：信任规则**按站点分组**，每条路径可单独「移除」+ 站点级「清空本站」 |
| 6 | 真机验证 | ✅ | `phase3m-e2e.cjs` **69/69 全绿**（压缩归档 / 趋势 / 护栏粒度 / 界面）；`sse-e2e.cjs` **14/14 全绿**（端点 200 + text/event-stream + 无 token 403 + 工具数 23 + `source=push` + 空取件不挂住） |
| 7 | typecheck + build | ✅ | `pnpm typecheck` ✓（两段 tsc）；`pnpm build` ✓（main 156.86 kB / preload 5.64 kB / renderer 629.77 kB） |
| 8 | 真实站点登录态闭环 | ✅ | 2026-11-02 收尾：`stop-electron.cjs` 正常关闭→重启→`taobao-login-state.cjs` 复验 cookie 留存（昵称 kizemo、`_tb_token_`/`_hvn_lgc_` 在，cookieLen 1316）✅；`scroll`（真实站点只用 scroll）触发护栏卡→用户界面选「本次会话内信任本站」+允许→`guard-rules`：session 组恰 1 条 `{host:'www.taobao.com', match:'domain', ops:'all', ttl:'session'}`，persistent 组 `[]`，`hostWriteGuardAllowlist` 仍 `[]` ✅。amazon 是 AWS WAF 挑战页，不重试 |

第十三阶段实证发现：

1. **取件的「覆盖判据」不能用「缓冲里捞到东西」**。MCP 侧原本判 `fromBuffer.length > 0 && sinceSeq >= oldest-1` 才走推送，
   于是「没有新事件」时（缓冲本来就是空的）会**错误回落扫盘**，把落盘里另一个 seq 空间的老事件又吐回来 ——
   agent 会看到自己早就消费过的旧事件。正确判据是**缓冲是否覆盖 `sinceSeq` 之后的全部事件**：
   覆盖 → 直接返回（没新事件就是空数组）；不覆盖（事件太老被挤出 500 上限）→ 才回落落盘回放。
2. **`seq` 是运行时计数器，Electron 重启后归零**。落盘里因此存在**多个 seq 空间**，
   且 `replayHostEvents` 是**按文件顺序**返回（不是全局按 seq 升序 —— 注释与实现不符）。
   → agent 若拿「返回列表最后一条的 seq」当游标会踩坑（可能拿到夹具的 900001+）。
   本阶段未改（属既有设计），但写测试夹具时必须注意：夹具 seq 要落在真实 seq 之外，且断言不能依赖回放顺序。
3. **`removeGuardRule` 必须按 `ttl` 分组删除**（本轮修的真缺陷）。原实现是「先在 session 找，找到就删，否则删永久」，
   而 `sameRule` **不比较 `ttl`** → 同一站点同时存在会话规则与永久规则时，点「永久信任」那行的移除会删掉会话那条，
   永久信任原封不动还在生效。现象：用户以为撤了信任，站点仍被永久放行。
4. **趋势必须补空桶 0**，否则「环比」变成「跟上一个有数据的桶比」，口径不一致；桶键要用 **UTC**（落盘时间就是 UTC ISO）。
5. **「先压后删」的顺序不能反**：先写 `.gz` → 确认写成了 → 再删明文。中途失败保持原样（宁可多占磁盘也不能丢数据）。
   更关键的是**所有读路径必须走 `readLog(file, gz)`** —— 漏一处 → gzip 被当明文解析 → 事件静默消失（不报错，只是少数据）。
6. **验证脚本会污染真实数据目录**：本轮 `p3m-fixture.cjs` 往 `<userData>/host-events/` 写了
   `events-<45 天前>.jsonl`（8 条，seq 900001+）。它是日期文件、不与当天文件冲突，但**塞进了真实 seq 空间之后**，
   正是发现第 2 条问题的引子。按红线未自动删除。
7. **测试脚本自身的坑**（不是产品缺陷）：
   - 授过「整站」信任后，同站写操作**全部自动放行、不再弹卡** → 造 session 规则必须排在整站授权**之前**；
   - 界面**只在「批准写操作」后重拉**信任分组 → 直接 patch settings 后要 `location.reload()` 再等 3.5s；
   - `ul.list li` 会混进别的面板（按平台包/按类型/按天/趋势都用它）→ 用 `h3.parentElement` 圈定趋势面板；
   - 趋势列表是**倒序渲染**（最近的在前）→「首个桶，无环比」在**最后一项**；
   - bash 传中文参数被 locale 破坏（`setlocale: cannot change locale (zh-CN)`）→ 脚本写进 `.cjs` 文件再跑。

## 第十二阶段（2026-11-02）：事件导出 + 信任规则可视化 + 白名单路径维度 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 事件导出（主进程） | ✅ | `electron/main/host-events.ts`：`exportHostEvents(filter, options)` → `{file, count, bytes, format, truncated, dir}`；格式 `jsonl`/`csv`；CSV 列 `seq,at,kind,packageId,pageId,observationId,value`（RFC4180 转义，value 存 JSON 文本）；单次上限 5 万条；落 `<userData>/host-events/exports/`（不匹配 `LOG_FILE_RE` → 不被 sweep/trim 碰） |
| 2 | 导出 MCP 工具 | ✅ | `resources/mcp/host-server.mjs` 新工具 `ecclaw_event_export`（**18 → 21**，同批还有 `ecclaw_guard_rules` / `ecclaw_guard_clear_session`）；过滤语义与回放/汇总完全一致（共用 `scanDiskEvents`） |
| 3 | 导出宿主桥 op | ✅ | `host-bridge.ts` 新 op `event-export`；`host-service.ts` 新导出 `hostExportEvents(filter, options)`；IPC `host:host-event-export` + preload `api.host.exportHostEvents(filter, options)` |
| 4 | 界面「导出」面板 | ✅ | `src/views/HostEvents.tsx`：格式下拉（jsonl/csv）+ packageId（可空）+「导出」按钮 + 结果（条数 / 体积 / 完整路径 / 截断提示）+「在文件夹中显示」（IPC `host:show-in-folder` → `shell.showItemInFolder`） |
| 5 | 信任规则分组 | ✅ | `write-guard.ts`：`guardRuleGroups(): {session, persistent}` + `clearSessionGuardRules(): number`（只清内存 sessionRules，不碰落盘）；桥 op `guard-rules` / `guard-rules-clear-session`；IPC `host:write-guard-rule-groups` / `host:write-guard-clear-session` |
| 6 | 界面信任规则两行 | ✅ | `src/App.tsx`：「本次会话信任」行 + 「清空本次会话」按钮 /「永久信任」行；每条标签显示 精确 / 只滚动 / **路径前缀**；批准写操作后自动重拉（`guardEpoch`） |
| 7 | 白名单路径维度 | ✅ | `AllowRule.path?`（缺省 = 整站）；`ApprovalScope` 加第五档 `persistent-path`（授权时记下当前 URL 的 pathname）；`scopeRule(scope, url)` + `pathMatches(rule, pathname)`（`pathname === path \|\| pathname.startsWith(path + '/')`）；`ruleMatches` 三维取交集（host ∧ path ∧ ops） |
| 8 | 真机验证 | ✅ | `export-guard-e2e.cjs` **46/46 全绿**：工具数 = 21、三个新工具在、JSONL 行数 = 条数且逐行合法、CSV 表头/7 列/value 反解回 JSON/引号翻倍、导出与汇总过滤语义一致（16=16）、无命中导出 0 条、桥 op 同形、session 规则列出→清空→不见（permanent 不受影响）、`persistent-path` 落盘 `{host, path:"/foo"}`、同路径直接放行、`/foo/bar` 子路径放行、`/baz` 仍弹卡、界面导出面板 + 路径标签 + 清空按钮全在 |
| 9 | typecheck + build | ✅ | `pnpm typecheck` ✓（两段 tsc）；`pnpm build` ✓（renderer 625.83 kB） |

第十二阶段实证发现：

1. **「能看」和「能改」是两回事 —— 规则列表必须是分组而不是打标签**。第十阶段的扁平列表
   用 `（本次会话）`/`（永久）` 后缀区分，用户看不出「哪些是临时的」，也没法只清临时的。
   → 拆成两行 + 一个只清 session 的按钮，比给一条规则加后缀有用得多。
2. **批准动作会改规则，所以界面得在批准后重拉**。`guardGroups` 原本只在组件挂载时拉一次，
   用户在平台包页点了「允许并信任本站」后，列表不会自己更新。
   → `answer()` 里 `setGuardEpoch(n+1)`，`PackagesView` 的 effect 依赖它。
3. **导出物必须躲开自动淘汰策略**。`exports/` 目录名不匹配 `LOG_FILE_RE`，
   所以 `sweepDisk()`（超期）与 `trimToSize()`（体积）都不会碰它 ——
   用户主动产物被自动删掉是不可接受的。反过来也不自动删导出物，由用户自己清。
4. **CSV 的 `value` 列存 JSON 文本而不是摘要** —— 这样 Excel / pandas 打开后还能
   `JSON.parse` 回结构；同时必须按 RFC4180 整格加引号、内部引号翻倍。
5. **路径维度的匹配语义要「前缀 + 边界」**：`pathname === path || pathname.startsWith(path + '/')`。
   只用 `startsWith(path)` 会让 `/foo` 误伤 `/foobar`。
6. **验证脚本会污染真实数据目录**：本轮在 `<userData>/host-events/exports/` 留下 7 个导出文件
   （3 次跑 × jsonl/csv），是测试产物不是用户文件，但按红线未自动删除，留给用户自清。

---

## 第十一阶段（2026-11-02）：事件汇总 + 落盘保留策略细化 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 事件汇总（主进程） | ✅ | `electron/main/host-events.ts`：`scanDiskEvents()` 抽出共用过滤语义，新增 `summarizeHostEvents(filter)` → `{dir, total, days[], byPackage[], byKind{}, byDay[], firstAt, lastAt}` |
| 2 | 汇总 MCP 工具 | ✅ | `resources/mcp/host-server.mjs` 新工具 `ecclaw_event_summary`（**17 → 18**），参数与 `ecclaw_event_replay` 同语义（无 limit） |
| 3 | 汇总宿主桥 op | ✅ | `host-bridge.ts` 新 op `event-summary`；`host-service.ts` 新导出 `hostEventSummary(filter)`；IPC `host:host-event-summary` + preload `api.host.eventSummary(filter)` |
| 4 | 界面「事件汇总」面板 | ✅ | `src/views/HostEvents.tsx`：按平台包（条数 + seq 区间 + 时间区间 + kind 细分）/ 按类型 / 按天三块；历史回放提示行补「保留 14 天 · 当前 N 条 · 占用 X KB」 |
| 5 | 落盘保留策略细化 | ✅ | `MAX_FILE_BYTES=8MB`（当天最后分片超限 → 新开 `events-DAY.N.jsonl`）、`MAX_TOTAL_BYTES=256MB`（超限从最老一天整日删）、`TRIM_CHECK_EVERY=200`；`LOG_FILE_RE` 统一解析分片名 |
| 6 | 概况接口扩展 | ✅ | `hostEventLogInfo()` 返回 `{dir, days[], total, bytes, retention:{retainDays, maxFileBytes, maxTotalBytes}}`（新增 `bytes` 与 `retention`） |
| 7 | 真机验证（汇总） | ✅ | `event-summary-e2e.cjs` **22/22 全绿**：工具数 = 18、`ecclaw_event_summary` 存在、total>0、byPackage 含 `ecclaw-observer-demo`、byKind.observe>0、byDay 含当天、按 packageId / kind 过滤正确、桥 op 同形、`event-log-info` 含 bytes+retention、界面「事件汇总」面板渲染出聚合结果 |
| 8 | 真机验证（保留策略） | ✅ | 单文件撑过 8MB 后再推事件 → 目录出现 `events-2026-11-02.1.jsonl`；造 `events-2020-01-01.jsonl` 后重启 → 启动即被 `sweepDisk()` 清掉；重启后跨分片统计仍连续（total=10 = 两分片 7+3） |
| 9 | typecheck + build | ✅ | `pnpm typecheck` ✓（两段 tsc）；`pnpm build` ✓（renderer 620.74 kB） |

第十一阶段实证发现（详见 `docs/ecclaw-事件汇总与落盘保留策略-2026-11-02.md`）：

1. **「保留天数」和「体积上限」是两件事** —— 14 天只是时间维度；单个包高频观察时一天就能写几十 MB，
   所以必须再叠一条单文件上限（滚动分片）和一条目录上限（整日淘汰），否则磁盘会被单个包吃满。
2. **分片名必须能被正则统一解析** —— `events-DAY.jsonl` 与 `events-DAY.N.jsonl` 两种命名，
   靠 `LOG_FILE_RE` + 「按天 + 分片序号排序」才能保证跨分片的回放/汇总仍然连续有序。
3. **聚合比回放更省 agent 上下文** —— 「哪个包产了多少事件、覆盖哪几天」这类问题，
   拉原始事件要几千 token，聚合后几十 token 就够；明细需求再走 replay。
4. **验证脚本会污染真实日志目录** —— 8MB 滚动测试要把当天的 JSONL 撑大，
   测完要记得把填充行清掉（否则 `event-log-info.total` 会被虚高），本轮已清理回 7 条合法事件。



## 第十阶段（2026-11-02）：护栏中间档 + 事件落盘回放 + 登录态持久 partition ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 护栏信任范围四档 | ✅ | 确认卡片改「信任范围」下拉 + 允许/拒绝；`ApprovalScope = once / session / persistent / persistent-scroll`；`session` 落内存 `sessionRules`，`persistent*` 落 `settings.hostWriteGuardAllowlist` |
| 2 | 白名单粒度两维 | ✅ | 条目升级为 `{host, match:'host'\|'domain', ops:'all'\|'scroll', ttl:'persistent'\|'session'}`，**旧字符串数组仍合法**（按 domain/all/persistent 解释）；UI「已信任站点」标签行（精确/只滚动/本次会话）+ 移除按钮 |
| 3 | 事件落盘与回放 | ✅ | `<userData>/host-events/events-YYYY-MM-DD.jsonl`（按天，保留 14 天，启动时清理过期）；`replayHostEvents(filter)` + 新 MCP 工具 `ecclaw_event_replay`（**16 → 17**）；桥 op `event-log-info` → `{dir, days[], total}`；界面「历史回放」面板 |
| 4 | 登录态持久 partition | ✅ | `HOST_PARTITION = 'persist:ecclaw-host'`（`electron/main/browser-host.ts`）；cookie / localStorage 落 `<userData>/Partitions/ecclaw-host/` |
| 5 | 四档 scope 真机验证 | ✅ | 三段真机（跨两次重启）**15/15 断言全绿**：once 两次都弹卡且不写白名单；session 第二次直接放行且重启后失效；persistent 落盘为对象条目、二次放行、跨重启仍放行；persistent-scroll 滚动放行、点按仍弹卡（用 `localhost` 独立 host 隔离 127.0.0.1 的 all 规则） |
| 6 | 事件回放真机验证 | ✅ | `event-replay-e2e.cjs` **12/12**：回放按 seq 升序、包过滤正确、无结果返回空、磁盘 JSONL 逐行合法、`event-log-info` 概况正确、界面面板能回放 |
| 7 | 登录态持久真机验证 | ✅ | fixture 加 `/set-probe` + `/api/writer/probe` 两条路由：种 cookie → **正常退出重启后 cookie 仍在**（`ecclaw_probe=probe-20261102`）；`taskkill /F` 强杀则丢（Chromium 没刷 cookie 库） |
| 8 | 真实站点只读复验 | ⚠️ 部分 | 淘宝只读正常（h1=淘宝网、52 元素、1907 链接）；**亚马逊仍是 AWS WAF 挑战页**（反爬，非宿主问题）。真实站点**登录态下**的写操作闭环仍未验证（需用户本人账号，风险自负） |
| 9 | 「已信任站点」界面 + 移除 | ✅ | CDP 实测：标签行渲染 `127.0.0.1移除 localhost（只滚动）移除`；点移除后 settings 白名单少一条、界面同步刷新 |
| 10 | typecheck + build | ✅ | `pnpm typecheck` ✓；`pnpm build` ✓（renderer 616.18 kB） |

第十阶段实证发现（详见 `docs/ecclaw-护栏中间档与事件落盘-2026-11-02.md`）：

1. **同一个 host 上「all 规则」会盖掉「scroll 规则」** → 验证 `persistent-scroll` 必须换一个 host
   （本轮用 `localhost` 隔离 `127.0.0.1` 的 all 规则），否则「点按仍问」根本触发不了。
2. **`persist:` partition 的 cookie 只有正常退出才落盘** → 强杀进程（`taskkill /F`）会丢登录态，
   验证与使用都要「关窗口再重启」，别用强杀模拟退出。
3. **一个 Electron 实例只能占一个 `--remote-debugging-port`** → 上一次没杀干净就重启，
   会出现两个实例 + CDP 指向旧实例的渲染进程（看门狗点的是旧进程的卡片）。重启前先杀干净。
4. **旧格式白名单字符串在落盘时被升级成对象条目** —— 行为不变，但 settings 里会看到格式变化，别误判为 bug。
5. **确认卡片的下拉是 React 受控组件**：CDP 改 `select.value` 必须用 native setter + `dispatchEvent('change')`，
   改完等 500ms 再点「允许」，否则点到的还是旧 scope。



## 第九阶段（2026-11-02）：两段式写操作确认 + 护栏粒度 + poll 订阅式持续刷新 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 两段式写操作确认 | ✅ | `write-guard.ts` 票据存储 + 状态机（pending→approved→executed/failed，pending→rejected/timeout）；`ecclaw_click`/`ecclaw_scroll` 立即返回 `{status:"pending", approvalId}`（实测 60ms）；新工具 `ecclaw_approval_status`（MCP 12→13） |
| 2 | poll 订阅式持续刷新 | ✅ | 宿主事件总线 `host-events.ts`（环形 200 条 + 长轮询）；runner `spec.continuous` 常驻子进程按 `intervalMs` 循环产事件；MCP 新增 `ecclaw_watch`/`ecclaw_watch_stop`/`ecclaw_next_event`（13→**16**）；界面「宿主事件」页增量追加 |
| 3 | 护栏粒度（站点白名单） | ✅ | 卡片第三个按钮「允许并信任本页面」→ 域名写入 `ecclaw-settings.json → hostWriteGuardAllowlist`；该站点之后写操作直接放行（不再弹卡） |
| 4 | 真 agent 端到端 | ✅ | `openclaw agent --local` + aliyun-maas/qwen3.8-max：实调 `ecclaw_click` + `ecclaw_approval_status`，failures 0，stderr `MCP error` **0** 次，票据 `w-mvyik2wr-2` → `executed`，fixture 服务端计数 **1→2** |
| 5 | 白名单路径真机验证 | ✅ | 首次点击 → pending → 点「允许并信任本页面」→ `executed`、计数 2→3、settings 落盘 `["127.0.0.1"]`；再次点击 **32ms 直接 executed**、计数 3→4 |
| 6 | 持续刷新真机验证 | ✅ | `ecclaw_watch` → `next_event` 连续取到 seq 1/2/3（间隔 ≈810ms，与包内 `intervalMs:800` 一致）；界面 CDP 读出事件流；`watch_stop` 后排干至 `null` |
| 7 | 真实站点只读复验 | ⚠️ 部分 | 淘宝开页 + 读 DOM 正常（h1=淘宝网、74 元素、1944 链接）；**亚马逊返回 AWS WAF 挑战页**（反爬拦截，非宿主问题）。登录态下的写操作闭环仍未验证（风险自负，未做） |
| 8 | typecheck + build | ✅ | `pnpm typecheck` ✓；`pnpm build` ✓（renderer 611.23 kB） |

第九阶段实证发现（详见 `docs/ecclaw-两段式写操作确认-2026-11-02.md`、`docs/ecclaw-poll订阅式持续刷新-2026-11-02.md`）：

1. **MCP SDK 客户端请求超时硬编码 60s** → 阻塞型等待窗口必须明显 < 60s（两段式取 40s）；
   两段式把「人的等待时间」与「MCP 超时」彻底解耦，这是根治，不是把窗口调大。
2. **护栏超时后确认卡片不会自动消失** → 票据状态变化必须由主进程**推送**回渲染进程，
   否则用户点已过期卡片是空操作。
3. **站点白名单要在 `ask` 判定之前检查**，且只作用于 `source=agent` 的写操作。
4. **持续刷新要在子进程里常驻**（一次 spawn 循环产出），不要「主进程反复 spawn」——
   包内 `intervalMs=800`，每轮一次进程创建太重。
5. **长轮询是订阅不是轮询**：一次 `ecclaw_next_event` 调用挂着等事件，超时返回 `null` 而非报错。
6. **停止后缓冲区会残留 1~3 条已产出事件**（子进程 kill 有延迟）→ 测试要「排干到 null」而不是断言立刻 null。

## 第八阶段（2026-11-02）：写操作确认护栏 + 宿主 op 直暴露成 MCP 工具 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 写操作护栏（`electron/main/write-guard.ts`） | ✅ | 三档策略 `ask`/`allow`/`deny` 存 `ecclaw-settings.json → hostWriteGuard`；待确认队列 + 渲染进程推送 + 60 秒超时**自动拒绝**（fail-closed） |
| 2 | 闸门接进执行路径 | ✅ | `browser-host.ts` 的 `runOp` 在执行前过 `requireWriteApproval`（`click`/`scroll` 拦；`intercept-next`/`wait-for-navigation` 只读放行）；发起方用 `source`（`ui` 直通 / `agent` 走闸），透传链 host-service → platform-actions.runRunner → runOp |
| 3 | 确认卡片 UI | ✅ | 主进程 `host:write-approval-request` 推送 → 渲染进程右下角 `.approval-card`（允许/拒绝）→ `host:respondApproval`；重挂载用 `pendingApprovals()` 补渲染 |
| 4 | 宿主 op 直暴露成 MCP 工具 | ✅ | `resources/mcp/host-server.mjs` 工具 **8 → 12**：新增 `ecclaw_click` / `ecclaw_scroll` / `ecclaw_intercept_next` / `ecclaw_wait_navigation`；`host-bridge.ts` 新增对应 4 个 op |
| 5 | UI 暴露宿主桥状态 + 护栏开关 | ✅ | 平台包页：`宿主桥已就绪 :<port>` 标签（**不含 token**）+ `agent 写操作：` 下拉（ask/allow/deny），切换即落盘 |
| 6 | 端到端实测 | ✅ | ask 弹卡 → 拒绝则 agent 收到 `用户拒绝了本次写操作（click）` 且**计数不变**（1→1）；允许则 1→2；allow 档 0→1 直接执行；deny 档报错；scroll 同样弹卡、允许后 `scrollTop:200`；**40 秒无响应自动拒绝** |
| 7 | MCP 层复验 | ✅ | `ecclaw_click`（allow 档）→ `{"ok":true,"mode":"dom-click"}`；`ecclaw_scroll`（deny 档）→ `工具执行失败：写操作已被策略禁用…`，`isError=true`；`tools/list` 12 个工具 |
| 7b | **agent 真调用写操作** | ✅ | `openclaw agent --local` 调 `ecclaw-host__ecclaw_click{selector:"#btn-increment"}` → 渲染进程弹卡 → 用户点允许 → `dom-click`/`ok:true`/fixture 服务端计数 **1**；agent 回复「已成功点击」；stderr 里 `MCP error` **0 次** |
| 8 | GUI 抽查（CDP） | ✅ | 平台包页标签 `宿主桥已就绪 :62809`；下拉三选项切换后 `writeGuardMode()` 同步；`.approval-stack` 计算样式 `position:fixed; z-index:50` |
| 9 | typecheck + build | ✅ | `pnpm typecheck` ✓；`pnpm build` ✓（main 109.75 kB / preload 3.52 kB / renderer 604.12 kB） |

第八阶段实证发现（详见 `docs/ecclaw-宿主写操作护栏-2026-11-02.md`）：

1. **MCP SDK 客户端请求超时硬编码 60s**（`@modelcontextprotocol/sdk` → `DEFAULT_REQUEST_TIMEOUT_MSEC = 60000`），
   超时只给 agent 一句 `MCP error -32001: Request timed out`。
   → **护栏窗口必须 < 60s**。初版取 60s → 两者同时到点，agent 连点三次全 -32001，
   而按钮**根本没被点**（服务端点击计数 0）；改 40s 后一次成功。
2. **护栏超时后卡片不会自动消失**（渲染进程不知情），用户点它是空操作 → 必须靠「窗口短于 MCP 超时」避开。
3. **`read-dom` 会重新打开 URL**（`hostReadDom` 里 `await h.open(target)`）→ 用它读页面计数会把页面刷掉、计数归零。
   验证计数变化必须直连**宿主页面自己的 CDP target** 读 `window.__ecclawCount`；跨重载场景用 fixture 的**服务端**计数。
4. **宿主页也是 CDP target**：`/json/list` 里同时有 `page:fixture`（WebContentsView）与 `page:ecclaw`（主窗口）→ 可直接 `Runtime.evaluate` 读宿主页状态。
5. **闸门放在 `runOp` 里**（而不是各自入口）才能让平台包子进程与 MCP 直连工具共用同一道闸。
6. **确认请求必须能补渲染**：渲染进程重挂载后卡片会丢，`pendingApprovals()` 兜底，否则 agent 永久挂起（靠超时兜底）。
7. **token 不能进渲染进程**：桥状态接口只回 `{ready, port, pid, startedAt}`。

## 第七阶段（2026-11-02）：宿主写操作 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | `browser.click` | ✅ | `electron/main/browser-host.ts` `click()`：定位元素（selector + text + frame）→ 可见时派发真实鼠标事件（mouseMoved/Pressed/Released）、隐藏时 DOM `el.click()` |
| 2 | `browser.scroll` | ✅ | `scroll()`：无 target 滚窗口、有 target 滚容器；可见时 `Input.synthesizeScrollGesture` 并校验 scrollTop 是否变化，隐藏/无效时回退 DOM `scrollBy` |
| 3 | `browser.interceptNext` | ✅ | `interceptNext()`：glob 匹配「下一次」请求，`Network.loadingFinished` 命中后 `Network.getResponseBody` 取体 → 回执 `{url,method,status,body}` |
| 4 | `browser.waitForNavigation` | ✅ | `waitForNavigation()`：监听 `did-navigate` / `did-navigate-in-page`（忽略同 URL），超时 reject |
| 5 | 子进程 → 主进程 RPC | ✅ | `platform-actions.ts`：`RUNNER_SCRIPT` 的 SDK stub 改为 `rpcOp('click'\|'scroll'\|'intercept-next'\|'wait-for-navigation')`；`runRunner` 新增 `type:'op'` 消息处理 |
| 6 | 示例包 + 验证页 | ✅ | `resources/platform-packages/ecclaw-writer-demo`（4 个动作）+ `C:/Temp/ecclaw-verify/fixture-writer.cjs`（端口 **8897**） |
| 7 | 端到端实测 | ✅ | 可见 / 隐藏两种状态 × 4 个动作 = **8/8 全绿**（计数 0→1、scrollTop 300、抓到真实 JSON body、跳到 /writer-target） |
| 8 | MCP 层复验 | ✅ | `tools/call ecclaw_run_action{packageId:"ecclaw-writer-demo"}` → `ok:true` |
| 9 | typecheck + build | ✅ | `pnpm typecheck` ✓；`pnpm build` ✓ |

第七阶段实证发现（详见 `docs/ecclaw-宿主写操作-2026-11-02.md`）：

1. **隐藏的 widget 不收 CDP 输入事件** —— `setVisible(false)` 时 `Input.dispatchMouseEvent` 被静默丢弃 → 隐藏态必须走 DOM 事件。
2. **隐藏不能收成 0×0** —— 布局宽度为 0 时元素坐标全为 0；只能「1280×800 布局 + setVisible(false)」。
3. **挪到画面外也不行** —— `x=-1280` 时渲染进程视口宽度被裁成 0。
4. **`mouseWheel` 不产生滚动**（scrollTop 恒 0）→ 改 `Input.synthesizeScrollGesture`（yDistance 取负 = 向下滚），且滚完必须校验是否真的滚了。
5. **`interceptNext` 登记前不能 await** —— 否则包内随后的请求抢先发出，拦截器抓不到。
6. **dabi 真实包的写操作签名**：`click({selector,text?,frame?})`、`scroll({deltaY,target:{selector,frame?}})`、
   `interceptNext(glob)`、`waitForNavigation()`；真实包里 SDK 是 `require("@dabi/plugins")`，
   宿主把最小 SDK 注入在 `globalThis[Symbol.for('com.dabiai.plugins.sdk')]`。

## 第六阶段（2026-11-02）：宿主接进对话链路（MCP）✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 宿主桥（loopback HTTP） | ✅ | `electron/main/host-bridge.ts`：主进程起 `127.0.0.1:<随机端口>`，请求须带 `x-ecclaw-token`；端点信息写 `<stateDir>/host-bridge.json`；ops = status/capabilities/open/read-dom/action/data-query/extract/observe |
| 2 | 宿主 MCP 服务（stdio） | ✅ | `resources/mcp/host-server.mjs`：手写 JSON-RPC 2.0（newline-delimited），`initialize` / `tools/list` / `tools/call`；8 个工具（`ecclaw_list_capabilities` / `ecclaw_open_page` / `ecclaw_read_dom` / `ecclaw_run_action` / `ecclaw_run_data_query` / `ecclaw_run_extract` / `ecclaw_run_observe` / `ecclaw_host_status`） |
| 3 | 注册进 openclaw 配置 | ✅ | `electron/main/mcp-bridge.ts` → `mcp.servers.ecclaw-host`（`transport:"stdio"`，`command=process.execPath`，`env` 含 `ELECTRON_RUN_AS_NODE=1` + `ECCLAW_HOST_BRIDGE_FILE`）；启动日志 `[ecclaw] MCP 服务已注册：ecclaw-host` |
| 4 | openclaw 内核侧连通 | ✅ | `openclaw mcp doctor ecclaw-host --probe` → **`ecclaw-host: ok`**（openclaw 自带 MCP 客户端握手成功） |
| 5 | agent 真调用（能力目录） | ✅ | `openclaw agent --local --json` → toolSummary 含 `ecclaw-host__ecclaw_list_capabilities`，failures 0；agent 答「18 个平台包，第一个 packageId=1688」 |
| 6 | agent 真调用（宿主执行） | ✅ | agent 调 `ecclaw-host__ecclaw_run_extract{packageId:ecclaw-observer-demo,url:http://127.0.0.1:8898/demo}` → 宿主返回 `{ok:true,value:{title:"ECCLAW 宿主验证页",tabId,pageIdentity}}`，agent 答「页面标题：ECCLAW 宿主验证页」 |
| 7 | 托管技能文本同步 | ✅ | `package-skills.ts` 的「使用边界」从「不执行动作」改为「可执行 + MCP 工具清单（实际工具名带 `ecclaw-host__` 前缀）」；18 包技能已重新生成 |
| 8 | typecheck + build | ✅ | `pnpm typecheck` ✓；`pnpm build` ✓ |

第六阶段实证发现：

1. **MCP 服务进程是 openclaw 的孙子进程**，够不到 Electron 主进程 → 必须有一层桥；
   ecclaw 用「主进程 loopback HTTP + token」当桥，MCP 侧只做 HTTP 转发。
2. **openclaw 拉起 stdio MCP 服务用 `exactEnv`**（只给配置里的 env，不继承父进程环境）→
   `ELECTRON_RUN_AS_NODE=1` / `ECCLAW_HOST_BRIDGE_FILE` / `PATH` / `SystemRoot` 等必须**写全**在 `mcp.servers.*.env` 里。
3. **工具名会被加服务器名前缀**：实际是 `ecclaw-host__ecclaw_run_extract`（双下划线），技能文本要照这个写。
4. **`command` 用 `process.execPath`（electron.exe）也可行**，前提是 env 里带 `ELECTRON_RUN_AS_NODE=1`（和内核启动同一个坑）。
5. **MCP 服务脚本从 `resources/mcp/` 复制到 `<stateDir>/mcp/` 再启动** → 运行期不依赖打包产物路径（打包时记得把 `resources/` 收进应用）。
6. 宿主桥是**本地回环 + 随机 token**：token 只落在 `<stateDir>/host-bridge.json`（与 openclaw.json 同级，用户目录内）。
7. **agent 侧不读技能也能用工具**：MCP 工具由内核自动发现；技能文本只负责告诉 agent「有哪些能力 id、该怎么调」。
8. `openclaw mcp doctor <name> --probe` 是最快的连通性自检（比手搓客户端省事）。


## 第五阶段（2026-11-02）：候选 3 内嵌浏览器宿主 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 摸清 dabi 宿主契约（直读真实 runtime.cjs，不做 REA） | ✅ | 17 包 / 18 版本目录静态直读 → `docs/dabi-宿主契约-context字段清单-2026-11-02.md`；三条硬结论：包**从不**接触 `webContents`（全 17 包命中 0 次）、唯一桥是 `context.eval`、数据查询走 `buildExpression` 表达式通道 |
| 2 | 最小宿主原型（WebContentsView + dabi 形状 context） | ✅ | `electron/main/browser-host.ts` / `action-context.ts` / `platform-actions.ts` / `host-service.ts`；IPC `host:open` / `host:read-dom` / `packages:run-data-query` / `run-action` / `run-extract` |
| 3 | 跑通只读链路（打开页面 → 读 DOM → 返回） | ✅ | GUI：fixture 页 → `itemCount=3` / h1 / bodyText / linkCount 全读出 |
| 4 | 真实 dabi 数据查询跑通 | ✅ | `databank / list-leaf-category` + `{"keyword":"衣"}` → `{ok:true,total:1,categories:[{cateId:"101",cateName:"连衣裙",…}]}`（keyword 过滤生效，T恤 被滤掉），durationMs≈90 |
| 5 | 真实 dabi **页面动作**路径端到端 | ✅ | `taobao / taobao.search.exportProducts` 打在 fixture 上 → 结构化失败 `{status:"error",errorCode:"BAD_PAYLOAD",message:"缺少当前搜索结果缓存"}` → 证明 子进程→动作查找→context→eval→错误回传 全链通（`gui-host-action.cjs`） |
| 6 | **可见内嵌浏览器** | ✅ | 渲染进程把占位盒 `getBoundingClientRect()` 经 `host:set-viewport` 交给主进程 → `view.setBounds`；实测主进程 bounds `(274.7, 521.4, 1093×420)` 与占位盒 `(275, 521, 1093×420)` 一致，且**宿主页面视口实测 = 1093×420**（证明 view 真的占了那块地方，页面在其中渲染） |
| 7 | `packages:run-extract` 的 UI 入口 | ✅ | 平台包页新增「执行页面提取」；`taobao` 打在 fixture 上 → `{ok:false,error:"未找到可提取的页面（match 未命中）"}`（证明 extract 全链通、只是 fixture 不是淘宝页） |
| 8 | context 构造**单一来源** | ✅ | `action-context.ts` 的 `createActionContext` 既是类型化实现，又经 `contextBuilderSource()`（`fn.toString()`）内联进 runner 脚本 → 主进程/子进程不再两份字段清单；重构后重跑数据查询 + 页面动作，均仍通过 |
| 9 | typecheck + build | ✅ | `tsc -p tsconfig.node.json` NODE_OK；`tsconfig.web.json` WEB_OK；`pnpm build` ✓（preload 2.56 kB / renderer 600.78 kB） |
| 10 | **observe（事件）通道 —— dabi 三种 mode 全实现** | ✅ | 新增 `resources/platform-packages/ecclaw-observer-demo/`（manifest + runtime.cjs，dabi 形状 pages 契约，3 个页面分别演示 3 种 mode）；宿主把事件作为 `context.event` 喂给 `page.observe(context)`。GUI 实测：`network-response` → `{mode,url,method,status,base64Encoded,bodyText,observationId:"ecclaw-demo-network"}`（CDP `Network` 域 + `Network.getResponseBody`）；`poll` → `{mode:"poll",observationId:"ecclaw-demo-poll",url,title}`；`dom-signal` → `{mode:"dom-signal",message:"ecclaw-demo-signal:changed:1",observationId:"ecclaw-demo-signal"}`（注入包内 `installScript` + 监听 console 前缀） |
| 11 | 能力探测去噪（18 包全绿） | ✅ | 探测脚本给 `observations(context)` 传**空壳 context**（不再无参调用 → 免得 `Cannot read properties of undefined`），SDK stub 补 `matchURL`/`logger`；实测 18 包 **err 全为 null**，`doudian` 观察器数 10 → **37**；托管技能 17 → **18**（新增 `ecclaw-observer-demo`） |
| 12 | 覆盖矩阵（契约字段实测） | ✅ | `C:/Temp/ecclaw-verify/ctx-coverage.cjs` 扫描 17 个真实 runtime.cjs → `docs/dabi-宿主契约-覆盖矩阵-2026-11-02.md`：宿主契约 **15 个字段全部已实现，真实缺口 = 0** |

第五阶段实证发现：

1. **CDP 会出现多个 page target**：宿主打开 fixture 后 `/json/list` 里同时有 `page:ECCLAW 宿主验证页`
   （WebContentsView）与 `page:ecclaw`（主窗口）→ 驱动脚本必须按 URL 选主应用：
   `list.find(t => t.type==='page' && /index\.html$/.test(t.url))`（踩过一次：连到 fixture 页 → "Cannot read p…"）。
2. **`ECCLAW_LOCAL_PACKAGES_DIR` 指向 dabi 真实包目录** → ecclaw 直接看到 17 个真包，无需安装。
3. **computer-use 截屏全黑**（Electron dev 应用不在其 app 白名单）→ 一律用 CDP 驱动真 Electron 验证；
   可见性改用「宿主页面视口尺寸 == 占位盒尺寸」取证（等价于 view 真的被摆进去了）。
4. **CSS px 与 Electron DIP 1:1**（Windows 125% 缩放下依然 1:1）→ 渲染进程矩形可直接喂 `setBounds`。
5. 页面 fixture 必须在**页面内 stub `window.fetch`**，真实 dabi 数据查询表达式才能在页面里跑通。
6. **observe 通道必须用真实网络响应**（`Network.getResponseBody` 取不到 stub 的假 Response）：
   fixture 改为「只拦 `databank.tmall.com`，其余走真实 fetch」+ 服务端提供 `/api/demo/echo` JSON + 页面内 1.2s 定时请求。
7. **CDP `Network.enable` 发生在 observe 启动之后** → 之前发出的请求抓不到，必须由页面**后续**再发一次请求才会命中。
8. **能力探测调 `observations()` 必须带 context**：真实包的 `observations(c)` 读 `c.url`；无参调用会抛
   `Cannot read properties of undefined (reading 'url')`，被误记成「探测失败」。传空壳 context 后 18 包 err 全 null。
9. **dabi 的 observe 语义（实测 doudian-compass）**：`context.event.mode` / `request.url` / `bodyText` /
   `base64Encoded` 是包内真正会读的字段（`c.event.*` 命中 4 种），`response.status` 由宿主补齐。
10. **observe 需要「ack 握手 + 事件缓冲」**：子进程发出 `observations` 后必须等宿主回 `observations-ack`
    （宿主要先装 dom-signal 脚本），且**ack 之前到达的事件要缓冲**（注入脚本可能立刻打 console 消息）→
    否则 dom-signal 事件会丢，子进程永久等待直到 45s 超时。
11. **Electron 45 的 `console-message` 签名是「第一个参数即事件对象」**（`event.message`），
    旧的 `(event, level: number, message: string, …)` 位置参数已 deprecated；
    类型定义里 `on('console-message', (details: Event<WebContentsConsoleMessageEventParams>, level: number, …))`
    会让 TS 把第二参推成 `number` —— 必须用第一个参数。

## 第四阶段（2026-11-02）：GUI 抽查 + 候选 4 远程包仓库 ✅

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | setDefaultModel 同步 `providerMeta.<id>.defaultModel` | ✅ | 切 qwen3.6-flash → primary 与 meta 同步；旧 provider 的 meta.defaultModel 一并清掉（不再两个 provider 同时显示「默认：」） |
| 2 | GUI 抽查（真 Electron + CDP 驱动） | ✅ | 大模型页「设为默认：qwen3.6-flash」点击 → 按钮态即时变「默认：qwen3.6-flash」；对话页发一句话 → 模型回 `Test passed`（provider=aliyun-maas / model=qwen3.8-max / stopReason=stop） |
| 3 | **缺陷修复**：对话页显示整个 JSON 信封 | ✅ | 旧 `extractReply` 只认 reply/content/text/…；openclaw 真实信封是 `{payloads:[{text,mediaUrl}], meta:{…}}` → 重写为「payloads 优先 + 递归取文本 + meta.terminalReply / finalAssistantVisibleText 兜底」，修复后页面只显示 `Test passed` |
| 4 | 候选 4：远程包仓库 | ✅ | 新增 `electron/main/package-repository.ts`：清单拉取 → 下载 → 安全解包（自带最小 zip 解析，零第三方依赖）→ sha256 + manifest 哈希校验 → 落盘 + `current.json` 指针；IPC `packages:repo-index` / `packages:repo-install` + 平台包页「远程包仓库」面板 |

候选 4 验证证据（`C:/Temp/ecclaw-verify/repo-driver.cjs`，本地 HTTP 仓库 + 造语料，**10/10 通过**）：

- 清单拉取 5 个包；`demo-pkg@0.1.0` 安装成功（3 个文件）；
- `current.json` = `{version, channel:stable, dir:"stable-0.1.0-<hash8>"}`；`listPackages()` 能扫到（origin=local，docs 1 篇）；
- 负例全部被拒：归档 sha256 不匹配 / manifest 哈希不匹配 / zip slip（`../evil.txt`，且未落盘）/ 非 http 协议（`file:`）；
- GUI 端到端（`gui-repo.cjs`）：面板可见 → 拉取清单「5 个包」→ 安装 → 「已安装 demo-pkg@0.1.0（3 个文件）」→ 包卡片出现 demo-pkg；
  故意点 bad-hash 条目 → UI 正确显示「安装失败：…归档哈希不匹配…」。

新实证发现：

1. **GUI 自动化换方案**：computer-use MCP 截屏全黑且拒绝输入（Electron dev 应用不在其 app 白名单）
   → 改用 CDP 驱动真实 Electron：`npx electron . --remote-debugging-port=9222` + Node 26 内置 `WebSocket`
   调 `Runtime.evaluate` 真实点按钮（脚本：`C:/Temp/ecclaw-verify/gui-driver.cjs` / `gui-repo.cjs`）。
   验证期用 `ECCLAW_LOCAL_PACKAGES_DIR` 隔离本地包目录，不污染真实 userData。
2. openclaw `agent --json` 真实信封结构（2026-11-02 实测）：
   `{payloads:[{text,mediaUrl}], meta:{terminalReply:{disposition,text}, finalAssistantVisibleText, …}}`。
3. 仓库安装**刻意不删旧版本目录**（全局红线：禁止删除用户文件），旧版本保留待用户自清。
4. `paths.localPackagesDir()` 新增 `ECCLAW_LOCAL_PACKAGES_DIR` 覆盖（与既有 `ECCLAW_PACKAGES_DIR` 同风格）。
5. zip 解析为零第三方依赖的自研最小实现（stored/deflate 两种方法 + CRC32 + zip slip 防护），
   避免为了解包引入依赖（pnpm 安装在本机很慢）。

## 第三阶段必做 2（2026-11-01 深夜）已完成

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 真 Provider 接入（aliyun-maas，anthropic-messages relay） | ✅ | relay ping qwen3.8-max → HTTP 200 "pong"；`agents.defaults.model.primary=aliyun-maas/qwen3.8-max`；清掉第一阶段遗留 local-ollama |
| 2 | `openclaw agent --local` 一轮真实对话 | ✅ | EXIT=0；`model-fetch provider=aliyun-maas api=anthropic-messages model=qwen3.8-max status=200 elapsedMs=2447`；stopReason=stop |
| 3 | 模型可见 17 个托管技能 | ✅ | 技能落 ecclaw 真实 stateDir 17/17、capSum 643；模型答「共加载 38 个技能。淘宝相关：taobao；抖店相关：doudian、doudian-compass（另有 sycm、qianniu 等）」 |
| 4 | setDefaultModel 独立 IPC/UI 入口 | ✅ | `providers:set-default` IPC + preload + Models 页每模型「设为默认」按钮；函数级验证（切 qwen3.6-flash→还原 qwen3.8-max）✓；两段 typecheck + build ✓ |

新实证发现：
- relay 模型 id 白名单 = `qwen3.8-max` / `qwen3.6-flash` / `deepseek-v4-pro` / `auto`（`qwen3-coder-plus` 报 Model not exist）。
- CLI 直跑 `agent --local` 需 `OPENCLAW_STATE_DIR` + `OPENCLAW_CONFIG_PATH` 指向 ecclaw 状态根（与 gateway.ts `gatewayEnv()` 同一组 env）。
- 首次 `agent --local` 出现 stale-lease 告警（owner-pid-dead 自愈），无害。
- e2e 验证驱动 `C:/Temp/ecclaw-verify/e2e-driver.cjs`（require.cache 注入 stub userData，不改原 stub）。
- GUI「设为默认」按钮未点击实测（typecheck/build 已过），留作 pnpm dev 抽查项。

## 本轮目标（prompt-ecclaw-next.md 的必交付项）

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | `tsc -p tsconfig.node.json --noEmit` + `tsconfig.web.json --noEmit` 通过 | ✅ | 两次 exit 0（NODE_OK / WEB_OK） |
| 2 | `pnpm build` 成功 | ✅ | out/main 24.76 kB / out/preload 1.52 kB / out/renderer 586 kB |
| 3 | `pnpm dev` 起得来；「大模型」页增删改 Provider 写入 openclaw.json；「测试连接」可用 | ✅ | GUI 实测：新增 local-ollama → openclaw.json 落盘；测试连接报「连接失败：fetch failed」（本机无 Ollama，符合预期） |
| 4 | `openclaw config validate` 对生成的配置通过 | ✅ | `{"valid":true,"warnings":[]}` |
| 5 | README（架构图 / 启动 / 平台包协议 / 如何加包 / 自定义大模型接入） | ✅ | `README.md` |

## 本轮修掉的真实缺陷

1. **`models.providers.<id>` 是 `additionalProperties:false`** —— 上游 validate 直接拒绝
   `label` / `defaultModel` / `local`。
   → 拆成：openclaw.json 只留上游允许的键；ecclaw 私有元数据落到 `ecclaw-settings.json` 的 `providerMeta`。
2. **openclaw 要求显式 `gateway.mode`** —— 缺它直接 `Gateway start blocked`。
   → `writeConfig()` 自动补 `gateway.mode: "local"`。
3. **`process.execPath` 是 `electron.exe`** —— 以 Electron 应用模式跑 openclaw.mjs，
   gateway 停在 bootstrap 之后、永不监听端口。
   → 子进程环境加 `ELECTRON_RUN_AS_NODE=1`（退化为纯 Node）。实测 gateway 正常监听 `127.0.0.1:<port>`。
4. **健康探测窗口太短** —— gateway 冷启动 20–30s，30s 判定太紧。
   → 提到 60s；超时杀子进程并报错，避免侧栏显示假「运行中」。
5. **electron 二进制没装** —— pnpm 默认拦依赖构建脚本，报 `Error: Electron uninstall`。
   → package.json 加 `"pnpm": { "onlyBuiltDependencies": ["electron"] }`；手动执行
   `cd node_modules/electron && node install.js`（国内加 `ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/`）。
6. **「默认模型」字段形同虚设** —— 只记录不生效。
   → 保存 Provider 时若填了默认模型，同步写 `agents.defaults.model.primary`；
   删除 Provider 时清掉指向它的默认模型。

## 本轮后补的实证发现（2026-11-01 晚）

见 `docs/逆向分析补充-平台包协议实证-2026-11-01.md` —— 直接读了本机 dabi 运行时产物
（`%APPDATA%\com.dabiai.desktop\`），闭合了逆向报告第 7 节两项未解事项，并发现 ecclaw 一个真实缺陷：

- **dabi 的 `match[]` / `matchPriority` 在注册表 `index.json` 里，不在 manifest 里。**
  → `electron/main/platform-packages.ts` 现在只从 manifest 取匹配规则，
  **装真实 dabi 包时会匹配不到站点**。修法：扫描包根目录时读 `index.json`，
  把 `match` / `matchPriority` 合并进 `PlatformPackageInfo`。
- `current.json` 真实形状 = `{version, channel, dir}`，ecclaw 读 `.dir` —— **实现正确，无需改**。
- 真实 `runtime.cjs` 908 KB，是带 DOM 选择器的浏览器操作运行时（能力 id 形如
  `taobao-search-price-ranges`、`taobao-audience-analysis`），不是声明式工具清单。
- REA `evidence-app.json` 未生成；定向 REA 任务因 `source_paths` 非 inventory 精确路径而失败，
  **不能原样重试**（需先取 inventory 再用精确路径）。

## 第二阶段（2026-11-01 晚）已完成

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 平台包匹配改读注册表 `index.json` | ✅ | 真机 dabi 17 包实测：`sycm.taobao.com→sycm(prio=20),taobao(prio=10)`、`compass.jinritemai.com→doudian-compass`、`unknown-site.example.org→无匹配` |
| 2 | `electron/main/platform-runtime.ts` 子进程能力探测 | ✅ | 真机 17 包全部加载成功，抽出 **643** 项能力（页面动作 576 + 数据查询 67），0 致命错误 |
| 3 | 能力目录接入 IPC → preload → 渲染进程 | ✅ | `packages:capabilities` IPC + 「平台包 → 探测能力」按钮；GUI 实测内置包显示工具清单 |
| 4 | 两段 typecheck + `pnpm build` | ✅ | NODE_OK / WEB_OK / build ✓ |

第二阶段修掉的真实缺陷：

1. **注册表匹配缺失** —— 见上（`match` / `matchPriority` 只在 `index.json`）。
2. **探测只认 dabi 契约** —— ecclaw 自带示例包导出 `{manifest, tools, execute}`，
   旧探测逻辑只找「有 manifest 且有 pages 数组」的对象 → 自带包全部报「runtime 未导出平台包对象」。
   → 探测改为接受「有 manifest 且（pages 或 tools 是数组）」。
3. **`observations()` 抛错会清空整个包** —— 它依赖宿主页面上下文，脱离宿主调用抛
   `Cannot read properties of undefined (reading 'url')`，旧代码让异常冒泡到顶层 catch，
   结果该包 pages/actions 全丢。→ 改为单页 try/catch，只丢观察器 id。
4. **数据查询能力缺失** —— `databank` / `txsale` 这类包只暴露 `dataQueries{}`（无 pages），
   旧探测显示 0 能力。→ 目录新增 `dataQueries` 维度。

## 第三阶段必做 1（2026-11-01 夜）已完成 —— 能力目录喂给 Agent（路线 A）

| # | 交付项 | 状态 | 证据 |
|---|---|---|---|
| 1 | `electron/main/package-skills.ts`：每个已安装包的能力目录渲染为 openclaw 托管技能 `<stateDir>/skills/<packageId>/SKILL.md` | ✅ | 真机实测（`C:/Temp/ecclaw-verify/skills-driver.cjs`，纯 Node 不启 Electron）：**17/17 包全部生成成功，能力合计 643**，与第二阶段基线一致，0 失败 |
| 2 | 接线 IPC→preload→渲染：`packages:sync-skills` + 「平台包 → 生成 Agent 技能」按钮 + 结果提示 | ✅ | NODE_OK / WEB_OK / `pnpm build` ✓ |
| 3 | `paths.managedSkillsDir()` 支持 `ECCLAW_SKILLS_DIR` 重定向 | ✅ | 验证时写入 `C:/Temp/ecclaw-verify/skills-out/`，不污染 dabi 真实状态根 |

新增实证发现：

1. **真实 dabi 安装包内没有任何 `.md`**（`find` 实测 0 个；`manifest.pages[].docs` 指向的
   `docs/tx/*.md` 未随包分发）→ SKILL.md 的「适用场景」只能以 manifest 页面元数据（path/type/docs
   指针）+ 能力 id 清单构成；若包内确带 `docs/`（ecclaw 自制包），整目录拷入技能目录供 agent 渐进阅读。
2. runtime 探测出的真实动作能力 id 是**点分形**（如 `taobao.product.downloadInfo`、
   `taobao.product.collectReviews`）；此前静态字符串里看到的连字符形（`taobao-search-price-ranges`）
   混有页面/选择器 id，能力目录以运行时探测为准。

## 尚未做（第三阶段候选）

- 内嵌浏览器 / 邮件 worker / 画布宿主 / PDF **位图**预览·Docx·Pptx·PSD 预览 / OCR（PDF 文本预览已在第二十一阶段完成）
- 团队 / 账号 / 计费 / 遥测 / 数据迁移框架（**刻意不做**，dabi 私有商业系统部分）
- 社媒自动化脚本执行器、店铺登录态 profile（均已完成）；远程包仓库**灰度/回滚策略**（灰度放行已在第二十阶段完成）
- 平台包 runtime.cjs 的**真实工具执行**（当前只有能力目录抽取 + 呈现，
  动作执行依赖内嵌浏览器宿主 `webContents`/`tabId`）
- 能力目录喂给 agent（候选：写成 openclaw 托管技能 `<stateDir>/skills/<pkg>/SKILL.md`，
  或走 openclaw `mcp.servers` 的 stdio 传输把 runtime 暴露成 MCP 工具）
- `setDefaultModel` 的独立 IPC/UI 入口（当前由「默认模型」字段隐式触发）
- REA 证据（**已查明并结案，别再跑**）：
  三次尝试全部失败，结论 = **REA 静态分析对本项目不适用**：
  1. 整树跑 → `dist/renderer/assets/client-*.js` 耗尽整体预算超时（exit 0 但无 evidence 文件）；
  2. 定向到 dabi 自研的 `dist-electron/electron/browser/sidepanel-platform-runtime/`
     （5 文件 / 6.3 MB：exceljs / rolling-video / spreadsheet / **tesseract** / tesseract-worker）
     → `spreadsheet-runtime.js` 仍触发单文件 300s 超时，**依然没产出 evidence 文件**。
  3. 目标类型必须是目录或 `.asar`（传单个 `main.js` 报 `unsupported_target`）。
  → 本项目逆向证据一律以**运行时产物直读 + 真实加载**为准（强度更高且已够用）。
  → 附带的实质线索：dabi 侧栏宿主**内置 OCR**（tesseract-runtime + tesseract-worker）。

## 环境备忘

- 本会话 Bash 被 `ctx-budget-guard` 拦（上下文 ≥160K），逃生阀：`CTX_GUARD_ALLOW=1 <cmd>`（命令内联即可生效）。
- 临时产物在 `C:/Temp/ecclaw-verify/`（含 schema.json、driver.cjs、lib/），可随时重建。
- openclaw 配置 schema 导出命令：`node node_modules/openclaw/openclaw.mjs config schema --json`（2.5 MB）。
