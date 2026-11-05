import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { paths } from './paths'
import {
  chatSend,
  chatHistory,
  gatewayStatus,
  restartGateway,
  startGateway,
  stopGateway
} from './gateway'
import {
  listProviders,
  readSettings,
  removeProvider,
  saveProvider,
  setDefaultModel,
  testProvider,
  writeSettings
} from './openclaw-config'
import { listPackages } from './platform-packages'
import { fetchRepoIndex, installRemotePackage } from './package-repository'
import { loadAllCapabilities } from './platform-runtime'
import {
  hostOpen,
  hostReadDom,
  hostRunAction,
  hostRunDataQuery,
  hostRunExtract,
  hostRunObserve,
  hostSetViewport,
  hostStartWatch,
  hostStopWatch,
  hostListWatches,
  hostNextEvent,
  hostReplayEvents,
  hostEventLogInfo,
  hostEventSummary,
  hostExportEvents,
  hostEventExports,
  hostRemoveEventExport,
  hostGuardRuleGroups,
  hostClearSessionGuardRules,
  hostRemoveGuardRules,
  hostStatus,
  hostProfiles,
  hostCreateProfile,
  hostUseProfile,
  hostRemoveProfile,
  initHost
} from './host-service'
import { initHostEventLog, listHostEvents, setHostEventEmitter } from './host-events'
import { syncPackageSkills } from './package-skills'
import { hostBridgeStatus, startHostBridge } from './host-bridge'
import { ensureMcpServer } from './mcp-bridge'
import {
  approvalStatus,
  listGuardRules,
  listPendingApprovals,
  removeGuardRule,
  resolveWriteApproval,
  setWriteApprovalEmitter,
  setWriteApprovalUpdateEmitter,
  writeGuardMode
} from './write-guard'
import type { AllowRule, ApprovalScope, HostViewportBounds, WriteGuardMode } from '../shared/types'
import { listFiles, listSkills, readFile, readSkill, saveSkill, deleteSkill } from './library'
import { previewDocument, renderDocumentPage, renderDocumentThumbs } from './document-preview'

let mainWindow: BrowserWindow | null = null

/**
 * 解析 IPC 传来的 kind 列表（第十七阶段的多选过滤）。
 * 只认三种已知 kind；空 / 脏数据一律当没传（不限类型）。
 */
function parseEventKinds(value: unknown): ('observe' | 'approval' | 'page')[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: ('observe' | 'approval' | 'page')[] = []
  for (const v of value) {
    if (v === 'observe' || v === 'approval' || v === 'page') out.push(v)
  }
  return out.length > 0 ? out : undefined
}

function ensureDirs(): void {
  for (const dir of [
    paths.openclawConfigDir(),
    paths.openclawStateDir(),
    paths.managedSkillsDir(),
    paths.userSkillsDir(),
    paths.localPackagesDir(),
    paths.workspaceDir(),
    paths.fileLibraryDir()
  ]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#0f1115',
    title: 'ecclaw',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  initHost(mainWindow)

  // 写操作确认：主进程发起 → 渲染进程弹确认卡片 → 用户点「允许/拒绝」回传
  setWriteApprovalEmitter((request) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('host:write-approval-request', request)
  })
  // 票据状态变化（批准 / 执行完 / 失败 / 超时）→ 卡片就地更新状态
  setWriteApprovalUpdateEmitter((approval) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('host:write-approval-update', approval)
  })
  // 宿主增量事件（poll 持续刷新产出）→ 渲染进程增量追加
  setHostEventEmitter((event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('host:host-event', event)
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) {
    void mainWindow.loadURL(devServer)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('gateway:status', () => gatewayStatus())
  ipcMain.handle('gateway:start', () => startGateway())
  ipcMain.handle('gateway:stop', () => stopGateway())
  ipcMain.handle('gateway:restart', () => restartGateway())

  ipcMain.handle('providers:list', () => listProviders())
  ipcMain.handle('providers:save', (_e, provider) => saveProvider(provider))
  ipcMain.handle('providers:remove', (_e, id: string) => removeProvider(id))
  ipcMain.handle('providers:test', (_e, provider) => testProvider(provider))
  ipcMain.handle('providers:set-default', (_e, providerId: string, modelId: string) => {
    setDefaultModel(providerId, modelId)
    return listProviders()
  })

  ipcMain.handle('packages:list', () => listPackages())
  ipcMain.handle('packages:reload', () => listPackages())
  ipcMain.handle('packages:capabilities', () => loadAllCapabilities())
  ipcMain.handle('packages:sync-skills', () => syncPackageSkills())
  ipcMain.handle('packages:repo-index', (_e, baseUrl: string) => fetchRepoIndex(baseUrl))
  ipcMain.handle(
    'packages:repo-install',
    (
      _e,
      baseUrl: string,
      packageId: string,
      version?: string,
      opts?: { bypassRollout?: boolean }
    ) => installRemotePackage(baseUrl, packageId, version, opts)
  )
  ipcMain.handle('packages:run-data-query', (_e, packageId: string, queryId: string, argsJson?: string, url?: string) =>
    hostRunDataQuery(packageId, queryId, argsJson, url)
  )
  ipcMain.handle('packages:run-action', (_e, packageId: string, capability: string, payloadJson?: string, url?: string) =>
    hostRunAction(packageId, capability, payloadJson, url)
  )
  ipcMain.handle('packages:run-extract', (_e, packageId: string, pageId?: string, url?: string) =>
    hostRunExtract(packageId, pageId, url)
  )
  ipcMain.handle('packages:run-observe', (_e, packageId: string, pageId?: string, url?: string) =>
    hostRunObserve(packageId, pageId, url)
  )

  ipcMain.handle('host:open', (_e, url: string) => hostOpen(url))
  ipcMain.handle('host:read-dom', (_e, url: string) => hostReadDom(url))
  ipcMain.handle('host:set-viewport', (_e, bounds: HostViewportBounds | null) => hostSetViewport(bounds))
  ipcMain.handle('host:status', () => hostStatus())
  ipcMain.handle('host:bridge-status', () => {
    const ep = hostBridgeStatus()
    return ep ? { ready: true, port: ep.port, pid: ep.pid, startedAt: ep.startedAt } : { ready: false }
  })
  ipcMain.handle('host:write-guard-mode', () => writeGuardMode())
  ipcMain.handle('host:write-guard-mode-set', (_e, mode: WriteGuardMode) => {
    writeSettings({ hostWriteGuard: mode })
    return writeGuardMode()
  })
  ipcMain.handle('host:write-approvals', () => listPendingApprovals())
  ipcMain.handle('host:write-approval-status', (_e, id: string) => approvalStatus(id))
  ipcMain.handle(
    'host:write-approval-respond',
    (_e, id: string, approved: boolean, scope?: ApprovalScope) =>
      resolveWriteApproval(id, approved, scope ?? 'once')
  )
  ipcMain.handle('host:write-guard-allowlist', () => listGuardRules())
  ipcMain.handle('host:write-guard-allowlist-remove', (_e, rule: AllowRule) => removeGuardRule(rule))
  // 信任规则分组（本次会话 / 永久）+ 只清本次会话
  ipcMain.handle('host:write-guard-rule-groups', () => hostGuardRuleGroups())
  ipcMain.handle('host:write-guard-clear-session', () => hostClearSessionGuardRules())
  // 按「站点 + 可选路径」移除信任规则（不给 path = 清掉该站点全部规则）
  ipcMain.handle('host:write-guard-remove', (_e, host: string, path?: string, scope?: string) =>
    hostRemoveGuardRules(
      String(host ?? ''),
      typeof path === 'string' ? path : undefined,
      scope === 'session' || scope === 'persistent' ? scope : 'all'
    )
  )
  // 导出后把文件交给用户：在系统文件管理器里定位
  ipcMain.handle('host:show-in-folder', (_e, file: string) => {
    if (typeof file !== 'string' || !file.trim()) return false
    shell.showItemInFolder(file)
    return true
  })

  // 宿主增量事件（poll 订阅式持续刷新）
  ipcMain.handle('host:host-events', (_e, sinceSeq?: number) => listHostEvents(Number(sinceSeq ?? 0)))
  ipcMain.handle('host:host-event-next', (_e, sinceSeq?: number, timeoutMs?: number) =>
    hostNextEvent(Number(sinceSeq ?? 0), Math.min(Number(timeoutMs ?? 30000), 55_000))
  )
  ipcMain.handle('host:watch-start', (_e, packageId: string, pageId?: string) =>
    hostStartWatch(packageId, pageId)
  )
  ipcMain.handle('host:watch-stop', (_e, watchId: string) => hostStopWatch(watchId))
  ipcMain.handle('host:watch-list', () => hostListWatches())
  ipcMain.handle('host:host-event-replay', (_e, filter?: Record<string, unknown>) =>
    hostReplayEvents({
      sinceSeq: filter?.sinceSeq === undefined ? undefined : Number(filter.sinceSeq),
      untilSeq: filter?.untilSeq === undefined ? undefined : Number(filter.untilSeq),
      sinceAt: typeof filter?.sinceAt === 'string' ? filter.sinceAt : undefined,
      untilAt: typeof filter?.untilAt === 'string' ? filter.untilAt : undefined,
      packageId: typeof filter?.packageId === 'string' ? filter.packageId : undefined,
      pageId: typeof filter?.pageId === 'string' ? filter.pageId : undefined,
      kind:
        typeof filter?.kind === 'string'
          ? (filter.kind as 'observe' | 'approval' | 'page')
          : undefined,
      kinds: parseEventKinds(filter?.kinds),
      limit: filter?.limit === undefined ? undefined : Number(filter.limit)
    })
  )
  ipcMain.handle('host:host-event-log-info', () => hostEventLogInfo())
  ipcMain.handle('host:host-event-summary', (_e, filter?: Record<string, unknown>, bucket?: string) =>
    hostEventSummary(
      {
        sinceSeq: filter?.sinceSeq === undefined ? undefined : Number(filter.sinceSeq),
        untilSeq: filter?.untilSeq === undefined ? undefined : Number(filter.untilSeq),
        sinceAt: typeof filter?.sinceAt === 'string' ? filter.sinceAt : undefined,
        untilAt: typeof filter?.untilAt === 'string' ? filter.untilAt : undefined,
        packageId: typeof filter?.packageId === 'string' ? filter.packageId : undefined,
        pageId: typeof filter?.pageId === 'string' ? filter.pageId : undefined,
        kind:
          typeof filter?.kind === 'string'
            ? (filter.kind as 'observe' | 'approval' | 'page')
            : undefined,
        kinds: parseEventKinds(filter?.kinds)
      },
      { bucket: bucket === 'hour' ? 'hour' : 'day' }
    )
  )
  ipcMain.handle(
    'host:host-event-export',
    (_e, filter?: Record<string, unknown>, options?: { format?: string; splitByKind?: boolean }) =>
      hostExportEvents(
        {
          sinceSeq: filter?.sinceSeq === undefined ? undefined : Number(filter.sinceSeq),
          untilSeq: filter?.untilSeq === undefined ? undefined : Number(filter.untilSeq),
          sinceAt: typeof filter?.sinceAt === 'string' ? filter.sinceAt : undefined,
          untilAt: typeof filter?.untilAt === 'string' ? filter.untilAt : undefined,
          packageId: typeof filter?.packageId === 'string' ? filter.packageId : undefined,
          pageId: typeof filter?.pageId === 'string' ? filter.pageId : undefined,
          kind:
            typeof filter?.kind === 'string'
              ? (filter.kind as 'observe' | 'approval' | 'page')
              : undefined,
          kinds: parseEventKinds(filter?.kinds)
        },
        {
          format: options?.format === 'csv' ? 'csv' : 'jsonl',
          splitByKind: options?.splitByKind === true
        }
      )
  )
  // 导出物清单 + 逐个删除（程序不自动删；只有用户点「删除」才走这条）
  ipcMain.handle('host:event-exports', () => hostEventExports().files)
  ipcMain.handle('host:event-export-remove', (_e, name: string) =>
    hostRemoveEventExport(String(name ?? ''))
  )
  // 店铺登录态 profile（第十五阶段）：一个 profile = 一个独立 partition
  ipcMain.handle('host:profiles', () => hostProfiles())
  ipcMain.handle('host:profile-create', (_e, name: string) => hostCreateProfile(String(name ?? '')))
  ipcMain.handle('host:profile-use', (_e, id: string) => hostUseProfile(String(id ?? '')))
  ipcMain.handle('host:profile-remove', (_e, id: string) => hostRemoveProfile(String(id ?? '')))

  ipcMain.handle('skills:list', () => listSkills())
  ipcMain.handle('skills:read', (_e, name: string) => readSkill(name))
  ipcMain.handle('skills:save', (_e, name: string, content: string) => saveSkill(name, content))
  ipcMain.handle('skills:delete', (_e, name: string) => deleteSkill(name))

  ipcMain.handle('files:list', () => listFiles())
  ipcMain.handle('files:read', (_e, filePath: string) => readFile(filePath))
  ipcMain.handle('files:preview', (_e, filePath: string) => previewDocument({ path: filePath }))
  ipcMain.handle('files:preview-image', (_e, filePath: string, page?: number, scale?: number) =>
    renderDocumentPage({ path: filePath, page, scale })
  )
  ipcMain.handle('files:preview-thumbs', (_e, filePath: string, pages?: number[], width?: number) =>
    renderDocumentThumbs({ path: filePath, pages, width })
  )

  ipcMain.handle('chat:send', (_e, text: string, sessionId?: string) => chatSend(text, sessionId))
  ipcMain.handle('chat:history', (_e, sessionId?: string) => chatHistory(sessionId))

  ipcMain.handle('settings:get', () => readSettings())
  ipcMain.handle('settings:set', (_e, patch: Record<string, unknown>) => writeSettings(patch))
}

app.whenReady().then(() => {
  ensureDirs()
  initHostEventLog()
  registerIpc()
  createWindow()
  // 宿主桥（loopback HTTP）+ openclaw MCP 服务注册：
  // 让 agent 能通过 MCP 工具真正调用内嵌浏览器宿主（能力 id → 宿主调用）。
  startHostBridge()
  const mcp = ensureMcpServer()
  if (!mcp.registered) {
    process.stderr.write(`[ecclaw] MCP 服务注册失败：${mcp.error ?? '未知原因'}\n`)
  } else {
    process.stdout.write(`[ecclaw] MCP 服务已注册：${mcp.serverName}（${mcp.scriptPath}）\n`)
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
