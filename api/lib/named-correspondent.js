// Named-correspondent retrieval helpers (added 13 Oct 2026).
//
// Why this exists: asking project chat for "all the correspondence between me
// and John Kelly" used to depend on a regex guessing a name out of free text.
// On a real dictated prompt it captured "John Kelly I want to", matched nobody,
// and silently fell back to the 30 newest emails on the project — which did not
// reach back to the September emails the user was asking about.
//
// This is MECHANICAL matching only (same class as identifyDiscussedEmail):
// a full name in the user's own words is compared, as plain text, against the
// names of people who have actually written to this project. No relevance
// judgement and no decision about whether an information gap is answered.
// Those stay with the model, per docs/nora-v2/NORA_V2_OPERATING_SYSTEM.md §5.

function normaliseName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} prompt the user's current request
 * @param {Array<{sender_name?:string, sender_email?:string}>} correspondents
 *        people who have written to this project (incoming senders)
 * @returns {string[]} lower-cased email addresses of every correspondent whose
 *          full name (two or more words) appears in the prompt
 */
export function findNamedCorrespondentAddresses(prompt, correspondents) {
  const haystack = ` ${normaliseName(prompt)} `;
  if (haystack.trim().length < 3 || !Array.isArray(correspondents)) return [];
  const addresses = new Set();
  for (const row of correspondents) {
    const name = normaliseName(row?.sender_name);
    const address = String(row?.sender_email || '').trim().toLowerCase();
    if (!name || !address) continue;
    if (name.split(' ').length < 2) continue; // single words are too ambiguous to match mechanically
    if (haystack.includes(` ${name} `)) addresses.add(address);
  }
  return [...addresses];
}

/** "Name <a@b>, Name2 <c@d>" from the jsonb to_emails column and/or to_email text. */
export function formatRecipients(toEmails, toEmail) {
  let list = toEmails;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = null; }
  }
  if (Array.isArray(list) && list.length) {
    return list
      .map((r) => {
        if (typeof r === 'string') return r;
        const email = r?.email || r?.address || '';
        const name = r?.name && r.name !== email ? r.name : '';
        return name ? `${name} <${email}>` : email;
      })
      .filter(Boolean)
      .join(', ');
  }
  return String(toEmail || '');
}

function plain(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The same outgoing email is often stored twice (a "Sent" copy and a plain
 * copy a second apart). Keep one so the chronology doesn't count an email twice.
 * Rows must be sorted by time. Only collapses rows with the same direction,
 * subject and opening text that are within 120 seconds of each other.
 */
export function dedupeNearDuplicateEmails(rows) {
  const out = [];
  for (const row of rows) {
    const time = new Date(row.received_at || row.sent_at || row.created_at || 0).getTime();
    const key = `${row.direction || ''}|${plain(row.subject)}|${plain(row.body || row.body_preview).slice(0, 200)}`;
    const dupe = out.find((o) => o._key === key && Math.abs(o._time - time) <= 120000);
    if (dupe) continue;
    out.push(Object.assign({}, row, { _key: key, _time: time }));
  }
  return out.map(({ _key, _time, ...rest }) => rest);
}

/** One header line so the model always knows who sent an email, to whom, and when. */
export function emailEvidenceHeader(e) {
  const when = e.date || e.received_at || e.sent_at || '';
  const from = e.from || e.sender_name || e.sender_email || '';
  const dir = e.direction || e.folder || '';
  const parts = [];
  if (when) parts.push(`Date: ${when}`);
  if (from) parts.push(`From: ${from}`);
  if (e.to) parts.push(`To: ${e.to}`);
  if (e.subject) parts.push(`Subject: ${e.subject}`);
  if (dir) parts.push(`Direction: ${dir}`);
  return parts.length ? `[${parts.join(' | ')}]\n` : '';
}
