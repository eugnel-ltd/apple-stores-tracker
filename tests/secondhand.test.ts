import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseRefurbGrid } from '../src/scrape/refurb'
import {
  processorInTitle,
  processorOf,
  refurbCategoryFor,
  refurbStockFor,
  secondHandFor,
} from '../src/shared/secondhand'
import type { DimensionValue, Offer } from '../src/shared/types'

const html = readFileSync(new URL('./fixtures/apple-uk-refurb.html', import.meta.url), 'utf8')
const listings = parseRefurbGrid(html, 'mac', 'GBP', 'https://www.apple.com/uk/shop/refurbished/mac')

const offer = (familyId: string, dimensions: [string, string][]): Offer => ({
  marketId: 'uk',
  familyId,
  store: 'retail',
  configKey: dimensions.map(([f, v]) => `${f}=${v}`).join('|'),
  dimensions: dimensions.map(([field, value]): DimensionValue => ({ field, value, label: value })),
  amount: 0,
  currency: 'GBP',
  partNumber: null,
  sourceUrl: 'https://www.apple.com/uk/shop',
})

describe('parseRefurbGrid', () => {
  it('reads every unit Apple has, from one page', () => {
    expect(listings).toHaveLength(21)
    expect(listings[0]).toMatchObject({ partNumber: 'G1MLBB/A', amount: 2669, currency: 'GBP' })
  })

  /** A tile with no price or no part number is furniture, not a unit. */
  it('skips tiles that are not something you can buy', () => {
    expect(listings.map((l) => l.title)).not.toContain('Sold out placeholder')
    expect(listings.map((l) => l.title)).not.toContain('Refurbished thing with no price')
  })

  it('keeps the exact part number and a link to the unit', () => {
    expect(listings[0].sourceUrl).toMatch(/^https:\/\/www\.apple\.com\/uk\/shop\/product\//)
    expect(listings[0].sourceUrl).not.toContain('?')
  })
})

describe('an empty grid', () => {
  const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`

  /**
   * Apple ships the page with no bootstrap when a category is sold out — its
   * UK refurbished Macs were, the day this shipped. Reporting that as a failed
   * read would carry the last units forward for ever, so a sold-out machine
   * would keep its price on the page long after Apple stopped having one.
   */
  it('reads a sold-out category as empty, not as a failure', () => {
    const sold = page('<div class="rf-refurb-category">currently unavailable</div>')
    expect(parseRefurbGrid(sold, 'mac', 'GBP', 'https://example.com')).toEqual([])
  })

  /** A page that is not the grid at all still has to fail loudly. */
  it('refuses a page that is not a refurbished grid', () => {
    expect(() => parseRefurbGrid(page('<h1>Something else</h1>'), 'mac', 'GBP', 'x')).toThrow(
      'not a refurbished mac grid',
    )
  })
})

describe('processor identity', () => {
  it('reads the chip and cores out of a listing title', () => {
    expect(processorInTitle(listings[0].title)).toEqual({ chip: 'm5pro', cpu: 15, gpu: 16 })
    expect(processorInTitle('iPad Pro 11-inch (M4) Wi-Fi 256GB — Space Black')).toEqual({ chip: 'm4' })
    expect(processorInTitle('Refurbished 24-inch iMac Apple M4 Chip with 8-Core CPU and 8-Core GPU – Silver'))
      .toEqual({ chip: 'm4', cpu: 8, gpu: 8 })
  })

  it('reads it out of a configuration, however Apple spelt it', () => {
    expect(processorOf(offer('mac-mini', [['processor-dimensionChip-cpuCoreCount-gpuCoreCount', 'm6-12-12']])))
      .toEqual({ chip: 'm6', cpu: 12, gpu: 12 })
    expect(processorOf(offer('macbook-air', [['processor-cpuCoreCount-gpuCoreCount', '10-10']])))
      .toEqual({ cpu: 10, gpu: 10 })
  })
})

/** The two questions the page asks, named for readability below. */
const current = (o: Offer) => secondHandFor(o, listings).thisGeneration
const previous = (o: Offer) => secondHandFor(o, listings).earlierGeneration

describe('secondHandFor', () => {
  /**
   * The one shape that can be like-for-like. Apple's iPhone grid puts the
   * generation in the model token itself and carries no release-year facet, so
   * a configuration that pins capacity has pinned everything that moves the
   * price.
   */
  it('calls a match exact when the configuration pins every spec the units carry', () => {
    const phone = offer('iphone-16', [['dimensionCapacity', '128gb']])
    const match = current(phone)!

    expect(match.listings).toHaveLength(2)
    expect([match.low, match.high]).toEqual([589, 589])
    expect(match.exact).toBe(true)
    expect(match.unpinned).toEqual([])
    expect(match.varyingOn).toEqual(['colour'])
  })

  /**
   * An iPad Air configuration names no chip — Apple's buy page does not sell
   * one — so the table declares the generation instead. Apple sells the M4;
   * the M3s on the shelf are therefore the model before it, and calling them
   * current is the error this declaration removes.
   */
  it('does not pass an older iPad Air off as the one on sale', () => {
    const air = offer('ipad-air', [
      ['dimensionScreensize', '11inch'],
      ['dimensionCapacity', '128gb'],
      ['dimensionConnection', 'wifi'],
    ])
    const { thisGeneration, earlierGeneration } = secondHandFor(air, listings)

    expect(thisGeneration).toBeNull()
    expect(earlierGeneration!.listings).toHaveLength(2)
    expect(earlierGeneration!.basis).toBe('earlier-generation')
    expect(earlierGeneration!.exact).toBe(false)
  })

  /**
   * The trap this classification exists for. Apple's Mac select pages do not
   * carry storage or memory, so a 13-inch M5 Air configuration would otherwise
   * match a refurbished 4TB one -- which costs a thousand pounds more than the
   * new machine it would be quoted against.
   */
  it('refuses to call a match exact when the units pin a spec the configuration does not', () => {
    const air = offer('macbook-air', [
      ['chassis-dimensionScreensize', '13inch'],
      ['processor-cpuCoreCount-gpuCoreCount', '10-10'],
    ])
    const match = current(air)!

    expect(match.exact).toBe(false)
    expect(match.unpinned).toEqual(['storage', 'release year', 'memory'])
    expect(match.unconfirmed).toEqual([])
    expect(match.listings[0].amount).toBe(2629)
  })

  /** An M5 Pro 15/16 and an M5 Pro 18/20 are not the same machine. */
  it('separates chip tiers the grid facets cannot tell apart', () => {
    const pro = (cores: string) =>
      current(offer('macbook-pro', [
          ['chassis-dimensionScreensize', '14inch'],
          ['processor-dimensionChip-cpuCoreCount-gpuCoreCount', cores],
        ]))!

    expect(pro('m5pro-15-16').listings.map((l) => l.amount)).toEqual([2669])
    expect(pro('m5pro-18-20').listings.map((l) => l.amount)).toEqual([2849])
  })

  it('reports nothing rather than a near miss when Apple has no such unit', () => {
    const mini = offer('mac-mini', [
      ['processor-dimensionChip-cpuCoreCount-gpuCoreCount', 'm6-12-12'],
      ['memory-dimensionMemory', '16gb'],
      ['storage-dimensionCapacity', '256gb'],
    ])
    expect(current(mini)).toBeNull()
  })

  it('has nothing to say about a family Apple does not refurbish', () => {
    expect(current(offer('airpods-4', []))).toBeNull()
    expect(refurbCategoryFor('airpods-4')).toBeNull()
    expect(refurbCategoryFor('macbook-pro')).toBe('mac')
  })

  /**
   * Apple lists its TV with no facets at all, so nothing a configuration pins
   * can disagree with it. Absence of contradiction is not confirmation: the
   * one unit in stock is a 64GB box, and calling that "the same configuration"
   * as a new 128GB one would be the exact false claim this guards against.
   */
  it('will not call a match exact when the unit carries nothing to check', () => {
    const tv = offer('apple-tv-4k', [['dimensionConnection', 'wifiethernettv128gb']])
    const match = current(tv)!

    expect(match.listings).toHaveLength(1)
    expect(match.exact).toBe(false)
    expect(match.matchedOn).toEqual([])
    // And the reader is told which way the gap runs: not "the unit pins
    // something you did not", but "Apple never said, so nothing was checked".
    // `/^appletv/` names no generation, so that is unpinned as well.
    expect(match.unpinned).toEqual(['generation'])
    expect(match.unconfirmed).toEqual(['connectivity'])
  })

  /**
   * Apple's watch model token is `watchseries11`, not `applewatch`. An earlier
   * spelling matched nothing, so every watch reported no stock at all — a
   * confident claim, made from a grid that had forty-one units in it.
   */
  it('matches a watch on case size and connection', () => {
    const watch = (size: string, connection: string) =>
      current(offer('apple-watch', [
          ['watch_cases-dimensionCaseSize', size],
          ['watch_cases-dimensionConnection', connection],
        ]))

    expect(watch('46mm', 'gps')!.listings.map((l) => l.amount)).toEqual([339])
    expect(watch('42mm', 'gps')!.listings.map((l) => l.amount)).toEqual([309])
    // A GPS configuration must never be priced from a cellular unit.
    expect(watch('46mm', 'gpscell')).toBeNull()
  })

  /** `watchse` is a prefix of `watchseries`, so the SE needs its digit. */
  it('keeps the Watch SE and the Watch Series apart', () => {
    const se = current(offer('apple-watch-se', [
        ['watch_cases-dimensionCaseSize', '44mm'],
        ['watch_cases-dimensionConnection', 'gps'],
      ]))!
    expect(se.listings.map((l) => l.model)).toEqual(['watchse3'])
    // Aluminium or titanium changes the price and our configurations do not
    // say which, so a watch is never quoted as the same machine. The
    // generation no longer appears here: the table declares it, so the search
    // matched on it rather than warning that it could not.
    expect(se.exact).toBe(false)
    expect(se.unpinned).toEqual(['case material'])
  })

  /**
   * Apple discontinues a model the day it announces its replacement, so the
   * refurbished store routinely holds nothing at all for what is currently on
   * sale. An earlier generation at the same specification is the useful answer
   * — provided the page says that is what it is.
   */
  /**
   * A machine on sale now has barely been resold, so the model it replaced is
   * usually the only one that exists used. Apple has no refurbished iPhone 17.
   */
  it('offers the generation before, and says which it is', () => {
    const seventeen = offer('iphone-17', [['dimensionCapacity', '128gb']])
    const { thisGeneration, earlierGeneration } = secondHandFor(seventeen, listings)

    expect(thisGeneration).toBeNull()
    expect(earlierGeneration!.basis).toBe('earlier-generation')
    expect(earlierGeneration!.exact).toBe(false)
  })

  /**
   * "The generation before" is the one immediately before, not everything
   * older. Two generations sit behind an iPhone 17 in the grid — 16s and a 15 —
   * and returning both would put two different machines behind one price range.
   *
   * Stated as its own case because the coverage was previously incidental to
   * the test above, where a fixture tidy-up could have removed it silently.
   */
  it('narrows to the nearest generation when several are older', () => {
    const models = (familyId: string) =>
      secondHandFor(offer(familyId, [['dimensionCapacity', '128gb']]), listings)
        .earlierGeneration!.listings.map((l) => l.model)

    // Everything older than an iPhone 17 is in stock; only the 16s come back.
    expect(new Set(models('iphone-17'))).toEqual(new Set(['iphone16']))
    // And one step down the same ladder returns the 15, not nothing.
    expect(new Set(models('iphone-16'))).toEqual(new Set(['iphone15']))
  })

  /** It must never reach forward, only back. */
  it('will not offer a later generation as the earlier one', () => {
    const fifteen = offer('iphone-15', [['dimensionCapacity', '128gb']])
    const { thisGeneration, earlierGeneration } = secondHandFor(fifteen, listings)

    expect(thisGeneration!.listings.every((l) => l.model === 'iphone15')).toBe(true)
    expect(earlierGeneration).toBeNull()
    expect(thisGeneration!.listings.some((l) => l.model.includes('iphone16'))).toBe(false)
  })

  it('matches a newly numbered iPhone without a hardcoded generation row', () => {
    const eighteen = offer('iphone-18', [['dimensionCapacity', '128gb']])
    const { thisGeneration, earlierGeneration } = secondHandFor(eighteen, listings)

    expect(thisGeneration).toBeNull()
    expect(new Set(earlierGeneration!.listings.map((l) => l.model))).toEqual(new Set(['iphone16']))
  })

  it.each(['iphone-18.*', 'iphone-18-pro|iphone16', 'iphone-18e$', 'iphone-18[0-9]'])(
    'rejects regex syntax in the family id %s',
    (familyId) => {
      expect(refurbCategoryFor(familyId)).toBeNull()
      expect(refurbStockFor(familyId, listings)).toBe(0)
      const result = secondHandFor(offer(familyId, [['dimensionCapacity', '128gb']]), listings)
      expect(result.thisGeneration).toBeNull()
      expect(result.earlierGeneration).toBeNull()
    },
  )

  it('derives a Pro suffix from the family id the same way', () => {
    const pro = {
      partNumber: 'X17PRO/A',
      title: 'Refurbished iPhone 17 Pro 128GB - Black (SIM Free)',
      model: 'iphone17pro',
      category: 'iphone' as const,
      dimensions: { refurbClearModel: 'iphone17pro', dimensionCapacity: '128gb' },
      amount: 899,
      currency: 'GBP',
      sourceUrl: 'https://www.apple.com/uk/shop/product/x17pro/a',
    }
    const eighteenPro = offer('iphone-18-pro', [['dimensionCapacity', '128gb']])
    const { thisGeneration, earlierGeneration } = secondHandFor(eighteenPro, [...listings, pro])

    expect(thisGeneration).toBeNull()
    expect(earlierGeneration!.listings.map((l) => l.model)).toEqual(['iphone17pro'])
  })

  /**
   * Apple's buy-flow id is `iphone-17e`, not `iphone-17-e`. A pattern that
   * only admits a hyphenated suffix would drop this family from the grid and
   * the page would claim Apple does not refurbish it.
   */
  it('matches an unhyphenated e-suffix iPhone as a refurbished family', () => {
    expect(refurbCategoryFor('iphone-17e')).toBe('iphone')

    const sixteenE = {
      partNumber: 'X16E/A',
      title: 'Refurbished iPhone 16e 128GB - Black (SIM Free)',
      model: 'iphone16e',
      category: 'iphone' as const,
      dimensions: { refurbClearModel: 'iphone16e', dimensionCapacity: '128gb' },
      amount: 399,
      currency: 'GBP',
      sourceUrl: 'https://www.apple.com/uk/shop/product/x16e/a',
    }
    const { thisGeneration, earlierGeneration } = secondHandFor(
      offer('iphone-17e', [['dimensionCapacity', '128gb']]),
      [...listings, sixteenE],
    )

    expect(thisGeneration).toBeNull()
    expect(earlierGeneration!.listings.map((l) => l.model)).toEqual(['iphone16e'])
    expect(earlierGeneration!.listings.some((l) => l.model === 'iphone16')).toBe(false)
  })

  /**
   * Both answers at once, which is the point of asking them separately: this
   * model used, and last year's used, so the reader can weigh one against the
   * other rather than being handed whichever happened to be in stock.
   */
  it('answers both questions when Apple has both', () => {
    const sixteen = offer('iphone-16', [['dimensionCapacity', '128gb']])
    const { thisGeneration, earlierGeneration } = secondHandFor(sixteen, listings)

    expect(thisGeneration!.basis).toBe('this-generation')
    expect(thisGeneration!.exact).toBe(true)
    expect(earlierGeneration!.listings.map((l) => l.model)).toEqual(['iphone15'])
  })

  /**
   * The case that prompted this: a Mac Studio on sale as an M5 Max, one M3
   * Ultra on the shelf, and nothing shown. Apple's refurbished stock is
   * whatever came back, so requiring the earlier generation to match storage
   * and memory exactly made the comparison a lottery — across the catalogue
   * only 33 of 306 configurations could win it. The unit is offered instead,
   * with the build it actually is.
   */
  it('offers an earlier generation at a nearby build, and names the difference', () => {
    const studio = offer('mac-studio', [
      ['processor-dimensionChip-cpuCoreCount-gpuCoreCount', 'm5max-18-40'],
      ['memory-dimensionMemory', '48gb'],
      ['storage-dimensionCapacity', '512gb'],
    ])
    const { thisGeneration, earlierGeneration } = secondHandFor(studio, listings)

    expect(thisGeneration).toBeNull()
    expect(earlierGeneration!.listings.map((l) => l.amount)).toEqual([5599])
    // Storage and memory are let through, so they are reported rather than
    // claimed -- this is a 96GB/1TB machine, not the 48GB/512GB one priced
    // beside it.
    expect(earlierGeneration!.differsOn).toEqual(['memory', 'storage'])
    expect(earlierGeneration!.matchedOn).not.toContain('storage')
    expect(earlierGeneration!.exact).toBe(false)
  })

  /**
   * Only the build-to-order axes bend. Apple sells the 11-inch and 13-inch
   * iPad Air as different products at different prices, so a 13-inch unit is
   * not an earlier 11-inch one however close the rest of it sits.
   */
  it('will not cross a product line to find an earlier generation', () => {
    // The M3s in stock are 11-inch. A 13-inch configuration is a different
    // product at a different price, so it is offered none of them -- even
    // though storage and connectivity would have matched.
    const air = offer('ipad-air', [
      ['dimensionScreensize', '13inch'],
      ['dimensionCapacity', '128gb'],
      ['dimensionConnection', 'wifi'],
    ])
    expect(previous(air)).toBeNull()
  })

  /**
   * A declared generation dates. Apple never refurbishes a machine newer than
   * the one it sells, so a newer unit on the shelf is proof the table has been
   * overtaken — and the shelf wins, rather than the current generation being
   * labelled the one before.
   */
  it('reads a declared generation as a floor, not a fact', () => {
    // The table declares the iPad Air at M4; the grid holds an M5. Apple does
    // not refurbish a machine newer than the one it sells, so that unit is
    // proof the declaration has been overtaken -- and it must be read as the
    // current one, not offered as the generation before itself.
    const air = offer('ipad-air', [
      ['dimensionScreensize', '13inch'],
      ['dimensionCapacity', '256gb'],
      ['dimensionConnection', 'wifi'],
    ])

    expect(current(air)!.listings.map((l) => l.amount)).toEqual([929])
    expect(previous(air)).toBeNull()
  })

  /**
   * Where a family declares how its generation is written, a unit that does
   * not state one proves nothing. Apple's older iPad Pro tiles name an ordinal
   * rather than a chip, and reading that silence as agreement is how an M2
   * machine came to be quoted as "this configuration, used" beside a new M5.
   */
  it('will not call a unit current when it states no generation', () => {
    const pro = offer('ipad-pro', [
      ['dimensionScreensize', '11inch'],
      ['dimensionCapacity', '256gb'],
      ['dimensionConnection', 'wifi'],
    ])

    expect(current(pro)).toBeNull()
    // Nor is it offered as the generation before: nothing says it is behind
    // the M5, only that it is not the M5.
    expect(previous(pro)).toBeNull()
  })

  /**
   * The two silences an empty panel has to tell apart. Apple had no
   * refurbished Mac mini of any generation the day this was written, while a
   * Mac Studio with nothing to show sits beside a unit that is merely a
   * different build — and only the second is worth going looking for.
   */
  it('separates having none of a model from having none that answer', () => {
    expect(refurbStockFor('mac-mini', listings)).toBe(0)
    expect(refurbStockFor('mac-studio', listings)).toBe(1)
    expect(refurbStockFor('airpods-4', listings)).toBe(0)
    // The whole line, not just the current generation: an iPhone 17 has none
    // of its own in stock and is still not a model Apple never refurbishes.
    expect(refurbStockFor('iphone-17', listings)).toBeGreaterThan(0)
  })

  /**
   * Widening is a fallback, not the rule. Apple has 128GB iPhone 16s, so a
   * 128GB iPhone 17 gets the build it asked for and a gap worth drawing; a
   * 256GB one gets the same units with the difference stated, rather than
   * being told there is nothing.
   */
  it('prefers the same build, and widens only when Apple has none of it', () => {
    const at = (capacity: string) => previous(offer('iphone-17', [['dimensionCapacity', capacity]]))!

    expect(at('128gb').differsOn).toEqual([])
    expect(at('128gb').matchedOn).toContain('storage')

    expect(at('256gb').differsOn).toEqual(['storage'])
    expect(at('256gb').matchedOn).not.toContain('storage')
    // Same units either way — the concession is what is claimed about them.
    expect(at('256gb').listings.map((l) => l.partNumber)).toEqual(
      at('128gb').listings.map((l) => l.partNumber),
    )
  })

  /**
   * The heading has to name a real generation. Apple has no 256GB iPhone 16
   * and does have a 256GB iPhone 15, so matching the build first and picking
   * the nearest generation afterwards offered the 15 as "the model Apple sold
   * before this one" — with the 16 sitting beside it on the same shelf.
   */
  it('names the generation before, not the nearest one that has your build', () => {
    const match = previous(offer('iphone-17', [['dimensionCapacity', '256gb']]))!

    expect(new Set(match.listings.map((l) => l.model))).toEqual(new Set(['iphone16']))
    expect(match.differsOn).toEqual(['storage'])
  })

  /** The same unit can never appear under both headings. */
  it('never returns a unit under both generations', () => {
    const sixteen = offer('iphone-16', [['dimensionCapacity', '128gb']])
    const { thisGeneration, earlierGeneration } = secondHandFor(sixteen, listings)
    const here = new Set(thisGeneration!.listings.map((l) => l.partNumber))

    expect(earlierGeneration!.listings.some((l) => here.has(l.partNumber))).toBe(false)
  })

  /**
   * A Watch was the quiet case: `watchseries` matches every series Apple has
   * refurbished and our family id is just `apple-watch`, so a Series 11
   * configuration was priced from whatever series was in stock and the page
   * could only warn that it had not checked. The declared generation settles
   * it — the Series 10 unit is the generation before, and never this one.
   */
  it('does not price a Series 11 from Series 10 stock', () => {
    const watch = offer('apple-watch', [
      ['watch_cases-dimensionCaseSize', '42mm'],
      ['watch_cases-dimensionConnection', 'gpscell'],
    ])
    const { thisGeneration, earlierGeneration } = secondHandFor(watch, listings)

    // Apple has no cellular Series 11 in this size; the Series 10 it does have
    // is offered under its own heading rather than as the current one.
    expect(thisGeneration).toBeNull()
    expect(earlierGeneration!.listings.map((l) => l.model)).toEqual(['watchseries10'])
  })

  /**
   * Whether a token names a generation is declared, not read off the pattern.
   * `/^ipad(?:\d{4})?$/` contains the digit 4 in its `{4}` quantifier, and an
   * earlier version tested the pattern text — so the base iPad, the one family
   * with no chip in its configuration and nothing else to pin a generation,
   * was the family reported as having one pinned.
   *
   * Apple's own base-iPad tiles happen to publish a release year, which masked
   * it. The second unit here is that tile without the year: the shape the bug
   * needed, and one Apple ships elsewhere in the same grid.
   */
  it('does not read a generation out of a quantifier', () => {
    const base = offer('ipad', [
      ['dimensionCapacity', '64gb'],
      ['dimensionConnection', 'wifi'],
    ])
    const match = current(base)!

    expect(match.listings).toHaveLength(2)
    expect(match.exact).toBe(false)
    expect(match.unpinned).toContain('release year')
  })

  /**
   * Core counts identify a tier within a generation, not the generation: an M4
   * and an M5 both come in 10-core CPU, 10-core GPU.
   */
  it('does not treat matching core counts as a pinned generation', () => {
    const air = offer('macbook-air', [
      ['chassis-dimensionScreensize', '13inch'],
      ['processor-cpuCoreCount-gpuCoreCount', '10-10'],
    ])
    expect(current(air)!.exact).toBe(false)
  })

  /** Colour never moves the new price, so it must not hide a cheaper unit. */
  it('ignores colour, and says that the units vary by it', () => {
    const imac = offer('imac', [['chassis-dimensionColor', 'orange'], ['processor-cpuCoreCount-gpuCoreCount', '8-8']])
    const match = current(imac)!

    expect(match.listings).toHaveLength(2)
    expect(match.varyingOn).toContain('colour')
  })
})
