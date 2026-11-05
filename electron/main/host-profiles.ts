import fs from 'node:fs'
import path from 'node:path'
import { paths } from './paths'
import type { HostProfile, HostProfileState } from '../shared/types'

/**
 * 店铺登录态 profile（第十五阶段 · phase3p）
 *
 * 问题：第十阶段起宿主只有一个持久化 partition（`persist:ecclaw-host`）。
 * 电商场景常常同时登好几个店 —— 同一个 partition 里登第二个店，
 * 第一个店的登录态会被顶掉（至少同域名的账号会串味）。
 *
 * 解法：一个 profile = 一个 partition。切 profile = 换 partition + 重建宿主 view。
 * 默认 profile 沿用第十阶段的 `persist:ecclaw-host`，**分区名一个字符都不改**，
 * 所以升级后原有的登录态（淘宝已验证过）不会丢。
 *
 * 红线：
 * - 移除 profile **只删配置记录**，**绝不删** `<userData>/Partitions/` 下的登录数据
 *   （登录数据是用户文件，删除权只在用户手上）；
 * - partition 名只允许程序自己生成的两种形态（见 PARTITION_RE），不接受外部任意字符串。
 */

export const DEFAULT_PROFILE_ID = 'default'
export const DEFAULT_PROFILE_NAME = '默认店铺'
/** 第十阶段的分区名，一个字符都不改 —— 保住已有登录态 */
export const DEFAULT_PROFILE_PARTITION = 'persist:ecclaw-host'

/** 非默认 profile 的分区名形态（严格白名单，防注入任意 partition） */
const PROFILE_PARTITION_RE = /^persist:ecclaw-profile-[a-z0-9-]{1,64}$/
/** 允许出现在 partition 名里的字符 */
const PARTITION_NAME_RE = /^[a-z0-9-]{1,64}$/

const profileFile = (): string => path.join(paths.openclawStateDir(), 'host-profiles.json')

interface ProfileStore {
  version: 1
  profiles: HostProfile[]
  activeId: string
}

function defaultStore(): ProfileStore {
  return {
    version: 1,
    profiles: [
      {
        id: DEFAULT_PROFILE_ID,
        name: DEFAULT_PROFILE_NAME,
        partition: DEFAULT_PROFILE_PARTITION,
        createdAt: new Date().toISOString(),
        builtin: true
      }
    ],
    activeId: DEFAULT_PROFILE_ID
  }
}

let cache: ProfileStore | null = null

function isValidProfile(p: HostProfile): boolean {
  if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') return false
  if (p.id === DEFAULT_PROFILE_ID) return p.partition === DEFAULT_PROFILE_PARTITION
  if (!PROFILE_PARTITION_RE.test(p.partition)) return false
  const suffix = p.partition.slice('persist:ecclaw-profile-'.length)
  return suffix.length > 0 && PARTITION_NAME_RE.test(suffix)
}

function loadStore(): ProfileStore {
  if (cache) return cache
  let store = defaultStore()
  try {
    const raw = fs.readFileSync(profileFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<ProfileStore>
    const rawProfiles = Array.isArray(parsed.profiles) ? parsed.profiles : []
    const profiles: HostProfile[] = []
    for (const p of rawProfiles as HostProfile[]) {
      if (!isValidProfile(p)) continue
      if (profiles.some((x) => x.id === p.id)) continue
      profiles.push({
        id: p.id,
        name: p.name.slice(0, 40),
        partition: p.partition,
        createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
        builtin: p.id === DEFAULT_PROFILE_ID
      })
    }
    // 默认 profile 永远存在（分区名固定为第十阶段那个）
    if (!profiles.some((p) => p.id === DEFAULT_PROFILE_ID)) {
      profiles.unshift(defaultStore().profiles[0])
    }
    const activeId =
      typeof parsed.activeId === 'string' && profiles.some((p) => p.id === parsed.activeId)
        ? parsed.activeId
        : DEFAULT_PROFILE_ID
    store = { version: 1, profiles, activeId }
  } catch {
    /* 文件不存在 / 坏了 → 用默认 store（首次进入时再落盘） */
  }
  cache = store
  return store
}

function saveStore(store: ProfileStore): void {
  cache = store
  const file = profileFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

/** 列出全部 profile */
export function listHostProfiles(): HostProfile[] {
  return loadStore().profiles.map((p) => ({ ...p }))
}

/** 当前激活的 profile */
export function getActiveProfile(): HostProfile {
  const store = loadStore()
  const found = store.profiles.find((p) => p.id === store.activeId)
  return { ...(found ?? defaultStore().profiles[0]) }
}

/** 全部 profile + 当前激活 id */
export function getProfileState(): HostProfileState {
  const store = loadStore()
  return { profiles: store.profiles.map((p) => ({ ...p })), activeId: store.activeId }
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return s || 'shop'
}

/**
 * 新建一个 profile（= 一个新的空 partition）。
 * 只是登记一个空登录态容器，**不碰**任何已有 partition 的数据。
 */
export function createHostProfile(name: string): HostProfile {
  const store = loadStore()
  const clean = String(name ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 40)
  if (!clean) throw new Error('店铺名不能为空')
  const id = `p-${slugify(clean)}-${Date.now().toString(36)}`
  const profile: HostProfile = {
    id,
    name: clean,
    partition: `persist:ecclaw-profile-${id}`,
    createdAt: new Date().toISOString(),
    builtin: false
  }
  saveStore({
    ...store,
    profiles: [...store.profiles, profile]
  })
  return { ...profile }
}

/**
 * 移除一个 profile 的**配置记录**。
 *
 * 只删记录，**不删** `<userData>/Partitions/<name>/` 下的登录数据 ——
 * 那是用户文件，删除权只在用户手上（红线）。删掉的是当前 profile 时，
 * 激活项复位到默认 profile（调用方需要把宿主 partition 一并切回去）。
 */
export function removeHostProfile(id: string): boolean {
  const store = loadStore()
  const target = store.profiles.find((p) => p.id === id)
  if (!target) return false
  if (target.builtin || target.id === DEFAULT_PROFILE_ID) return false
  const profiles = store.profiles.filter((p) => p.id !== id)
  const activeId = store.activeId === id ? DEFAULT_PROFILE_ID : store.activeId
  saveStore({ ...store, profiles, activeId })
  return true
}

/** 切换激活的 profile（不存在的 id 抛错） */
export function setActiveProfile(id: string): HostProfile {
  const store = loadStore()
  const target = store.profiles.find((p) => p.id === id)
  if (!target) throw new Error(`未找到店铺 profile：${id}`)
  saveStore({ ...store, activeId: target.id })
  return { ...target }
}
