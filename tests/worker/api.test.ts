import { describe, expect, it } from 'vitest'
import worker from '../../src/worker/index'
import type { Env } from '../../src/worker/store'
import { FAMILIES } from '../../src/shared/families'
import type { Offer, RefurbListing, Snapshot } from '../../src/shared/types'

const offer: Offer = {
  marketId: 'uk',
  familyId: 'iphone-16',
  store: 'retail',
  // Synthetic configuration identity, assembled from its field and value.
  configKey: ['dimensionCapacity', '128gb'].join('='),
  dimensions: [{ field: 'dimensionCapacity', value: '128gb', label: '128 GB' }],
  amount: 699,
  currency: 'GBP',
  partNumber: null,
  sourceUrl: 'https://www.apple.com/uk/shop/buy-iphone/iphone-16',
}

const listing: RefurbListing = {
  partNumber: 'FYE73ZN/A',
  title: 'Refurbished iPhone 16 128GB - Black (SIM Free)',
  model: 'iphone16',
  category: 'iphone',
  dimensions: { refurbClearModel: 'iphone16', dimensionCapacity: '128gb' },
  amount: 589,
  currency: 'GBP',
  sourceUrl: 'https://www.apple.com/uk/shop/product/fye73zn/a',
}

const snapshot: Snapshot = {
  collectedAt: '2026-08-27T12:00:00.000Z',
  markets: ['uk'],
  offers: [offer],
  errors: [],
}

/** Only the keys the routes actually read, so a missing one fails loudly. */
const stored: Record<string, unknown> = {
  'snapshot:latest': snapshot,
  'fx:latest': {
    base: 'GBP',
    fetchedAt: '2026-08-27T00:02:31.000Z',
    refreshedAt: new Date().toISOString(),
    nextUpdateAt: new Date(Date.now() + 3_600_000).toISOString(),
    rates: { USD: 1.36 },
  },
  'refurb:uk': {
    marketId: 'uk',
    collectedAt: '2026-08-27T18:00:00.000Z',
    listings: [listing],
    errors: [{ category: 'watch', message: '541 for /uk/shop/refurbished/watch' }],
  },
  'sweep:state': { step: -1, probeAt: null, probeCursor: 3, refurbAt: '2026-08-27T18:00:00.000Z' },
}

/** A limiter that always admits, so routing tests see the real responses. */
const admit = { limit: async () => ({ success: true }) }

const env = {
  PRICES: { get: async (key: string) => stored[key] ?? null, put: async () => {} },
  RATE_LIMIT: admit,
} as unknown as Env

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext

const get = (path: string) =>
  worker.fetch(new Request(`https://example.com${path}`), env, ctx).then((r) => r.json() as never)

describe('GET /api/snapshot', () => {
  it('serves the second-hand listings alongside the new prices', async () => {
    const body: any = await get('/api/snapshot')

    expect(body.offers).toHaveLength(1)
    expect(body.refurb.marketId).toBe('uk')
    expect(body.refurb.listings[0].partNumber).toBe('FYE73ZN/A')
  })

  /**
   * The page decides between "Apple has none" and "we could not read it" from
   * this field. Dropping it from the response would turn an unknown into a
   * confident claim of absent stock.
   */
  it('carries the grids that could not be read', async () => {
    const body: any = await get('/api/snapshot')
    expect(body.refurb.errors).toEqual([
      { category: 'watch', message: '541 for /uk/shop/refurbished/watch' },
    ])
  })

  it('is edge-cacheable, since a snapshot changes at most twice a day', async () => {
    const response = await worker.fetch(new Request('https://example.com/api/snapshot'), env, ctx)
    expect(response.headers.get('cache-control')).toContain('s-maxage=')
  })
})

describe('GET /api/status', () => {
  it('reports where the second-hand tier has got to', async () => {
    const body: any = await get('/api/status')

    expect(body.secondHand).toEqual({ market: 'uk', readAt: '2026-08-27T18:00:00.000Z' })
    expect(body.rates.quotedAt).toBe('2026-08-27T00:02:31.000Z')
  })
})

describe('GET /api/snapshot families', () => {
  const duo = {
    id: 'iphone-duo',
    categoryId: 'iphone',
    name: 'iPhone Duo',
    route: '/shop/buy-iphone/iphone-duo',
    educationPricing: false as const,
  }

  it('serves families stored on the snapshot, including a model the compile-time table does not name', async () => {
    const withFamilies = {
      PRICES: {
        get: async (key: string) =>
          key === 'snapshot:latest' ? { ...snapshot, families: [duo] } : stored[key] ?? null,
        put: async () => {},
      },
      RATE_LIMIT: admit,
    } as unknown as Env
    const body: any = await worker
      .fetch(new Request('https://example.com/api/snapshot'), withFamilies, ctx)
      .then((r) => r.json())

    expect(body.families).toEqual([duo])
    expect(FAMILIES.map((f) => f.id)).not.toContain('iphone-duo')
  })

  it('falls back to the compile-time table when a snapshot predates a stored family list', async () => {
    const body: any = await get('/api/snapshot')
    expect(body.families).toEqual(FAMILIES)
    expect(body.families.some((f: { id: string }) => f.id === 'iphone-17-pro')).toBe(true)
  })
})

describe('an empty store', () => {
  it('says so rather than serving an empty catalogue', async () => {
    const bare = {
      PRICES: { get: async () => null, put: async () => {} },
      RATE_LIMIT: admit,
    } as unknown as Env
    const response = await worker.fetch(new Request('https://example.com/api/snapshot'), bare, ctx)

    expect(((await response.json()) as any).error).toMatch(/No price data/)
  })
})

describe('the per-client rate limit', () => {
  const keys: string[] = []
  const deny = {
    PRICES: {
      get: async () => {
        throw new Error('a denied request must not read KV')
      },
    },
    RATE_LIMIT: {
      limit: async ({ key }: { key: string }) => {
        keys.push(key)
        return { success: false }
      },
    },
  } as unknown as Env

  it.each(['/api/snapshot', '/api/status', '/api/history?family=f&config=c', '/mcp', '/llms.txt'])(
    'answers 429 on %s once the client is over its limit, before any storage read',
    async (path) => {
      keys.length = 0
      const request = new Request(`https://example.com${path}`, {
        headers: { 'CF-Connecting-IP': '203.0.113.7' },
      })
      const response = await worker.fetch(request, deny, ctx)

      expect(response.status).toBe(429)
      expect(keys).toEqual(['203.0.113.7'])
    },
  )
})
