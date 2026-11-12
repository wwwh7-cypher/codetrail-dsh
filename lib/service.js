/**
 * CodeTrail host service: runs the bundled Rust CLI, keeps a bounded scan index,
 * and serves generated workbench HTML to the DSH web page.
 *
 * Everything here is local and static: no network, no model calls, no writes
 * outside the CodeTrail data directory.
 */
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_EXE = path.resolve(SELF_DIR, '..', 'bin', 'code-trail.exe')
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const SCAN_TIMEOUT_MS = 300_000
const QUERY_TIMEOUT_MS = 120_000
const MEMORY_TIMEOUT_MS = 60_000
const INDEX_LIMIT = 40

let writeChain = Promise.resolve()

function serialized(task) {
  const next = writeChain.then(task, task)
  writeChain = next.catch(() => {})
  return next
}

export function executablePath() {
  return process.env.CODETRAIL_BIN || DEFAULT_EXE
}

export function dataRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'codetrail')
}

function scansRoot() {
  return path.join(dataRoot(), 'scans')
}

function indexFile() {
  return path.join(dataRoot(), 'index.json')
}

function newId(kind) {
  return `${kind}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

function trimText(value, limit = 4000) {
  const text = String(value == null ? '' : value).trim()
  return text.length > limit ? `${text.slice(0, limit)}\n… (truncated)` : text
}

function parseJson(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

/**
 * Spawn the bundled CLI and resolve with its captured output.
 * @param {string[]} args
 * @param {{ signal?: AbortSignal, timeoutMs?: number, cwd?: string }} options
 */
export function runCli(args, options = {}) {
  const exe = executablePath()
  const timeoutMs = options.timeoutMs || SCAN_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(exe, args, {
        cwd: options.cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(new Error(`Cannot start CodeTrail binary at ${exe}: ${error.message}`))
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    const signal = options.signal

    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(value)
    }

    const stop = reason => {
      try {
        child.kill()
      } catch {
        /* the process already exited */
      }
      finish(reason)
    }

    const timer = setTimeout(() => {
      finish(new Error(`CodeTrail timed out after ${timeoutMs} ms`))
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }, timeoutMs)

    const onAbort = () => stop(Object.assign(new Error('CodeTrail call aborted'), { name: 'AbortError' }))
    if (signal) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8')
      if (stdout.length + stderr.length > MAX_OUTPUT_BYTES) stop(new Error('CodeTrail output exceeded the size cap'))
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
      if (stdout.length + stderr.length > MAX_OUTPUT_BYTES) stop(new Error('CodeTrail output exceeded the size cap'))
    })
    child.on('error', error => finish(new Error(`Cannot start CodeTrail binary at ${exe}: ${error.message}`)))
    child.on('close', code => finish(null, { code, stdout, stderr }))
  })
}

async function assertDirectory(target) {
  if (typeof target !== 'string' || !target.trim()) throw new Error('A repository path is required')
  const resolved = path.resolve(target.trim())
  let stat
  try {
    stat = await fs.stat(resolved)
  } catch {
    throw new Error(`Path not found: ${resolved}`)
  }
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${resolved}`)
  return resolved
}

async function assertFile(target, label) {
  if (typeof target !== 'string' || !target.trim()) throw new Error(`${label} is required`)
  const resolved = path.resolve(target.trim())
  let stat
  try {
    stat = await fs.stat(resolved)
  } catch {
    throw new Error(`${label} not found: ${resolved}`)
  }
  if (!stat.isFile()) throw new Error(`${label} is not a file: ${resolved}`)
  return resolved
}

function summarize(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const summary = {}
  for (const key of [
    'functions',
    'edges',
    'files',
    'diagnostics',
    'unresolved_calls',
    'analysis_ms',
    'changed_functions',
    'deleted_functions',
    'added_functions',
    'status',
    'snapshot',
  ]) {
    if (value[key] !== undefined && value[key] !== null) summary[key] = value[key]
  }
  return summary
}

async function readIndex() {
  try {
    const text = await fs.readFile(indexFile(), 'utf8')
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function addRecord(record) {
  return serialized(async () => {
    const records = await readIndex()
    const next = [record, ...records.filter(item => item.id !== record.id)].slice(0, INDEX_LIMIT)
    await fs.mkdir(dataRoot(), { recursive: true })
    const temp = `${indexFile()}.${process.pid}.tmp`
    await fs.writeFile(temp, JSON.stringify(next, null, 2), 'utf8')
    await fs.rename(temp, indexFile())
    return record
  })
}

export async function listScans() {
  const records = await readIndex()
  return records.map(record => ({
    id: record.id,
    type: record.type,
    repo: record.repo,
    repoName: record.repoName,
    createdAt: record.createdAt,
    summary: record.summary || {},
  }))
}

async function findRecord(id) {
  if (!/^[a-z0-9-]+$/.test(String(id || ''))) return null
  const records = await readIndex()
  return records.find(record => record.id === id) || null
}

/**
 * Scan a repository: build the static graph, HTML workbench and parse cache.
 * @param {{ repo: string, signal?: AbortSignal, register?: boolean }} options
 */
export async function scan(options) {
  const repo = await assertDirectory(options.repo)
  const id = newId('scan')
  const outDir = path.join(scansRoot(), id)
  await fs.mkdir(outDir, { recursive: true })
  const htmlPath = path.join(outDir, 'architecture.html')
  const graphPath = path.join(outDir, 'architecture.graph.json')
  const cachePath = path.join(outDir, 'parse-cache.json')

  let result
  try {
    result = await runCli(
      ['scan', repo, '--out', htmlPath, '--json', graphPath, '--cache', cachePath],
      { signal: options.signal, timeoutMs: SCAN_TIMEOUT_MS },
    )
  } catch (error) {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  if (result.code !== 0) {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {})
    throw new Error(`code-trail scan failed (exit ${result.code}): ${trimText(result.stderr || result.stdout, 2000)}`)
  }

  const raw = parseJson(result.stdout) || {}
  const record = {
    id,
    type: 'scan',
    repo,
    repoName: path.basename(repo),
    createdAt: new Date().toISOString(),
    summary: summarize(raw),
    html: `${id}/architecture.html`,
    graph: `${id}/architecture.graph.json`,
  }
  if (options.register !== false) await addRecord(record)
  return { record, raw, htmlPath, graphPath, cachePath }
}

/**
 * Review Git changes against a base revision and build the review workbench.
 * @param {{ repo: string, base?: string, head?: string, claims?: string, signal?: AbortSignal, register?: boolean }} options
 */
export async function review(options) {
  const repo = await assertDirectory(options.repo)
  const base = typeof options.base === 'string' && options.base.trim() ? options.base.trim() : 'HEAD'
  const head = typeof options.head === 'string' && options.head.trim() ? options.head.trim() : ''
  const claims = typeof options.claims === 'string' && options.claims.trim()
    ? await assertFile(options.claims, 'Claims file')
    : ''
  const id = newId('review')
  const outDir = path.join(scansRoot(), id)
  await fs.mkdir(outDir, { recursive: true })
  const htmlPath = path.join(outDir, 'review.html')
  const graphPath = path.join(outDir, 'review.graph.json')
  const reportPath = path.join(outDir, 'review.md')

  const args = ['review', repo, '--base', base]
  if (head) args.push('--head', head)
  if (claims) args.push('--claims', claims)
  args.push('--out', htmlPath, '--json', graphPath, '--report', reportPath)

  let result
  try {
    result = await runCli(args, { signal: options.signal, timeoutMs: SCAN_TIMEOUT_MS })
  } catch (error) {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  if (result.code !== 0) {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {})
    throw new Error(`code-trail review failed (exit ${result.code}): ${trimText(result.stderr || result.stdout, 2000)}`)
  }

  const raw = parseJson(result.stdout) || {}
  const record = {
    id,
    type: 'review',
    repo,
    repoName: path.basename(repo),
    createdAt: new Date().toISOString(),
    base,
    head: head || null,
    summary: summarize(raw),
    html: `${id}/review.html`,
    graph: `${id}/review.graph.json`,
    report: `${id}/review.md`,
  }
  if (options.register !== false) await addRecord(record)
  return { record, raw, htmlPath, graphPath, reportPath }
}

const QUERY_ACTIONS = new Set(['search', 'find', 'neighbors', 'modules', 'path', 'impact', 'claims'])

/**
 * Run one read-only graph query and return the parsed JSON result.
 * @param {{ graph: string, action: string, text?: string, id?: string, target?: string, limit?: number, offset?: number, signal?: AbortSignal }} options
 */
export async function query(options) {
  const graph = await assertFile(options.graph, 'Graph file')
  const action = String(options.action || '')
  if (!QUERY_ACTIONS.has(action)) throw new Error(`Unknown query action: ${action}`)
  const limit = Number.isInteger(options.limit) ? Math.min(Math.max(options.limit, 1), 500) : undefined
  const offset = Number.isInteger(options.offset) ? Math.max(options.offset, 0) : undefined

  const args = ['query', graph, action]
  switch (action) {
    case 'search':
    case 'find':
    case 'claims':
      if (!options.text || !String(options.text).trim()) throw new Error(`"text" is required for ${action}`)
      args.push(String(options.text).trim())
      if (action === 'search' && limit) args.push('--limit', String(limit))
      break
    case 'neighbors':
      if (!options.id || !String(options.id).trim()) throw new Error('"id" is required for neighbors')
      args.push(String(options.id).trim())
      if (limit) args.push('--limit', String(limit))
      if (offset) args.push('--offset', String(offset))
      break
    case 'path':
      if (!options.id || !options.target) throw new Error('"id" (start) and "target" are required for path')
      args.push(String(options.id).trim(), String(options.target).trim())
      break
    case 'impact':
      if (!options.id) throw new Error('"id" is required for impact')
      args.push(String(options.id).trim())
      break
    case 'modules':
      break
    default:
      break
  }

  const result = await runCli(args, { signal: options.signal, timeoutMs: QUERY_TIMEOUT_MS })
  if (result.code !== 0) {
    throw new Error(`code-trail query failed (exit ${result.code}): ${trimText(result.stderr || result.stdout, 2000)}`)
  }
  return { action, result: parseJson(result.stdout) || trimText(result.stdout, 20000) }
}

const MEMORY_ACTIONS = new Set(['status', 'context', 'query'])

/**
 * Read confirmed bounded memory. Write actions stay a user-confirmed CLI step.
 * @param {{ graph: string, store: string, action: string, topic?: string, signal?: AbortSignal }} options
 */
export async function memory(options) {
  const graph = await assertFile(options.graph, 'Graph file')
  if (typeof options.store !== 'string' || !options.store.trim()) throw new Error('"store" is required')
  const action = String(options.action || '')
  if (!MEMORY_ACTIONS.has(action)) throw new Error(`Unsupported memory action: ${action}. Use status, context or query.`)
  const args = ['memory', '--graph', graph, '--store', path.resolve(options.store), action]
  if (action === 'query') {
    if (!options.topic || !String(options.topic).trim()) throw new Error('"topic" is required for memory query')
    args.push(String(options.topic).trim())
  }
  const result = await runCli(args, { signal: options.signal, timeoutMs: MEMORY_TIMEOUT_MS })
  if (result.code !== 0) {
    throw new Error(`code-trail memory failed (exit ${result.code}): ${trimText(result.stderr || result.stdout, 2000)}`)
  }
  return { action, output: trimText(result.stdout || result.stderr, 20000) }
}

const THEME_BRIDGE = `<script>(function () {
  var match = /[?&]theme=(dark|light)/.exec(window.location.search)
  var initial = match ? match[1] : 'dark'
  function apply(theme) {
    if (!document.body) return
    document.body.classList.toggle('light', theme === 'light')
  }
  apply(initial)
  window.addEventListener('message', function (event) {
    var data = event && event.data
    if (data && data.type === 'codetrail-theme') apply(data.theme)
  })
})()</script>`

/**
 * Read a recorded workbench HTML file and inject the theme bridge.
 * @param {string} id
 * @param {'dark'|'light'} theme
 */
export async function view(id, theme) {
  const record = await findRecord(id)
  if (!record) return null
  const file = path.join(scansRoot(), String(record.html || ''))
  let html
  try {
    html = await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
  const bridge = THEME_BRIDGE.replace("'dark'", JSON.stringify(theme === 'light' ? 'light' : 'dark'))
  if (html.includes('</body>')) html = html.replace('</body>', `${bridge}</body>`)
  else html += bridge
  return { record, html }
}
