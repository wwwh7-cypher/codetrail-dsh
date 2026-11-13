/**
 * AI memory Markdown rendering shared by the DSH plugin.
 *
 * Mirrors the VS Code extension format: one stable marker per function and
 * snapshot content hash, so later analyses replace the earlier note in place.
 */
export const AI_MEMORY_HEADER = `# CodeTrail AI 解析记忆

> 本文件由 CodeTrail 在当前 Agent 分析并写入标注后自动追加，保存 AI 对函数的职责叙述。
> 这些内容是**未确认的 AI 叙述**，不是已确认的稳定架构记忆，也不会改变调用关系。
> 可通过 code_trail_ai_memory 工具读取；VS Code 版本使用客户自备 API Key 并把同类记录写到工作区 .codetrail/ai-memory.md。
`

const MARKER_PREFIX = '<!-- code-trail-ai:'

function oneLine(value, max) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/<!--\s*code-trail-ai:/gi, '&lt;!-- code-trail-ai:')
    .trim()
    .slice(0, max)
}

function snapshotLabel(entry) {
  return `${oneLine(entry.snapshot, 16) || 'unknown'} · ${oneLine(entry.project, 120) || '本地项目'}`
}

export function renderAiMemoryEntry(entry) {
  const title = oneLine(entry.title, 60) || oneLine(entry.name, 60) || '未命名函数'
  const name = oneLine(entry.name, 120)
  const file = oneLine(entry.file, 400)
  const summary = oneLine(entry.summary, 400) || '（模型未给出可确认的职责描述）'
  const contentHash = oneLine(entry.contentHash, 128).replace(/[^A-Za-z0-9_.-]/g, '')
  return [
    `${MARKER_PREFIX}${oneLine(entry.id, 500)}:${contentHash} -->`,
    `### ${title}`,
    '',
    `- 函数：\`${name}\`（\`${file}:${entry.line}\`）`,
    `- 稳定 ID：\`${oneLine(entry.id, 500)}\``,
    `- 快照：\`${snapshotLabel(entry)} · ${contentHash.slice(0, 32)}\``,
    `- 来源：${oneLine(entry.source, 120) || '当前对话模型'}（当前 Agent）`,
    `- 时间：${oneLine(entry.timestamp, 40)}`,
    '',
    summary,
    '',
  ].join('\n')
}

export function upsertAiMemory(text, entries) {
  let document = String(text || '').replace(/\r\n?/g, '\n').trim()
  if (!document) document = AI_MEMORY_HEADER.trim()
  if (!document.startsWith('# CodeTrail AI 解析记忆')) {
    document = `${AI_MEMORY_HEADER.trim()}\n\n${document}`
  }
  let lines = document.split('\n')
  for (const entry of entries) {
    const block = renderAiMemoryEntry(entry).trim().split('\n')
    const prefix = `${MARKER_PREFIX}${oneLine(entry.id, 500)}:`
    const start = lines.findIndex(line => line.startsWith(prefix))
    if (start >= 0) {
      let end = start + 1
      while (end < lines.length) {
        const line = lines[end]
        if (line.startsWith(MARKER_PREFIX) || line.startsWith('# ') || line.startsWith('## ')) break
        end += 1
      }
      while (end > start + 1 && lines[end - 1].trim() === '') end -= 1
      lines = [...lines.slice(0, start), ...block, ...lines.slice(end)]
    } else {
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
      lines = [...lines, '', ...block]
    }
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}
