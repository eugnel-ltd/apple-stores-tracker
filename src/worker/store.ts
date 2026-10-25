import type { RefurbCollection } from '../scrape/refurb'
import type { FxRates, Snapshot } from '../shared/types'

export interface Env {
  PRICES: KVNamespace
  HISTORY: D1Database
  ASSETS: Fetcher
  RATE_LIMIT: RateLimit
}

/**
 * What the Worker reads to serve a request.
 *
 * There is nothing here about sweeps or cursors any more. Collection runs off
 * Cloudflare -- see `scripts/publish.ts` -- because a free plan's cron can
 * spend 4.8 CPU-seconds a day and one full sweep needs about five. The Worker
 * reads three blobs and answers; KV is edge-cached, D1 holds the sparse
 * history and is queried by key.
 */
export const KEYS = {
  snapshot: 'snapshot:latest',
  /** Second-hand listings, per market. Only the UK is collected today. */
  refurb: (marketId: string) => `refurb:${marketId}`,
  fx: 'fx:latest',
} as const

const readJson = async <T>(kv: KVNamespace, key: string): Promise<T | null> =>
  kv.get<T>(key, 'json')

const writeJson = (kv: KVNamespace, key: string, value: unknown): Promise<void> =>
  kv.put(key, JSON.stringify(value))

export const getSnapshot = (env: Env) => readJson<Snapshot>(env.PRICES, KEYS.snapshot)

export const getRefurb = (env: Env, marketId: string) =>
  readJson<RefurbCollection>(env.PRICES, KEYS.refurb(marketId))

export const getFx = (env: Env) => readJson<FxRates>(env.PRICES, KEYS.fx)
export const putFx = (env: Env, v: FxRates) => writeJson(env.PRICES, KEYS.fx, v)
