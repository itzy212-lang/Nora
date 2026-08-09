# Independent Mediation Architecture

Status: foundation contract for the autonomous mediation system.

## 1. Separation from Nora

The mediation system is a separate runtime and data boundary. Nora may create and administer a mediation, but the mediator runtime must not query or inherit Nora project history, project memory, emails, payment history, variations, programme data, user brain, drafting voice, representation assumptions, or any other project context.

The mediation system will use a separate Supabase project and separate API credentials/environment variables.

Nora's role ends at controlled handover and administration.

## 2. Controlled handover from Nora

When a mediation is created, Nora may pre-populate identity data already held on the project. The user must review and confirm the legal identity before handover, including where applicable:

- legal party name
- trading name
- company number
- registered address
- named representative
- email
- telephone
- party role

The handover is a snapshot. After creation, the mediation database does not maintain a live link to Nora project data. Later changes in Nora must not silently amend signed or active mediation records.

Permitted handover material is limited to:

1. confirmed Party A identity data
2. confirmed Party B identity data
3. Party A confidential intake statement
4. Party B confidential intake statement
5. signed mediation process documents and contract metadata when available
6. mediation administration data such as fee, proposed dates and confirmed session date

No other Nora project material is available to the mediator runtime unless a party deliberately introduces it into the mediation.

## 3. Identity model

The mediation service uses separate identifiers for:

- mediation_id: the mediation case
- party_id: the legal party
- participant_id: the individual authorised to act for that party
- access/invitation token: one-time or scoped credentials used to establish portal access

A company can therefore be the legal party while a named individual is the participant.

Access is resolved server-side from authenticated identity. The client must never be trusted to select its own party or room by changing a URL parameter or request body field.

## 4. Information classes

All mediation information must be explicitly classified.

### 4.1 Confidential intake

Each party's original written case/background statement. The mediator may use Party A's intake with Party A and Party B's intake with Party B. It is not cross-disclosable merely because the mediator has received it.

### 4.2 Joint-room information

Opening statements and anything subsequently said in a joint session. Both parties have heard this material, so the mediator may refer to it with either party later in the mediation.

### 4.3 Private caucus information

Anything said in a Party A or Party B private room remains confidential to that party. The opposite party, opposite private AI, and central mediator cross-party context must not receive it automatically.

### 4.4 Authorised disclosure

Private information crosses the confidentiality boundary only through an explicit disclosure record authorised by the originating party. The authorised wording and scope must be preserved. The system must not infer permission merely because sharing appears useful.

Suggested disclosure states:

- private
- proposed_for_disclosure
- authorised_for_disclosure
- disclosed
- revoked_before_disclosure

## 5. No generic all-messages access

There must be no normal runtime function or API route that returns all messages for a mediation across Party A, Party B and the joint room.

Each service role receives the minimum information required for the current mediation context.

The central mediator can access:

- joint-room material
- its own mediation state and analysis
- Party A confidential material only while operating inside Party A's authorised caucus context
- Party B confidential material only while operating inside Party B's authorised caucus context
- authorised disclosure records

A Party A private AI cannot access Party B private data. A Party B private AI cannot access Party A private data.

## 6. Mediation AI independence

The mediation AI has its own brain, identity, methodology, prompt assembly and memory. It must not load Nora's Universal Brain, User Brain, project Working Memory, drafting examples or representation lock.

Its inputs are limited to mediation-authorised data.

The mediation methodology will include the Phoenix process and approved external negotiation/mediation techniques, but those are implemented independently from Nora's professional assistant prompt stack.

## 7. Administrative workflow

Target onboarding flow:

1. Create mediation in Nora.
2. Pre-populate Party A and Party B details from the project.
3. User confirms/corrects legal identities.
4. Collect or attach each party's confidential intake statement.
5. Send invitation to mediate with fee and process explanation.
6. Both parties confirm willingness to proceed.
7. Party A signs Agreement to Mediate and selects several available dates.
8. Party B is shown Party A's selected dates, chooses one and signs.
9. Once both signatures are complete, the date is locked and the mediation is confirmed.
10. Secure participant access is issued.
11. The mediation runtime begins with only the sealed mediation handover pack.

## 8. Live mediation model

The mediation begins in a joint room. The parties give their opening statements and the mediator gives the process opening. Opening statements become joint-room material.

The process then moves between isolated private breakout rooms. Each party has a private AI companion trained in the same mediation methodology. Private AI discussions remain private unless the party explicitly authorises a defined disclosure.

The system is designed ultimately for autonomous AI-led mediation. Initial releases use human-in-the-loop supervision so proposed mediator interventions can be reviewed before release.

## 9. Security requirements

Privacy must be enforced by database policy and API authorisation, not by prompt instructions alone.

Required controls include:

- separate Supabase project from Nora
- RLS enabled on mediation tables from creation
- deny-by-default policies
- server-side participant/party resolution
- scoped API/service credentials
- hashed or otherwise securely stored invitation tokens
- auditable disclosure authorisations
- immutable or versioned signed agreements
- no client-controlled room authority
- no cross-party generic search endpoint

## 10. Naming

Branding is intentionally unresolved. Internal engineering names should remain neutral, for example mediation_core, central_mediator and private_party_ai. The public-facing mediator may later be named Eli, Phoenix or another name without requiring schema changes.
