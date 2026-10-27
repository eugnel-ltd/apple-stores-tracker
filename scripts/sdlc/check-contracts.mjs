import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const failures = []

function read(path) {
  const full = resolve(root, path)
  if (!existsSync(full)) {
    failures.push(`${path}: missing`)
    return ''
  }
  return readFileSync(full, 'utf8')
}

function requireText(path, content, needles) {
  for (const needle of needles) {
    if (!content.includes(needle)) failures.push(`${path}: missing ${JSON.stringify(needle)}`)
  }
}

const agents = read('AGENTS.md')
const claude = read('CLAUDE.md')
const sdlc = read('docs/agents/ai-sdlc.md')
const skill = read('.claude/skills/apple-stores-tracker/SKILL.md')
const reviewer = read('.claude/agents/ai-sdlc-reviewer.md')
const workflow = read('.github/workflows/ci.yml')
const route = read('scripts/sdlc/route.mjs')
const routeTest = read('scripts/sdlc/route.test.mjs')
const template = read('.github/pull_request_template.md')
const packageText = read('package.json')

requireText('AGENTS.md', agents, [
  'Human judgement stays above the routine loop',
  'one owner, one branch, and one ordinary PR',
  'Under-engineered',
  'Over-engineered',
  'Right-sized',
  '## External-effect boundary',
  'docs/agents/ai-sdlc.md',
])
requireText('CLAUDE.md', claude, ['Read and obey `AGENTS.md`', 'routine work should continue'])
requireText('docs/agents/ai-sdlc.md', sdlc, [
  'smallest sufficient context',
  '## 4. Research loop and delivery loop',
  '## 7. Exact-head review',
  '## 3. Owner operating model: human above, not inside',
  'no-compromise test',
])
requireText('.claude/skills/apple-stores-tracker/SKILL.md', skill, [
  'RequestBudget',
  '`configKey`',
  'npm run ci',
  'live Apple',
  'External-effect boundary',
])
requireText('.claude/agents/ai-sdlc-reviewer.md', reviewer, [
  'permissionMode: plan',
  'isolation: worktree',
  '`APPROVE`',
  '`REQUEST_CHANGES`',
  '`INCONCLUSIVE`',
  'Do not edit, commit, push, merge, deploy, contact providers',
])
requireText('.github/pull_request_template.md', template, [
  '## Outcome',
  '## Non-goals and boundaries',
  '## Evidence map',
  'Exact final head',
  'External effects and residual risk',
])
requireText('scripts/sdlc/route.mjs', route, [
  "'--no-renames'",
  "scope: 'governance'",
  "scope: 'full'",
  'comparison-unavailable',
  'isGovernanceMarkdown',
])
requireText('scripts/sdlc/route.test.mjs', routeTest, [
  'renaming production code to Markdown cannot hide the deletion',
  'empty or unresolved input fails closed to full',
])
requireText('.github/workflows/ci.yml', workflow, [
  'pull_request:',
  'push:',
  'workflow_dispatch:',
  'permissions:',
  'contents: read',
  'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
  'persist-credentials: false',
  'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38',
  'scripts/sdlc/route.mjs',
  'ref: ${{ github.event.pull_request.head.sha || github.sha }}',
  'npm ci',
  'npm test',
  'npm run build',
  'cancel-in-progress:',
])

if (agents.length > 7_000) failures.push('AGENTS.md: exceeds 7,000-character progressive-disclosure budget')
if (claude.length > 1_500) failures.push('CLAUDE.md: exceeds 1,500-character entry-point budget')
if (workflow.includes('pull_request_target:')) failures.push('workflow: pull_request_target is forbidden')
for (const forbidden of ['wrangler deploy', 'db:migrate', 'scripts/collect.ts', 'apple.com/']) {
  if (workflow.includes(forbidden)) failures.push(`workflow: forbidden external-effect token ${forbidden}`)
}

try {
  const pkg = JSON.parse(packageText)
  const scripts = pkg.scripts ?? {}
  if (scripts['check:governance'] !== 'node scripts/sdlc/check-contracts.mjs && node --test scripts/sdlc/route.test.mjs') {
    failures.push('package.json: check:governance script drift')
  }
  if (scripts.ci !== 'npm run check:governance && npm test && npm run build') {
    failures.push('package.json: ci script drift')
  }
} catch (error) {
  failures.push(`package.json: invalid JSON (${error.message})`)
}

if (failures.length > 0) {
  console.error('AI-SDLC contract: FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('AI-SDLC contract: PASS')
