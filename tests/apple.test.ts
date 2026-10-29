import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  configKeyOf,
  ctoUrl,
  expandVariant,
  extractJsonAfter,
  isExcludedDimension,
  parseCatalogOffers,
  parseFamilyName,
  parseFamilyStructure,
  parseVariantPricing,
} from '../src/scrape/apple'
import { marketById } from '../src/shared/markets'
import { FAMILIES } from '../src/shared/families'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const uk = marketById('uk')!
const macMini = FAMILIES.find((f) => f.id === 'mac-mini')!
const selectPage = fixture('apple-uk-mac-mini-select.html')
const structure = parseFamilyStructure(selectPage, macMini)

describe('extractJsonAfter', () => {
  it('brace-matches past braces inside strings', () => {
    const html = 'x = {"a":"}{ not a brace","b":{"c":1}}'
    expect(extractJsonAfter(html, 'x =')).toEqual({ a: '}{ not a brace', b: { c: 1 } })
  })

  it('brace-matches past escaped quotes', () => {
    expect(extractJsonAfter('v: {"a":"say \\"}\\" now"}', 'v:')).toEqual({ a: 'say "}" now' })
  })

  it('throws rather than returning a partial object', () => {
    expect(() => extractJsonAfter('v: {"a":1', 'v:')).toThrow(/unterminated/)
    expect(() => extractJsonAfter('nothing here', 'v:')).toThrow(/anchor not found/)
  })
})

describe('parseFamilyStructure', () => {
  it('finds the CTO collection id', () => {
    expect(structure.collection).toBe('MAC_MINI_2026_COLLECTION')
  })

  it('lists one variant per chip build', () => {
    const chips = structure.variants.map(
      (v) => v.find((d) => d.field === 'processor-dimensionChip-cpuCoreCount-gpuCoreCount')?.value,
    )
    expect(chips.sort()).toEqual(['m5pro-15-16', 'm5pro-18-20', 'm6-12-12'])
  })

  it('keeps only the dimensions that carry a price', () => {
    expect(structure.dimensions.map((d) => d.field)).toContain('memory-dimensionMemory')
    expect(structure.dimensions.map((d) => d.field)).toContain('storage-dimensionCapacity')
  })

  it('strips Apple’s marketing markup from option labels', () => {
    const memory = structure.dimensions.find((d) => d.field === 'memory-dimensionMemory')!
    expect(memory.values.map((v) => v.label)).toEqual(['16GB', '24GB', '32GB', '48GB', '64GB'])
  })
})

describe('parseVariantPricing', () => {
  const pricing = parseVariantPricing(JSON.parse(fixture('cto-uk-mac-mini-m6.json')))

  it('reads the base price of the selected build', () => {
    expect(pricing.base).toBe(899)
    expect(pricing.partNumber).toBe('MHQK4B/A')
  })

  it('reads each option’s delta from the base', () => {
    expect(pricing.deltas['memory-dimensionMemory']).toEqual({ '16gb': 0, '24gb': 200, '32gb': 400 })
    expect(pricing.deltas['storage-dimensionCapacity']).toEqual({
      '256gb': 0,
      '512gb': 200,
      '1tb': 500,
      '2tb': 1000,
    })
  })

  it('throws when the response carries no price', () => {
    expect(() => parseVariantPricing({ body: {} })).toThrow(/no price/)
  })
})

describe('expandVariant', () => {
  const pricing = parseVariantPricing(JSON.parse(fixture('cto-uk-mac-mini-m6.json')))
  const m6 = structure.variants.find((v) =>
    v.some((d) => d.value === 'm6-12-12'),
  )!
  const offers = expandVariant(uk, macMini, structure, m6, pricing)

  /**
   * The spike's exit criterion, now a regression test: Apple UK quotes £1,299
   * for the M6 Mac mini with 24GB and 512GB, and we reach it by adding deltas
   * rather than by fetching that configuration.
   */
  it('marks which of Apple’s stores quoted the price', () => {
    expect(new Set(offers.map((o) => o.store))).toEqual(new Set(['retail']))
  })

  it('reproduces Apple UK’s price for M6 / 24GB / 512GB', () => {
    const offer = offers.find(
      (o) =>
        o.dimensions.some((d) => d.value === '24gb') &&
        o.dimensions.some((d) => d.value === '512gb') &&
        o.dimensions.some((d) => d.value === '2_5gb_per_second'),
    )
    expect(offer?.amount).toBe(1299)
    expect(offer?.currency).toBe('GBP')
  })

  it('leaves bundled software out of the hardware matrix', () => {
    expect(structure.dimensions.some((d) => /preInstalledSoftware/.test(d.field))).toBe(false)
    // 3 memory x 4 storage x 2 ethernet, and nothing else.
    expect(offers.length).toBe(24)
  })

  it('prices the untouched base build at the base amount', () => {
    const base = offers.filter((o) => o.amount === pricing.base)
    expect(base.length).toBe(1)
    expect(base[0].partNumber).toBe('MHQK4B/A')
  })

  it('gives upgraded builds no part number, since they are made to order', () => {
    expect(offers.filter((o) => o.amount !== pricing.base).every((o) => o.partNumber === null)).toBe(true)
  })

  it('covers the full option matrix exactly once', () => {
    const sizes = structure.dimensions
      .filter((d) => pricing.deltas[d.field])
      .map((d) => d.values.filter((v) => v.value in pricing.deltas[d.field]).length)
    expect(offers.length).toBe(sizes.reduce((a, b) => a * b, 1))
    expect(new Set(offers.map((o) => o.configKey)).size).toBe(offers.length)
  })

  it('omits options Apple does not offer with this chip', () => {
    // 48GB and 64GB need an M5 Pro, so they must not appear under M6.
    expect(offers.some((o) => o.dimensions.some((d) => d.value === '64gb'))).toBe(false)
  })
})

describe('configKeyOf', () => {
  it('is order-independent, so markets agree on the same configuration', () => {
    const a = [
      { field: 'memory-dimensionMemory', value: '24gb', label: '24GB' },
      { field: 'storage-dimensionCapacity', value: '512gb', label: '512GB' },
    ]
    expect(configKeyOf(a)).toBe(configKeyOf([...a].reverse()))
  })

  it('ignores labels, which are translated per market', () => {
    const en = [{ field: 'memory-dimensionMemory', value: '24gb', label: '24GB' }]
    const jp = [{ field: 'memory-dimensionMemory', value: '24gb', label: '24GB メモリ' }]
    expect(configKeyOf(en)).toBe(configKeyOf(jp))
  })
})

describe('ctoUrl', () => {
  it('builds the market-prefixed endpoint with sv. selectors', () => {
    const url = ctoUrl(uk, 'MAC_MINI_2026_COLLECTION', [
      { field: 'memory-dimensionMemory', value: '24gb', label: '24GB' },
    ])
    expect(url).toBe(
      'https://www.apple.com/uk/shop/api/cto/update-config?collection=MAC_MINI_2026_COLLECTION&fae=true&sv.memory-dimensionMemory=24gb',
    )
  })

  it('uses a bare path for the US store', () => {
    expect(ctoUrl(marketById('us')!, 'X', [])).toBe(
      'https://www.apple.com/shop/api/cto/update-config?collection=X&fae=true',
    )
  })

  it('points at the education store when asked, US prefix included', () => {
    expect(ctoUrl(uk, 'X', [], 'education')).toBe(
      'https://www.apple.com/uk-edu/shop/api/cto/update-config?collection=X&fae=true',
    )
    // The US retail store has no prefix, but its education store does.
    expect(ctoUrl(marketById('us')!, 'X', [], 'education')).toBe(
      'https://www.apple.com/us-edu/shop/api/cto/update-config?collection=X&fae=true',
    )
  })
})

/**
 * Apple ships a configurable option in one of two places, and only one of them
 * was being read. The Mac mini lists memory and storage as top-level
 * `STANDALONE` sections; every laptop and the iMac nest the same two inside a
 * collapsed `customizableSpecs` group that carries no values of its own. So a
 * MacBook Pro had no memory or storage at all — one offer per chip, at
 * whatever build Apple happened to preconfigure, and no way to price the 48GB
 * machine you were actually shopping for.
 */
describe('options nested inside a collapsed group', () => {
  const page = fixture('apple-uk-macbook-pro-select.html')
  const macBookPro = FAMILIES.find((f) => f.id === 'macbook-pro')!
  const grouped = parseFamilyStructure(page, macBookPro)

  it('reads memory and storage out of the group', () => {
    const fields = grouped.dimensions.map((d) => d.field)
    expect(fields).toContain('memory-dimensionMemory')
    expect(fields).toContain('storage-dimensionCapacity')
  })

  it('names them the way Apple does', () => {
    const memory = grouped.dimensions.find((d) => d.field === 'memory-dimensionMemory')!
    expect(memory.values.map((v) => v.value)).toContain('48gb')
    expect(memory.values.find((v) => v.value === '48gb')!.label).toMatch(/48\s*GB/i)
  })

  /**
   * The group also holds the charger and the keyboard. Both carry a real price
   * delta, and neither is the machine — including them would multiply every
   * Mac's matrix twice over to compare bricks and key layouts.
   */
  it('leaves the boxed accessories out', () => {
    const fields = grouped.dimensions.map((d) => d.field)
    expect(fields).not.toContain('power_adapter-wattage')
    expect(fields.some((f) => /keyboard-/.test(f))).toBe(false)
  })

  /** The group itself is not an option; only its contents are. */
  it('does not offer the group as a dimension of its own', () => {
    expect(grouped.dimensions.map((d) => d.field)).not.toContain('customizableSpecs')
  })
})

/**
 * The boxed accessories, as a class. Apple charges for a 140W brick, for a
 * keyboard with a numeric keypad and for a trackpad instead of a mouse, and
 * each is a real price delta on a real selector — but none of them is the
 * machine, and each multiplies its family's matrix. The iMac carries all
 * three: the charger and keyboard inside the collapsed group, and the pointing
 * device as a top-level section that was a dimension until keeping one of the
 * three became indefensible.
 */
describe('accessories priced like hardware', () => {
  const imac = FAMILIES.find((f) => f.id === 'imac')!
  const structure = parseFamilyStructure(fixture('apple-uk-imac-select.html'), imac)
  const fields = structure.dimensions.map((d) => d.field)

  it('leaves the iMac an iMac rather than an iMac and a mouse', () => {
    expect(fields).not.toContain('mouse_and_track_pad-pointingDeviceType')
    expect(fields).not.toContain('power_adapter-wattage')
    expect(fields.some((f) => /^keyboard-/.test(f))).toBe(false)
  })

  /** Everything that is the machine still has to come through. */
  it('keeps the specifications that are the machine', () => {
    expect(fields).toContain('memory-dimensionMemory')
    expect(fields).toContain('storage-dimensionCapacity')
    expect(fields).toContain('display-dimensionFinish')
    expect(fields).toContain('ethernet_adapter-ethernetPortCount')
  })
})

/**
 * Anchoring the exclusion rule as a whole would be wrong, and quietly so.
 * Apple names the accessory fields `power_adapter-wattage` but the software
 * ones `software_final-preInstalledSoftware` — a prefix and a suffix — so one
 * `^` across the alternation stops excluding bundled software and quadruples
 * every Mac's matrix with app licences.
 */
describe('the exclusion rule matches where Apple actually puts the name', () => {
  const cases: [string, boolean][] = [
    ['software_final-preInstalledSoftware', true],
    ['software_proappbundle-preInstalledSoftware', true],
    ['power_adapter-wattage', true],
    ['keyboard-keyboardFormFactor', true],
    ['mouse_and_track_pad-pointingDeviceType', true],
    ['memory-dimensionMemory', false],
    ['storage-dimensionCapacity', false],
    ['display-dimensionFinish', false],
    ['ethernet_adapter-ethernetPortCount', false],
  ]

  it.each(cases)('%s excluded: %s', (field, excluded) => {
    expect(isExcludedDimension(field)).toBe(excluded)
  })
})

/**
 * The US store asks which carrier a cellular iPad is for, and only the
 * cellular SKUs carry that field — so a Wi-Fi SKU and its cellular twin
 * disagreed on two fields at once. The relevance test grouped on all of them,
 * never compared a Wi-Fi price with a cellular one, and concluded connectivity
 * was free: all 96 SKUs collapsed onto 12 Wi-Fi configurations keyed without
 * `dimensionConnection`. No other market keys them that way, so every US row
 * on every iPad read "not sold" for a machine Apple sells in the US.
 */
describe('a market that adds a step only some SKUs answer', () => {
  const ipadPro = FAMILIES.find((f) => f.id === 'ipad-pro')!
  const us = marketById('us')!
  const page = fixture('apple-us-ipad-pro-select.html')
  const offers = parseCatalogOffers(page, us, ipadPro, parseFamilyStructure(page, ipadPro))

  it('keeps connectivity, which costs $200', () => {
    expect(offers.map((o) => `${o.configKey} ${o.amount}`)).toEqual([
      'dimensionCapacity=256gb|dimensionConnection=wifi 1199',
      'dimensionCapacity=512gb|dimensionConnection=wifi 1399',
      'dimensionCapacity=256gb|dimensionConnection=wificell 1399',
      'dimensionCapacity=512gb|dimensionConnection=wificell 1599',
    ])
  })

  /**
   * The carrier itself is not part of the machine: AT&T, Verizon and unlocked
   * are one iPad at one price. Keeping it would key US offers on a field no
   * other market has, which is the same "not sold" by another route.
   */
  it('leaves the carrier and the colour out of the key', () => {
    const fields = parseFamilyStructure(page, ipadPro).dimensions.map((d) => d.field)
    expect(fields).toEqual(['dimensionCapacity', 'dimensionConnection'])
  })
})

/**
 * The same market, one step further along. Apple's US store lists a cellular
 * device once per carrier and once SIM-free — an iPhone 17 is $799 on AT&T,
 * T-Mobile or Verizon and $829 unlocked — while every other market quotes only
 * the SIM-free handset. Carrying the carrier lines keyed US offers on a step
 * no other market has, so a US iPhone row read "not sold" too; taking their
 * price instead would compare a contract with the bare £799 machine.
 */
describe('a market that sells the same handset on contract', () => {
  const iphone = FAMILIES.find((f) => f.id === 'iphone-17')!
  const us = marketById('us')!
  const page = fixture('apple-us-iphone-17-select.html')

  it('quotes the SIM-free machine, keyed as every other market keys it', () => {
    const offers = parseCatalogOffers(page, us, iphone, parseFamilyStructure(page, iphone))
    expect(offers.map((o) => `${o.configKey} ${o.amount}`)).toEqual([
      'dimensionCapacity=256gb 829',
      'dimensionCapacity=512gb 1029',
    ])
  })

  it('does not offer the carrier as a specification', () => {
    expect(parseFamilyStructure(page, iphone).dimensions.map((d) => d.field)).toEqual([
      'dimensionCapacity',
    ])
  })
})

/**
 * The shape of a configuration is one shape for the whole catalogue, and this
 * is why. A market that charges for an option the other fourteen give away
 * would, left to read its own page, key the same machine on a dimension
 * nobody else carries -- and a key no other market produces is a market that
 * reads "not sold" in every comparison, which is exactly what the US carrier
 * step did to every iPad.
 */
describe('a market that prices an option the catalogue does not carry', () => {
  const iphone = FAMILIES.find((f) => f.id === 'iphone-17')!
  const catalogue = parseFamilyStructure(fixture('apple-uk-iphone-17-select.html'), iphone)

  // The same one build, in two finishes, one of which this market charges for.
  const page = `<script>window.PRODUCT_SELECTION_BOOTSTRAP = { productSelectionData: ${JSON.stringify({
    sections: [
      { formFieldName: 'dimensionColor', header: '<span>Finish. </span>' },
      { formFieldName: 'dimensionCapacity', header: '<span>Storage. </span>' },
    ],
    products: [
      { partNumber: 'MG6J4QN/A', fullPrice: 'black', dimensionColor: 'black', dimensionCapacity: '256gb' },
      { partNumber: 'MG6K4QN/A', fullPrice: 'white', dimensionColor: 'white', dimensionCapacity: '256gb' },
    ],
    displayValues: {
      dimensionColor: { black: { value: 'Black' }, white: { value: 'White' } },
      dimensionCapacity: { '256gb': { value: '256<small>GB</small>' } },
      prices: {
        black: { product: 'MG6J4QN/A', amountBeforeTradeIn: 839 },
        white: { product: 'MG6K4QN/A', amountBeforeTradeIn: 799 },
      },
    },
  })} }</script>`

  it('keys the machine the way every other market keys it', () => {
    const offers = parseCatalogOffers(page, uk, iphone, catalogue)
    expect(offers.map((o) => o.configKey)).toEqual(['dimensionCapacity=256gb'])
  })

  /** Dearer first in the page's own order, so the choice is a choice. */
  it('quotes the cheapest way to buy that machine here', () => {
    expect(parseCatalogOffers(page, uk, iphone, catalogue)[0].amount).toBe(799)
  })

  it('keeps the market its own labels', () => {
    const [offer] = parseCatalogOffers(page, uk, iphone, catalogue)
    expect(offer.dimensions).toEqual([
      { field: 'dimensionCapacity', value: '256gb', label: '256 GB' },
    ])
  })
})


describe('parseFamilyName', () => {
  it('uses the ProLED name Apple writes rather than guessing from its slug', () => {
    expect(parseFamilyName(fixture('apple-uk-macbook-pro-proled-xdr-select.html')))
      .toBe('MacBook Pro with PROLED XDR Display')
  })

  it('keeps the HomeView name when Apple omits the leading Buy', () => {
    expect(parseFamilyName(fixture('apple-uk-apple-homeview-select.html'))).toBe('Apple HomeView')
  })

  it('decodes entities and collapses whitespace before removing the shop wrapper', () => {
    expect(parseFamilyName('<title> Buy&nbsp;Apple &amp; Herm&egrave;s &#8212; &#x58;DR  - Apple (UK) </title>'))
      .toBe('Apple & Hermès — XDR')
    expect(parseFamilyName('<TITLE>Buy Apple &quot;Home&quot; - Apple</TITLE>')).toBe('Apple "Home"')
  })

  it('returns no replacement for absent or empty titles', () => {
    for (const html of ['', '<title>  &nbsp; </title>', '<title>Buy - Apple (UK)</title>']) {
      expect(parseFamilyName(html)).toBeUndefined()
    }
  })
})

describe('new selector options and families', () => {
  it('prices HomeView as one UK retail catalogue configuration at £299', () => {
    const family = { id: 'apple-homeview', categoryId: 'tv-home', name: 'Apple HomeView', route: '/shop/buy-home/apple-homeview' }
    const html = fixture('apple-uk-apple-homeview-select.html')
    const structure = parseFamilyStructure(html, family)
    expect(structure.kind).toBe('catalog')
    expect(structure.dimensions).toEqual([])
    const offers = parseCatalogOffers(html, uk, family, structure)
    expect(offers).toHaveLength(1)
    expect(offers[0]).toMatchObject({
      familyId: 'apple-homeview', marketId: 'uk', store: 'retail', amount: 299, currency: 'GBP',
      sourceUrl: 'https://www.apple.com/uk/shop/buy-home/apple-homeview',
    })
  })

  it('discovers 512GB memory on the Mac Studio without a code change', () => {
    const family = FAMILIES.find((family) => family.id === 'mac-studio')!
    const structure = parseFamilyStructure(fixture('apple-uk-mac-studio-select.html'), family)
    expect(structure.kind).toBe('cto')
    expect(structure.dimensions.find((dimension) => dimension.field === 'memory-dimensionMemory')?.values)
      .toContainEqual({ field: 'memory-dimensionMemory', value: '512gb', label: '512GB' })
  })
})
