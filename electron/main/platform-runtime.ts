import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { listPackages } from './platform-packages'
import type {
  PlatformPackageCapabilities,
  PlatformPackageInfo,
  PlatformPackagePageCapability,
  PlatformPackageTool
} from '../shared/types'

/**
 * 平台包运行时（runtime.cjs）能力探测。
 *
 * 实测结论（2026-11-01，见 docs/逆向分析补充-平台包协议实证-2026-11-01.md）：
 * dabi 的真实 runtime.cjs 是 **CommonJS 模块**，导出对象形如
 *   { manifest, pages: [{ id, match(), actions{capId}, automationActions{capId},
 *                         observations(): [{id,...}] }], canOpenSidePanel() }
 * 宿主用 `createRequire(runtimePath)` 加载，且在 require 之前必须注入
 * `globalThis[Symbol.for('com.dabiai.plugins.sdk')]`（包内 @dabi/plugins 会读它）。
 *
 * ecclaw 自带的示例包用的是另一种契约：{ manifest, tools[], execute() }。
 * 两种都在这里归一化成同一份能力目录。
 *
 * 安全：runtime.cjs 是第三方代码，一律在**独立子进程**里加载
 * （process.execPath + ELECTRON_RUN_AS_NODE=1 退化为纯 Node），
 * 崩溃或死循环不会带崩 Electron 主进程。
 */

/**
 * 子进程探测脚本：加载 runtime.cjs，吐出一份 JSON 能力目录。
 * argv[1] = runtime 绝对路径。
 */
const PROBE_SCRIPT = [
  "const { createRequire } = require('node:module')",
  "const runtimePath = process.argv[1]",
  "globalThis[Symbol.for('com.dabiai.plugins.sdk')] = {",
  "  version: 1, register() {}, unregister() {}, log() {}, on() {}, emit() {},",
  "  matchURL: () => false, logger: { info() {}, warn() {}, debug() {}, error() {} }",
  "}",
  "const out = { manifest: null, tools: [], pages: [], dataQueries: [], error: null }",
  "try {",
  "  const req = createRequire(runtimePath)",
  "  const loaded = req(runtimePath)",
  "  const isPkg = (v) =>",
  "    v && typeof v === 'object' && v.manifest &&",
  "    (Array.isArray(v.pages) || Array.isArray(v.tools))",
  "  const pkg = isPkg(loaded)",
  "    ? loaded",
  "    : loaded && isPkg(loaded.default)",
  "      ? loaded.default",
  "      : Object.values(loaded || {}).find(isPkg)",
  "  if (!pkg) throw new Error('runtime 未导出平台包对象')",
  "  out.manifest = pkg.manifest ?? null",
  "  if (Array.isArray(pkg.tools)) {",
  "    out.tools = pkg.tools",
  "      .filter((t) => t && typeof t.name === 'string')",
  "      .map((t) => ({",
  "        name: t.name,",
  "        label: typeof t.label === 'string' ? t.label : undefined,",
  "        description: typeof t.description === 'string' ? t.description : undefined,",
  "        parameters:",
  "          t.parameters && typeof t.parameters === 'object' ? t.parameters : undefined",
  "      }))",
  "  }",
  "  if (Array.isArray(pkg.pages)) {",
  "    out.pages = pkg.pages.map((p) => {",
  "      let obs = []",
  "      if (p && typeof p.observations === 'function') {",
  "        try {",
  "          // 真实包的 observations(context) 会读 context.url 判断是否适用；",
  "          // 探测阶段没有真实页面，给一个空壳 context 免得抛异常（抛了会误报探测失败）。",
  "          const stub = { url: '', title: '', tabId: 0, pageIdentity: '', resourceId: '', payload: null, event: null, observation: { id: '' } }",
  "          obs = (p.observations(stub) || []).map((o) => String((o && o.id) || ''))",
  "        } catch (e) {",
  "          // observations() 依赖宿主传入的页面上下文，脱离宿主调用会抛错；",
  "          // 此时只丢失观察器 id，不影响动作能力的抽取。",
  "          if (!out.error) out.error = 'observations() 调用失败：' + String((e && e.message) || e)",
  "        }",
  "      }",
  "      return {",
  "        id: String((p && p.id) || ''),",
  "        actions: p && p.actions ? Object.keys(p.actions) : [],",
  "        automationActions: p && p.automationActions ? Object.keys(p.automationActions) : [],",
  "        observations: obs",
  "      }",
  "    })",
  "  }",
  "  if (pkg.dataQueries && typeof pkg.dataQueries === 'object') {",
  "    out.dataQueries = Object.keys(pkg.dataQueries)",
  "  }",
  "} catch (e) {",
  "  out.error = String((e && e.message) || e)",
  "}",
  "process.stdout.write(JSON.stringify(out))"
].join('\n')

interface ProbeResult {
  manifest: unknown
  tools: PlatformPackageTool[]
  pages: PlatformPackagePageCapability[]
  dataQueries: string[]
  error: string | null
}

function runProbe(runtimePath: string, timeoutMs = 20000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', PROBE_SCRIPT, runtimePath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ manifest: null, tools: [], pages: [], dataQueries: [], error: `探测超时（${timeoutMs}ms）` })
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ manifest: null, tools: [], pages: [], dataQueries: [], error: err.message })
    })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const parsed = JSON.parse(stdout) as ProbeResult
        resolve({
          manifest: parsed.manifest,
          tools: parsed.tools ?? [],
          pages: parsed.pages ?? [],
          dataQueries: parsed.dataQueries ?? [],
          error: parsed.error ?? (stderr ? stderr.trim().slice(0, 500) : null)
        })
      } catch {
        resolve({
          manifest: null,
          tools: [],
          pages: [],
          dataQueries: [],
          error: stderr.trim().slice(0, 500) || '探测输出无法解析'
        })
      }
    })
  })
}

/** 包内的 runtime 文件绝对路径（manifest.runtime，默认 runtime.cjs） */
export function runtimeFile(pkg: PlatformPackageInfo): string | null {
  const name = pkg.manifest.runtime ?? 'runtime.cjs'
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return null
  const file = path.join(pkg.dir, name)
  return fs.existsSync(file) ? file : null
}

const cache = new Map<string, PlatformPackageCapabilities>()

/** 探测单个包的能力目录（结果按 包id@版本 缓存） */
export async function loadCapabilities(pkg: PlatformPackageInfo): Promise<PlatformPackageCapabilities> {
  const key = `${pkg.manifest.packageId}@${pkg.manifest.version}`
  const cached = cache.get(key)
  if (cached) return cached

  const file = runtimeFile(pkg)
  if (!file) {
    const empty: PlatformPackageCapabilities = {
      packageId: pkg.manifest.packageId,
      version: pkg.manifest.version,
      tools: [],
      pages: [],
      dataQueries: []
    }
    cache.set(key, empty)
    return empty
  }

  const probe = await runProbe(file)
  const result: PlatformPackageCapabilities = {
    packageId: pkg.manifest.packageId,
    version: pkg.manifest.version,
    tools: probe.tools,
    pages: probe.pages,
    dataQueries: probe.dataQueries,
    error: probe.error ?? undefined
  }
  cache.set(key, result)
  return result
}

/** 探测全部已安装包 */
export async function loadAllCapabilities(): Promise<PlatformPackageCapabilities[]> {
  return Promise.all(listPackages().map((pkg) => loadCapabilities(pkg)))
}

/** 能力总数（工具 + 页面动作 + 数据查询） */
export function capabilityCount(caps: PlatformPackageCapabilities): number {
  return (
    caps.tools.length +
    caps.dataQueries.length +
    caps.pages.reduce(
      (sum, page) => sum + new Set([...page.actions, ...page.automationActions]).size,
      0
    )
  )
}
