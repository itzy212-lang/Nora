// Statutory and Faculty reference retrieval (added 26 Nov 2026).
//
// Why this exists: the knowledge_base table holds the Party Wall etc. Act 1996
// (sections 1-17 and 20), the Faculty of Party Wall Surveyors (FPWS) FAQs and
// overview entries, and the GOV.UK Explanatory Booklet. Nothing in V2 read it,
// so Nora never saw the actual wording of the Act or the Faculty's guidance.
//
// This is MECHANICAL matching only (same class as named-correspondent
// retrieval): plain-text patterns in the user's own words select which stored
// entries are attached. There is no judgement about whether a dispute exists,
// whether a question has been answered, or which entry is "best". Those stay
// with the model, per docs/nora-v2/NORA_V2_OPERATING_SYSTEM.md section 5.
//
// Owned by the Operating System (retrieval). Content belongs to no brain layer.
// Universal: reads the shared table, never a user's own data.

export const MAX_REFS = 6;
export const MAX_CHARS = 7000;

// pattern -> knowledge_base.section_ref values
const RULES = [
  [/section\s*1\b|s\.?\s*1\b|line of junction|new (?:party )?wall.*boundary/, ['s1', 'govuk_booklet_s1_boundary']],
  [/section\s*2\b|s\.?\s*2\b|repair.*party wall|rights of (?:the )?building owner/, ['s2', 'govuk_booklet_s2_rights']],
  [/section\s*3\b|s\.?\s*3\b|party structure notice|serve.*notice|notice.*(?:expir|laps|valid|period|serv)|one month|two months|consent/, ['s3', 'govuk_booklet_notice_requirements', 'fpws_overview_notice']],
  [/section\s*4\b|s\.?\s*4\b|counter.?notice/, ['s4']],
  [/section\s*5\b|s\.?\s*5\b|dissent|deemed dispute|no reply|not reply|14 days|fourteen days/, ['s5', 'fpws_faq_no_reply']],
  [/section\s*6\b|s\.?\s*6\b|excavat|3 ?m(?:etre)?s?\b|6 ?m(?:etre)?s?\b|underpin|adjacent/, ['s6', 'govuk_booklet_s6_excavation']],
  [/section\s*7\b|s\.?\s*7\b|compensation|special foundation/, ['s7']],
  [/section\s*8\b|s\.?\s*8\b|right of entry|rights of entry|right of access|access to (?:the )?(?:neighbour|adjoining)/, ['s8', 'fpws_faq_right_of_access', 'govuk_booklet_access_rights']],
  [/section\s*9\b|s\.?\s*9\b|easement/, ['s9']],
  [/section\s*10\b|s\.?\s*10\b|third surveyor|agreed surveyor|ex parte|award|appeal|dispute/, ['s10', 'govuk_booklet_dispute_resolution', 'fpws_overview_third_surveyor', 'fpws_faq_appeal']],
  [/section\s*11\b|s\.?\s*11\b|fees?\b|costs?\b|expenses?|who pays|invoice/, ['s11', 'fpws_faq_fees']],
  [/section\s*12\b|s\.?\s*12\b|security for expenses/, ['s12']],
  [/section\s*1[34]\b|account for work|settlement of account/, ['s13', 's14']],
  [/section\s*15\b|s\.?\s*15\b|(?:how|method).*serv|email.*notice|electronic|service of notice/, ['s15']],
  [/section\s*16\b|offence/, ['s16']],
  [/section\s*20\b|s\.?\s*20\b|definition|who is (?:a|an|the) (?:building|adjoining) owner|what is a party (?:wall|fence|structure)/, ['s20', 'govuk_booklet_definitions', 'fpws_overview_building_owner', 'fpws_overview_adjoining_owner']],
  [/no notice|without (?:a )?notice|not serve/, ['fpws_faq_no_notice']],
  [/boundary dispute|boundary line|land registry/, ['fpws_faq_boundary']],
  [/disagree.*surveyor|surveyor.*disagree|change.*surveyor|appointed surveyor/, ['fpws_faq_surveyor_disagree', 'fpws_faq_surveyor_role']],
  [/agreement vs award|party wall agreement/, ['fpws_overview_agreement_vs_award']],
];

/** @returns {string[]} section_refs to attach (deduplicated, capped), in rule order */
export function pickReferenceRefs(text) {
  const lower = String(text || '').toLowerCase();
  if (!lower.trim()) return [];
  const refs = [];
  for (const [pattern, ids] of RULES) {
    if (pattern.test(lower)) for (const id of ids) if (!refs.includes(id)) refs.push(id);
  }
  return refs.slice(0, MAX_REFS);
}

/** Formats rows into one labelled block, trimmed to MAX_CHARS. Returns null if empty. */
export function formatStatutoryReference(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const parts = [];
  let used = 0;
  for (const r of rows) {
    const body = [r.statutory_text, r.practice_notes ? `Practice note: ${r.practice_notes}` : '']
      .filter(Boolean).join('\n').trim();
    if (!body) continue;
    const block = `### ${r.title}\n${body}`;
    if (used + block.length > MAX_CHARS) break;
    parts.push(block);
    used += block.length;
  }
  if (!parts.length) return null;
  return [
    '## STATUTORY AND FACULTY REFERENCE (retrieved for this request)',
    'Source text from the Party Wall etc. Act 1996, the Faculty of Party Wall Surveyors and the GOV.UK Explanatory Booklet. Use it as the authority on what the Act and guidance say; do not quote beyond what is needed.',
    '',
    parts.join('\n\n'),
  ].join('\n');
}

// ── Full Act (26 Nov 2026) ───────────────────────────────────────────────────
// The Act is short (sections 1-17 and 20 held, about 19,000 characters), and
// questions about it are often "does the Act say anything about X?", where the
// user does not know the section. Matching words cannot answer that, so on the
// surfaces where the shared knowledge layer loads, the whole stored (condensed) text is
// attached. No judgement is made about whether it is needed; the Universal
// Brain (DISPUTE AUTHORITY) decides whether and how to use it.
const ACT_TTL_MS = 10 * 60 * 1000;
let actCache = { at: 0, text: null };

export function sectionNumber(ref) {
  const m = /^s(\d+)$/.exec(String(ref || ''));
  return m ? Number(m[1]) : null;
}

export function formatFullAct(rows) {
  const secs = (Array.isArray(rows) ? rows : [])
    .filter((r) => sectionNumber(r.section_ref) !== null && r.statutory_text)
    .sort((a, b) => sectionNumber(a.section_ref) - sectionNumber(b.section_ref));
  if (!secs.length) return null;
  const held = secs.map((r) => sectionNumber(r.section_ref)).join(', ');
  return [
    '## PARTY WALL ETC. ACT 1996 (full stored text)',
    `Sections held: ${held}. This is a condensed working copy of the Act, not the official text: some subsections may be shortened or missing. Use it to find which section deals with a point and to reason about what the Act covers, cite the section number, and do not present its wording as a verbatim quotation of the Act. Sections not listed are not stored here; do not state what they say. If these sections contain nothing on a point, say the stored sections contain nothing on it and that the official text should be checked, rather than asserting what the Act does not say.`,
    '',
    secs.map((r) => `### ${r.title}\n${String(r.statutory_text).trim()}`).join('\n\n'),
  ].join('\n');
}

export async function loadFullAct(sb) {
  try {
    if (!sb) return null;
    if (actCache.text && Date.now() - actCache.at < ACT_TTL_MS) return actCache.text;
    const { data, error } = await sb
      .from('knowledge_base')
      .select('section_ref, title, statutory_text')
      .eq('source', 'legislation');
    if (error || !data?.length) return null;
    const text = formatFullAct(data);
    if (text) actCache = { at: Date.now(), text };
    return text;
  } catch (err) {
    console.warn('[statutory-reference] full act failed:', err.message);
    return null;
  }
}

/** Loads and formats the reference for a request. Never throws; null on any problem.
 *  With fullAct, the whole Act is attached first and keyword matching only adds
 *  the supporting Faculty and GOV.UK entries (not the Act sections again). */
export async function loadStatutoryReference(sb, text, { fullAct = false } = {}) {
  try {
    if (!sb) return null;
    const act = fullAct ? await loadFullAct(sb) : null;
    let refs = pickReferenceRefs(text);
    if (act) refs = refs.filter((r) => sectionNumber(r) === null);
    let supporting = null;
    if (refs.length) {
      const { data, error } = await sb
        .from('knowledge_base')
        .select('section_ref, title, statutory_text, practice_notes')
        .in('section_ref', refs);
      if (!error && data?.length) {
        const order = new Map(refs.map((r, i) => [r, i]));
        data.sort((a, b) => order.get(a.section_ref) - order.get(b.section_ref));
        supporting = formatStatutoryReference(data);
      }
    }
    return [act, supporting].filter(Boolean).join('\n\n') || null;
  } catch (err) {
    console.warn('[statutory-reference] lookup failed:', err.message);
    return null;
  }
}
