/**
 * Model-facing CodeTrail tools.
 *
 * Every tool is read-only with respect to the analyzed repository: results are
 * written under the CodeTrail data directory and returned as text. The model
 * never receives runtime proof, only static evidence, so the descriptions say
 * so explicitly.
 */
import { scan, review, query, memory, dataRoot } from './service.js'

const PANEL_HINT = 'The result is also listed in the CodeTrail panel (CodeTrail icon in the left sidebar).'

function asText(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return [{ type: 'text', text }]
}

function formatScan(result, kind) {
  const record = result.record
  const summary = record.summary || {}
  const lines = [
    `${kind === 'review' ? 'CodeTrail review' : 'CodeTrail scan'} completed`,
    `repository: ${record.repo}`,
    `functions: ${summary.functions ?? '?'}  edges: ${summary.edges ?? '?'}  files: ${summary.files ?? '?'}  diagnostics: ${summary.diagnostics ?? '?'}  unresolved_calls: ${summary.unresolved_calls ?? '?'}`,
  ]
  if (kind === 'review') {
    lines.push(`base: ${record.base}${record.head ? `  head: ${record.head}` : ''}`)
    lines.push(`changed_functions: ${summary.changed_functions ?? '?'}`)
  }
  lines.push(`graph_json: ${result.graphPath}`)
  lines.push(`html: ${result.htmlPath}`)
  if (result.reportPath) lines.push(`report: ${result.reportPath}`)
  lines.push(`scan_id: ${record.id}`)
  lines.push('', PANEL_HINT)
  return lines.join('\n')
}

function textArg(args, key, label) {
  const value = args && typeof args[key] === 'string' ? args[key].trim() : ''
  if (!value) throw new Error(`${label} is required`)
  return value
}

/**
 * Register the four CodeTrail tools on the calling Host context.
 * @param {any} ctx
 */
export function registerTools(ctx) {
  ctx.effect(() => ctx.tools.register({
    name: 'code_trail_scan',
    description:
      'Scan a local repository with CodeTrail\'s native Rust analyzer and build its static function call graph, entry paths and a standalone HTML workbench. Use this before describing architecture or caller/callee relationships. The result reports functions, edges, files, diagnostics and unresolved calls; a missing static edge does not prove runtime unreachability. Also accepts TypeScript/JavaScript/Svelte/Python/Go/C/C++ sources. Supports Windows x64 only in this bundle.',
    parameters: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Path of the repository or project directory to scan. Relative paths resolve against the Host process working directory.',
        },
      },
      required: ['repo'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => asText(value) },
    async execute(args, exec) {
      const result = await scan({ repo: textArg(args, 'repo', 'repo'), signal: exec?.signal })
      return formatScan(result, 'scan')
    },
  }), 'codetrail tool: scan')

  ctx.effect(() => ctx.tools.register({
    name: 'code_trail_query',
    description:
      'Query one CodeTrail static code graph (a *.graph.json produced by code_trail_scan or code_trail_review) and return JSON. Actions: "search" fuzzy symbol search (text, optional limit), "find" exact name lookup (text), "neighbors" direct callers/callees (id, optional limit/offset; paginate until complete_static_page), "modules" module-level dependency summary (module counts/files/functions, cross-module edges with call_sites, incoming/outgoing counts, instability, and strongly connected cycles; generous JSON, use a follow-up query for details), "path" shortest resolved static call path (id = start, target = end), "impact" reverse static reachability (id), "claims" capability claims from source comments (text). IDs must be exact ids or symbol_key values from a previous result; use the returned "complete_static_page" flag instead of assuming a page is complete. Static evidence only, not runtime proof.',
    parameters: {
      type: 'object',
      properties: {
        graph: { type: 'string', description: 'Absolute path of the CodeTrail graph JSON file.' },
        action: {
          type: 'string',
          enum: ['search', 'find', 'neighbors', 'modules', 'path', 'impact', 'claims'],
          description: 'Query operation to run.',
        },
        text: { type: 'string', description: 'Search/find/claims text. Required for search, find and claims.' },
        id: { type: 'string', description: 'Exact function id or symbol_key. Required for neighbors, path (start) and impact.' },
        target: { type: 'string', description: 'Exact target function id or symbol_key. Required for path.' },
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Page size for search or neighbors.' },
        offset: { type: 'integer', minimum: 0, description: 'Page offset for neighbors.' },
      },
      required: ['graph', 'action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => asText(value) },
    async execute(args, exec) {
      const result = await query({
        graph: textArg(args, 'graph', 'graph'),
        action: textArg(args, 'action', 'action'),
        text: args.text,
        id: args.id,
        target: args.target,
        limit: args.limit,
        offset: args.offset,
        signal: exec?.signal,
      })
      return JSON.stringify({ action: result.action, result: result.result }, null, 2)
    },
  }), 'codetrail tool: query')

  ctx.effect(() => ctx.tools.register({
    name: 'code_trail_review',
    description:
      'Review Git changes in a local repository with CodeTrail: compares a base revision (default HEAD) with the working tree or a target commit, and reports changed, added and deleted functions, changed call edges and non-function files, plus an HTML review workbench. Use for change-impact questions and review checklists. Changed imports, configuration and top-level effects are only partially visible, so pair function review with the non-function file queue. Requires a Git repository.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Path of the Git repository to review.' },
        base: { type: 'string', description: 'Git base revision (branch, tag or commit). Defaults to HEAD.' },
        head: { type: 'string', description: 'Optional target commit to compare against the base instead of the working tree.' },
        claims: { type: 'string', description: 'Optional path to a plain-text file with an Agent\'s claims, to compare explicit mentions with computed upstream reach.' },
      },
      required: ['repo'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => asText(value) },
    async execute(args, exec) {
      const result = await review({
        repo: textArg(args, 'repo', 'repo'),
        base: args.base,
        head: args.head,
        claims: args.claims,
        signal: exec?.signal,
      })
      return formatScan(result, 'review')
    },
  }), 'codetrail tool: review')

  ctx.effect(() => ctx.tools.register({
    name: 'code_trail_memory',
    description:
      'Read CodeTrail\'s user-confirmed bounded architecture memory for a graph (maximum 1500 cl100k_base tokens): "status" reports the store state, "context" exports the stable entries and confirmed review conclusions that load once per session, "query" searches on-demand records by topic. Only confirmed memory is returned; stale records are excluded. This tool never writes or confirms memory — saving a conclusion requires an explicit user confirmation through the CLI.',
    parameters: {
      type: 'object',
      properties: {
        graph: { type: 'string', description: 'Absolute path of the CodeTrail graph JSON file.' },
        store: { type: 'string', description: 'Memory store directory path (the same directory used when saving memory).' },
        action: { type: 'string', enum: ['status', 'context', 'query'], description: 'Memory read operation.' },
        topic: { type: 'string', description: 'Search topic. Required for the query action.' },
      },
      required: ['graph', 'store', 'action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => asText(value) },
    async execute(args, exec) {
      const result = await memory({
        graph: textArg(args, 'graph', 'graph'),
        store: textArg(args, 'store', 'store'),
        action: textArg(args, 'action', 'action'),
        topic: args.topic,
        signal: exec?.signal,
      })
      return result.output
    },
  }), 'codetrail tool: memory')

  ctx.logger?.debug?.(`CodeTrail tools registered; data directory ${dataRoot()}`)
}
