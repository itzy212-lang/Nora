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
    (item) => item && (item.item || item.title || item.body)
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
You are a Schedule of Condition assistant for a Party Wall surveyor.

Convert the following site notes into structured JSON.

Return only valid JSON. No markdown, no backticks, no preamble.

Required structure:
{
  "ao_address": "",
  "bo_address": "",
  "inspection_date": "",
  "proposed_works": "",
  "prepared_by": "",
  "photo_record": "",
  "introduction": "",
  "sections": [
    {
      "number": 2,
      "title": "exact dictated heading",
      "rows": [
        { "ref": "FE-01", "observation": "formal observation", "action": "Record only" }
      ]
    }
  ],
  "discussion": [],
  "general_notes": []
}

Rules:
- Use sections[].rows[].ref, observation and action.
- Leave introduction blank. The system inserts the introduction separately.
- Preserve dictated room or area headings exactly as section titles. Do not rename, generalise, simplify or reinterpret them.
- A standalone heading line such as "Utility Area to Rear of Garage", "Cloakroom / WC off Utility", "Garage Roof" or "Front Driveway / Paving" must become a section title exactly as written.
- Section 2 must be the first dictated room or area heading in the notes. Do not replace it with a generic category such as "Internal Walls and Ceilings".
- Keep all observations that follow a heading inside that heading until the next clear dictated heading appears.
- Do not split windows, floors, ceilings or skirtings into separate sections unless the user dictated those as separate headings.
- Do not invent headings. Do not create generic headings unless the notes contain no usable heading at all.
- Do not invent defects not mentioned.
- Preserve measurements exactly as given.
- Use formal, third-person surveying language.
- Use Record only where no further action is required.
- Section numbers start at 2 because section 1 is added automatically.
- Only populate discussion where the notes clearly require a separate discussion or recommendation item. Otherwise return an empty array.
- General notes should only contain final general notes dictated under a General Notes heading.

Project context:
Adjoining Owner property: ${projectMeta.ao_address || ''}
Building Owner property: ${projectMeta.bo_address || ''}
Inspection date: ${projectMeta.inspection_date || ''}
Proposed works: ${projectMeta.proposed_works || ''}
Prepared by: ${projectMeta.prepared_by || ''}

Site notes:
${message}
`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content:
            'Return only valid JSON for a Schedule of Condition. Preserve dictated room and area headings exactly. Leave the introduction blank.',
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

  return JSON.parse(raw.replace(/```json|```/g, '').trim());
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
      if (!message || !String(message).trim()) {
        return res.status(400).json({ error: 'Missing message or structured SOC data' });
      }

      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: 'Missing OpenAI API key' });
      }

      dataForRender = await extractStructuredData(message, projectMeta, apiKey);
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
    };

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

    return res.status(200).json({
      preview_html,
      structured_data: dataForRender,
      report_id,
      project_meta: projectMeta,
    });
  } catch (err) {
    console.error('[generate-soc] fatal error:', err);

    return res.status(500).json({
      error: err.message || 'SOC generation failed',
    });
  }
}
