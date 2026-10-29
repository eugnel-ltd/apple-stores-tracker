import { describe, expect, it, vi } from 'vitest'
import {
  applyRelease, belongsToAttempt, healthyRelease, parseDeploymentList, parseReleaseLedger,
  proveGreenChain, ReleaseFailure, requireReleaseCheckout, requireReleaseLedger,
} from '../src/shared/release-guard'
import type { ChainReader, Deployment, ReleaseActions } from '../src/shared/release-guard'

const green = 'Enforcement status: `green since 2026-10-29` (Green on GitHub Free).\n| release | 3 | 0 | adoption |'
const before = 'Enforcement status: `not yet green`\n| release | 3 |'
const head = 'a'.repeat(40)
const parent = 'b'.repeat(40)
const transition = 'c'.repeat(40)
const old = 'd'.repeat(40)

function failure(action: () => unknown, code: number) {
  expect(action).toThrow(ReleaseFailure)
  try { action() } catch (error) { expect(error).toHaveProperty('exitCode', code) }
}

describe('release ledger', () => {
  it('accepts exactly one release row at level 3 or above and a dated green line', () => {
    expect(parseReleaseLedger(green)).toEqual({ releaseLevel: 3, greenSince: '2026-10-29' })
    expect(() => requireReleaseLedger(green.replace('| 3 |', '| 4 |'))).not.toThrow()
    expect(parseReleaseLedger(green.replaceAll('`', '')).greenSince).toBe('2026-10-29')
    expect(parseReleaseLedger(green.replaceAll('\n', '\r\n'))).toEqual(parseReleaseLedger(green))
  })

  it.each([
    green.replace('| 3 |', '| 2 |'),
    green.replace('| release | 3 | 0 | adoption |', ''),
    `${green}\n| release | 4 |`,
    `${green}\n| release | invalid |`,
    green.replace('| 3 |', '| 3oops |'),
  ])('holds a missing, low or ambiguous level: %s', (ledger) => {
    failure(() => requireReleaseLedger(ledger), 3)
  })

  it.each([
    before,
    green.replace('2026-10-29', 'YYYY-MM-DD'),
    green.replace('2026-10-29', '2026-02-30'),
    green.replace('2026-10-29', '2026-1-1'),
    green.replace('green since', 'not green since'),
    green.replace('2026-10-29`', '2026-10-29oops`'),
    `${green}\nEnforcement status: \`not yet green\``,
    '| release | 3 |',
  ])('holds an absent, ambiguous or non-green enforcement line: %s', (ledger) => {
    expect(parseReleaseLedger(ledger).greenSince).toBeNull()
    failure(() => requireReleaseLedger(ledger), 3)
  })
})

describe('release checkout', () => {
  it('accepts only a clean worktree at the full current main SHA', () => {
    expect(() => requireReleaseCheckout('', head, head)).not.toThrow()
    failure(() => requireReleaseCheckout('?? untracked.txt', head, head), 3)
    failure(() => requireReleaseCheckout(' M tracked.ts', head, head), 3)
    failure(() => requireReleaseCheckout('', head, parent), 3)
    failure(() => requireReleaseCheckout('', 'main', 'main'), 3)
  })
})

function chain() {
  const commits: Record<string, { ledger: string; firstParent: string | null }> = {
    [head]: { ledger: green, firstParent: parent },
    [parent]: { ledger: green, firstParent: transition },
    [transition]: { ledger: green, firstParent: old },
    [old]: { ledger: before, firstParent: null },
  }
  const io = {
    readCommit: vi.fn(async (sha: string) => commits[sha]),
    evidence: vi.fn(async (_sha: string) => ({ code: 0, stdout: 'EVIDENCE OK' })),
    remediate: vi.fn(async (_sha: string, _later: readonly string[]) => ({ code: 0, stdout: 'REMEDIATED' })),
    report: vi.fn(),
  } satisfies ChainReader
  return { commits, io }
}

describe('first-parent green-chain evidence', () => {
  it('proves every green commit, including the transition, and stops before its parent', async () => {
    const { io } = chain()
    expect(await proveGreenChain(head, io)).toBe(3)
    expect(io.evidence.mock.calls.map(([sha]) => sha)).toEqual([head, parent, transition])
    expect(io.readCommit.mock.calls.map(([sha]) => sha)).toEqual([head, parent, transition, old])
    expect(io.remediate).not.toHaveBeenCalled()
  })

  it('offers later proved commits newest first and prints the held reason before remediation', async () => {
    const { io } = chain()
    io.evidence.mockImplementation(async (sha) => ({
      code: sha === transition ? 1 : 0, stdout: sha === transition ? 'EVIDENCE HOLD: missing review' : 'EVIDENCE OK',
    }))
    expect(await proveGreenChain(head, io)).toBe(3)
    expect(io.remediate).toHaveBeenCalledExactlyOnceWith(transition, [head, parent])
    expect(io.report.mock.calls.map(([line]) => line)).toEqual([
      'EVIDENCE OK', 'EVIDENCE OK', 'EVIDENCE HOLD: missing review', 'REMEDIATED',
    ])
  })

  it('holds when remediation does not prove the held commit', async () => {
    const { io } = chain()
    io.evidence.mockImplementation(async (sha) => ({ code: sha === parent ? 1 : 0, stdout: 'held reason' }))
    io.remediate.mockResolvedValue({ code: 1, stdout: 'REMEDIATION HOLD' })
    await expect(proveGreenChain(head, io)).rejects.toMatchObject({ exitCode: 3 })
    expect(io.evidence).toHaveBeenCalledTimes(2)
  })

  it('holds HEAD without calling remediation with no later candidates', async () => {
    const { io } = chain()
    io.evidence.mockResolvedValue({ code: 1, stdout: 'EVIDENCE HOLD' })
    await expect(proveGreenChain(head, io)).rejects.toMatchObject({ exitCode: 3 })
    expect(io.remediate).not.toHaveBeenCalled()
  })

  it.each([2, 7])('returns exit 2 for evidence error %s without trying remediation', async (code) => {
    const { io } = chain()
    io.evidence.mockResolvedValue({ code, stdout: '' })
    await expect(proveGreenChain(head, io)).rejects.toMatchObject({ exitCode: 2 })
    expect(io.remediate).not.toHaveBeenCalled()
  })

  it('returns exit 2 for a remediation error', async () => {
    const { io } = chain()
    io.evidence.mockImplementation(async (sha) => ({ code: sha === parent ? 1 : 0, stdout: '' }))
    io.remediate.mockResolvedValue({ code: 2, stdout: '' })
    await expect(proveGreenChain(head, io)).rejects.toMatchObject({ exitCode: 2 })
  })

  it('holds a ledger green back to root', async () => {
    const { commits, io } = chain()
    commits[old].ledger = green
    await expect(proveGreenChain(head, io)).rejects.toMatchObject({ exitCode: 3, message: expect.stringContaining('root') })
    expect(io.evidence).toHaveBeenCalledTimes(4)
  })

  it('treats a missing ledger as before the transition, but never accepts a non-green HEAD', async () => {
    const { commits, io } = chain()
    commits[old].ledger = ''
    expect(await proveGreenChain(head, io)).toBe(3)
    commits[head].ledger = before
    io.evidence.mockClear()
    await expect(proveGreenChain(head, io)).rejects.toMatchObject({ exitCode: 3 })
    expect(io.evidence).not.toHaveBeenCalled()
  })
})

const previous: Deployment = { id: '11111111-1111-4111-a111-111111111111', versionId: '22222222-2222-4222-a222-222222222222' }
const owned: Deployment = { id: '33333333-3333-4333-a333-333333333333', versionId: '44444444-4444-4444-a444-444444444444' }
const other: Deployment = { id: '55555555-5555-4555-a555-555555555555', versionId: '66666666-6666-4666-a666-666666666666' }
const listed = (deployment: Deployment, date: string) => ({
  id: deployment.id, created_on: date, versions: [{ version_id: deployment.versionId, percentage: 100 }],
})

describe('deployment list', () => {
  it('selects the newest single 100% deployment regardless of list order', () => {
    const entries = [listed(previous, '2026-10-28T00:00:00Z'), listed(owned, '2026-10-29T00:00:00Z')]
    expect(parseDeploymentList(entries)).toEqual(owned)
    expect(parseDeploymentList(entries.reverse())).toEqual(owned)
  })

  it.each([
    [], null, {},
    [{ ...listed(owned, '2026-10-29'), versions: [] }],
    [{ ...listed(owned, '2026-10-29'), versions: [
      { version_id: owned.versionId, percentage: 50 }, { version_id: previous.versionId, percentage: 50 },
    ] }],
    [{ ...listed(owned, '2026-10-29'), versions: [{ version_id: owned.versionId, percentage: 99 }] }],
    [{ ...listed(owned, '2026-10-29'), id: 'bad-id' }],
    [{ ...listed(owned, '2026-10-29'), versions: [{ version_id: '', percentage: 100 }] }],
    [listed(owned, 'not a date')],
    [listed(previous, '2026-10-29'), listed(owned, '2026-10-29')],
  ])('rejects empty, split or ambiguous provider state: %j', (value) => {
    failure(() => parseDeploymentList(value), 2)
  })
})

const status = { status: 200, body: { collectedAt: '2026-10-29T00:00:00Z', markets: ['uk'] } }
const snapshot = { status: 200, body: { categories: [{ id: 'mac' }] } }

describe('release health judgement', () => {
  it('requires both HTTP 200 responses and populated snapshot fields', () => {
    expect(healthyRelease(status, snapshot)).toBe(true)
  })

  it.each([
    { status: 503, body: status.body },
    { status: 0, body: null },
    { status: 200, body: '<html>error</html>' },
    { status: 200, body: { collectedAt: null, markets: ['uk'] } },
    { status: 200, body: { collectedAt: ' ', markets: ['uk'] } },
    { status: 200, body: { collectedAt: 'date', markets: [] } },
    { status: 200, body: { collectedAt: 'date', markets: 'uk' } },
  ])('rejects an unhealthy status response: %j', (value) => {
    expect(healthyRelease(value, snapshot)).toBe(false)
  })

  it.each([
    { status: 500, body: snapshot.body },
    { status: 200, body: null },
    { status: 200, body: { error: 'No price data collected yet.' } },
    { status: 200, body: { categories: [] } },
    { status: 200, body: { categories: {} } },
  ])('rejects an unhealthy snapshot response: %j', (value) => {
    expect(healthyRelease(status, value)).toBe(false)
  })
})

const attempt = 'ast-test-attempt'
const versionRecord = { id: owned.versionId, annotations: {
  'workers/tag': attempt, 'workers/message': `apple-stores-tracker ${head}`,
} }

function actions() {
  return {
    deployment: vi.fn<ReleaseActions['deployment']>()
      .mockResolvedValueOnce(previous).mockResolvedValueOnce(previous).mockResolvedValue(owned),
    version: vi.fn(async (_id: string): Promise<unknown> => versionRecord),
    build: vi.fn(async () => true),
    verifyCheckout: vi.fn(async () => {}),
    deploy: vi.fn(async () => true),
    health: vi.fn(async () => true),
    rollback: vi.fn(async (_id: string) => true),
    report: vi.fn(),
  } satisfies ReleaseActions
}

describe('deployment attribution and recovery', () => {
  it('requires immutable version ID, attempt tag and source message', () => {
    expect(belongsToAttempt(versionRecord, owned, attempt, head)).toBe(true)
    for (const value of [null, { ...versionRecord, id: previous.versionId },
      { ...versionRecord, annotations: { ...versionRecord.annotations, 'workers/tag': 'another-attempt' } },
      { ...versionRecord, annotations: { ...versionRecord.annotations, 'workers/message': `apple-stores-tracker ${parent}` } },
    ]) expect(belongsToAttempt(value, owned, attempt, head)).toBe(false)
  })

  it('returns the version only after attributed deployment, health and a fresh identity check', async () => {
    const io = actions()
    expect(await applyRelease(head, attempt, io)).toBe(owned.versionId)
    expect(io.deployment).toHaveBeenCalledTimes(4)
    expect(io.rollback).not.toHaveBeenCalled()
  })

  it('never deploys after a failed build, changed checkout or intervening deployment', async () => {
    for (const mode of ['build', 'checkout', 'deployment']) {
      const io = actions()
      if (mode === 'build') io.build.mockResolvedValue(false)
      if (mode === 'checkout') io.verifyCheckout.mockRejectedValue(new ReleaseFailure('checkout changed', 3))
      if (mode === 'deployment') io.deployment.mockReset().mockResolvedValueOnce(previous).mockResolvedValue(other)
      await expect(applyRelease(head, attempt, io)).rejects.toMatchObject({ exitCode: 3 })
      expect(io.deploy).not.toHaveBeenCalled()
    }
  })

  it('rolls back failed health to the captured version, verifies recovery and exits 4', async () => {
    const io = actions()
    io.health.mockResolvedValueOnce(false).mockResolvedValue(true)
    io.deployment.mockResolvedValueOnce(owned).mockResolvedValueOnce(owned).mockResolvedValue(previous)
    await expect(applyRelease(head, attempt, io)).rejects.toMatchObject({ exitCode: 4, message: expect.stringContaining('health OK') })
    expect(io.rollback).toHaveBeenCalledExactlyOnceWith(previous.versionId)
    expect(io.health).toHaveBeenCalledTimes(2)
  })

  it('reconciles a lost deployment response and recovers only an attributed change', async () => {
    const io = actions()
    io.deploy.mockRejectedValue(new Error('timeout'))
    io.deployment.mockResolvedValueOnce(owned).mockResolvedValueOnce(owned).mockResolvedValue(previous)
    await expect(applyRelease(head, attempt, io)).rejects.toMatchObject({ exitCode: 4 })
    expect(io.rollback).toHaveBeenCalledExactlyOnceWith(previous.versionId)
  })

  it('does not roll back when a failed command left the previous deployment active', async () => {
    const io = actions()
    io.deploy.mockResolvedValue(false)
    io.deployment.mockResolvedValue(previous)
    await expect(applyRelease(head, attempt, io)).rejects.toMatchObject({ exitCode: 4, message: expect.stringContaining('previous deployment remains active') })
    expect(io.rollback).not.toHaveBeenCalled()
  })

  it('reports UNKNOWN without rollback if attribution is absent or unreadable', async () => {
    for (const unreadable of [false, true]) {
      const io = actions()
      if (unreadable) io.version.mockRejectedValue(new Error('provider unavailable'))
      else io.version.mockResolvedValue({ ...versionRecord, annotations: {} })
      await expect(applyRelease(head, attempt, io)).rejects.toMatchObject({ exitCode: 4, message: expect.stringContaining('deployment UNKNOWN') })
      expect(io.rollback).not.toHaveBeenCalled()
    }
  })

  it('does not undo an intervening deployment after failed health', async () => {
    const io = actions()
    io.health.mockResolvedValue(false)
    io.deployment.mockResolvedValueOnce(owned).mockResolvedValue(other)
    await expect(applyRelease(head, attempt, io)).rejects.toMatchObject({ exitCode: 4, message: expect.stringContaining('deployment UNKNOWN') })
    expect(io.rollback).not.toHaveBeenCalled()
  })

  it('does not claim a healthy release if its deployment has been superseded', async () => {
    const io = actions()
    io.deployment.mockResolvedValueOnce(owned).mockResolvedValue(other)
    await expect(applyRelease(head, attempt, io)).rejects.toMatchObject({ exitCode: 4, message: expect.stringContaining('deployment UNKNOWN') })
    expect(io.rollback).not.toHaveBeenCalled()
  })

  it('reports a rollback that failed to restore the captured version', async () => {
    const io = actions()
    io.health.mockResolvedValue(false)
    io.rollback.mockResolvedValue(false)
    await expect(applyRelease(head, attempt, io)).rejects.toMatchObject({ exitCode: 4, message: expect.stringContaining('deployment UNKNOWN') })
    expect(io.rollback).toHaveBeenCalledOnce()
  })
})
