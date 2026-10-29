import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseListingFamilies, parseShopCategories } from '../src/scrape/discover'
import { CATEGORIES, FAMILIES, categoriesOf } from '../src/shared/families'

import { discoverFamilies, discoverStructures, RequestBudget } from '../src/scrape/sweep'
import { marketById } from '../src/shared/markets'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('parseListingFamilies', () => {
  const iphone = parseListingFamilies(fixture('apple-uk-buy-iphone.html'), 'iphone')

  it('reads the currently merchandised numbered buy-flow models', () => {
    expect(iphone.map((f) => f.id)).toEqual([
      'iphone-duo',
      'iphone-18-pro',
      'iphone-air',
      'iphone-17',
      'iphone-17e',
      'iphone-16',
    ])
    expect(iphone.find((f) => f.id === 'iphone-18-pro')).toMatchObject({
      name: 'iPhone 18 Pro',
      route: '/shop/buy-iphone/iphone-18-pro',
      categoryId: 'iphone',
    })
    expect(iphone.find((f) => f.id === 'iphone-duo')).toMatchObject({
      name: 'iPhone Duo',
      route: '/shop/buy-iphone/iphone-duo',
    })
  })

  it('does not keep a retired numbered model that is absent from the cards', () => {
    expect(iphone.map((f) => f.id)).not.toContain('iphone-17-pro')
    expect(FAMILIES.map((f) => f.id)).toContain('iphone-17-pro')
  })

  it('ignores carrier-offers and other non-product paths', () => {
    expect(iphone.map((f) => f.id)).not.toContain('carrier-offers')
    expect(iphone.every((f) => f.categoryId === 'iphone')).toBe(true)
  })

  it('marks every iPhone family education-ineligible', () => {
    expect(iphone.every((f) => f.educationPricing === false)).toBe(true)
  })

  it('collapses a SKU-deep card href to the family buy-flow', () => {
    const html = `
      <div class="rf-hcard rf-hcard-40">
        <a href="/uk/shop/buy-watch/apple-watch-ultra/apple-watch-ultra-4-gps-cellular-49mm-titanium-case">
          <div class="rf-hcard-content-title">Apple Watch Ultra 4</div>
        </a>
      </div>`
    expect(parseListingFamilies(html, 'watch')).toEqual([
      {
        id: 'apple-watch-ultra',
        categoryId: 'watch',
        name: 'Apple Watch Ultra',
        route: '/shop/buy-watch/apple-watch-ultra',
      },
    ])
  })

  it('reads goto buy-flow links when a shop index is gone', () => {
    const html = `
      <a href="/uk/shop/goto/buy_airpods/airpods_5">AirPods 5</a>
      <a href="/uk/shop/goto/buy_airpods/airpods_pro_3">AirPods Pro 3</a>
      <a href="/uk/shop/goto/buy_airpods/airpods_max_2">AirPods Max 2</a>
      <a href="/uk/shop/goto/buy_airpods/airpods_5/with_wireless_charging_case">SKU</a>
      <a href="/uk/shop/goto/buy_accessories">Accessories</a>
      <a href="/uk/shop/goto/airpods/accessories">AirPods accessories</a>`
    expect(parseListingFamilies(html, 'airpods').map((f) => f.id)).toEqual([
      'airpods-5',
      'airpods-pro-3',
      'airpods-max-2',
    ])
  })
})


describe('parseShopCategories', () => {
  it('reads the captured category links without inventing categories from product cards', () => {
    const categories = parseShopCategories(fixture('apple-uk-shop.html'))
    expect(categories.map((category) => category.id)).toEqual([
      'mac', 'iphone', 'ipad', 'watch', 'vision', 'tv-home',
    ])
    expect(categories.find((category) => category.id === 'tv-home')).toEqual({
      id: 'tv-home', label: 'TV & Home', shopSlugs: ['home'],
    })
  })

  it('discovers seven departments when AirPods has a category-level link', () => {
    const categories = parseShopCategories(`${fixture('apple-uk-shop.html')}
      <a href="/uk/shop/goto/buy_airpods">AirPods</a>`)
    expect(categories).toHaveLength(7)
    expect(categories.map(({ id, label }) => ({ id, label }))).toEqual(expect.arrayContaining(CATEGORIES))
  })

  it('introduces an unfamiliar department and ignores furniture, family and external links', () => {
    const html = `
      <a href='/uk/shop/buy-glasses/?ref=nav'>Glasses</a>
      <a href="https://www.apple.com/uk/shop/goto/buy_glasses#models">Glasses</a>
      <a href="/uk/shop/buy-glasses/apple-glasses">A product</a>
      <a href="/uk/shop/goto/buy_cameras/camera_one">Another product</a>
      <a href="https://example.com/shop/buy-cameras">External</a>
      ${['accessories', 'gift-cards', 'giftcards', 'trade-in', 'financing', 'browse'].map(
        (slug) => `<a href="/uk/shop/buy-${slug}">Furniture</a>`,
      ).join('')}`
    expect(parseShopCategories(html)).toEqual([{ id: 'glasses', label: 'Glasses', shopSlugs: ['glasses'] }])
  })

  it('groups every Home alias under the historical id while retaining their shop slugs', () => {
    expect(parseShopCategories(`
      <a href="/shop/buy-tv">TV</a>
      <a href="/shop/goto/buy_homepod">HomePod</a>
      <a href="/shop/buy-home">Home</a>
      <a href="/shop/buy-home">Home again</a>`)).toEqual([
      { id: 'tv-home', label: 'TV & Home', shopSlugs: ['tv', 'homepod', 'home'] },
    ])
  })
})

describe('new listing families', () => {
  it('accepts HomeView and the legacy Home shop paths on the same listing', () => {
    const families = parseListingFamilies(`${fixture('apple-uk-buy-home.html')}
      <div class="rf-hcard rf-hcard-40"><a href="/uk/shop/buy-iphone/carrier-offers">Offers</a></div>
      <div class="rf-hcard rf-hcard-40"><a href="/uk/shop/buy-iphone/iphone-duo">iPhone</a></div>`, 'tv-home')
    expect(families.map((family) => family.id).sort()).toEqual([
      'apple-homeview', 'apple-tv-4k', 'homepod', 'homepod-mini',
    ])
    expect(families.every((family) => family.categoryId === 'tv-home' && family.educationPricing !== false)).toBe(true)
    expect(families.find((family) => family.id === 'homepod')?.route).toBe('/shop/buy-homepod/homepod')
    expect(families.find((family) => family.id === 'apple-tv-4k')?.route).toBe('/shop/buy-tv/apple-tv-4k')
  })

  it('discovers the ProLED MacBook family', () => {
    expect(parseListingFamilies(fixture('apple-uk-buy-mac.html'), 'mac').map((family) => family.id))
      .toContain('macbook-pro-proled-xdr')
  })

  it('accepts an unfamiliar shop only within its own category', () => {
    const html = '<a href="/uk/shop/buy-glasses/apple-glasses">Glasses</a>'
    expect(parseListingFamilies(html, 'glasses')).toEqual([
      { id: 'apple-glasses', name: 'Apple Glasses', categoryId: 'glasses', route: '/shop/buy-glasses/apple-glasses' },
    ])
    expect(parseListingFamilies(html, 'mac')).toEqual([])
  })
})

describe('categoriesOf', () => {
  it('falls back for snapshots written before categories were stored', () => {
    expect(categoriesOf(null)).toEqual(CATEGORIES)
    expect(categoriesOf(undefined)).toEqual(CATEGORIES)
    expect(categoriesOf({})).toEqual(CATEGORIES)
  })

  it('preserves stored labels and supplies any missing family categories without mutating the snapshot', () => {
    const families = [{ id: 'apple-glasses', categoryId: 'smart-glasses', name: 'Apple Glasses', route: '/shop/buy-smart-glasses/apple-glasses' }]
    const snapshot = { categories: [{ id: 'mac', label: 'Mac' }], families }
    expect(categoriesOf(snapshot)).toEqual([
      { id: 'mac', label: 'Mac' }, { id: 'smart-glasses', label: 'Smart Glasses' },
    ])
    expect(snapshot.categories).toEqual([{ id: 'mac', label: 'Mac' }])
    expect(categoriesOf({ families })).toContainEqual({ id: 'smart-glasses', label: 'Smart Glasses' })
    expect(categoriesOf({ families: [], categories: [] })).toEqual([])
  })
})

const uk = marketById('uk')!

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Every URL is resolved locally, so a new request cannot escape to Apple. */
function mockPages(pages: Record<string, string>) {
  const fetch = vi.fn(async (url: string) => {
    const html = pages[new URL(url).pathname]
    return html === undefined ? new Response('', { status: 404 }) : new Response(html)
  })
  vi.stubGlobal('fetch', fetch)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  return fetch
}

describe('discovery sweep', () => {
  it('fetches the front page within budget, adds a new department and preserves missing seed categories', async () => {
    const fetch = mockPages({
      '/uk/shop': `${fixture('apple-uk-shop.html')}<a href="/shop/buy-glasses">Glasses</a>`,
      '/uk/shop/buy-home': fixture('apple-uk-buy-home.html'),
      '/uk/shop/buy-mac': fixture('apple-uk-buy-mac.html'),
      '/uk/shop/buy-glasses': '<a href="/uk/shop/buy-glasses/apple-glasses">Glasses</a>',
    })
    const budget = new RequestBudget(100)
    const result = await discoverFamilies(uk, budget)
    expect(fetch.mock.calls[0][0]).toBe('https://www.apple.com/uk/shop')
    expect(budget.remaining).toBe(100 - fetch.mock.calls.length)
    expect(result.categories).toEqual(expect.arrayContaining([...CATEGORIES, { id: 'glasses', label: 'Glasses' }]))
    expect(result.families).toContainEqual(expect.objectContaining({ id: 'apple-glasses', categoryId: 'glasses' }))
    expect(result.families.map((family) => family.id)).toContain('apple-homeview')
    expect(result.families.filter((family) => family.categoryId === 'ipad')).toEqual(FAMILIES.filter((family) => family.categoryId === 'ipad'))
    const urls = fetch.mock.calls.map(([url]) => url)
    expect(urls).not.toContain('https://www.apple.com/uk/shop/buy-tv')
    expect(urls).not.toContain('https://www.apple.com/uk/shop/buy-homepod')
  })

  it.each([undefined, '<html>Changed front page</html>'])('keeps the seed when the front page fails or changes (%s)', async (front) => {
    mockPages(front === undefined ? {} : { '/uk/shop': front })
    const result = await discoverFamilies(uk, new RequestBudget(100))
    expect(result.categories).toEqual(CATEGORIES)
    expect(result.families).toEqual(FAMILIES)
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/categor.*seed/))
  })

  it('tries the modern Home shop before aliases, then existing marketing fallbacks', async () => {
    const fetch = mockPages({
      '/uk/shop': '<a href="/shop/buy-tv">TV</a><a href="/shop/buy-homepod">HomePod</a>',
      '/uk/shop/buy-tv': fixture('apple-uk-buy-home.html'),
      '/uk/airpods/': '<a href="/uk/shop/goto/buy_airpods/airpods_5">AirPods</a>',
    })
    const result = await discoverFamilies(uk, new RequestBudget(100))
    const urls = fetch.mock.calls.map(([url]) => url)
    expect(urls.indexOf('https://www.apple.com/uk/shop/buy-home')).toBeLessThan(urls.indexOf('https://www.apple.com/uk/shop/buy-tv'))
    expect(result.families.map((family) => family.id)).toContain('apple-homeview')
    expect(result.families.map((family) => family.id)).toContain('airpods-5')
  })

  it('keeps the first occurrence of a family id across categories', async () => {
    mockPages({
      '/uk/shop': '<a href="/shop/buy-glasses">Glasses</a><a href="/shop/buy-mac">Mac</a>',
      '/uk/shop/buy-glasses': '<a href="/shop/buy-glasses/shared-product">Glasses</a>',
      '/uk/shop/buy-mac': '<a href="/shop/buy-mac/shared-product">Mac</a>',
    })
    const result = await discoverFamilies(uk, new RequestBudget(100))
    expect(result.families.filter((family) => family.id === 'shared-product')).toEqual([
      { id: 'shared-product', categoryId: 'glasses', name: 'Shared Product', route: '/shop/buy-glasses/shared-product' },
    ])
  })

  it('retains Apple names without extra requests, and keeps fallback names and partial errors', async () => {
    const families = parseListingFamilies(fixture('apple-uk-buy-home.html'), 'tv-home')
    const fetch = mockPages({
      '/uk/shop/buy-home/apple-homeview': fixture('apple-uk-apple-homeview-select.html'),
      '/uk/shop/buy-tv/apple-tv-4k': fixture('apple-uk-apple-homeview-select.html').replace(/<title>.*?<\/title>/, ''),
    })
    const budget = new RequestBudget(4)
    const result = await discoverStructures(uk, budget, families)
    expect(result.families.find((family) => family.id === 'apple-homeview')?.name).toBe('Apple HomeView')
    expect(result.families.find((family) => family.id === 'apple-tv-4k')?.name).toBe('Apple TV 4K')
    expect(families.find((family) => family.id === 'apple-homeview')?.name).toBe('Apple Homeview')
    expect(result.structures).toHaveLength(2)
    expect(result.errors.map((error) => error.familyId).sort()).toEqual(['homepod', 'homepod-mini'])
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(budget.remaining).toBe(0)
  })
})
