import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { paths } from './paths'
import type { ChatMessage, GatewayStatus } from '../shared/types'

/**
 * openclaw 内核（gateway）进程管理。
 *
 * 内核来源优先级：
 *   1. ECCLAW_OPENCLAW_BIN 环境变量（指向 openclaw.mjs 或可执行文件）
 *   2. 应用内 node_modules/openclaw
 *   3. PATH 上的 openclaw
 *
 * HOME 指向 <userData>/openclaw，使 openclaw 的状态目录落在
 * <userData>/openclaw/.openclaw —— 与 dabi 的接缝完全一致。
 */

export interface OpenclawRuntime {
  command: string
  args: string[]
  label: string
}

export function resolveOpenclaw(): OpenclawRuntime | null {
  const envBin = process.env.ECCLAW_OPENCLAW_BIN
  if (envBin && fs.existsSync(envBin)) {
    return envBin.endsWith('.mjs')
      ? { command: process.execPath, args: [envBin], label: envBin }
      : { command: envBin, args: [], label: envBin }
  }
  const bundled = path.join(app.getAppPath(), 'node_modules', 'openclaw', 'openclaw.mjs')
  if (fs.existsSync(bundled)) {
    return { command: process.execPath, args: [bundled], label: bundled }
  }
  return { command: 'openclaw', args: [], label: 'openclaw (PATH)' }
}

let child: ChildProcess | null = null
let runningPort = 0
let lastError: string | undefined

function gatewayEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // openclaw 以 $HOME/.openclaw 作为状态根；这里显式指定，避免依赖 HOME 语义
    HOME: paths.openclawConfigDir(),
    USERPROFILE: paths.openclawConfigDir(),
    OPENCLAW_STATE_DIR: paths.openclawStateDir(),
    OPENCLAW_CONFIG_PATH: paths.openclawConfigFile(),
    ECCLAW_DESKTOP: '1',
    // Electron 进程里的 process.execPath 是 electron.exe；不加这个变量它会以
    // "Electron 应用" 模式启动 openclaw.mjs，gateway 会在 bootstrap 之后卡住不监听端口
    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {})
  }
}

export function gatewayStatus(): GatewayStatus {
  const runtime = resolveOpenclaw()
  return {
    running: Boolean(child && child.exitCode === null),
    pid: child?.pid,
    port: runningPort || undefined,
    baseUrl: runningPort ? `http://127.0.0.1:${runningPort}` : undefined,
    binary: runtime?.label,
    error: lastError
  }
}

export async function startGateway(port = 0): Promise<GatewayStatus> {
  const runtime = resolveOpenclaw()
  if (!runtime) {
    lastError = '未找到 openclaw 内核（请设置 ECCLAW_OPENCLAW_BIN 或安装 openclaw 依赖）'
    return gatewayStatus()
  }
  if (child && child.exitCode === null) return gatewayStatus()

  const chosen = port || 43117
  runningPort = chosen
  lastError = undefined
  try {
    child = spawn(runtime.command, [...runtime.args, 'gateway', '--port', String(chosen)], {
      env: gatewayEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
  } catch (err) {
    lastError = (err as Error).message
    child = null
    return gatewayStatus()
  }
  child.stdout?.on('data', (buf: Buffer) => {
    process.stdout.write(`[openclaw] ${buf.toString()}`)
  })
  child.stderr?.on('data', (buf: Buffer) => {
    process.stderr.write(`[openclaw] ${buf.toString()}`)
  })
  child.on('exit', (code) => {
    child = null
    runningPort = 0
    lastError = `openclaw 已退出（code=${code}）`
  })
  const healthy = await waitForHealth(chosen, 60000)
  if (!healthy) {
    lastError = `openclaw gateway 未在 60s 内监听端口 ${chosen}`
    child.kill()
    child = null
    runningPort = 0
  }
  return gatewayStatus()
}

export async function stopGateway(): Promise<GatewayStatus> {
  if (child) {
    child.kill()
    child = null
  }
  runningPort = 0
  return gatewayStatus()
}

export async function restartGateway(port = 0): Promise<GatewayStatus> {
  await stopGateway()
  return startGateway(port)
}

async function waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
  // gateway 是 WebSocket 服务，没有 HTTP 健康端点；这里做 TCP 端口探测
  const net = await import('node:net')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port })
      socket.setTimeout(1500)
      socket.on('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.on('error', () => resolve(false))
      socket.on('timeout', () => {
        socket.destroy()
        resolve(false)
      })
    })
    if (ok) return true
    await new Promise((r) => setTimeout(r, 600))
  }
  return false
}

/* ------------------------------- 对话适配层 ------------------------------- */

const history = new Map<string, ChatMessage[]>()

export function chatHistory(sessionId = 'default'): ChatMessage[] {
  return history.get(sessionId) ?? []
}

/**
 * 发送一句话给 openclaw。
 * 走官方 CLI 的 agent 单轮接口：`openclaw agent --local --json --message <text>`。
 * --local 走内嵌 agent（用已配置的 provider 凭据），不依赖 gateway 进程；
 * gateway 未启动时会自动回落到带 gateway 的调用。
 */
export async function chatSend(text: string, sessionId = 'default'): Promise<ChatMessage> {
  const userMsg: ChatMessage = { role: 'user', content: text, ts: Date.now(), sessionId }
  const list = history.get(sessionId) ?? []
  list.push(userMsg)
  history.set(sessionId, list)

  const reply = await chatViaCli(text, sessionId)
  list.push(reply)
  return reply
}

/**
 * 从 openclaw agent --json 的输出里提取回复文本。
 * 真实信封（2026-11-02 实测）：
 *   { "payloads": [{ "text": "Test passed", "mediaUrl": null }], "meta": { … } }
 * meta 里还有 terminalReply.text / finalAssistantVisibleText 作为兜底。
 */
function extractReply(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    /* 非 JSON 输出，按纯文本处理 */
    return trimmed
  }
  const payloadText = collectText(parsed.payloads)
  if (payloadText) return payloadText
  for (const key of ['reply', 'content', 'text', 'message', 'output', 'result']) {
    const text = collectText(parsed[key])
    if (text) return text
  }
  const meta = parsed.meta
  if (meta && typeof meta === 'object') {
    const metaObj = meta as Record<string, unknown>
    const terminal = collectText(metaObj.terminalReply)
    if (terminal) return terminal
    const visible =
      typeof metaObj.finalAssistantVisibleText === 'string'
        ? metaObj.finalAssistantVisibleText.trim()
        : ''
    if (visible) return visible
  }
  return trimmed
}

/** 递归取第一个像「回复正文」的字符串（text / content / reply / message / output / result） */
function collectText(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value.trim()
  if (depth > 4 || !value || typeof value !== 'object') return ''
  if (Array.isArray(value)) {
    return value
      .map((item) => collectText(item, depth + 1))
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  const obj = value as Record<string, unknown>
  for (const key of ['text', 'content', 'reply', 'message', 'output', 'result']) {
    const text = collectText(obj[key], depth + 1)
    if (text) return text
  }
  return ''
}

async function chatViaCli(text: string, sessionId: string): Promise<ChatMessage> {
  const runtime = resolveOpenclaw()
  if (!runtime) {
    return {
      role: 'assistant',
      content: '未找到 openclaw 内核，无法对话。请安装 openclaw 依赖或设置 ECCLAW_OPENCLAW_BIN。',
      ts: Date.now(),
      sessionId
    }
  }
  const baseArgs = [
    ...runtime.args,
    'agent',
    '--json',
    '--message',
    text,
    '--session-id',
    sessionId
  ]

  const attempt = async (args: string[]): Promise<{ out: string; err: string; code: number | null }> =>
    new Promise((resolve) => {
      const proc = spawn(runtime.command, args, {
        env: gatewayEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
      let out = ''
      let err = ''
      proc.stdout.on('data', (b: Buffer) => (out += b.toString()))
      proc.stderr.on('data', (b: Buffer) => (err += b.toString()))
      proc.on('exit', (code) => resolve({ out, err, code }))
      proc.on('error', (e) => resolve({ out, err: err + e.message, code: null }))
    })

  const local = await attempt([...baseArgs, '--local'])
  const first = local.code === 0 ? local : await attempt(baseArgs)
  const content = extractReply(first.out) || first.err.trim() || '(无输出)'
  return { role: 'assistant', content, ts: Date.now(), sessionId }
}
