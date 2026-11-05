import fs from 'node:fs'
import path from 'node:path'
import { paths } from './paths'
import type { FileEntry, SkillInfo } from '../shared/types'

/**
 * 技能与文件库。
 * 技能目录语义与 openclaw 对齐：
 *   <state>/skills      托管技能（技能目录安装）
 *   <state>/user-skills 用户自建技能
 * 每个技能是一个包含 SKILL.md 的目录。
 */

function readSkillMeta(dir: string, origin: SkillInfo['origin']): SkillInfo | null {
  const skillFile = path.join(dir, 'SKILL.md')
  if (!fs.existsSync(skillFile)) return null
  let description = ''
  try {
    const head = fs.readFileSync(skillFile, 'utf8').slice(0, 2000)
    const m = head.match(/^---\n([\s\S]*?)\n---/)
    if (m) {
      const dm = m[1].match(/^description:\s*(.+)$/m)
      if (dm) description = dm[1].trim()
    }
  } catch {
    /* ignore */
  }
  return { name: path.basename(dir), description, path: dir, origin }
}

export function listSkills(): SkillInfo[] {
  const out: SkillInfo[] = []
  for (const [dir, origin] of [
    [paths.managedSkillsDir(), 'managed'],
    [paths.userSkillsDir(), 'user']
  ] as const) {
    if (!fs.existsSync(dir)) continue
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const info = readSkillMeta(path.join(dir, entry.name), origin)
      if (info) out.push(info)
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function readSkill(name: string): string | null {
  const skill = listSkills().find((s) => s.name === name)
  if (!skill) return null
  try {
    return fs.readFileSync(path.join(skill.path, 'SKILL.md'), 'utf8')
  } catch {
    return null
  }
}

export function saveSkill(name: string, content: string): SkillInfo[] {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '')
  if (!safe) throw new Error('技能名非法')
  const dir = path.join(paths.userSkillsDir(), safe)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf8')
  return listSkills()
}

export function deleteSkill(name: string): SkillInfo[] {
  const skill = listSkills().find((s) => s.name === name)
  if (!skill) return listSkills()
  if (skill.origin !== 'user') throw new Error('只允许删除用户自建技能')
  fs.rmSync(skill.path, { recursive: true, force: true })
  return listSkills()
}

/** 文件库：<state>/file-library/files 下的平铺文件 */
export function listFiles(): FileEntry[] {
  const dir = path.join(paths.fileLibraryDir(), 'files')
  if (!fs.existsSync(dir)) return []
  const out: FileEntry[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const stat = fs.statSync(path.join(dir, entry.name))
    out.push({
      name: entry.name,
      path: path.join(dir, entry.name),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString()
    })
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

export function readFile(filePath: string): string | null {
  const root = path.join(paths.fileLibraryDir(), 'files')
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(path.resolve(root))) throw new Error('路径越界')
  try {
    return fs.readFileSync(resolved, 'utf8')
  } catch {
    return null
  }
}
