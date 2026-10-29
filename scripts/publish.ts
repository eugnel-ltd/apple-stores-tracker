/**
 * Publish a locally collected snapshot: prices to KV, changes to D1.
 *
 * The Worker used to do this at the end of a cron sweep. It never once got
 * there -- parsing a store page costs about 1.8ms of cold CPU, a full sweep
 * needs some five CPU-seconds, and a free plan's cron can spend 4.8 in a whole
 * day. So the collection runs where there is no such ceiling and hands the
 * result over here.
 *
 *   npx jiti scripts/collect.ts
 *   npx jiti scripts/collect-refurb.ts
 *   npx jiti scripts/publish.ts
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
 */
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packOffers } from '../src/shared/offers'
import { changedPoints, type PricePoint } from '../src/shared/diff'
import { historyStatements, ROWS_PER_FILE } from '../src/shared/history-sql'
import { diminishedBy, reshapedFamilies, type PublishedSnapshot } from '../src/shared/publish-guard'

/**
 * Credentials come from the environment and are never read by anything that
 * prints. On a runner the Action supplies them; on a laptop a gitignored
 * `.env` does -- see `.env.example`. Node loads it natively, so there is no
 * dotenv here to go stale.
 */
if (existsSync('.env')) process.loadEnvFile('.env')

const local = JSON.parse(readFileSync('data/snapshot.json', 'utf8'))
const scratch = mkdtempSync(join(tmpdir(), 'publish-'))
const wrangler = (...args: string[]) =>
  execFileSync('npx', ['wrangler', ...args], { stdio: ['ignore', 'pipe', 'inherit'] }).toString()

/**
 * The same, for output too large to come back through a pipe.
 *
 * `execFileSync` buffers stdout at 1MB and the published snapshot is twelve,
 * so capturing it fails with ENOBUFS -- and it fails at whatever size the
 * catalogue happens to have reached, which is a bad way to find out. Writing
 * straight to a descriptor has no such ceiling.
 */
function wranglerToFile(file: string, ...args: string[]): void {
  const fd = openSync(file, 'w')
  try {
    execFileSync('npx', ['wrangler', ...args], { stdio: ['ignore', fd, 'inherit'] })
  } finally {
    closeSync(fd)
  }
}

/**
 * Stored packed, as `shared/offers.ts` describes: `configKey` and `sourceUrl`
 * restate the other fields and are rebuilt on read. Collecting yields whole
 * offers, so the packing happens here -- without it this writes a third more
 * bytes than KV needs, which on a catalogue carrying every Mac's memory and
 * storage matrix is 17.6MB against a 25MB ceiling.
 */
const offers = packOffers(local.offers)
const snapshot = {
  collectedAt: local.collectedAt,
  markets: local.markets,
  offers,
  errors: local.errors,
  ...(local.families ? { families: local.families } : {}),
  ...(local.categories ? { categories: local.categories } : {}),
}

// ---------------------------------------------------------------- guard

/**
 * Whether a snapshot has ever been published.
 *
 * Asked separately from reading it, because the two failures need opposite
 * answers: nothing published yet must be allowed to publish, and a read that
 * *failed* must not, since there is then no way to tell a good collection from
 * one that lost half the catalogue.
 */
function snapshotExists(): boolean {
  const listed = JSON.parse(wrangler('kv', 'key', 'list', '--binding=PRICES', '--remote'))
  return listed.some((k: { name: string }) => k.name === 'snapshot:latest')
}

/** What is published now: the thing this run has to be an improvement on. */
function published(): PublishedSnapshot | null {
  if (!snapshotExists()) {
    console.log('nothing published yet; this collection is the first')
    return null
  }
  const file = join(scratch, 'previous.json')
  wranglerToFile(file, 'kv', 'key', 'get', 'snapshot:latest', '--binding=PRICES', '--remote')
  return JSON.parse(readFileSync(file, 'utf8'))
}

/**
 * Read it before anything else, and let a failure stop the run.
 *
 * An earlier version caught this and carried on with `null`, which quietly
 * turned off the guard below -- `diminishedBy` has no complaint about a
 * comparison it cannot make, so a transient 401 would have republished a
 * half-collected catalogue over a good one and called it a first run. The
 * whole point is to fail closed: the published snapshot stays, visibly stale,
 * until someone looks.
 */
const before = published()

/** Clean line-up changes can shrink the range; failed reads cannot explain it. */
function refuseIfDiminished(): void {
  const complaints = diminishedBy(before, { markets: local.markets, offers: local.offers, errors: local.errors })
  if (complaints.length === 0) return
  if (process.env.PUBLISH_ANYWAY === '1') {
    console.log(`publishing a diminished collection on request -- ${complaints.join('; ')}`)
    return
  }
  throw new Error(
    `refusing to publish: ${complaints.join('; ')}. ` +
      `${new Set(local.errors?.map((error: { familyId: string }) => error.familyId)).size} families failed to collect. ` +
      `Re-run, or set PUBLISH_ANYWAY=1 after verifying Apple's range.`,
  )
}

refuseIfDiminished()
for (const family of reshapedFamilies(before, local)) {
  console.log(`reshaped by Apple: ${family.familyId} ${family.before} → ${family.now}`)
}

// ---------------------------------------------------------------- history

/**
 * Whether anything has ever been charted.
 *
 * `changedPoints` records first sightings and moves, so an empty table with a
 * published snapshot to compare against yields nothing at all, and every chart
 * stays empty until a price happens to move. Treating that as a first run
 * writes the baseline the charts hang off.
 */
function historyIsEmpty(): boolean {
  try {
    const out = wrangler('d1', 'execute', 'price-history', '--remote', '--json', '--command',
      'SELECT COUNT(*) AS rows FROM price_point')
    return JSON.parse(out)[0]?.results?.[0]?.rows === 0
  } catch (error) {
    // Assume it holds something: re-baselining the whole catalogue because a
    // count failed would bury the day's real changes among 22,000 rows.
    console.log(`could not count history rows (${error}); assuming it is populated`)
    return false
  }
}

const baseline = !before?.offers?.length || historyIsEmpty()
if (baseline) console.log('no history to build on; taking this snapshot as the baseline')

const points = changedPoints(baseline ? [] : (before?.offers ?? []), offers, local.collectedAt.slice(0, 10))
console.log(`${points.length} price changes to record`)

/**
 * D1 takes a file of statements, not bound parameters. Batching lives in
 * `historyStatements`; this only groups those into files the execute call
 * can ingest.
 */
function writeHistory(rows: PricePoint[]): void {
  for (let offset = 0; offset < rows.length; offset += ROWS_PER_FILE) {
    const chunk = rows.slice(offset, offset + ROWS_PER_FILE)
    const file = join(scratch, `history-${offset}.sql`)
    writeFileSync(file, historyStatements(chunk).join('\n'))
    wrangler('d1', 'execute', 'price-history', '--remote', '--yes', '--file', file)
    console.log(`  wrote ${chunk.length} history rows`)
  }
}

// Written before the prices they describe: a failure here must not leave the
// site publishing a move that nothing charted.
if (points.length > 0) writeHistory(points)

// ---------------------------------------------------------------- prices

const put = (key: string, value: unknown) => {
  const file = join(scratch, `${key.replace(':', '-')}.json`)
  writeFileSync(file, JSON.stringify(value))
  wrangler('kv', 'key', 'put', key, `--path=${file}`, '--binding=PRICES', '--remote')
  console.log(`  wrote ${key}`)
}

put('snapshot:latest', snapshot)
if (local.fx) put('fx:latest', local.fx)
if (local.refurb) put(`refurb:${local.refurb.marketId}`, local.refurb)

console.log(
  `\nPublished ${offers.length} offers across ${local.markets.length} markets` +
    `${local.refurb ? `, ${local.refurb.listings.length} refurbished listings` : ''}` +
    `, ${points.length} history rows.`,
)
