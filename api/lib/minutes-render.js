// api/lib/minutes-render.js
// Renders the drafted minutes JSON into an HTML document matching the approved
// Weekly Site Minutes template (navy section headers, green/amber/red action cells)

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SEVERITY_STYLES = {
  none:      { bg: '#D1FAE5', text: '#065F46', bold: false },
  'follow-up': { bg: '#FEF3C7', text: '#92400E', bold: true },
  urgent:    { bg: '#FEE2E2', text: '#991B1B', bold: true },
};

function coverRow(label, value) {
  return `<tr>` +
    `<td class="mins-cover-label">${esc(label)}</td>` +
    `<td class="mins-cover-value">${esc(value)}</td>` +
    `</tr>`;
}

function roomSection(number, room) {
  const rows = (room.rows || []).map(r => {
    const style = SEVERITY_STYLES[r.severity] || SEVERITY_STYLES.none;
    return `<tr>` +
      `<td class="mins-ref">${esc(r.ref)}</td>` +
      `<td class="mins-desc">${esc(r.description)}</td>` +
      `<td class="mins-action" style="background:${style.bg};color:${style.text};font-weight:${style.bold ? 700 : 400}">${esc(r.action)}</td>` +
      `</tr>`;
  }).join('');

  return `<div class="mins-section-heading">${number}. ${esc(room.room_name)}</div>` +
    `<table class="mins-room-table"><thead><tr>` +
    `<th style="width:10%">Ref</th><th style="width:55%">Description</th><th style="width:35%">Action</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>`;
}

export function buildMinutesHtml(draft, session, projectMeta = {}) {
  const rooms = Array.isArray(draft.rooms) ? draft.rooms.filter(r => r.rows && r.rows.length) : [];
  const generalNotes = Array.isArray(draft.general_notes) ? draft.general_notes.filter(Boolean) : [];

  let sectionNumber = 1;
  let html =
    `<div class="mins-document">` +
    `<div class="mins-title-block">` +
    `<div class="mins-main-title">WEEKLY SITE MINUTES</div>` +
    `<div class="mins-subtitle">Site Inspection Record — ${esc(session.week_label || '')}</div>` +
    `</div>` +
    `<table class="mins-cover-table"><tbody>` +
    coverRow('Project', projectMeta.address || '') +
    coverRow('Date of Visit', session.visit_date || '') +
    coverRow('Visit Number', session.week_label || '') +
    coverRow('Attended By', session.attended_by || '') +
    `</tbody></table>`;

  rooms.forEach(room => {
    html += roomSection(sectionNumber, room);
    sectionNumber++;
  });

  if (generalNotes.length) {
    html += `<div class="mins-section-heading">${sectionNumber}. General Notes</div>` +
      `<div class="mins-general-notes"><ol>` +
      generalNotes.map(n => `<li>${esc(n)}</li>`).join('') +
      `</ol></div>`;
    sectionNumber++;
  }

  html += `</div>`;
  return html;
}

export function injectMinutesCss(html, headerText = '') {
  const css = `
    <style>
      body { width: 210mm; margin: 0; padding: 0; background: #ffffff !important; font-family: Arial, sans-serif; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .mins-document { width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }
      .mins-document::before { content: "${headerText.replace(/"/g, '\\"')}"; display: block; font-size: 8.5pt; color: #666666; text-align: right; margin-bottom: 6mm; }
      .mins-title-block { text-align: center; margin-bottom: 20px; }
      .mins-main-title { font-size: 24pt; font-weight: 700; color: #1F2937; }
      .mins-subtitle { font-size: 13pt; color: #6B7280; margin-top: 4px; }
      .mins-cover-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
      .mins-cover-table td { border: 1px solid #C8C8C8; padding: 8px 12px; font-size: 10.5pt; }
      .mins-cover-label { background: #F3F4F6; font-weight: 700; color: #374151; width: 30%; }
      .mins-section-heading { background: #1F2937; color: #ffffff; font-weight: 700; font-size: 12pt; padding: 8px 12px; margin: 20px 0 8px 0; }
      .mins-room-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
      .mins-room-table th { background: #F3F4F6; border: 1px solid #C8C8C8; padding: 6px 10px; text-align: left; font-size: 10pt; }
      .mins-room-table td { border: 1px solid #C8C8C8; padding: 7px 10px; font-size: 10pt; vertical-align: top; }
      .mins-ref { font-weight: 700; }
      .mins-general-notes { border: 1px solid #C8C8C8; background: #FFFBEB; padding: 12px 16px; margin-bottom: 12px; }
      .mins-general-notes ol { margin: 0; padding-left: 18px; font-size: 10.5pt; }
      .mins-general-notes li { margin-bottom: 6px; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
      thead { display: table-header-group; }
    </style>
  `;
  if (html.includes('</head>')) return html.replace('</head>', `${css}</head>`);
  return `<!DOCTYPE html><html><head>${css}</head><body>${html}</body></html>`;
}
