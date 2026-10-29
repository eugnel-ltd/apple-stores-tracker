import { CATEGORIES, nameFromSlug, type Category, type Family } from '../shared/families'

/** Aliases keep history and reader URLs stable when Apple moves a department. */
const SHOP_TO_CATEGORY: Record<string, string> = {
  mac: 'mac',
  ipad: 'ipad',
  iphone: 'iphone',
  watch: 'watch',
  vision: 'vision',
  airpods: 'airpods',
  home: 'tv-home',
  homepod: 'tv-home',
  tv: 'tv-home',
}

/** Paths that sit next to buy-flow families but are not a product. */
const FURNITURE = new Set([
  'carrier-offers',
  'accessories',
  'compare',
  'gift-cards',
  'giftcards',
  'accessory',
  'tradein',
  'financing',
  'trade-in',
  'browse',
  'shop',
])

export interface ShopCategory extends Category {
  shopSlugs: string[]
}

const categoryOfShop = (shop: string): string =>
  Object.hasOwn(SHOP_TO_CATEGORY, shop) ? SHOP_TO_CATEGORY[shop] : shop

/**
 * Only category-level links introduce departments. Product cards and store
 * furniture also link into the shop, but must not become extra categories.
 */
export function parseShopCategories(html: string): ShopCategory[] {
  const categories = new Map<string, ShopCategory>()
  const links = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi
  const categoryPath = /^(?:https:\/\/www\.apple\.com)?(?:\/[a-z]{2}(?:-edu)?)?\/shop\/(?:buy-([a-z0-9-]+)|goto\/buy_([a-z0-9_]+))\/?(?:[?#].*)?$/i
  for (const match of html.matchAll(links)) {
    const path = match[2].match(categoryPath)
    if (!path) continue
    const shop = (path[1] ?? path[2]).toLowerCase().replace(/_/g, '-')
    if (FURNITURE.has(shop)) continue
    const id = categoryOfShop(shop)
    let category = categories.get(id)
    if (!category) {
      category = { id, label: CATEGORIES.find((c) => c.id === id)?.label ?? nameFromSlug(id), shopSlugs: [] }
      categories.set(id, category)
    }
    if (!category.shopSlugs.includes(shop)) category.shopSlugs.push(shop)
  }
  return [...categories.values()]
}

const familyOf = (shop: string, slug: string): Family | null => {
  const categoryId = categoryOfShop(shop)
  if (FURNITURE.has(shop) || FURNITURE.has(slug)) return null
  const family: Family = {
    id: slug,
    categoryId,
    name: nameFromSlug(slug),
    route: `/shop/buy-${shop}/${slug}`,
  }
  if (categoryId === 'iphone') family.educationPricing = false
  return family
}

/**
 * Family-level buy-flow and goto links.
 *
 * A card often links at a SKU (`.../apple-watch-ultra/apple-watch-ultra-4-…`);
 * the family is the first slug after the shop category, never the rest.
 */
const BUY_PATH =
  /(?:https:\/\/www\.apple\.com)?(?:\/[a-z]{2}(?:-edu)?)?\/shop\/buy-([a-z0-9-]+)\/([a-z0-9-]+)/gi
const GOTO_PATH = /\/shop\/goto\/buy_([a-z0-9_]+)\/([a-z0-9_]+)/gi

function familiesFromLinks(html: string, categoryId: string): Family[] {
  const found: Family[] = []
  const seen = new Set<string>()
  const add = (shop: string, slug: string) => {
    const family = familyOf(shop.replace(/_/g, '-'), slug.replace(/_/g, '-'))
    if (!family || family.categoryId !== categoryId || seen.has(family.id)) return
    seen.add(family.id)
    found.push(family)
  }
  for (const match of html.matchAll(BUY_PATH)) add(match[1], match[2])
  for (const match of html.matchAll(GOTO_PATH)) add(match[1], match[2])
  return found
}

/**
 * Product tiles on a shop category index (`rf-hcard`). Prefer these over a
 * page-wide link scrape: the same HTML also carries footer leftovers
 * (`ipad-10-2`) and furniture (`carrier-offers`).
 *
 * Only the card's own buy-flow href counts — a wide window would swallow the
 * footer of a short listing.
 */
function familiesFromCards(html: string, categoryId: string): Family[] {
  const found: Family[] = []
  const seen = new Set<string>()
  const cards = /class="rf-hcard(?:\s|")[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/gi
  for (const match of html.matchAll(cards)) {
    for (const family of familiesFromLinks(match[1], categoryId)) {
      if (seen.has(family.id)) continue
      seen.add(family.id)
      found.push(family)
    }
  }
  return found
}

/**
 * Current buy-flow families listed on one Apple category (or marketing) page.
 *
 * Pure HTML → families. Collection fetches the page; tests drive this with
 * fixtures. A family Apple no longer merchandises on the listing is absent,
 * which is how a retired numbered model leaves the catalogue.
 */
export function parseListingFamilies(html: string, categoryId: string): Family[] {
  const fromCards = familiesFromCards(html, categoryId)
  return fromCards.length > 0 ? fromCards : familiesFromLinks(html, categoryId)
}
