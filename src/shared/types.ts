import type { Category, Family } from './families'
import type { StoredOffer } from './offers'

/** A single selectable hardware option, e.g. memory 24GB. */
export interface DimensionValue {
  /** Apple's dimension id, e.g. `memory-dimensionMemory`. */
  field: string
  /** Apple's value id, e.g. `24gb`. */
  value: string
  /** Human label, e.g. `24GB`. */
  label: string
}

/** One exact configuration priced in one market, at one of Apple's stores. */
export interface Offer {
  marketId: string
  familyId: string
  /** Which Apple store quoted it — education prices are lower but restricted. */
  store: 'retail' | 'education'
  /** Stable id for the dimension combination, identical across markets. */
  configKey: string
  dimensions: DimensionValue[]
  /** List price in the market's own currency. */
  amount: number
  currency: string
  /** Apple part number, when the configuration is a stocked build. */
  partNumber: string | null
  /** The regional Apple Store page this configuration came from. */
  sourceUrl: string
}

/**
 * What one family's product selector looks like — market-independent.
 *
 * Apple ships two kinds of selector, and they need different handling:
 *
 * - `cto` (every Mac): a build-to-order matrix. The page lists chip variants;
 *   prices come from the CTO endpoint, one request per variant.
 * - `catalog` (iPhone, iPad, Watch, AirPods, displays, TV & Home): a fixed set
 *   of SKUs. Every price is already on the page, so no extra request is needed
 *   — but the page must be fetched once per market, since it carries the money.
 */
export interface FamilyStructure {
  familyId: string
  kind: 'cto' | 'catalog'
  /** Apple's CTO collection id, e.g. `MAC_MINI_2026_COLLECTION`. `cto` only. */
  collection?: string
  /** Chip/model variants; each needs its own pricing request. `cto` only. */
  variants: DimensionValue[][]
  /** Configurable dimensions in display order. */
  dimensions: { field: string; label: string; values: DimensionValue[] }[]
}

export interface Snapshot {
  collectedAt: string
  markets: string[]
  /**
   * Offers as stored, without the two fields that restate the others. Read
   * them back through `hydrateOffers` -- see `shared/offers.ts` for why.
   */
  offers: StoredOffer[]
  /**
   * Families that failed to collect, with the reason. `store` is absent on
   * snapshots written before education prices existed.
   */
  errors: { marketId: string; familyId: string; store?: 'retail' | 'education'; message: string }[]
  /**
   * Buy-flow families this collection discovered. Absent on snapshots
   * written before listing discovery, which fall back to the compile-time
   * table.
   */
  families?: Family[]
  /** Store-front categories; older snapshots use the compile-time fallback. */
  categories?: Category[]
}

/** Base-currency conversion rates, keyed by the market's currency. */
export interface FxRates {
  base: string
  /** When the source says it quoted these rates. */
  fetchedAt: string
  /** When we last read the source. Absent on records written before this field. */
  refreshedAt?: string
  /** When the source says its next quote is due, when it says at all. */
  nextUpdateAt?: string | null
  /** `rates[CUR]` = how many CUR one unit of `base` buys. */
  rates: Record<string, number>
}

/**
 * Apple's refurbished store is split into these grids, one page each.
 */
export const REFURB_CATEGORIES = ['mac', 'ipad', 'iphone', 'watch', 'appletv', 'homepod'] as const
export type RefurbCategory = (typeof REFURB_CATEGORIES)[number]

/**
 * One unit in Apple's refurbished store.
 *
 * `dimensions` is the refurbished grid's own facet map, not a configuration
 * key: its fields overlap the new-price dimensions but are neither a subset
 * nor a superset, so matching is a deliberate step rather than a lookup.
 */
export interface RefurbListing {
  partNumber: string
  title: string
  /** Apple's own model token, such as `macbookpro` or `ipadair_11`. */
  model: string
  category: RefurbCategory
  dimensions: Record<string, string>
  amount: number
  currency: string
  sourceUrl: string
}
