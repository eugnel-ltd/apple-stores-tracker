/**
 * Release only the reviewed green chain on current main. The default proves evidence
 * without a deployment; --apply also builds, deploys, verifies health and recovers.
 */
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { accessSync, constants, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { parseConfigFileTextToJson } from 'typescript'
import {
  applyRelease, healthyRelease, parseDeploymentList, proveGreenChain,
  ReleaseFailure, requireReleaseCheckout, requireReleaseLedger,
} from '../src/shared/release-guard'
import type { HealthResponse } from '../src/shared/release-guard'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = 'eugnel-ltd/apple-stores-tracker'
const ledgerPath = 'docs/autonomy-ledger.md'
const origin = 'https://apple-price-tracker.eugnel.com'

function report(line: string) {
  // Child diagnostics must not disclose credentials even when a tool includes them in an error.
  for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
    const secret = process.env[name]
    if (secret) line = line.replaceAll(secret, '[redacted]')
  }
  console.log(line)
}

function command(program: string, args: string[], timeout = 120_000, env = process.env) {
  const result = spawnSync(program, args, {
    cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout, maxBuffer: 16 * 1024 * 1024,
  })
  return { code: result.error ? 2 : result.status ?? 2, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function git(...args: string[]) {
  const result = command('git', args)
  if (result.code !== 0) throw new ReleaseFailure(`git ${args[0]} could not complete`, 2)
  return result.stdout.trim()
}

function ledgerAt(sha: string) {
  if (!git('ls-tree', sha, '--', ledgerPath)) return ''
  return git('show', `${sha}:${ledgerPath}`)
}

function checkout(expected?: string) {
  const status = git('status', '--porcelain', '--untracked-files=all')
  if (status) throw new ReleaseFailure('release needs a clean worktree', 3)
  if (command('git', ['fetch', '-q', 'origin', 'main']).code !== 0) {
    throw new ReleaseFailure('could not fetch origin/main for release', 3)
  }
  const head = git('rev-parse', 'HEAD')
  requireReleaseCheckout(status, head, git('rev-parse', 'refs/remotes/origin/main'))
  if (expected && head !== expected) throw new ReleaseFailure('checkout changed after release preflight', 3)
  return head
}

function evidenceDirectory() {
  const directory = process.env.AI_SDLC_DIR?.trim()
  if (!directory) throw new ReleaseFailure('AI_SDLC_DIR must name an ai-sdlc checkout at tag v3', 2)
  const path = resolve(directory)
  for (const script of ['release_evidence.sh', 'release_remediation.sh']) {
    try { accessSync(join(path, 'scripts', script), constants.R_OK) }
    catch { throw new ReleaseFailure(`AI_SDLC_DIR is missing readable scripts/${script}`, 2) }
  }
  const head = command('git', ['-C', path, 'rev-parse', 'HEAD'])
  const tag = command('git', ['-C', path, 'rev-parse', 'refs/tags/v3^{commit}'])
  const status = command('git', ['-C', path, 'status', '--porcelain', '--untracked-files=no'])
  if (head.code !== 0 || tag.code !== 0 || status.code !== 0
    || head.stdout.trim() !== tag.stdout.trim() || status.stdout.trim()) {
    throw new ReleaseFailure('AI_SDLC_DIR must be an unmodified ai-sdlc checkout at tag v3', 2)
  }
  return path
}

function workerName() {
  const parsed = parseConfigFileTextToJson('wrangler.jsonc', readFileSync(join(root, 'wrangler.jsonc'), 'utf8'))
  if (parsed.error || parsed.config?.name !== 'apple-price-tracker'
    || !parsed.config.routes?.some((route: { pattern?: string; custom_domain?: boolean }) =>
      route.pattern === new URL(origin).hostname && route.custom_domain === true)) {
    throw new ReleaseFailure('wrangler.jsonc does not name the expected Worker and custom domain', 2)
  }
  return parsed.config.name as string
}

async function health() {
  const read = async (path: string): Promise<HealthResponse> => {
    try {
      const response = await fetch(`${origin}${path}`, {
        signal: AbortSignal.timeout(5_000), redirect: 'error', cache: 'no-store',
      })
      return { status: response.status, body: await response.json() }
    } catch { return { status: 0, body: null } }
  }
  // Seven bounded attempts allow propagation for about a minute without waiting indefinitely.
  const started = Date.now()
  for (let attempt = 0; attempt < 7; attempt++) {
    const [status, snapshot] = await Promise.all([read('/api/status'), read('/api/snapshot')])
    if (healthyRelease(status, snapshot)) return true
    if (attempt < 6) await delay(Math.max(0, started + (attempt + 1) * 10_000 - Date.now()))
  }
  return false
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) {
    throw new ReleaseFailure('usage: npm run release -- [--apply]', 2)
  }
  const aiSdlc = evidenceDirectory()
  const sha = checkout()
  requireReleaseLedger(ledgerAt(sha))
  const name = workerName()
  // Environment overrides must not weaken the adopted helper's required checks.
  const evidenceEnv = { ...process.env }
  delete evidenceEnv.REQUIRED_CHECKS
  delete evidenceEnv.RELEASE_REQUIRED_CHECKS
  const helper = async (script: string, args: readonly string[]) => {
    const result = command('sh', [join(aiSdlc, 'scripts', script), repo, ...args], 120_000, evidenceEnv)
    if (result.code !== 0 && result.code !== 1 && result.stderr.trim()) report(result.stderr.trim())
    return result
  }
  const count = await proveGreenChain(sha, {
    readCommit: async (commit) => ({
      ledger: ledgerAt(commit),
      firstParent: git('rev-list', '--parents', '-n', '1', commit).split(/\s+/)[1] ?? null,
    }),
    evidence: (commit) => helper('release_evidence.sh', [commit]),
    remediate: (commit, later) => helper('release_remediation.sh', [commit, ...later]),
    report,
  })
  report(`RELEASE EVIDENCE OK ${sha}: ${count} green-chain commits`)
  report(`RELEASE PLAN ${sha}: build and deploy ${name}; verify ${origin}/api/status and /api/snapshot; roll back the captured version on failure`)
  if (!args.includes('--apply')) {
    report('RELEASE DRY RUN; no deployment performed')
    return
  }
  for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
    if (!process.env[key]?.trim()) throw new ReleaseFailure(`${key} is required for --apply`, 3)
  }
  const wrangler = (args: string[]) => command('npx', ['--no-install', 'wrangler', ...args, '--name', name],
    300_000, { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' })
  const json = (args: string[]) => {
    const result = wrangler(args)
    if (result.code !== 0) throw new ReleaseFailure('could not read Worker deployment evidence', 2)
    try { return JSON.parse(result.stdout) as unknown }
    catch { throw new ReleaseFailure('Worker deployment evidence is not JSON', 2) }
  }
  const attempt = `ast-${randomUUID()}`
  const version = await applyRelease(sha, attempt, {
    deployment: async () => parseDeploymentList(json(['deployments', 'list', '--json'])),
    version: async (id) => json(['versions', 'view', id, '--json']),
    build: async () => {
      const result = command('npm', ['run', 'build'], 300_000)
      if (result.stdout.trim()) report(result.stdout.trim())
      if (result.stderr.trim()) report(result.stderr.trim())
      return result.code === 0
    },
    verifyCheckout: async () => { checkout(sha) },
    deploy: async () => wrangler(['deploy', '--tag', attempt, '--message', `apple-stores-tracker ${sha}`]).code === 0,
    health,
    rollback: async (id) => wrangler(['rollback', id, '--yes', '--message', 'Guarded release failed verification']).code === 0,
    report,
  })
  report(`RELEASED ${sha} version ${version}`)
}

try { await main() }
catch (error) {
  const failure = error instanceof ReleaseFailure ? error : new ReleaseFailure('release command could not complete', 2)
  report(`RELEASE ${failure.exitCode === 3 ? 'HOLD' : failure.exitCode === 4 ? 'FAILED' : 'ERROR'}: ${failure.message.replace(/[\r\n]+/g, ' ')}`)
  process.exitCode = failure.exitCode
}
