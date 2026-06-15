import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function formatLongDate(value) {
  if (!value) return '';

  try {
    let dateObj;

    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split('-').map(Number);
      dateObj = new Date(year, month - 1, day);
    } else {
      dateObj = new Date(value);
    }

    if (Number.isNaN(dateObj.getTime())) return '';

    return dateObj.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2p(value) {
  const text = esc(value || '');
  if (!text.trim()) return '';

  return text
    .split(/\n\n+/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function ownerNameFromProject(project = {}) {
  if (project.bo_company) return project.bo_company;

  return [project.bo_1_name, project.bo_2_name, project.bo_name]
    .filter(Boolean)
    .join(' & ');
}

function aoAddress(ao = {}) {
  return ao.premise || ao.reg_addr || ao.address || ao.ao_premise_address || '';
}

function aoNames(ao = {}) {
  return [ao.name || ao.ao_name_1, ao.name2 || ao.ao_name_2]
    .filter(Boolean)
    .join(' & ');
}

function aoServiceAddress(ao = {}) {
  return ao.service_address || ao.serviceAddress || ao.ao_service_address || ao.reg_addr || aoAddress(ao) || '';
}

function aoMatches(ao = {}, aoId = '', index = -1) {
  const key = String(aoId || '').trim();
  if (!key) return false;

  return (
    String(ao.id || '') === key ||
    String(ao.num || '') === key ||
    String(index) === key ||
    String(index + 1) === key ||
    aoAddress(ao) === key
  );
}

function pickAO(project = {}, aoId = '') {
  const aos = Array.isArray(project.aos) ? project.aos : [];
  if (!aos.length) return null;

  return aos.find((ao, index) => aoMatches(ao, aoId, index)) || aos[0];
}

function normaliseSections(sections = []) {
  if (!Array.isArray(sections)) return [];

  return sections
    .filter(Boolean)
    .map((section, index) => {
      const rows = section.rows || section.elements || [];

      return {
        number: section.number || index + 2,
        title: section.title || section.room || section.name || '',
        rows: rows.map((row) => ({
          ref: row.ref || '',
          observation: row.observation || row.description || row.condition || row.obs || '',
          action: row.action || row.action_required || 'Record only',
        })),
      };
    })
    .filter((section) => section.title || section.rows.length);
}

function buildPartyDrafts(emailsRequired = [], projectMeta = {}) {
  if (!Array.isArray(emailsRequired)) return [];

  const valid = emailsRequired.filter(e => e && (e.recipient_type || e.subject || e.body || e.reason));
  if (!valid.length) return [];

  // Group by recipient_type — merge all Building Owner items into one email
  const grouped = {};
  valid.forEach(email => {
    let party = email.recipient_type || email.party || 'Relevant Party';
    // Normalise to prevent case-sensitive duplicates
    if (/building\s*owner/i.test(party)) party = 'Building Owner';
    else if (/adjoining\s*owner/i.test(party)) party = 'Adjoining Owner';
    else if (/structural\s*engineer/i.test(party)) party = 'Structural Engineer';
    else if (/architect/i.test(party)) party = 'Architect';
    if (!grouped[party]) grouped[party] = [];
    grouped[party].push(email);
  });

  return Object.entries(grouped).map(([party, emails], index) => {
    const isBO = /building owner/i.test(party);
    const isAO = /adjoining owner/i.test(party);

    if (emails.length === 1) {
      const email = emails[0];
      const subject = email.subject || `Schedule of Condition — ${projectMeta.bo_address || ''}`;
      const body = email.body || [
        `Dear ${isBO ? (projectMeta.bo_1_name || 'Sir/Madam') : isAO ? (projectMeta.ao_1_name || 'Sir/Madam') : party},`,
        '',
        `I write further to the Schedule of Condition inspection carried out at the above property.`,
        '',
        email.reason || '',
        '',
        'Kind regards',
      ].filter(Boolean).join('\n');

      return { id: `soc-email-${index + 1}`, party, recipient_type: party, subject, body, reason: email.reason || '' };
    }

    // Multiple items — merge into one email with numbered points
    const subject = emails[0].subject || `Schedule of Condition — outstanding matters — ${projectMeta.bo_address || ''}`;
    const points = emails.map((e, i) => `${i + 1}. ${e.reason || e.subject || ''}`).filter(Boolean).join('\n');
    const body = [
      `Dear ${isBO ? (projectMeta.bo_1_name || 'Sir/Madam') : isAO ? (projectMeta.ao_1_name || 'Sir/Madam') : party},`,
      '',
      `I write further to the Schedule of Condition inspection carried out at the above property. There are a number of matters arising from the inspection which I would ask you to address:`,
      '',
      points,
      '',
      'Please let me know if you have any questions.',
      '',
      'Kind regards',
    ].join('\n');

    return { id: `soc-email-${index + 1}`, party, recipient_type: party, subject, body, reason: points };
  });
}

function fixedIntroduction(projectMeta = {}) {
  const boAddress = projectMeta.bo_address || '[bo_address]';
  const aoAddressText = projectMeta.ao_address || '[ao_address]';

  return [
    `This Schedule of Conditions has been prepared pursuant to the Party Wall etc. Act 1996 in connection with the proposed notifiable works at the Building Owner's property, ${boAddress}. The purpose of this document is to record the existing condition of the Adjoining Owner's property at ${aoAddressText}, prior to the commencement of those works, thereby establishing a contemporaneous baseline record against which any claims of damage arising during or after the execution of the works may be assessed.`,
    'The inspection was conducted by way of visual survey only. No opening-up works, testing or investigations were carried out. Where access was restricted or elements were concealed behind fixed finishes or furniture, this has been noted accordingly. Photographs taken at the time of inspection are to be retained by the surveyors and not appended to this written schedule or the party wall award.',
    'All references to left and right are made when facing the relevant elevation. Crack widths are classified in accordance with the crack classification table appended to this schedule.',
  ].join('\n\n');
}

function renderSocContent(data = {}, config = {}, projectMeta = {}) {
  const aoAddressText = projectMeta.ao_address || data.ao_address || '';
  const boAddress = projectMeta.bo_address || data.bo_address || '';
  const inspDate = projectMeta.inspection_date || data.inspection_date || '';
  const proposedWorks = projectMeta.proposed_works || data.proposed_works || '';
  const preparedBy = projectMeta.prepared_by || data.prepared_by || '';
  const photoRecord =
    projectMeta.photo_record ||
    data.photo_record ||
    'Photographic thumbnails are not appended to this schedule with the originals saved on file.';

  const introduction = fixedIntroduction(projectMeta);
  const sections = normaliseSections(data.sections || []);
  const discussion = (data.discussion || data.discussion_items || []).filter(
    (item) => item && (item.item || item.title || item.body || item.description || (typeof item === 'string' && item.trim()))
  );
  const generalNotes = (data.general_notes || []).filter(Boolean);
  const crackClass = data.crack_classification || config.crack_classification || [
    { width: 'Up to 0.1mm', expression: 'Hairline' },
    { width: '0.1mm to 1.0mm', expression: 'Very Slight' },
    { width: '1.1mm to 5.0mm', expression: 'Slight' },
    { width: '5.1mm to 15mm', expression: 'Moderate' },
    { width: '15.1mm to 25mm', expression: 'Severe' },
  ];

  let html =
    '<div class="soc-document">' +
    '<div class="soc-title-block">' +
    '<div class="soc-main-title">SCHEDULE OF CONDITIONS</div>' +
    '<div class="soc-subtitle">Party Wall etc. Act 1996</div>' +
    '</div>' +
    '<table class="soc-cover-table"><tbody>' +
    `<tr><td class="cover-label">Adjoining Owner's Property</td><td>${esc(aoAddressText)}</td></tr>` +
    `<tr><td class="cover-label">Building Owner's Property</td><td>${esc(boAddress)}</td></tr>` +
    `<tr><td class="cover-label">Date of Inspection</td><td>${esc(inspDate)}</td></tr>` +
    `<tr><td class="cover-label">Proposed Works</td><td>${esc(proposedWorks)}</td></tr>` +
    `<tr><td class="cover-label">Prepared By</td><td>${esc(preparedBy)}</td></tr>` +
    `<tr><td class="cover-label">Photographic Record</td><td>${esc(photoRecord)}</td></tr>` +
    '</tbody></table>' +
    '<div class="soc-section-heading">1. Introduction</div>' +
    `<div class="soc-intro-box">${nl2p(introduction)}</div>`;

  sections.forEach((section, index) => {
    const secNum = esc(String(index + 2));
    const secTitle = esc(section.title || '');
    const rows = section.rows || [];

    html +=
      `<div class="soc-section-heading">${secNum}. ${secTitle}</div>` +
      '<table class="soc-obs-table">' +
      '<thead><tr>' +
      '<th class="col-ref">Ref</th>' +
      `<th class="col-obs">Observation / Description - ${secTitle}</th>` +
      '<th class="col-action">Action Required</th>' +
      '</tr></thead><tbody>';

    rows.forEach((row, rowIndex) => {
      const rowClass = rowIndex % 2 === 0 ? '' : ' class="alt-row"';

      html +=
        `<tr${rowClass}>` +
        `<td class="cell-ref">${esc(row.ref || '')}</td>` +
        `<td class="cell-obs">${esc(row.observation || '')}</td>` +
        `<td class="cell-action">${esc(row.action || '')}</td>` +
        '</tr>';
    });

    html += '</tbody></table>';
  });

  let nextSectionNumber = sections.length + 2;

  if (discussion.length > 0) {
    html +=
      `<div class="soc-section-heading">${nextSectionNumber}. Discussion Items &amp; Recommendations</div>` +
      '<table class="soc-obs-table"><thead><tr>' +
      '<th class="col-ref">Item</th>' +
      '<th class="col-obs" colspan="2">Discussion / Recommendation</th>' +
      '</tr></thead><tbody>';

    discussion.forEach((item, index) => {
      const rowClass = index % 2 === 0 ? '' : ' class="alt-row"';
      const label = item.item || String(index + 1);
      const title = item.title ? `<strong>${esc(item.title)}:</strong> ` : '';

      html +=
        `<tr${rowClass}>` +
        `<td class="cell-ref">${esc(label)}</td>` +
        `<td class="cell-obs" colspan="2">${title}${esc(item.body || '')}</td>` +
        '</tr>';
    });

    html += '</tbody></table>';
    nextSectionNumber += 1;
  }

  if (generalNotes.length > 0) {
    html +=
      `<div class="soc-section-heading">${nextSectionNumber}. General Notes</div>` +
      '<div class="soc-intro-box"><ol class="soc-notes-list">';

    generalNotes.forEach((note) => {
      html += `<li>${esc(note)}</li>`;
    });

    html += '</ol></div>';
    nextSectionNumber += 1;
  }

  const awardNotes = (data.award_notes || []).filter(n => n && (n.description || n.topic));
  if (awardNotes.length > 0) {
    html +=
      `<div class="soc-section-heading">${nextSectionNumber}. Site Notes</div>` +
      '<div class="soc-intro-box"><ol class="soc-notes-list">';

    awardNotes.forEach((note) => {
      const text = note.description || note.topic || '';
      html += `<li>${esc(text)}</li>`;
    });

    html += '</ol></div>';
    nextSectionNumber += 1;
  }

  html +=
    `<div class="soc-section-heading">${nextSectionNumber}. Crack Classification</div>` +
    '<div class="soc-intro-box"><p>The following classification table is used as reference when describing crack widths observed during this inspection:</p></div>' +
    '<table class="soc-obs-table"><thead><tr>' +
    '<th style="width:50%;text-align:left">Approximate Crack Width</th>' +
    '<th style="width:50%;text-align:left">Associated Expression</th>' +
    '</tr></thead><tbody>';

  crackClass.forEach((item, index) => {
    const rowClass = index % 2 === 0 ? '' : ' class="alt-row"';

    html +=
      `<tr${rowClass}>` +
      `<td style="padding:7px 12px;border:1px solid #c8c8c8">${esc(item.width)}</td>` +
      `<td style="padding:7px 12px;border:1px solid #c8c8c8">${esc(item.expression)}</td>` +
      '</tr>';
  });

  html += '</tbody></table></div>';

  return html;
}

async function extractStructuredData(message, projectMeta, apiKey) {
  const prompt = `
You are a senior chartered party wall surveyor with over 20 years of experience preparing Schedules of Condition under the Party Wall etc. Act 1996. You are preparing a professional Schedule of Condition from dictated field notes.

PROPERTY DETAILS:
Building Owner: ${projectMeta.bo_address || 'Not provided'}
Adjoining Owner: ${projectMeta.ao_address || 'Not provided'}
Date of Inspection: ${projectMeta.inspection_date || new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
Proposed Works: ${projectMeta.proposed_works || 'Not specified'}

WORKED EXAMPLES — STYLE AND TRANSFORMATION STANDARD:

These show how raw dictated notes become professional SOC observations. Apply the same standard. Do NOT copy content from these examples.

Example 1 — Raw: "crack on the chimney breast running vertically from skirting height upwards, looks old, couple of small cracks where chimney breast meets the side wall, ceiling looks okay, staining in front left corner looks dry, window opens and closes fine, floor feels level carpet throughout"
Finished (separate rows):
- "A vertical crack was noted to the chimney breast, extending from the top of the skirting board upwards."
- "Hairline cracking was observed at the junction between the chimney breast and the abutting wall."  
- "No visible defects were noted to the ceiling at the time of inspection."
- "Evidence of historic water staining was noted to the ceiling in the front left-hand corner. The area appears dry at the time of inspection with no evidence of active water ingress."
- "The window was tested and operated satisfactorily without sticking, binding or jamming."
- "The floor finish was not fully accessible for inspection due to the presence of carpet covering."

Example 2 — Raw: "severe crack bottom left corner of left window extending diagonally downwards approximately 900mm before fading, various cracks stemming away, staggers into slight cracking running vertically to top of first brick"
Finished: "A significant crack extends diagonally downward from the bottom left-hand corner of the left-hand rear window for approximately 900mm before dissipating. Various subsidiary cracks branch from this defect. The crack transitions into lighter cracking adjacent to the right-hand side of the air vent, extending vertically towards the first brick course."

Example 3 — Raw: "grapevine present adjacent party fence wall, on reflection likely vine will not survive if left in situ, preferred option carefully excavate and temporarily relocate, replant on completion, particular care sentimental value"
Site Note: "The existing grapevine should be considered for temporary excavation and relocation prior to demolition works, followed by reinstatement upon completion. Particular care should be taken due to the sentimental value of the planting."

Example 4 — Raw: "no visible defects in panelling along flank wall. Just some minor amendments, on the front left corner there is intermittent vertical cracking in the render approximately 600mm"
Finished (reconciled into one row): "The panelling along the flank wall exhibits no visible defects with the exception of intermittent vertical cracking noted at the front left-hand corner, extending approximately 600mm before dissipating."

INSTRUCTIONS:

1. IDENTITY — You are a chartered surveyor. Apply your professional knowledge throughout. Correct obvious dictation/transcription errors (e.g. "plank wall" → "flank wall", "invisible defects" → "no visible defects"). You know construction terminology — use it.

2. SECTIONS — Group observations by room or area as declared in the notes. Each section gets a unique 2-4 letter prefix derived from its name (GC = Garage Conversion, UR = Utility Room, ES = External Side, HW = Hallway, FB = Front Bedroom etc.). Number sequentially with zero-padding: GC01, GC02. No hyphens.

3. ONE OBSERVATION PER ROW — Never combine multiple elements or defects into one row. Ceiling and wall are separate. A crack and a stain are separate. A door test and a nearby crack are separate.

4. AMENDMENTS AND REVISIONS — If a note revises a previous one, reconcile them into a single observation. Never output both the original and the amendment. If "no visible defects" is later amended to add a defect, produce one row noting the defect and ending "The remaining [element] exhibits no visible defects at the time of inspection."

5. SITE NOTES — Any matter requiring action, clarification, or follow-up (access arrangements, structural queries, trial pits, trees, horticulture, access refusal, matters for the contractor or engineer) goes into award_notes[], never as a condition row.

6. FURNITURE AND FITTINGS — Do not describe furniture, kitchen units, appliances or fittings as condition observations. If an element is obscured by furniture, note that it was not accessible.

7. PROFESSIONAL LANGUAGE — Write as a senior chartered surveyor. Use correct terminology. "Pointing" not "mortar joints". "Abutting" for wall-to-wall junctions. "Adjacent to" for proximity. "Water ingress" not "moisture ingress". "Ceiling" not "ceiling finish". External = "window sill". Internal = "window cill". Never say "biological growth" — use "moss growth" or "algae growth". Historic defects are simply recorded — do not describe cracks as "old" or "historic" unless it is staining or water ingress.

8. FORMAT — Return only valid JSON matching the schema below. No markdown, no commentary.

JSON SCHEMA:
{
  "sections": [
    {
      "number": 2,
      "title": "exact section heading from notes",
      "rows": [
        {
          "ref": "Derive 2-4 letter prefix from section title + zero-padded number e.g. GC01, UR02, ES03. Never RE- for everything.",
          "observation": "Professional chartered surveyor observation — one distinct element or defect only",
          "action": "Record only"
        }
      ]
    }
  ],
  "discussion": [],
  "general_notes": [],
  "actions": [],
  "award_notes": [
    {
      "topic": "access | horticulture | structural | methodology | other",
      "description": "Site note or matter requiring action/clarification"
    }
  ],
  "emails_required": []
}

DICTATED NOTES TO PROCESS:
${message}
`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.15,
      max_tokens: 4000,
      messages: [
        {
          role: 'system',
          content:
            'You are a senior Party Wall Surveyor with 20+ years of experience. Return only valid JSON. Produce authoritative, expert-level Schedule of Condition wording in British English. Recognise and reconcile corrections in the dictated notes. Separate actions, contractor notes, and required emails from the physical condition observations.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error?.message || 'OpenAI extraction failed');
  }

  const raw = payload.choices?.[0]?.message?.content || '';

  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (parseErr) {
    console.error('[generate-soc] JSON parse failed:', raw.slice(0, 300));
    throw new Error('GPT-4o returned invalid JSON');
  }
}

async function getSocDate(projectId, aoId, selectedAO) {
  const aoDate =
    selectedAO?.soc_date ||
    selectedAO?.soc_agreed_date ||
    selectedAO?.schedule_of_condition_date ||
    selectedAO?.scheduleOfConditionDate;

  if (aoDate) return formatLongDate(aoDate);

  try {
    let query = supabase
      .from('tasks')
      .select('due_date, ao_id, task_type')
      .eq('project_id', projectId)
      .eq('task_type', 'soc')
      .order('due_date', { ascending: false })
      .limit(1);

    if (aoId) query = query.eq('ao_id', String(aoId));

    const { data, error } = await query;

    if (!error && data?.[0]?.due_date) return formatLongDate(data[0].due_date);
  } catch (err) {
    console.warn('[generate-soc] task date lookup warning:', err.message);
  }

  return formatLongDate(new Date());
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const {
      message,
      project_id,
      session_id,
      ao_id,
      ao_name,
      ao_names,
      ao_address,
      ao_premise_address,
      ao_service_address,
      structured_data,
      final_soc_data,
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
      return res.status(404).json({
        error: 'Project not found',
        details: projectError?.message,
      });
    }

    const selectedAO = pickAO(project, ao_id);
    const selectedAOAddress = ao_premise_address || ao_address || aoAddress(selectedAO);
    const selectedAONames = ao_names || ao_name || aoNames(selectedAO);

    const projectMeta = {
      ref: project.ref || '',
      bo_address: project.bo_premise_address || project.address || project.premise_address || '',
      bo_names: ownerNameFromProject(project),
      proposed_works: project.works || project.notifiable_works || '',
      prepared_by: 'Itzik Darel ACIArb MIPWS - Square One Consulting',
      ao_id: ao_id || selectedAO?.id || selectedAO?.num || null,
      ao_names: selectedAONames || '',
      ao_address: selectedAOAddress || '',
      ao_service_address: ao_service_address || aoServiceAddress(selectedAO) || '',
    };

    projectMeta.inspection_date = await getSocDate(project_id, projectMeta.ao_id, selectedAO);

    const { data: template, error: templateError } = await supabase
      .from('document_templates')
      .select('html_template, renderer_config')
      .eq('template_key', 'soc')
      .eq('is_active', true)
      .single();

    if (templateError || !template) {
      return res.status(500).json({
        error: 'SOC template missing from document_templates',
        details: templateError?.message,
      });
    }

    const config = template.renderer_config || {};
    const htmlTemplate = template.html_template || '<!DOCTYPE html><html><body>{{SOC_CONTENT}}</body></html>';

    let dataForRender = final_soc_data || structured_data || null;

    if (!dataForRender) {
      let notesText = message || '';

      if (session_id) {
        const { data: sessionNotes, error: notesError } = await supabase
          .from('soc_notes')
          .select('sequence, raw_note, current_section')
          .eq('session_id', session_id)
          .order('sequence', { ascending: true });
        if (!notesError && sessionNotes?.length) {
          notesText = sessionNotes.map(n => {
            const sec = n.current_section ? '[' + n.current_section + '] ' : '';
            return sec + n.raw_note;
          }).join('\n');
        }
      }

      if (!notesText || !String(notesText).trim()) {
        return res.status(400).json({ error: 'Missing message or structured SOC data' });
      }

      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: 'Missing OpenAI API key' });
      }

      dataForRender = await extractStructuredData(notesText, projectMeta, apiKey);
    }

    dataForRender = {
      ...dataForRender,
      introduction: fixedIntroduction(projectMeta),
      ao_address: projectMeta.ao_address || dataForRender.ao_address || '',
      bo_address: projectMeta.bo_address || dataForRender.bo_address || '',
      inspection_date: projectMeta.inspection_date || dataForRender.inspection_date || '',
      proposed_works: projectMeta.proposed_works || dataForRender.proposed_works || '',
      prepared_by: projectMeta.prepared_by || dataForRender.prepared_by || '',
      sections: normaliseSections(dataForRender.sections || []),
      actions: Array.isArray(dataForRender.actions) ? dataForRender.actions : [],
      award_notes: Array.isArray(dataForRender.award_notes) ? dataForRender.award_notes : [],
      emails_required: Array.isArray(dataForRender.emails_required) ? dataForRender.emails_required : [],
    };

    const partyDrafts = buildPartyDrafts(dataForRender.emails_required, projectMeta);

    const renderedContent = renderSocContent(dataForRender, config, projectMeta);
    const preview_html = htmlTemplate.replace('{{SOC_CONTENT}}', renderedContent);

    let report_id = null;

    try {
      const { data: reportId, error: reportError } = await supabase.rpc('create_soc_report', {
        project_id,
        session_id: session_id || null,
        raw_notes: message || null,
        template_key: 'soc',
        bo_address: projectMeta.bo_address || null,
        bo_names: projectMeta.bo_names || null,
        ao_address: projectMeta.ao_address || null,
        ao_names: projectMeta.ao_names || null,
        proposed_works: projectMeta.proposed_works || null,
        prepared_by: projectMeta.prepared_by || null,
      });

      if (!reportError && reportId) {
        report_id = reportId;

        await supabase.rpc('save_soc_structured_data', {
          report_id: reportId,
          structured_data: {
            ...dataForRender,
            project_id,
            ao_id: projectMeta.ao_id,
            project_meta: projectMeta,
          },
          session_id: session_id || null,
          draft_type: 'ai_generated',
        });

        await supabase.rpc('save_soc_preview', {
          report_id: reportId,
          session_id: session_id || null,
          content_html: preview_html,
        });
      }
    } catch (saveError) {
      console.warn('[generate-soc] save warning:', saveError.message);
    }

    // Save raw notes to project chat so they're accessible later
    try {
      const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const aoLabel = ao_name || ao_names || '';
      const chatTitle = `SOC Notes${aoLabel ? ' – ' + aoLabel : ''} – ${today}`;

      const { data: sessionData } = await supabase
        .from('ai_sessions')
        .insert([{
          user_id: 'itzy212@gmail.com',
          project_id: project_id,
          title: chatTitle,
          auto_title: chatTitle,
          surface: 'project_chat',
          session_type: 'soc_notes',
          context_scope: 'project',
          metadata: {
            source: 'soc_generator',
            report_id: report_id || null,
            ao_name: aoLabel || null,
            created_from: 'generate-soc',
          },
        }])
        .select('id')
        .single();

      if (sessionData?.id) {
        await supabase
          .from('ai_messages')
          .insert([{
            session_id: sessionData.id,
            role: 'user',
            content: message,
            project_id: project_id,
            surface: 'project_chat',
            source_type: 'soc_notes',
            user_id: 'itzy212@gmail.com',
          }]);

        console.log('[generate-soc] raw notes saved to project chat session:', sessionData.id);
      }
    } catch (chatSaveError) {
      console.warn('[generate-soc] project chat save skipped:', chatSaveError.message);
    }

    return res.status(200).json({
      preview_html,
      structured_data: dataForRender,
      report_id,
      project_meta: projectMeta,
      partyDrafts,
      actions: dataForRender.actions,
      award_notes: dataForRender.award_notes,
      emails_required: dataForRender.emails_required,
    });
  } catch (err) {
    console.error('[generate-soc] fatal error:', err);

    return res.status(500).json({
      error: err.message || 'SOC generation failed',
    });
  }
}



