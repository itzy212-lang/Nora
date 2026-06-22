import { createClient } from '@supabase/supabase-js';
import { GENERATOR_SYSTEM_PROMPT } from './soc-framework.js';

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

function parseJsonFromModel(raw = '') {
  const text = String(raw || '').trim();

  // Strip markdown code fences if present
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  // Try direct parse first
  try {
    return JSON.parse(cleaned);
  } catch {}

  // Try extracting JSON object by first { and last }
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    try {
      return JSON.parse(cleaned.slice(first, last + 1));
    } catch {}
  }

  throw new Error('GPT returned invalid JSON');
}

// ================================================================
// SOC GENERATOR PROMPT
// Build Package 1 — June 2026
// Maintained as module-level constant for independent editability.
// Placeholders: {{BO_ADDRESS}}, {{AO_ADDRESS}}, {{INSPECTION_DATE}},
//               {{PROPOSED_WORKS}}, {{RAW_NOTES}}
// ================================================================
const SOC_GENERATOR_PROMPT = `You are a Senior Chartered Building Surveyor and Party Wall Surveyor with extensive experience preparing Schedule of Condition reports under the Party Wall etc. Act 1996.

You are assisting Itzik Darel of Square One Consulting.

Your task is to convert raw dictated field notes into a professional, complete Schedule of Condition dataset.

The notes were dictated on site during a visual inspection. They may contain informal language, repeated phrases, speech-to-text errors, false starts, room changes, amendments, corrections, site notes, access notes, photo references and comments not intended to form part of the condition schedule.

Think and write like an experienced surveyor. Do not act like a transcription service. Analyse the notes, understand the building, reconcile all corrections, separate condition observations from site notes, and produce a professional, complete Schedule of Condition record.

PURPOSE

A Schedule of Condition records the visible condition of the adjoining owner's property before notifiable works commence. It may later be relied upon by surveyors, owners, solicitors or the Court. It must be factual, objective, clear, technically accurate and professionally worded.

PROPERTY DETAILS

Building Owner property: {{BO_ADDRESS}}
Adjoining Owner property: {{AO_ADDRESS}}
Date of inspection: {{INSPECTION_DATE}}
Proposed works: {{PROPOSED_WORKS}}
Prepared by: Itzik Darel ACIArb MIPWS - Square One Consulting

PROCESSING STEPS

Before producing JSON, internally carry out these steps:

Step 1: AUDIT ALL NOTES
List every note by number. Every note must have a traceable outcome.
A note may be: allocated to a section, merged into an existing observation, used to amend an earlier observation, recorded as contextual information, recorded as a site note, recorded as an award note, or marked as unresolved.
No note may disappear silently.

Step 2: IDENTIFY SECTIONS
Read the full dictation. Identify each room, area or elevation from both explicit declarations and inferred content.
Do not rely only on explicit "moving into the kitchen" statements.
Infer sections from subject matter:
- garage door, concrete panels, asbestos roof, precast panels → Garage
- crazy paving outside garage, driveway, cement splatter → Shared Driveway
- worktop, oven, hob, boiler, dishwasher, fridge → Kitchen
- shower tray, bath, basin, WC, shower enclosure → Bathroom
- landing, stairs, balustrade, handrail → Landing and Stairs
- flank brickwork, boundary wall, side elevation → Side Flank Wall
- patio, rear garden, garden fence, garden wall → Rear Garden
Where a section first appears only as context and later receives condition observations, create it as an active section.

Step 3: ASSIGN ALL OBSERVATIONS
Every condition observation must be assigned to a section.
Where assignment is genuinely uncertain, place in the most logical section and flag in unresolved_notes.

Step 4: RECONCILE ALL AMENDMENTS
Detect correction phrases: actually, correction, scratch that, ignore the last note, minor amendment, just to amend, amendment to my previous note, going back to, just to clarify, I have just noticed, amend that to, change that to, revise that, update that, in contrast to, slight amendment.
Identify the correct target by section, element, location and meaning — not only the immediately preceding note.
Where a note corrects a measurement: use the corrected value, do not retain the original.
Where a later note identifies a defect in an element previously described as defect-free: reconcile both in the final observation. Example: "The precast concrete panels appeared generally free from visible defects, except that the second panel from the front and second panel above floor level was displaced inward."
Do not retain contradictory statements in the same observation.

Step 5: COMPLETENESS AND CONTRADICTION AUDIT
Before producing the final JSON, check:
- Are all notes accounted for?
- Are there contradictory no-defects statements alongside defect observations for the same element?
- Have any measurements been lost during reconciliation?
- Have any locations, directions or dimensions been dropped?
- Have any unresolved amendments been left inconsistent?
- Are any sections missing despite content existing for them?
Resolve all issues before producing the final JSON.

Step 6: WRITE PROFESSIONAL OBSERVATIONS
Convert informal speech into objective surveyor wording.
Use the approved terminology and sentence structures below.
Each row records one distinct element or defect.

Step 7: EXTRACT AWARD NOTES, ACTIONS AND EMAILS
Anything requiring follow-up goes outside the condition rows.

SECTION TITLES
Use professional titles: Front Elevation, Rear Elevation, Side Flank Wall, Entrance Hall, Lounge, Dining Room, Kitchen, Utility Room, Ground Floor WC, Landing and Stairs, Front Bedroom, Rear Bedroom, Bathroom, Loft Space, Rear Garden, Garage, Shared Driveway, Outbuilding, Shared Passageway, External Areas.

APPROVED SURVEYING TERMINOLOGY

Use accurate UK building surveying terminology.

LOCATION: abutment, adjacent, beneath, above, immediately below, immediately above, left-hand side, right-hand side, central, upper section, lower section, inner face, outer face, junction, interface, return, reveal, head, sill, soffit, fascia, arris, corner, perimeter, parallel, perpendicular, diagonal, vertical, horizontal, stepped, intermittent, continuous, localised, isolated, throughout, full width, full height, approximately.

WALLS: party wall, flank wall, external wall, partition wall, party fence wall, retaining wall, parapet, coping, chimney breast, chimney stack, masonry, brickwork, blockwork, concrete, reinforced concrete, precast concrete, plaster finish, rendered finish, pebble-dash finish, painted finish, wallpaper-lined finish, tiled finish, skirting, cornice, coving, dado rail.

BRICKWORK: brick face, mortar pointing, open perp joint, eroded pointing, missing pointing, spalling, surface erosion, perished brick face, displaced brickwork, bulging, out of plumb, stepped cracking, efflorescence, mortar loss.

CRACKS: hairline crack, fine crack, very slight crack, slight crack, vertical crack, horizontal crack, diagonal crack, stepped crack, settlement crack, shrinkage crack, surface crazing, intermittent crack, open joint, localised separation, crack at abutment, fades out, terminates, branches, extends towards.

MOISTURE: water staining, localised staining, historic water staining, evidence of historic water ingress, damp staining, mould growth, condensation-related mould growth, discolouration, tide mark, salt staining, efflorescence, dry at the time of inspection.

CONDITION DESCRIPTORS: no visible defects noted at the time of inspection, generally free from visible defects, localised defect, isolated defect, intermittent defect, historic repair, patch repair, age-related weathering, weathering commensurate with age, localised deterioration, no abnormal deterioration noted, recorded as photographed, access restricted, partially concealed, visual inspection only.

SPEECH-TO-TEXT CORRECTIONS

Correct these automatically where context supports it:
plank wall → flank wall, party walk → party wall, chimney rest → chimney breast,
selling → ceiling, seal → sill, lentil → lintel, sofia/soffet → soffit,
facial board → fascia board, window still → window sill, more tar/motor → mortar,
rendered finished → rendered finish, lean two → lean-to, bifolding → bi-folding,
water standing → water staining, invisible defects → no visible defects,
butamine → bitumen, grounding → grouting, moulding → mould growth,
joining owner → adjoining owner, building on a → building owner,
concrete slabs → precast concrete panels (where context supports),
garage fascia wood → timber fascia, cracking in the silicone → open sealant joint,
weathered grout → deteriorated grout.

PREFERRED SENTENCE STRUCTURES

NO VISIBLE DEFECTS
- No visible defects were noted at the time of inspection.
- The [element] appeared generally free from visible defects at the time of inspection.

CRACKS
- A hairline [direction] crack was noted to the [finish] at the [location].
- A fine [direction] crack extends from [origin] towards [destination], approximately [length] in length.

AMENDMENTS QUALIFYING EARLIER NO-DEFECTS
- The [element] appeared generally free from visible defects, except that [specific defect].

STAINING
- Localised [colour] staining was noted to the [element] at [location], [extent].
- Evidence of historic water ingress was noted to [element], recorded as dry at the time of inspection.

DOORS AND WINDOWS
- The [door/window] was tested and operated satisfactorily without sticking, binding or jamming.

PHOTO-ONLY AREAS
- The [area] was recorded photographically only, as it is remote from the notifiable works.
Do not omit this statement. Do not omit the section entirely merely because only photos were taken.

CONDITION OBSERVATION CONTENT STANDARD

For each relevant element, include where dictated:
1. Element or building component
2. Construction or material
3. Finish
4. General visible condition
5. Specific defect
6. Exact location within room or elevation
7. Direction (vertical, horizontal, diagonal, stepped)
8. Extent
9. Approximate dimensions where stated
10. Access limitations
11. Photographic limitations
12. Any amendment or qualification

Do not omit construction descriptions merely because there is also a defect.
Do not omit general no-visible-defects wording where it forms part of the baseline record.
Do not omit any area because it contains only one or two observations.
Do not silently remove measurements, directions or locations during editing.

SOURCE TRACEABILITY

Every row must record its source note indices in source_note_ids.
Example: "source_note_ids": [14, 16]
This must be populated for every row. Use empty array [] only where no source note can be identified.

UNRESOLVED NOTES

Where a note cannot be confidently allocated, include it in unresolved_notes with the actual note text and suggested section.

RAW NOTES

{{RAW_NOTES}}

JSON OUTPUT SCHEMA

Return exactly this structure. No other keys at the top level.

{
  "sections": [
    {
      "number": 2,
      "title": "Section Title",
      "rows": [
        {
          "ref": "FE01",
          "observation": "Professional condition observation.",
          "action": "Record only",
          "source_note_ids": [1, 3]
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
  "emails_required": [],
  "unresolved_notes": [
    {
      "note_text": "The original dictated note.",
      "note_index": 7,
      "suggested_section": "Shared Driveway",
      "reason": "Could not determine whether this belongs under Garage or Shared Driveway."
    }
  ]
}

Do not use elements instead of rows.
Do not use room instead of title.
Do not use description instead of observation.
Do not include crack classification.
Do not include signature blocks.
Do not include the introduction.
Do not omit source_note_ids.`;


// ── Coded completeness audit ────────────────────────────────────────────
// Every source note must have a classification. 100% accounting required.
// A note may be contextual/site/award/excluded/unresolved — but it must not disappear.
function runCompletenessAudit(parsed, rawNotesText = '') {
  const issues = [];
  const warnings = [];

  // Parse raw notes — skip blank lines and section headers
  const rawNotes = rawNotesText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 5 && !/^\[.+\]\s*$/.test(l));

  const totalNotes = rawNotes.length;
  if (totalNotes === 0) return { issues, warnings };

  // Build full accounting of all notes
  const allRows = (parsed.sections || []).flatMap(s => s.rows || []);
  const unresolved = parsed.unresolved_notes || [];
  const siteNotes = (parsed.general_notes || []).filter(n =>
    typeof n === 'string' ? n : n.note || n.text || ''
  );
  const awardNotes = parsed.award_notes || [];
  const excluded = parsed.excluded_notes || [];

  // All source_note_ids referenced across all output
  const allSourceIds = new Set([
    ...allRows.flatMap(r => r.source_note_ids || []),
    ...unresolved.map(n => n.note_index).filter(Boolean),
    ...siteNotes.flatMap(n => n.source_note_ids || []),
    ...awardNotes.flatMap(n => n.source_note_ids || []),
    ...excluded.map(n => n.note_index).filter(Boolean),
  ]);

  // Coverage check — must be 100% when all classifications included
  const accounted = allSourceIds.size;
  const unaccountedCount = totalNotes - accounted;

  if (unaccountedCount > 0) {
    issues.push(
      `COVERAGE FAILURE: ${unaccountedCount} of ${totalNotes} source notes have no destination. ` +
      `Every note must be allocated, classified as contextual/site/award, or explicitly excluded. ` +
      `Notes without a destination: indices not in [${[...allSourceIds].sort((a,b)=>a-b).join(', ')}]`
    );
  }

  // Rows with no source note — invention risk
  const rowsWithoutSource = allRows.filter(r => !r.source_note_ids || r.source_note_ids.length === 0);
  if (rowsWithoutSource.length > 0) {
    issues.push(
      `${rowsWithoutSource.length} final row(s) have no source_note_ids — possible invention: ` +
      rowsWithoutSource.map(r => r.ref || '?').join(', ')
    );
  }

  // Contradictory observations in same section
  for (const section of (parsed.sections || [])) {
    const rows = section.rows || [];
    const noDefectsRows = rows.filter(r =>
      /no visible defects/i.test(r.observation) &&
      !/except/i.test(r.observation) &&
      !/apart from/i.test(r.observation) &&
      !/other than/i.test(r.observation)
    );
    const defectRows = rows.filter(r =>
      /crack|stain|spall|deteriorat|displace|bulg|damp|mould|missing|defect(?!s noted)|fractur|damaged|displaced|eroded|split/i.test(r.observation) &&
      !/no visible defects/i.test(r.observation)
    );
    if (noDefectsRows.length > 0 && defectRows.length > 0) {
      issues.push(
        `Section "${section.title}": unqualified no-defects statement alongside ${defectRows.length} defect row(s). ` +
        `The no-defects statement must be qualified or removed.`
      );
    }
  }

  // Unresolved notes remaining
  if (unresolved.length > 0) {
    warnings.push(
      `${unresolved.length} note(s) unresolved: ` +
      unresolved.map(n => `"${String(n.note_text || '').slice(0, 80)}"`).join('; ')
    );
  }

  // Note: 0% unaccounted is the target. Any missing notes are flagged as issues, not warnings.
  return { issues, warnings, totalNotes, accountedNotes: accounted };
}


function validateSocJson(parsed) {
  // Fatal: missing or malformed top-level arrays
  const requiredArrays = ['sections', 'discussion', 'general_notes', 'actions', 'award_notes', 'emails_required'];
  // unresolved_notes is optional — auto-create if missing
  if (!parsed.unresolved_notes) parsed.unresolved_notes = [];
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

  const systemMessage = GENERATOR_SYSTEM_PROMPT;

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
    console.error('[generate-soc] JSON parse failed. finish_reason:', data.choices?.[0]?.finish_reason);
    console.error('[generate-soc] Raw response start:', raw.slice(0, 500));
    const reason = data.choices?.[0]?.finish_reason === 'length'
      ? 'GPT-4o returned invalid JSON (response truncated — increase max_tokens or reduce notes length)'
      : 'GPT-4o returned invalid JSON';
    throw new Error(reason);
  }

  // Validate structure — throws on fatal errors, auto-fixes missing action fields
  validateSocJson(parsed);

  // Run coded completeness audit
  const audit = runCompletenessAudit(parsed, message);
  if (audit.issues.length > 0) {
    console.warn('[generate-soc] Completeness audit issues:', audit.issues);
  }
  if (audit.warnings.length > 0) {
    console.warn('[generate-soc] Completeness audit warnings:', audit.warnings);
  }

  return {
    sections:          parsed.sections,
    discussion:        parsed.discussion,
    general_notes:     parsed.general_notes,
    actions:           parsed.actions,
    award_notes:       parsed.award_notes,
    emails_required:   parsed.emails_required,
    unresolved_notes:  parsed.unresolved_notes || [],
    audit_issues:      audit.issues,
    audit_warnings:    audit.warnings,
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

    // Validate ao_id — Supabase expects a UUID; sanitise to null if invalid
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const safeAoId = ao_id && UUID_RE.test(String(ao_id)) ? ao_id : null;

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
      ao_id: safeAoId || (selectedAO?.id && UUID_RE.test(String(selectedAO.id)) ? selectedAO.id : null),
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

      // Upsert the SOC session into project chat — one session per project+AO, not per generate
      const aoKey = aoLabel || ao_id || 'default';
      const { data: existingSessions } = await supabase
        .from('ai_sessions')
        .select('id')
        .eq('project_id', project_id)
        .eq('session_type', 'soc_notes')
        .eq('user_id', 'itzy212@gmail.com')
        .like('auto_title', `%${aoKey}%`)
        .limit(1);

      let chatSessionId = existingSessions?.[0]?.id || null;

      if (!chatSessionId) {
        const { data: newSession } = await supabase
          .from('ai_sessions')
          .insert([{
            user_id: 'itzy212@gmail.com',
            project_id: project_id,
            title: chatTitle,
            auto_title: chatTitle,
            surface: 'project_chat',
            session_type: 'soc_notes',
            context_scope: 'project',
            metadata: { source: 'soc_generator', report_id: report_id || null, ao_name: aoLabel || null },
          }])
          .select('id')
          .single();
        chatSessionId = newSession?.id || null;
      } else {
        // Update title with latest date
        await supabase.from('ai_sessions').update({ title: chatTitle, auto_title: chatTitle }).eq('id', chatSessionId);
      }

      const sessionData = chatSessionId ? { id: chatSessionId } : null        .insert([{
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



