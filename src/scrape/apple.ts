import type { DimensionValue, FamilyStructure, Offer } from '../shared/types'
import { storeUrl, type Market, type Store } from '../shared/markets'
import { FAMILIES, type Family } from '../shared/families'
// Lives in shared so the browser can rebuild it without pulling in the scraper.
import { configKeyOf } from '../shared/offers'

export { configKeyOf }

/**
 * Apple names products beyond what a slug can express, including branded
 * capitalisation and words omitted from the route. Both selector kinds carry
 * that name in the title, with or without the shop's leading "Buy".
 */
export function parseFamilyName(html: string): string | undefined {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]
  if (title === undefined) return undefined
  const entities: Record<string, string> = {
    amp: '&', AMP: '&', quot: '"', QUOT: '"', apos: "'", lt: '<', LT: '<', gt: '>', GT: '>', nbsp: ' ',
    ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
    hellip: '…', reg: '®', trade: '™', copy: '©', eacute: 'é', Eacute: 'É', egrave: 'è', Egrave: 'È',
    pound: '£', euro: '€', yen: '¥', middot: '·',
  }
  const name = title
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (!code.startsWith('#')) return Object.hasOwn(entities, code) ? entities[code] : entity
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : '�'
    })
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^Buy\s+/i, '')
    .replace(/\s*- Apple(?:\s*\([^)]*\))?$/i, '')
    .trim()
  return name || undefined
}

/**
 * Apple's store pages embed a JS object literal:
 *
 *   window.PRODUCT_SELECTION_BOOTSTRAP = { productSelectionData: { …JSON… } }
 *
 * The outer literal has unquoted keys so it is not JSON, but the value of
 * `productSelectionData` is. Brace-match from the key to pull it out.
 */
export function extractJsonAfter(html: string, anchor: string): unknown {
  const at = html.indexOf(anchor)
  if (at < 0) throw new Error(`anchor not found: ${anchor}`)
  const start = html.indexOf('{', at)
  if (start < 0) throw new Error(`no object after: ${anchor}`)

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return JSON.parse(html.slice(start, i + 1))
  }
  throw new Error(`unterminated object after: ${anchor}`)
}

/**
 * Apple wraps option labels in markup: a headline, then a `form-label-small`
 * block of marketing copy and footnote markers. Only the headline is a name.
 */
function cleanLabel(header: string | undefined, fallback: string): string {
  if (!header) return fallback
  const text = header
    .replace(/<(div|span)[^>]*class="[^"]*(form-label-small|as-subheading)[^"]*"[\s\S]*$/, '')
    .replace(/<as-footnote[\s\S]*?<\/as-footnote>/g, '')
    // Superscripts in an option label are always footnote markers, and
    // `visuallyhidden` text is for screen readers reading those markers.
    .replace(/<sup[\s\S]*?<\/sup>/g, '')
    .replace(/<span[^>]*class="[^"]*visuallyhidden[^"]*"[\s\S]*?<\/span>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return text || fallback
}

/**
 * Options priced like a hardware choice that are not the machine.
 *
 * Bundled software (Logic Pro, Final Cut Pro) quadruples every Mac's matrix
 * while comparing app licences. The power adapter and the keyboard arrived
 * with the grouped sections below and are the same shape of thing: Apple
 * charges for a 140W brick and for a keyboard with a numeric keypad, but
 * someone comparing a MacBook Pro across fifteen countries is comparing
 * laptops, not chargers, and each would multiply every Mac's matrix again.
 *
 * The iMac's mouse-or-trackpad is the same argument and goes with them, which
 * does drop a dimension the site used to show. Keeping it would have left the
 * iMac naming an input device that no other family names, and it doubled that
 * family's matrix on its own.
 */
// Anchored per alternative rather than as a whole: Apple names the software
// fields `software_final-preInstalledSoftware`, so that one matches at the end
// while the accessories match at the start. Anchoring the lot with one `^`
// would quietly let Logic Pro and Final Cut Pro back in as dimensions.
const EXCLUDED_DIMENSIONS = /preInstalledSoftware$|^power_adapter-|^keyboard-|^mouse_and_track_pad-/

export const isExcludedDimension = (field: string): boolean => EXCLUDED_DIMENSIONS.test(field)

/** A configurable option, or a group whose `items` hold the real ones. */
interface CtoSection {
  formFieldName: string
  header?: string
  selectorLabel?: string
  priceDelta?: boolean
  items?: CtoSection[]
}

interface CtoSelectionData {
  products: { btrOrFdPartNumber: string | null; priceKey: string; dimensions: Record<string, string> }[]
  mainSections: { formFieldName: string; header?: string; selectorLabel?: string }[]
  configSections: CtoSection[]
  mainDisplayValues: Record<string, any>
  configDisplayValues: Record<string, any>
}

interface CatalogSelectionData {
  /** One entry per stocked SKU, with its dimension values as direct fields. */
  products: Record<string, any>[]
  sections: { formFieldName: string; header?: string; selectorLabel?: string }[]
  displayValues: Record<string, any>
}

const isCto = (data: any): data is CtoSelectionData => Array.isArray(data?.configSections)

/**
 * Read a family's selector structure from its select-step page. Structure is
 * market-independent — only prices differ — so this runs against one market
 * and the result is reused for all of them.
 */
export function parseFamilyStructure(html: string, family: Family): FamilyStructure {
  const data = extractJsonAfter(html, 'productSelectionData:')
  return isCto(data)
    ? parseCtoStructure(html, family, data)
    : parseCatalogStructure(family, data as CatalogSelectionData)
}

/**
 * Name one chip/model variant.
 *
 * The base variant of a family carries no `header` of its own — Apple prints
 * its specification in the parent chip's `dynamicFooter` instead, since the
 * chip tile already names it. Fall through to that before giving up and
 * showing a raw id like `m6-12-12`.
 */
function variantLabel(mainDisplayValues: Record<string, any>, field: string, value: string): string {
  const entry = mainDisplayValues[field]?.[value]
  if (entry?.header) return cleanLabel(entry.header, value)

  // Siblings are named "15-core CPU, 16-core GPU"; build the same shape for
  // the base variant so one family's options read consistently.
  const parts = entry?.dimensionComponents
  if (parts?.cpuCoreCount && parts?.gpuCoreCount) {
    return `${parts.cpuCoreCount}-core CPU, ${parts.gpuCoreCount}-core GPU`
  }

  for (const group of Object.values(mainDisplayValues) as any[]) {
    for (const entry of Object.values(group ?? {}) as any[]) {
      const footer = entry?.dynamicFooter?.[value]
      if (typeof footer === 'string' && footer.trim()) return cleanLabel(footer, value)
    }
  }
  return value
}

function parseCtoStructure(html: string, family: Family, data: CtoSelectionData): FamilyStructure {
  const collection = html.match(/update-config\?collection=([A-Z0-9_]+)/)?.[1]
  if (!collection) throw new Error(`no CTO collection id on ${family.id} page`)

  // Each entry in `products` is one chip/model variant, and each needs its own
  // pricing request because Apple quotes option deltas relative to a variant.
  const variants: DimensionValue[][] = data.products.map((product) =>
    Object.entries(product.dimensions).map(([field, value]) => ({
      field,
      value,
      label: variantLabel(data.mainDisplayValues, field, value),
    })),
  )

  // Apple ships an option either at the top level or one deep inside a group.
  // The Mac mini and Mac Studio list memory and storage directly; every laptop
  // and the iMac put the same two sections inside a collapsed
  // `customizableSpecs` group, which carries no values of its own. Reading only
  // the top level dropped storage and memory for every family that groups them,
  // so a MacBook Pro was priced at its base build with no way to choose either.
  const sections = data.configSections.flatMap((section) =>
    section.items && section.items.length > 0 ? section.items : [section],
  )

  const dimensions = sections
    .filter((section) => section.priceDelta && !EXCLUDED_DIMENSIONS.test(section.formFieldName))
    .flatMap((section) => {
      const values = data.configDisplayValues[section.formFieldName]
      if (!values) return []
      const order: string[] = values.variantOrder ?? Object.keys(values).filter((k) => k !== 'variantOrder')
      return [
        {
          field: section.formFieldName,
          label: cleanLabel(section.selectorLabel ?? section.header, section.formFieldName),
          values: order.map((value) => ({
            field: section.formFieldName,
            value,
            label: cleanLabel(values[value]?.header, value),
          })),
        },
      ]
    })

  return { familyId: family.id, kind: 'cto', collection, variants, dimensions }
}

/** Apple states the amount under a different key in each selector variant. */
function priceAmount(entry: any): number | undefined {
  for (const value of [entry?.amount, entry?.amountBeforeTradeIn, entry?.seoPrice]) {
    if (typeof value === 'number') return value
  }
  const raw = Number(entry?.currentPrice?.raw_amount)
  return Number.isFinite(raw) ? raw : undefined
}

const partOf = (product: Record<string, any>): string | undefined =>
  typeof product.partNumber === 'string' ? product.partNumber : undefined

/**
 * Resolve a SKU's price.
 *
 * Catalogue pages come in several shapes: a product may name its price entry
 * directly (`price`, `priceKey`, `fullPrice`), or the entry may claim a set of
 * parts through `validProducts` — Apple groups the colours of one build under
 * a single price that way.
 */
function catalogPriceResolver(
  data: CatalogSelectionData,
): (product: Record<string, any>) => number | undefined {
  const prices: Record<string, any> = data.displayValues?.prices ?? {}

  // The same part number is priced once per US carrier, so the by-part
  // fallback below has to ignore the contract lines or a SIM-free SKU whose
  // own price key is missing would quietly take the carrier's cheaper price.
  const simFree: string = data.displayValues?.carrierPolicyType?.UNLOCKED?.products
  const isContractPrice = (entry: any) =>
    typeof entry?.carrierProduct === 'string' && entry.carrierProduct !== simFree

  const byPart = new Map<string, number>()
  for (const entry of Object.values(prices)) {
    const amount = priceAmount(entry)
    if (amount === undefined || isContractPrice(entry)) continue
    for (const part of entry?.validProducts ?? []) byPart.set(part, amount)
    if (typeof entry?.product === 'string' && !byPart.has(entry.product)) {
      byPart.set(entry.product, amount)
    }
  }

  return (product) => {
    const key = product.fullPrice ?? product.price ?? product.priceKey
    const direct = typeof key === 'string' ? priceAmount(prices[key]) : undefined
    if (direct !== undefined) return direct
    const part = partOf(product)
    return part ? byPart.get(part) : undefined
  }
}

/** Dimension values sit either in a nested object or directly on the product. */
const dimensionSource = (product: Record<string, any>): Record<string, any> =>
  product.dimensions && typeof product.dimensions === 'object' ? product.dimensions : product

/**
 * Price the machine, not the contract.
 *
 * The US store lists a cellular device once per carrier and once SIM-free —
 * an iPhone 17 is $799 on AT&T, T-Mobile or Verizon and $829 unlocked. Every
 * other market quotes only the SIM-free handset, so carrying the carrier lines
 * would key US offers on a step no other market has (which reads as "not sold"
 * on every US row) or price a US iPhone against a contract the £799 it is
 * compared with does not include. Apple labels the lines itself; keep the one
 * that is the bare machine, and everything with no carrier step at all.
 */
const isSimFree = (product: Record<string, any>): boolean =>
  typeof product.carrierPolicyType !== 'string' || product.carrierPolicyType === 'UNLOCKED'

/** The SKUs a market-independent comparison can use. */
const catalogProducts = (data: CatalogSelectionData): Record<string, any>[] =>
  data.products.filter(isSimFree)

/**
 * Drop dimensions that never move the price.
 *
 * Colour is the usual case — 21 iPhone SKUs are 7 hardware configurations in
 * three finishes — but the rule is written generally rather than as a colour
 * special case, because Apple has previously charged for finishes and may
 * again. Two SKUs differing in exactly one dimension at different prices make
 * that dimension price-relevant.
 *
 * "Differing in exactly one" has to ignore a field the other SKU does not
 * carry at all. The US store adds a carrier step that only cellular iPads
 * name, so a Wi-Fi SKU and its cellular twin disagree on two fields at once;
 * counting the absent carrier as a disagreement left no pair to compare, and
 * connectivity looked free. Every US iPad then collapsed onto its Wi-Fi twin
 * under a key no other market's Wi-Fi offer shared, which is why a US row read
 * "not sold" for an iPad Apple plainly sells.
 */
function priceRelevantFields(
  fields: string[],
  products: Record<string, any>[],
  priceOf: (product: Record<string, any>) => number | undefined,
): string[] {
  const priced = products
    .map((product) => ({ source: dimensionSource(product), price: priceOf(product) }))
    .filter((p): p is { source: Record<string, any>; price: number } => p.price !== undefined)

  const agreesElsewhere = (a: Record<string, any>, b: Record<string, any>, field: string) =>
    fields.every(
      (f) => f === field || a[f] === b[f] || a[f] === undefined || b[f] === undefined,
    )

  // ponytail: O(n²) over one family's SKUs — 96 on the largest iPad page.
  // Bucket by the fields both SKUs carry if a family ever gets big enough.
  return fields.filter((field) =>
    priced.some((a, i) =>
      priced.slice(i + 1).some(
        (b) =>
          a.price !== b.price &&
          typeof a.source[field] === 'string' &&
          typeof b.source[field] === 'string' &&
          a.source[field] !== b.source[field] &&
          agreesElsewhere(a.source, b.source, field),
      ),
    ),
  )
}

/**
 * What Apple calls one option on this market's page. Read from the page rather
 * than from a parsed structure, so a market keeps its own translations even
 * for a dimension its own prices would not have judged worth carrying.
 */
const catalogLabel = (data: CatalogSelectionData, field: string, value: string): string => {
  const entry = data.displayValues?.[field]?.[value]
  return cleanLabel(entry?.value ?? entry?.header, value)
}

function parseCatalogStructure(family: Family, data: CatalogSelectionData): FamilyStructure {
  const products = catalogProducts(data)
  const fields = data.sections.map((s) => s.formFieldName)
  const relevant = priceRelevantFields(fields, products, catalogPriceResolver(data))

  const dimensions = data.sections
    .filter((section) => relevant.includes(section.formFieldName))
    .map((section) => {
      const order = products
        .map((p) => dimensionSource(p)[section.formFieldName])
        .filter((v, i, all): v is string => typeof v === 'string' && all.indexOf(v) === i)
      return {
        field: section.formFieldName,
        label: cleanLabel(section.selectorLabel ?? section.header, section.formFieldName),
        values: order.map((value) => ({
          field: section.formFieldName,
          value,
          label: catalogLabel(data, section.formFieldName, value),
        })),
      }
    })

  return { familyId: family.id, kind: 'catalog', variants: [], dimensions }
}

/**
 * Price a catalogue family from its own select page. Unlike the CTO flow this
 * needs the page for the market being priced, because the prices live in it.
 *
 * What a configuration *is*, though, comes from the structure discovered once
 * for the whole catalogue rather than from this page. Reading the shape out of
 * each market's own prices is how a market comes to key the same machine
 * differently from the other fourteen and drop out of every comparison as
 * "not sold" -- the US carrier step did precisely that to every iPad, and any
 * market that charges for an option the rest give away would do it again.
 */
export function parseCatalogOffers(
  html: string,
  market: Market,
  family: Family,
  structure: FamilyStructure,
  store: Store = 'retail',
): Offer[] {
  const data = extractJsonAfter(html, 'productSelectionData:') as CatalogSelectionData
  if (isCto(data)) throw new Error(`${family.id} is a build-to-order family`)

  const priceOf = catalogPriceResolver(data)
  const fields = structure.dimensions.map((d) => d.field)

  const sourceUrl = storeUrl(market, family.route, store)
  const byConfig = new Map<string, Offer>()

  for (const product of catalogProducts(data)) {
    const amount = priceOf(product)
    if (amount === undefined) continue

    const source = dimensionSource(product)
    const dimensions: DimensionValue[] = fields
      .filter((field) => typeof source[field] === 'string')
      .map((field) => ({
        field,
        value: source[field],
        label: catalogLabel(data, field, source[field]),
      }))
    const configKey = configKeyOf(dimensions)

    // Several SKUs share one configuration -- the colours of a build, and any
    // option this market prices that the catalogue as a whole does not carry.
    // Where they disagree, quote the cheapest way to buy the machine here.
    const already = byConfig.get(configKey)
    if (already && already.amount <= amount) continue
    byConfig.set(configKey, {
      marketId: market.id,
      familyId: family.id,
      store,
      configKey,
      dimensions,
      amount,
      currency: market.currency,
      partNumber: partOf(product) ?? null,
      sourceUrl,
    })
  }

  return [...byConfig.values()]
}

/** Apple's CTO pricing endpoint. Public, cacheable, no session required. */
export function ctoUrl(
  market: Market,
  collection: string,
  selection: DimensionValue[],
  store: Store = 'retail',
): string {
  const params = new URLSearchParams({ collection, fae: 'true' })
  for (const { field, value } of selection) params.set(`sv.${field}`, value)
  return storeUrl(market, `/shop/api/cto/update-config?${params}`, store)
}

interface CtoResponse {
  body?: {
    options?: Record<string, { compatibleOptions?: Record<string, { priceDelta?: string | null; isBlocked?: boolean }> }>
    prices?: Record<string, { amount: number }>
    selectedKits?: { btrOrFdPartNumber?: string | null; priceData?: { amount?: number } }
  }
}

/** A priced variant: the base configuration plus every option's delta from it. */
export interface VariantPricing {
  base: number
  partNumber: string | null
  /** `deltas[field][value]` = amount to add to `base`. Blocked options are absent. */
  deltas: Record<string, Record<string, number>>
}

export function parseVariantPricing(response: CtoResponse): VariantPricing {
  const body = response.body
  const base = body?.selectedKits?.priceData?.amount
  if (typeof base !== 'number') throw new Error('no price in CTO response')

  const prices = body?.prices ?? {}
  const deltas: Record<string, Record<string, number>> = {}
  for (const [field, option] of Object.entries(body?.options ?? {})) {
    const byValue: Record<string, number> = {}
    for (const [value, info] of Object.entries(option.compatibleOptions ?? {})) {
      if (info.isBlocked) continue
      // `priceDelta` is a key into `prices`; a null delta means "no charge".
      const amount = info.priceDelta ? prices[info.priceDelta]?.amount : 0
      if (typeof amount === 'number') byValue[value] = amount
    }
    if (Object.keys(byValue).length) deltas[field] = byValue
  }

  return { base, partNumber: body?.selectedKits?.btrOrFdPartNumber ?? null, deltas }
}


/**
 * Expand one priced variant into every configuration it can reach.
 *
 * Apple quotes each option's delta relative to the currently selected build,
 * and those deltas are additive: with 16GB selected, 24GB reads +200; select
 * 24GB and the base rises by exactly 200 while the storage deltas stay put.
 * So `price(config) = base + Σ delta`, and one request covers the whole matrix.
 */
export function expandVariant(
  market: Market,
  family: Family,
  structure: FamilyStructure,
  variant: DimensionValue[],
  pricing: VariantPricing,
  store: Store = 'retail',
): Offer[] {
  const priced = structure.dimensions
    .map((dimension) => {
      const available = pricing.deltas[dimension.field]
      if (!available) return []
      return dimension.values.filter((v) => v.value in available)
    })
    .filter((values) => values.length > 0)

  let combinations: DimensionValue[][] = [[]]
  for (const values of priced) {
    combinations = combinations.flatMap((combo) => values.map((value) => [...combo, value]))
  }

  const sourceUrl = storeUrl(market, family.route, store)
  return combinations.map((combo) => {
    const amount = combo.reduce((sum, v) => sum + pricing.deltas[v.field][v.value], pricing.base)
    const dimensions = [...variant, ...combo]
    return {
      marketId: market.id,
      familyId: family.id,
      store,
      configKey: configKeyOf(dimensions),
      dimensions,
      amount,
      currency: market.currency,
      // Only the untouched base build has a stocked part number.
      partNumber: combo.every((v) => pricing.deltas[v.field][v.value] === 0) ? pricing.partNumber : null,
      sourceUrl,
    }
  })
}

export const familyById = (id: string): Family | undefined => FAMILIES.find((f) => f.id === id)
