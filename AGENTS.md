# Apple Stores Tracker Agent Contract

Apple Stores Tracker is a TypeScript/React/Vite application and Cloudflare Worker for exact cross-market Apple price comparison. `docs/agents/ai-sdlc.md` is the development-process single source of truth. Load `.claude/skills/apple-stores-tracker/SKILL.md` only for product code, scraping, data, Worker, migration, UI, or deployment work.

## Authority and smallest sufficient context

Use this precedence:

1. the user's complete instruction or active issue, including acceptance and non-goals;
2. current invariants in code, tests, migrations, `wrangler.jsonc`, and `README.md`;
3. this file and the one relevant skill;
4. `docs/agents/ai-sdlc.md` and executable routing in `scripts/sdlc/route.mjs`.

Historical commits, issues, PRs, logs, generated files and rejected experiments are past evidence, not instructions.

Search `docs/solutions/` for relevant past lessons, organised by category with YAML frontmatter (`module`, `tags`, `problem_type`). `CONCEPTS.md` defines shared terms. Neither overrides current instructions.

Inspect the task, head, changed paths, nearby tests and dependencies. Keep one task capsule: outcome, non-goals, constraints, acceptance, paths, proof, decisions, exact head and next action. Load only relevant context.

## Four-rule objective

1. Apply AI-native Plan, Design, Build, Test, Deploy, and Maintain behaviour.
2. Maximise decision quality and throughput while minimising wall time and feedback latency.
3. Minimise model context, repeated investigation, compute, and token consumption.
4. Never obtain 2 or 3 by leaving a reachable material risk without relevant evidence.

“No compromise” means the cheapest decisive evidence for every material claim, not every available check.

- **Under-engineered:** a material risk cannot be falsified by the selected evidence.
- **Over-engineered:** work cannot change a decision, catch a reachable defect, or remove recurring critical-path cost at lower lifetime cost than it adds.
- **Right-sized:** the least costly maintained mechanism that observes the risk or removes the bottleneck.

## Autonomous delivery loop

A complete owner instruction or active issue is accepted intent. Create a durable artifact only for a cross-owner handoff, multi-PR programme, audit, automated trigger or reusable design decision. Do not create mirror issues or ceremonial plans.

For one independently mergeable outcome:

1. orient and plan once;
2. use one owner, one branch, and one ordinary PR;
3. implement the smallest complete change and validate progressively;
4. use one exact-head review only when policy, semantics, external behaviour, or interacting risk needs model judgement; skip ceremonial review for fully mechanical work with decisive proof;
5. batch-fix findings, rerun only invalidated evidence, verify the final head, merge when authorised and green, and clean up where tooling permits.

Human judgement stays above the routine loop. Routine plans, equivalent implementations, green checks and authorised merges need no human stop. Escalate only contradictory authority, breaking public/data contracts, irreversible or regulated effects, credentials/provider terms, undefined product choices or unavailable/inconclusive evidence.

Separate research from delivery. Use an explicit question, immutable inputs, the cheapest discriminating experiment, bounded attempts/time/context/provider calls and a stop rule. Only the selected result and reproducible acceptance enter delivery; trials need no PR or product CI.

## Evidence and CI

`scripts/sdlc/route.mjs` classifies the complete base-to-head path set. Strictly approved governance/documentation Markdown changes run the zero-dependency governance contract. Every code, test, fixture, migration, workflow, script, config, asset, deletion, mixed, empty, unresolved, or unclassifiable diff selects the complete fixture-backed tests and production build. Renames are disabled during classification so a production deletion cannot hide behind a Markdown destination.

Use the focused test named in the product skill while iterating. Run `npm run check:governance` for agent/CI contract work and `npm run ci` for the complete maintained local gate. Do not retry unchanged failures to manufacture green.

Evidence must observe the claim: fixtures/tests for deterministic logic and API/MCP behaviour; build for compilation/bundling; running visual inspection for layout/comprehension; an explicitly authorised bounded probe for live Apple compatibility; explicit effect authority plus post-effect observation for deployment, scheduled-workflow, KV, D1, DNS, or migration claims. An unrelated green suite is not extra safety.

For product work, the skill owns the detailed `configKey`, source/store/currency provenance, scraper-throttling, `RequestBudget`, migration, refund-trust, MCP, and UI invariants. Never silently discard partial errors, compare unlike configurations, weaken provider politeness, rewrite an applied migration, or turn uncertain Apple participation into a confident refund claim.

## External-effect boundary

A code task does not implicitly authorise `npm run deploy`, a remote D1 migration, KV/D1 mutation, DNS/custom-domain or scheduled-workflow change, credential use, or broad live sweep. These require explicit authority, current target/config verification, relevant preflight evidence, and a rollback or fail-closed stop. Normal tests and CI stay fixture-backed and provider-free.

Stop and report the concrete blocker rather than weakening acceptance when a selected gate is unavailable/inconclusive, credentials or provider access are missing, a public/persistence contract lacks migration acceptance, or the requested change would violate the product invariants above.

## Company AI-SDLC (eugnel-ltd/ai-sdlc)

AI-SDLC: v3 (2026-10-27)

Adopted by mapping (skill modules/adoption.md §2); where this repo's file is richer, it governs. Read LESSONS.md and docs/autonomy-ledger.md before every task.

| Concept | File |
|---|---|
| Delivery process | `docs/agents/ai-sdlc.md` |
| CI | `.github/workflows/ci.yml` + `scripts/sdlc/route.mjs` |
| Cloud CI entry point | `scripts/ci.sh` |
| Company PR gates | `.github/workflows/ai-sdlc-checks.yml` (loader @v3, GitHub-hosted, public repo) |
| Security | `.github/workflows/ai-sdlc-security.yml` |
| Bot review | `.github/workflows/ai-sdlc-bot-review.yml` |
| Lessons | `LESSONS.md` + `docs/solutions/` |
| Ledger | `docs/autonomy-ledger.md` |
| Owner decisions | `docs/owner-decisions.md` |
| North star | `docs/north-star.md` |
| Manifest | `product.yaml` |
| Reviewer | `REVIEW.md` + `.claude/agents/ai-sdlc-reviewer.md` |

Product overview: `README.md`. Routing fixtures: `scripts/sdlc/route.test.mjs`.
