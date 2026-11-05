import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { paths } from './paths'
import { readConfig, writeConfig } from './openclaw-config'
import { hostBridgeFile } from './host-bridge'

/**
 * 把 ecclaw 宿主注册成 openclaw 的 MCP 服务（stdio），让 agent 能真正执行平台包动作。
 *
 * 链路：openclaw agent → MCP(stdio) → ecclaw 主进程宿主桥 → 内嵌浏览器 / 平台包执行器。
 *
 * 两条约束（实测踩出来的）：
 * - openclaw 拉起 stdio MCP 服务时用 **exactEnv**（只给配置里的 env，不继承进程环境），
 *   所以这里必须把 ELECTRON_RUN_AS_NODE / PATH / SystemRoot 等显式写全。
 * - Electron 的 process.execPath 是 electron.exe；不加 ELECTRON_RUN_AS_NODE=1 会以
 *   「Electron 应用」模式启动，脚本根本不执行（老坑，和内核启动同源）。
 */

export const MCP_SERVER_NAME = 'ecclaw-host'

export interface McpBridgeStatus {
  registered: boolean
  serverName: string
  scriptPath: string
  bridgeFile: string
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 源脚本（随应用分发）→ 复制到状态目录（MCP 服务从状态目录启动） */
function sourceScriptPath(): string {
  return path.join(app.getAppPath(), 'resources', 'mcp', 'host-server.mjs')
}

export function mcpScriptPath(): string {
  return path.join(paths.openclawStateDir(), 'mcp', 'host-server.mjs')
}

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {
    ELECTRON_RUN_AS_NODE: '1',
    ECCLAW_HOST_BRIDGE_FILE: hostBridgeFile()
  }
  for (const key of ['PATH', 'SystemRoot', 'SystemDrive', 'windir', 'TEMP', 'TMP', 'USERPROFILE', 'HOME']) {
    const value = process.env[key]
    if (value) env[key] = value
  }
  return env
}

/**
 * 把 MCP 服务写进 openclaw 配置（mcp.servers.ecclaw-host）。
 * 只动自己那一个键，用户其它配置原样保留。
 */
export function ensureMcpServer(): McpBridgeStatus {
  const scriptPath = mcpScriptPath()
  const bridgeFile = hostBridgeFile()
  const status: McpBridgeStatus = {
    registered: false,
    serverName: MCP_SERVER_NAME,
    scriptPath,
    bridgeFile
  }
  const src = sourceScriptPath()
  if (!fs.existsSync(src)) {
    status.error = `未找到 MCP 服务脚本：${src}`
    return status
  }
  try {
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true })
    fs.copyFileSync(src, scriptPath)

    const config = readConfig()
    const mcp = isRecord(config.mcp) ? { ...config.mcp } : {}
    const servers = isRecord(mcp.servers) ? { ...mcp.servers } : {}
    servers[MCP_SERVER_NAME] = {
      enabled: true,
      transport: 'stdio',
      command: process.execPath,
      args: [scriptPath],
      env: childEnv()
    }
    mcp.servers = servers
    writeConfig({ ...config, mcp })
    status.registered = true
  } catch (err) {
    status.error = (err as Error).message || String(err)
  }
  return status
}
