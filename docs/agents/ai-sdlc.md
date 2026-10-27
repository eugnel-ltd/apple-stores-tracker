# Apple Stores Tracker AI-Native SDLC

**Status:** development-process single source of truth. `AGENTS.md` is the concise always-loaded execution kernel.

This operating model adapts Anthropic's [AI-Native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook) to a small TypeScript, React, Vite, Vitest, and Cloudflare Worker repository. It keeps the playbook's six-stage loop—Plan, Design, Build, Test, Deploy, Maintain—while removing artifacts, handoffs, and approval pauses that do not improve a decision.

The objective is not less thought or less assurance. It is the highest useful delivery throughput and decision quality with the least irrelevant context, repeated work, compute, human waiting, and feedback latency.

## 1. Optimisation target and no-compromise test

Use this equation as the governing heuristic:

> **smallest sufficient context + smallest decisive experiment + smallest relevant gate + one integration boundary**

The total cost to minimise includes model context, repeated investigation, CI runner time, provider requests, human review time, reruns, and escaped defects.

For every proposed document, agent, workflow, test, gate, abstraction, or harness, ask:

- **Under-engineered:** does a reachable material acceptance, compatibility, security, data, provider, or operational risk lack evidence capable of falsifying it?
- **Over-engineered:** can this activity change a decision, catch a reachable defect, or remove recurring critical-path work at lower lifetime cost than it adds?
- **Right-sized:** is this the cheapest maintained mechanism that observes the risk or removes the bottleneck?

“More assurance” is not enough. Name the claim or risk, its trigger, the evidence that observes it, its expected recurring cost, and when the mechanism should be narrowed or deleted.

## 2. Anthropic stage chain without ceremony

The six stages remain present but do not need six separate files for every change.

| Stage | Repository artifact or action |
|---|---|
| Plan | complete owner instruction, active issue, incident, or accepted intent artifact |
| Design | task capsule; durable spec only when another owner, audit trail, trigger, or programme needs it |
| Build | smallest coherent diff, tests, and updated institutional knowledge |
| Test | progressive deterministic evidence and risk-required exact-head review |
| Deploy | ordinary PR, selected checks, merge, and explicit external-effect boundary |
| Maintain | production observation or escaped defect becomes the next accepted intent and improves the governing test, skill, or contract |

A complete direct instruction or active issue is already accepted intent. The task capsule is the working requirements, design, and plan:

- intended outcome and why it matters;
- non-goals and forbidden widening;
- active constraints and source-of-truth references;
- acceptance criteria;
- affected surfaces and dependency radius;
- proof mapped to each material claim;
- exact base/head, current diff, decisions, evidence, and next action;
- concrete stop conditions.

Do not manufacture `intent.md`, `spec.md`, or `plan.md` when the contract is already complete and the same owner remains responsible. Commit a separate artifact only when one of these is true:

- ownership crosses people, agents, sessions, or repositories;
- a programme spans several independently mergeable PRs;
- audit, release, or compliance requires a durable stage decision;
- an automated trigger consumes the artifact;
- the design is reusable institutional knowledge rather than task-local state.

An accepted artifact should start the next routine action automatically where tooling supports it. Otherwise the same owner continues; a human does not need to restate the next stage.

## 3. Owner operating model: human above, not inside

The human owner controls the system through boundaries and outcomes, not by approving each mechanical action.

The owner should provide:

- the outcome and why it matters;
- hard non-goals and product boundaries;
- material risk tolerance or compatibility requirements;
- authority for irreversible, credentialed, provider-facing, financial, regulated, or production effects;
- a decision only when binding evidence leaves materially different valid choices.

The owner should normally receive:

- a compact final outcome or a single genuine blocker;
- the exact PR/head and selected evidence;
- material trade-offs, residual risk, and external effects;
- no stream of routine plan approvals, equivalent implementation choices, repeated green checks, or merge-button handoffs.

A normal bounded task therefore runs autonomously from accepted intent through orientation, implementation, relevant evidence, final review when required, PR, merge, and cleanup. Human escalation is reserved for:

- contradictory binding authorities or acceptance criteria;
- breaking public, persistence, identity, or migration contracts;
- irreversible, legal, financial, regulated, or production actions;
- new credentials, provider terms, or access grants;
- a product-defining subjective choice absent from the source of truth;
- an unavailable or inconclusive relevant gate.

Escalate one concise decision with the competing options, evidence, and consequence. Once resolved, the same owner resumes the loop.

## 4. Research loop and delivery loop

### Research loop

Use this for uncertain scraper compatibility, provider behaviour, tax-policy interpretation, architecture alternatives, performance hypotheses, or UI exploration.

Before spending provider requests or model context, record a compact research contract:

- question and decision to be made;
- falsifiable hypothesis or competing options;
- immutable inputs and owned output location;
- cheapest experiment that separates the options;
- budget for attempts, provider calls, wall time, and context;
- success, stop, and inconclusive criteria.

Run independent experiments in isolation. Prefer fixtures, captured responses, and deterministic local probes. Do not modify production truth merely to try a candidate, do not open one PR per trial, and do not run product CI for pure exploration.

The output is a decision record: evidence, caveats, rejected alternatives, and the selected result—or an explicit stop.

### Delivery loop

Promotion begins only when the selected result and acceptance are stable. One independently mergeable outcome gets one owner, one branch, and one ordinary PR.

Do not reopen open-ended research during implementation unless new evidence invalidates a premise. Pause delivery, state the new bounded question, and resolve it separately. Promote only the selected decision, required data, and reproducible acceptance—not every transcript, failed prompt, or exploratory branch.

## 5. Execution protocol

### Orient once

Search filenames and symbols before opening long files. Read the issue/instruction, changed surface, nearby tests, and one relevant skill. Stop loading context when acceptance, invariants, and dependency radius are understood.

### Plan once

Choose the smallest complete implementation and cheapest decisive proof for each risk. Order checks from fast and diagnostic to slow and integrative. State what evidence would make the plan wrong. Do not produce repeated plans that only paraphrase the task.

### Execute narrowly

Change owned paths only. Prefer deletion, reuse, native platform facilities, and simple data flow over speculative abstraction. Keep research output separate from production. Avoid unrelated cleanup unless a touched defect is safe, obvious, and cheaper to remove now than to preserve.

### Validate progressively

During iteration, run the focused command that answers the current question. Do not run the complete suite after every edit and do not defer every check until the end.

Before first push, run every selected check once on the coherent candidate when practical. The complete maintained product gate is:

```bash
npm run ci
```

It runs the governance contract, all fixture-backed tests, TypeScript compilation, and the production Vite build. It does not contact Apple, the FX provider, Cloudflare production, KV, D1, or DNS.

### Integrate once

Keep the PR body compact: outcome, non-goals, key decision, selected route, evidence mapped to claims, exact final head, independent reviewer verdict when required, external effects, and residual risk.

Batch concrete findings, fix them together, and rerun only evidence invalidated by the fix. Do not retry unchanged failures to produce a green status.

## 6. CI routing and evidence economy

`scripts/sdlc/route.mjs` is the executable selection authority.

- Strictly governance/documentation Markdown changes in approved roots select `governance`: no dependency installation, product test, or bundle build.
- Any code, test, fixture, migration, JSON, lockfile, workflow, script, config, asset, deletion, mixed change, empty diff, missing comparison base, or classification failure selects `full`.
- Classification uses a complete base-to-head diff with renames disabled. A rename from production code to Markdown is therefore a production deletion plus a Markdown addition and selects `full`.
- Superseded heads of the same PR are cancelled; integrated `main` commits are not cancelled by later commits.
- Workflow actions are pinned to exact commits. CI has read-only contents permission and contains no deploy, migration, live-sweep, credential, or provider mutation command.

The repository is small enough that further production sub-scopes would currently add more routing authority and maintenance cost than they save. Add a narrower scope only after measured recurring gate cost identifies a bottleneck and a deterministic path-to-risk map can preserve coverage.

Evidence must observe the property claimed:

| Claim | Decisive evidence |
|---|---|
| selector/parser shape | captured fixture and focused parser test |
| exact cross-market identity | `configKey` agreement test over captured pages from more than one market — a single-market fixture cannot observe a key disagreement |
| conversion/refund/history logic | boundary-focused deterministic unit tests |
| sweep request safety | planning and `RequestBudget` tests for the worst step, not the average |
| scheduler behaviour | deterministic time-controlled schedule tests |
| API/MCP response contract | request/response tests |
| TypeScript and bundle integration | `npm run build` |
| UI composition/comprehension | running visual inspection at affected desktop and narrow widths |
| live Apple compatibility | explicitly authorised bounded read-only probe |
| Cloudflare deployment/migration | explicit authority, preflight, effect receipt, and post-effect observation |
| agent-policy change | structural governance checker plus one independent semantic review |

An unrelated green suite is not extra safety. A screenshot cannot prove parser correctness; a unit test cannot prove visual quality; a local build cannot prove production deployment.

## 7. Exact-head review

Use one independent final-candidate review when model judgement or policy changed, or when a non-mechanical multi-file diff creates interacting risk. Fully mechanical changes with decisive deterministic proof do not spend tokens on ceremonial review.

The reviewer is `.claude/agents/ai-sdlc-reviewer.md`. Give it only:

- task outcome, acceptance, and non-goals;
- exact base and candidate head SHAs;
- active constraints and authoritative sources;
- deterministic evidence already produced for that exact head.

Do not give it the author transcript, rationale, confidence, or previous praise. Its distinct hypothesis is to find acceptance gaps, invariant violations, under-engineering, over-engineering, scope drift, wall-time/token regressions, evidence mismatch, and fail-open paths.

It returns `APPROVE`, `REQUEST_CHANGES`, or `INCONCLUSIVE` for the exact head. Batch-fix blockers and review the new head once. Another loop requires a new defect or invalidated evidence, not a generic request for more opinions.

When author and reviewer share the same GitHub identity, record the exact-head verdict as a PR comment rather than manufacturing an identity-based approval.

## 8. Context, token, and concurrency discipline

- Root instructions contain only permanent first-day rules; details live in the process SSOT and one on-demand skill.
- Search before reading. Load one relevant skill, not every file or reference repository.
- Batch independent reads and tool calls. Do not repeatedly restate the task capsule.
- Use deterministic code for discovery, classification, mechanical checks, and evidence capture. Use model judgement for architecture, ambiguity, product trade-offs, and adversarial review.
- Maintain one source of task state. Do not let issue comments, scratch plans, PR narratives, and transcripts drift independently.
- On handoff or compaction, transfer the capsule, exact head, diff, evidence, and exact failing command—not the whole conversation.
- Parallelise only independently mergeable work with separate branches and no shared mutable files/evidence. Never let multiple agents or machines mutate one branch or worktree.
- Stop when evidence is decisive. Additional review after the decision boundary usually adds cost without reducing reachable risk.
- Do not build token telemetry unless the platform exposes real aggregate usage and a concrete decision would change because of it.

## 9. External effects and fail-closed operation

Code acceptance is separate from operational authority.

The following require explicit authority in the active task: `npm run deploy`, remote D1 migration, KV/D1 production mutation, DNS/custom-domain change, cron change, credential use, or broad live scraping. Verify the current target and configuration first, run relevant preflight evidence, state the rollback or stop rule, execute the minimum effect, and observe the result independently.

Tests and normal CI remain fixture-backed and provider-free. A live read-only probe is not routine validation; use it only when the claim cannot be established otherwise and the task authorises provider contact.

If relevant credentials, provider access, or evidence are unavailable, stop with the named blocker. Do not substitute an unrelated green check or weaken acceptance.

## 10. Maintain and improve the loop

An escaped defect is evidence about the process, not a reason to lengthen every future prompt.

After a material escape, identify the cheapest recurring prevention point:

1. a deterministic fixture or boundary test;
2. a correction to `AGENTS.md` if it is a permanent first-day rule;
3. a correction to the product skill if it is domain-specific;
4. a checker/router fixture if the failure was mechanical;
5. a new gate only when the reachable risk cannot be observed by an existing cheaper mechanism.

Useful metrics are measured from existing records, not a second telemetry system:

- time from accepted intent to merged PR;
- number of author/review fix cycles;
- selected route and gate duration;
- escaped defects by missing evidence type;
- repeated agent mistakes that should have been prevented by current instructions;
- provider calls and production mutations only when they are already observable.

Delete or narrow a mechanism when it no longer changes decisions or when a cheaper maintained proof replaces it.
