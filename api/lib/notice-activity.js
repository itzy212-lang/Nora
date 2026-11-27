// api/lib/notice-activity.js
//
// 27 Nov 2026. Pure helpers for the AO card's list of served notices: which sections a notice covered, and
// the one-line description of what happened to it (posted, emailed, saved). No provider code in here, so it
// is the same for every user (Outlook or Gmail, OneDrive or Google Drive).
import { letterStatusLabel, royalMailTrackingUrl } from './letter-post.js';

/** "Sections 6(1), 1(5) and 2(2)(a)" or "Section 10 notice" for one row of the notices table. */
export function noticeSectionsLabel(n = {}) {
  const sections = Array.isArray(n.sections) ? n.sections : [];
  if (n.section_10 || sections.includes('s10')) return 'Section 10 notice';
  const parts = [];
  if (n.section_6 || sections.includes('s6')) parts.push('6(1)');
  if (n.section_1 || sections.includes('s1')) parts.push('1(5)');
  if (n.section_2 || n.section_3 || sections.includes('s2') || sections.includes('s3')) {
    const subs = String(n.section_2_subsections || '').split(',').map(s => s.trim()).filter(Boolean).map(s => `(${s})`).join('');
    parts.push(`2(2)${subs}`);
  }
  if (!parts.length) return 'Notice';
  if (parts.length === 1) return `Section ${parts[0]}`;
  return `Sections ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * What happened to a served notice, for display.
 * `letter` is the matching posted_letters row (or null). Returns { text, trackingNumber, trackingUrl, final }.
 * `final` is true when nothing more will change (so the card can stop asking the letter provider).
 */
export function noticeDeliveryInfo(notice = {}, letter = null) {
  const method = notice.delivery_method || '';
  if (method === 'posted') {
    if (letter?.testmode) return { text: 'Test letter (nothing posted)', trackingNumber: '', trackingUrl: null, final: true };
    const s = letterStatusLabel(letter?.status);
    const tracking = letter?.tracking_number || '';
    // A posted date with no later status means it has left Intelliprint, so say so.
    let label = s.label;
    if (letter?.shipped_at && /waiting|accepted/i.test(label)) label = 'Posted';
    if (letter?.returned_reason && s.label === 'Returned') label = `Returned (${letter.returned_reason})`;
    return { text: label, trackingNumber: tracking, trackingUrl: royalMailTrackingUrl(tracking), final: s.final };
  }
  if (method === 'emailed') return { text: 'Emailed', trackingNumber: '', trackingUrl: null, final: true };
  if (method === 'saved') return { text: 'Saved', trackingNumber: '', trackingUrl: null, final: true };
  return { text: '', trackingNumber: '', trackingUrl: null, final: true };
}
