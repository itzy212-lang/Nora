import { createClient } from '@supabase/supabase-js';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

function formatDate(value) {
  if (!value) return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  try {
    return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return String(value); }
}

// ── AI extraction ──────────────────────────────────────────────────────────

async function extractStructuredData(message, projectMeta, uploadedFiles, apiKey) {
  const fileDescriptions = (uploadedFiles || []).map(f => `[Uploaded: ${f.name}]`).join('\n');

  const prompt = `You are an expert Party Wall Surveyor preparing a formal Party Agreement document. Always use British English spelling and legal terminology throughout.

Your task is to analyse the dictated notes and any uploaded documents, then return structured JSON data to populate a Party Agreement.

First, determine the AGREEMENT TYPE from the context. Choose the most appropriate from:
- "Party Agreement for Building Works" — works carried out without notice, dispute over works, general works obligations
- "Party Agreement for Scaffold Access" — licence for scaffolding on or over adjoining owner's property
- "Party Agreement for Access" — general access licence to carry out works from adjoining owner's land
- "Party Agreement for Making Good" — agreement to remedy damage or carry out reinstatement works
- "Party Agreement" — general/other (use this if none of the above clearly fits)

Return ONLY valid JSON. No markdown, no backticks, no preamble.

Required structure:
{
  "agreement_type": "Party Agreement for Building Works",
  "subtitle": "In Respect of [brief description of subject matter]",
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
    "WHEREAS [first recital — who did what]",
    "AND WHEREAS [second recital — what happened as a result]",
    "AND WHEREAS [third recital — current situation / why parties are entering this agreement]",
    "AND WHEREAS [further recitals as needed]"
  ],
  "works_items": [
    { "label": "a", "description": "Description of first item of works" },
    { "label": "b", "description": "Description of second item of works" }
  ],
  "include_scaffolding_clauses": false,
  "include_weathering_clauses": false,
  "defects_period": "one (1) year",
  "fee_amount": "[TBC]",
  "agreement_date": "",
  "special_clauses": [],
  "documents_register": []
}

Rules:
- Recitals must follow the WHEREAS / AND WHEREAS / NOW THEREFORE legal format.
- Write recitals in full legal prose, third person, formal register.
- Works items must be numbered (a), (b), (c) etc. and written in formal surveyor language.
- Set include_scaffolding_clauses to true ONLY if scaffolding access over the AO's property is mentioned.
- Set include_weathering_clauses to true ONLY if weathering/flashing/roof junction works are mentioned.
- If the agreement is purely for scaffold access or general access, works_items should describe the scope and duration of access, not construction works.
- bo_name_2 and ao_name_2 should be empty string "" if there is only one owner on that side.
- Pull BO name and address from project context below. Pull AO details from context or notes.
- If fee amount is not mentioned, leave as "[TBC]".
- Leave agreement_date blank — it will be filled on signing.

Project context:
Building Owner: ${projectMeta.bo_names || ''}
Building Owner address: ${projectMeta.bo_address || ''}
Adjoining Owner: ${projectMeta.ao_names || ''}
Adjoining Owner address: ${projectMeta.ao_address || ''}
Project ref: ${projectMeta.ref || ''}

${fileDescriptions ? `Uploaded documents:\n${fileDescriptions}\n` : ''}

Dictated notes:
${message || '(No notes — generate based on project context and uploaded documents)'}`;

  const messages = [{ role: 'user', content: prompt }];

  // If there are uploaded files, include them in the message
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
      system: 'You are an expert Party Wall Surveyor drafting formal legal agreements. Return only valid JSON. Use British English and formal legal register throughout.',
      messages,
    }),
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'Claude extraction failed');

  const raw = payload.content?.[0]?.text || '';
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

// ── Refine existing structured data ───────────────────────────────────────

async function refineStructuredData(instruction, existingData, projectMeta, apiKey) {
  const prompt = `You are an expert Party Wall Surveyor. You have an existing Party Agreement in JSON format and the user wants to make a specific change.

Apply the instruction carefully and return the COMPLETE updated JSON object. Return ONLY valid JSON.

Instruction: ${instruction}

Current agreement JSON:
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
      system: 'You are an expert Party Wall Surveyor. Apply the requested change and return the complete updated JSON. Return only valid JSON, no markdown.',
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

  // Build NOW THEREFORE text
  const nowTherefore = `NOW THEREFORE, in consideration of the mutual obligations set out herein, the parties agree as follows.`;

  let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #222; max-width: 860px; margin: 0 auto; padding: 32px 40px; line-height: 1.6; }
  .doc-header { text-align: center; border-bottom: 2px solid #2E75B6; padding-bottom: 20px; margin-bottom: 28px; }
  .confidential { font-size: 9pt; color: #666; letter-spacing: 1px; margin-bottom: 8px; }
  .doc-title { font-size: 20pt; font-weight: 700; color: #1F3864; margin: 8px 0; letter-spacing: 1px; }
  .doc-subtitle { font-size: 11pt; color: #2E75B6; font-weight: 600; margin: 4px 0; }
  .parties-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  .parties-table td { padding: 6px 10px; border: 1px solid #ddd; font-size: 10.5pt; }
  .parties-table td:first-child { font-weight: 700; color: #1F3864; width: 200px; background: #f5f8ff; }
  .section-heading { font-size: 12pt; font-weight: 700; color: #1F3864; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #dce6f4; }
  .clause-block { margin-bottom: 10px; }
  .clause-num { font-weight: 700; color: #1F3864; }
  .recital { margin-bottom: 8px; line-height: 1.7; text-align: justify; }
  .works-item { margin-bottom: 6px; padding-left: 24px; }
  .works-label { font-weight: 700; margin-right: 6px; }
  .execution-block { margin-top: 32px; border-top: 2px solid #2E75B6; padding-top: 20px; }
  .sig-block { margin-bottom: 28px; }
  .sig-name { font-weight: 700; font-size: 11pt; margin-bottom: 4px; }
  .sig-line { border-bottom: 1px solid #888; margin: 28px 0 6px; max-width: 340px; }
  .footer-note { margin-top: 32px; font-size: 9pt; color: #888; font-style: italic; border-top: 1px solid #ddd; padding-top: 12px; }
  .badge { display: inline-block; background: #e8f0fe; color: #2E75B6; border-radius: 4px; padding: 2px 8px; font-size: 9pt; font-weight: 600; margin-bottom: 16px; }
</style>
</head>
<body>
<div class="doc-header">
  <div class="confidential">PRIVATE &amp; CONFIDENTIAL</div>
  <div class="doc-title">PARTY AGREEMENT</div>
  <div class="doc-subtitle">${esc(data.subtitle || 'In Respect of Building Works')}</div>
</div>

<span class="badge">${esc(data.agreement_type || 'Party Agreement')}</span>

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

  recitals.forEach(r => {
    html += `<div class="recital">${esc(r)}</div>`;
  });

  html += `<div class="recital">${esc(nowTherefore)}</div>`;

  html += `
<div class="section-heading">1. Purpose and Status of This Agreement</div>
<div class="clause-block"><span class="clause-num">1.1 Nature of Agreement.</span> This Agreement is a private and binding instrument entered into voluntarily by both parties. Its purpose is to provide the parties with certainty as to their respective rights and obligations in connection with the matters described herein.</div>
<div class="clause-block"><span class="clause-num">1.2 Mutual Undertaking.</span> Both parties confirm that, provided the Building Owner adheres fully to the terms of this Agreement, the Adjoining Owner agrees not to seek injunctive relief, damages, or other legal remedy arising solely from the matters described in the Recitals above. This undertaking does not limit the Adjoining Owner's right to seek redress should the Building Owner breach any term of this Agreement.</div>
<div class="clause-block"><span class="clause-num">1.3 Primacy.</span> This Agreement supersedes any prior verbal understanding between the parties in respect of the matters described herein. Any subsequent variation must be agreed in writing and signed by both parties.</div>`;

  if (worksItems.length > 0) {
    html += `
<div class="section-heading">2. Description of the Works</div>
<p>The works to which this Agreement relates are as follows (hereinafter 'the Works'):</p>`;
    worksItems.forEach(item => {
      html += `<div class="works-item"><span class="works-label">(${esc(item.label)})</span>${esc(item.description)}</div>`;
    });
  }

  html += `
<div class="section-heading">3. Obligations of the Building Owner</div>
<div class="clause-block"><span class="clause-num">3.1 Standard of Workmanship.</span> The Building Owner shall execute the Works at their sole cost and risk, in a proper and workmanlike manner, using sound and suitable materials, and in full compliance with all applicable regulations and requirements.</div>
<div class="clause-block"><span class="clause-num">3.2 Building Regulations.</span> The Building Owner shall ensure that the Works are designed and executed in full compliance with the Building Regulations 2010 (as amended) and shall obtain all necessary approvals prior to the resumption of works.</div>
<div class="clause-block"><span class="clause-num">3.3 Making Good.</span> The Building Owner shall make good, at their sole expense, any and all structural, decorative, or other physical damage to the Adjoining Owner's property caused by or arising from the execution of the Works, in materials to match the existing fabric and finishes.</div>
<div class="clause-block"><span class="clause-num">3.4 Indemnity.</span> The Building Owner shall fully indemnify and hold harmless the Adjoining Owner from and against any and all liability in respect of any injury to persons or damage to property caused by or arising from the execution of the Works.</div>
<div class="clause-block"><span class="clause-num">3.5 Insurance.</span> The Building Owner shall maintain, or cause their contractor(s) to maintain, adequate public liability insurance covering all persons and property against risks arising from the execution of the Works, and shall provide evidence thereof upon demand.</div>`;

  if (data.include_weathering_clauses) {
    html += `
<div class="section-heading">3.6 Weathering Detail</div>
<div class="clause-block"><span class="clause-num">3.6.1</span> Prior to the resumption of works, the Building Owner's contractor shall submit to the Adjoining Owner's surveyor/architect a Section A weathering detail drawing showing the proposed weathering arrangement. Works shall not resume until written approval of the detail has been given.</div>
<div class="clause-block"><span class="clause-num">3.6.2</span> All lead flashings shall be detailed and fixed in strict accordance with the recommendations of the Lead Sheet Training Academy (LSTA), current edition.</div>
<div class="clause-block"><span class="clause-num">3.6.3</span> The completed Works, including the finished roofline, shall not project beyond or overhang the boundary line at any point, and no surface water shall be discharged onto the Adjoining Owner's property.</div>`;
  }

  html += `
<div class="section-heading">${data.include_weathering_clauses ? '3.7' : '3.6'} Protection of Adjoining Owner's Property</div>
<div class="clause-block">The Building Owner shall take all reasonable precautions to protect the Adjoining Owner's property during the execution of the Works. All noisy or disruptive works shall be restricted to between 08:00 and 17:00 Monday to Friday and 09:00 to 13:00 on Saturdays. No works shall be carried out on Sundays, Bank Holidays, or public holidays.</div>`;

  if (data.include_scaffolding_clauses) {
    html += `
<div class="section-heading">3.${data.include_weathering_clauses ? '8' : '7'} Scaffolding</div>
<div class="clause-block"><span class="clause-num">3.${data.include_weathering_clauses ? '8' : '7'}.1</span> Where scaffolding is required, the top lift shall be cantilevered over the Adjoining Owner's airspace only to the extent strictly necessary. No scaffold standard, base plate, or other component shall stand on or be anchored to the Adjoining Owner's property without prior written consent.</div>
<div class="clause-block"><span class="clause-num">3.${data.include_weathering_clauses ? '8' : '7'}.2</span> The top scaffold platform shall be double-boarded with polythene sheeting between the boards. Toe-boards and guard rails shall be provided on all open sides. Anti-debris sheeting shall enclose all scaffolding on all elevations and for the full height.</div>
<div class="clause-block"><span class="clause-num">3.${data.include_weathering_clauses ? '8' : '7'}.3</span> All scaffolding shall be erected by a CISRS-certified contractor and protected with Monoflex dust sheeting (or equal and approved) on all elevations for the full height.</div>`;
  }

  html += `
<div class="section-heading">4. Schedule of Condition</div>
<div class="clause-block"><span class="clause-num">4.1</span> The parties acknowledge that the Building Owner accepts full responsibility for any damage to the Adjoining Owner's property that may be attributable to the Works.</div>
<div class="clause-block"><span class="clause-num">4.2</span> A photographic schedule of condition, agreed between the parties' surveyors/architects, shall be appended hereto and shall be used as the benchmark for any damage assessment upon completion of the Works.</div>

<div class="section-heading">5. Defects Liability</div>
<div class="clause-block">In the event that any defect arising directly from the Works causes damage to the Adjoining Owner's property within ${esc(data.defects_period || 'one (1) year')} from the date of practical completion, the Building Owner shall remedy such defect at their own cost and compensate the Adjoining Owner for any resultant damage.</div>

<div class="section-heading">6. Fees</div>
<div class="clause-block"><span class="clause-num">6.1 Agreement Preparation Fee.</span> The Building Owner shall pay the reasonable and proper costs incurred in the preparation of this Agreement. The fee payable to Square One Consulting is £${esc(data.fee_amount || '[TBC]')} plus VAT, payable within fourteen (14) days of the date of this Agreement.</div>
<div class="clause-block"><span class="clause-num">6.2 VAT.</span> All fees stated are exclusive of VAT, which shall be added at the prevailing rate where applicable.</div>

<div class="section-heading">7. General Provisions</div>
<div class="clause-block"><span class="clause-num">7.1 Governing Law.</span> This Agreement shall be governed by and construed in accordance with the law of England and Wales.</div>
<div class="clause-block"><span class="clause-num">7.2 Boundary.</span> Nothing in this Agreement shall be taken to determine the position of the boundary between the parties' properties.</div>
<div class="clause-block"><span class="clause-num">7.3 Third Parties.</span> This Agreement does not create any rights for any person who is not a party to it.</div>
<div class="clause-block"><span class="clause-num">7.4 Entire Agreement.</span> This Agreement constitutes the entire agreement between the parties with respect to its subject matter and supersedes all prior discussions and undertakings.</div>

<div class="execution-block">
<div class="section-heading">Execution</div>
<p>IN WITNESS WHEREOF the parties hereto have signed this Agreement on the date(s) written below.</p>

<div class="sig-block">
  <div class="sig-name">BUILDING OWNERS</div>
  <div class="sig-name">${esc(data.bo_name_1 || boName.split(' & ')[0] || '')}</div>
  <div>${esc(boAddress)}</div>
  <div class="sig-line"></div>
  <div>Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date: ___________________________</div>
</div>`;

  if (data.bo_name_2) {
    html += `<div class="sig-block">
  <div class="sig-name">${esc(data.bo_name_2)}</div>
  <div>${esc(boAddress)}</div>
  <div class="sig-line"></div>
  <div>Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date: ___________________________</div>
</div>`;
  }

  html += `<div class="sig-block">
  <div class="sig-name">ADJOINING OWNERS</div>
  <div class="sig-name">${esc(data.ao_name_1 || aoName.split(' & ')[0] || '[AO Name]')}</div>
  <div>${esc(data.ao_service_address || aoAddress)}</div>
  <div class="sig-line"></div>
  <div>Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date: ___________________________</div>
</div>`;

  if (data.ao_name_2) {
    html += `<div class="sig-block">
  <div class="sig-name">${esc(data.ao_name_2)}</div>
  <div>${esc(data.ao_service_address || aoAddress)}</div>
  <div class="sig-line"></div>
  <div>Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date: ___________________________</div>
</div>`;
  }

  html += `</div>
<div class="footer-note">
  This document was prepared by Square One Consulting. It does not constitute legal advice. Both parties are encouraged to seek independent legal advice before signing.
</div>
</body>
</html>`;

  return html;
}

// ── .docx generation ───────────────────────────────────────────────────────

async function generateDocx(structuredData, projectMeta) {
  // Fetch template from Supabase storage
  const { data: fileData, error } = await supabase.storage
    .from('documents')
    .download('templates/party-agreement-template.docx');

  if (error || !fileData) {
    throw new Error('Party Agreement template not found in Supabase storage. Please upload it first.');
  }

  const arrayBuffer = await fileData.arrayBuffer();
  const zip = new PizZip(arrayBuffer);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

  const boName = [structuredData.bo_name_1, structuredData.bo_name_2].filter(Boolean).join(' & ') || projectMeta.bo_names || '';
  const aoName = [structuredData.ao_name_1, structuredData.ao_name_2].filter(Boolean).join(' & ') || projectMeta.ao_names || '';

  const recitalsText = Array.isArray(structuredData.recitals)
    ? structuredData.recitals.join('\n\n')
    : '';

  const worksText = Array.isArray(structuredData.works_items)
    ? structuredData.works_items.map(w => `(${w.label})  ${w.description}`).join('\n\n')
    : '';

  doc.render({
    AGREEMENT_TYPE: structuredData.agreement_type || 'Party Agreement',
    SUBTITLE: structuredData.subtitle || 'In Respect of Building Works',
    HEADER_SUBTITLE: structuredData.header_subtitle || 'FOR BUILDING WORKS',
    BO_NAME_FULL: boName,
    BO_NAME_1: structuredData.bo_name_1 || boName,
    BO_NAME_2: structuredData.bo_name_2 || '',
    BO_ADDRESS: structuredData.bo_address || projectMeta.bo_address || '',
    BO_SERVICE_ADDRESS: structuredData.bo_service_address || structuredData.bo_address || projectMeta.bo_address || '',
    AO_NAME_FULL: aoName,
    AO_NAME_1: structuredData.ao_name_1 || aoName,
    AO_NAME_2: structuredData.ao_name_2 || '',
    AO_ADDRESS: structuredData.ao_address || projectMeta.ao_address || '',
    AO_SERVICE_ADDRESS: structuredData.ao_service_address || structuredData.ao_address || projectMeta.ao_address || '',
    RECITALS: recitalsText,
    WORKS_DESCRIPTION: worksText,
    DEFECTS_PERIOD: structuredData.defects_period || 'one (1) year',
    FEE_AMOUNT: structuredData.fee_amount || '[TBC]',
    AGREEMENT_DATE: structuredData.agreement_date || formatDate(new Date()),
    PROJECT_REF: projectMeta.ref || '',
  });

  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const {
      message,
      project_id,
      session_id,
      uploaded_files,
      refinement_instruction,
      existing_structured_data,
      structured_data,
      export_docx,
    } = req.body || {};

    if (!project_id) {
      return res.status(400).json({ error: 'Missing project_id' });
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', project_id)
      .single();

    if (projectError || !project) {
      return res.status(404).json({ error: 'Project not found', details: projectError?.message });
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
    if (!anthropicKey) {
      return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });
    }

    // ── Export .docx ──
    if (export_docx && structured_data) {
      const docBuffer = await generateDocx(structured_data, projectMeta);
      const filename = `Party Agreement - ${projectMeta.bo_address || 'Agreement'}.docx`
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(docBuffer);
    }

    // ── Refinement ──
    if (refinement_instruction && existing_structured_data) {
      const updatedData = await refineStructuredData(refinement_instruction, existing_structured_data, projectMeta, anthropicKey);
      const preview_html = renderAgreementHtml(updatedData, projectMeta);
      return res.status(200).json({ preview_html, structured_data: updatedData });
    }

    // ── Fresh generation ──
    if (!message && (!uploaded_files || !uploaded_files.length)) {
      return res.status(400).json({ error: 'Missing message or uploaded files' });
    }

    const data = await extractStructuredData(message || '', projectMeta, uploaded_files || [], anthropicKey);
    const preview_html = renderAgreementHtml(data, projectMeta);

    return res.status(200).json({
      preview_html,
      structured_data: data,
      project_meta: projectMeta,
    });

  } catch (err) {
    console.error('[generate-dispute-agreement] error:', err);
    return res.status(500).json({ error: err.message || 'Agreement generation failed' });
  }
}
