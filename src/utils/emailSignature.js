import { escapeHtml } from './formatters';

export function imageSrcFromBase64(value) {
  if (!value) return '';
  const text = String(value);
  if (text.startsWith('data:')) return text;
  return `data:image/png;base64,${text}`;
}

export function buildFirmSignatureHTML(settings = {}) {
  const firmName = settings.firm_name || settings.trading_name || 'Square One Consulting';
  const surveyorName = settings.surveyor_name || '';
  const qualifications = settings.qualifications || '';
  const address = [
    settings.address_line1,
    settings.address_line2,
    settings.city,
    settings.postcode,
  ].filter(Boolean).join(' | ');
  const tel = settings.tel || '';
  const email = settings.email || '';
  const website = settings.website || '';
  const logo = imageSrcFromBase64(settings.logo_base64);
  const signature = imageSrcFromBase64(settings.signature_b64);
  const accreditation = imageSrcFromBase64(settings.accreditation_b64);

  let html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1a1a1a;border-top:1px solid #e5e7eb;margin-top:24px;padding-top:14px;line-height:1.55">';

  if (logo) {
    html += `<div style="margin-bottom:10px"><img src="${logo}" style="max-height:52px;max-width:190px;object-fit:contain;display:block" /></div>`;
  }

  if (surveyorName) html += `<div style="font-weight:700;font-size:14px;margin-bottom:1px">${escapeHtml(surveyorName)}</div>`;
  if (qualifications) html += `<div style="font-size:12px;color:#555;margin-bottom:8px">${escapeHtml(qualifications)}</div>`;
  html += '<div style="border-top:2px solid #4f7fff;margin:8px 0;width:100%"></div>';
  if (firmName) html += `<div style="font-weight:700;font-size:13px;margin-bottom:2px">${escapeHtml(firmName)}</div>`;
  if (address) html += `<div style="font-size:12.5px;color:#555">${escapeHtml(address)}</div>`;
  if (tel) html += `<div style="font-size:12.5px;color:#555">T: ${escapeHtml(tel)}</div>`;
  if (email) html += `<div style="font-size:12.5px"><a href="mailto:${escapeHtml(email)}" style="color:#4f7fff">${escapeHtml(email)}</a></div>`;
  if (website) html += `<div style="font-size:12.5px"><a href="${escapeHtml(website)}" style="color:#4f7fff">${escapeHtml(website)}</a></div>`;

  if (signature) {
    html += `<div style="margin-top:8px"><img src="${signature}" style="max-height:60px;max-width:220px;object-fit:contain;display:block" /></div>`;
  }

  if (accreditation) {
    html += `<div style="margin-top:10px"><img src="${accreditation}" style="max-height:44px;max-width:220px;object-fit:contain;display:block" /></div>`;
  }

  html += '</div>';
  return html;
}
