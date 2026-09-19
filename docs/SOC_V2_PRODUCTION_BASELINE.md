# SOC v2 Production Baseline

**Status: ACCEPTED AND FROZEN**

This document records the formally accepted production baseline for the SOC v2 architecture. It is documentation only — it does not describe intended or aspirational behaviour, only what was actually verified in production at acceptance.

## Accepted baseline

| | |
|---|---|
| Accepted commit / deployed SHA | `a2f3a400f6e4ccd66b9a823ea8ea00c7c31ced82` |
| Git tag | `soc-v2-production-accepted` (points exactly to the SHA above) |
| Acceptance date | 19 September 2026 |
| Production acceptance session | `98175a40-719d-46fe-a36d-6b9134c7516d` |
| Final accepted report | `7557500e-fa09-42f7-9277-133323e4293e` |

## Architecture

```
Phase C — live inspection processing
  → D1 — canonical generation input / generation barrier
  → D2 — reconciliation
  → D3 — professional drafting
  → D4 — Fidelity Audit and repair
  → D5 — Professional Quality Audit
  → D6 — Post-Quality Factual Guard
  → final SOC
```

This is the actual, verified path the production Generate button uses — confirmed from the accepted report's own persisted `_soc_v2_metadata`, not inferred from code.

## Acceptance evidence

- 509 tests passing at acceptance, 0 failures.
- Production build passed.
- Final production acceptance verdict: **SOC V2 READY TO FREEZE.**
- Verified directly against real production data: pipeline `soc_v2` executed end-to-end (D1→D6), the legacy pipeline was not invoked, no emergency fallback occurred, and Phase C inspection evidence was confirmed unmutated by generation.

## Known non-blocking issue (not to be fixed as part of accepting this baseline)

A material-severity, unrepaired `reconciliation_conflict` can currently exist without appearing in the user-facing `unresolved_notes` output, because only *blocking*-severity findings are surfaced there today. The underlying finding still exists in `_soc_v2_metadata.d4_findings` and is never silently discarded — it simply isn't currently promoted to the surveyor-visible unresolved list unless it is blocking.

This is a known future-improvement item, intentionally left unfixed at acceptance.

## What is frozen

The following are frozen, accepted production architecture as of this baseline. They must not be refactored, optimised, simplified, reorganised, or "cleaned up" incidentally while working elsewhere in Nora. Changes require an intentional, explicit request.

- Phase C SOC live-processing semantics, inspection-state behaviour, room/section tracking, first-visit room ordering, correction/addition/clarification semantics, claim supersession, site-note routing
- D1 (canonical input, generation barrier)
- D2 (reconciliation)
- D3 (professional drafting)
- D4 (Fidelity Audit)
- D5 (Professional Quality Audit)
- D6 (Post-Quality Factual Guard)
- Universal SOC Brain
- User SOC Brain integration
- Reference-code generation
- Production pipeline orchestration
- Provenance-chain behaviour
- Site-note professional drafting
- D5/D6 audit persistence

## Legacy pipeline

The legacy SOC generation pipeline (`extractStructuredDataLegacy`, `draftFromClaims`, the old `runQualityAudit`, `runCompletenessAudit`, the emergency single-call fallback) remains in the repository, reachable only via an explicit `use_legacy_pipeline` flag. It is intentionally **not** removed, quarantined, or refactored at this baseline. Legacy cleanup is a separate, future task.
