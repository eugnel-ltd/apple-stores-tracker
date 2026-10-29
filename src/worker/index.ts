import { categoriesOf, familiesOf, type Category } from '../shared/families'
import { BASE_CURRENCY, MARKETS, REFURB_MARKET } from '../shared/markets'
import { REFUND_POLICIES } from '../shared/refunds'
import { handleMcp } from './mcp'
import { currentRates } from './rates'
import { getRefurb, getSnapshot, type Env } from './store'

const json = (body: unknown, maxAge: number): Response =>
  Response.json(body, {
    headers: {
      // Data changes at most twice a day; let the edge absorb the reads.
      'cache-control': `public, max-age=${maxAge}, s-maxage=${maxAge}`,
    },
  })

const llmsTxt = (categories: Category[]) => `# Apple Price Tracker

> Compare official Apple Online Store list prices for one exact product
> configuration across ${MARKETS.length} markets, ranked in ${BASE_CURRENCY}.

## Coverage

- Categories: ${categories.map((c) => c.label).join(', ')}.
- Markets: ${MARKETS.map((m) => m.name).join(', ')}.
- Data source: Apple's own regional store product selectors, retail and education.
- Base currency: ${BASE_CURRENCY}. Rates from open.er-api.com, re-read on request as soon as the feed republishes.

## Agent access

- MCP endpoint: /mcp
- Transport: Streamable HTTP, stateless
- Authentication: none; every tool is read-only.

## MCP tools

- \`list_catalog\`: product ids, market ids, currencies, dataset metadata.
- \`list_product_configurations\`: valid configurations for a product. \`query\` accepts terms such as "M6 24GB 512GB".
- \`compare_prices\`: one exact configuration across every market.

## Price semantics

- Prices are official local list prices in each market's own currency.
- MCP responses apply no currency conversion and no tax-refund estimate.
- Tax-refund figures shown on the website are ESTIMATES, not quotes. Most schemes are voluntary for the retailer; where Apple's participation is unverified the site marks it.
- Education prices come from Apple's education store. They apply only to students of that country, so at most one market's education price can apply to any one buyer.
- US prices exclude sales tax, which is added at checkout.
- \`collectedAt\` is when the data was gathered; Apple can change prices after it.

## Not affiliated with Apple

This is an independent price comparison. Apple, Mac, iPhone, iPad and related
marks are trademarks of Apple Inc.
`

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Every request that reaches the Worker parses an ~8 MB snapshot or queries
    // D1, so one client is capped before any storage read (wrangler.jsonc
    // `ratelimits`, ai-sdlc Cloudflare cost guard).
    const client = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    const { success } = await env.RATE_LIMIT.limit({ key: client })
    if (!success) {
      return new Response('Too many requests', { status: 429, headers: { 'retry-after': '60' } })
    }

    const url = new URL(request.url)

    if (url.pathname === '/mcp') {
      return handleMcp(request, await getSnapshot(env))
    }

    if (url.pathname === '/llms.txt') {
      return new Response(llmsTxt(categoriesOf(await getSnapshot(env))), {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
      })
    }

    if (url.pathname === '/api/snapshot') {
      const [snapshot, fx, refurb] = await Promise.all([
        getSnapshot(env),
        currentRates(env, ctx),
        getRefurb(env, REFURB_MARKET),
      ])
      if (!snapshot) return json({ error: 'No price data collected yet.' }, 60)
      return json(
        {
          collectedAt: snapshot.collectedAt,
          baseCurrency: BASE_CURRENCY,
          markets: MARKETS,
          categories: categoriesOf(snapshot),
          families: familiesOf(snapshot),
          refunds: REFUND_POLICIES,
          fx,
          refurb,
          offers: snapshot.offers,
          errors: snapshot.errors,
        },
        900,
      )
    }

    if (url.pathname === '/api/history') {
      const familyId = url.searchParams.get('family')
      const configKey = url.searchParams.get('config')
      const marketId = url.searchParams.get('market')
      if (!familyId || !configKey) {
        return json({ error: 'family and config are required' }, 60)
      }
      const { results } = await env.HISTORY.prepare(
        `SELECT market_id AS marketId, store, currency, amount, observed_on AS observedOn
           FROM price_point
          WHERE family_id = ? AND config_key = ? AND (?3 IS NULL OR market_id = ?3)
          ORDER BY observed_on ASC`,
      )
        .bind(familyId, configKey, marketId)
        .all()
      return json({ familyId, configKey, marketId, points: results }, 900)
    }

    if (url.pathname === '/api/status') {
      const [snapshot, fx, refurb] = await Promise.all([
        getSnapshot(env),
        currentRates(env, ctx),
        getRefurb(env, REFURB_MARKET),
      ])
      return json(
        {
          collectedAt: snapshot?.collectedAt ?? null,
          markets: snapshot?.markets ?? [],
          offers: snapshot?.offers.length ?? 0,
          errors: snapshot?.errors.length ?? 0,
          rates: {
            quotedAt: fx?.fetchedAt ?? null,
            readAt: fx?.refreshedAt ?? null,
            nextQuoteDue: fx?.nextUpdateAt ?? null,
          },
          secondHand: { market: REFURB_MARKET, readAt: refurb?.collectedAt ?? null },
        },
        60,
      )
    }

    return env.ASSETS.fetch(request)
  },
}
