# Owner decisions

Decisions that PRs must not reverse. Append-only. The orchestrator adds entries with `scripts/record_decision.sh` from the AI-SDLC skill; nobody edits or removes one. CI fails a PR that removes a line from this file.

- The orchestrator records a decision when the owner states one and quotes the owner's words. A paraphrase says so. The owner can add or correct entries at any time.
- A task that would reverse an entry is not done, and the digest says so. Do not open a PR that contradicts an entry.
- What waits on the owner: only expenditure (AI-SDLC `modules/autonomy.md`).
- **Expenditure** entries record approved spend: a new paid service, an API key for a paid service, a spend-cap rise, a one-off purchase or ad spend. Without an entry the agent does not spend; proposals go to the owner bundled in one message.
- The autonomy levels live in `docs/autonomy-ledger.md`, not here. An entry here can set a level by hand.

Entry format (newest first):

```markdown
## YYYY-MM-DD: <decision, one line>
- Decision: <what was decided>
- Why: <the owner's reason, quoted; or "Paraphrased: ...">
- Scope: <what it covers, and what it does not>
```

## Decisions
