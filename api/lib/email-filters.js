// api/lib/email-filters.js
//
// 27 Nov 2026. Plain-code rules for mail coming in (no AI, no tokens):
//  - isBlockedSender: has this user blocked this sender (or the sender's whole domain)?
//  - isOtherFrom*: did the provider itself file the mail outside the main inbox?
//    Outlook "Other", or the Gmail Promotions / Social / Forums tabs -> true (saved with emails.is_other).
//    Anything else -> false (normal mail).
//  - Shared-mailbox domains (gmail.com, outlook.com ...) can never be blocked as a whole domain.
//
// The Outlook sync runs as a Supabase edge function and keeps its own small copy of these rules
// (it cannot import from this folder), so if you change them here, change sync_outlook too.

export const PUBLIC_MAIL_DOMAINS = new Set([
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

function ruleMatches(r, addr, dom) {
  const v = String(r.value || '').trim().toLowerCase();
  if (!v) return false;
  if (r.kind === 'email') return v === addr;
  if (r.kind === 'domain') return !!dom && !PUBLIC_MAIL_DOMAINS.has(dom) && (dom === v || dom.endsWith('.' + v));
  return false;
}

function hasRule(rows, senderAddress, action) {
  const addr = String(senderAddress || '').trim().toLowerCase();
  if (!addr || !Array.isArray(rows) || !rows.length) return false;
  const dom = domainOf(addr);
  return rows.some(r => (r.action || 'block') === action && ruleMatches(r, addr, dom));
}

/** rows: [{ kind: 'email'|'domain', value, action }]. A domain rule also covers sub-domains (mail.linkedin.com). */
export function isBlockedSender(rows, senderAddress) { return hasRule(rows, senderAddress, 'block'); }

/** Senders the user asked to have filed under Others (mail is still saved, but never processed). */
export function isRoutedToOthers(rows, senderAddress) { return hasRule(rows, senderAddress, 'others'); }

/** Outlook Graph: message.inferenceClassification is 'focused' or 'other'. */
export function isOtherFromOutlook(inferenceClassification) {
  return String(inferenceClassification || '').toLowerCase() === 'other';
}

/** Gmail: tab categories arrive as labelIds. Updates stays in the main inbox (receipts, invoices, alerts). */
const GMAIL_OTHER_LABELS = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'];
export function isOtherFromGmailLabels(labelIds) {
  return Array.isArray(labelIds) && labelIds.some(l => GMAIL_OTHER_LABELS.includes(l));
}

/** Whole-word phrase match ("1 Nether Street" must not match inside "121 Nether Street"). */
export function containsWholePhrase(haystack, needle) {
  const n = String(needle || '').trim();
  if (!n) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z0-9])' + esc + '([^a-z0-9]|$)', 'i').test(String(haystack || ''));
}
