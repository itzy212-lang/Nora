// api/lib/v2-prompt-assembly.js
//
// Final ordered assembly into the single prompt sent to Terra.

// Fixed 2026-09-03, real, directly-evidenced problem reported live:
// the Draft with Nora surface contract's own rules were actively
// working against the separate instruction to identify and build
// around the single strongest argument. 'Any materially stronger
// alternative argument must stay outside the draft body' told the
// model, explicitly, not to do the one thing it was being asked to
// do — the user was clear this wasn't about a complex email needing
// extra research, just an ordinary argument that needed to land
// with real force. The anti-padding rules below are still right for
// routine, simple correspondence; they were never meant to apply
// when the user is actually making a case.
function buildSurfaceContract(surface, modeHint) {
  const isDraft = modeHint === 'draft';
  if (surface === 'project_chat' && !isDraft) {
    return 'SURFACE: Project Chat, discuss mode. Collaborate before drafting where the user is still working through the position. Treat the user\'s detailed dictation as the starting strategy, not a blank slate — refine and organise it rather than replacing it with a fresh generic analysis. Identify the controlling point quickly and state it plainly; do not bury it in procedure. Use relevant project facts proactively, including deadlines and expiry dates the moment delay or urgency is mentioned. Preserve confirmed project spellings, names and roles exactly. Do not draft until asked. Once asked to draft, use the complete agreed reasoning from the discussion — do not restart the analysis. Do not burden responses with generic professional qualifications or safeguards that do not materially change the advice. When the user says the discussion is complete and asks for a draft, stop discussing and produce the draft.';
  }
  if (surface === 'main_chat' && !isDraft) {
    return 'SURFACE: Main Chat. Provide general collaboration. Preserve representation. Do not confuse the authenticated user with email senders or represented parties. Do not automatically respond in email format merely because the user has pasted an email.';
  }
  if (isDraft) {
    return `SURFACE: Draft with Nora. This is primarily an email reply and correspondence drafting surface. Write the email the authenticated user would actually send, not a polished generic business-email version of their instruction.

DRAFTING PRIORITY:
1. Preserve the user's actual point and intention.
2. Match the required length to the job. A one-point reply should normally be one or two short paragraphs, not expanded into a formal letter.
3. Prefer natural human correspondence over completeness for its own sake. Existing email threads do not need their background restated unless the recipient genuinely needs it.
4. Stop when the requested point has been communicated. Never add a paragraph merely to make the email appear more complete.

WHEN THE USER IS MAKING AN ARGUMENT OR DISPUTING A POSITION (not simple
routine correspondence): identify the single strongest point in what
the user is arguing and make that the structural spine of the draft —
state it plainly, lead with it, and actively strengthen it with
directly supporting reasoning, even reasoning the user did not
dictate word-for-word, provided it serves that one point rather than
introducing a separate argument. This is not filler or inflation —
building the strongest version of the user's own case is the actual
job. Do not soften or hedge the user's position, and do not phrase a
supporting point in a way that could be read as conceding it or as
making the user's own request sound unreasonable. Peripheral points
still stay peripheral — brief, supporting, not competing for the
same weight as the central one.

ANTI-AI / PROPORTIONALITY RULES (for routine, non-argumentative
correspondence — do not apply these to weaken or hedge an actual
argument, per above):
- Treat the user's dictation as the substance. Clean it up; do not inflate it.
- Do not add caveats, conclusions, or professional-sounding filler that the user did not request unless essential for accuracy or genuinely strengthens the one point being argued.
- Do not turn a simple sentence into several sentences saying substantially the same thing.
- Use contractions naturally where they fit: I've, we'll, can't, that's, I'd.
- Prefer plain connective language. Avoid stock AI/legalistic transitions such as 'That is why it is important that', 'In this regard', 'It should be noted', 'For completeness', 'Furthermore', 'Accordingly' and similar filler unless genuinely necessary.
- Do not manufacture formality. Short phrases such as 'Perfect, I've now sent this on to David' are valid professional correspondence.
- Do not over-explain an obvious consequence. If the user says a quotation can be checked against a third-party quote for reasonableness, say that directly rather than adding a second paragraph explaining why a quotation is needed.
- Do not repeat the recipient's own name in the body as though discussing them in the third person. When writing to a person, use 'you' where natural.

PARTY WALL CORRESPONDENCE:
- Do not refer to the adjoining owner's surveyor by personal name merely because the name is known. Default to 'the adjoining owner's surveyor' or, where context makes it natural and unambiguous, 'the other surveyor'.
- If writing directly to that surveyor, use 'you' rather than describing the recipient as 'the adjoining owner's surveyor'.
- Use a person's name only where the user's instruction, the communication context, or clarity genuinely requires the individual to be identified.

TIME STYLE:
- Use compact UK time formatting: 10am, 10:30am, 2pm, 2:15pm.
- Do not write 10.00am, 10:00 am, 10:00am or 10 am unless reproducing quoted/source text that must remain exact.

CONTEXT USE:
Use the incoming email, thread and user's notes/dictation. Use wider project history only where it materially improves a genuinely complex reply. Do not introduce known project facts simply because they are available. An unrequested strategic suggestion the user has not raised (a different course of action, a separate point of leverage) stays outside the draft body — but strengthening the argument the user is actually making, per the rule above, is not an unrequested suggestion and belongs in the draft. Do not omit backstory a third-party recipient genuinely needs, but for an existing correspondent assume shared thread context where reasonable.

OUTPUT FORMAT — REQUIRED: wrap the clean, ready-to-send draft text — and nothing else — between the exact markers <<<DRAFT>>> and <<<END_DRAFT>>>, on their own lines. Any analysis, reasoning, or possible additional point belongs entirely outside those markers. The text between the markers must be sendable exactly as written, with no headers, labels, or commentary mixed in.`;
  }
  return `SURFACE: ${surface || 'unknown'}, mode: ${modeHint || 'discuss'}.`;
}

const DRAFT_DELIMITER_START = '<<<DRAFT>>>';
const DRAFT_DELIMITER_END = '<<<END_DRAFT>>>';

function splitDraftFromCommentary(rawText) {
  if (!rawText) return { reply: '', draft: null };
  const startIdx = rawText.indexOf(DRAFT_DELIMITER_START);
  const endIdx = rawText.indexOf(DRAFT_DELIMITER_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return { reply: rawText.trim(), draft: null };
  const draft = rawText.slice(startIdx + DRAFT_DELIMITER_START.length, endIdx).trim();
  const before = rawText.slice(0, startIdx).trim();
  const after = rawText.slice(endIdx + DRAFT_DELIMITER_END.length).trim();
  const reply = [before, after].filter(Boolean).join('\n\n').trim();
  return { reply, draft: draft || null };
}

// Experimental change, 2026-08-22, on direct request — traced to a real,
// evidenced miss: reviewed an actual project chat transcript against the
// email it produced and confirmed the user's own instruction ('identify
// the single strongest argument... do not give equal weight to every
// point') existed in universal_brain_v2 but was not followed — the point
// the user returned to three separate times in the conversation ended up
// as paragraph 8 of 13, not leading the email. The prior version of this
// instruction checked for that only as one passive clause ('the
// controlling point has not been diluted') buried among eleven other
// checks in a single sentence. Split into its own explicit, active check
// here, in the last-read position before generation. If this makes
// output worse rather than better, revert this specific commit — it
// changes only this constant, nothing else.
const FINAL_VALIDATION_INSTRUCTION =
  'Before returning your response, confirm internally: it answers the actual request; the user\'s objective is preserved; representation is correct; factual claims are supported; nothing has been invented; the effective user voice is preserved; there is no material contradiction, unnecessary repetition or unnecessary expansion; a short email has remained short; recipient references are natural; time formatting follows the user\'s style; any supported unrequested suggestion has been kept separate. Then, separately: identify the point the user returned to more than once, or stated most emphatically — that is the controlling point. Confirm it leads the correspondence or is otherwise structurally dominant, not one item among several equally-weighted points. If it is not, restructure before returning the draft.';

function assembleV2Prompt({ universalBrain, effectiveVoice, goldStandardBlock, domainKnowledge, workingMemory, surface, modeHint, representationLock, contactsContext }) {
  const sections = [];
  sections.push({ name: 'universal_brain', content: universalBrain || '' });
  if (representationLock) sections.push({ name: 'representation_lock', content: representationLock });
  sections.push({ name: 'effective_voice', content: effectiveVoice?.text || '' });
  if (goldStandardBlock?.text) sections.push({ name: 'gold_standard_examples', content: goldStandardBlock.text });
  if (domainKnowledge) sections.push({ name: 'domain_knowledge', content: domainKnowledge });
  // Added 2026-08-25, real, critical fix — confirmed live: contactsContext
  // was passed into runV2Pipeline all along, but only ever used for
  // applyContactCorrections' post-hoc regex correction AFTER
  // generation. The model itself never saw the contacts list or any
  // instruction about it at any point — every 'contacts' instruction
  // written and refined over the previous two days lived in
  // buildSystemPrompt, the v1-only function this app's live traffic
  // never calls. This explains the hallucinated names far better than
  // the theory acted on at the time: the model wasn't misreading a
  // supplied contacts list, it was guessing with no contacts data in
  // its prompt at all, and the post-hoc correction sometimes
  // reinforced the wrong guess instead of catching it. Real fix: give
  // the model the actual list before it drafts, not just correct its
  // guess afterwards.
  if (Array.isArray(contactsContext) && contactsContext.length) {
    const contactLines = contactsContext
      .filter(c => c?.name && !c.__fetch_error)
      .map(c => `NAME (copy exactly, do not alter): ${c.name}\n  Firm: ${c.firm || 'n/a'}\n  Email: ${c.email || 'n/a'}\n  Phone: ${c.phone || 'n/a'}`)
      .join('\n');
    if (contactLines) {
      sections.push({
        name: 'contacts',
        content: `CONTACTS — ONLY use this list when the draft's own CONTENT needs to name, nominate, or reference a specific third party (e.g. nominating a third surveyor by name within the body). NEVER use this list to decide who an email is addressed to, who is being replied to, or the salutation of a reply — that is always determined by the actual sender of the email being replied to (their name, their sign-off, the thread itself), never by matching a dictated name against this list. Each NAME line already includes that person's full professional qualifications/accreditations where held. This is a COPY operation, not a rewrite: reproduce the NAME line character-for-character, including every qualification letter — never shorten, paraphrase, invent, or guess at a name or a qualification. If a name doesn't appear below, say so rather than guessing:\n${contactLines}`,
      });
    }
  }
  if (workingMemory?.included?.length) {
    const memoryText = workingMemory.included.map((item) => `[${item.category}${item.source_id ? ':' + item.source_id : ''}${item.date ? ' ' + item.date : ''}] ${item.content}`).join('\n\n---\n\n');
    sections.push({ name: 'dynamic_working_memory', content: memoryText });
  }
  sections.push({ name: 'surface_contract', content: buildSurfaceContract(surface, modeHint) });
  sections.push({ name: 'final_validation', content: FINAL_VALIDATION_INSTRUCTION });
  const prompt = sections.filter((s) => s.content && s.content.trim().length > 0).map((s) => s.content).join('\n\n---\n\n');
  return { prompt, sections };
}

export { assembleV2Prompt, buildSurfaceContract, splitDraftFromCommentary, FINAL_VALIDATION_INSTRUCTION, DRAFT_DELIMITER_START, DRAFT_DELIMITER_END };
