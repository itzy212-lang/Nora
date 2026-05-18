// formatters.js — date/string utilities

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

export function fmt(d) {
  return d ? fmtLongDate(d) : '--';
}

export function fmtLongDate(d) {
  if (!d) return '--';
  const date = new Date(d);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function fmtShort(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysUntil(d) {
  if (!d) return 9999;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(d) - today) / 86400000);
}

export function initials(n) {
  return n ? n.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?';
}

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function ordinalDay(n) {
  n = Number(n);
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function projectAddress(p) {
  if (!p) return '';
  return p.address || p.bo_address || '';
}

export function getProjColour(p) {
  const aos = p.aos || [];
  if (aos.some(ao => ['notice_expired', 's10_expired', '104b_triggered'].includes(ao.status))) return 'c-red';
  if (aos.some(ao => ['dissented', 'surveyor_appointed', 'award_in_progress'].includes(ao.status))) return 'c-amber';
  if (!aos.length || aos.every(ao => !ao.status || ao.status === 'awaiting')) return 'c-grey';
  return 'c-green';
}

export function getAOStatus(ao) {
  const statusMap = {
    awaiting: { label: 'Awaiting notice', colour: 's-grey' },
    details_added: { label: 'Details added', colour: 's-grey' },
    notice_served: { label: 'Notice served', colour: 's-blue' },
    consented: { label: 'Consented', colour: 's-green' },
    dissented: { label: 'Dissented', colour: 's-amber' },
    surveyor_appointed: { label: 'Surveyor appointed', colour: 's-amber' },
    award_in_progress: { label: 'Award in progress', colour: 's-amber' },
    award_served: { label: 'Award served', colour: 's-green' },
    notice_expired: { label: 'Notice expired', colour: 's-red' },
    s10_expired: { label: 'S10 expired', colour: 's-red' },
    '104b_triggered': { label: '104B triggered', colour: 's-red' },
    complete: { label: 'Complete', colour: 's-green' },
  };
  return statusMap[ao.status] || { label: ao.status || 'Unknown', colour: 's-grey' };
}

export function formatEmailTime(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function renderMarkdown(text) {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^---+$/gm, '<hr>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^\* (.+)$/gm, '<li>$1</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*?<\/li>\n?)+/gs, match => `<ul>${match}</ul>`);
  html = html.split('\n').map(line => {
    if (!line.trim()) return '';
    if (/^<(h[123]|ul|ol|li|blockquote|hr|pre|code)/.test(line)) return line;
    return `<p>${line}</p>`;
  }).join('');
  return html;
}
