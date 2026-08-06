# NORA V2 — OPERATING SYSTEM

Status: constitutional document. This is the authoritative record of how Nora V2 is structured and why. Read this before making any behavioural, prompt, retrieval, memory, reasoning, or assembly change to Nora — code implements this document; this document is not merely a description of the code.

---

## 1. Runtime architecture

1. Operating System — resolves task, surface, representation, context requirements.
2. Universal Brain — loaded unconditionally.
3. Default Voice Profile — loaded unconditionally, as the voice floor.
4. Authenticated User Brain — overrides or extends the Default Voice Profile where a user-specific record exists.
5. Dynamic Working Memory — assembled fresh per request, before generation.
6. Current request and conversation.
7. One GPT-5.6 Terra call.
8. Concise final validation.

Execution flow: request → Operating System resolves task/surface/representation/context requirements → Universal Brain loaded → Default Voice Profile loaded → User Brain overrides/extends where configured → Dynamic Working Memory assembled → Terra reasons and responds once → concise validation → response returned.

## 2. Component ownership — one owner per responsibility

| Component | Owns |
|---|---|
| Operating System | orchestration, ownership, authority, retrieval, prompt assembly, versioning, diagnostics, governance |
| Universal Brain | Nora's identity, universal professional behaviour, collaboration, drafting boundaries, anti-invention, concise reasoning, revision principles, professional capability |
| Default Voice Profile | the platform's default style |
| User Brain | authenticated user identity, user-specific voice, terminology, preferences, banned phrases, Gold Standards, user-specific professional knowledge |
| Dynamic Working Memory | current matter evidence and context |
| Surface Contract | current task and output behaviour |

No instruction may exist in more than one owner unless one occurrence is an explicit reference, not repeated behavioural content.

## 3. Authority hierarchy (voice precedence)

1. Universal factual, representation, and anti-invention safeguards.
2. Current express user instruction for this request.
3. Authenticated User Voice Profile.
4. Platform Default Voice Profile.

The authenticated user's profile may override tone, style, formality, terminology, banned phrases. It may not override factual discipline, representation safeguards, universal anti-invention, or professional integrity.

## 4. Execution order

Fixed, per §1. Dynamic Working Memory is assembled **before** the Terra call, never after. Exactly one Terra call is made per user-facing request. No separate reasoning call exists without a documented, separately-approved architectural amendment to this document.

## 5. Universal boundaries

- Anti-invention (facts, motives, chronology, explanations, assumptions, legal arguments, strategy, claims about what another person may think or intend) applies regardless of surface, mode, or voice profile.
- Representation safeguards apply regardless of surface, mode, or voice profile.
- Progressive context assembly means: gather the strongest available context using surface, linked project, selected email/thread, explicit user instruction, and existing retrieval mechanisms, within strict source-count and budget limits, before the single Terra call. It does **not** mean JavaScript deciding whether an information gap has been substantively answered — that is a model judgment. Where assembled context remains incomplete, Terra identifies the gap; JavaScript never tries to resolve it first. Model-directed iterative retrieval is a distinct future capability requiring its own separate architectural approval under this document — it is not implemented in the initial V2 release, and must not be quietly recreated through JavaScript heuristics.

## 6. Amendment rules

A change to Nora's behaviour, prompts, retrieval, memory, reasoning, or assembly must, before implementation:
1. Identify which component in §2 is affected.
2. Confirm no other component already owns the responsibility.
3. Confirm the change does not create duplicate ownership.
4. Confirm the change does not conflict with §3's authority hierarchy.
5. Determine whether this document itself requires amendment.
6. Determine whether regression testing is required.
7. Determine how the change can be rolled back.

Where a requested change conflicts with this document, implementation stops and the conflict is surfaced before proceeding — it is not silently resolved.

## 7. Specialist-workspace inheritance

A future specialist workspace (mediation, adjudication, litigation preparation, contract administration, defect investigation, Schedule of Condition, award preparation, project management) inherits: Universal Brain, effective User Brain and voice profile, representation, factual discipline, anti-invention, this authority hierarchy, and project access controls. It may add specialist knowledge, workflow, tools, temporary memory, permissions, templates. **It may not redefine any constitutional component this document defines.** No specialist workspace is built under this version of the document — this section exists so one can be registered later without a core rewrite.

## 8. Versioning and rollback principles

- Runtime version controlled by `NORA_BRAIN_VERSION` (`v1`/`v2`), read once per request.
- Initial release: V2 routes only to an explicit per-user allowlist (Itzik's authenticated UUID), independent of the flag's value — the flag alone is not sufficient to reach V2.
- Exactly one assembler's output reaches the single Terra call per request — never both, never merged.
- V1's source content (`ely_master_v3`, `global_drafting`, `nora_system_default`, `party_wall_drafting`, the existing `user_brain` table) is never written to by V2. V2 reads from separate, dedicated sources. This makes rollback (reverting the flag or the allowlist) require zero data reversal — it is a routing change only.
- V1 remains the rollback path until V2 is proven and formally promoted. After promotion, V1 receives a planned removal date — it is not left running indefinitely alongside V2.

## 9. Governing evidence

This document's content is built from, and must remain traceable to: the confirmed known-good period (26 June–5 July 2026), the byte-recovered `ely_master_v3_backup_20260624`, the ChatGPT-reviewed and approved `e4cbd432` additions, and the reconciliation diff run against today's live `ely_master_v3` (documented separately, `NORA_V2_RECONCILIATION.md`). Content not traceable to this evidence chain is not part of the Universal Brain or Default Voice Profile by default.
