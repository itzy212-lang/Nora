import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const API2PDF_ENDPOINT = 'https://v2.api2pdf.com/chrome/pdf/html';

// ── Helpers ────────────────────────────────────────────────────────────────

function ownerNameFromProject(project = {}) {
  if (project.bo_company) return project.bo_company;
  return [project.bo_1_name, project.bo_2_name, project.bo_name].filter(Boolean).join(' & ');
}

function aoAddress(ao = {}) {
  return ao.premise || ao.reg_addr || ao.address || ao.ao_premise_address || '';
}

function aoNames(ao = {}) {
  return [ao.name || ao.ao_name_1, ao.name2 || ao.ao_name_2].filter(Boolean).join(' & ');
}

function aoServiceAddress(ao = {}) {
  return ao.service_address || ao.serviceAddress || ao.ao_service_address || ao.reg_addr || aoAddress(ao) || '';
}

// ── AI extraction ──────────────────────────────────────────────────────────

async function extractStructuredData(message, projectMeta, uploadedFiles, apiKey) {
  const fileDescriptions = (uploadedFiles || []).map(f => `[Uploaded: ${f.name}]`).join('\n');

  const prompt = `You are an expert Party Wall Surveyor preparing a formal Party Agreement document. Always use British English spelling and legal terminology throughout.

Analyse the dictated notes and any uploaded documents, then return structured JSON data to populate a Party Agreement.

First, determine the AGREEMENT TYPE from the context:
- "Party Agreement for Building Works" — works carried out without notice, dispute over works
- "Party Agreement for Scaffold Access" — licence for scaffolding on or over adjoining owner's property
- "Party Agreement for Access" — general access licence
- "Party Agreement for Making Good" — agreement to remedy damage or carry out reinstatement
- "Party Agreement" — general/other

Return ONLY valid JSON. No markdown, no backticks, no preamble.

{
  "agreement_type": "Party Agreement for Building Works",
  "subtitle": "In Respect of [brief description]",
  "header_subtitle": "FOR BUILDING WORKS",
  "bo_name_1": "",
  "bo_name_2": "",
  "bo_address": "",
  "bo_service_address": "",
  "ao_name_1": "",
  "ao_name_2": "",
  "ao_address": "",
  "ao_service_address": "",
  "recitals": [
    "WHEREAS [first recital]",
    "AND WHEREAS [second recital]",
    "AND WHEREAS [third recital]"
  ],
  "works_items": [
    { "label": "a", "description": "Description of works" }
  ],
  "include_scaffolding_clauses": false,
  "include_weathering_clauses": false,
  "defects_period": "one (1) year",
  "fee_amount": "[TBC]",
  "special_clauses": []
}

Rules:
- Recitals must follow WHEREAS / AND WHEREAS / NOW THEREFORE legal format, full legal prose, third person.
- Works items written in formal surveyor language, numbered (a)(b)(c).
- include_scaffolding_clauses: true ONLY if scaffolding access over AO's property is mentioned.
- include_weathering_clauses: true ONLY if weathering/flashing/roof junction works are mentioned.
- bo_name_2 and ao_name_2 should be "" if only one owner on that side.
- Pull BO name and address from project context. Pull AO details from context or notes.

Project context:
Building Owner: ${projectMeta.bo_names || ''}
Building Owner address: ${projectMeta.bo_address || ''}
Adjoining Owner: ${projectMeta.ao_names || ''}
Adjoining Owner address: ${projectMeta.ao_address || ''}
Project ref: ${projectMeta.ref || ''}

${fileDescriptions ? `Uploaded documents:\n${fileDescriptions}\n` : ''}

Dictated notes:
${message || '(Generate based on project context)'}`;

  const messages = [{ role: 'user', content: prompt }];

  if (uploadedFiles && uploadedFiles.length > 0) {
    const contentParts = [{ type: 'text', text: prompt }];
    for (const file of uploadedFiles) {
      if (file.type === 'application/pdf' || file.type?.startsWith('image/')) {
        contentParts.push({
          type: file.type === 'application/pdf' ? 'document' : 'image',
          source: { type: 'base64', media_type: file.type, data: file.base64 },
        });
      }
    }
    messages[0] = { role: 'user', content: contentParts };
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: 'You are an expert Party Wall Surveyor. Return only valid JSON. Use British English and formal legal register.',
      messages,
    }),
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'Claude extraction failed');

  const raw = payload.content?.[0]?.text || '';
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

// ── Refine ─────────────────────────────────────────────────────────────────

async function refineStructuredData(instruction, existingData, projectMeta, apiKey) {
  const prompt = `You are an expert Party Wall Surveyor. Apply the following instruction to the existing Party Agreement JSON and return the COMPLETE updated JSON. Return ONLY valid JSON, no markdown.

Instruction: ${instruction}

Current JSON:
${JSON.stringify(existingData, null, 2)}

Project context:
Building Owner: ${projectMeta.bo_names || ''}
Building Owner address: ${projectMeta.bo_address || ''}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: 'You are an expert Party Wall Surveyor. Apply the requested change and return complete updated JSON only.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'Refinement failed');

  const raw = payload.content?.[0]?.text || '';
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

// ── HTML renderer ──────────────────────────────────────────────────────────

function renderAgreementHtml(data = {}, projectMeta = {}) {
  const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const boName = [data.bo_name_1, data.bo_name_2].filter(Boolean).join(' & ') || projectMeta.bo_names || '';
  const boAddress = data.bo_address || projectMeta.bo_address || '';
  const aoName = [data.ao_name_1, data.ao_name_2].filter(Boolean).join(' & ') || projectMeta.ao_names || '';
  const aoAddress = data.ao_address || projectMeta.ao_address || '';

  const recitals = Array.isArray(data.recitals) ? data.recitals : [];
  const worksItems = Array.isArray(data.works_items) ? data.works_items : [];

  let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #222; max-width: 860px; margin: 0 auto; padding: 32px 40px; line-height: 1.6; }
  .doc-header { text-align: center; border-bottom: 2px solid #2E75B6; padding-bottom: 20px; margin-bottom: 28px; }
  .confidential { font-size: 9pt; color: #666; letter-spacing: 1px; margin-bottom: 8px; }
  .doc-title { font-size: 20pt; font-weight: 700; color: #1F3864; margin: 8px 0; letter-spacing: 1px; }
  .doc-subtitle { font-size: 11pt; color: #2E75B6; font-weight: 600; margin: 4px 0 0; }
  .parties-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  .parties-table td { padding: 6px 10px; border: 1px solid #ddd; font-size: 10.5pt; }
  .parties-table td:first-child { font-weight: 700; color: #1F3864; width: 200px; background: #f5f8ff; }
  .section-heading { font-size: 12pt; font-weight: 700; color: #1F3864; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #dce6f4; }
  .clause { margin-bottom: 10px; padding-left: 0; }
  .clause-num { font-weight: 700; color: #1F3864; margin-right: 6px; }
  .recital { margin-bottom: 8px; line-height: 1.7; text-align: justify; }
  .works-item { margin-bottom: 6px; padding-left: 24px; }
  .sig-block { margin-bottom: 28px; }
  .sig-name { font-weight: 700; margin-bottom: 4px; }
  .sig-line { border-bottom: 1px solid #888; margin: 28px 0 6px; max-width: 340px; }
  .footer-note { margin-top: 32px; font-size: 9pt; color: #888; font-style: italic; border-top: 1px solid #ddd; padding-top: 12px; }
</style>
</head>
<body>
<div class="doc-header">
  <div class="confidential">PRIVATE &amp; CONFIDENTIAL</div>
  <div class="doc-title">PARTY AGREEMENT</div>
  <div class="doc-subtitle">${esc(data.subtitle || 'In Respect of Building Works')}</div>
</div>

<div class="section-heading">The Parties</div>
<table class="parties-table">
  <tr><td>Building Owner(s)</td><td>${esc(boName)}</td></tr>
  <tr><td>Address for Service</td><td>${esc(data.bo_service_address || boAddress)}</td></tr>
  <tr><td>Building Owner's Property</td><td>${esc(boAddress)}</td></tr>
</table>
<table class="parties-table">
  <tr><td>Adjoining Owner(s)</td><td>${esc(aoName)}</td></tr>
  <tr><td>Address for Service</td><td>${esc(data.ao_service_address || aoAddress)}</td></tr>
  <tr><td>Adjoining Owner's Property</td><td>${esc(aoAddress)}</td></tr>
</table>

<div class="section-heading">Recitals</div>`;

  recitals.forEach(r => { html += `<div class="recital">${esc(r)}</div>`; });
  html += `<div class="recital">NOW THEREFORE, in consideration of the mutual obligations set out herein, the parties agree as follows.</div>`;

  html += `
<div class="section-heading">1. Purpose and Status of This Agreement</div>
<div class="clause"><span class="clause-num">1.1</span>This Agreement is a private and binding instrument entered into voluntarily by both parties.</div>
<div class="clause"><span class="clause-num">1.2</span>Both parties confirm that, provided the Building Owner adheres fully to the terms of this Agreement, the Adjoining Owner agrees not to seek injunctive relief or damages arising solely from the matters described in the Recitals. This undertaking does not limit the Adjoining Owner's right to seek redress should the Building Owner breach any term.</div>
<div class="clause"><span class="clause-num">1.3</span>This Agreement supersedes any prior verbal understanding. Any subsequent variation must be agreed in writing and signed by both parties.</div>`;

  if (worksItems.length > 0) {
    html += `<div class="section-heading">2. Description of the Works</div>
<p>The works to which this Agreement relates are as follows:</p>`;
    worksItems.forEach(item => {
      html += `<div class="works-item"><strong>(${esc(item.label)})</strong>&nbsp;&nbsp;${esc(item.description)}</div>`;
    });
  }

  html += `
<div class="section-heading">3. Obligations of the Building Owner</div>
<div class="clause"><span class="clause-num">3.1</span>The Building Owner shall execute the Works at their sole cost and risk, in a proper and workmanlike manner, using sound materials, and in full compliance with all applicable regulations.</div>
<div class="clause"><span class="clause-num">3.2</span>The Building Owner shall ensure full compliance with the Building Regulations 2010 (as amended) and shall obtain all necessary approvals prior to the resumption of works.</div>
<div class="clause"><span class="clause-num">3.3</span>The Building Owner shall make good any and all damage to the Adjoining Owner's property caused by or arising from the Works, in materials to match the existing fabric and finishes.</div>
<div class="clause"><span class="clause-num">3.4</span>The Building Owner shall fully indemnify and hold harmless the Adjoining Owner from any liability in respect of injury to persons or damage to property caused by the Works.</div>
<div class="clause"><span class="clause-num">3.5</span>The Building Owner shall maintain adequate public liability insurance and provide evidence thereof upon demand.</div>`;

  if (data.include_weathering_clauses) {
    html += `
<div class="section-heading">3.6 Weathering Detail</div>
<div class="clause"><span class="clause-num">3.6.1</span>Prior to the resumption of works, the Building Owner's contractor shall submit to the Adjoining Owner's surveyor a Section A weathering detail drawing showing the proposed weathering arrangement. Works shall not resume until written approval has been given.</div>
<div class="clause"><span class="clause-num">3.6.2</span>All lead flashings shall be detailed and fixed in strict accordance with the recommendations of the Lead Sheet Training Academy (LSTA), current edition.</div>
<div class="clause"><span class="clause-num">3.6.3</span>No surface water shall be discharged onto the Adjoining Owner's property.</div>`;
  }

  const protNum = data.include_weathering_clauses ? '3.7' : '3.6';
  html += `
<div class="section-heading">${protNum} Protection of Adjoining Owner's Property</div>
<div class="clause"><span class="clause-num">${protNum}.1</span>All noisy or disruptive works shall be restricted to 08:00–17:00 Monday to Friday and 09:00–13:00 Saturdays. No works on Sundays or Bank Holidays.</div>
<div class="clause"><span class="clause-num">${protNum}.2</span>No materials, plant, or skips shall be deposited on the Adjoining Owner's property without prior written consent.</div>
<div class="clause"><span class="clause-num">${protNum}.3</span>No fascia, guttering, or other projection shall extend over the Adjoining Owner's property.</div>`;

  if (data.include_scaffolding_clauses) {
    const scNum = data.include_weathering_clauses ? '3.8' : '3.7';
    html += `
<div class="section-heading">${scNum} Scaffolding</div>
<div class="clause"><span class="clause-num">${scNum}.1</span>Where scaffolding is required, the top lift shall be cantilevered over the Adjoining Owner's airspace only to the extent strictly necessary. No scaffold component shall stand on the Adjoining Owner's property without prior written consent.</div>
<div class="clause"><span class="clause-num">${scNum}.2</span>The top platform shall be double-boarded with polythene between boards. Toe-boards and guard rails shall be provided on all open sides. Anti-debris sheeting shall enclose all scaffolding. The top lift shall be above first-floor window head level and shall not obstruct window opening.</div>
<div class="clause"><span class="clause-num">${scNum}.3</span>All scaffolding shall be erected by a CISRS-certified contractor. Monoflex dust sheeting (or equal and approved) shall be fixed on all elevations for the full height.</div>`;
  }

  html += `
<div class="section-heading">4. Schedule of Condition</div>
<div class="clause"><span class="clause-num">4.1</span>The Building Owner accepts full responsibility for any damage to the Adjoining Owner's property attributable to the Works.</div>
<div class="clause"><span class="clause-num">4.2</span>A photographic schedule of condition shall be appended hereto and used as the benchmark for any damage assessment upon completion.</div>

<div class="section-heading">5. Defects Liability</div>
<div class="clause">In the event that any defect arising from the Works causes damage to the Adjoining Owner's property within <strong>${esc(data.defects_period || 'one (1) year')}</strong> from practical completion, the Building Owner shall remedy such defect and compensate the Adjoining Owner for any resultant damage.</div>

<div class="section-heading">6. Fees</div>
<div class="clause"><span class="clause-num">6.1</span>The Building Owner shall pay the reasonable costs of preparing this Agreement. The fee payable to Square One Consulting is £${esc(data.fee_amount || '[TBC]')} plus VAT, payable within 14 days of the date of this Agreement.</div>

<div class="section-heading">7. General Provisions</div>
<div class="clause"><span class="clause-num">7.1</span>This Agreement shall be governed by the law of England and Wales.</div>
<div class="clause"><span class="clause-num">7.2</span>Nothing in this Agreement shall determine the position of the boundary between the parties' properties.</div>
<div class="clause"><span class="clause-num">7.3</span>This Agreement constitutes the entire agreement between the parties and supersedes all prior discussions.</div>

<div class="section-heading">Execution</div>
<p>IN WITNESS WHEREOF the parties hereto have signed this Agreement on the date(s) written below.</p>

<div class="sig-block">
  <div class="sig-name">BUILDING OWNERS</div>
  <div class="sig-name">${esc(data.bo_name_1 || boName)}</div>
  <div>${esc(boAddress)}</div>
  <div class="sig-line"></div>
  <div>Signed: _______________________________&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Date: ___________________</div>
</div>`;

  if (data.bo_name_2) {
    html += `<div class="sig-block">
  <div class="sig-name">${esc(data.bo_name_2)}</div>
  <div>${esc(boAddress)}</div>
  <div class="sig-line"></div>
  <div>Signed: _______________________________&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Date: ___________________</div>
</div>`;
  }

  html += `<div class="sig-block">
  <div class="sig-name">ADJOINING OWNERS</div>
  <div class="sig-name">${esc(data.ao_name_1 || aoName || '[AO Name]')}</div>
  <div>${esc(data.ao_service_address || aoAddress)}</div>
  <div class="sig-line"></div>
  <div>Signed: _______________________________&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Date: ___________________</div>
</div>`;

  if (data.ao_name_2) {
    html += `<div class="sig-block">
  <div class="sig-name">${esc(data.ao_name_2)}</div>
  <div>${esc(data.ao_service_address || aoAddress)}</div>
  <div class="sig-line"></div>
  <div>Signed: _______________________________&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Date: ___________________</div>
</div>`;
  }

  html += `
<div class="footer-note">This document was prepared by Square One Consulting. It does not constitute legal advice. Both parties are encouraged to seek independent legal advice before signing.</div>
</body></html>`;

  return html;
}

// ── PDF export ─────────────────────────────────────────────────────────────

async function exportPdf(html, filename) {
  const apiKey = process.env.API2PDF_API_KEY || process.env.API2PDF_KEY || process.env.API2PDF_SECRET || '';
  if (!apiKey) throw new Error('Missing API2PDF_API_KEY');

  const printCss = `<style>
    @page { size: A4; margin: 14mm 12mm 14mm 12mm; }
    html, body { width: 210mm; margin: 0; padding: 0; background: #fff !important; -webkit-print-color-adjust: exact !important; }
    body { font-family: Arial, sans-serif; }
    .doc-header { page-break-after: avoid; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
    .sig-block { page-break-inside: avoid; }
  </style>`;

  const htmlForPdf = html.replace('</head>', `${printCss}</head>`);

  const apiResponse = await fetch(API2PDF_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html: htmlForPdf,
      fileName: filename,
      inlinePdf: false,
      options: {
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: false,
        preferCSSPageSize: true,
        margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' },
      },
    }),
  });

  const apiPayload = await apiResponse.json().catch(() => ({}));
  if (!apiResponse.ok || !apiPayload.FileUrl) {
    throw new Error(apiPayload?.Message || apiPayload?.message || 'API2PDF failed');
  }

  const pdfResponse = await fetch(apiPayload.FileUrl);
  if (!pdfResponse.ok) throw new Error(`PDF download failed: ${pdfResponse.status}`);

  const arrayBuffer = await pdfResponse.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const {
      message,
      project_id,
      uploaded_files,
      refinement_instruction,
      existing_structured_data,
      structured_data,
      export_pdf,
      preview_html,
    } = req.body || {};

    if (!project_id) return res.status(400).json({ error: 'Missing project_id' });

    const { data: project, error: projectError } = await supabase
      .from('projects').select('*').eq('id', project_id).single();

    if (projectError || !project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const aos = Array.isArray(project.aos) ? project.aos : [];
    const primaryAO = aos[0] || {};

    const projectMeta = {
      ref: project.ref || '',
      bo_address: project.bo_premise_address || project.address || project.premise_address || '',
      bo_names: ownerNameFromProject(project),
      ao_address: aoAddress(primaryAO),
      ao_names: aoNames(primaryAO),
      ao_service_address: aoServiceAddress(primaryAO),
    };

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

    // ── PDF export ──
    if (export_pdf && preview_html) {
      const boAddr = structured_data?.bo_address || projectMeta.bo_address || '';
      const filename = `Party Agreement - ${boAddr || 'Agreement'}.pdf`
        .replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

      const pdfBuffer = await exportPdf(preview_html, filename);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.status(200).send(pdfBuffer);
    }

    // ── Refinement ──
    if (refinement_instruction && existing_structured_data) {
      const updatedData = await refineStructuredData(refinement_instruction, existing_structured_data, projectMeta, anthropicKey);
      const html = renderAgreementHtml(updatedData, projectMeta);
      return res.status(200).json({ preview_html: html, structured_data: updatedData });
    }

    // ── Fresh generation ──
    if (!message && (!uploaded_files || !uploaded_files.length)) {
      return res.status(400).json({ error: 'Missing message or uploaded files' });
    }

    const data = await extractStructuredData(message || '', projectMeta, uploaded_files || [], anthropicKey);
    const html = renderAgreementHtml(data, projectMeta);

    return res.status(200).json({ preview_html: html, structured_data: data });

  } catch (err) {
    console.error('[generate-dispute-agreement] error:', err);
    return res.status(500).json({ error: err.message || 'Agreement generation failed' });
  }
}
