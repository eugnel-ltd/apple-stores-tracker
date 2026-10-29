import { describe, expect, it } from 'vitest'
import { diminishedBy, KEPT_AT_LEAST, KEPT_AT_LEAST_OVERALL, reshapedFamilies } from '../src/shared/publish-guard'
import type { StoredOffer } from '../src/shared/offers'

/** Distinct machines at distinct prices, so nothing collapses on the way in. */
const offers = (n: number, familyId = 'mac-mini'): StoredOffer[] =>
  Array.from(
    { length: n },
    (_, i) =>
      ({
        marketId: 'uk',
        familyId,
        store: 'retail',
        dimensions: [{ field: 'storage-dimensionCapacity', value: `${i}gb`, label: `${i}GB` }],
        amount: 1000 + i,
        currency: 'GBP',
        partNumber: null,
      }) as StoredOffer,
  )

/** The same machines, listed once per finish at one price, as Apple lists them. */
const inEveryFinish = (n: number, finishes: string[]): StoredOffer[] =>
  offers(n).flatMap((offer) =>
    finishes.map(
      (finish) =>
        ({
          ...offer,
          dimensions: [
            ...offer.dimensions,
            { field: 'chassis-dimensionColor', value: finish, label: finish },
          ],
        }) as StoredOffer,
    ),
  )
const MARKETS = ['uk', 'us', 'de']
const before = { markets: MARKETS, offers: offers(22442) }

/**
 * Publishing replaces the whole snapshot rather than merging into it, so a
 * collection that failed halfway is indistinguishable from a catalogue that
 * shrank -- and it would be published over a good one while every check still
 * reported success. This is the only thing standing between a bad afternoon at
 * Apple and a site that quietly says half its markets sell nothing.
 */
describe('refusing a diminished collection', () => {
  it('passes a healthy run through', () => {
    expect(diminishedBy(before, { markets: MARKETS, offers: offers(22450) })).toEqual([])
  })

  it('passes a small honest shrinkage', () => {
    // Apple does withdraw products; the gate is for collapses, not drift.
    expect(diminishedBy(before, { markets: MARKETS, offers: offers(21500) })).toEqual([])
  })

  it('refuses a collection that lost most of the catalogue', () => {
    const [complaint] = diminishedBy(before, { markets: MARKETS, offers: offers(9000) })
    expect(complaint).toContain('22442')
    expect(complaint).toContain('9000')
  })

  it('refuses when a whole market failed, however many offers came back', () => {
    // The count can stay healthy while one market is entirely absent.
    const complaints = diminishedBy(before, { markets: ['uk', 'us'], offers: offers(22400) })
    expect(complaints).toHaveLength(1)
    expect(complaints[0]).toContain('de')
  })

  it('names both faults when both apply', () => {
    expect(diminishedBy(before, { markets: ['uk'], offers: offers(100) })).toHaveLength(2)
  })

  /**
   * A first run, or one after the snapshot was cleared, has nothing to be
   * diminished against and must still be able to publish.
   */
  it('has no complaint when nothing is published yet', () => {
    expect(diminishedBy(null, { markets: MARKETS, offers: offers(1) })).toEqual([])
    expect(diminishedBy({ offers: [] }, { markets: MARKETS, offers: offers(1) })).toEqual([])
  })

  /**
   * The catalogue's shape can change deliberately. A finish every colour of
   * which costs the same stopped being carried, so a collection describing
   * exactly the same machines arrives a quarter the size -- and a guard
   * counting raw rows would read that as Apple withdrawing three quarters of
   * its range and refuse to publish, every day, until someone overrode it.
   */
  it('counts machines rather than rows, so a collapsed dimension is not a collapse', () => {
    const published = { markets: MARKETS, offers: inEveryFinish(100, ['silver', 'midnight', 'starlight', 'skyblue']) }
    expect(published.offers).toHaveLength(400)
    expect(diminishedBy(published, { markets: MARKETS, offers: offers(100) })).toEqual([])
  })

  it('still refuses when the machines themselves are gone', () => {
    const published = { markets: MARKETS, offers: inEveryFinish(100, ['silver', 'midnight']) }
    const [complaint] = diminishedBy(published, { markets: MARKETS, offers: offers(50) })
    expect(complaint).toContain('100')
    expect(complaint).toContain('50')
  })

  it('holds the threshold it documents', () => {
    const n = before.offers.length
    expect(diminishedBy(before, { markets: MARKETS, offers: offers(Math.ceil(n * KEPT_AT_LEAST)) })).toEqual([])
    expect(diminishedBy(before, { markets: MARKETS, offers: offers(Math.floor(n * KEPT_AT_LEAST) - 1) })).toHaveLength(1)
  })
})

describe('distinguishing a clean line-up change from failed collection', () => {
  const published = { markets: MARKETS, offers: [...offers(5788, 'imac'), ...offers(10862)] }
  const reshaped = { markets: MARKETS, offers: [...offers(1080, 'imac'), ...offers(10862)] }

  it('accepts the 28 October iMac replacement with 72% of the catalogue remaining', () => {
    expect(published.offers).toHaveLength(16650)
    expect(reshaped.offers).toHaveLength(11942)
    expect(diminishedBy(published, { ...reshaped, errors: [] })).toEqual([])
  })

  it('excludes the clean iMac change even when another family has errors', () => {
    expect(diminishedBy(published, { ...reshaped, errors: [{ familyId: 'mac-mini' }] })).toEqual([])
  })

  it('refuses the same shrink when even one market or store failed for that family', () => {
    const errors = [{ familyId: 'imac', marketId: 'us', store: 'education' }]
    const complaints = diminishedBy(published, { ...reshaped, errors })
    expect(complaints).toHaveLength(1)
    expect(complaints[0]).toContain('families with errors fell from 5788 to 1080')
  })

  it('keeps the old 90% rule when error reporting is unavailable', () => {
    expect(diminishedBy(published, reshaped)).toHaveLength(1)
  })

  it('refuses a throttled run across many families', () => {
    const families = ['imac', 'mac-mini', 'mac-studio']
    const before = { markets: MARKETS, offers: [...families.flatMap((id) => offers(100, id)), ...offers(200, 'iphone')] }
    const now = {
      markets: MARKETS,
      offers: [...families.flatMap((id) => offers(80, id)), ...offers(200, 'iphone')],
      errors: [...families.map((familyId) => ({ familyId })), { familyId: 'imac' }],
    }
    const complaints = diminishedBy(before, now)
    expect(complaints).toHaveLength(1)
    expect(complaints[0]).toContain('300 to 240 (80%)')
  })

  it('does not let clean growth hide missing offers from a failed family', () => {
    const before = { markets: MARKETS, offers: [...offers(100, 'imac'), ...offers(100)] }
    const now = { markets: MARKETS, offers: [...offers(80, 'imac'), ...offers(400)], errors: [{ familyId: 'imac' }] }
    expect(diminishedBy(before, now)).toHaveLength(1)
  })

  it('refuses a silent collapse below half the catalogue, but allows exactly half', () => {
    const before = { markets: MARKETS, offers: offers(100) }
    const half = before.offers.length * KEPT_AT_LEAST_OVERALL
    expect(diminishedBy(before, { markets: MARKETS, offers: offers(half - 1), errors: [] })).toHaveLength(1)
    expect(diminishedBy(before, { markets: MARKETS, offers: offers(half), errors: [] })).toEqual([])
  })

  it('accepts a retired family only when it has no collection errors', () => {
    const before = { markets: MARKETS, offers: [...offers(20, 'imac'), ...offers(80)] }
    const now = { markets: MARKETS, offers: offers(80) }
    expect(diminishedBy(before, { ...now, errors: [] })).toEqual([])
    expect(diminishedBy(before, { ...now, errors: [{ familyId: 'mac-mini' }] })).toEqual([])
    expect(diminishedBy(before, { ...now, errors: [{ familyId: 'imac' }] })).toHaveLength(1)
  })

  it('still refuses missing markets when every family reports a clean collection', () => {
    expect(diminishedBy(published, { ...reshaped, markets: ['uk', 'us'], errors: [] })).toEqual(['markets missing: de'])
  })

  it('collapses unpaid dimensions before either error-aware threshold is applied', () => {
    const before = { markets: MARKETS, offers: inEveryFinish(100, ['silver', 'midnight', 'starlight', 'skyblue']) }
    expect(diminishedBy(before, { markets: MARKETS, offers: offers(100), errors: [] })).toEqual([])
    expect(diminishedBy(before, { markets: MARKETS, offers: offers(90), errors: [{ familyId: 'mac-mini' }] })).toEqual([])
    expect(diminishedBy(before, { markets: MARKETS, offers: offers(89), errors: [{ familyId: 'mac-mini' }] })).toHaveLength(1)
  })
})

describe('logging families reshaped by Apple', () => {
  it('reports the old and new iMac counts', () => {
    expect(reshapedFamilies(
      { offers: offers(5788, 'imac') },
      { markets: MARKETS, offers: offers(1080, 'imac'), errors: [] },
    )).toEqual([{ familyId: 'imac', before: 5788, now: 1080 }])
  })

  it('includes clean growth, retirements and new families, excluding failed reads and drift', () => {
    const before = {
      offers: ['growth', 'retired', 'failed', 'small', 'ten-down', 'ten-up'].flatMap((id) => offers(100, id)),
    }
    const now = {
      markets: MARKETS,
      offers: [...offers(111, 'growth'), ...offers(20, 'failed'), ...offers(99, 'small'),
        ...offers(90, 'ten-down'), ...offers(110, 'ten-up'), ...offers(50, 'new')],
      errors: [{ familyId: 'failed' }],
    }
    expect(reshapedFamilies(before, now)).toEqual([
      { familyId: 'growth', before: 100, now: 111 },
      { familyId: 'retired', before: 100, now: 0 },
      { familyId: 'new', before: 0, now: 50 },
    ])
  })

  it('does not mistake duplicate finishes for a range change', () => {
    const before = { offers: inEveryFinish(100, ['silver', 'midnight']) }
    expect(reshapedFamilies(before, { markets: MARKETS, offers: offers(100), errors: [] })).toEqual([])
  })

  it('does not attribute changes to Apple without a baseline or error reporting', () => {
    const now = { markets: MARKETS, offers: offers(50), errors: [] }
    expect(reshapedFamilies(null, now)).toEqual([])
    expect(reshapedFamilies({ offers: [] }, now)).toEqual([])
    expect(reshapedFamilies({ offers: offers(100) }, { markets: MARKETS, offers: offers(50) })).toEqual([])
  })
})
