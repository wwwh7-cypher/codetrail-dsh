/**
 * HTTP bridge between the CodeTrail DSH panel and the host service.
 *
 * Routes under /codetrail/ are same-origin with the Harness page. The API
 * accepts only JSON requests carrying the panel's x-codetrail header, so a
 * cross-origin form post cannot trigger a scan.
 */
import { listScans, scan, review, view } from './service.js'

const ROUTE_PREFIX = '/codetrail'
const PREFIX = `${ROUTE_PREFIX}/`
const MAX_BODY_BYTES = 1024 * 1024

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

function sendHtml(res, html) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(html)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function hasPanelHeader(req) {
  return String(req.headers['x-codetrail'] || '') === '1'
}

/**
 * Register the CodeTrail prefix route.
 * @param {any} webServer the Host webServer service
 */
export function registerWebRoutes(webServer) {
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      const pathname = url.pathname

      if (req.method === 'GET' && pathname === `${PREFIX}api/health`) {
        sendJson(res, 200, { ok: true, service: 'codetrail-dsh', version: '0.1.0' })
        return
      }

      if (req.method === 'GET' && pathname === `${PREFIX}api/state`) {
        sendJson(res, 200, { ok: true, scans: await listScans() })
        return
      }

      if (req.method === 'POST' && pathname === `${PREFIX}api/scan`) {
        if (!hasPanelHeader(req)) {
          sendJson(res, 403, { ok: false, error: 'Missing panel header' })
          return
        }
        const raw = await readBody(req)
        let payload
        try {
          payload = JSON.parse(raw || '{}')
        } catch {
          sendJson(res, 400, { ok: false, error: 'Invalid JSON body' })
          return
        }
        const type = payload.type === 'review' ? 'review' : 'scan'
        try {
          const result = type === 'review'
            ? await review({ repo: payload.path, base: payload.base, head: payload.head })
            : await scan({ repo: payload.path })
          sendJson(res, 200, { ok: true, record: result.record, raw: result.raw })
        } catch (error) {
          sendJson(res, 422, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }

      if (req.method === 'GET' && pathname.startsWith(`${PREFIX}view/`)) {
        const id = pathname.slice(`${PREFIX}view/`.length)
        const theme = url.searchParams.get('theme') === 'light' ? 'light' : 'dark'
        const result = await view(decodeURIComponent(id), theme)
        if (!result) {
          sendJson(res, 404, { ok: false, error: 'Scan not found' })
          return
        }
        sendHtml(res, result.html)
        return
      }

      sendJson(res, 404, { ok: false, error: 'Not found' })
    } catch (error) {
      try {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      } catch {
        /* response already started */
      }
    }
  }

  return webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler })
}
