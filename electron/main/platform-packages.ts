import fs from 'node:fs'
import path from 'node:path'
import { paths } from './paths'
import type {
  PlatformPackageInfo,
  PlatformPackageManifest,
  PlatformPackageRegistryEntry
} from '../shared/types'

/**
 * 平台技能包（platform-package）注册表。
 *
 * 协议对齐 dabi 的 platform-packages：
 *   <root>/index.json                            —— 注册表（match[] / matchPriority 在这里）
 *   <root>/<packageId>/manifest.json            —— 直接布局
 *   <root>/<packageId>/current.json            —— 版本化布局（指向 <version-dir>）
 *   <root>/<packageId>/<version-dir>/manifest.json
 *
 * manifest 字段：packageId / displayName / version / platform / sites /
 *                pages[] / minClientVersion / runtime
 * 注册表字段：match[] / matchPriority / channel / packageUrl / installStatus
 * 包内 docs/ 存放站点知识文档（供 agent 阅读的站点操作说明）。
 *
 * 实测（2026-11-01，见 docs/逆向分析补充-平台包协议实证-2026-11-01.md）：
 * 真实 dabi 的 manifest.json **不含** match / matchPriority，二者在根目录 index.json 的
 * packages[] 里。ecclaw 因此以注册表为匹配规则的权威来源，manifest.match 仅作自有扩展兼容。
 */

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

function listDocs(pkgDir: string): string[] {
  const docsDir = path.join(pkgDir, 'docs')
  if (!fs.existsSync(docsDir)) return []
  const out: string[] = []
  const walk = (dir: string, rel: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name)
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(child, childRel)
      else if (entry.name.endsWith('.md')) out.push(childRel)
    }
  }
  walk(docsDir, '')
  return out.sort()
}

function resolvePackageDir(root: string, id: string): string | null {
  const base = path.join(root, id)
  if (!fs.existsSync(base)) return null
  const current = readJson<{ dir?: string }>(path.join(base, 'current.json'))
  if (current?.dir) {
    const versioned = path.join(base, current.dir)
    if (fs.existsSync(path.join(versioned, 'manifest.json'))) return versioned
  }
  if (fs.existsSync(path.join(base, 'manifest.json'))) return base
  // 退化：取版本号字典序最大的子目录
  const versions = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse()
  for (const v of versions) {
    if (fs.existsSync(path.join(base, v, 'manifest.json'))) return path.join(base, v)
  }
  return null
}

/** 读取根目录注册表 index.json（dabi 真实形态：match[] / matchPriority 在这里） */
function readRegistry(root: string): Map<string, PlatformPackageRegistryEntry> {
  const map = new Map<string, PlatformPackageRegistryEntry>()
  const registry = readJson<{ packages?: PlatformPackageRegistryEntry[] }>(path.join(root, 'index.json'))
  for (const entry of registry?.packages ?? []) {
    if (entry?.packageId) map.set(entry.packageId, entry)
  }
  return map
}

function scanRoot(root: string, origin: PlatformPackageInfo['origin']): PlatformPackageInfo[] {
  const out: PlatformPackageInfo[] = []
  if (!fs.existsSync(root)) return out
  const registry = readRegistry(root)
  for (const id of fs.readdirSync(root)) {
    if (id === 'index.json' || id === 'index.json.prev' || id === 'retry-state.json') continue
    const dir = resolvePackageDir(root, id)
    if (!dir) continue
    const manifest = readJson<PlatformPackageManifest>(path.join(dir, 'manifest.json'))
    if (!manifest?.packageId) continue
    const packageId = manifest.packageId || id
    const entry = registry.get(packageId)
    // 注册表是匹配规则的权威来源；manifest.match 仅作 ecclaw 自有扩展的兼容回退
    const merged: PlatformPackageManifest = { ...manifest, packageId }
    const patterns = [...(entry?.match ?? []), ...(manifest.match ?? [])]
    if (patterns.length) merged.match = [...new Set(patterns)]
    if (typeof entry?.matchPriority === 'number') merged.matchPriority = entry.matchPriority
    out.push({
      manifest: merged,
      dir,
      origin,
      docs: listDocs(dir),
      registry: entry
    })
  }
  return out
}

/** 列出全部平台包：内置优先，用户本地覆盖同 id */
export function listPackages(): PlatformPackageInfo[] {
  const bundled = scanRoot(paths.bundledPackagesDir(), 'bundled')
  const local = scanRoot(paths.localPackagesDir(), 'local')
  const map = new Map<string, PlatformPackageInfo>()
  for (const pkg of bundled) map.set(pkg.manifest.packageId, pkg)
  for (const pkg of local) map.set(pkg.manifest.packageId, pkg)
  return [...map.values()].sort((a, b) => a.manifest.packageId.localeCompare(b.manifest.packageId))
}

/** 按站点域名匹配包（对齐 dabi 的 match / matchPriority 语义） */
export function matchPackages(hostname: string): PlatformPackageInfo[] {
  const hits = listPackages().filter((pkg) => {
    const patterns = pkg.manifest.match ?? pkg.manifest.sites ?? []
    return patterns.some((p) => {
      if (p === hostname) return true
      if (p.startsWith('*.')) return hostname.endsWith(p.slice(1))
      return false
    })
  })
  return hits.sort((a, b) => (b.manifest.matchPriority ?? 0) - (a.manifest.matchPriority ?? 0))
}

/** 读取包内文档正文 */
export function readPackageDoc(pkgId: string, docRel: string): string | null {
  const pkg = listPackages().find((p) => p.manifest.packageId === pkgId)
  if (!pkg) return null
  const safe = path.normalize(docRel).replace(/^([/\\]|\.\.)+/, '')
  const file = path.join(pkg.dir, 'docs', safe)
  if (!file.startsWith(path.join(pkg.dir, 'docs'))) return null
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}
