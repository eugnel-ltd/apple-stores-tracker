import { collapseUnpaidDimensions, type StoredOffer } from './offers'

/** The share to keep where collection errors leave Apple's range uncertain. */
export const KEPT_AT_LEAST = 0.9

// A parser regression can lose most offers without reporting any errors, so
// even a collection that claims to be clean must keep half the catalogue.
export const KEPT_AT_LEAST_OVERALL = 0.5

export interface PublishedSnapshot {
  markets?: string[]
  offers?: StoredOffer[]
}

interface CollectedSnapshot {
  markets: string[]
  offers: unknown[]
  errors?: { familyId: string }[]
}

function familyCounts(offers: unknown[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const offer of offers) {
    if (!offer || typeof offer !== 'object' || !('familyId' in offer) || typeof offer.familyId !== 'string') continue
    counts.set(offer.familyId, (counts.get(offer.familyId) ?? 0) + 1)
  }
  return counts
}

/**
 * Reasons to refuse a collection, or none.
 *
 * `collect.ts` records a failed family as an error and carries on, which is
 * right: one throttled page should not cost a whole run. But it means a bad
 * day -- Apple rate-limiting the runner, a network fault, a login wall --
 * produces a small, well-formed snapshot, and publishing replaces the whole
 * blob rather than merging into it. The site would go quietly half-empty while
 * every check still reported success.
 *
 * The same reasoning the refurbished read already uses: a read that returned
 * nothing is a failed read, not an empty shop. Stale prices are visibly stale;
 * missing ones just look like Apple stopped selling things.
 *
 * A family with no errors was read cleanly in every market and store, so its
 * new count is Apple's range, including retirement. Only families with errors
 * belong in the shrink comparison, unless error reporting is unavailable.
 * The overall floor still catches a collection that silently lost most offers.
 *
 * Nothing to compare against is not a complaint -- a first run has to be able
 * to publish, and so does a run after the snapshot has been cleared.
 */
export function diminishedBy(
  before: PublishedSnapshot | null,
  now: CollectedSnapshot,
): string[] {
  if (!before?.offers?.length) return []

  const lostMarkets = (before.markets ?? []).filter((m) => !now.markets.includes(m))

  // Both sides are counted the same way, because the catalogue's shape can
  // change deliberately. When a dimension stops being carried -- a finish
  // every colour of which costs the same -- the new collection is a quarter
  // smaller while describing exactly the same machines, and a guard comparing
  // raw row counts would read that as Apple withdrawing a quarter of its
  // range. Collapsing the published side too asks the question that was meant:
  // are there fewer machines, not fewer rows.
  const previously = collapseUnpaidDimensions(before.offers)
  const overall = now.offers.length / previously.length
  let previousCount = previously.length
  let currentCount = now.offers.length
  if (now.errors !== undefined) {
    const failed = new Set(now.errors.map((error) => error.familyId))
    const previousFamilies = familyCounts(previously)
    const currentFamilies = familyCounts(now.offers)
    previousCount = 0
    currentCount = 0
    for (const familyId of failed) {
      previousCount += previousFamilies.get(familyId) ?? 0
      currentCount += currentFamilies.get(familyId) ?? 0
    }
  }
  const kept = previousCount > 0 ? currentCount / previousCount : 1

  return [
    lostMarkets.length > 0 ? `markets missing: ${lostMarkets.join(', ')}` : '',
    overall < KEPT_AT_LEAST_OVERALL
      ? `offers fell from ${previously.length} to ${now.offers.length} (${(overall * 100).toFixed(0)}%)`
      : kept < KEPT_AT_LEAST
        ? `offers${now.errors === undefined ? '' : ' in families with errors'} fell from ${previousCount} to ${currentCount} (${(kept * 100).toFixed(0)}%)`
        : '',
  ].filter(Boolean)
}

/** Clean range changes belong in the run log, rather than blocking publication. */
export function reshapedFamilies(
  before: PublishedSnapshot | null,
  now: CollectedSnapshot,
): { familyId: string; before: number; now: number }[] {
  if (!before?.offers?.length || now.errors === undefined) return []

  const previous = familyCounts(collapseUnpaidDimensions(before.offers))
  const current = familyCounts(now.offers)
  const failed = new Set(now.errors.map((error) => error.familyId))
  const families = new Set([...previous.keys(), ...current.keys()])
  return [...families].filter((familyId) => !failed.has(familyId)).flatMap((familyId) => {
    const before = previous.get(familyId) ?? 0
    const now = current.get(familyId) ?? 0
    return Math.abs(now - before) > before / 10 ? [{ familyId, before, now }] : []
  })
}
