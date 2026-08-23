// api/lib/v2-prompt-assembly.js
//
// Final ordered assembly into the single prompt sent to Terra.

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

ANTI-AI / PROPORTIONALITY RULES:
- Treat the user's dictation as the substance. Clean it up; do not inflate it.
- Do not add arguments, caveats, conclusions, explanations, strategy or professional-sounding filler that the user did not request unless essential for accuracy.
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
Use the incoming email, thread and user's notes/dictation. Use wider project history only where it materially improves a genuinely complex reply. Do not introduce known project facts simply because they are available. Any unrequested strategic suggestion or materially stronger alternative argument must stay outside the draft body. Do not omit backstory a third-party recipient genuinely needs, but for an existing correspondent assume shared thread context where reasonable.

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

function assembleV2Prompt({ universalBrain, effectiveVoice, goldStandardBlock, domainKnowledge, workingMemory, surface, modeHint, representationLock }) {
  const sections = [];
  sections.push({ name: 'universal_brain', content: universalBrain || '' });
  if (representationLock) sections.push({ name: 'representation_lock', content: representationLock });
  sections.push({ name: 'effective_voice', content: effectiveVoice?.text || '' });
  if (goldStandardBlock?.text) sections.push({ name: 'gold_standard_examples', content: goldStandardBlock.text });
  if (domainKnowledge) sections.push({ name: 'domain_knowledge', content: domainKnowledge });
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
