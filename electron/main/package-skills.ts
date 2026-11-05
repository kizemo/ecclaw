import fs from 'node:fs'
import path from 'node:path'
import { paths } from './paths'
import { listPackages } from './platform-packages'
import { capabilityCount, loadCapabilities } from './platform-runtime'
import type {
  PlatformPackageCapabilities,
  PlatformPackageInfo,
  PlatformPackageSkillSyncResult
} from '../shared/types'

/**
 * 把平台包的能力目录（platform-runtime 探测所得）写成 openclaw **托管技能**：
 *   <stateDir>/skills/<packageId>/SKILL.md
 *
 * 目的（第三阶段必做 1，路线 A）：643 项能力此前只是「给人看的清单」，
 * 模型看不到。openclaw 的技能系统会扫描托管技能目录，写在这里即让 agent
 * 「知道有哪些能力、该在什么站点/页面用哪个能力 id」。
 *
 * 边界（沿用第二阶段结论，勿越界）：
 * - 技能文本负责**能力目录知识 + 调用指引**；真正的执行入口是宿主 MCP 服务
 *   （见 electron/main/mcp-bridge.ts），动作执行依赖内嵌浏览器宿主（webContents/tabId）。
 * - 真实 dabi 包不随包分发 docs/*.md（2026-11-01 实测安装目录下 0 个 .md），
 *   所以「适用场景」以 manifest 页面元数据（path/type/docs 指针）+ 能力 id 呈现；
 *   若包内确实带 docs/（ecclaw 自制包），整目录拷进技能目录供 agent 渐进阅读。
 * - 平台包协议、探测逻辑均不动，纯下游消费。
 */

/** 技能目录名 = 包 id 净化（对齐 library.saveSkill 的字符集，多一档 '-' 兜底） */
function safeSkillName(packageId: string): string {
  const safe = packageId.replace(/[^a-zA-Z0-9_-]/g, '-')
  if (!safe) throw new Error(`包 id 无法转成技能名：${JSON.stringify(packageId)}`)
  return safe
}

function renderSkillMarkdown(
  pkg: PlatformPackageInfo,
  caps: PlatformPackageCapabilities
): string {
  const m = pkg.manifest
  const matches = [...new Set([...(pkg.registry?.match ?? []), ...(m.match ?? [])])]
  const priority = pkg.registry?.matchPriority ?? m.matchPriority
  const total = capabilityCount(caps)
  const lines: string[] = []

  lines.push('---')
  lines.push(`name: ${safeSkillName(m.packageId)}`)
  lines.push(
    `description: ${m.displayName}（${m.packageId}）平台技能包 ${m.version} 版能力目录 —— ` +
      `站点匹配 ${matches.join('、') || (m.sites ?? []).join('、') || '未声明'}；` +
      `共 ${total} 项能力（页面动作 ${caps.pages.reduce(
        (n, p) => n + new Set([...p.actions, ...p.automationActions]).size,
        0
      )} · 数据查询 ${caps.dataQueries.length} · 工具 ${caps.tools.length}）`
  )
  lines.push('---')
  lines.push('')
  lines.push(`# ${m.displayName}（${m.packageId}）`)
  lines.push('')
  lines.push(
    `> 本技能由 ecclaw 依据已安装平台包 \`${m.packageId}@${m.version}\` 的 runtime 能力探测自动生成，` +
      `请勿手工编辑；包升级后在「平台包 → 生成 Agent 技能」重新生成。`
  )
  if (m.description) {
    lines.push('')
    lines.push(m.description)
  }

  lines.push('')
  lines.push('## 使用边界（先读）')
  lines.push('')
  lines.push(
    '- 下列能力 id 是 runtime 探测出的**能力声明**；执行动作需要平台包宿主（内嵌浏览器，携带 webContents/tabId）。'
  )
  lines.push(
    '- ecclaw 的内嵌浏览器宿主**已接入对话链路，可以真正执行动作**。通过 MCP 工具调用' +
      '（openclaw 会把工具名加上服务器前缀，实际形如 `ecclaw-host__ecclaw_run_action`）：' +
      '`ecclaw_list_capabilities` / `ecclaw_open_page` / `ecclaw_read_dom` / ' +
      '`ecclaw_run_action` / `ecclaw_run_data_query` / `ecclaw_run_extract` / ' +
      '`ecclaw_run_observe` / `ecclaw_host_status`。'
  )
  lines.push(
    '- 调用顺序：先 `ecclaw_list_capabilities` 确认包 id 与能力 id → 需要时 `ecclaw_open_page` ' +
      '（或给执行类工具直接传 url）→ 执行。返回体是结构化 JSON，直接据此回答用户。'
  )

  lines.push('')
  lines.push('## 站点匹配')
  lines.push('')
  lines.push(`- 匹配模式：${matches.join('、') || '未声明（退化用站点标识）'}`)
  if (priority != null) lines.push(`- 匹配优先级：${priority}`)
  if (m.sites?.length) lines.push(`- 站点标识：${m.sites.join('、')}`)
  if (m.platform) lines.push(`- 平台族：${m.platform}`)

  // manifest 页面元数据（path/type/docs）与 runtime 探测页面按 id 关联
  const manifestPageById = new Map((m.pages ?? []).map((p) => [p.id, p]))
  const runtimePageIds = new Set(caps.pages.map((p) => p.id))

  lines.push('')
  lines.push('## 页面与动作能力')
  lines.push('')
  if (caps.pages.length === 0) {
    lines.push('（runtime 未探测到带动作的页面）')
  }
  for (const page of caps.pages) {
    const meta = manifestPageById.get(page.id)
    const head = meta ? `### ${page.id}（${meta.path}${meta.type ? ` · ${meta.type}` : ''}）` : `### ${page.id}`
    lines.push(head)
    const uniq = [...new Set([...page.actions, ...page.automationActions])]
    if (uniq.length) {
      lines.push(`- 动作能力（${uniq.length}）：`)
      for (const a of uniq) lines.push(`  - \`${a}\``)
    } else {
      lines.push('- 动作能力：无')
    }
    if (page.automationActions.length && page.automationActions.length < uniq.length) {
      lines.push(`- 其中自动化准备阶段：${page.automationActions.map((a) => `\`${a}\``).join('、')}`)
    }
    if (page.observations.length) {
      lines.push(`- 页面观察器：${page.observations.map((o) => `\`${o}\``).join('、')}`)
    }
    if (meta?.docs) {
      lines.push(`- 站点知识文档指针：\`${meta.docs}\`${pkg.docs.includes(meta.docs) ? '（已随包分发，见本技能 docs/）' : '（安装包内未随附该文档）'}`)
    }
    lines.push('')
  }

  const manifestOnly = (m.pages ?? []).filter((p) => !runtimePageIds.has(p.id))
  if (manifestOnly.length) {
    lines.push('### 仅 manifest 声明、runtime 未探测到动作的页面')
    for (const p of manifestOnly) {
      lines.push(`- ${p.id}（${p.path}${p.type ? ` · ${p.type}` : ''}）${p.docs ? ` 文档 \`${p.docs}\`` : ''}`)
    }
    lines.push('')
  }

  if (caps.dataQueries.length) {
    lines.push('## 数据查询能力（dataQueries）')
    lines.push('')
    for (const q of caps.dataQueries) lines.push(`- \`${q}\``)
    lines.push('')
  }

  if (caps.tools.length) {
    lines.push('## 工具（ecclaw 契约 tools[]）')
    lines.push('')
    for (const t of caps.tools) {
      const desc = t.description ? ` —— ${t.description}` : ''
      const params = t.parameters?.['properties']
        ? Object.keys(t.parameters['properties'] as Record<string, unknown>).join('、')
        : ''
      lines.push(`- \`${t.name}\`${t.label ? `（${t.label}）` : ''}${desc}${params ? `；参数：${params}` : ''}`)
    }
    lines.push('')
  }

  if (pkg.docs.length) {
    lines.push('## 随包站点知识文档（已拷入本技能 docs/）')
    lines.push('')
    for (const d of pkg.docs) lines.push(`- \`docs/${d}\``)
    lines.push('')
  }

  if (caps.error) {
    lines.push('## 探测提示')
    lines.push('')
    lines.push(`- ${caps.error}`)
    lines.push('')
  }

  return lines.join('\n')
}

/** 全量同步：每个已安装平台包 → <stateDir>/skills/<packageId>/SKILL.md */
export async function syncPackageSkills(): Promise<PlatformPackageSkillSyncResult[]> {
  const results: PlatformPackageSkillSyncResult[] = []
  for (const pkg of listPackages()) {
    const packageId = pkg.manifest.packageId
    try {
      const caps = await loadCapabilities(pkg)
      const skillDir = path.join(paths.managedSkillsDir(), safeSkillName(packageId))
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), renderSkillMarkdown(pkg, caps), 'utf8')
      // 包内若带站点知识文档（ecclaw 自制包），整目录拷入技能目录，agent 可渐进阅读
      const srcDocs = path.join(pkg.dir, 'docs')
      if (fs.existsSync(srcDocs)) {
        fs.cpSync(srcDocs, path.join(skillDir, 'docs'), { recursive: true })
      }
      results.push({ packageId, skillPath: skillDir, capabilityCount: capabilityCount(caps) })
    } catch (e) {
      results.push({
        packageId,
        skillPath: '',
        capabilityCount: 0,
        error: e instanceof Error ? e.message : String(e)
      })
    }
  }
  return results
}
