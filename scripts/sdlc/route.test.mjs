import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { changedPaths, classifyPaths } from './route.mjs'

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

test('strictly Markdown-only changes select governance', () => {
  assert.deepEqual(classifyPaths(['AGENTS.md', 'docs/agents/ai-sdlc.md']), {
    scope: 'governance',
    reason: 'governance-markdown-only',
  })
})

test('code, config, workflow, fixture, or mixed changes select full', () => {
  for (const paths of [
    ['src/worker/index.ts'],
    ['package.json'],
    ['.github/workflows/ci.yml'],
    ['tests/fixtures/provider.json'],
    ['src/runtime.md'],
    ['README.md', 'src/shared/convert.ts'],
  ]) {
    assert.equal(classifyPaths(paths).scope, 'full')
  }
})

test('empty or unresolved input fails closed to full', () => {
  assert.deepEqual(classifyPaths([]), {
    scope: 'full',
    reason: 'empty-or-unresolved-diff',
  })
})

test('renaming production code to Markdown cannot hide the deletion', () => {
  const repo = mkdtempSync(join(tmpdir(), 'apple-sdlc-route-'))
  git(repo, 'init', '-q')
  git(repo, 'config', 'user.name', 'fixture')
  git(repo, 'config', 'user.email', 'fixture@example.invalid')

  mkdirSync(join(repo, 'src'))
  writeFileSync(join(repo, 'src/runtime.ts'), 'export const live = true\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'base')
  const base = git(repo, 'rev-parse', 'HEAD')

  mkdirSync(join(repo, 'docs'))
  renameSync(join(repo, 'src/runtime.ts'), join(repo, 'docs/runtime.md'))
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'rename')
  const head = git(repo, 'rev-parse', 'HEAD')

  const paths = changedPaths(base, head, repo).sort()
  assert.deepEqual(paths, ['docs/runtime.md', 'src/runtime.ts'])
  assert.equal(classifyPaths(paths).scope, 'full')
})
