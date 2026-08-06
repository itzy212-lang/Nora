// api/lib/v2-prompt-assembly.js
//
// Final ordered assembly into the single prompt sent to Terra. Order, per
// docs/nora-v2/NORA_V2_OPERATING_SYSTEM.md and NORA_V2_IMPLEMENTATION_PLAN_V2.md §4:
//   1. Universal Brain
//   2. Effective Voice Profile (Default + User override)
//   3. Gold Standard examples, with explicit authority framing
//   4. Domain knowledge
//   5. Dynamic Working Memory (assembled by v2-working-memory.js)
//   6. Surface Contract (task-specific instructions)
//   7. Final validation instruction
//
// This module does not fetch or decide anything — it only orders and
// concatenates content already resolved by the other v2-* modules and the
// caller. One call to this function produces the complete system prompt
// for exactly one Terra call.

function buildSurfaceContract(surface, modeHint) {
  const isDraft = modeHint === 'draft';
  if (surface === 'project_chat' && !isDraft) {
    return 'SURFACE: Project Chat, discuss mode. Collaborate before drafting where the user is still working through the position. Treat the user\'s detailed dictation as the starting strategy, not a blank slate — refine and organise it rather than replacing it with a fresh generic analysis. Identify the controlling point quickly and state it plainly; do not bury it in procedure. Use relevant project facts proactively, including deadlines and expiry dates the moment delay or urgency is mentioned. Preserve confirmed project spellings, names and roles exactly. Do not draft until asked. Once asked to draft, use the complete agreed reasoning from the discussion — do not restart the analysis. Do not burden responses with generic professional qualifications or safeguards that do not materially change the advice. When the user says the discussion is complete and asks for a draft, stop discussing and produce the draft.';
  }
  if (surface === 'main_chat' && !isDraft) {
    return 'SURFACE: Main Chat. Provide general collaboration. Preserve representation. Do not confuse the authenticated user with email senders or represented parties. Do not automatically respond in email format merely because the user has pasted an email.';
  }
  if (isDraft) {
    return 'SURFACE: Draft. Primarily draft correspondence from the incoming email, thread and the user\'s notes or dictation. Keep ordinary emails quick and proportionate. Use wider project history only for genuinely complex replies. Do not turn every draft into a discussion. Any unrequested strategic suggestion or materially stronger alternative argument must be kept separate from the draft body, never inserted into it. Do not omit the backstory a third-party recipient of the draft would need to understand it.\n\nOUTPUT FORMAT — REQUIRED: wrap the clean, ready-to-send draft text — and nothing else — between the exact markers <<<DRAFT>>> and <<<END_DRAFT>>>, on their own lines. Any analysis, reasoning, or "possible additional point" content belongs entirely outside those markers, never inside them. The text between the markers must be sendable exactly as written, with no headers, labels, or commentary mixed in.';
  }
  return `SURFACE: ${surface || 'unknown'}, mode: ${modeHint || 'discuss'}.`;
}

const DRAFT_DELIMITER_START = '<<<DRAFT>>>';
const DRAFT_DELIMITER_END = '<<<END_DRAFT>>>';

/**
 * Mechanical extraction only — a fixed-delimiter split, not a semantic
 * judgement about what "counts" as a draft. If the markers aren't present
 * (e.g. discuss mode, or the model didn't use them), the full text is
 * treated as commentary and no draft is extracted — never guessed.
 */
function splitDraftFromCommentary(rawText) {
  if (!rawText) return { reply: '', draft: null };
  const startIdx = rawText.indexOf(DRAFT_DELIMITER_START);
  const endIdx = rawText.indexOf(DRAFT_DELIMITER_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { reply: rawText.trim(), draft: null };
  }
  const draft = rawText.slice(startIdx + DRAFT_DELIMITER_START.length, endIdx).trim();
  const before = rawText.slice(0, startIdx).trim();
  const after = rawText.slice(endIdx + DRAFT_DELIMITER_END.length).trim();
  const reply = [before, after].filter(Boolean).join('\n\n').trim();
  return { reply, draft: draft || null };
}

const FINAL_VALIDATION_INSTRUCTION =
  'Before returning your response, confirm concisely: it answers the actual request; the user\'s objective is preserved; representation is correct; factual claims are supported; nothing has been invented; the effective user voice is preserved; the controlling point has not been diluted; there is no material contradiction or unnecessary repetition; any supported unrequested suggestion has been kept separate.';

function assembleV2Prompt({
  universalBrain,
  effectiveVoice,
  goldStandardBlock,
  domainKnowledge,
  workingMemory,
  surface,
  modeHint,
  representationLock,
}) {
  const sections = [];

  sections.push({ name: 'universal_brain', content: universalBrain || '' });

  if (representationLock) {
    sections.push({ name: 'representation_lock', content: representationLock });
  }

  sections.push({ name: 'effective_voice', content: effectiveVoice?.text || '' });

  if (goldStandardBlock?.text) {
    sections.push({ name: 'gold_standard_examples', content: goldStandardBlock.text });
  }

  if (domainKnowledge) {
    sections.push({ name: 'domain_knowledge', content: domainKnowledge });
  }

  if (workingMemory?.included?.length) {
    const memoryText = workingMemory.included
      .map((item) => `[${item.category}${item.source_id ? ':' + item.source_id : ''}${item.date ? ' ' + item.date : ''}] ${item.content}`)
      .join('\n\n---\n\n');
    sections.push({ name: 'dynamic_working_memory', content: memoryText });
  }

  sections.push({ name: 'surface_contract', content: buildSurfaceContract(surface, modeHint) });
  sections.push({ name: 'final_validation', content: FINAL_VALIDATION_INSTRUCTION });

  const prompt = sections
    .filter((s) => s.content && s.content.trim().length > 0)
    .map((s) => s.content)
    .join('\n\n---\n\n');

  return { prompt, sections };
}

export { assembleV2Prompt, buildSurfaceContract, splitDraftFromCommentary, FINAL_VALIDATION_INSTRUCTION, DRAFT_DELIMITER_START, DRAFT_DELIMITER_END };
