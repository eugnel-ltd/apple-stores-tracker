# REVIEW.md

What the independent reviewer checks on every PR. The reviewer reads this file first, then uses the AI-SDLC review prompt (`references/review-prompt.md`). Changed by PR.

## Reviewer

- Primary: codex `<model>`, read-only: no file edits, no state-changing git commands, no network writes.
- Fall-backs when the primary's quota is spent or it cannot sign in, in order: `<Grok Build, Cursor CLI, Claude Code (claude-team, never for Claude-written work), Antigravity CLI>`.
- Last resort: a Claude subagent in a fresh context. The PR says so, and the task type cannot merge above level 2 on that review.

<!-- Every open PR needs a reviewer vendor that differs from every writer (modules/review.md, Reviewer vendor). The optional line `Reviewer vendor: distinct from every writer since YYYY-MM-DD` at column 0 only sets the date from which release replay of merged PRs applies that rule. -->

Findings P0–P3, each with `file:line`, posted on the PR as a comment with `VERDICT:` and `Reviewed head: <sha>` lines. Re-reviews cover only the fix diff.

## Passes

Run all three, in order, against the PR's diff:

1. **Bugs and logic:** correctness on real inputs (empty and missing values, boundaries, time zones, encodings, concurrency, retries), failure behaviour when a dependency is down or wrong, silent failures, and whether the regression test really fails on the old code.
2. **Security:** secrets, injection, authorisation, untrusted input, new dependencies. Check every added or changed `.secret-scan-allow` line against its upstream source: the listed file must be the published package file and the matched text must be code, not a key. A real key never gets a line. A PR that lists a file without a verifiable upstream source fails this security pass.
3. **Compliance:** the diff against the issue, the spec and plan when present, `docs/code-standards.md`, `docs/owner-decisions.md` and `docs/north-star.md`. A diff that departs from the plan without an update to the plan fails this pass. A diff that spends money without an `Expenditure:` decision fails this pass.

- Cloudflare: D1 queries that can return many rows have `LIMIT`; no D1 query inside a loop over rows or requests (use one statement or `db.batch()`); Pages Functions write or paid-API endpoints are rate-limited. See `modules/autonomy.md`, "Cloudflare cost guard".

## Severity

- **Important** (blocks): P0 data loss, security hole, outage or irreversible damage; P1 wrong behaviour on a real path, or an acceptance criterion fails; P2 edge-case bug, weak or missing test, undisclosed unrun check, missing docs.
- **Nit** (never blocks): P3. Report at most **5** per review; drop the rest.
- **Pre-existing** (never blocks): a fault the base already has, on a path this PR does not change, whatever its severity. A fault the PR newly exposes is its own finding. It becomes a follow-up intent.

## What failure looks like

<One or two lines per area: how a bad change shows itself in this repo, so the reviewer looks there first. For example: docs, "it lies"; configuration, "it misroutes"; payments, "a charge without an entitlement".>

## Exclusions

Do not review:

- generated files, lockfiles and vendored code: `<paths>`;
- anything CI already enforces (formatting, lint, type checks): `<checks>`.

## Doc-only fast lane

A diff takes the doc-only fast lane when it changes nothing that runs, is copied, or is read as an instruction. In: `README.md`, `LESSONS.md`, `docs/solutions/`, `docs/metrics.md`, and prose under `docs/` that no agent or tool acts on. Out, always the full lane: `AGENTS.md`, `CLAUDE.md`, `REVIEW.md`, `docs/code-standards.md`, `docs/owner-decisions.md`, `docs/autonomy-ledger.md`, `docs/north-star.md`, `docs/plans/TEMPLATE.md`, skills, modules, prompts, agent definitions, hooks, workflows, scripts, templates of any kind, configuration, code and tests. The lane gets the compliance pass and the writing check (`modules/writing.md`). No regression test is required.

## Human review required

Paths that get the full review lane and extra care. A PR that touches them merges at its type's level and the digest names it; it does not wait for the owner (AI-SDLC `modules/autonomy.md`).

- `docs/owner-decisions.md`: the owner (append-only; CI checks it).
- `<path>`: `<owner>`

## Separation of duties

- The agent that wrote the change never reviews or approves it.
- A security fix is never approved by the agent that wrote it.

## Feedback

A kind of finding seen on two PRs becomes a `LESSONS.md` entry. A promoted lesson that a machine can check becomes a hook, lint or CI check, not another review pass.
