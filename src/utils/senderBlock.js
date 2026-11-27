// src/utils/senderBlock.js
//
// 27 Nov 2026. Front-end side of the junk-sender block: which senders are in the selected emails, and
// whether each one's whole domain may be blocked. Shared mailbox domains (gmail.com, outlook.com ...)
// can never be blocked as a whole. Keep the list in step with api/lib/email-filters.js.
const PUBLIC_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'live.co.uk',
  'msn.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'btinternet.com', 'sky.com', 'talktalk.net', 'virginmedia.com', 'proton.me', 'protonmail.com', 'gmx.com',
]);

export function domainOf(address) {
  const a = String(address || '').trim().toLowerCase();
  const at = a.lastIndexOf('@');
  return at > -1 ? a.slice(at + 1) : '';
}

export function canBlockDomain(address) {
  const d = domainOf(address);
  return !!d && !PUBLIC_MAIL_DOMAINS.has(d);
}

/** Unique incoming senders among the given emails: [{ address, domain, canDomain, userId }]. Your own sent mail is ignored. */
export function sendersOf(emails) {
  const seen = new Map();
  for (const e of emails || []) {
    if (!e || e.direction === 'outgoing' || !e.sender_email) continue;
    const address = String(e.sender_email).trim().toLowerCase();
    if (!address.includes('@') || seen.has(address)) continue;
    seen.set(address, { address, domain: domainOf(address), canDomain: canBlockDomain(address), userId: e.user_id });
  }
  return [...seen.values()];
}

/** Rows to save in blocked_senders for the chosen mode: 'sender' (exact addresses) or 'domain' (whole domains where allowed). */
export function blockRowsFor(senders, mode) {
  const rows = new Map();
  for (const s of senders) {
    if (!s.userId) continue;
    if (mode === 'domain' && s.canDomain) rows.set(`${s.userId}|domain|${s.domain}`, { user_id: s.userId, kind: 'domain', value: s.domain });
    else rows.set(`${s.userId}|email|${s.address}`, { user_id: s.userId, kind: 'email', value: s.address });
  }
  return [...rows.values()];
}
