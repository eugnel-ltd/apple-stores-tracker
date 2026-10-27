## Outcome

<!-- What user/product outcome does this PR deliver? -->

## Non-goals and boundaries

<!-- What is deliberately unchanged? Name any external effects not authorised. -->

## Key decision

<!-- Smallest complete design and important rejected alternative, if material. -->

## Evidence map

| Claim or risk | Decisive evidence | Result |
| --- | --- | --- |
|  |  |  |

## AI-SDLC route

- Route: `governance` / `full`
- Exact final head: `SHA`
- Independent review: `not required` / `APPROVE SHA` / blocker

## External effects and residual risk

<!-- Provider calls, deployment, migration, KV/D1/DNS mutation, credentials, or none. State residual uncertainty honestly. -->

## Review and autonomy

- Written by: <one company: dot (OpenAI) for native work | vendor from `vendor_run.py` (codex, grok) | Claude: design work | Claude: vendor lane exited 1>
- Orchestrator commits: <each `Orchestrated-by: Claude` commit as `<sha> <subject>`, or "none">
- Reviewer: <agent and vendor; fall-back reason if not the primary>. Verdict: <APPROVE | REQUEST CHANGES>. Reviewed head: <sha>
- ACCEPTED limits: <finding, why it fails safe, follow-up issue>, or "None"
- Task type and level: `<type>` at level <n>. This PR stops at: <merge | release | nothing>
- Expenditure: <none | approved YYYY-MM-DD (the owner's Expenditure decision this PR carries out) | yes: a spend proposal goes to the owner>
- Human review paths touched: <none | path, owner>
- Remediates: <optional; the full sha of a base commit whose release evidence holds and that this PR fixes. Delete this line otherwise. The independent reviewer confirms each cause before writing its own `Remediates:` line; this line alone releases nothing.>
