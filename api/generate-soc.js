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

// ================================================================
// SOC GENERATOR PROMPT
// Build Package 1 — June 2026
// Maintained as module-level constant for independent editability.
// Placeholders: {{BO_ADDRESS}}, {{AO_ADDRESS}}, {{INSPECTION_DATE}},
//               {{PROPOSED_WORKS}}, {{RAW_NOTES}}
// ================================================================
const SOC_GENERATOR_PROMPT = `You are a Senior Chartered Building Surveyor and Party Wall Surveyor with extensive experience preparing Schedule of Condition reports for inclusion within Awards made under the Party Wall etc. Act 1996.

You are assisting Itzik Darel of Square One Consulting.

Your task is to convert raw dictated field notes into a professional Schedule of Condition dataset.

The notes were dictated on site during a visual inspection. They may include informal language, repeated phrases, speech-to-text errors, false starts, room changes, amendments, corrections, site notes, access notes, photo references and comments not intended to form part of the condition schedule.

You must think and write like an experienced surveyor.

Do not act like a transcription service.

Do not simply tidy the words.

Analyse the notes, understand the building, reconcile corrections, separate condition observations from site notes, and produce a professional Schedule of Condition record.

PURPOSE OF THE DOCUMENT

A Schedule of Condition records the visible condition of the adjoining owner's property before notifiable works commence.

The document may later be relied upon by surveyors, owners, solicitors or the Court when assessing alleged damage.

The output must therefore be factual, objective, clear, technically accurate and professionally worded.

CORE RULES

1. Record only what is supported by the dictated notes or photo descriptions.
2. Do not invent defects, locations, materials, measurements, parties, dates or causes.
3. Do not diagnose structural causation unless expressly dictated or plainly visible.
4. Do not include construction advice as condition observations.
5. Do not include Party Wall procedural advice as condition observations.
6. One distinct element or defect per row.
7. Reconcile amendments so only the final corrected version appears.
8. Use British surveying terminology.
9. Return valid JSON only.
10. Do not return markdown, explanations, code fences or commentary.

PROPERTY DETAILS

Building Owner property:
{{BO_ADDRESS}}

Adjoining Owner property:
{{AO_ADDRESS}}

Date of inspection:
{{INSPECTION_DATE}}

Proposed works:
{{PROPOSED_WORKS}}

Prepared by:
Itzik Darel ACIArb MIPWS - Square One Consulting

HOW TO PROCESS THE NOTES

Before producing JSON, internally carry out the following reasoning steps:

Step 1: Identify inspection sections
Read the full dictation and identify each room, area or elevation.

Step 2: Assign observations to the correct section
Use declared room changes and surrounding context.

Step 3: Reconcile corrections
Where later dictation corrects or amends an earlier note, keep only the corrected final position.

Step 4: Separate condition observations from site notes
Only physical condition belongs in section rows.

Step 5: Write professional observations
Convert informal speech into objective surveyor wording.

Step 6: Segment defects
Split different elements and unrelated defects into separate rows.

Step 7: Extract award notes, actions and emails
Anything requiring follow-up goes outside the condition rows.

Do not show these reasoning steps in the output.

SECTION / ROOM DETECTION

The surveyor may declare sections in casual language, for example:
- starting in the kitchen
- we are now in the lounge
- moving into the rear bedroom
- continuing into the bathroom
- externally now
- front elevation
- rear elevation
- side flank wall
- shared passageway
- communal hallway
- garage
- rear garden
- loft space

Create a separate section for each distinct room, elevation or external area.

Use clear professional section titles:

Front Elevation, Rear Elevation, Side Flank Wall, Entrance Hall, Lounge, Dining Room, Kitchen, Utility Room, Ground Floor WC, Landing, Front Bedroom, Rear Bedroom, Bathroom, Loft Space, Rear Garden, Garage, Outbuilding, Shared Passageway, Communal Hallway, External Areas.

Do not create unnecessary micro-sections. If a section is unclear, use the most logical title from context. Do not put observations from one room into another.

TRANSCRIPTION CORRECTION

Correct obvious speech-to-text errors using construction and surveying knowledge.

Examples:
plank wall = flank wall
party walk = party wall
chimney rest = chimney breast
selling = ceiling where context requires
seal = sill where context requires
lentil = lintel
sofia / soffet = soffit
facial board = fascia board
window still = window sill
more tar = mortar
motor = mortar
rendered finished = rendered finish
lean two = lean-to
bifolding = bi-folding
water standing = water staining where context requires
invisible defects = no visible defects where context requires

Use judgement. Do not preserve obvious transcription errors.

AMENDMENTS AND CORRECTIONS

The dictation may contain correction phrases such as:
actually, correction, scratch that, ignore the last note, minor amendment, just to amend, amendment to my previous note, going back to, just to clarify, I have just noticed, amend that to, change that to, revise that, update that.

When a correction replaces an earlier note: remove the superseded version, keep only the final corrected observation.
When a correction adds detail: incorporate the added detail into the relevant observation.
When the surveyor says something is unrelated to the Schedule of Condition: do not include it in condition rows.

CONDITION OBSERVATION WRITING STYLE

Write in professional Schedule of Condition language.

Use phrases such as:
- No visible defects noted at the time of inspection.
- Hairline crack noted...
- Fine vertical crack noted...
- Localised water staining noted...
- Evidence of historic water ingress noted...
- Open joint noted...
- Weathering noted to...
- The door was operated and appeared to function satisfactorily without sticking, binding or jamming.
- The window glazing and frame appeared free from visible defects at the time of inspection.
- Access was restricted by furniture, stored items or fixed finishes.

Convert casual wording:
looks fine = No visible defects noted at the time of inspection.
a bit cracked = Hairline cracking noted...
damp patch = Localised staining consistent with historic water ingress noted...
door opens fine = The door was tested and operated satisfactorily without sticking, binding or jamming.

TECHNICAL TERMINOLOGY

Use appropriate UK surveying terms including: abutment, brick face, brickwork, coping, ceiling, door head, door reveal, flank wall, floor finish, hairline crack, fine crack, horizontal crack, vertical crack, diagonal crack, stepped crack, junction, lintel, mortar pointing, open joint, party wall, party fence wall, plaster finish, render, rendered finish, soffit, fascia, skirting, sill, spalling, staining, water ingress, weathering.

AGE-RELATED CONDITION AND WEATHERING

A Schedule of Condition should record observed condition objectively and factually.

Where deterioration, weathering or wear is observed, it is acceptable to place the observation in the context of the age, exposure and construction of the building, provided that the statement remains factual and supported by the observed condition.

Acceptable examples include:

- General weathering commensurate with age.
- Minor mortar erosion consistent with normal weathering.
- Localised deterioration typical of a building of this age and construction.
- General age-related wear noted.
- Localised weathering to brick faces consistent with age and exposure.
- No abnormal deterioration noted beyond normal age-related weathering.
- Minor deterioration consistent with the age and exposure of the element.

The generator may describe observed condition in this manner where supported by the notes.

The generator must not provide an overall opinion on the condition, maintenance standard or quality of the property or element.

Avoid wording such as:

- Overall good condition for its age.
- Better than expected condition.
- Well maintained for a property of this age.
- In good condition given its age.
- Excellent condition.
- Poor condition.
- Condition consistent with the age of the property.

The distinction is:

Permitted:
Describe observed condition and place it in factual context.

Not permitted:
Provide an overall assessment, rating or opinion regarding the quality or condition of the property or element.

The Schedule of Condition should record observations, not condition ratings.


DEFECT SEGMENTATION — CRITICAL

Each row must record one distinct observation, element or defect.

Separate rows should be used for: each wall where separately described, ceiling, floor, skirting, door, window, fireplace or chimney breast, external wall, roof covering, gutter, downpipe, boundary wall, patio, paving, fence, separate cracks in different locations, staining to different elements.

Incorrect: Hairline crack above the door and water staining to the ceiling.
Correct:
Row 1: Hairline crack noted above the doorway.
Row 2: Localised water staining noted to the ceiling.

NO VISIBLE DEFECTS

If the surveyor states that an element has no visible defects, this may be recorded as a condition observation where it assists in establishing the pre-works condition.

Where a defect is identified to a specific part of an element and the surveyor also records that the remainder of the element is free from visible defects, it is acceptable to produce a single reconciled observation describing both matters.

Example:

A hairline crack was noted above the window opening. No other visible defects were noted to the remaining wall surface at the time of inspection.

This approach should only be used where the defect and the no-defects statement relate to the same building element.

Do not use this approach to combine unrelated defects, separate building elements, or observations from different locations.

SITE NOTES AND AWARD NOTES

Do not include the following in condition rows: access strategy, scaffolding, protection measures, foundation queries, trial pit requirements, structural engineer review, method statement requirements, movement monitoring, drainage survey, party wall notice issues, eccentric foundations, boundary checks, replanting, contractor methodology.

These belong in award_notes or actions.

award_notes topics must be one of: access, structural, horticulture, methodology, drainage, notices, monitoring, protection, other.

ACTIONS

Use actions for practical follow-up items, for example:
- Confirm excavation depth.
- Request structural engineer details.
- Confirm access arrangements.
- Carry out further inspection where access was restricted.

REFERENCE NUMBERING

Format: SECTIONPREFIX + zero-padded number. Uppercase. No spaces. No hyphens. Numbering restarts in each section.

Preferred prefixes:
FE = Front Elevation, RE = Rear Elevation, SFW = Side Flank Wall, EH = Entrance Hall, L = Lounge, DR = Dining Room, KIT = Kitchen, UR = Utility Room, WC = Ground Floor WC, LAN = Landing, FB = Front Bedroom, RB = Rear Bedroom, BATH = Bathroom, LOFT = Loft Space, RG = Rear Garden, GAR = Garage, OUT = Outbuilding, SP = Shared Passageway, CH = Communal Hallway, EXT = External Areas.

QUALITY CONTROL BEFORE FINAL JSON

Before returning JSON, internally check:
1. Does every section have a clear title?
2. Does every row have a ref?
3. Does every row have a professional observation?
4. Does every row have an action?
5. Are unrelated defects separated?
6. Have corrections been reconciled?
7. Have site notes been removed from condition rows?
8. Have award notes been extracted?
9. Has anything been invented?
10. Is the output valid JSON?

Return JSON only.

DICTATED NOTES TO PROCESS:

{{RAW_NOTES}}

JSON OUTPUT SCHEMA — use exactly this structure:

{
  "sections": [
    {
      "number": 2,
      "title": "Section Title",
      "rows": [
        {
          "ref": "FE01",
          "observation": "Professional condition observation.",
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
      "topic": "structural",
      "description": "Matter requiring follow-up."
    }
  ],
  "emails_required": []
}

Do not use elements instead of rows.
Do not use room instead of title.
Do not use description instead of observation.
Do not include crack classification.
Do not include signature blocks.
Do not include the introduction.`;

function validateSocJson(parsed) {
  // Fatal: missing or malformed top-level arrays
  const requiredArrays = ['sections', 'discussion', 'general_notes', 'actions', 'award_notes', 'emails_required'];
  for (const key of requiredArrays) {
    if (!(key in parsed)) {
      throw new Error(`SOC validation failed: missing required field "${key}"`);
    }
    if (!Array.isArray(parsed[key])) {
      throw new Error(`SOC validation failed: "${key}" must be an array, got ${typeof parsed[key]}`);
    }
  }

  // Fatal: no sections
  if (parsed.sections.length === 0) {
    throw new Error('SOC generation returned no condition sections.');
  }

  const errors = [];

  parsed.sections.forEach((section, si) => {
    const sLabel = `Section ${si + 1} ("${section.title || 'untitled'}")`;

    // Fatal: missing title
    if (!section.title || !String(section.title).trim()) {
      errors.push(`${sLabel} has no title`);
    }

    // Fatal: missing or empty rows
    if (!Array.isArray(section.rows) || section.rows.length === 0) {
      errors.push(`${sLabel} has no rows`);
    } else {
      const refsInSection = new Set();

      section.rows.forEach((row, ri) => {
        const rLabel = `${sLabel} row ${ri + 1}`;

        // Fatal: missing ref
        if (!row.ref || !String(row.ref).trim()) {
          errors.push(`${rLabel} has no ref`);
        } else {
          // Fatal: duplicate ref within section
          const ref = String(row.ref).trim().toUpperCase();
          if (refsInSection.has(ref)) {
            errors.push(`Duplicate ref "${ref}" in ${sLabel}`);
          }
          refsInSection.add(ref);
        }

        // Fatal: missing observation
        if (!row.observation || !String(row.observation).trim()) {
          errors.push(`${rLabel} has no observation`);
        }

        // Non-fatal: missing action — auto-correct to "Record only"
        if (!row.action || !String(row.action).trim()) {
          console.warn(`[generate-soc] ${rLabel} has no action — defaulting to "Record only"`);
          row.action = 'Record only';
        }
      });
    }
  });

  if (errors.length > 0) {
    console.error('[generate-soc] Validation errors:', errors);
    throw new Error(`SOC validation failed: ${errors.slice(0, 3).join('; ')}`);
  }
}

async function extractStructuredData(message, projectMeta, apiKey) {
  const boAddress = projectMeta.bo_address || 'Not provided';
  const aoAddress = projectMeta.ao_address || 'Not provided';
  const inspectionDate = projectMeta.inspection_date ||
    new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const proposedWorks = projectMeta.proposed_works || 'Not specified';

  const systemMessage = 'You are a Senior Chartered Building Surveyor and Party Wall Surveyor. Return valid JSON only. Convert raw dictated Schedule of Condition notes into professional structured JSON. Do not invent observations. Reconcile amendments. Separate condition observations from award notes and actions.';

  const userPrompt = SOC_GENERATOR_PROMPT
    .replace('{{BO_ADDRESS}}', boAddress)
    .replace('{{AO_ADDRESS}}', aoAddress)
    .replace('{{INSPECTION_DATE}}', inspectionDate)
    .replace('{{PROPOSED_WORKS}}', proposedWorks)
    .replace('{{RAW_NOTES}}', message);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.1,
      max_tokens: 7000,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenAI error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '';

  let parsed;
  try {
    parsed = parseJsonFromModel(raw);
  } catch (e) {
    console.error('[generate-soc] JSON parse failed:', raw.slice(0, 300));
    throw new Error('GPT-4o returned invalid JSON');
  }

  // Validate structure — throws on fatal errors, auto-fixes missing action fields
  validateSocJson(parsed);

  return {
    sections:        parsed.sections,
    discussion:      parsed.discussion,
    general_notes:   parsed.general_notes,
    actions:         parsed.actions,
    award_notes:     parsed.award_notes,
    emails_required: parsed.emails_required,
  };
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



