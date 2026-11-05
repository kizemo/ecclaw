import { app } from 'electron'
import path from 'node:path'

/**
 * ecclaw 路径约定 —— 对齐 dabi 的接缝设计：
 * openclaw 的状态根直接复用 openclaw 自己的目录语义（openclaw.json / skills / user-skills）。
 */
export const paths = {
  userData: () => app.getPath('userData'),

  /** openclaw 配置目录（openclaw 自身的 HOME 语义） */
  openclawConfigDir: () => path.join(app.getPath('userData'), 'openclaw'),
  /** openclaw 状态目录 */
  openclawStateDir: () => path.join(app.getPath('userData'), 'openclaw', '.openclaw'),
  /** openclaw 主配置文件 */
  openclawConfigFile: () => path.join(paths.openclawStateDir(), 'openclaw.json'),

  /** 内置技能（随包） */
  bundledSkillsDir: () => path.join(app.getAppPath(), 'resources', 'skills'),
  /** 托管技能（由技能目录安装；可用 ECCLAW_SKILLS_DIR 覆盖，便于开发期/验证脚手架重定向） */
  managedSkillsDir: () =>
    process.env.ECCLAW_SKILLS_DIR || path.join(paths.openclawStateDir(), 'skills'),
  /** 用户自建技能 */
  userSkillsDir: () => path.join(paths.openclawStateDir(), 'user-skills'),

  /** 内置平台包 */
  bundledPackagesDir: () =>
    process.env.ECCLAW_PACKAGES_DIR || path.join(app.getAppPath(), 'resources', 'platform-packages'),
  /** 用户本地平台包目录（可用 ECCLAW_LOCAL_PACKAGES_DIR 覆盖，便于验证与隔离） */
  localPackagesDir: () =>
    process.env.ECCLAW_LOCAL_PACKAGES_DIR ||
    path.join(app.getPath('userData'), 'platform-packages'),

  /** 聊天/工作区目录 */
  workspaceDir: () => path.join(paths.openclawStateDir(), 'workspace'),
  /** 文件库 */
  fileLibraryDir: () => path.join(paths.openclawStateDir(), 'file-library'),
  /** 日志 */
  logsDir: () => app.getPath('logs')
}
