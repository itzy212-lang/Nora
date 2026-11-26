// Retrieval helpers for project chat (26 Nov 2026).
//
// Why: on 26 Nov 2026 a project chat could not find the email confirming a 3pm
// inspection. The confirming fact was in the project (an email and a memory note),
// but it sat outside every "newest N" window and the semantic search was asked
// with only the user's latest message ("Sorry, number 20, not 16"), which carries
// no meaning on its own. The user's own just-saved message also matched itself at
// 100% and took the top result slot.
//
// Everything here is MECHANICAL (string handling, plain-text matching). No
// relevance or "has the gap been answered" judgement; those stay with the model,
// per docs/nora-v2/NORA_V2_OPERATING_SYSTEM.md section 5.

const MONTHS = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

function userTurns(chatHistory) {
  return (Array.isArray(chatHistory) ? chatHistory : []).filter((m) => m && m.role === 'user' && m.content);
}

/** The search question = the user's previous (up to 2) messages + the current one, so a follow-up keeps its meaning. */
export function buildConversationSearchQuery(prompt, chatHistory, { priorUserTurns = 2, maxChars = 1500 } = {}) {
  const prior = userTurns(chatHistory)
    .map((m) => String(m.content).trim())
    .filter((t) => t && t !== String(prompt || '').trim())
    .slice(-priorUserTurns);
  return [...prior, String(prompt || '').trim()].filter(Boolean).join('\n').slice(-maxChars);
}

/** Drops chat results that are just this conversation's own messages (they match themselves and waste slots). */
export function excludeCurrentSessionChat(results, prompt, chatHistory) {
  const own = new Set(
    [String(prompt || ''), ...userTurns(chatHistory).map((m) => String(m.content))]
      .map((t) => t.trim().slice(0, 500))
      .filter(Boolean)
  );
  return (results || []).filter((r) => !(r.content_type === 'chat' && own.has(String(r.content || '').trim().slice(0, 500))));
}

/** Literal times and dates found in the conversation's own words, as search variants. */
export function extractLiteralTerms(text, { maxTerms = 4 } = {}) {
  const t = String(text || '');
  const terms = [];
  const add = (v) => { if (v && !terms.includes(v)) terms.push(v); };

  for (const m of t.matchAll(/\b(\d{1,2})(?::(\d{2})|\.(\d{2}))?\s?(am|pm)\b/gi)) {
    const h = m[1]; const min = m[2] || m[3] || ''; const ap = m[4].toLowerCase();
    if (min && min !== '00') { add(`${h}:${min}${ap}`); add(`${h}.${min}${ap}`); add(`${h}:${min} ${ap}`); }
    else { add(`${h}${ap}`); add(`${h}:00${ap}`); add(`${h} ${ap}`); add(`${h}.00${ap}`); }
  }
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTHS})[a-z]*\\b`, 'gi'))) {
    add(`${m[1]} ${m[2]}`);
    add(`${m[1]}th ${m[2]}`);
  }
  for (const m of t.matchAll(new RegExp(`\\b(${MONTHS})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'gi'))) {
    add(`${m[2]} ${m[1]}`);
  }
  return terms.slice(0, maxTerms * 4); // variants of up to ~4 distinct times/dates
}

function plain(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#39;|&rsquo;/gi, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

/**
 * Short quotations around literal matches in whole email bodies, so a fact buried
 * low in a quoted chain (which the normal 2,400-character view cuts off) is still seen.
 * Rows are expected newest first. Identical snippets are shown once.
 */
export function snippetsAroundTerms(rows, terms, { radius = 260, maxSnippets = 6 } = {}) {
  if (!terms?.length) return [];
  const lowerTerms = terms.map((t) => t.toLowerCase());
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const text = plain(row.body || row.body_preview || '');
    const lower = text.toLowerCase();
    let at = -1;
    for (const t of lowerTerms) { const i = lower.indexOf(t); if (i !== -1 && (at === -1 || i < at)) at = i; }
    if (at === -1) continue;
    const start = Math.max(0, at - radius);
    const quote = text.slice(start, Math.min(text.length, at + radius)).replace(/\s+/g, ' ').trim();
    const key = quote.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 160);
    if (seen.has(key)) continue;
    seen.add(key);
    const who = row.sender_name || row.sender_email || '';
    out.push({
      id: `kw_${row.id}`,
      date: row.received_at || row.sent_at || null,
      author: who || null,
      evidential_status: 'literal_match_in_project_email',
      content: `[Email: ${row.subject || '(no subject)'} | ${row.direction || ''}${who ? ' | ' + who : ''}] ...${quote}...`,
    });
    if (out.length >= maxSnippets) break;
  }
  return out;
}
