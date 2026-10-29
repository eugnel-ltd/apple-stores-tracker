import { categoriesOf, familiesOf } from '../shared/families'
import { MARKETS } from '../shared/markets'
import { hydrateOffers } from '../shared/offers'
import type { Offer, Snapshot } from '../shared/types'

/**
 * A stateless Streamable HTTP MCP server.
 *
 * The spec allows a plain POST/response pair when the server keeps no session,
 * and these three tools are read-only lookups over one KV blob -- so there is
 * no state to keep, and no Durable Object needed to keep it.
 */
const PROTOCOL_VERSION = '2025-06-18'

const TOOLS = [
  {
    name: 'list_catalog',
    description:
      'Discover the products, markets and currencies available, plus when the price data was collected.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_product_configurations',
    description:
      'List the valid configurations of one product. Use `query` to narrow by terms such as "M6 24GB 512GB". Returns configuration_key values for compare_prices.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'A family id from list_catalog, e.g. "mac-mini".' },
        query: { type: 'string', description: 'Space-separated terms matched against option labels.' },
        limit: { type: 'number', description: 'Maximum configurations to return (default 25).' },
      },
      required: ['product_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'compare_prices',
    description:
      'Compare one exact configuration across every market. Returns official local list prices with source URLs, and the education-store price where Apple offers one. No currency conversion and no tax-refund estimate is applied.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'string' },
        configuration_key: {
          type: 'string',
          description: 'A configuration_key from list_product_configurations.',
        },
        query: {
          type: 'string',
          description: 'Alternative to configuration_key: terms that identify one configuration.',
        },
      },
      required: ['product_id'],
      additionalProperties: false,
    },
  },
]

const describe = (offer: Offer): string =>
  offer.dimensions.map((d) => d.label).join(' / ')

/** Match every term against the configuration's labels, case-insensitively. */
function matches(offer: Offer, query: string | undefined): boolean {
  if (!query) return true
  const haystack = describe(offer).toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

function uniqueConfigurations(offers: Offer[], familyId: string, query?: string) {
  const seen = new Map<string, Offer>()
  for (const offer of offers) {
    // Configurations are listed from the retail store: education prices are a
    // second price for the same build, not a different build.
    if (offer.familyId !== familyId || offer.store !== 'retail' || !matches(offer, query)) continue
    if (!seen.has(offer.configKey)) seen.set(offer.configKey, offer)
  }
  return [...seen.values()]
}

function callTool(name: string, args: Record<string, any>, snapshot: Snapshot | null): unknown {
  if (!snapshot) throw new Error('No price data has been collected yet.')

  // The snapshot stores offers without their configKey or source link, so put
  // those back -- but only for the tools that read a configuration.
  // `list_catalog` wants a count and should not pay to rebuild the catalogue.
  // A snapshot written before education prices existed has no `store`, and the
  // configuration tools filter on it being `retail` — so default it here, the
  // way the browser does at its own boundary.
  const families = familiesOf(snapshot)
  let hydrated: Offer[] | null = null
  const offers = (): Offer[] =>
    (hydrated ??= hydrateOffers(
      snapshot.offers.map((o) => ({ ...o, store: o.store ?? 'retail' })),
      families,
    ))

  if (name === 'list_catalog') {
    return {
      collectedAt: snapshot.collectedAt,
      source: 'Apple Online Store',
      categories: categoriesOf(snapshot),
      products: families.map((f) => ({ id: f.id, name: f.name, categoryId: f.categoryId })),
      markets: MARKETS.map((m) => ({ id: m.id, name: m.name, currency: m.currency })),
      offerCount: snapshot.offers.length,
      stores: ['retail', 'education'],
    }
  }

  if (name === 'list_product_configurations') {
    const limit = Math.min(Number(args.limit) || 25, 100)
    const found = uniqueConfigurations(offers(), String(args.product_id), args.query)
    return {
      productId: args.product_id,
      matched: found.length,
      configurations: found.slice(0, limit).map((o) => ({
        configuration_key: o.configKey,
        description: describe(o),
        dimensions: o.dimensions.map((d) => ({ field: d.field, value: d.value, label: d.label })),
      })),
    }
  }

  if (name === 'compare_prices') {
    const familyId = String(args.product_id)
    let configKey = args.configuration_key as string | undefined

    if (!configKey) {
      const candidates = uniqueConfigurations(offers(), familyId, args.query)
      if (candidates.length === 0) throw new Error('No configuration matched that query.')
      if (candidates.length > 1) {
        return {
          ambiguous: true,
          message: `${candidates.length} configurations match. Narrow the query or pass a configuration_key.`,
          candidates: candidates.slice(0, 10).map((o) => ({
            configuration_key: o.configKey,
            description: describe(o),
          })),
        }
      }
      configKey = candidates[0].configKey
    }

    const priced = offers().filter((o) => o.familyId === familyId && o.configKey === configKey)
    if (priced.length === 0) throw new Error('No prices found for that configuration.')

    const retail = priced.filter((o) => o.store === 'retail')
    const education = new Map(
      priced.filter((o) => o.store === 'education').map((o) => [o.marketId, o]),
    )

    return {
      productId: familyId,
      configuration_key: configKey,
      description: describe(priced[0]),
      collectedAt: snapshot.collectedAt,
      note: 'Official local list prices. No exchange-rate conversion or tax-refund estimate applied. An education price applies only to students of that country, and only one country can apply to any one buyer.',
      prices: (retail.length ? retail : priced)
        .map((o) => ({
          marketId: o.marketId,
          market: MARKETS.find((m) => m.id === o.marketId)?.name ?? o.marketId,
          amount: o.amount,
          currency: o.currency,
          educationAmount: education.get(o.marketId)?.amount ?? null,
          partNumber: o.partNumber,
          sourceUrl: o.sourceUrl,
        }))
        .sort((a, b) => a.market.localeCompare(b.market)),
    }
  }

  throw new Error(`Unknown tool: ${name}`)
}

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, any>
}

const result = (id: unknown, value: unknown) => ({ jsonrpc: '2.0', id, result: value })
const failure = (id: unknown, code: number, message: string) => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
})

export async function handleMcp(request: Request, snapshot: Snapshot | null): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('MCP endpoint accepts POST', { status: 405, headers: { allow: 'POST' } })
  }

  let rpc: JsonRpcRequest
  try {
    rpc = (await request.json()) as JsonRpcRequest
  } catch {
    return Response.json(failure(null, -32700, 'Parse error'), { status: 400 })
  }

  const { id = null, method, params = {} } = rpc

  // Notifications carry no id and expect no body.
  if (id === null && method?.startsWith('notifications/')) return new Response(null, { status: 202 })

  if (method === 'initialize') {
    return Response.json(
      result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'apple-price-tracker', version: '1.0.0' },
      }),
    )
  }

  if (method === 'tools/list') return Response.json(result(id, { tools: TOOLS }))

  if (method === 'tools/call') {
    const name = String(params.name ?? '')
    try {
      const value = callTool(name, params.arguments ?? {}, snapshot)
      return Response.json(
        result(id, { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }),
      )
    } catch (error) {
      // Tool failures are results, not protocol errors: the model should see
      // the message and try something else rather than treat it as a crash.
      return Response.json(
        result(id, { content: [{ type: 'text', text: String(error) }], isError: true }),
      )
    }
  }

  return Response.json(failure(id, -32601, `Method not found: ${method}`))
}
