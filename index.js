/** Host half of the CodeTrail DSH bundle: tools plus the panel's HTTP bridge. */
import { registerTools } from './lib/tools.js'
import { registerWebRoutes } from './lib/http.js'

export const name = 'codetrail-dsh'
export const inject = ['tools', 'webServer']

export function apply(ctx) {
  registerTools(ctx)
  ctx.effect(() => registerWebRoutes(ctx.webServer), 'codetrail-dsh web routes')
}
