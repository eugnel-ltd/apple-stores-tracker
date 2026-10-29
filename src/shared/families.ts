export interface Category {
  id: string
  label: string
}

export interface Family {
  id: string
  categoryId: string
  name: string
  /** Apple's own select-step path, appended to a market prefix. */
  route: string
  /**
   * Whether Apple's education store carries this family. iPhone is the
   * exception and always has been — Apple has never given it an education
   * price, and its education pages answer 541 in every market rather than 404,
   * which is indistinguishable from throttling. Asking anyway costs six
   * retries per family per market and yields nothing, so we do not ask.
   */
  educationPricing?: boolean
}

/** Last-known categories for discovery failures and older snapshots. */
export const CATEGORIES: Category[] = [
  { id: 'mac', label: 'Mac' },
  { id: 'ipad', label: 'iPad' },
  { id: 'iphone', label: 'iPhone' },
  { id: 'watch', label: 'Watch' },
  { id: 'vision', label: 'Vision' },
  { id: 'airpods', label: 'AirPods' },
  { id: 'tv-home', label: 'TV & Home' },
]

const TOKEN_NAME: Record<string, string> = {
  macbook: 'MacBook',
  mac: 'Mac',
  mini: 'mini',
  imac: 'iMac',
  ipad: 'iPad',
  iphone: 'iPhone',
  airpods: 'AirPods',
  homepod: 'HomePod',
  apple: 'Apple',
  watch: 'Watch',
  hermes: 'Hermès',
  se: 'SE',
  xdr: 'XDR',
  tv: 'TV',
  '4k': '4K',
  pro: 'Pro',
  air: 'Air',
  max: 'Max',
  neo: 'Neo',
  studio: 'Studio',
  display: 'Display',
  ultra: 'Ultra',
  vision: 'Vision',
  duo: 'Duo',
}

export const nameFromSlug = (id: string): string =>
  id
    .split('-')
    .map((part) => {
      if (Object.hasOwn(TOKEN_NAME, part)) return TOKEN_NAME[part]
      if (/^\d/.test(part)) return part
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')

/**
 * Fallback pages when the store front cannot supply a category route. None
 * embed a generation number. A shop index that 404s (`/shop/buy-airpods`)
 * falls through to the marketing page for that category.
 */
export const CATEGORY_INDEXES: { categoryId: string; routes: string[] }[] = [
  { categoryId: 'mac', routes: ['/shop/buy-mac'] },
  { categoryId: 'ipad', routes: ['/shop/buy-ipad'] },
  { categoryId: 'iphone', routes: ['/shop/buy-iphone'] },
  { categoryId: 'watch', routes: ['/shop/buy-watch'] },
  { categoryId: 'vision', routes: ['/shop/buy-vision'] },
  { categoryId: 'airpods', routes: ['/shop/buy-airpods', '/airpods/'] },
  { categoryId: 'tv-home', routes: ['/shop/buy-tv', '/tv-home/'] },
]

export const hasEducationPricing = (family: Family): boolean =>
  family.educationPricing !== false

/**
 * Families stored on a snapshot, or this compile-time table when the
 * snapshot predates a stored list. Live collection reads Apple's listing,
 * not this table.
 */
export const familiesOf = (snapshot: { families?: Family[] } | null | undefined): Family[] =>
  snapshot?.families ?? FAMILIES

/**
 * Stored categories preserve new departments without a release. Older or
 * incomplete snapshots still need a category for every served family so the
 * reader can reach it through navigation.
 */
export function categoriesOf(
  snapshot: { categories?: Category[]; families?: Family[] } | null | undefined,
): Category[] {
  const categories = [...(snapshot?.categories ?? CATEGORIES)]
  const seen = new Set(categories.map((category) => category.id))
  for (const { categoryId } of familiesOf(snapshot)) {
    if (seen.has(categoryId)) continue
    seen.add(categoryId)
    categories.push({ id: categoryId, label: nameFromSlug(categoryId) })
  }
  return categories
}

/**
 * Last-known families. Used when a snapshot has no stored list, and as a
 * per-category fallback if every listing page for that category fails.
 * A route that 404s is still a per-family collection error.
 */
export const FAMILIES: Family[] = [
  { id: 'macbook-neo', categoryId: 'mac', name: 'MacBook Neo', route: '/shop/buy-mac/macbook-neo' },
  { id: 'macbook-air', categoryId: 'mac', name: 'MacBook Air', route: '/shop/buy-mac/macbook-air' },
  { id: 'macbook-pro', categoryId: 'mac', name: 'MacBook Pro', route: '/shop/buy-mac/macbook-pro' },
  { id: 'imac', categoryId: 'mac', name: 'iMac', route: '/shop/buy-mac/imac' },
  { id: 'mac-mini', categoryId: 'mac', name: 'Mac mini', route: '/shop/buy-mac/mac-mini' },
  { id: 'mac-studio', categoryId: 'mac', name: 'Mac Studio', route: '/shop/buy-mac/mac-studio' },
  { id: 'studio-display', categoryId: 'mac', name: 'Studio Display', route: '/shop/buy-mac/studio-display' },
  { id: 'studio-display-xdr', categoryId: 'mac', name: 'Studio Display XDR', route: '/shop/buy-mac/studio-display-xdr' },
  { id: 'ipad-pro', categoryId: 'ipad', name: 'iPad Pro', route: '/shop/buy-ipad/ipad-pro' },
  { id: 'ipad-air', categoryId: 'ipad', name: 'iPad Air', route: '/shop/buy-ipad/ipad-air' },
  { id: 'ipad', categoryId: 'ipad', name: 'iPad', route: '/shop/buy-ipad/ipad' },
  { id: 'ipad-mini', categoryId: 'ipad', name: 'iPad mini', route: '/shop/buy-ipad/ipad-mini' },
  { id: 'iphone-17-pro', categoryId: 'iphone', name: 'iPhone 17 Pro', route: '/shop/buy-iphone/iphone-17-pro', educationPricing: false },
  { id: 'iphone-air', categoryId: 'iphone', name: 'iPhone Air', route: '/shop/buy-iphone/iphone-air', educationPricing: false },
  { id: 'iphone-17', categoryId: 'iphone', name: 'iPhone 17', route: '/shop/buy-iphone/iphone-17', educationPricing: false },
  { id: 'iphone-17e', categoryId: 'iphone', name: 'iPhone 17e', route: '/shop/buy-iphone/iphone-17e', educationPricing: false },
  { id: 'iphone-16', categoryId: 'iphone', name: 'iPhone 16', route: '/shop/buy-iphone/iphone-16', educationPricing: false },
  { id: 'apple-watch', categoryId: 'watch', name: 'Apple Watch', route: '/shop/buy-watch/apple-watch' },
  { id: 'apple-watch-se', categoryId: 'watch', name: 'Apple Watch SE', route: '/shop/buy-watch/apple-watch-se' },
  { id: 'apple-watch-ultra', categoryId: 'watch', name: 'Apple Watch Ultra', route: '/shop/buy-watch/apple-watch-ultra' },
  { id: 'apple-watch-hermes', categoryId: 'watch', name: 'Apple Watch Hermès', route: '/shop/buy-watch/apple-watch-hermes' },
  { id: 'apple-watch-hermes-ultra', categoryId: 'watch', name: 'Apple Watch Hermès Ultra', route: '/shop/buy-watch/apple-watch-hermes-ultra' },
  { id: 'apple-vision-pro', categoryId: 'vision', name: 'Apple Vision Pro', route: '/shop/buy-vision/apple-vision-pro' },
  { id: 'airpods-4', categoryId: 'airpods', name: 'AirPods 4', route: '/shop/buy-airpods/airpods-4' },
  { id: 'airpods-pro-3', categoryId: 'airpods', name: 'AirPods Pro 3', route: '/shop/buy-airpods/airpods-pro-3' },
  { id: 'airpods-max-2', categoryId: 'airpods', name: 'AirPods Max 2', route: '/shop/buy-airpods/airpods-max-2' },
  { id: 'homepod', categoryId: 'tv-home', name: 'HomePod', route: '/shop/buy-homepod/homepod' },
  { id: 'homepod-mini', categoryId: 'tv-home', name: 'HomePod mini', route: '/shop/buy-homepod/homepod-mini' },
  { id: 'apple-tv-4k', categoryId: 'tv-home', name: 'Apple TV 4K', route: '/shop/buy-tv/apple-tv-4k' },
]
