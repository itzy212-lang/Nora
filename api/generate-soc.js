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
      const body = item.body || item.description || (typeof item === 'string' ? item : '');

      html +=
        `<tr${rowClass}>` +
        `<td class="cell-ref">${esc(label)}</td>` +
        `<td class="cell-obs" colspan="2">${title}${esc(body)}</td>` +
        '</tr>';
    });

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
You are an expert Party Wall Surveyor preparing a high-quality Schedule of Condition under the Party Wall etc. Act 1996. Always use British English spelling and terminology throughout.

You must convert raw dictated site notes into structured JSON.

IMPORTANT:
- Do not merely transcribe or lightly organise the notes.
- Interpret the notes as an experienced Party Wall Surveyor.
- Rewrite condition observations in polished, professional, surveyor-grade language suitable for inclusion in a formal Schedule of Condition.
- Preserve factual accuracy and measurements exactly.
- Do not invent defects, locations, causes or measurements.
- Do not overstate observations.
- Do not include legal conclusions inside the condition schedule unless they are part of a separate Notes / Observations section.

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
      "title": "exact dictated heading where available",
      "rows": [
        {
          "ref": "RE-01",
          "observation": "professionally drafted surveyor-grade condition observation",
          "action": "Record only"
        }
      ]
    }
  ],
  "discussion": [],
  "general_notes": [],
  "actions": [
    {
      "type": "calculation | investigation | follow_up | access | other",
      "party": "Surveyor | Building Owner | Adjoining Owner | Structural Engineer | Architect | Other",
      "description": "clear action required"
    }
  ],
  "award_notes": [
    {
      "topic": "enclosure | access | fence | horticulture | section_1_5 | security | other",
      "description": "award-relevant note"
    }
  ],
  "emails_required": [
    {
      "recipient_type": "Building Owner | Adjoining Owner | Structural Engineer | Architect | Other",
      "subject": "short email subject",
      "reason": "why the email is needed",
      "body": "professional draft email body"
    }
  ]
}

WORKED EXAMPLES — STYLE AND FORMAT REFERENCE ONLY

These examples show how raw dictated notes are transformed into professional Schedule of Condition observations. Do NOT copy any content from these examples. Apply only the writing style, structure and transformation standard to the new notes provided.

---
EXAMPLE 1 — RAW vs FINISHED (excerpt):

RAW: "There's noticeable perished brickwork on the front face of the chimney. The timber framing around the bonnet is in fairly poor condition, evidence of decay and rot and paint flaking. Open joint on the mitre running all the way through."

FINISHED: "Noticeable perished brickwork was observed to the front face of the chimney stack. The timber framing surrounding the front bonnet roof is in poor condition, exhibiting evidence of decay, rot, paint deterioration and flaking finishes. An open mitre joint is present within the timber framework, extending continuously along the joint."

RAW: "Actually, out of the bottom left corner of the left window there is a severe crack extending diagonally downwards approximately 900mm before fading away and then that has various cracks stemming away. And then it staggers into slight cracking running vertically to the top of the first brick."

FINISHED: "A significant crack extends diagonally downward from the bottom left-hand corner of the left-hand rear window for approximately 900mm before dissipating. Various subsidiary cracks branch from this defect. The crack transitions into lighter cracking adjacent to the right-hand side of the air vent and extends vertically towards the first brick course."

RAW: "The French doors open and close no issues. A bit stiff when unlocking but it does open and close fine. Handle slightly stiff. Secondary opener sticks when closing, needs to be forced. Evidence of UPVC shaving from rubbing against the frame."

FINISHED: "The French doors leading to the garden were tested and open and close satisfactorily. The locking mechanism and opening action are slightly stiff. The handle exhibits slight stiffness when operated. The secondary opening leaf sticks when closing and requires additional force. Evidence of UPVC abrasion is visible where the sash has been rubbing against the frame."

RAW: "Party wall not visible due to floor to ceiling fitted wardrobe. Lined internally. No access."

FINISHED: "The party wall is concealed behind a floor-to-ceiling fitted wardrobe installation. The fitted wardrobe is lined internally and no access was available to inspect the party wall."

---
EXAMPLE 2 — RAW vs FINISHED including site notes (excerpt):

RAW: "Most sensible option would be to demolish the full party fence wall because there would only be about 400mm left over once the demolition is done. Safer for everybody. Party wall to be rebuilt in same position. Face brick to remain on the Adjoining Owner's side."

FINISHED CONDITION: "The rear boundary is formed by an existing masonry party fence wall. The wall appears generally plumb and stable with no significant distortion observed at the time of inspection."

FINISHED SITE NOTE: "Consider demolition and reconstruction of the entire wall length rather than leaving an isolated section of approximately 400mm beyond the proposed extension. Reconstructed wall to remain in the same position with the face brick finish retained on the Adjoining Owner's side."

RAW: "Existing roof recently replaced, benefits from 25-year guarantee. To maintain the guarantee, original roofing contractor to undertake weathering works where the new flank wall ties into the existing roof membrane."

FINISHED SITE NOTE: "Existing shared rubber membrane roof is understood to benefit from a 25-year warranty. Consideration should be given to utilising the original roofing contractor for all tie-in and weathering works associated with the proposed extension."

RAW: "Grapevine present immediately adjacent to party fence wall. On reflection, likely that the vine will not survive if left in situ. Preferred option is carefully excavate and temporarily relocate. Replant on completion. Particular care due to sentimental value."

FINISHED SITE NOTE: "Existing grapevine should be considered for temporary excavation and relocation prior to demolition works, followed by reinstatement upon completion. Particular care should be taken due to the sentimental value of the planting."

RAW: "Inspection undertaken during temperatures exceeding 35 degrees. Possible thermal expansion of UPVC contributing to slight sticking."

FINISHED: "The inspection was undertaken during exceptionally warm weather conditions in excess of approximately 35°C and thermal expansion of the UPVC frame may have contributed to the minor operational resistance observed."

---
APPROVED SURVEYOR TERMINOLOGY — use these terms where appropriate:

Masonry: arris, bed joint, perpend joint, brick pier, brickwork reveal, brickwork abutment, spalled brickwork, delaminated brickwork, friable brickwork, debonded render, blown render, eroded mortar joints, fractured brick, perished brickwork, frost-damaged brickwork.

Structural: chimney breast, lintel, window header, door header, load-bearing wall, timber floor joists, purlin, bearing point.

Openings: window head, window cill, window reveal, door reveal, threshold, sill, masonry arch, fanlight.

Floors: screed finish, floor settlement, differential movement, localised undulation, shrinkage cracking, settlement-related cracking.

Ceilings: ceiling deflection, fractured plaster finish, water staining, historic staining, decorative cracking, former chimney breast outline.

Roofs: ridge tile, hip tile, lead flashing, fascia board, soffit board, parapet wall, coping detail, roof abutment.

Defects: hairline crack, settlement crack, thermal movement crack, historic movement, open mortar joint, mortar loss, debonding, delamination, spalling, fracturing, distortion, deflection, bowing, bulging, water ingress, moisture staining.

Position: abutment, junction, party wall line, head, cill, reveal, soffit, flank wall, return wall, party fence wall, coping stone, string course, parapet, masonry return, corner junction.

Approved phrases:
- "No visible defects were noted at the time of inspection."
- "The brickwork exhibits general weathering consistent with its age."
- "Evidence of mortar loss was noted to the bed and perpend joints."
- "The defect appears historic in nature."
- "No evidence of progressive movement was observed."
- "The defect is considered cosmetic in nature."
- "General wear and tear was noted throughout."
- "No sticking, binding or jamming was noted during operation."

Core rules for Schedule of Condition observations:
- The SOC sections must only contain physical condition observations and neutral inspection notes.
- Use high-end surveyor wording — precise, authoritative, and technically correct. Sound like a senior party wall surveyor with 20 years of experience.
- Every observation must be written in formal third-person language.
- Each observation must read as a single flowing professional paragraph. Combine related information into well-constructed sentences that read naturally as formal surveyor prose.
- CORRECTION SIGNALS: The notes are dictated in the field. Recognise "strike that", "scratch that", "correction", "actually", "go back", "ignore that" as signals to amend or delete the preceding observation. Where two notes about the same element contradict each other, reconcile into one accurate observation — never include both.
- For tested elements (doors, windows, gates) that operated without fault, always close with: "No sticking, binding or jamming was noted during operation."
- For sections where specific defects exist within an otherwise sound element: state overall condition first, note each specific defect, then close with "No further defects were noted to [element]."
- Contractor instructions, protection measures, and CCTV requirements must go into discussion[] — not into the physical condition rows.
- Think of the Biggin Avenue style: "The masonry party fence wall extends approximately 3.5 metres from the communal passageway before transitioning to timber fencing. The wall comprises brick piers and upper brickwork with a rendered lower panel scored to imitate blockwork." — that is the target standard.
- Avoid casual wording such as "pushing upwards", "strange appearance", "looks like", "bit", "all the way", "pretty much", "no issues".
- Replace casual wording with professional phrasing such as:
  - "appeared to exhibit upward displacement"
  - "was noted to be defective"
  - "was observed to extend"
  - "no visible defects were noted"
  - "no sticking or binding was noted during operation"
  - "the element was substantially obscured by vegetation and could not be fully inspected"
- Where a defect affects operation, state that clearly as an existing operational defect.
- Preserve measurements exactly as dictated.
- Do not diagnose cause unless explicitly dictated.
- Do not state liability or causation.

Heading and grouping rules:
- Preserve dictated room or area headings exactly where the user has clearly dictated a heading.
- A standalone heading line such as "Rear Elevation", "First Floor Landing", "Stairs", "Utility Area to Rear of Garage", "Cloakroom / WC off Utility", "Garage Roof", "Fence" or "Front Driveway / Paving" must become a section title exactly as written.
- If the user does not dictate a heading, create a sensible inspection-area heading, but do not create unnecessary micro-sections.
- Keep windows, floors, ceilings, skirtings and doors within the same room or area unless the user dictated them as separate headings.
- Section 2 must be the first dictated room or inspection area. Section 1 is added automatically by the system.

What must NOT go into normal SOC condition rows:
- reminders to the surveyor
- "I need to..."
- "we need to..."
- legal analysis
- enclosure cost discussions
- award drafting issues
- requests for structural engineer confirmation
- correspondence requirements
- access negotiation points
- square metre calculation reminders

Where these items should go:
- Put surveyor reminders and calculations in actions[].
- Put site-specific matters, access notes, methodology points, and follow-up items in award_notes[].
- Put required emails in emails_required[].
- If the user clearly wants these contextual matters retained in the SOC, include them only in a final section titled "Notes / Observations", not mixed into the physical condition sections.

Emails:
- If the notes indicate that the surveyor needs to write to, speak to, ask, confirm with, or discuss something with the Building Owner, Adjoining Owner, Structural Engineer, Architect or another party, create an emails_required[] item.
- Draft the email in the first person as the surveyor.
- Keep the email concise, professional and practical.
- Do not include an email unless the notes clearly imply one is needed.

Actions:
- Create actions[] for calculations, further checks, inspections, confirmations or follow-up work.
- Examples: calculate enclosure area, confirm wall status, request access, confirm fence ownership, obtain engineer comment.

Award notes:
- Create award_notes[] for matters arising from the inspection that are relevant to access, methodology, protection, horticulture, or any other site-specific consideration.
- Examples: enclosure, line of junction access, fence removal/reinstatement, horticultural protection, damage/replacement obligations.

Introduction:
- Leave introduction blank. The system inserts the fixed introduction separately.

Discussion / Site Notes:
- The discussion[] array is IMPORTANT. Always populate it.
- Use it for matters arising from the inspection that are relevant to the Party Wall Award, access, methodology, or further action — even if they will also appear in emails_required[] or award_notes[].
- These are notes for the surveyor and the parties — they should appear in the final SOC document.
- Examples of what goes in discussion[]:
  - matters that need to be resolved before the award is finalised
  - access or methodology points raised during inspection
  - observations about the condition that may be relevant to the award
  - questions or confirmations needed from the building owner, adjoining owner or their engineers
  - any point the surveyor would want to flag as a note to themselves or the parties
- Write each discussion item as a short professional note, one to three sentences.
- Do not leave discussion[] empty if there are any outstanding matters from the inspection.



Project context:
Adjoining Owner property: ${projectMeta.ao_address || ''}
Building Owner property: ${projectMeta.bo_address || ''}
Inspection date: ${projectMeta.inspection_date || ''}
Proposed works: ${projectMeta.proposed_works || ''}
Prepared by: ${projectMeta.prepared_by || ''}

Raw dictated notes:
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
    console.error('[generate-soc] JSON parse failed. Raw output:', raw.slice(0, 500));
    throw new Error('GPT-4o returned invalid JSON — output may have been truncated');
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
      // Pull from soc_notes if session_id provided, otherwise fall back to message
      let notesText = message || '';

      if (session_id) {
        const { data: sessionNotes, error: notesError } = await supabase
          .from('soc_notes')
          .select('sequence, raw_note, current_section')
          .eq('session_id', session_id)
          .order('sequence', { ascending: true });

        if (!notesError && sessionNotes?.length) {
          notesText = sessionNotes.map(n => {
            const section = n.current_section ? `[${n.current_section}] ` : '';
            return `${section}${n.raw_note}`;
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



