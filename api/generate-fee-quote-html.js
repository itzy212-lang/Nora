// api/generate-fee-quote-html.js
// Generates the SAME party wall fee quote content as generate-fee-quote.js,
// but as styled HTML instead of a .docx — this gets sent to export-soc-pdf.js
// (the same API2PDF pipeline already used for Schedule of Conditions exports)
// to produce a genuine PDF, since 'docx' has no PDF export capability.
// Accepts: client_name, property_address, works_description, num_aos,
//          fee_notice, fee_soc, fee_agreed, fee_separate, quote_ref

const NAVY = "#1E3A5F";
const LIGHT = "#E8F0F8";
const GREY = "#F5F5F5";
const MID = "#444444";
const BORDER = "#CCCCCC";

function fmt(amount) {
  return `£${Number(amount).toLocaleString('en-GB')}`;
}

function today() {
  return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function validUntil() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function generateQuoteRef() {
  const now = new Date();
  return `SQ1-FQ-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Math.floor(Math.random() * 900 + 100)}`;
}

function esc(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function infoRow(label, value) {
  return `
    <tr>
      <td style="padding:6px 12px 6px 0; font-weight:bold; font-size:9.5pt; color:${MID}; vertical-align:top; width:28%;">${esc(label)}</td>
      <td style="padding:6px 0; font-size:9.5pt; color:#111827; vertical-align:top;">${esc(value)}</td>
    </tr>`;
}

function feeRow(stage, description, fee, shade = false) {
  const bg = shade ? GREY : '#ffffff';
  return `
    <tr style="background:${bg};">
      <td style="border:1px solid ${BORDER}; padding:10px 12px; font-weight:bold; font-size:9.5pt; color:${NAVY}; vertical-align:top; width:8%;">${esc(stage)}</td>
      <td style="border:1px solid ${BORDER}; padding:10px 12px; font-size:9.5pt; color:#111827; vertical-align:top;">${description}</td>
      <td style="border:1px solid ${BORDER}; padding:10px 12px; font-weight:bold; font-size:10pt; color:${NAVY}; text-align:right; vertical-align:top; width:18%;">${esc(fee)}</td>
    </tr>`;
}

function bullet(text) {
  return `<li style="font-size:9.5pt; color:${MID}; margin-bottom:4px;">${esc(text)}</li>`;
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
      fee_notice = '100',
      fee_soc = '300',
      fee_agreed = '450',
      fee_separate = '600',
      quote_ref,
    } = body;

    const ref = quote_ref || generateQuoteRef();
    const numAOs = parseInt(num_aos) || 1;
    const plural = numAOs !== 1;

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: Arial, sans-serif; color: ${MID}; margin: 0; padding: 0; }
  .header-line { font-size: 9pt; color: ${MID}; margin: 0; }
  table { border-collapse: collapse; width: 100%; }
  h1 { font-size: 14pt; color: ${NAVY}; border-bottom: 2px solid ${NAVY}; padding-bottom: 4px; margin: 24px 0 8px; }
  h2 { font-size: 10.5pt; color: ${NAVY}; margin: 14px 0 4px; }
  p { font-size: 9.5pt; color: ${MID}; line-height: 1.5; margin: 6px 0; }
  ul { margin: 6px 0; padding-left: 20px; }
</style>
</head>
<body>

  <div style="font-weight:bold; font-size:12pt; color:${NAVY};">SQUARE ONE CONSULTING</div>
  <p class="header-line">Party Wall Surveying | Construction Management | Dispute Resolution</p>
  <p class="header-line">help@sq1consulting.co.uk &nbsp;|&nbsp; 07889 996 841 &nbsp;|&nbsp; www.sq1consulting.co.uk</p>
  <div style="border-bottom: 3px solid ${NAVY}; margin-top: 14px;"></div>

  <div style="font-weight:bold; font-size:24pt; color:${NAVY}; margin-top:20px;">FEE QUOTATION</div>
  <div style="font-size:12pt; color:${MID}; margin-bottom:16px;">Party Wall Surveying Services</div>

  <table style="margin-bottom: 16px;">
    ${infoRow('Quote Reference:', ref)}
    ${infoRow('Date:', today())}
    ${infoRow('Valid Until:', validUntil() + ' (14 days)')}
    ${infoRow('Prepared For:', client_name)}
    ${infoRow('Property Address:', property_address)}
    ${infoRow('Proposed Works:', works_description)}
    ${infoRow('Adjoining Owners:', `${numAOs} adjoining owner${plural ? 's' : ''} likely to be affected`)}
  </table>

  <p style="font-style:italic; border-top:1px solid ${BORDER}; padding-top:12px;">
    Thank you for getting in touch regarding the above property. I set out below my fees for party wall surveying services in connection with the proposed works.
  </p>

  <h1>1.&nbsp; Fee Schedule</h1>
  <p>My fees depend on how your neighbour(s) respond to the party wall notice. The options are set out below.</p>

  <table style="margin-top:10px;">
    <tr>
      <td style="background:${NAVY}; color:#fff; padding:8px 12px; font-weight:bold; font-size:9pt; width:8%;">Stage</td>
      <td style="background:${NAVY}; color:#fff; padding:8px 12px; font-weight:bold; font-size:9pt;">Description</td>
      <td style="background:${NAVY}; color:#fff; padding:8px 12px; font-weight:bold; font-size:9pt; text-align:right; width:18%;">Fee</td>
    </tr>
    ${feeRow('1', `Preparation and service of the Party Wall Notice on ${numAOs} adjoining owner${plural ? 's' : ''}. This covers our initial consultation, preparation of the statutory notice, and formal service on all affected owners.`, fmt(fee_notice), false)}
    <tr>
      <td colspan="3" style="background:${LIGHT}; padding:8px 12px; font-weight:bold; font-size:9pt; color:${NAVY};">Following service of the notice, the adjoining owner${plural ? 's' : ''} have three options:</td>
    </tr>
    ${feeRow('2A', `Consent. The adjoining owner${plural ? 's' : ''} consent to the works in writing. No further action is required.`, 'No further fee', false)}
    ${feeRow('2B', `Consent subject to Schedule of Conditions. My fee covers the inspection, photography, and preparation of the written Schedule of Conditions report.`, fmt(fee_soc), true)}
    ${feeRow('2C', `Dissent and my appointment as your surveyor. My fee covers preparation and service of the Party Wall Award and all associated correspondence. If the adjoining owner${plural ? 's' : ''} appoint${plural ? '' : 's'} ${plural ? 'their own surveyors' : 'their own surveyor'}, ${plural ? 'those' : 'their'} fees are also payable by you in addition to the fee below.`, fmt(fee_agreed), false)}
  </table>

  <p>If I am appointed as the Agreed Surveyor, acting on behalf of both the building owner and the adjoining owner${plural ? 's' : ''}, my fee is ${fmt(fee_separate)} per appointment.</p>
  <p>The fees set out above are per adjoining owner. ${numAOs} adjoining owner${plural ? 's are' : ' is'} affected by the proposed works.</p>

  <h1>2.&nbsp; What Is Included</h1>
  <ul>
    ${bullet('Initial consultation and review of drawings and proposed works')}
    ${bullet('Assessment of which party wall notices are required and on which adjoining owners')}
    ${bullet('Preparation and formal service of all required notices under the Party Wall etc. Act 1996')}
    ${bullet("Continuous dialogue and liaison with the building owner's design team including the architect, structural engineer, and any other consultants throughout the party wall process")}
    ${bullet('Ongoing party wall advice to the building owner throughout the works')}
    ${bullet('Liaison with adjoining owners and their representatives throughout the process')}
    ${bullet('Preparation of the Party Wall Award (if required), setting out the conditions under which works may proceed')}
    ${bullet('Site inspection(s) as required during and after the works')}
    ${bullet('Schedule of Conditions survey and report (if applicable)')}
  </ul>

  <h1>3.&nbsp; Additional Notes</h1>
  <h2>Multiple Adjoining Owners</h2>
  <p>Where there is more than one adjoining owner affected, the fees above apply per notice served. We will confirm the total fee in writing before proceeding.</p>
  <h2>Adjoining Owner's Surveyor's Fees</h2>
  <p>Where the adjoining owner appoints their own surveyor, their reasonable fees are also payable by you. These are outside our control and will vary depending on the surveyor appointed. We will keep you informed as the matter progresses.</p>
  <h2>Disbursements</h2>
  <p>Any third-party costs such as postage, Land Registry searches, or specialist reports will be charged at cost with your prior approval.</p>

  <h1>4.&nbsp; Terms</h1>
  <ul>
    ${bullet('This quotation is valid for 14 days from the date of issue.')}
    ${bullet('Works must not commence until all required party wall notices have been properly served and the relevant statutory periods have elapsed.')}
    ${bullet('Our fees are payable in accordance with the payment terms agreed at the time of instruction.')}
  </ul>

  <h1>5.&nbsp; Next Steps</h1>
  <p>Please confirm your acceptance of this quotation by reply email. Once instructed, we will:</p>
  <ul>
    ${bullet('Carry out a full review of your drawings and confirm which notices are required')}
    ${bullet('Confirm the total fee in writing where multiple adjoining owners are involved')}
    ${bullet('Contact you to arrange service of the notice(s)')}
    ${bullet('Keep you informed at every stage of the process')}
  </ul>

  <div style="border-top:1px solid ${BORDER}; margin-top:30px; padding-top:14px; text-align:center;">
    <div style="font-size:8.5pt; color:#9ca3af;">Square One Consulting &nbsp;|&nbsp; help@sq1consulting.co.uk &nbsp;|&nbsp; 07889 996 841</div>
    <div style="font-size:7.5pt; color:#d1d5db; margin-top:4px;">Generated by Nora</div>
  </div>

</body>
</html>`;

    return res.status(200).json({
      success: true,
      quote_ref: ref,
      html,
    });

  } catch (err) {
    console.error('[generate-fee-quote-html]', err);
    return res.status(500).json({ error: err.message });
  }
}
