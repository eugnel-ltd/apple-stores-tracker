export class ReleaseFailure extends Error {
  constructor(message: string, readonly exitCode: 2 | 3 | 4) {
    super(message)
  }
}

export function parseReleaseLedger(ledger: string) {
  ledger = ledger.replaceAll('\r\n', '\n')
  const rows = [...ledger.matchAll(/^\|[ \t]*release[ \t]*\|([^\r\n]*)$/gm)]
  const level = rows.length === 1 ? rows[0][1].match(/^[ \t]*(\d+)[ \t]*\|/) : null
  const releaseLevel = level && Number.isSafeInteger(Number(level[1])) ? Number(level[1]) : null
  const lines = ledger.split(/\r?\n/).filter((line) => line.startsWith('Enforcement status:'))
  const green = lines.length === 1
    ? lines[0].match(/^Enforcement status:[ \t]*(?:`green since (\d{4}-\d{2}-\d{2})`|green since (\d{4}-\d{2}-\d{2})(?=[ \t]|$))(?:[ \t].*)?$/)
    : null
  const date = green?.[1] ?? green?.[2]
  const validDate = date && Number.isFinite(Date.parse(date))
    && new Date(date).toISOString().slice(0, 10) === date
  return { releaseLevel, greenSince: validDate ? date : null }
}

export function requireReleaseLedger(ledger: string) {
  const { releaseLevel, greenSince } = parseReleaseLedger(ledger)
  if (releaseLevel === null || releaseLevel < 3) {
    throw new ReleaseFailure('release ledger needs exactly one release level of at least 3', 3)
  }
  if (!greenSince) throw new ReleaseFailure('enforcement ledger is not green', 3)
}

export function requireReleaseCheckout(status: string, head: string, main: string) {
  if (status.trim()) throw new ReleaseFailure('release needs a clean worktree', 3)
  if (!/^[a-f0-9]{40}$/.test(head) || head !== main) {
    throw new ReleaseFailure('release must check out the exact current origin/main commit', 3)
  }
}

export interface EvidenceResult {
  code: number
  stdout: string
}

export interface ChainReader {
  readCommit(sha: string): Promise<{ ledger: string; firstParent: string | null }>
  evidence(sha: string): Promise<EvidenceResult>
  remediate(sha: string, laterProved: readonly string[]): Promise<EvidenceResult>
  report(line: string): void
}

export async function proveGreenChain(head: string, io: ChainReader): Promise<number> {
  const proved: string[] = []
  let current = head
  while (true) {
    const { ledger, firstParent } = await io.readCommit(current)
    if (current === head) requireReleaseLedger(ledger)
    if (!parseReleaseLedger(ledger).greenSince) return proved.length

    const evidence = await io.evidence(current)
    if (evidence.stdout.trim()) io.report(evidence.stdout.trim())
    if (evidence.code !== 0 && evidence.code !== 1) {
      throw new ReleaseFailure(`release evidence failed for ${current}`, 2)
    }
    if (evidence.code === 1) {
      // The helper requires a later commit; a hold on HEAD has no remediation candidate.
      if (!proved.length) throw new ReleaseFailure(`release evidence holds ${current}`, 3)
      const remediation = await io.remediate(current, [...proved])
      if (remediation.stdout.trim()) io.report(remediation.stdout.trim())
      if (remediation.code !== 0) {
        throw new ReleaseFailure(`release remediation ${remediation.code === 1 ? 'holds' : 'failed for'} ${current}`,
          remediation.code === 1 ? 3 : 2)
      }
    }
    proved.push(current)
    if (!firstParent) throw new ReleaseFailure('ledger is green back to root; no transition is established', 3)
    current = firstParent
  }
}

export interface Deployment {
  id: string
  versionId: string
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)

export function parseDeploymentList(value: unknown): Deployment {
  const invalid = () => new ReleaseFailure('active Worker deployment/rollback target is ambiguous', 2)
  if (!Array.isArray(value) || !value.length) throw invalid()
  const entries = value.map((entry: unknown) => {
    if (!record(entry) || typeof entry.created_on !== 'string') throw invalid()
    const created = Date.parse(entry.created_on)
    if (!Number.isFinite(created)) throw invalid()
    return { entry, created }
  }).sort((a, b) => b.created - a.created)
  if (entries.length > 1 && entries[0].created === entries[1].created) throw invalid()
  const latest = entries[0].entry
  const versions: unknown = latest.versions
  if (!uuid(latest.id) || !Array.isArray(versions) || versions.length !== 1) throw invalid()
  const version: unknown = versions[0]
  if (!record(version) || version.percentage !== 100 || !uuid(version.version_id)) throw invalid()
  return { id: latest.id, versionId: version.version_id }
}

export function belongsToAttempt(value: unknown, active: Deployment, attempt: string, sha: string): boolean {
  return record(value) && value.id === active.versionId && record(value.annotations)
    && value.annotations['workers/tag'] === attempt
    && value.annotations['workers/message'] === `apple-stores-tracker ${sha}`
}

export interface HealthResponse {
  status: number
  body: unknown
}

export function healthyRelease(status: HealthResponse, snapshot: HealthResponse): boolean {
  return status.status === 200 && snapshot.status === 200
    && record(status.body) && typeof status.body.collectedAt === 'string'
    && status.body.collectedAt.trim().length > 0
    && Array.isArray(status.body.markets) && status.body.markets.length > 0
    && record(snapshot.body) && Array.isArray(snapshot.body.categories) && snapshot.body.categories.length > 0
}

export interface ReleaseActions {
  deployment(): Promise<Deployment>
  version(id: string): Promise<unknown>
  build(): Promise<boolean>
  verifyCheckout(): Promise<void>
  deploy(): Promise<boolean>
  health(): Promise<boolean>
  rollback(id: string): Promise<boolean>
  report(line: string): void
}

const sameDeployment = (a: Deployment, b: Deployment) => a.id === b.id && a.versionId === b.versionId

export async function applyRelease(sha: string, attempt: string, io: ReleaseActions): Promise<string> {
  const previous = await io.deployment()
  if (!await io.build()) throw new ReleaseFailure('release build failed', 3)
  await io.verifyCheckout()
  if (!sameDeployment(previous, await io.deployment())) {
    throw new ReleaseFailure('active deployment changed during the build; retry preflight', 3)
  }
  io.report(`RELEASE SUBMITTING ${sha}; attempt ${attempt}; rollback version ${previous.versionId}`)
  // A lost command response can follow a successful write, so reconcile provider state either way.
  let submitted = false
  try { submitted = await io.deploy() } catch { /* Provider state below decides whether recovery is safe. */ }
  const unknown = () => new ReleaseFailure('deployment UNKNOWN; active identity is not proved to belong to this attempt', 4)
  let owned: Deployment
  try {
    owned = await io.deployment()
    if (sameDeployment(previous, owned) && !submitted) {
      throw new ReleaseFailure('deployment command failed; previous deployment remains active', 4)
    }
    if (owned.id === previous.id || !belongsToAttempt(await io.version(owned.versionId), owned, attempt, sha)) {
      throw unknown()
    }
  } catch (error) {
    if (error instanceof ReleaseFailure && error.exitCode === 4) throw error
    throw unknown()
  }
  const stillCurrent = async () => {
    try {
      if (!sameDeployment(owned, await io.deployment())) throw unknown()
    } catch { throw unknown() }
  }
  const checkHealth = async () => {
    try { return await io.health() } catch { return false }
  }
  if (submitted && await checkHealth()) {
    await stillCurrent()
    return owned.versionId
  }

  // Cloudflare has no atomic compare-and-swap rollback. This fresh read avoids undoing an
  // observed intervening release; operators still need to coordinate the read/write interval.
  await stillCurrent()
  io.report(`RELEASE ROLLING BACK ${previous.versionId}`)
  let rolledBack = false
  try { rolledBack = await io.rollback(previous.versionId) } catch { /* Verify even a lost rollback response. */ }
  try {
    if ((await io.deployment()).versionId !== previous.versionId) throw unknown()
  } catch { throw new ReleaseFailure('deployment UNKNOWN; rollback did not confirm the previous version', 4) }
  const restored = await checkHealth()
  throw new ReleaseFailure(`${submitted ? 'release health check' : 'deployment command'} failed; rollback ${
    rolledBack ? 'command succeeded' : 'response uncertain'}; previous version health ${restored ? 'OK' : 'FAILED'}`, 4)
}
