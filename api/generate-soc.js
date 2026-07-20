export const config = { maxDuration: 300 };

import { createClient } from '@supabase/supabase-js';
import {
  extractAtomicClaims,
  draftFromClaims,
  runQualityAudit,
  runCompletenessAudit,
} from './lib/soc-pipeline.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── SOC framework constants (inlined — Vercel doesn't support relative API imports) ──
// api/soc-framework.js
// Centralised SOC terminology, correction signals, sentence templates and section inference.
// Used by: process-soc-note.js, generate-soc.js, soc-vision.js
// Update this file only — do not duplicate across routes.

// ── Correction signals ────────────────────────────────────────────────────
const CORRECTION_SIGNALS = [
  'scratch that', 'strike that', 'actually', 'correction', 'go back',
  'that last note', 'ignore that', 'change that', 'amendment', 'amend',
  'minor amendment', 'just to amend', 'going back to', 'just to clarify',
  'correction to', 'to correct', 'revise', 'revision to', 'update to',
  'update my last', 'amending my last', 'amending the last', 'just some minor',
  'just to add to', 'adding to my last', 'adding to the last',
  'slight amendment', 'i have just noticed', 'amend that to', 'change that to',
  'revise that', 'update that', 'in contrast to', 'if i did not say it before',
  'to clarify my earlier', 'going back to the', 'actually to correct',
];

// ── Section inference keywords ────────────────────────────────────────────
const SECTION_KEYWORDS = {
  'Garage': [
    'garage', 'garage door', 'garage floor', 'asbestos roof', 'concrete panel',
    'precast panel', 'garage flank', 'garage wall', 'garage ceiling', 'garage window',
    'up and over door', 'roller door', 'garage fascia',
  ],
  'Shared Driveway': [
    'driveway', 'shared driveway', 'crazy paving', 'paving outside garage',
    'concrete drive', 'tarmac drive', 'asphalt drive', 'drive surface',
    'front driveway', 'vehicle access',
  ],
  'Kitchen': [
    'kitchen', 'worktop', 'oven', 'hob', 'boiler', 'dishwasher', 'fridge',
    'sink', 'kitchen ceiling', 'kitchen floor', 'kitchen tiles', 'kitchen window',
    'kitchen wall', 'extractor', 'kitchen cupboard',
  ],
  'Bathroom': [
    'bathroom', 'shower', 'shower tray', 'bath', 'toilet', 'wc', 'basin',
    'bathroom tiles', 'bathroom ceiling', 'bathroom floor', 'bath panel',
    'shower enclosure', 'shower screen',
  ],
  'Landing and Stairs': [
    'landing', 'stairs', 'staircase', 'balustrade', 'handrail', 'newel post',
    'stair tread', 'stair riser', 'first floor landing', 'hallway stairs',
  ],
  'Entrance Hall': [
    'entrance hall', 'hallway', 'hall', 'front door', 'entrance door',
    'hall floor', 'hall ceiling', 'hall wall',
  ],
  'Lounge': [
    'lounge', 'living room', 'sitting room', 'reception room', 'front room',
    'lounge ceiling', 'lounge floor', 'lounge wall', 'fireplace', 'chimney breast',
  ],
  'Front Bedroom': [
    'front bedroom', 'master bedroom', 'bedroom one', 'first bedroom',
  ],
  'Rear Bedroom': [
    'rear bedroom', 'back bedroom', 'second bedroom', 'bedroom two', 'bedroom three',
  ],
  'Front Elevation': [
    'front elevation', 'front wall', 'front brickwork', 'front render',
    'front facade', 'front of the property', 'front external',
  ],
  'Rear Elevation': [
    'rear elevation', 'rear wall', 'rear brickwork', 'rear render',
    'rear extension', 'back wall', 'rear external',
  ],
  'Side Flank Wall': [
    'flank wall', 'side wall', 'side elevation', 'side flank', 'flank elevation',
    'party fence wall', 'boundary wall', 'side brickwork',
  ],
  'Rear Garden': [
    'rear garden', 'back garden', 'patio', 'garden paving', 'garden wall',
    'rear patio', 'garden fence', 'garden path', 'flower bed',
  ],
  'Loft Space': [
    'loft', 'loft space', 'roof space', 'attic', 'loft floor', 'loft ceiling',
    'roof timbers', 'rafters', 'joists', 'loft insulation',
  ],
  'External Areas': [
    'external', 'outside', 'exterior', 'outbuilding', 'shed', 'annexe',
    'boundary', 'gate', 'path', 'passageway', 'shared passageway', 'alley',
  ],
};

// ── Speech-to-text correction dictionary ─────────────────────────────────
const SPEECH_CORRECTIONS = {
  'plank wall': 'flank wall',
  'blank wall': 'flank wall',
  'party walk': 'party wall',
  'party award': 'party wall',
  'chimney rest': 'chimney breast',
  'chimney breast rest': 'chimney breast',
  'selling': 'ceiling',
  'sealing': 'ceiling',
  'seal': 'sill',
  'window seal': 'window sill',
  'door seal': 'door sill',
  'lentil': 'lintel',
  'lentel': 'lintel',
  'sofia': 'soffit',
  'soffet': 'soffit',
  'facial board': 'fascia board',
  'fascia board': 'fascia board',
  'window still': 'window sill',
  'more tar': 'mortar',
  'motor': 'mortar',
  'rendered finished': 'rendered finish',
  'lean two': 'lean-to',
  'bifolding': 'bi-folding',
  'water standing': 'water staining',
  'invisible defects': 'no visible defects',
  'butamine': 'bitumen',
  'grounding': 'grouting',
  'moulding': 'mould growth',
  'joining owner': 'adjoining owner',
  'joining owners': 'adjoining owners',
  'building on a': 'building owner',
  'concrete slabs': 'precast concrete panels',
  'garage fascia wood': 'timber fascia',
  'cracking in the silicone': 'open sealant joint',
  'weathered grout': 'deteriorated grout',
};

// ── Approved surveying terminology (for prompts) ─────────────────────────
const SOC_TERMINOLOGY = `
APPROVED SURVEYING TERMINOLOGY

Use accurate UK building surveying terminology throughout.

LOCATION AND GEOMETRY
abutment, adjacent, beneath, above, immediately below, immediately above,
left-hand side, right-hand side, central, upper section, lower section,
inner face, outer face, junction, interface, return, reveal, head, sill, soffit,
fascia, arris, corner, perimeter, parallel, perpendicular, diagonal, vertical,
horizontal, stepped, intermittent, continuous, localised, isolated, throughout,
full width, full height, approximately.

WALLS AND FINISHES
party wall, flank wall, external wall, partition wall, party fence wall,
retaining wall, parapet, coping, chimney breast, chimney stack,
masonry, brickwork, blockwork, concrete, reinforced concrete, precast concrete,
plaster finish, rendered finish, pebble-dash finish, painted finish,
wallpaper-lined finish, tiled finish, skirting, cornice, coving, dado rail.

BRICKWORK
brick face, mortar pointing, open perp joint, eroded pointing, missing pointing,
spalling, surface erosion, perished brick face, displaced brickwork, bulging,
out of plumb, stepped cracking, efflorescence, mortar loss.

CRACKS
hairline crack, fine crack, very slight crack, slight crack, vertical crack,
horizontal crack, diagonal crack, stepped crack, settlement crack, shrinkage crack,
surface crazing, intermittent crack, open joint, localised separation,
crack at abutment, crack to plaster finish, crack to render, crack to grout,
crack width, crack length, fades out, terminates, branches.

MOISTURE
water staining, localised staining, historic water staining,
evidence of historic water ingress, damp staining, mould growth,
condensation-related mould growth, discolouration, tide mark, salt staining,
efflorescence, dry at the time of inspection, no active moisture visible.

CONDITION DESCRIPTORS
no visible defects noted at the time of inspection,
generally free from visible defects, localised defect, isolated defect,
intermittent defect, historic repair, patch repair, age-related weathering,
weathering commensurate with age, localised deterioration,
no abnormal deterioration noted, recorded as photographed,
access restricted, partially concealed, not accessible, visual inspection only.
`;

// ── Professional sentence templates ──────────────────────────────────────
const SOC_SENTENCE_TEMPLATES = `
PREFERRED SOC SENTENCE STRUCTURES

NO VISIBLE DEFECTS
- No visible defects were noted at the time of inspection.
- The [element] appeared generally free from visible defects at the time of inspection.
- No visible defects were noted to the remaining surface.

CRACKS
- A hairline [direction] crack was noted to the [finish] at the [location].
- A fine [direction] crack extends from [origin] towards [destination], approximately [length] in length.
- An intermittent [direction] crack was noted to the [element], extending [description of extent].
- [Direction] cracking was noted to the [element] at [location], approximately [width] in width and [length] in length.

AMENDMENTS THAT QUALIFY EARLIER NO-DEFECTS STATEMENTS
- The [element] appeared generally free from visible defects, except that [specific defect].
- No other visible defects were noted to the [element] apart from [specific defect].

STAINING
- Localised [colour] staining was noted to the [element] at [location], [extent].
- Evidence of historic water ingress was noted to [element], recorded as dry at the time of inspection.

DOORS AND WINDOWS
- The [door/window] was tested and operated satisfactorily without sticking, binding or jamming.
- The [door/window] frame and glazing appeared free from visible defects at the time of inspection.
- The [element] was [not accessible / partially concealed by stored items / access restricted].

PHOTO-ONLY RECORDING
- The [area] was recorded photographically only, as it is remote from the notifiable works.
`;

// ── System prompt fragment for process-soc-note (live acknowledgement) ───
const LIVE_NOTE_SYSTEM_PROMPT = `You are assisting a party wall surveyor during a live Schedule of Condition inspection on site.

Your role is to acknowledge each dictated note intelligently, maintain a live reconciled inspection record, and confirm that observations, amendments and corrections have been understood correctly.

CURRENT INSPECTION STATE
{{SESSION_STATE}}

SPEECH-TO-TEXT CORRECTIONS
Apply the following corrections where context supports them:
plank wall → flank wall, chimney rest → chimney breast, selling → ceiling,
lentil → lintel, soffet/sofia → soffit, more tar/motor → mortar,
window still → window sill, invisible defects → no visible defects,
water standing → water staining, joining owner → adjoining owner.

NOTE CLASSIFICATION

Classify each incoming note as one of:
- OBSERVATION: a new condition observation
- ROOM_CHANGE: a new room, area or elevation
- AMENDMENT: corrects or qualifies an earlier observation
- ADDITION: adds detail to an earlier observation
- CONTEXTUAL: location or access information, no condition observation
- SITE_NOTE: a note not forming part of the condition schedule
- QUESTION: the surveyor asking about the session state
- UNRESOLVED: unclear allocation

SECTION INFERENCE
Do not wait for explicit room declarations.
Infer section from subject matter:
- garage door, concrete panels, asbestos roof → Garage
- crazy paving, driveway, cement splatter → Shared Driveway
- worktop, oven, boiler, dishwasher → Kitchen
- shower tray, bath, basin → Bathroom
- landing, stairs, balustrade → Landing and Stairs
- flank brickwork, boundary wall → Side Flank Wall

AMENDMENT DETECTION
An amendment may refer to any earlier observation, not only the immediately preceding note.
Identify the correct target observation by section, element, location and meaning.
Where a later note identifies a defect in an element previously described as defect-free, the final
observation must reconcile both: the remaining element is free from visible defects except the specific defect.

ACKNOWLEDGEMENT RULES

For a normal observation: Noted.
For a clear room change: [Room name]. Got it.
For a section inferred from content: [Section name] created. [One-line summary of observation recorded.]
For an amendment: Amended [element] note — [one sentence describing the change].
For a correction of a measurement: Amended [element] — [dimension] now recorded as [corrected value].
For a contextual note: Noted as context — [one line].
For a question: [Direct answer from session state. Do not fabricate.]
For an unresolved note: Note saved. Allocation uncertain — may belong under [best guess section 1] or [best guess section 2].

Return structured JSON:
{
  "response": "The one-line acknowledgement shown to the surveyor.",
  "note_type": "observation|room_change|amendment|addition|contextual|site_note|question|unresolved",
  "section": "Section name or null",
  "section_action": "remain|create|contextual|provisional",
  "target_observation_id": "obs-xxx or null",
  "correction_mode": "replace|supplement|qualify|correct_measurement|correct_location|withdraw|null",
  "final_observation": "Final reconciled observation text if this is an amendment, else null",
  "observation_id": "obs-xxx assigned to this new observation or null"
}

Return only valid JSON. No commentary outside the JSON.`;

// ── System prompt fragment for generate-soc (final generation) ───────────
const GENERATOR_SYSTEM_PROMPT = `You are a Senior Chartered Building Surveyor and Party Wall Surveyor.
Return valid JSON only. No markdown. No commentary. No code fences.
Convert raw dictated Schedule of Condition notes into professional structured JSON.
Do not invent observations. Reconcile all amendments. Record every distinct observation.
Do not silently omit any note. Separate condition observations from award notes and actions.`;



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
      const subject = email.subject || `Schedule of Condition -- ${projectMeta.bo_address || ''}`;
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
    const subject = emails[0].subject || `Schedule of Condition -- outstanding matters -- ${projectMeta.bo_address || ''}`;
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

function disputeIntroductionPlaceholder(projectMeta = {}) {
  // For dispute SOCs the introduction is generated by the AI from the surveyor's context notes.
  // This placeholder is replaced by the AI-generated introduction at drafting time.
  return '__AI_GENERATED_INTRODUCTION__';
}

function renderSocContent(data = {}, config = {}, projectMeta = {}) {
  const UNCLEAR_CSS = '<style>.cell-obs-unclear{background:#fff3f3!important;border-left:4px solid #cc0000!important;padding:8px 12px;vertical-align:top;line-height:1.6;border:1px solid #c8c8c8}.unclear-label{color:#cc0000;font-weight:700;font-size:10pt;display:block;margin-bottom:5px}</style>';
  const aoAddressText = projectMeta.ao_address || data.ao_address || '';
  const boAddress = projectMeta.bo_address || data.bo_address || '';
  const inspDate = projectMeta.inspection_date || data.inspection_date || '';
  const proposedWorks = projectMeta.proposed_works || data.proposed_works || '';
  const preparedBy = projectMeta.prepared_by || data.prepared_by || '';
  const photoRecord =
    projectMeta.photo_record ||
    data.photo_record ||
    'Photographic thumbnails are not appended to this schedule with the originals saved on file.';

  const introduction = projectMeta.soc_type === 'dispute'
    ? (data.introduction || disputeIntroductionPlaceholder(projectMeta))
    : fixedIntroduction(projectMeta);
  const sections = normaliseSections(data.sections || []);
  const discussion = (data.discussion || data.discussion_items || []).filter(
    (item) => item && (item.item || item.title || item.body || item.description || (typeof item === 'string' && item.trim()))
  );
  const generalNotes = (data.general_notes || [])
    .map(n => typeof n === 'string' ? n : (n?.note || n?.text || n?.description || n?.content || JSON.stringify(n)))
    .filter(Boolean);
  const crackClass = data.crack_classification || config.crack_classification || [
    { width: 'Up to 0.1mm', expression: 'Hairline' },
    { width: '0.1mm to 1.0mm', expression: 'Very Slight' },
    { width: '1.1mm to 5.0mm', expression: 'Slight' },
    { width: '5.1mm to 15mm', expression: 'Moderate' },
    { width: '15.1mm to 25mm', expression: 'Severe' },
  ];

  let html = UNCLEAR_CSS +
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
        (() => {
          const obs = row.observation || '';
          const isUnclear = obs.startsWith('[UNCLEAR:');
          const cleanObs = isUnclear ? obs.replace(/^\[UNCLEAR:[^\]]*\]\s*/, '') : obs;
          const label = isUnclear ? '<span class="unclear-label">⚠ NEEDS REVIEW — dictation unclear, please confirm before finalising</span>' : '';
          return `<td class="${isUnclear ? 'cell-obs-unclear' : 'cell-obs'}">${label}${esc(cleanObs)}</td>`;
        })() +
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

  const awardNotes = (data.site_notes || data.award_notes || []).filter(n => n && (n.description || n.topic));
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

SECTION DECLARATION RULE: Where the surveyor says "starting the schedule of conditions in [X]", "starting in [X]", "I am in [X]", "moving to [X]", "continuing in [X]" — the section name is exactly [X] and any words spoken BEFORE that phrase in the same sentence are false starts and must be ignored. Example: "Starting the extension, starting the schedule of conditions in the ground floor rear outrigger" — the section is "Ground Floor Rear Outrigger". The word "extension" before the declaration is a false start and must be discarded.

CARRY-FORWARD RULE: Once a section is established — either explicitly declared or inferred from content — assign all subsequent notes to that same section until a clear break occurs. A break is only: (a) an explicit new room or area declaration; (b) content that is physically incompatible with the current section (e.g. external features such as patio, driveway, brickwork when currently recording an internal room); or (c) a surveyor instruction to reassign earlier notes (e.g. "the last two notes were in the bathroom"). Do NOT classify a note as unresolved or unallocated solely because it does not name a section — it must inherit the current active section context.

RETROACTIVE REASSIGNMENT: Where the surveyor says "the last [N] notes were in [room]", "those last notes were [room]", or similar — reassign those notes to the named section retroactively before finalising all section assignments.

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
weathered grout → deteriorated grout,
outrigger → Ground Floor Rear Outrigger (where it refers to a rear addition/extension to the main body of the house),
UPBC → UPVC.

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
  "site_notes": [
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
function validateSocJson(parsed) {
  // Auto-populate optional fields that the new pipeline may omit
  const optionalArrays = ['discussion', 'general_notes', 'actions', 'site_notes', 'award_notes', 'emails_required', 'unresolved_notes'];
  for (const key of optionalArrays) {
    if (!(key in parsed) || !Array.isArray(parsed[key])) parsed[key] = [];
  }
  // Only sections is truly required
  const requiredArrays = ['sections'];
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
          console.warn(`[generate-soc] ${rLabel} has no action -- defaulting to "Record only"`);
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

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 3: DRAFTING QUALITY AUDIT — handled entirely in soc-pipeline.js
// runQualityAudit reviews wording quality and factual/measurement fidelity
// against FEW_SHOT_EXAMPLES, using gpt-5.6-sol.
// ═══════════════════════════════════════════════════════════════════════════
// FEW_SHOT_EXAMPLES gold-standard reference. See that file.


function runCodedFidelityChecks(draftedResult, claims) {
  if (!claims?.length) return { issues: [], warnings: [] };

  const issues = [];
  const warnings = [];
  const claimMap = {};
  for (const c of claims) claimMap[c.claim_id] = c;

  for (const section of (draftedResult.sections || [])) {
    for (const row of (section.rows || [])) {
      const sourceClaims = (row.source_claim_ids || []).map(id => claimMap[id]).filter(Boolean);
      if (sourceClaims.length === 0 && (row.source_note_ids || []).length > 0) {
        warnings.push(`Row ${row.ref}: has source_note_ids but no source_claim_ids -- claim traceability incomplete.`);
        continue;
      }

      const obs = (row.observation || '').toLowerCase();

      // Check for superseded wording surviving
      const supersededClaims = sourceClaims.filter(c => c.status === 'superseded');
      for (const sc of supersededClaims) {
        warnings.push(`Row ${row.ref}: includes superseded claim ${sc.claim_id} ("${sc.content?.slice(0, 60)}") -- check it has been correctly replaced.`);
      }

      // Check measurements not altered
      const activeClaims = sourceClaims.filter(c => c.status === 'active');
      for (const c of activeClaims) {
        // Extract numbers from claim content
        const claimNums = (c.content || '').match(/\d+\s*mm|\d+\s*m\b|\d+00mm/gi) || [];
        for (const num of claimNums) {
          if (!obs.includes(num.toLowerCase())) {
            issues.push(`Row ${row.ref}: measurement "${num}" from claim ${c.claim_id} may not appear in final observation.`);
          }
        }
      }

      // Check for unsupported causation/structural conclusions
      if (/(caused by|due to|result of|structural|movement|settlement|subsidence|heave)/i.test(row.observation || '')) {
        const hasCausation = activeClaims.some(c =>
          /(caused|structural|movement|settlement|subsidence|heave)/i.test(c.content || '')
        );
        if (!hasCausation) {
          issues.push(`Row ${row.ref}: contains potential unsupported causation or structural conclusion not in source claims.`);
        }
      }
    }
  }

  return { issues, warnings };
}


// ── Main pipeline orchestrator ────────────────────────────────────────────────
// Calls shared soc-pipeline.js functions in sequence.
// Uses live persisted claims from DB if available; otherwise runs Stage 1 extraction.
async function extractStructuredData(message, projectMeta, apiKey, sessionId, projectId, aoId) {
  // Load live claims from DB first — unless forceReextract is set
  let claims = [];
  let claimsFromLive = false;
  const forceReextract = projectMeta?.forceReextract === true;
  if (sessionId && !forceReextract) {
    try {
      const { data: liveClaims } = await supabase
        .from('soc_claims')
        .select('*')
        .eq('session_id', sessionId)
        .order('note_sequence', { ascending: true })   // numeric integer column
        .order('claim_sequence', { ascending: true });  // numeric integer column
      if (liveClaims?.length) { claims = liveClaims; claimsFromLive = true; }
    } catch (e) { console.warn('[generate-soc] Could not load live claims:', e.message); }
  }
  if (forceReextract && sessionId) {
    // Delete cached claims so Stage 1 runs fresh with updated STT corrections
    try {
      await supabase.from('soc_claims').delete().eq('session_id', sessionId);
      console.log('[generate-soc] Cleared cached claims for fresh extraction');
    } catch (e) { console.warn('[generate-soc] Could not clear claims:', e.message); }
  }

  // Stage 1: Extract if no live claims
  if (!claimsFromLive) {
    console.log('[generate-soc] Stage 1: extracting claims...');
    try {
      claims = await extractAtomicClaims(message, apiKey);
    } catch (e) {
      console.warn('[generate-soc] Stage 1 failed:', e.message);
    }
    if (!claims.length) throw new Error('GENERATION_INCOMPLETE: No claims extracted. Please retry.');
  }
  console.log(`[generate-soc] ${claimsFromLive ? 'Loaded' : 'Extracted'} ${claims.length} claims`);

  // Stage 2: Professional drafting (section-batched)
  console.log('[generate-soc] Stage 2: drafting...');
  let draftedResult;
  let draftMeta = {};
  try {
    const socDraftModel = process.env.SOC_DRAFT_MODEL || 'gpt-5.6-terra';
    // Build rawNotesBySeq map so drafting model can read original context
    const rawNoteLines = (message || '').split(/\n+/).filter(l => l.trim());
    const rawNotesBySeq = {};
    for (const line of rawNoteLines) {
      const m = line.match(/^\[(\d+)\]\s*(.*)/s);
      if (m) rawNotesBySeq[parseInt(m[1])] = m[2].trim();
    }
    const draft = await draftFromClaims(claims, projectMeta, apiKey, socDraftModel, rawNotesBySeq);
    if (draft?._drafting_metadata) {
      draftMeta = draft._drafting_metadata;
      delete draft._drafting_metadata;
    }
    // Validate the draft has usable sections before accepting it
    if (draft && Array.isArray(draft.sections) && draft.sections.length > 0) {
      draftedResult = draft;
    } else {
      console.warn('[generate-soc] Stage 2 returned no sections — treating as failure');
    }
  } catch (e) {
    console.warn('[generate-soc] Stage 2 failed:', e.message);
  }

  // Emergency fallback if stage 2 failed
  if (!draftedResult) {
    console.warn('[generate-soc] Emergency fallback — single stage');
    try {
      const userPrompt = SOC_GENERATOR_PROMPT
        .replace('{{BO_ADDRESS}}', projectMeta.bo_address || '')
        .replace('{{AO_ADDRESS}}', projectMeta.ao_address || '')
        .replace('{{INSPECTION_DATE}}', projectMeta.inspection_date || 'DATE OF INSPECTION NOT RECORDED — PLEASE CONFIRM')
        .replace('{{PROPOSED_WORKS}}', projectMeta.proposed_works || '')
        .replace('{{RAW_NOTES}}', message);
      const fbRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5.6-terra', max_completion_tokens: 8000,
          messages: [{ role: 'system', content: GENERATOR_SYSTEM_PROMPT }, { role: 'user', content: userPrompt }] }),
      });
      if (fbRes.ok) {
        const fbData = await fbRes.json();
        draftedResult = parseJsonFromModel(fbData.choices?.[0]?.message?.content || '');
        draftedResult._emergency_draft = true;
      }
    } catch {}
    if (!draftedResult) throw new Error('GENERATION_INCOMPLETE: All stages failed.');
  }

  // Stage 3: Quality audit (Sol) — checks Terra's draft against the same gold-standard
  // examples Terra drafted from, upgrades wording, flags factual issues.
  const useV1Standard = (typeof process !== 'undefined' && process.env.USE_SOC_MASTER_V1 === 'true');
  let qualityResult = draftedResult;
  try {
    console.log('[generate-soc] Stage 3: quality audit (Sol)...');
    qualityResult = await runQualityAudit(draftedResult, apiKey, useV1Standard);
  } catch (e) {
    console.warn('[generate-soc] Stage 3 (quality audit) failed, using unaudited draft:', e.message);
    qualityResult = draftedResult;
  }

  try {
    validateSocJson(qualityResult);
  } catch (validErr) {
    console.warn('[generate-soc] Validation failed:', validErr.message);
    throw new Error('GENERATION_INCOMPLETE: ' + validErr.message + ' — please retry generation.');
  }

  // Assign stable row IDs
  for (const s of (qualityResult.sections || []))
    for (const r of (s.rows || []))
      if (!r.row_id) r.row_id = `row-${s.number || 0}-${r.ref}-${Date.now()}`;

  // Lightweight coded-only completeness audit (no GPT call)
  const audit = runCompletenessAudit(qualityResult, claims);
  const fidelity = { issues: [], warnings: [] };

  // Persist extracted claims (inline — persistClaimsToDb moved to lib)
  if (!claimsFromLive && claims.length && sessionId) {
    const claimRows = claims.map(cl => ({
      session_id: sessionId, project_id: projectId || null, ao_id: aoId || null,
      claim_id: cl.claim_id, source_note_id: cl.source_note_id || cl.note_sequence || 0,
      note_sequence: cl.note_sequence || cl.source_note_id || 0,
      sequence: cl.claim_sequence || cl.sequence || 1,
      claim_sequence: cl.claim_sequence || cl.sequence || 1,
      claim_type: cl.claim_type || 'unresolved', section: cl.section || null,
      element: cl.element || null, location: cl.location || null,
      content: cl.content || '', confidence: cl.confidence || 'high',
      status: cl.status || 'active', amendment_mode: cl.amendment_mode || null,
    }));
    (async () => { try { await supabase.from('soc_claims').insert(claimRows); } catch {} })();
  }

  // Update claim destinations (inline)
  if (sessionId && qualityResult?.sections) {
    const updates = [];
    for (const s of qualityResult.sections)
      for (const r of (s.rows || []))
        for (const cid of (r.source_claim_ids || []))
          updates.push({ claim_id: cid, destination_type: 'soc_row', destination_id: r.row_id || r.ref });
    for (const u of updates)
      supabase.from('soc_claims').update({ destination_type: u.destination_type, destination_id: u.destination_id, represented: true })
        .eq('session_id', sessionId).eq('claim_id', u.claim_id).then(null, () => {});
  }

  const status = draftedResult._emergency_draft ? 'emergency_draft'
    : (audit.issues.length || fidelity.issues.length) ? 'quality_flagged' : 'complete';

  return {
    sections:         qualityResult.sections,
    discussion:       qualityResult.discussion,
    general_notes:    qualityResult.general_notes,
    actions:          qualityResult.actions,
    site_notes:       qualityResult.site_notes || qualityResult.award_notes,
    emails_required:  qualityResult.emails_required,
    unresolved_notes: qualityResult.unresolved_notes || [],
    audit_issues:     [...audit.issues, ...fidelity.issues],
    audit_warnings:   [...audit.warnings, ...fidelity.warnings],
    claims_extracted: claims.length,
    claims_from_live: claimsFromLive,
    generation_status: status,
    drafting_model: draftMeta.drafting_model || 'gpt-5.6-terra',
    drafting_model_key: draftMeta.model_key || 'gpt4o',
    drafting_latency_ms: draftMeta.total_latency_ms || 0,
    drafting_tokens: { input: draftMeta.total_input_tokens || 0, output: draftMeta.total_output_tokens || 0, reasoning: draftMeta.total_reasoning_tokens || 0 },
    generation_stages: {
      claim_source:    claimsFromLive ? 'live_session' : 'extracted_at_generate',
      claim_count:     claims.length,
      stage1_complete: claims.length > 0,
      stage2_complete: !draftedResult._emergency_draft,
      stage3_complete: true,
      stage4_complete: true,
      emergency_draft: !!draftedResult._emergency_draft,
    },
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

  return 'DATE OF INSPECTION NOT RECORDED — PLEASE CONFIRM';
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
      soc_type,
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
      soc_type: soc_type || 'general',
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

    // ── Fast path: if edited data provided, render directly without regenerating ──
    if (final_soc_data && final_soc_data.sections) {
      const config = template.renderer_config || {};
      const htmlTemplate = template.html_template || '<!DOCTYPE html><html><body>{{SOC_CONTENT}}</body></html>';
      const renderData = {
        ...final_soc_data,
        introduction: fixedIntroduction(projectMeta),
        ao_address: projectMeta.ao_address || final_soc_data.ao_address || '',
        bo_address: projectMeta.bo_address || final_soc_data.bo_address || '',
        inspection_date: projectMeta.inspection_date || final_soc_data.inspection_date || '',
        proposed_works: projectMeta.proposed_works || final_soc_data.proposed_works || '',
        prepared_by: projectMeta.prepared_by || final_soc_data.prepared_by || '',
        sections: normaliseSections(final_soc_data.sections),
        site_notes: Array.isArray(final_soc_data.site_notes) ? final_soc_data.site_notes : [],
        actions: Array.isArray(final_soc_data.actions) ? final_soc_data.actions : [],
        emails_required: Array.isArray(final_soc_data.emails_required) ? final_soc_data.emails_required : [],
      };
      const renderedContent = renderSocContent(renderData, config, projectMeta);
      const preview_html = htmlTemplate.replace('{{SOC_CONTENT}}', renderedContent);
      // Save the updated canonical SOC data and regenerated preview so the saved report
      // stays consistent after QA Review Mode or manual edit re-renders.
      if (final_soc_data.report_id) {
        try {
          await supabase.rpc('save_soc_structured_data', {
            report_id: final_soc_data.report_id,
            structured_data: renderData,
          });
          await supabase.rpc('save_soc_preview', {
            report_id: final_soc_data.report_id,
            session_id: final_soc_data.session_id || session_id || null,
            content_html: preview_html,
          });
        } catch (saveError) {
          console.warn('[generate-soc] final_soc_data save warning:', saveError.message);
        }
      }
      return res.status(200).json({ preview_html, structured_data: renderData, report_id: final_soc_data.report_id || null });
    }

    if (!dataForRender) {
      let notesText = message || '';

      if (session_id) {
        // Read from ai_messages (soc surface) — where notes now save
        const { data: sessionNotes, error: notesError } = await supabase
          .from('ai_messages')
          .select('id, content, created_at')
          .eq('session_id', session_id)
          .eq('surface', 'soc')
          .eq('role', 'user')
          .order('created_at', { ascending: true });
        if (!notesError && sessionNotes?.length) {
          notesText = sessionNotes.map((n, i) => `[${i + 1}] ${n.content}`).join('\n\n');
        }
      }

      if (!notesText || !String(notesText).trim()) {
        return res.status(400).json({ error: 'Missing message or structured SOC data' });
      }

      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: 'Missing OpenAI API key' });
      }

      // Pass forceReextract=true on regenerate so cached claims are cleared
      // and Stage 1 runs fresh with latest STT corrections
      const isRegenerate = (req.body?.action === 'regenerate') || (req.body?.force_reextract === true);
      const projectMetaWithFlag = { ...projectMeta, forceReextract: isRegenerate };

      try {
        dataForRender = await extractStructuredData(notesText, projectMetaWithFlag, apiKey, session_id, project_id, ao_id);
      } catch (genErr) {
        if (genErr.message?.startsWith('GENERATION_INCOMPLETE')) {
          // Return structured incomplete response — client shows warning + retry
          return res.status(200).json({
            generation_status: 'incomplete',
            warning: genErr.message,
            preview_html: null,
            structured_data: null,
            unresolved_notes: [],
            audit_issues: [genErr.message],
            audit_warnings: [],
          });
        }
        throw genErr; // re-throw unexpected errors
      }
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
      site_notes: Array.isArray(dataForRender.site_notes) ? dataForRender.site_notes : [],
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
      const chatTitle = `SOC Notes${aoLabel ? ' - ' + aoLabel : ''} - ${today}`;

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
      site_notes: dataForRender.site_notes || dataForRender.award_notes,
      emails_required: dataForRender.emails_required,
    });
  } catch (err) {
    console.error('[generate-soc] fatal error:', err);

    return res.status(500).json({
      error: err.message || 'SOC generation failed',
    });
  }
}



