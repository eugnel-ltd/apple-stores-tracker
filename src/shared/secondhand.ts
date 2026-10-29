import type { Offer, RefurbCategory, RefurbListing } from './types'

/**
 * Which refurbished-grid models belong to each family we price.
 *
 * Apple's grid uses its own model tokens, and they are not our family ids:
 * `ipadair_11` and `ipadair_13` are both the iPad Air, `macbookpro` covers
 * every size and chip, and a Watch is `watchseries11`, not `applewatch`. The
 * rest of the specification is pinned by the facet match below, so a broad
 * token here does not loosen the comparison.
 */
interface FamilyGrid {
  category: RefurbCategory
  model: RegExp
  /**
   * The same product a generation or more back, where Apple's token names the
   * generation. Used only when nothing current is in stock — see `matchRefurb`.
   */
  lineage?: RegExp
  /**
   * Whether `model` admits exactly one generation, as `/^iphone16$/` does.
   *
   * Declared rather than inferred. This was read off the pattern text by
   * testing it for a digit, which is true of `/^ipad(?:\d{4})?$/` because of
   * the `{4}` quantifier — so the one family whose generation nothing else
   * pins was the one reported as pinned.
   */
  generationInToken?: true
  /**
   * How a listing's generation is written for this family, and which one Apple
   * sells today.
   *
   * Declared because neither side can be asked. Apple's buy page sells no chip
   * dimension for a Watch, an iMac or an iPad Air, so the configuration cannot
   * name its own generation; and the grid's token carries a screen size rather
   * than a generation, so `ipadair_11` reads as generation 11. Between them
   * these families could never prove a unit was earlier -- every unit Apple
   * had was shown as the current one, and a Series 11 was priced from Series 9
   * stock.
   *
   * `now` dates, so it is read as a floor rather than a fact: see
   * `currentGeneration`.
   */
  generation?: { now: number; from: 'token' | 'chip' }
}

const REFURB_MODELS: Record<string, FamilyGrid> = {
  // Declared where the offer carries no chip to read a generation from; the
  // Mac mini, Mac Studio and MacBook Pro all sell one, so they need none.
  'macbook-air': { category: 'mac', model: /^macbookair/, generation: { now: 5, from: 'chip' } },
  'macbook-pro': { category: 'mac', model: /^macbookpro/ },
  'macbook-neo': { category: 'mac', model: /^macbookneo/ },
  imac: { category: 'mac', model: /^imac/, generation: { now: 4, from: 'chip' } },
  'mac-mini': { category: 'mac', model: /^macmini/ },
  'mac-studio': { category: 'mac', model: /^macstudio/ },
  'ipad-pro': { category: 'ipad', model: /^ipadpro/, generation: { now: 5, from: 'chip' } },
  'ipad-air': { category: 'ipad', model: /^ipadair/, generation: { now: 4, from: 'chip' } },
  // The mini names its generation in the token (`ipadmini6`); the A17 Pro one
  // Apple sells now is the seventh.
  'ipad-mini': { category: 'ipad', model: /^ipadmini/, generation: { now: 7, from: 'token' } },
  // The base iPad's token is the fixed slug `ipad2017` whatever the unit, and
  // its generation appears only as prose in the title -- "(9th Generation)"
  // beside "(A16)". Two numberings that cannot be ordered against each other,
  // so this family claims no generation rather than guess one. Same for the TV.
  ipad: { category: 'ipad', model: /^ipad(?:\d{4})?$/ },
  'iphone-air': { category: 'iphone', model: /^iphoneair/ },
  // `watchse` alone would also match `watchseries10`, so the SE needs its digit.
  'apple-watch': { category: 'watch', model: /^watchseries/, generation: { now: 11, from: 'token' } },
  'apple-watch-se': { category: 'watch', model: /^watchse\d/, generation: { now: 3, from: 'token' } },
  'apple-watch-ultra': { category: 'watch', model: /^watchultra/, generation: { now: 3, from: 'token' } },
  'apple-tv-4k': { category: 'appletv', model: /^appletv/ },
  homepod: { category: 'homepod', model: /^homepod$/ },
  'homepod-mini': { category: 'homepod', model: /^homepodmini/ },
}

/**
 * How many units of this family Apple has, whatever the configuration.
 *
 * An empty panel has two quite different things to say, and only this
 * separates them: Apple had no refurbished Mac mini of any generation on the
 * day this was written, while a Mac Studio configuration with nothing to show
 * sits beside one unit that is simply a different build. Reporting the first
 * as "none matching this configuration" invites the reader to go looking for a
 * configuration that would match, and there is none.
 */
/**
 * Numbered iPhone families (`iphone-18-pro`, `iphone-17e`) share one grid
 * shape: the generation is in the token. Derived from the family id so a
 * newly listed generation matches without a table row.
 */
function numberedIphoneGrid(familyId: string): FamilyGrid | undefined {
  // Live ids are `iphone-17e` (no hyphen before e) and `iphone-18-pro`.
  const match = /^iphone-(\d+)(.*)$/.exec(familyId)
  if (!match) return undefined
  const [, generation, rest] = match
  if (rest !== '' && rest !== '-pro' && rest !== 'e' && rest !== '-e') return undefined
  const suffix = rest.replace(/^-/, '')
  const token = escapeRegExp(`iphone${generation}${suffix}`)
  if (suffix === 'pro') {
    return { category: 'iphone', model: new RegExp(`^${token}`), lineage: /^iphone\d+pro/, generationInToken: true }
  }
  return {
    category: 'iphone',
    model: new RegExp(`^${token}$`),
    lineage: new RegExp(`^iphone\\d+${escapeRegExp(suffix)}$`),
    generationInToken: true,
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const gridFor = (familyId: string): FamilyGrid | undefined =>
  REFURB_MODELS[familyId] ?? numberedIphoneGrid(familyId)

export const refurbStockFor = (familyId: string, listings: RefurbListing[]): number => {
  const family = gridFor(familyId)
  if (!family) return 0
  const line = family.lineage ?? family.model
  return listings.filter((listing) => line.test(listing.model)).length
}

/** The grid a family's units would appear in, if Apple refurbishes it at all. */
export const refurbCategoryFor = (familyId: string): RefurbCategory | null =>
  gridFor(familyId)?.category ?? null

/**
 * Our dimension fields carry the selector section they came from
 * (`storage-dimensionCapacity`); the grid's facets do not. Match on the
 * suffix — and note that one suffix can mean two different grid keys, since
 * Apple spells connectivity `dimensionconnectivity` on an iPad and
 * `dimensionConnection` on a Watch. A listing carries exactly one of them.
 *
 * Colour is deliberately absent. It never moves the new price, and a buyer
 * comparing a second-hand price against a new one is not served by hiding the
 * silver one because they were looking at midnight.
 */
const FACETS_FOR_SUFFIX: Record<string, string[]> = {
  dimensionCapacity: ['dimensionCapacity'],
  dimensionScreensize: ['dimensionScreensize'],
  dimensionMemory: ['tsMemorySize'],
  dimensionConnection: ['dimensionconnectivity', 'dimensionConnection'],
  dimensionCaseSize: ['dimensionCaseSize'],
  dimensionCaseMaterial: ['dimensionCaseMaterial'],
}

/**
 * Facets that move the price, and so decide whether a comparison is honest.
 *
 * If a listing pins one of these and our configuration does not, the two are
 * not the same machine however well everything else lines up: a used 4TB
 * MacBook Air costs more than a new base one, and quoting it as "this
 * configuration, used" would be a straightforwardly false claim.
 */
const PRICE_DRIVING = new Set([
  'dimensionCapacity',
  'tsMemorySize',
  'dimensionconnectivity',
  'dimensionConnection',
  'dimensionCaseSize',
  'dimensionCaseMaterial',
  // A generation is a spec. Apple refurbishes what it sold a year ago, and an
  // M2 iPad Pro sitting next to an M4 one is not a cheaper version of it.
  'dimensionRelYear',
])

/**
 * The axes a buyer configures, as against the ones that pick a product.
 *
 * Apple's refurbished shelf holds whatever came back, so demanding an exact
 * storage and memory match turns the earlier-generation comparison into a
 * lottery: one Mac Studio was in stock and only the two configurations that
 * happened to want its 96GB/1TB build could see it. Across the catalogue that
 * was 33 configurations of 306. So the earlier-generation search reports these
 * two as a difference instead of refusing the unit -- the answer to "what did
 * last year's cost" is useful at a nearby build, and stating which build it
 * was keeps it honest.
 *
 * Everything else stays strict. A 13-inch iPad Air is not an earlier 11-inch
 * one, and a cellular Watch is not an earlier GPS one.
 */
const BUILD_TO_ORDER = new Set(['dimensionCapacity', 'tsMemorySize'])

const FACET_LABELS: Record<string, string> = {
  dimensionCapacity: 'storage',
  dimensionScreensize: 'screen size',
  tsMemorySize: 'memory',
  dimensionconnectivity: 'connectivity',
  dimensionConnection: 'connectivity',
  dimensionCaseSize: 'case size',
  dimensionCaseMaterial: 'case material',
  dimensionColor: 'colour',
  dimensionRelYear: 'release year',
  refurbClearModel: 'generation',
}

const labelFor = (facet: string): string => FACET_LABELS[facet] ?? facet

/** Chip family and core counts, however each side happens to spell them. */
interface Processor {
  chip?: string
  cpu?: number
  gpu?: number
}

/**
 * What our configuration says about the processor.
 *
 * Apple spells this three ways across families: a chip token on its own
 * (`m5pro`), a chip token with its core counts (`m5pro-15-16`), or bare core
 * counts where the family has only one chip (`10-10`).
 */
export function processorOf(offer: Offer): Processor {
  const processor: Processor = {}
  for (const dimension of offer.dimensions) {
    if (!dimension.field.includes('CoreCount') && !dimension.field.endsWith('dimensionChip')) continue
    const parts = dimension.value.split('-')
    const cores = parts.filter((p) => /^\d+$/.test(p)).map(Number)
    const chip = parts.find((p) => /^m\d/.test(p))
    if (chip) processor.chip = chip
    if (cores.length === 2) [processor.cpu, processor.gpu] = cores
  }
  return processor
}

/**
 * What a listing's own title says about the processor.
 *
 * The grid's facets do not carry the chip, so an M5 and an M5 Pro of the same
 * size and storage look identical there. The title names it, and a comparison
 * that skipped this would be quoting one machine's price against another's.
 */
export function processorInTitle(title: string): Processor {
  const processor: Processor = {}
  // "Apple M5 Pro chip" on a Mac, a bare "(M4)" on an iPad.
  const chip =
    /\bapple\s+(m\d+)(?:\s+(pro|max|ultra))?\s+chip/i.exec(title) ??
    /\((m\d+)(?:\s+(pro|max|ultra))?\)/i.exec(title)
  if (chip) processor.chip = (chip[1] + (chip[2] ?? '')).toLowerCase()

  const cpu = /(\d+)[‐-―-]core\s+cpu/i.exec(title)
  const gpu = /(\d+)[‐-―-]core\s+gpu/i.exec(title)
  if (cpu) processor.cpu = Number(cpu[1])
  if (gpu) processor.gpu = Number(gpu[1])
  return processor
}

/**
 * The generation number in a family id or a grid token: `iphone-17` and
 * `iphone17` are 17, `watchseries10` is 10, `macbookpro` is nothing.
 */
const generationIn = (text: string): number | undefined => {
  const digits = /(\d+)/.exec(text)?.[1]
  return digits ? Number(digits) : undefined
}

/** `m6` is 6. A chip number is a generation too, where a token is not. */
const chipGeneration = (chip: string | undefined): number | undefined => {
  const digits = chip ? /^m(\d+)/.exec(chip)?.[1] : undefined
  return digits ? Number(digits) : undefined
}

/** Equal wherever both sides say something; silence never contradicts. */
const processorsAgree = (a: Processor, b: Processor): boolean =>
  (!a.chip || !b.chip || a.chip === b.chip) &&
  (!a.cpu || !b.cpu || a.cpu === b.cpu) &&
  (!a.gpu || !b.gpu || a.gpu === b.gpu)

/** One spec this configuration pins, and the grid keys that could carry it. */
interface Wanted {
  keys: string[]
  value: string
}

const carriedKey = (wanted: Wanted, listing: RefurbListing): string | undefined =>
  wanted.keys.find((key) => listing.dimensions[key] !== undefined)

export interface SecondHandMatch {
  /** Matching units, cheapest first. */
  listings: RefurbListing[]
  low: number
  high: number
  currency: string
  /** The specs actually checked against the units, for display. */
  matchedOn: string[]
  /**
   * Facets the matched units differ on. These are specs this configuration
   * does not pin, so the range spans them rather than describing one machine.
   */
  varyingOn: string[]
  /**
   * Whether these units are the product being priced, or the nearest earlier
   * generation Apple still has. Apple discontinues a model the day it
   * announces its replacement, so the refurbished store is often a generation
   * behind the new-price catalogue — with nothing at all for the new one.
   */
  basis: 'this-generation' | 'earlier-generation'
  /**
   * Whether these units are the same machine as the configuration priced
   * alongside them: at least one price-driving spec positively confirmed on
   * every unit, and no price-driving spec left unpinned.
   *
   * Positive confirmation, not absence of contradiction. A unit that carries
   * no facets at all -- Apple lists its TV that way -- contradicts nothing,
   * and an earlier version of this called that "the same configuration" while
   * comparing a 128GB new box with a 64GB used one.
   */
  exact: boolean
  /** Price-driving facets the units carry and this configuration does not. */
  unpinned: string[]
  /**
   * The other direction: price-driving specs this configuration pins that the
   * units do not state, so nothing could check them. Apple lists its TV with
   * no facets at all, which is not agreement — it is silence, and a reader
   * told only that the match is inexact is owed the reason.
   */
  unconfirmed: string[]
  /**
   * Price-driving specs the units carry at a value this configuration did not
   * ask for. Only an earlier-generation match can have any -- see
   * `BUILD_TO_ORDER` -- and when it does, the range is for a nearby build
   * rather than this one, which the page has to say rather than imply.
   */
  differsOn: string[]
}

/**
 * Find the refurbished units that answer "what does this cost used".
 *
 * Matching is by construction never an identity claim: the grid's facets and
 * our configuration dimensions overlap without either containing the other, so
 * this pins every facet both sides name, checks the processor against the
 * listing's own title, and then reports what it matched on, what the matches
 * still vary by, and whether the result is the same machine at all.
 */
export interface SecondHandComparison {
  /** Units of the machine being priced. */
  thisGeneration: SecondHandMatch | null
  /** Units of the model it replaced, where that can be proved. */
  earlierGeneration: SecondHandMatch | null
}

/**
 * Both answers a second-hand buyer actually weighs.
 *
 * These are two questions, not one with a fallback. A machine on sale now has
 * barely been resold — the units that exist are of the model it replaced — so
 * "what did last year's cost" is the useful answer far more often than "what
 * does this one cost used", and it stays useful when both exist.
 *
 * The two searches cannot return the same unit: the first admits only units of
 * the configuration's own generation, the second only units provably behind
 * it.
 */
export function secondHandFor(offer: Offer, listings: RefurbListing[]): SecondHandComparison {
  const family = gridFor(offer.familyId)
  if (!family) return { thisGeneration: null, earlierGeneration: null }

  const line = family.lineage ?? family.model
  return {
    thisGeneration: search(offer, listings, family, family.model, true, false),
    // The same build if Apple has it, a nearby one only if it does not. Widening
    // unconditionally would answer a worse question wherever the better one had
    // an answer: an iPhone 17 256GB would be quoted a range across every iPhone
    // 16 storage rather than the 256GB one sitting in the same grid.
    earlierGeneration:
      search(offer, listings, family, line, false, false) ??
      search(offer, listings, family, line, false, true),
  }
}

/**
 * Which generation a listing belongs to, read the way this family writes it.
 *
 * Declared per family rather than sniffed, because the same scan means
 * different things on different shelves: `watchseries10` really is generation
 * 10, but `ipadair_11` is an 11-inch iPad Air of no stated generation, and
 * reading its screen size as one would rank a small new iPad Air below a large
 * old one.
 */
const generationOf = (listing: RefurbListing, family: FamilyGrid): number | undefined => {
  if (family.generation) {
    return family.generation.from === 'token'
      ? generationIn(listing.model)
      : chipGeneration(processorInTitle(listing.title).chip)
  }
  return generationIn(listing.model) ?? chipGeneration(processorInTitle(listing.title).chip)
}

/**
 * Which generation the configuration being priced belongs to.
 *
 * The offer's own chip is the fact wherever Apple sells one, and an iPhone's
 * generation is in our family id. Only where neither speaks does the table's
 * declaration stand in — and a declaration dates, so it is read as a floor:
 * Apple never refurbishes a machine newer than the one it sells, so a newer
 * unit on the shelf is proof the declaration has been overtaken and the shelf
 * wins. That keeps a missed table update from labelling the current generation
 * as the one before.
 */
function currentGeneration(
  offer: Offer,
  family: FamilyGrid,
  pool: RefurbListing[],
): number | undefined {
  const own = chipGeneration(processorOf(offer).chip) ?? generationIn(offer.familyId)
  if (own !== undefined) return own
  if (!family.generation) return undefined
  const seen = pool.map((listing) => generationOf(listing, family) ?? -Infinity)
  return Math.max(family.generation.now, ...seen)
}

/**
 * @param model          which grid tokens count as this family.
 * @param sameGeneration whether the unit must be the configuration's own
 *                       generation. False is the earlier-generation pass, and
 *                       every unit it returns has to prove it is behind the
 *                       configuration rather than merely differ from it.
 * @param widen          whether a build-to-order axis may differ. The second
 *                       and last attempt at the earlier generation: Apple's
 *                       shelf holds whatever came back, so an exact build is
 *                       preferred and its absence is not an answer of "none".
 */
function search(
  offer: Offer,
  listings: RefurbListing[],
  family: FamilyGrid,
  model: RegExp,
  sameGeneration: boolean,
  widen: boolean,
): SecondHandMatch | null {
  const wanted: Wanted[] = []
  for (const dimension of offer.dimensions) {
    const keys = FACETS_FOR_SUFFIX[dimension.field.slice(dimension.field.lastIndexOf('-') + 1)]
    if (keys) wanted.push({ keys, value: dimension.value })
  }
  const processor = processorOf(offer)

  const pool = listings.filter((listing) => model.test(listing.model))
  const current = currentGeneration(offer, family, pool)

  /**
   * Whether a unit's generation lines up with the configuration's.
   *
   * Both directions are proof, never assumption. A unit is this generation
   * only if it says so, and earlier only if it says something strictly lower —
   * so a shelf that states nothing yields neither claim rather than the
   * flattering one.
   */
  const generationFits = (listing: RefurbListing): boolean => {
    const generation = generationOf(listing, family)
    if (sameGeneration) {
      // Where the family declares how its generation is written, a unit that
      // does not state one cannot be called current: Apple sold M2 and M3 iPad
      // Airs beside the M4 it sells now, and silence used to pass for
      // agreement.
      if (family.generation !== undefined && generation === undefined) return false
      return current === undefined || generation === undefined || generation === current
    }
    return current !== undefined && generation !== undefined && generation < current
  }

  let candidates = pool.filter(generationFits)

  // "The generation before" means the one immediately before. Apple still sells
  // refurbished iPhone 15s alongside 16s, and listing both under one heading
  // would put two different machines behind a single price range.
  //
  // Chosen before the build is matched, not after. Picking it afterwards names
  // the nearest generation that happened to stock your build: with no 256GB
  // iPhone 16 on the shelf, a 256GB iPhone 15 was being offered as "the model
  // Apple sold before this one" while the 16 sat beside it.
  if (!sameGeneration && candidates.length > 0) {
    const nearest = Math.max(...candidates.map((l) => generationOf(l, family) ?? -Infinity))
    candidates = candidates.filter((l) => generationOf(l, family) === nearest)
  }

  const matches = candidates.filter((listing) => {
    for (const spec of wanted) {
      // A facet the grid does not carry for this model cannot disagree; one it
      // does carry must agree exactly — unless it is a build-to-order axis and
      // this is the widened pass, where it is reported rather than required.
      const key = carriedKey(spec, listing)
      if (key === undefined || listing.dimensions[key] === spec.value) continue
      if (widen && BUILD_TO_ORDER.has(key)) continue
      return false
    }
    return !sameGeneration || processorsAgree(processor, processorInTitle(listing.title))
  })

  if (matches.length === 0) return null

  const sorted = [...matches].sort((a, b) => a.amount - b.amount)
  const facetsCarried = [...new Set(matches.flatMap((l) => Object.keys(l.dimensions)))]
  const asked = new Set(wanted.flatMap((spec) => spec.keys))

  // Judged per facet the listings carry, not per facet that happens to vary: a
  // single match varies by nothing while still being a different machine.
  const unpinned = facetsCarried
    .filter((facet) => PRICE_DRIVING.has(facet) && !asked.has(facet))
    .map(labelFor)

  // `refurbClearModel` is included deliberately. Apple's Watch token carries
  // the series, and a Series 11 configuration quietly priced from Series 10
  // stock is the whole reason this list exists.
  const varyingOn = facetsCarried
    .filter(
      (facet) =>
        !asked.has(facet) &&
        new Set(matches.map((l) => l.dimensions[facet])).size > 1,
    )
    .map(labelFor)

  /**
   * A generation is pinned when the grid token names one (`iphone16`), when
   * the family declares how to read one and the search matched on it, or when
   * the configuration named a processor for the title check to agree with.
   * None held for a Watch before the declaration existed: `watchseries`
   * matches every series Apple has refurbished and our family id is just
   * `apple-watch`, so a Series 11 configuration was being priced from Series
   * 10 stock with nothing saying so.
   */
  const generationPinned =
    family.generationInToken === true ||
    (family.generation !== undefined && current !== undefined) ||
    // A chip names a generation; core counts do not. An M4 and an M5 both come
    // in 10-core CPU, 10-core GPU, so agreeing on cores proves the tier and
    // says nothing about the year. Every unit must state its chip, too —
    // `processorsAgree` lets a silent title through.
    (processor.chip !== undefined &&
      matches.every((l) => processorInTitle(l.title).chip !== undefined))
  if (!generationPinned && !unpinned.includes(labelFor('dimensionRelYear'))) {
    unpinned.push(labelFor('refurbClearModel'))
  }

  /** Specs a unit carries at a value other than the one asked for. */
  const differs = new Set<string>()
  for (const listing of matches) {
    for (const spec of wanted) {
      const key = carriedKey(spec, listing)
      if (key !== undefined && listing.dimensions[key] !== spec.value) differs.add(labelFor(key))
    }
  }
  const differsOn = [...differs]

  // Only a spec every unit carries *and agrees on* was checked. One that some
  // unit differs on was deliberately let through, and reporting it as checked
  // would turn the concession into a claim.
  const agreed = wanted.filter(
    (spec) =>
      matches.some((l) => carriedKey(spec, l) !== undefined) &&
      matches.every((l) => {
        const key = carriedKey(spec, l)
        return key === undefined || l.dimensions[key] === spec.value
      }),
  )
  const confirmed = agreed.filter((spec) => spec.keys.some((key) => PRICE_DRIVING.has(key)))

  const unconfirmed = wanted
    .filter((spec) => spec.keys.some((key) => PRICE_DRIVING.has(key)))
    .filter((spec) => matches.some((l) => carriedKey(spec, l) === undefined))
    .map((spec) => labelFor(spec.keys[0]))

  const matchedOn = agreed.map((spec) => labelFor(carriedKey(spec, matches[0]) ?? spec.keys[0]))
  if (processor.chip || processor.cpu) matchedOn.push('processor')

  return {
    listings: sorted,
    low: sorted[0].amount,
    high: sorted[sorted.length - 1].amount,
    currency: sorted[0].currency,
    matchedOn,
    varyingOn,
    unconfirmed,
    differsOn,
    basis: sameGeneration ? 'this-generation' : 'earlier-generation',
    // Every unit must carry and agree on each confirmed spec, and there must
    // be at least one -- otherwise nothing was verified.
    // An earlier generation is never the same machine, whatever else lines up.
    exact:
      sameGeneration &&
      unpinned.length === 0 &&
      confirmed.length > 0 &&
      confirmed.every((spec) => matches.every((l) => carriedKey(spec, l) !== undefined)),
    unpinned,
  }
}
