/**
 * Run a full sweep locally and write a snapshot.
 *
 * This is the same code the daily Action runs, driven from a terminal so the
 * scraper can be exercised against the live store without a deploy. Writes
 * `data/snapshot.json`, which `npm run dev` serves as the local API.
 *
 *   npx jiti scripts/collect.ts [marketId ...]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { MARKETS, STORES } from '../src/shared/markets'
import { hasEducationPricing } from '../src/shared/families'
import { collectFamilies, discoverFamilies, discoverStructures, RequestBudget } from '../src/scrape/sweep'
import { collapseUnpaidDimensions } from '../src/shared/offers'
import { fetchFxRates } from '../src/scrape/fx'
import type { Offer } from '../src/shared/types'

const wanted = process.argv.slice(2)
const markets = wanted.length ? MARKETS.filter((m) => wanted.includes(m.id)) : MARKETS

// A terminal has no subrequest cap, so one generous budget covers the run.
const budget = new RequestBudget(100_000)

console.log(`Discovering catalogue from ${MARKETS[0].name} ...`)
const listing = await discoverFamilies(MARKETS[0], budget)
console.log(`  ${listing.families.length} families: ${listing.families.map((f) => f.id).join(', ')}`)
const structures = await discoverStructures(MARKETS[0], budget, listing.families)
console.log(`  ${structures.structures.length} structures, ${structures.errors.length} failed`)
for (const e of structures.errors) console.log(`  ! ${e.familyId}: ${e.message}`)

const offers: Offer[] = []
const errors = [...structures.errors]
for (const market of markets) {
  for (const store of STORES) {
    const wanted =
      store === 'education'
        ? structures.structures.filter((s) => {
            const family = structures.families.find((f) => f.id === s.familyId)
            return !family || hasEducationPricing(family)
          })
        : structures.structures
    const collection = await collectFamilies(market, store, wanted, budget, structures.families)
    offers.push(...collection.offers)
    errors.push(...collection.errors)
    console.log(
      `${market.flag} ${market.name} ${store.padEnd(10)}: ${collection.offers.length} offers, ${collection.errors.length} errors`,
    )
  }
}

let fx = null
try {
  fx = await fetchFxRates()
  console.log(`FX: ${Object.keys(fx.rates).length} rates, ${fx.fetchedAt}`)
} catch (error) {
  console.log(`FX failed: ${error}`)
}

/**
 * Decided over the whole collection, so every market keeps the same key.
 * A market-filtered run is a development convenience and may therefore reach a
 * different verdict from a full one -- the published catalogue always comes
 * from a full run.
 */
const priced = collapseUnpaidDimensions(offers)
if (priced.length < offers.length) {
  console.log(`\nCollapsed ${offers.length - priced.length} offers that only restate a price`)
}

mkdirSync('data', { recursive: true })
writeFileSync(
  'data/snapshot.json',
  JSON.stringify(
    {
      collectedAt: new Date().toISOString(),
      markets: markets.map((m) => m.id),
      families: structures.families,
      categories: listing.categories,
      offers: priced,
      errors,
      fx,
    },
    null,
    2,
  ),
)
console.log(`\nWrote data/snapshot.json: ${priced.length} offers, ${errors.length} errors`)
