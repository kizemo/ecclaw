import fs from 'node:fs'
import path from 'node:path'
import { paths } from './paths'
import type { ModelProvider, ProviderKind } from '../shared/types'

/**
 * openclaw 配置读写 + 自定义大模型 Provider 管理。
 *
 * ecclaw 的差异化能力就在这里：dabi 只能用它内置的 provider 白名单，
 * ecclaw 允许用户填任意 OpenAI 兼容 / Anthropic 兼容端点。
 *
 * 写入位置：openclaw.json 的 models.providers（openclaw 自身的模型目录结构）。
 */

export const PROVIDERS_PATH = ['models', 'providers'] as const

interface OpenclawProviderEntry {
  baseUrl?: string
  apiKey?: string
  api?: string
  models?: Array<{ id: string; name?: string }>
  [k: string]: unknown
}

/**
 * ecclaw 自己的 provider 元数据（上游 schema 不允许出现在 openclaw.json 里）。
 * 上游 models.providers.<id> 是 additionalProperties:false，多写一个 label 就会
 * 被 `openclaw config validate` 判为非法，所以显示名/默认模型/本地标记放在这里。
 */
interface ProviderMeta {
  label?: string
  defaultModel?: string
  local?: boolean
}

type OpenclawConfig = Record<string, unknown>

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

/** 去掉 JSONC 注释后再解析（openclaw 配置允许注释） */
function parseConfig(raw: string): OpenclawConfig {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  try {
    return JSON.parse(trimmed) as OpenclawConfig
  } catch {
    const stripped = trimmed
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,(\s*[}\]])/g, '$1')
    return JSON.parse(stripped) as OpenclawConfig
  }
}

export function readConfig(): OpenclawConfig {
  const file = paths.openclawConfigFile()
  if (!fs.existsSync(file)) return {}
  try {
    return parseConfig(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

export function writeConfig(config: OpenclawConfig): void {
  const file = paths.openclawConfigFile()
  ensureDir(path.dirname(file))
  // openclaw 在已有配置文件时要求显式声明 gateway.mode，否则 gateway/agent 拒绝启动
  const gateway = (
    config.gateway && typeof config.gateway === 'object' ? config.gateway : {}
  ) as Record<string, unknown>
  const mode = typeof gateway.mode === 'string' ? gateway.mode : 'local'
  const next: OpenclawConfig = { ...config, gateway: { ...gateway, mode } }
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

/** 读取 openclaw 配置里的 provider 映射 */
function readProviderMap(config: OpenclawConfig): Record<string, OpenclawProviderEntry> {
  let node: unknown = config
  for (const key of PROVIDERS_PATH) {
    if (!node || typeof node !== 'object') return {}
    node = (node as Record<string, unknown>)[key]
  }
  return node && typeof node === 'object' ? (node as Record<string, OpenclawProviderEntry>) : {}
}

function writeProviderMap(
  config: OpenclawConfig,
  map: Record<string, OpenclawProviderEntry>
): OpenclawConfig {
  const next: OpenclawConfig = { ...config }
  let cursor: Record<string, unknown> = next
  const pathKeys = PROVIDERS_PATH as unknown as string[]
  for (let i = 0; i < pathKeys.length - 1; i++) {
    const key = pathKeys[i]
    const child = cursor[key]
    cursor[key] = child && typeof child === 'object' ? { ...(child as object) } : {}
    // openclaw 的 models.mode=merge 表示与内置模型目录合并，而不是覆盖
    if (key === 'models') cursor[key] = { mode: 'merge', ...(cursor[key] as object) }
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[pathKeys[pathKeys.length - 1]] = map
  return next
}

/** 设置默认模型（agents.defaults.model.primary = "provider/model"） */
export function setDefaultModel(providerId: string, modelId: string): void {
  const config = readConfig()
  const agents = (config.agents && typeof config.agents === 'object' ? config.agents : {}) as Record<
    string,
    unknown
  >
  const defaults = (agents.defaults && typeof agents.defaults === 'object' ? agents.defaults : {}) as Record<
    string,
    unknown
  >
  const prevPrimary = (defaults.model as { primary?: string } | undefined)?.primary
  defaults.model = { ...((defaults.model as object) ?? {}), primary: `${providerId}/${modelId}` }
  agents.defaults = defaults
  config.agents = agents
  writeConfig(config)
  syncProviderMetaDefault(prevPrimary, providerId, modelId)
}

/**
 * 同步 ecclaw 侧的 providerMeta.<id>.defaultModel。
 * 按钮的「默认：」态只看 meta，不同步的话切换内核默认后显示会滞后一次刷新。
 * 顺带把上一个默认 provider 的 meta.defaultModel 清掉，避免两个 provider 同时显示「默认：」。
 */
function syncProviderMetaDefault(
  prevPrimary: string | undefined,
  providerId: string,
  modelId: string
): void {
  const map = { ...readProviderMeta() }
  if (prevPrimary && prevPrimary.includes('/')) {
    const prevId = prevPrimary.slice(0, prevPrimary.indexOf('/'))
    if (prevId !== providerId && map[prevId]) {
      const { defaultModel: _dropped, ...rest } = map[prevId]
      map[prevId] = rest
    }
  }
  map[providerId] = { ...(map[providerId] ?? {}), defaultModel: modelId }
  writeSettings({ providerMeta: map })
}

function apiFor(kind: ProviderKind): string {
  return kind === 'anthropic-compatible' ? 'anthropic-messages' : 'openai-completions'
}

export function listProviders(): ModelProvider[] {
  const map = readProviderMap(readConfig())
  const meta = readProviderMeta()
  return Object.entries(map).map(([id, entry]) => {
    const m = meta[id] ?? {}
    return {
      id,
      label: m.label ?? id,
      kind: entry.api === 'anthropic-messages' ? 'anthropic-compatible' : 'openai-compatible',
      baseUrl: entry.baseUrl ?? '',
      hasApiKey: Boolean(entry.apiKey),
      models: (entry.models ?? []).map((item) => item.id),
      defaultModel: m.defaultModel,
      local: Boolean(m.local)
    }
  })
}

export function saveProvider(input: ModelProvider & { apiKey?: string }): ModelProvider[] {
  if (!/^[a-zA-Z0-9_-]+$/.test(input.id)) throw new Error('Provider id 只允许字母、数字、下划线与连字符')
  if (!/^https?:\/\//i.test(input.baseUrl)) throw new Error('baseUrl 必须以 http(s):// 开头')
  if (!input.baseUrl.endsWith('/')) input.baseUrl = `${input.baseUrl}/`

  const config = readConfig()
  const map = readProviderMap(config)
  const prev = map[input.id] ?? {}
  // 只写上游 schema 允许的字段（models.providers.<id> 是 additionalProperties:false）
  const entry: OpenclawProviderEntry = {
    baseUrl: input.baseUrl,
    api: apiFor(input.kind),
    models: input.models.map((id) => ({ id, name: id }))
  }
  const apiKey =
    input.apiKey !== undefined
      ? input.apiKey
      : typeof prev.apiKey === 'string'
        ? prev.apiKey
        : undefined
  if (apiKey !== undefined) entry.apiKey = apiKey
  map[input.id] = entry

  writeConfig(writeProviderMap(config, map))
  writeProviderMeta(input.id, {
    label: input.label || input.id,
    defaultModel: input.defaultModel,
    local: input.local
  })
  // 填了默认模型就同时设为内核默认（agents.defaults.model.primary）
  if (input.defaultModel) setDefaultModel(input.id, input.defaultModel)
  return listProviders()
}

export function removeProvider(id: string): ModelProvider[] {
  const config = readConfig()
  const map = readProviderMap(config)
  if (!map[id]) throw new Error('Provider 不存在')
  delete map[id]
  clearDefaultModel(id, config)
  writeConfig(writeProviderMap(config, map))
  writeProviderMeta(id, undefined)
  return listProviders()
}

/** 删除 Provider 时同步清掉指向它的内核默认模型 */
function clearDefaultModel(providerId: string, config: OpenclawConfig): void {
  const agents = config.agents as Record<string, unknown> | undefined
  const defaults = agents?.defaults as Record<string, unknown> | undefined
  const model = defaults?.model as Record<string, unknown> | undefined
  const primary = model?.primary
  if (model && typeof primary === 'string' && primary.startsWith(`${providerId}/`)) delete model.primary
}

/** 取实际生效的 apiKey（用于连通性测试） */
export function resolveApiKey(id: string, override?: string): string | undefined {
  if (override !== undefined && override !== '') return override
  const entry = readProviderMap(readConfig())[id]
  return entry?.apiKey
}

export interface ProviderProbe {
  provider: ModelProvider & { apiKey?: string }
}

/**
 * 连通性测试：按 provider 类型打真实接口。
 * - openai-compatible: GET {baseUrl}/models
 * - anthropic-compatible: POST {baseUrl}/v1/messages（用最小请求）
 */
export async function testProvider(
  provider: ModelProvider & { apiKey?: string }
): Promise<{ ok: boolean; message: string; latencyMs?: number; models?: string[] }> {
  const started = Date.now()
  const apiKey = resolveApiKey(provider.id, provider.apiKey)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  try {
    if (provider.kind === 'anthropic-compatible') {
      const url = `${provider.baseUrl.replace(/\/$/, '')}/v1/messages`
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: provider.defaultModel ?? provider.models[0] ?? 'claude-3-5-haiku-latest',
          max_tokens: 16,
          messages: [{ role: 'user', content: 'ping' }]
        })
      })
      const latencyMs = Date.now() - started
      if (!res.ok) {
        return { ok: false, message: `HTTP ${res.status} ${res.statusText}`, latencyMs }
      }
      return { ok: true, message: '连接正常', latencyMs }
    }
    const url = `${provider.baseUrl.replace(/\/$/, '')}/models`
    const res = await fetch(url, { method: 'GET', headers })
    const latencyMs = Date.now() - started
    if (!res.ok) return { ok: false, message: `HTTP ${res.status} ${res.statusText}`, latencyMs }
    const data = (await res.json()) as { data?: Array<{ id?: string }> }
    const models = (data.data ?? []).map((m) => m.id ?? '').filter(Boolean)
    return { ok: true, message: `连接正常，发现 ${models.length} 个模型`, latencyMs, models }
  } catch (err) {
    return { ok: false, message: (err as Error).message, latencyMs: Date.now() - started }
  }
}

/** ecclaw 自身的设置（与 openclaw 配置分开存放） */
export function readSettings(): Record<string, unknown> {
  const file = path.join(paths.userData(), 'ecclaw-settings.json')
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function writeSettings(patch: Record<string, unknown>): Record<string, unknown> {
  const file = path.join(paths.userData(), 'ecclaw-settings.json')
  const next = { ...readSettings(), ...patch }
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

/** 读取 ecclaw 侧的 provider 元数据（显示名 / 默认模型 / 本地标记） */
export function readProviderMeta(): Record<string, ProviderMeta> {
  const meta = readSettings().providerMeta
  return meta && typeof meta === 'object' ? (meta as Record<string, ProviderMeta>) : {}
}

export function writeProviderMeta(id: string, meta: ProviderMeta | undefined): void {
  const map = { ...readProviderMeta() }
  if (meta) {
    map[id] = meta
  } else {
    delete map[id]
  }
  writeSettings({ providerMeta: map })
}
