import { contextBridge, ipcRenderer } from 'electron'
import type {
  ChatMessage,
  DomSnapshot,
  EcclawApi,
  FileEntry,
  DocumentPageImage,
  DocumentPageThumbs,
  DocumentPreview,
  GatewayStatus,
  HostCommandResult,
  HostEvent,
  HostEventFilter,
  HostEventExportFile,
  HostEventLogInfo,
  HostEventSummary,
  HostEventTrendBucket,
  HostEventExportOptions,
  HostEventExportResult,
  GuardRuleGroups,
  HostPageInfo,
  HostProfileState,
  HostStatus,
  HostViewportBounds,
  HostWatch,
  ModelProvider,
  PlatformPackageCapabilities,
  PlatformPackageInfo,
  PlatformPackageSkillSyncResult,
  RemotePackageInstallResult,
  RemoteRepoIndex,
  ProviderTestResult,
  SkillInfo,
  WriteApproval,
  WriteApprovalRequest,
  WriteGuardMode,
  ApprovalScope,
  AllowRule
} from '../shared/types'

/**
 * 渲染进程只拿到这层白名单 API，不暴露 node/electron 能力。
 */
const api: EcclawApi = {
  gateway: {
    status: (): Promise<GatewayStatus> => ipcRenderer.invoke('gateway:status'),
    start: (): Promise<GatewayStatus> => ipcRenderer.invoke('gateway:start'),
    stop: (): Promise<GatewayStatus> => ipcRenderer.invoke('gateway:stop'),
    restart: (): Promise<GatewayStatus> => ipcRenderer.invoke('gateway:restart')
  },
  providers: {
    list: (): Promise<ModelProvider[]> => ipcRenderer.invoke('providers:list'),
    save: (provider): Promise<ModelProvider[]> => ipcRenderer.invoke('providers:save', provider),
    remove: (id: string): Promise<ModelProvider[]> => ipcRenderer.invoke('providers:remove', id),
    test: (provider): Promise<ProviderTestResult> => ipcRenderer.invoke('providers:test', provider),
    setDefaultModel: (providerId: string, modelId: string): Promise<ModelProvider[]> =>
      ipcRenderer.invoke('providers:set-default', providerId, modelId)
  },
  packages: {
    list: (): Promise<PlatformPackageInfo[]> => ipcRenderer.invoke('packages:list'),
    reload: (): Promise<PlatformPackageInfo[]> => ipcRenderer.invoke('packages:reload'),
    capabilities: (): Promise<PlatformPackageCapabilities[]> =>
      ipcRenderer.invoke('packages:capabilities'),
    syncSkills: (): Promise<PlatformPackageSkillSyncResult[]> =>
      ipcRenderer.invoke('packages:sync-skills'),
    repoIndex: (baseUrl: string): Promise<RemoteRepoIndex> =>
      ipcRenderer.invoke('packages:repo-index', baseUrl),
    repoInstall: (
      baseUrl: string,
      packageId: string,
      version?: string,
      opts?: { bypassRollout?: boolean }
    ): Promise<RemotePackageInstallResult> =>
      ipcRenderer.invoke('packages:repo-install', baseUrl, packageId, version, opts),
    runDataQuery: (
      packageId: string,
      queryId: string,
      argsJson?: string,
      url?: string
    ): Promise<HostCommandResult> =>
      ipcRenderer.invoke('packages:run-data-query', packageId, queryId, argsJson, url),
    runAction: (
      packageId: string,
      capability: string,
      payloadJson?: string,
      url?: string
    ): Promise<HostCommandResult> =>
      ipcRenderer.invoke('packages:run-action', packageId, capability, payloadJson, url),
    runExtract: (packageId: string, pageId?: string, url?: string): Promise<HostCommandResult> =>
      ipcRenderer.invoke('packages:run-extract', packageId, pageId, url),
    runObserve: (packageId: string, pageId?: string, url?: string): Promise<HostCommandResult> =>
      ipcRenderer.invoke('packages:run-observe', packageId, pageId, url)
  },
  host: {
    open: (url: string): Promise<HostPageInfo> => ipcRenderer.invoke('host:open', url),
    readDom: (url: string): Promise<DomSnapshot> => ipcRenderer.invoke('host:read-dom', url),
    setViewport: (bounds: HostViewportBounds | null): Promise<void> =>
      ipcRenderer.invoke('host:set-viewport', bounds),
    status: (): Promise<HostStatus> => ipcRenderer.invoke('host:status'),
    bridgeStatus: (): Promise<{ ready: boolean; port?: number; pid?: number; startedAt?: string }> =>
      ipcRenderer.invoke('host:bridge-status'),
    writeGuardMode: (): Promise<WriteGuardMode> => ipcRenderer.invoke('host:write-guard-mode'),
    setWriteGuardMode: (mode: WriteGuardMode): Promise<WriteGuardMode> =>
      ipcRenderer.invoke('host:write-guard-mode-set', mode),
    pendingApprovals: (): Promise<WriteApproval[]> => ipcRenderer.invoke('host:write-approvals'),
    approvalStatus: (id: string): Promise<WriteApproval | null> =>
      ipcRenderer.invoke('host:write-approval-status', id),
    respondApproval: (id: string, approved: boolean, scope?: ApprovalScope): Promise<boolean> =>
      ipcRenderer.invoke('host:write-approval-respond', id, approved, scope ?? 'once'),
    guardAllowlist: (): Promise<AllowRule[]> => ipcRenderer.invoke('host:write-guard-allowlist'),
    guardRuleGroups: (): Promise<GuardRuleGroups> =>
      ipcRenderer.invoke('host:write-guard-rule-groups'),
    clearSessionGuardRules: (): Promise<number> =>
      ipcRenderer.invoke('host:write-guard-clear-session'),
    removeGuardAllow: (rule: AllowRule): Promise<AllowRule[]> =>
      ipcRenderer.invoke('host:write-guard-allowlist-remove', rule),
    removeGuardRules: (
      host: string,
      path?: string,
      scope?: 'session' | 'persistent' | 'all'
    ): Promise<number> =>
      ipcRenderer.invoke('host:write-guard-remove', host, path, scope ?? 'all'),
    onWriteApproval: (cb: (request: WriteApprovalRequest) => void): (() => void) => {
      const listener = (_e: unknown, request: WriteApprovalRequest): void => cb(request)
      ipcRenderer.on('host:write-approval-request', listener)
      return () => {
        ipcRenderer.removeListener('host:write-approval-request', listener)
      }
    },
    onWriteApprovalUpdate: (cb: (approval: WriteApproval) => void): (() => void) => {
      const listener = (_e: unknown, approval: WriteApproval): void => cb(approval)
      ipcRenderer.on('host:write-approval-update', listener)
      return () => {
        ipcRenderer.removeListener('host:write-approval-update', listener)
      }
    },
    onHostEvent: (cb: (event: HostEvent) => void): (() => void) => {
      const listener = (_e: unknown, event: HostEvent): void => cb(event)
      ipcRenderer.on('host:host-event', listener)
      return () => {
        ipcRenderer.removeListener('host:host-event', listener)
      }
    },
    hostEvents: (sinceSeq?: number): Promise<HostEvent[]> =>
      ipcRenderer.invoke('host:host-events', sinceSeq ?? 0),
    nextHostEvent: (sinceSeq?: number, timeoutMs?: number): Promise<HostEvent | null> =>
      ipcRenderer.invoke('host:host-event-next', sinceSeq ?? 0, timeoutMs ?? 30000),
    startWatch: (packageId: string, pageId?: string): Promise<HostWatch[]> =>
      ipcRenderer.invoke('host:watch-start', packageId, pageId),
    stopWatch: (watchId: string): Promise<HostWatch[]> => ipcRenderer.invoke('host:watch-stop', watchId),
    listWatches: (): Promise<HostWatch[]> => ipcRenderer.invoke('host:watch-list'),
    replayHostEvents: (filter?: HostEventFilter & { limit?: number }): Promise<HostEvent[]> =>
      ipcRenderer.invoke('host:host-event-replay', filter ?? {}),
    eventSummary: (
      filter?: HostEventFilter,
      options?: { bucket?: HostEventTrendBucket }
    ): Promise<HostEventSummary> =>
      ipcRenderer.invoke('host:host-event-summary', filter ?? {}, options?.bucket ?? 'day'),
    exportHostEvents: (
      filter?: HostEventFilter,
      options?: HostEventExportOptions
    ): Promise<HostEventExportResult> =>
      ipcRenderer.invoke('host:host-event-export', filter ?? {}, {
        format: options?.format ?? 'jsonl',
        splitByKind: options?.splitByKind === true
      }),
    listEventExports: (): Promise<HostEventExportFile[]> =>
      ipcRenderer.invoke('host:event-exports'),
    removeEventExport: (name: string): Promise<boolean> =>
      ipcRenderer.invoke('host:event-export-remove', name),
    showInFolder: (file: string): Promise<boolean> => ipcRenderer.invoke('host:show-in-folder', file),
    hostEventLogInfo: (): Promise<HostEventLogInfo> =>
      ipcRenderer.invoke('host:host-event-log-info'),
    listProfiles: (): Promise<HostProfileState> => ipcRenderer.invoke('host:profiles'),
    createProfile: (name: string): Promise<HostProfileState> =>
      ipcRenderer.invoke('host:profile-create', name),
    useProfile: (id: string): Promise<HostProfileState> =>
      ipcRenderer.invoke('host:profile-use', id),
    removeProfile: (id: string): Promise<HostProfileState> =>
      ipcRenderer.invoke('host:profile-remove', id)
  },
  skills: {
    list: (): Promise<SkillInfo[]> => ipcRenderer.invoke('skills:list'),
    read: (name: string): Promise<string> => ipcRenderer.invoke('skills:read', name),
    save: (name: string, content: string): Promise<SkillInfo[]> =>
      ipcRenderer.invoke('skills:save', name, content)
  },
  files: {
    list: (): Promise<FileEntry[]> => ipcRenderer.invoke('files:list'),
    read: (path: string): Promise<string> => ipcRenderer.invoke('files:read', path),
    preview: (path: string): Promise<DocumentPreview> => ipcRenderer.invoke('files:preview', path),
    renderPage: (path: string, page?: number, scale?: number): Promise<DocumentPageImage> =>
      ipcRenderer.invoke('files:preview-image', path, page, scale),
    renderThumbs: (path: string, pages?: number[], width?: number): Promise<DocumentPageThumbs> =>
      ipcRenderer.invoke('files:preview-thumbs', path, pages, width)
  },
  chat: {
    send: (text: string, sessionId?: string): Promise<ChatMessage> =>
      ipcRenderer.invoke('chat:send', text, sessionId),
    history: (sessionId?: string): Promise<ChatMessage[]> =>
      ipcRenderer.invoke('chat:history', sessionId)
  },
  settings: {
    get: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('settings:get'),
    set: (patch: Record<string, unknown>): Promise<Record<string, unknown>> =>
      ipcRenderer.invoke('settings:set', patch)
  }
}

contextBridge.exposeInMainWorld('ecclaw', api)
