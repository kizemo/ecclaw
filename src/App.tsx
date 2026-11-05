import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import {
  api,
  type AllowRule,
  type ApprovalScope,
  type DocumentPageImage,
  type DocumentPreview,
  type FileEntry,
  type GatewayStatus,
  type GuardRuleGroups,
  type HostProfileState,
  type PlatformPackageCapabilities,
  type PlatformPackageInfo,
  type PlatformPackageSkillSyncResult,
  type RemotePackageEntry,
  type RemoteRepoIndex,
  type SkillInfo,
  type WriteApproval,
  type WriteApprovalStatus,
  type WriteGuardMode
} from './api'
import Chat from './views/Chat'
import Models from './views/Models'
import HostEvents from './views/HostEvents'

type View = 'chat' | 'models' | 'skills' | 'packages' | 'files' | 'host'

/** 写操作票据状态在卡片上的文案 */
const APPROVAL_STATUS_TEXT: Record<WriteApprovalStatus, string> = {
  pending: '等待确认',
  approved: '已允许，正在执行',
  executed: '已执行',
  failed: '执行失败',
  rejected: '已拒绝',
  timeout: '已超时（自动拒绝，未执行）'
}

/** 卡片最多保留最近几张（避免历史票据堆满屏幕） */
const APPROVAL_CARD_LIMIT = 8

const NAV: Array<{ key: View; label: string }> = [
  { key: 'chat', label: '对话' },
  { key: 'models', label: '大模型' },
  { key: 'skills', label: '技能' },
  { key: 'packages', label: '平台包' },
  { key: 'files', label: '文件库' },
  { key: 'host', label: '宿主事件' }
]

export default function App(): JSX.Element {
  const [view, setView] = useState<View>('chat')
  const [gateway, setGateway] = useState<GatewayStatus | null>(null)
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [packages, setPackages] = useState<PlatformPackageInfo[]>([])
  const [files, setFiles] = useState<FileEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [approvals, setApprovals] = useState<WriteApproval[]>([])
  /** 新确认卡片的默认信任范围（用户在卡片上可改） */
  const [scope, setScope] = useState<ApprovalScope>('once')
  /** 每次批准写操作后 +1，触发平台包页重拉信任规则 */
  const [guardEpoch, setGuardEpoch] = useState(0)

  const refreshGateway = useCallback(async () => {
    setGateway(await api.gateway.status())
  }, [])

  useEffect(() => {
    void refreshGateway()
    void api.skills.list().then(setSkills)
    void api.packages.list().then(setPackages)
    void api.files.list().then(setFiles)
    const timer = setInterval(() => void refreshGateway(), 5000)
    return () => clearInterval(timer)
  }, [refreshGateway])

  // 写操作确认：主进程推送请求 → 这里显示确认卡片 → 用户点「允许 / 拒绝」
  // 票据状态变化（批准 / 执行完 / 失败 / 超时）由主进程推送，卡片就地更新
  useEffect(() => {
    const off = api.host.onWriteApproval((request) => {
      setApprovals((list) =>
        list.some((r) => r.id === request.id)
          ? list
          : [...list, { ...request, status: 'pending' as const, updatedAt: request.createdAt }].slice(
              -APPROVAL_CARD_LIMIT
            )
      )
    })
    const offUpdate = api.host.onWriteApprovalUpdate((approval) => {
      setApprovals((list) =>
        (list.some((r) => r.id === approval.id)
          ? list.map((r) => (r.id === approval.id ? approval : r))
          : [...list, approval]
        ).slice(-APPROVAL_CARD_LIMIT)
      )
    })
    void api.host.pendingApprovals().then((list) => setApprovals(list.slice(-APPROVAL_CARD_LIMIT)))
    return () => {
      off()
      offUpdate()
    }
  }, [])

  const answer = useCallback(
    async (id: string, approved: boolean, scope: ApprovalScope = 'once'): Promise<void> => {
      const ok = await api.host.respondApproval(id, approved, scope)
      if (!ok) {
        setApprovals((list) => list.filter((r) => r.id !== id))
        return
      }
      setApprovals((list) =>
        list.map((r) =>
          r.id === id
            ? {
                ...r,
                status: approved ? 'approved' : 'rejected',
                updatedAt: new Date().toISOString()
              }
            : r
        )
      )
      // 这次批准可能顺带写入了信任规则（session / persistent*）→ 让平台包页重拉一次
      setGuardEpoch((n) => n + 1)
    },
    []
  )

  // 终态卡片（已执行 / 已拒绝 / 超时）留一会儿展示结果，然后自动收掉，避免浮层堆满
  useEffect(() => {
    const timer = setInterval(() => {
      const cutoff = Date.now() - 12_000
      setApprovals((list) =>
        list.filter((r) => r.status === 'pending' || new Date(r.updatedAt).getTime() > cutoff)
      )
    }, 3000)
    return () => clearInterval(timer)
  }, [])

  const toggleGateway = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = gateway?.running ? await api.gateway.stop() : await api.gateway.start()
      setGateway(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">ec</span>
          <span className="brand-name">ecclaw</span>
        </div>
        <nav>
          {NAV.map((item) => (
            <button
              key={item.key}
              className={view === item.key ? 'nav-item active' : 'nav-item'}
              onClick={() => setView(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="gateway-box">
          <div className={gateway?.running ? 'dot ok' : 'dot'} />
          <div className="gateway-text">
            <strong>{gateway?.running ? '内核运行中' : '内核未启动'}</strong>
            <span>{gateway?.binary ?? 'openclaw'}</span>
          </div>
          <button className="ghost" disabled={busy} onClick={() => void toggleGateway()}>
            {gateway?.running ? '停止' : '启动'}
          </button>
        </div>
        {gateway?.error ? <p className="error-text">{gateway.error}</p> : null}
      </aside>

      <main className="content">
        {view === 'chat' && <Chat gateway={gateway} />}
        {view === 'models' && <Models />}
        {view === 'skills' && (
          <SkillsView skills={skills} onChange={setSkills} />
        )}
        {view === 'packages' && (
          <PackagesView packages={packages} onChange={setPackages} guardEpoch={guardEpoch} />
        )}
        {view === 'files' && <FilesView files={files} onChange={setFiles} />}
        {view === 'host' && <HostEvents />}
      </main>

      {approvals.length > 0 ? (
        <div className="approval-stack">
          {approvals.map((req) => (
            <div key={req.id} className="approval-card" data-approval-id={req.id}>
              <strong>agent 请求写操作</strong>
              <p className="hint">{req.summary}</p>
              {req.status === 'pending' ? (
                <>
                  <div className="row">
                    <label className="hint" htmlFor={`scope-${req.id}`}>
                      信任范围：
                    </label>
                    <select
                      id={`scope-${req.id}`}
                      value={scope}
                      onChange={(e) => setScope(e.target.value as ApprovalScope)}
                    >
                      <option value="once">仅本次</option>
                      <option value="session">本次会话内信任本站</option>
                      <option value="persistent">永久信任本站（含子域）</option>
                      <option value="persistent-scroll">永久信任本站（只放行滚动）</option>
                      <option value="persistent-path">永久信任本站当前路径</option>
                    </select>
                    <button className="ghost" onClick={() => void answer(req.id, false)}>
                      拒绝
                    </button>
                    <button className="primary" onClick={() => void answer(req.id, true, scope)}>
                      允许
                    </button>
                  </div>
                  <p className="hint">
                    「永久信任本站」= 该域名之后的写操作直接放行，不再弹卡片；
                    「只放行滚动」= 滚动免确认，点按仍逐次询问；
                    「永久信任本站当前路径」= 只信任当前页面所在路径前缀，换到别的路径仍逐次询问。
                  </p>
                </>
              ) : (
                <p className="hint">
                  {APPROVAL_STATUS_TEXT[req.status]}
                  {req.error ? `：${req.error}` : ''}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SkillsView({
  skills,
  onChange
}: {
  skills: SkillInfo[]
  onChange: (s: SkillInfo[]) => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [content, setContent] = useState('')

  const load = async (skillName: string): Promise<void> => {
    const text = await api.skills.read(skillName)
    setName(skillName)
    setContent(text ?? '')
  }

  const save = async (): Promise<void> => {
    if (!name.trim()) return
    onChange(await api.skills.save(name.trim(), content))
  }

  return (
    <section className="view">
      <h1>技能</h1>
      <div className="split">
        <ul className="list">
          {skills.length === 0 ? <li className="empty">暂无技能</li> : null}
          {skills.map((skill) => (
            <li key={`${skill.origin}-${skill.name}`}>
              <button className="link" onClick={() => void load(skill.name)}>
                {skill.name}
              </button>
              <span className="tag">{skill.origin === 'user' ? '用户' : '托管'}</span>
              <p>{skill.description}</p>
            </li>
          ))}
        </ul>
        <div className="editor">
          <input
            placeholder="技能名（新技能请填写）"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            rows={18}
            placeholder={'---\nname: my-skill\ndescription: 描述\n---\n\n正文…'}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <button className="primary" onClick={() => void save()}>
            保存到 user-skills
          </button>
        </div>
      </div>
    </section>
  )
}

function PackagesView({
  packages,
  onChange,
  guardEpoch
}: {
  packages: PlatformPackageInfo[]
  onChange: (p: PlatformPackageInfo[]) => void
  /** 每次批准写操作后 +1 → 重拉信任规则（批准可能顺带写入新规则） */
  guardEpoch: number
}): JSX.Element {
  const [caps, setCaps] = useState<PlatformPackageCapabilities[]>([])
  const [probing, setProbing] = useState(false)
  const [syncResults, setSyncResults] = useState<PlatformPackageSkillSyncResult[]>([])
  const [syncing, setSyncing] = useState(false)
  const [repoUrl, setRepoUrl] = useState('')
  const [repo, setRepo] = useState<RemoteRepoIndex | null>(null)
  const [repoBusy, setRepoBusy] = useState(false)
  const [repoMsg, setRepoMsg] = useState('')
  const [hostUrl, setHostUrl] = useState('')
  const [hostPkg, setHostPkg] = useState('')
  const [hostQuery, setHostQuery] = useState('')
  const [hostArgs, setHostArgs] = useState('{}')
  const [hostCapability, setHostCapability] = useState('')
  const [hostPageId, setHostPageId] = useState('')
  const [hostVisible, setHostVisible] = useState(false)
  const [hostBusy, setHostBusy] = useState(false)
  const [hostOut, setHostOut] = useState('')
  const [bridge, setBridge] = useState<{ ready: boolean; port?: number } | null>(null)
  const [guardMode, setGuardMode] = useState<WriteGuardMode>('ask')
  const [guardGroups, setGuardGroups] = useState<GuardRuleGroups>({
    session: [],
    persistent: []
  })
  // 店铺登录态 profile（第十五阶段）：一个 profile = 一个独立 partition
  const [profileState, setProfileState] = useState<HostProfileState>({
    profiles: [],
    activeId: 'default'
  })
  const [profileName, setProfileName] = useState('')
  /** 移除店铺的二次确认：存住待确认的 profile id（空 = 没在确认） */
  const [profilePendingRemove, setProfilePendingRemove] = useState('')
  /** 店铺切换/新建/移除的结果提示（失败原因也走这里） */
  const [profileMsg, setProfileMsg] = useState('')
  const hostBoxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void api.settings.get().then((settings) => {
      const saved = settings.packageRepo as { baseUrl?: string } | undefined
      if (saved?.baseUrl) setRepoUrl(saved.baseUrl)
    })
    void api.host.bridgeStatus().then(setBridge)
    void api.host.writeGuardMode().then(setGuardMode)
    void api.host.listProfiles().then(setProfileState)
  }, [])

  // 信任规则：首次进入 + 每次批准写操作后（批准可能顺带写入 session/persistent 规则）都重拉
  useEffect(() => {
    void api.host.guardRuleGroups().then(setGuardGroups)
  }, [guardEpoch])

  // 可见内嵌浏览器：把占位盒的位置同步给主进程（主进程据此摆放 WebContentsView）
  useEffect(() => {
    if (!hostVisible) {
      void api.host.setViewport(null)
      return
    }
    const sync = (): void => {
      const el = hostBoxRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.width < 10 || rect.height < 10) return
      void api.host.setViewport({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      })
    }
    const raf = (): void => {
      void requestAnimationFrame(sync)
    }
    sync()
    window.addEventListener('resize', raf)
    window.addEventListener('scroll', raf, true)
    const ro = new ResizeObserver(sync)
    if (hostBoxRef.current) ro.observe(hostBoxRef.current)
    return () => {
      window.removeEventListener('resize', raf)
      window.removeEventListener('scroll', raf, true)
      ro.disconnect()
      void api.host.setViewport(null)
    }
  }, [hostVisible])

  const fetchRepo = async (): Promise<void> => {
    setRepoBusy(true)
    setRepoMsg('')
    try {
      const index = await api.packages.repoIndex(repoUrl)
      setRepo(index)
      setRepoMsg(`远端清单：${index.packages.length} 个包`)
      await api.settings.set({ packageRepo: { baseUrl: repoUrl.trim() } })
    } catch (err) {
      setRepoMsg(`拉取清单失败：${(err as Error).message}`)
    } finally {
      setRepoBusy(false)
    }
  }

  const installRemote = async (entry: RemotePackageEntry): Promise<void> => {
    setRepoBusy(true)
    setRepoMsg('')
    try {
      const res = await api.packages.repoInstall(repoUrl, entry.packageId, entry.version)
      setRepoMsg(`已安装 ${res.packageId}@${res.version}（${res.files} 个文件）`)
      onChange(await api.packages.reload())
    } catch (err) {
      setRepoMsg(`安装失败：${(err as Error).message}`)
    } finally {
      setRepoBusy(false)
    }
  }

  const probe = async (): Promise<void> => {
    setProbing(true)
    try {
      setCaps(await api.packages.capabilities())
    } finally {
      setProbing(false)
    }
  }

  const runHost = async (label: string, task: () => Promise<unknown>): Promise<void> => {
    setHostBusy(true)
    setHostOut('')
    try {
      const result = await task()
      setHostOut(`${label}\n${JSON.stringify(result, null, 2)}`)
    } catch (err) {
      setHostOut(`${label}失败：${(err as Error).message}`)
    } finally {
      setHostBusy(false)
    }
  }

  const sync = async (): Promise<void> => {
    setSyncing(true)
    try {
      setSyncResults(await api.packages.syncSkills())
    } finally {
      setSyncing(false)
    }
  }

  /**
   * 按站点分组（第十三阶段）。
   * 同一站点往往被授权过多条路径规则（/seller/item、/seller/payout…），
   * 平铺成一行看不出哪几条属于同一个站 —— 分组后一眼可见，还能整站撤销。
   */
  const groupByHost = (rules: AllowRule[]): Array<{ host: string; rules: AllowRule[] }> => {
    const map = new Map<string, AllowRule[]>()
    for (const rule of rules) {
      const list = map.get(rule.host) ?? []
      list.push(rule)
      map.set(rule.host, list)
    }
    return [...map.entries()]
      .map(([host, list]) => ({
        host,
        rules: [...list].sort((a, b) => (a.path ?? '').localeCompare(b.path ?? ''))
      }))
      .sort((a, b) => a.host.localeCompare(b.host))
  }

  /** 一个站点的信任组：站点名 + 每条路径规则（可单独移除）+ 整站清空 */
  const guardHostGroup = (
    group: { host: string; rules: AllowRule[] },
    scope: 'session' | 'persistent'
  ): JSX.Element => (
    <span
      key={`${scope}-${group.host}`}
      className="tag"
      title={
        scope === 'session'
          ? '仅本次宿主运行有效，重启即失效'
          : '永久信任（写入 settings）'
      }
    >
      {group.host}
      {group.rules.map((rule) => (
        <span key={`${rule.match}-${rule.ops}-${rule.path ?? ''}`} className="hint">
          {' · '}
          {rule.path ? `路径 ${rule.path}` : '整站'}
          {rule.match === 'host' ? '（精确）' : ''}
          {rule.ops === 'scroll' ? '（只滚动）' : ''}
          <button
            className="link"
            title="移除这条信任"
            onClick={() => {
              void api.host.removeGuardAllow(rule).then(() => {
                void api.host.guardRuleGroups().then(setGuardGroups)
              })
            }}
          >
            移除
          </button>
        </span>
      ))}
      <button
        className="link"
        title={`移除该站点的全部${scope === 'session' ? '本次会话' : '永久'}信任`}
        onClick={() => {
          void api.host.removeGuardRules(group.host, undefined, scope).then(() => {
            void api.host.guardRuleGroups().then(setGuardGroups)
          })
        }}
      >
        清空本站
      </button>
    </span>
  )

  return (
    <section className="view">
      <div className="view-head">
        <h1>平台技能包</h1>
        <div className="actions">
          <button onClick={() => void api.packages.reload().then(onChange)}>重新扫描</button>
          <button className="primary" disabled={probing} onClick={() => void probe()}>
            {probing ? '探测中…' : '探测能力'}
          </button>
          <button
            disabled={syncing}
            onClick={() => void sync()}
            title="把探测到的能力目录写成 openclaw 托管技能 <stateDir>/skills/<packageId>/SKILL.md"
          >
            {syncing ? '生成中…' : '生成 Agent 技能'}
          </button>
        </div>
      </div>
      <p className="hint">
        包协议对齐 dabi platform-packages：manifest 声明站点匹配、页面描述与站点知识文档，runtime.cjs
        提供工具实现。目录：resources/platform-packages（内置）与用户数据目录（本地）。
      </p>
      {syncResults.length > 0 ? (
        <p className="hint">
          已生成 {syncResults.filter((r) => r.skillPath).length} 个托管技能（state 目录 skills/
          下，「技能」页可见）
          {syncResults.some((r) => r.error)
            ? `；失败：${syncResults
                .filter((r) => r.error)
                .map((r) => `${r.packageId}（${r.error}）`)
                .join('、')}`
            : ''}
        </p>
      ) : null}
      <article className="card">
        <header>
          <strong>内嵌浏览器宿主（实验）</strong>
          <span className="tag">打开页面 → 读 DOM → 返回结果</span>
          <button
            className="ghost"
            onClick={() => setHostVisible((v) => !v)}
            title="在下方占位盒里显示宿主页面（主进程把 WebContentsView 摆到该位置）"
          >
            {hostVisible ? '隐藏内嵌浏览器' : '显示内嵌浏览器'}
          </button>
        </header>
        <p className="hint">
          宿主用 Electron WebContentsView 承载页面，按 dabi 的动作 context 契约把页面求值能力
          （context.eval）暴露给平台包。数据查询走「包内 buildExpression → 宿主在页面里求值」。
        </p>
        <div className="row">
          <span className="tag">{bridge?.ready ? `宿主桥已就绪 :${bridge.port}` : '宿主桥未就绪'}</span>
          <label className="hint" htmlFor="host-guard-mode">
            agent 写操作：
          </label>
          <select
            id="host-guard-mode"
            value={guardMode}
            onChange={(e) => {
              const mode = e.target.value as WriteGuardMode
              setGuardMode(mode)
              void api.host.setWriteGuardMode(mode)
            }}
          >
            <option value="ask">每次询问</option>
            <option value="allow">直接放行</option>
            <option value="deny">全部拒绝</option>
          </select>
        </div>
        {/* 店铺登录态 profile（第十五阶段）：一个 profile = 一个独立 partition */}
        <div className="row">
          <label className="hint" htmlFor="host-profile">
            店铺登录态：
          </label>
          <select
            id="host-profile"
            data-testid="host-profile-select"
            value={profileState.activeId}
            onChange={(e) => {
              const id = e.target.value
              setProfileMsg('')
              void api.host
                .useProfile(id)
                .then((state) => {
                  setProfileState(state)
                  setProfileMsg('已切换店铺（内嵌浏览器页面需重新打开）')
                })
                .catch((err: unknown) => setProfileMsg(String((err as Error)?.message ?? err)))
            }}
          >
            {profileState.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.builtin ? '（默认）' : ''}
              </option>
            ))}
          </select>
          <input
            placeholder="新店铺名"
            data-testid="host-profile-name"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
          />
          <button
            className="ghost"
            data-testid="host-profile-create"
            disabled={!profileName.trim()}
            onClick={() => {
              const name = profileName.trim()
              setProfileMsg('')
              void api.host
                .createProfile(name)
                .then((state) => {
                  setProfileState(state)
                  setProfileName('')
                  setProfileMsg(`已新建店铺「${name}」（独立登录态）`)
                })
                .catch((err: unknown) => setProfileMsg(String((err as Error)?.message ?? err)))
            }}
          >
            新建店铺
          </button>
          <span className="hint">
            当前 partition：
            {profileState.profiles.find((p) => p.id === profileState.activeId)?.partition ?? '—'}
          </span>
        </div>
        <div className="row">
          <span className="hint">
            每个店铺一个独立 partition（登录态互不串味）；切换店铺会关闭当前页面，需要重新打开。
          </span>
          {profileMsg ? <span className="hint">{profileMsg}</span> : null}
        </div>
        {profileState.profiles.filter((p) => !p.builtin).length > 0 ? (
          <div className="row">
            <span className="hint">移除店铺（只移除配置，不删磁盘上的登录数据）：</span>
            {profileState.profiles
              .filter((p) => !p.builtin)
              .map((p) => (
                <button
                  key={p.id}
                  className="ghost"
                  data-testid={`host-profile-remove-${p.id}`}
                  onClick={() => {
                    if (profilePendingRemove !== p.id) {
                      setProfilePendingRemove(p.id)
                      return
                    }
                    setProfilePendingRemove('')
                    setProfileMsg('')
                    void api.host
                      .removeProfile(p.id)
                      .then((state) => {
                        setProfileState(state)
                        setProfileMsg(`已移除「${p.name}」（磁盘上的登录数据未删除）`)
                      })
                      .catch((err: unknown) => setProfileMsg(String((err as Error)?.message ?? err)))
                  }}
                >
                  {profilePendingRemove === p.id ? `确认移除「${p.name}」？` : `移除 ${p.name}`}
                </button>
              ))}
          </div>
        ) : null}
        {guardGroups.session.length > 0 ? (
          <div className="row">
            <span className="hint">本次会话信任：</span>
            {groupByHost(guardGroups.session).map((g) => guardHostGroup(g, 'session'))}
            <button
              className="ghost"
              title="只清掉本次会话的信任，永久规则保留"
              onClick={() => {
                void api.host.clearSessionGuardRules().then(() => {
                  void api.host.guardRuleGroups().then(setGuardGroups)
                })
              }}
            >
              清空本次会话
            </button>
          </div>
        ) : null}
        {guardGroups.persistent.length > 0 ? (
          <div className="row">
            <span className="hint">永久信任：</span>
            {groupByHost(guardGroups.persistent).map((g) => guardHostGroup(g, 'persistent'))}
          </div>
        ) : null}
        <div className="row">
          <input
            value={hostUrl}
            placeholder="https://example.com/page"
            onChange={(e) => setHostUrl(e.target.value)}
          />
          <button
            disabled={hostBusy || !hostUrl.trim()}
            onClick={() =>
              void runHost('读 DOM', async () => api.host.readDom(hostUrl.trim()))
            }
          >
            打开并读 DOM
          </button>
        </div>
        <div className="row">
          <input
            value={hostPkg}
            placeholder="平台包 id（如 databank）"
            onChange={(e) => setHostPkg(e.target.value)}
          />
          <input
            value={hostQuery}
            placeholder="数据查询 id"
            onChange={(e) => setHostQuery(e.target.value)}
          />
          <input value={hostArgs} placeholder='{"keyword":"x"}' onChange={(e) => setHostArgs(e.target.value)} />
          <button
            disabled={hostBusy || !hostPkg.trim() || !hostQuery.trim()}
            onClick={() =>
              void runHost('数据查询', async () =>
                api.packages.runDataQuery(
                  hostPkg.trim(),
                  hostQuery.trim(),
                  hostArgs,
                  hostUrl.trim() || undefined
                )
              )
            }
          >
            执行数据查询
          </button>
        </div>
        <div className="row">
          <input
            value={hostCapability}
            placeholder="动作能力 id（如 taobao.product.collectReviews）"
            onChange={(e) => setHostCapability(e.target.value)}
          />
          <button
            disabled={hostBusy || !hostPkg.trim() || !hostCapability.trim()}
            onClick={() =>
              void runHost('页面动作', async () =>
                api.packages.runAction(
                  hostPkg.trim(),
                  hostCapability.trim(),
                  '{}',
                  hostUrl.trim() || undefined
                )
              )
            }
          >
            执行页面动作
          </button>
        </div>
        <div className="row">
          <input
            value={hostPageId}
            placeholder="页面 id（留空则按 match 自动匹配）"
            onChange={(e) => setHostPageId(e.target.value)}
          />
          <button
            disabled={hostBusy || !hostPkg.trim()}
            onClick={() =>
              void runHost('页面提取', async () =>
                api.packages.runExtract(
                  hostPkg.trim(),
                  hostPageId.trim() || undefined,
                  hostUrl.trim() || undefined
                )
              )
            }
          >
            执行页面提取
          </button>
          <button
            disabled={hostBusy || !hostPkg.trim()}
            onClick={() =>
              void runHost('页面观察', async () =>
                api.packages.runObserve(
                  hostPkg.trim(),
                  hostPageId.trim() || undefined,
                  hostUrl.trim() || undefined
                )
              )
            }
          >
            执行页面观察
          </button>
        </div>
        {hostVisible ? (
          <div className="host-viewport" ref={hostBoxRef}>
            <span className="host-viewport-hint">宿主页面显示区</span>
          </div>
        ) : null}
        {hostOut ? <pre className="mono host-out">{hostOut}</pre> : null}
      </article>
      <article className="card">
        <header>
          <strong>远程包仓库</strong>
          <span className="tag">index.json → 下载 → 安全解包 → 落盘</span>
        </header>
        <p className="hint">
          仓库根目录需提供 index.json（packages[] 含 packageUrl 签名直链）。安装会校验归档 sha256 与
          manifest 哈希，再写到本地包目录并更新 current.json 指针。
        </p>
        <div className="row">
          <input
            value={repoUrl}
            placeholder="https://repo.example.com/platform-packages"
            onChange={(e) => setRepoUrl(e.target.value)}
          />
          <button disabled={repoBusy || !repoUrl.trim()} onClick={() => void fetchRepo()}>
            {repoBusy ? '处理中…' : '拉取清单'}
          </button>
        </div>
        {repoMsg ? <p className="hint">{repoMsg}</p> : null}
        {repo?.packages.map((entry) => {
          const blocked = entry.eligible === false
          const rolloutLabel = entry.rollout
            ? entry.eligibleReason === 'allowlisted'
              ? '内测名单'
              : entry.eligibleReason === 'denylisted'
                ? '已排除'
                : blocked
                  ? `未灰度到（${entry.bucket ?? '-'}/${entry.rollout.percent}%）`
                  : `灰度命中（${entry.bucket ?? '-'}/${entry.rollout.percent}%）`
            : null
          const key = `${entry.packageId}@${entry.version ?? 'unknown'}`
          return (
            <div key={key} className="row" data-testid={`repo-entry-${key}`}>
              <span className="mono">{entry.packageId}</span>
              <span className="tag">{entry.version ?? '未知版本'}</span>
              {entry.channel ? <span className="tag">{entry.channel}</span> : null}
              {rolloutLabel ? (
                <span className="tag" data-testid={`repo-rollout-${key}`}>
                  {rolloutLabel}
                </span>
              ) : null}
              <button
                className="ghost"
                disabled={repoBusy || blocked}
                title={blocked ? '灰度未放行，不能安装' : undefined}
                data-testid={`repo-install-${key}`}
                onClick={() => void installRemote(entry)}
              >
                {blocked ? '未放行' : '安装'}
              </button>
            </div>
          )
        })}
      </article>
      <div className="cards">
        {packages.length === 0 ? <p className="empty">未发现平台包</p> : null}
        {packages.map((pkg) => {
          const cap = caps.find((c) => c.packageId === pkg.manifest.packageId)
          const actionCount = cap
            ? cap.pages.reduce((n, p) => n + new Set([...p.actions, ...p.automationActions]).size, 0)
            : 0
          const total = cap ? actionCount + cap.tools.length + cap.dataQueries.length : 0
          return (
            <article key={pkg.manifest.packageId} className="card">
              <header>
                <strong>{pkg.manifest.displayName}</strong>
                <span className="tag">{pkg.manifest.version}</span>
                <span className="tag">{pkg.origin === 'bundled' ? '内置' : '本地'}</span>
              </header>
              <p className="mono">{pkg.manifest.packageId}</p>
              <p>
                站点：{(pkg.registry?.match ?? pkg.manifest.match ?? pkg.manifest.sites ?? []).join('、') ||
                  '—'}
                {pkg.registry?.matchPriority ?? pkg.manifest.matchPriority
                  ? `（优先级 ${pkg.registry?.matchPriority ?? pkg.manifest.matchPriority}）`
                  : ''}
              </p>
              <p>页面：{(pkg.manifest.pages ?? []).map((p) => p.path).join('、') || '—'}</p>
              <p className="hint">文档 {pkg.docs.length} 篇 · 运行时 {pkg.manifest.runtime ?? '—'}</p>
              {cap ? (
                <>
                  <p className="hint">
                    能力 {total} 项 · 页面 {cap.pages.length} 个
                    {cap.error ? ` · 探测提示：${cap.error}` : ''}
                  </p>
                  {cap.tools.length > 0 ? (
                    <p className="hint">工具：{cap.tools.map((t) => t.name).join('、')}</p>
                  ) : null}
                  {cap.dataQueries.length > 0 ? (
                    <p className="hint">数据查询：{cap.dataQueries.join('、')}</p>
                  ) : null}
                  {cap.pages.map((page) => (
                    <div key={page.id} className="hint">
                      <p className="mono">{page.id}</p>
                      {page.actions.map((a) => (
                        <span key={a} className="tag">
                          {a}
                        </span>
                      ))}
                    </div>
                  ))}
                </>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function FilesView({
  files,
  onChange
}: {
  files: FileEntry[]
  onChange: (f: FileEntry[]) => void
}): JSX.Element {
  const [content, setContent] = useState('')
  const [current, setCurrent] = useState('')
  const [preview, setPreview] = useState<DocumentPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [image, setImage] = useState<DocumentPageImage | null>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState('')

  const showPage = async (filePath: string, page: number): Promise<void> => {
    setImageBusy(true)
    setImageError('')
    try {
      setImage(await api.files.renderPage(filePath, page))
    } catch (e) {
      setImage(null)
      setImageError(String(e instanceof Error ? e.message : e).slice(0, 200))
    } finally {
      setImageBusy(false)
    }
  }

  const open = async (file: FileEntry): Promise<void> => {
    setCurrent(file.name)
    setContent('')
    setPreview(null)
    setPreviewError('')
    setImage(null)
    setImageError('')
    // PDF / DOCX / PPTX / XLSX 走文档预览；其余格式维持原来的纯文本读取
    const isPdf = /\.pdf$/i.test(file.name)
    const isOffice = /\.(docx|pptx|xlsx)$/i.test(file.name)
    if (isPdf || isOffice) {
      setPreviewing(true)
      try {
        const p = await api.files.preview(file.path)
        setPreview(p)
        if (p.error) setPreviewError(p.error)
        // PDF 额外渲染第 1 页位图（只给界面看，agent 仍读文本）
        if (isPdf && !p.error) void showPage(file.path, 1)
      } catch (e) {
        setPreviewError(String(e instanceof Error ? e.message : e).slice(0, 200))
      } finally {
        setPreviewing(false)
      }
      return
    }
    const text = await api.files.read(file.path)
    setContent(text ?? '')
  }

  return (
    <section className="view">
      <h1>文件库</h1>
      <div className="split">
        <ul className="list">
          {files.length === 0 ? <li className="empty">文件库为空</li> : null}
          {files.map((file) => (
            <li key={file.path}>
              <button className="link" onClick={() => void open(file)}>
                {file.name}
              </button>
              <span className="tag">{file.size} B</span>
              {/\.pdf$/i.test(file.name) ? <span className="tag">PDF 预览</span> : null}
              {/\.docx$/i.test(file.name) ? <span className="tag">DOCX 预览</span> : null}
              {/\.pptx$/i.test(file.name) ? <span className="tag">PPTX 预览</span> : null}
              {/\.xlsx$/i.test(file.name) ? <span className="tag">XLSX 预览</span> : null}
            </li>
          ))}
        </ul>
        <div className="editor">
          <h2>{current}</h2>
          {previewing ? <p className="hint">正在解析文档…</p> : null}
          {previewError ? (
            <p className="error-text" data-testid="doc-preview-error">
              {previewError}
            </p>
          ) : null}
          {preview ? (
            <div data-testid="doc-preview">
              <p className="hint" data-testid="doc-preview-meta">
                {preview.kind === 'pdf'
                  ? `PDF · ${preview.pageCount ?? '?'} 页`
                  : preview.kind === 'docx'
                    ? 'DOCX · 文本预览'
                    : preview.kind === 'pptx'
                      ? 'PPTX · 文本预览'
                      : preview.kind === 'xlsx'
                        ? 'XLSX · 文本预览'
                        : '非 PDF/DOCX/PPTX/XLSX 文档'}{' '}
                · {preview.size} B{preview.truncated ? ' · 内容已截断' : ''}
              </p>
              {preview.kind === 'pdf' && imageBusy ? (
                <p className="hint" data-testid="doc-preview-image-busy">
                  正在渲染位图…
                </p>
              ) : null}
              {preview.kind === 'pdf' && imageError ? (
                <p className="error-text" data-testid="doc-preview-image-error">
                  {imageError}
                </p>
              ) : null}
              {preview.kind === 'pdf' && image ? (
                <figure data-testid="doc-preview-image-wrap">
                  <img
                    data-testid="doc-preview-image"
                    src={image.dataUrl}
                    alt={`第 ${image.page} 页`}
                    style={{ maxWidth: '100%', border: '1px solid #ddd' }}
                  />
                  <figcaption className="hint" data-testid="doc-preview-image-meta">
                    第 {image.page} / {preview.pageCount ?? '?'} 页 · {image.width}×{image.height}
                  </figcaption>
                  {(preview.pageCount ?? 1) > 1 ? (
                    <div>
                      <button
                        className="link"
                        data-testid="doc-preview-prev"
                        disabled={imageBusy || image.page <= 1}
                        onClick={() => void showPage(preview.path, image.page - 1)}
                      >
                        上一页
                      </button>{' '}
                      <button
                        className="link"
                        data-testid="doc-preview-next"
                        disabled={imageBusy || image.page >= (preview.pageCount ?? 1)}
                        onClick={() => void showPage(preview.path, image.page + 1)}
                      >
                        下一页
                      </button>
                    </div>
                  ) : null}
                </figure>
              ) : null}
              {preview.kind === 'docx' || preview.kind === 'pptx' || preview.kind === 'xlsx' ? (
                <pre data-testid="doc-preview-text">{preview.text || '（没有可抽取的文字）'}</pre>
              ) : null}
              {preview.pages.map((p) => (
                <section key={p.page} data-testid={`doc-preview-page-${p.page}`}>
                  <p className="mono">第 {p.page} 页</p>
                  <pre data-testid={`doc-preview-text-${p.page}`}>{p.text || '（本页没有可抽取的文字）'}</pre>
                </section>
              ))}
            </div>
          ) : null}
          {!preview && !previewing ? <textarea rows={18} readOnly value={content} /> : null}
        </div>
      </div>
    </section>
  )
}
