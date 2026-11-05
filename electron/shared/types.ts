/** ecclaw 主进程 <-> 渲染进程的共享契约（对应 preload 暴露的 window.ecclaw） */

export type ProviderKind = 'openai-compatible' | 'anthropic-compatible'

/** 用户自定义大模型接入配置 */
export interface ModelProvider {
  /** 唯一 id，写入 openclaw.json 的 models.providers 键名 */
  id: string
  label: string
  kind: ProviderKind
  /** OpenAI 兼容填 /v1 根地址；Anthropic 兼容填 API 根地址 */
  baseUrl: string
  /** 是否已保存密钥（密钥本体不外发到渲染进程） */
  hasApiKey: boolean
  /** 可选模型清单 */
  models: string[]
  defaultModel?: string
  /** 本地推理端点（Ollama / LM Studio / vLLM）标记 */
  local?: boolean
}

export interface ProviderTestResult {
  ok: boolean
  message: string
  latencyMs?: number
  models?: string[]
}

/** 平台技能包（对齐 dabi platform-packages 协议） */
export interface PlatformPackageManifest {
  schemaVersion: number
  packageId: string
  displayName: string
  version: string
  platform?: string
  sites?: string[]
  match?: string[]
  matchPriority?: number
  pages?: PackagePage[]
  minClientVersion?: string
  runtime?: string
  description?: string
}

export interface PackagePage {
  id: string
  path: string
  type?: string
  docs?: string
}

/**
 * 平台包注册表条目 —— 对齐 dabi 的 <root>/index.json 里 packages[] 的一项。
 * 注意：真实 dabi 把 match / matchPriority 放在注册表里，manifest 里没有。
 */
export interface PlatformPackageRegistryEntry {
  packageId: string
  displayName?: string
  /** 注册表里的最新版本（未必等于本地已安装版本） */
  version?: string
  channel?: string
  /** 域名匹配规则（注册表级，优先级高于 manifest） */
  match?: string[]
  matchPriority?: number
  /** 远程包下载地址（OSS 签名直链） */
  packageUrl?: string
  installedVersion?: string
  installedChannel?: string
  installStatus?: string
}

export interface PlatformPackageInfo {
  manifest: PlatformPackageManifest
  /** 包所在目录 */
  dir: string
  /** 来源：bundled（内置）| local（用户本地） */
  origin: 'bundled' | 'local'
  /** 文档清单（相对包内 docs 目录） */
  docs: string[]
  /** 对应的注册表条目（若根目录有 index.json） */
  registry?: PlatformPackageRegistryEntry
}

/**
 * 灰度发布配置（第二十阶段）。
 * 缺省 = 不对本客户端开放；percent 0-100；deny 优先于 allow。
 */
export interface PackageRollout {
  /** 灰度批次标识：参与分桶，换批次即重新洗牌 */
  id: string
  percent: number
  allowClientIds?: string[]
  denyClientIds?: string[]
}

export type PackageEligibilityReason =
  | 'all'
  | 'allowlisted'
  | 'denylisted'
  | 'rollout-hit'
  | 'rollout-miss'

/** 远程仓库清单里的一个包（对应远端 index.json 的 packages[] 条目） */
export interface RemotePackageEntry {
  packageId: string
  version?: string
  channel?: string
  displayName?: string
  match?: string[]
  /** 归档直链（可带 OSS 签名参数） */
  packageUrl: string
  size?: number
  /** 归档 sha256 */
  sha256?: string
  /** manifest.json 的 sha256 */
  manifestSha256?: string
  /** 灰度配置（可选；没有 = 全量可见） */
  rollout?: PackageRollout
  /** 以下为客户端派生字段：主进程按本地 clientId 计算，远端清单不需要提供 */
  eligible?: boolean
  bucket?: number
  eligibleReason?: PackageEligibilityReason
}

export interface RemoteRepoIndex {
  baseUrl: string
  packages: RemotePackageEntry[]
}

export interface RemotePackageInstallResult {
  packageId: string
  version: string
  /** 落盘后的包目录 */
  dir: string
  /** 解出的文件数 */
  files: number
}

/** 单个工具（ecclaw 示例包契约 tools[]） */
export interface PlatformPackageTool {
  name: string
  label?: string
  description?: string
  parameters?: Record<string, unknown>
}

/** 单个页面（dabi 契约 pages[]）及其能力 id */
export interface PlatformPackagePageCapability {
  id: string
  /** 动作能力 id（agent 可见的 capability 名） */
  actions: string[]
  /** 需要「准备」阶段的能力 id */
  automationActions: string[]
  /** 页面观察器 id */
  observations: string[]
}

/** 平台包的能力目录（由 runtime.cjs 在子进程里探测得到） */
export interface PlatformPackageCapabilities {
  packageId: string
  version: string
  /** ecclaw 契约工具 */
  tools: PlatformPackageTool[]
  /** dabi 契约页面能力 */
  pages: PlatformPackagePageCapability[]
  /** dabi 契约数据查询能力（databank / txsale 这类包只暴露这一层） */
  dataQueries: string[]
  /** 探测失败原因（成功时为空） */
  error?: string
}

/** 平台包能力目录同步为 openclaw 托管技能（<stateDir>/skills/<packageId>/SKILL.md）的单包结果 */
export interface PlatformPackageSkillSyncResult {
  packageId: string
  /** 生成出的技能目录（失败时为空串） */
  skillPath: string
  capabilityCount: number
  error?: string
}

export interface SkillInfo {
  name: string
  description: string
  path: string
  origin: 'managed' | 'user'
}

export interface FileEntry {
  name: string
  path: string
  size: number
  modifiedAt: string
}

/** 文档类型（第二十一阶段：PDF；第二十二阶段补 DOCX；第二十三阶段补 PPTX / XLSX） */
export type DocumentKind = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'other'

/** 预览里的一页文本 */
export interface DocumentPreviewPage {
  page: number
  text: string
}

/** 文档预览结果（只读；error 非空时说明为什么预览不了） */
export interface DocumentPreview {
  kind: DocumentKind
  name: string
  path: string
  size: number
  modifiedAt: string
  pageCount: number | null
  pages: DocumentPreviewPage[]
  text: string
  truncated: boolean
  error: string | null
}

/** 单页位图渲染结果（第二十二阶段：UI 位图预览，PDF 专用） */
export interface DocumentPageImage {
  page: number
  width: number
  height: number
  dataUrl: string
}

export interface GatewayStatus {
  running: boolean
  pid?: number
  port?: number
  baseUrl?: string
  binary?: string
  version?: string
  error?: string
}

/** 内嵌浏览器宿主的页面信息（对齐 dabi 的 context.tabId / url / title） */
export interface HostPageInfo {
  tabId: number
  url: string
  title: string
}

/** 宿主只读动作：页面 DOM 概览 */
export interface DomSnapshot {
  url: string
  title: string
  h1: string
  itemCount: number
  itemTexts: string[]
  bodyText: string
  linkCount: number
}

/** 宿主页面在主窗口里的可视区域（渲染进程测得，主进程据此摆放 WebContentsView） */
export interface HostViewportBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 宿主当前状态：正在承载的页面 + 在主窗口里的摆放位置 */
export interface HostStatus {
  info: HostPageInfo
  /** 当前可视区域（null = 隐藏） */
  bounds: HostViewportBounds | null
}

/** 包内命令（数据查询 / 页面动作 / 页面提取）的执行结果 */
export interface HostCommandResult {
  ok: boolean
  /** 数据查询时是包内 buildExpression 产出的表达式 */
  expression?: string
  /** 动作返回值 */
  value?: unknown
  error?: string
  durationMs: number
}

/** 写操作确认请求（agent 通过 MCP 触发的 click / scroll 需要用户点头） */
export interface WriteApprovalRequest {
  id: string
  op: string
  summary: string
  selector?: string
  text?: string
  frame?: string
  url?: string
  createdAt: string
}

/** 写操作票据的状态机 */
export type WriteApprovalStatus =
  /** 等用户点头 */
  | 'pending'
  /** 用户已批准（两段式下执行可能还在跑） */
  | 'approved'
  /** 已执行完（result 有值） */
  | 'executed'
  /** 执行报错（error 有值） */
  | 'failed'
  /** 用户明确拒绝 */
  | 'rejected'
  /** 超时未确认（fail-closed，不会执行） */
  | 'timeout'

/** 写操作票据：请求 + 状态 + 执行结果（agent 轮询的就是它） */
export interface WriteApproval extends WriteApprovalRequest {
  status: WriteApprovalStatus
  /** 执行结果（status=executed 时有值） */
  result?: unknown
  /** 失败原因（status=failed 时有值） */
  error?: string
  updatedAt: string
}

/** 写操作护栏策略 */
export type WriteGuardMode = 'ask' | 'allow' | 'deny'

/**
 * 用户批准一次写操作时顺带记住的信任范围。
 * - once：什么都不记（只放行这一次）
 * - session：本次宿主运行内信任该域名（内存，重启即失效）
 * - persistent：永久信任该域名（含子域，全部写操作）
 * - persistent-scroll：永久信任该域名，但只放行滚动，点按仍逐次确认
 * - persistent-path：永久信任该域名，但**只限当前页面的路径前缀**（第十二阶段）
 */
export type ApprovalScope =
  | 'once'
  | 'session'
  | 'persistent'
  | 'persistent-scroll'
  | 'persistent-path'

/**
 * 白名单条目（第十阶段起带粒度；旧格式字符串数组按 domain/all/persistent 解释）。
 *
 * 第十二阶段加了第三维 `path`：
 * - 缺省 / 空串 = 整个域名（与第十阶段行为完全一致）
 * - 非空 = 只对该 pathname 前缀生效（`pathname === path || pathname.startsWith(path + '/')`）
 *
 * 三个维度取**交集**（最严为准）：host（match）∧ path ∧ ops。
 */
export interface AllowRule {
  host: string
  match: 'host' | 'domain'
  ops: 'all' | 'scroll'
  ttl: 'persistent' | 'session'
  /** 路径前缀（缺省 = 整站）。规范化后不带尾斜杠，根路径是 '/'。 */
  path?: string
}

/** 信任规则分组（第十二阶段：界面与 agent 都要能分开看「本次会话」与「永久」） */
export interface GuardRuleGroups {
  /** 仅本次宿主运行有效的规则（重启即失效） */
  session: AllowRule[]
  /** 落盘永久生效的规则 */
  persistent: AllowRule[]
}

/** 宿主事件（poll 订阅式持续刷新的增量单位） */
export interface HostEvent {
  /** 单调递增序号；消费者记住它就能只取新事件 */
  seq: number
  kind: 'observe' | 'approval' | 'page'
  packageId?: string
  pageId?: string
  observationId?: string
  /** 事件载荷（observe 时是包内 page.observe 的返回值） */
  value?: unknown
  at: string
}

/** 宿主事件类型（observe=观察事件 / approval=写操作审计 / page=页面事件） */
export type HostEventKind = HostEvent['kind']

/** 写操作审计事件的阶段 */
export type ApprovalEventStage =
  /** 已向用户请求确认（护栏卡已弹出） */
  | 'requested'
  /** 已执行完 */
  | 'executed'
  /** 用户明确拒绝（fail-closed，不执行） */
  | 'rejected'
  /** 用户超时未确认（fail-closed，不执行） */
  | 'timeout'
  /** 执行报错 */
  | 'failed'

/**
 * 写操作事件（kind='approval'）的载荷。
 *
 * 为什么写操作要落事件：事件流 / 汇总 / 导出 / 趋势这套设施原本只覆盖「观察」，
 * agent 真的动了页面（滚一下、点一下）却查无此案 —— 写操作是唯一会**改变用户页面**
 * 的动作，必须留审计痕迹：谁发起、用户批没批、批的范围多大、执行结果如何。
 */
export interface ApprovalEventValue {
  /** 阶段 */
  stage: ApprovalEventStage
  /** 写操作类型：click / scroll */
  op: string
  /** 目标页面 */
  url?: string
  /** 目标站点（从 url 取 host） */
  host?: string
  /** 用户选定的信任范围 */
  scope?: ApprovalScope
  /** 发起方：ui = 用户自己在界面里点的；agent = agent 通过 MCP 触发的 */
  source: 'ui' | 'agent'
  /** 放行来源：user=用户点头；site-trust=站点信任规则；guard-allow=策略全放行；ui=界面直接触发 */
  via?: 'user' | 'site-trust' | 'guard-allow' | 'ui'
  /** 票据号 */
  approvalId?: string
  /** 是否成功 */
  ok?: boolean
  /** 失败原因 */
  error?: string
  /** 执行结果（click / scroll 的返回很小，整段带上） */
  result?: unknown
}

/** 事件落盘的过滤条件（回放与汇总共用） */
export interface HostEventFilter {
  sinceSeq?: number
  untilSeq?: number
  sinceAt?: string
  untilAt?: string
  packageId?: string
  pageId?: string
  /** 单类过滤（保留旧语义） */
  kind?: HostEvent['kind']
  /**
   * 多类过滤（第十七阶段）。
   *
   * 为什么要有它：事件流里「观察」与「写操作审计」是两类完全不同的东西 ——
   * 前者是机器看到的，后者是人批过的。混在一个列表里既看不过来，也没法只导出其中一类。
   * 给了 `kinds` 时以它为准（`kind` 被忽略）；空数组 = 不限。
   */
  kinds?: HostEventKind[]
}

/** 落盘日志概况（界面显示用） */
export interface HostEventLogInfo {
  /** 落盘目录 */
  dir: string
  /** 覆盖的日期 */
  days: string[]
  /** 总条数 */
  total: number
  /** 总体积（字节） */
  bytes: number
  /** 明文分片数量（events-DAY.jsonl） */
  plainFiles: number
  /** 压缩归档数量（events-DAY.jsonl.gz） */
  archivedFiles: number
  /** 保留策略 */
  retention: {
    /** 明文保留天数：超过就压缩归档（不再删除） */
    retainDays: number
    /** 归档保留天数：超过才删除 */
    archiveDays: number
    maxFileBytes: number
    maxTotalBytes: number
  }
}

/** 时间序列分桶粒度 */
export type HostEventTrendBucket = 'hour' | 'day'

/** 时间序列上的一个点 */
export interface HostEventTrendPoint {
  /** 桶起点（ISO 8601；hour 粒度精确到整点，day 粒度是当天 00:00 UTC） */
  start: string
  /** 该桶内的事件条数 */
  count: number
  /** 环比上一个桶的增减条数（第一个桶为 null） */
  delta: number | null
  /** 环比上一个桶的增减百分比（第一个桶、或上桶为 0 时为 null） */
  deltaPct: number | null
}

/** 时间序列趋势（第十三阶段）：环比 + 峰值 */
export interface HostEventTrend {
  bucket: HostEventTrendBucket
  /** 按时间升序的分桶（空桶补 0，环比才有意义） */
  points: HostEventTrendPoint[]
  /** 峰值桶（条数最多的一个） */
  peak: { start: string; count: number } | null
  /** 末桶相对首桶的总体变化（百分比；首桶为 0 时为 null） */
  overallDeltaPct: number | null
}

/** 事件汇总（按平台包 / 类型 / 天聚合） */
export interface HostEventSummary {
  dir: string
  /** 命中的事件总数 */
  total: number
  /** 命中的日期 */
  days: string[]
  /** 按平台包聚合（按条数倒序） */
  byPackage: Array<{
    packageId: string
    count: number
    firstSeq: number
    lastSeq: number
    firstAt: string
    lastAt: string
    /** 该包内各 kind 的条数 */
    kinds: Record<string, number>
  }>
  /** 按事件类型聚合 */
  byKind: Record<string, number>
  /** 按天聚合 */
  byDay: Array<{ day: string; count: number }>
  /** 时间序列趋势（环比 / 峰值） */
  trend: HostEventTrend
  firstAt?: string
  lastAt?: string
}

/** 一个持续观察（poll 订阅） */
export interface HostWatch {
  watchId: string
  packageId: string
  pageId?: string
  startedAt: string
  /** 已经产出的事件数 */
  eventCount: number
}

/** 事件导出格式（第十二阶段） */
export type HostEventExportFormat = 'jsonl' | 'csv'

/** 事件导出选项 */
export interface HostEventExportOptions {
  /** 导出格式（缺省 jsonl） */
  format?: HostEventExportFormat
  /** 只要这几类事件（缺省 / 空 = 全部） */
  kinds?: HostEventKind[]
  /**
   * 按 kind 拆成多个文件（第十七阶段）。
   *
   * 一份导出物里混着「观察事件」和「写操作审计」时，拿到手还要自己筛。
   * 勾上这个就是每个 kind 一个文件（observe.jsonl / approval.jsonl / …），
   * 文件名带 kind 后缀，导出物清单里也能一眼看出是哪种。
   */
  splitByKind?: boolean
}

/** 事件导出结果 */
export interface HostEventExportResult {
  /** 导出文件的完整路径（拆分时 = 第一个文件的路径，完整清单看 `files`） */
  file: string
  /** 实际导出的事件条数 */
  count: number
  /** 文件字节数（拆分时 = 各文件字节数之和） */
  bytes: number
  format: HostEventExportFormat
  /** 是否因为超过单次导出上限而被截断 */
  truncated: boolean
  /** 导出目录 */
  dir: string
  /** 本次导出的文件清单（单文件时长度 1） */
  files: HostEventExportFile[]
  /** 本次导出覆盖的 kind（单文件时 = 该文件里出现过的全部 kind） */
  kinds: string[]
  /** 是否按 kind 拆分成了多个文件 */
  split: boolean
}

/**
 * 一个导出物文件（第十四阶段：导出物清理入口）。
 *
 * 导出物是**用户主动产物**：程序绝不自动删，只在用户明确点「删除」时删这一个文件。
 */
export interface HostEventExportFile {
  /** 文件名（不含目录，如 ecclaw-events-20261102-175613.jsonl） */
  name: string
  /** 完整路径 */
  file: string
  /** 字节数 */
  bytes: number
  /** 最后修改时间（ISO 8601） */
  modifiedAt: string
  /**
   * 这一份是哪种事件（第十七阶段）。
   *
   * 按 kind 拆分导出时 = 该文件的 kind（observe / approval / page）；
   * 单文件导出 = undefined（里面混着多种）。
   */
  kind?: HostEventKind
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  ts: number
  sessionId?: string
}

export interface EcclawApi {
  gateway: {
    status(): Promise<GatewayStatus>
    start(): Promise<GatewayStatus>
    stop(): Promise<GatewayStatus>
    restart(): Promise<GatewayStatus>
  }
  providers: {
    list(): Promise<ModelProvider[]>
    save(provider: ModelProvider & { apiKey?: string }): Promise<ModelProvider[]>
    remove(id: string): Promise<ModelProvider[]>
    test(provider: ModelProvider & { apiKey?: string }): Promise<ProviderTestResult>
    /** 把某 Provider 的某模型设为内核默认（agents.defaults.model.primary） */
    setDefaultModel(providerId: string, modelId: string): Promise<ModelProvider[]>
  }
  packages: {
    list(): Promise<PlatformPackageInfo[]>
    reload(): Promise<PlatformPackageInfo[]>
    /** 探测各包 runtime.cjs 的能力目录 */
    capabilities(): Promise<PlatformPackageCapabilities[]>
    /** 把能力目录写成 openclaw 托管技能 <stateDir>/skills/<packageId>/SKILL.md */
    syncSkills(): Promise<PlatformPackageSkillSyncResult[]>
    /** 拉取远程包仓库清单 */
    repoIndex(baseUrl: string): Promise<RemoteRepoIndex>
    /**
     * 从远程仓库安装一个包（下载 → 安全解包 → 校验 → 写 current.json 指针）。
     * version 只用于选条目；灰度未放行时仍会拒绝，除非显式 bypassRollout（默认 false）。
     */
    repoInstall(
      baseUrl: string,
      packageId: string,
      version?: string,
      opts?: { bypassRollout?: boolean }
    ): Promise<RemotePackageInstallResult>
    /** 跑一条包内数据查询（包内 buildExpression → 宿主在页面里求值） */
    runDataQuery(
      packageId: string,
      queryId: string,
      argsJson: string,
      url?: string
    ): Promise<HostCommandResult>
    /** 跑一条包内页面动作（page.actions[capability]） */
    runAction(
      packageId: string,
      capability: string,
      payloadJson: string,
      url?: string
    ): Promise<HostCommandResult>
    /** 跑一次包内页面提取（page.extract(context)，只读读 DOM；pageId 留空则按 match 自动匹配） */
    runExtract(packageId: string, pageId?: string, url?: string): Promise<HostCommandResult>
    /** 跑一次包内页面观察（observations → 宿主捕获网络事件 → page.observe(context)） */
    runObserve(packageId: string, pageId?: string, url?: string): Promise<HostCommandResult>
  }
  /** 内嵌浏览器宿主 */
  host: {
    /** 打开一个页面 */
    open(url: string): Promise<HostPageInfo>
    /** 打开页面并读 DOM 概览（只读动作） */
    readDom(url: string): Promise<DomSnapshot>
    /** 摆放宿主页面（可见内嵌浏览器）；传 null 隐藏 */
    setViewport(bounds: HostViewportBounds | null): Promise<void>
    /** 宿主当前状态（页面信息 + 摆放位置） */
    status(): Promise<HostStatus>
    /** 宿主桥（loopback HTTP）是否就绪 */
    bridgeStatus(): Promise<{ ready: boolean; port?: number; pid?: number; startedAt?: string }>
    /** 当前写操作护栏策略 */
    writeGuardMode(): Promise<WriteGuardMode>
    /** 设置写操作护栏策略 */
    setWriteGuardMode(mode: WriteGuardMode): Promise<WriteGuardMode>
    /** 待确认的写操作票据（agent 触发） */
    pendingApprovals(): Promise<WriteApproval[]>
    /** 查一张写操作票据的状态与结果（agent 轮询用） */
    approvalStatus(id: string): Promise<WriteApproval | null>
    /** 回应一次写操作确认（scope 决定顺带记住多少信任：once/session/persistent/persistent-scroll） */
    respondApproval(id: string, approved: boolean, scope?: ApprovalScope): Promise<boolean>
    /** 当前白名单条目（含仅本次会话有效的） */
    guardAllowlist(): Promise<AllowRule[]>
    /** 当前信任规则分组（本次会话 / 永久） */
    guardRuleGroups(): Promise<GuardRuleGroups>
    /** 清空「本次会话」的信任规则（不影响永久规则），返回清掉几条 */
    clearSessionGuardRules(): Promise<number>
    /** 删掉一条白名单条目 */
    removeGuardAllow(rule: AllowRule): Promise<AllowRule[]>
    /** 按「站点 + 可选路径」移除信任规则（不给 path = 清掉该站点全部），返回移除条数 */
    removeGuardRules(
      host: string,
      path?: string,
      scope?: 'session' | 'persistent' | 'all'
    ): Promise<number>
    /** 订阅写操作确认请求（主进程推送） */
    onWriteApproval(cb: (request: WriteApprovalRequest) => void): () => void
    /** 订阅写操作票据的状态变化（批准 / 执行完 / 失败 / 超时） */
    onWriteApprovalUpdate(cb: (approval: WriteApproval) => void): () => void
    /** 订阅宿主增量事件（poll 持续刷新产出） */
    onHostEvent(cb: (event: HostEvent) => void): () => void
    /** 增量拉取宿主事件（sinceSeq 之后的事件） */
    hostEvents(sinceSeq?: number): Promise<HostEvent[]>
    /** 长轮询等下一个宿主事件（超时返回 null，不是错误） */
    nextHostEvent(sinceSeq?: number, timeoutMs?: number): Promise<HostEvent | null>
    /** 启动一个持续观察（poll 订阅） */
    startWatch(packageId: string, pageId?: string): Promise<HostWatch[]>
    /** 停掉一个持续观察 */
    stopWatch(watchId: string): Promise<HostWatch[]>
    /** 当前持续观察列表 */
    listWatches(): Promise<HostWatch[]>
    /** 回放历史宿主事件（落盘后进程重启也能取回） */
    replayHostEvents(filter?: HostEventFilter & { limit?: number }): Promise<HostEvent[]>
    /** 事件汇总（按平台包 / 类型 / 天聚合 + 时间序列趋势） */
    eventSummary(
      filter?: HostEventFilter,
      options?: { bucket?: HostEventTrendBucket }
    ): Promise<HostEventSummary>
    /** 导出已落盘的事件到文件（jsonl / csv） */
    exportHostEvents(
      filter?: HostEventFilter,
      options?: HostEventExportOptions
    ): Promise<HostEventExportResult>
    /** 列出导出物（程序不自动删，由用户自己清理） */
    listEventExports(): Promise<HostEventExportFile[]>
    /** 删除一个导出物（精确文件名；禁通配符 / 批量），返回是否删掉了 */
    removeEventExport(name: string): Promise<boolean>
    /** 在系统文件管理器里定位一个文件（导出后把文件交给用户） */
    showInFolder(file: string): Promise<boolean>
    /** 事件落盘日志概况（目录 / 覆盖天数 / 总条数 / 保留策略） */
    hostEventLogInfo(): Promise<HostEventLogInfo>
    /** 列出店铺登录态 profile + 当前激活项 */
    listProfiles(): Promise<HostProfileState>
    /** 新建一个店铺 profile（= 一个新的空 partition） */
    createProfile(name: string): Promise<HostProfileState>
    /** 切换当前店铺 profile（会重建宿主页面，登录态按 partition 隔离） */
    useProfile(id: string): Promise<HostProfileState>
    /** 移除一个 profile 的配置记录（**不删**磁盘上的登录数据） */
    removeProfile(id: string): Promise<HostProfileState>
  }
  skills: {
    list(): Promise<SkillInfo[]>
    read(name: string): Promise<string>
    save(name: string, content: string): Promise<SkillInfo[]>
  }
  files: {
    list(): Promise<FileEntry[]>
    read(path: string): Promise<string>
    preview(path: string): Promise<DocumentPreview>
    renderPage(path: string, page?: number): Promise<DocumentPageImage>
  }
  chat: {
    send(text: string, sessionId?: string): Promise<ChatMessage>
    history(sessionId?: string): Promise<ChatMessage[]>
  }
  settings: {
    get(): Promise<Record<string, unknown>>
    set(patch: Record<string, unknown>): Promise<Record<string, unknown>>
  }
}

/** 店铺登录态 profile（第十五阶段）：一个 profile = 一个独立 partition */
export interface HostProfile {
  id: string
  name: string
  partition: string
  createdAt: string
  /** 内置默认 profile（不可移除） */
  builtin: boolean
}

/** 全部 profile + 当前激活的 profile id */
export interface HostProfileState {
  profiles: HostProfile[]
  activeId: string
}
