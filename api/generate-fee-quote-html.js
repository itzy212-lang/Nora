// api/generate-fee-quote-html.js
// Generates a party wall fee proposal as styled HTML — fed into PDF export pipeline.
// Accepts: client_name, property_address, works_description, num_aos,
//          fee_notice (per AO), fee_soc, fee_agreed, fee_separate, quote_ref, bo_email

const DARK   = '#1f2d3d';
const MID    = '#e8ecf0';
const LIGHT  = '#f7f8fa';
const GREY   = '#666666';
const BORDER = '#c8c8c8';
const WHITE  = '#ffffff';

function fmt(amount) {
  return `\u00a3${Number(amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function today() {
  return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function generateQuoteRef() {
  const now = new Date();
  return `SQ1-FQ-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${Math.floor(Math.random()*900+100)}`;
}

function esc(t='') {
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function coverRow(label, value, label2='', value2='') {
  return `<tr>
    <td style="padding:5px 8px;font-weight:bold;font-size:8.5pt;color:${DARK};background:${MID};width:18%;">${esc(label)}</td>
    <td style="padding:5px 8px;font-size:8.5pt;background:${LIGHT};width:32%;">${esc(value)}</td>
    <td style="padding:5px 8px;font-weight:bold;font-size:8.5pt;color:${DARK};background:${MID};width:14%;">${esc(label2)}</td>
    <td style="padding:5px 8px;font-size:8.5pt;background:${LIGHT};width:36%;">${esc(value2)}</td>
  </tr>`;
}

function optionRow(num, title, fee, perProp, notes, shade) {
  const bg = shade ? LIGHT : WHITE;
  return `<tr style="background:${bg};">
    <td style="border:1px solid ${BORDER};padding:6px 8px;font-weight:bold;font-size:8.5pt;color:${DARK};text-align:center;vertical-align:top;width:6%;">${num}</td>
    <td style="border:1px solid ${BORDER};padding:6px 8px;font-weight:bold;font-size:8.5pt;color:${DARK};vertical-align:top;width:26%;">${esc(title)}</td>
    <td style="border:1px solid ${BORDER};padding:6px 8px;font-weight:bold;font-size:8.5pt;color:${DARK};text-align:right;vertical-align:top;width:18%;">
      ${esc(fee)}<br>
      <span style="font-weight:normal;font-size:7pt;color:${GREY};font-style:italic;">${esc(perProp)}</span><br>
      <span style="font-weight:normal;font-size:6.5pt;color:${GREY};font-style:italic;">25% reduction on further appts</span><br>
      <span style="font-weight:normal;font-size:6.5pt;color:${GREY};font-style:italic;">Additional discounts for 3+ AOs</span>
    </td>
    <td style="border:1px solid ${BORDER};padding:6px 8px;font-size:7.5pt;color:${GREY};vertical-align:top;">${notes}</td>
  </tr>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const {
      client_name = '',
      property_address = '',
      works_description = '',
      num_aos = '1',
      fee_notice = '107',
      fee_soc = '500',
      fee_agreed = '950',
      fee_separate = '950',
      quote_ref,
      bo_email = '',
    } = body;

    const ref = quote_ref || generateQuoteRef();
    const numAOs = parseInt(num_aos) || 1;
    const noticeUnit = parseFloat(fee_notice) || 107;
    const noticeTotal = noticeUnit * numAOs;

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 9pt; color: #1a1a1a; background: #fff; padding: 18mm 18mm; }
  table { border-collapse: collapse; width: 100%; }
  .hdr-label { background: ${DARK}; color: #fff; padding: 5px 8px; font-weight: bold; font-size: 8.5pt; }
</style>
</head>
<body>

<!-- Header -->
<div style="text-align:center;border-bottom:2px solid ${DARK};padding-bottom:8px;margin-bottom:10px;">
  <div style="font-size:14pt;font-weight:bold;color:${DARK};">SQUARE ONE CONSULTING</div>
  <div style="font-size:8.5pt;color:${GREY};font-style:italic;">Party Wall Surveyors &amp; Construction Consultants</div>
  <div style="font-size:10pt;font-weight:bold;color:${DARK};margin-top:6px;">FEE PROPOSAL &mdash; PARTY WALL ETC. ACT 1996</div>
</div>

<!-- Cover info -->
<table style="margin-bottom:10px;">
  ${coverRow('Building Owner', client_name, 'Date', today())}
  ${coverRow("Building Owner's Property", property_address, 'Reference', ref)}
  ${coverRow('Proposed Works', works_description, 'Prepared By', 'Itzik Darel ACIArb MIPWS')}
  ${coverRow('Adjoining Owner(s)', numAOs + ' Adjoining Owner' + (numAOs !== 1 ? 's' : '') + ' identified', '', '')}
</table>

<!-- Notice fee -->
<table style="margin-bottom:4px;">
  <tr>
    <td class="hdr-label" style="width:58%;">NOTICE SERVICE FEE</td>
    <td class="hdr-label" style="width:16%;text-align:right;">UNIT PRICE</td>
    <td class="hdr-label" style="width:10%;text-align:center;">QTY</td>
    <td class="hdr-label" style="width:16%;text-align:right;">TOTAL</td>
  </tr>
  <tr style="background:${LIGHT};">
    <td style="border:1px solid ${BORDER};padding:6px 8px;font-size:8pt;">
      Preparing, drafting and serving a Party Wall Notice under the Party Wall etc. Act 1996.
      This includes review of the proposed works, identification of all relevant sections of the Act,
      preparation of the formal notice documentation and service upon each Adjoining Owner.
      The Adjoining Owner has 14 days from the date of service to respond.
    </td>
    <td style="border:1px solid ${BORDER};padding:6px 8px;font-weight:bold;font-size:8.5pt;text-align:right;">${fmt(noticeUnit)}</td>
    <td style="border:1px solid ${BORDER};padding:6px 8px;font-weight:bold;font-size:8.5pt;text-align:center;">${numAOs}</td>
    <td style="border:1px solid ${BORDER};padding:6px 8px;font-weight:bold;font-size:8.5pt;text-align:right;">${fmt(noticeTotal)}</td>
  </tr>
</table>
<p style="font-size:7.5pt;color:${GREY};font-style:italic;margin-bottom:10px;">
  If additional adjoining properties require notices serving at any point, the fee is ${fmt(noticeUnit)} per adjoining property.
</p>

<!-- Response options -->
<table style="margin-bottom:4px;">
  <tr>
    <td class="hdr-label" style="text-align:center;width:6%;">OPT</td>
    <td class="hdr-label" style="width:26%;">ADJOINING OWNER RESPONSE</td>
    <td class="hdr-label" style="text-align:right;width:18%;">FEE</td>
    <td class="hdr-label" style="width:50%;">DESCRIPTION</td>
  </tr>
  ${optionRow('1', 'Consent — No Further Action', 'No additional fee', 'per property', 'The Adjoining Owner consents to the works without conditions. No further action required. The notice fee above covers all work at this stage.', false)}
  ${optionRow('2', 'Consent Subject to Schedule of Conditions', fmt(fee_soc), 'per property', 'A photographic Schedule of Conditions is prepared prior to works commencing, recording the existing state of the Adjoining Owner\'s property as a baseline for any future claims.', true)}
  ${optionRow('3', 'Dissent — Appoint Itzik Darel as Agreed Surveyor', fmt(fee_agreed), 'per appointment', 'A Party Wall Award is prepared acting as Agreed Surveyor for both parties. Fee is fixed regardless of the number of notices served.', false)}
  ${optionRow('4', 'Dissent — Appoint Own Surveyor', fmt(fee_separate), 'per appointment', 'The Adjoining Owner appoints their own surveyor. I act as the Building Owner\'s Appointed Surveyor. Each party bears their own surveyor\'s fees separately.', true)}
</table>
<p style="font-size:7pt;color:${GREY};font-style:italic;margin-bottom:10px;">
  All fees for Options 2&ndash;4 are per adjoining property. The 25% reduction applies to the second and any further appointment. Where there are more than two adjoining properties, additional discounts can be discussed.
</p>

<!-- Notes -->
<hr style="border:none;border-top:0.5px solid ${BORDER};margin-bottom:8px;"/>
<ul style="padding-left:14px;margin-bottom:8px;">
  <li style="font-size:7.5pt;color:#111;margin-bottom:5px;line-height:1.4;">
    <b>Failure to Respond within 14 Days:</b> If no response is received within 14 days of the service date, the Adjoining Owner is deemed to have dissented and a dispute arises under the Act. Options 1 and 2 are no longer available; Options 3 and 4 become the primary routes. A Section 10 notice will be served — <i>there is no additional charge for this; it is included within the original notice fee.</i>
  </li>
  <li style="font-size:7.5pt;color:#111;line-height:1.4;">
    <b>Surveyor Appointment under Section 10(4)(b):</b> If, after 10 days from service of the Section 10 notice, the Adjoining Owner has not appointed a surveyor, an appointment may be made on their behalf under s.10(4)(b). This cannot be myself — an independent second surveyor must be instructed.
  </li>
</ul>
<hr style="border:none;border-top:0.5px solid ${BORDER};margin-bottom:6px;"/>
<div style="text-align:center;font-size:7pt;color:${GREY};">
  This fee proposal is valid for 14 days from the date above.&nbsp;&nbsp;|&nbsp;&nbsp;
  Square One Consulting&nbsp;&nbsp;|&nbsp;&nbsp;help@sq1consulting.co.uk&nbsp;&nbsp;|&nbsp;&nbsp;Itzik Darel ACIArb MIPWS
</div>

</body>
</html>`;

    return res.status(200).json({
      success: true,
      quote_ref: ref,
      html,
      bo_email,
    });

  } catch (err) {
    console.error('[generate-fee-quote-html]', err);
    return res.status(500).json({ error: err.message });
  }
}
