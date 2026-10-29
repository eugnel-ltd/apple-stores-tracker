import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { categoriesOf, familiesOf } from './src/shared/families.ts'
import { BASE_CURRENCY, MARKETS } from './src/shared/markets.ts'
import { REFUND_POLICIES } from './src/shared/refunds.ts'

/**
 * Serve `data/snapshot.json` as /api/snapshot during `npm run dev`, so the UI
 * can be built against real prices without a Worker, a KV namespace or a
 * deploy. Run `npx jiti scripts/collect.ts` to refresh it.
 */
function localSnapshot(): Plugin {
  return {
    name: 'parity-local-snapshot',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/snapshot', (_request, response) => {
        response.setHeader('content-type', 'application/json')
        try {
          const local = JSON.parse(readFileSync('data/snapshot.json', 'utf8'))
          response.end(
            JSON.stringify({
              collectedAt: local.collectedAt,
              baseCurrency: BASE_CURRENCY,
              markets: MARKETS,
              categories: categoriesOf(local),
              families: familiesOf(local),
              refunds: REFUND_POLICIES,
              fx: local.fx,
              refurb: local.refurb ?? null,
              offers: local.offers,
              errors: local.errors,
            }),
          )
        } catch {
          response.statusCode = 503
          response.end(
            JSON.stringify({ error: 'No local snapshot. Run: npx jiti scripts/collect.ts' }),
          )
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localSnapshot()],
  root: 'src/app',
  build: { outDir: '../../dist/public', emptyOutDir: true },
})
