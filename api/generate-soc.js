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

These examples show how raw dictated site notes are transformed into professional Schedule of Condition observations. Do NOT copy, repeat or reference any observations, addresses, defects or details from these examples. Apply only the writing style, structure and transformation standard to the new notes provided.

---
EXAMPLE 1 — RAW DICTATED NOTES:

So on the face of the chimney breast at the front elevation, chimney breast sits over the ridge, actually, but on the front side of the chimney, there's noticeable perished brickwork.
The timber framing around the front bonnet of the roof on the adjoining owner's side is in fairly poor condition, evidence of kind of decay and rot and paint flaking.
The mitre joint between the framework that sits between the properties of the two, the adjoining owner and the building owner, there's an open joint on the mitre running all the way through.
Some cracking in the cement fillet at the front of the tiles on the bonnet where it butts the valley between the two properties.
Continuing the schedule at the rear elevation of the property, immediately out off the rear elevation is a laid patio.
The adjoining owner has a flank wall constructed of brick. It sits, according to the adjoining owner, it sits inside the boundary by about 15 centimetres on their side, so it's a wall constructed that is solely belonging to the adjoining owner.
Chimney breast face brick of the chimney on the rear elevation and partial side is evidence of perished brickwork. All chimney pots are intact.
The bottom half of the brickwork on the rear elevation have been painted. The top half is rendered with evidence of, in various locations, of cracking in the render and paint flaking and perished render in certain places.
Actually, in the out of the bottom left-hand corner of the window, of the left window, there is a severe crack extending out of the bottom left-hand corner, kind of diagonally downwards, extending approximately 900mm before fading away. And then that has various cracks stemming away from that. And then it kind of then staggers into a more slight cracking that runs down the right-hand side of the vent, running vertically to the top of the first brick.
And roughly in line with the underneath of the top opener, closest to the building owner, there is a horizontal crack in the paintwork extending from the window to the joint between the adjoining owners and the party and the building owner. And then approximately 300 millimeters to 400 millimeters below, there is a secondary horizontal crack again extending out from the window towards the party wall.
And then at the top left-hand corner of the rear window on the ground floor level, there is a crack extending out from the top left-hand corner and kind of branches away from the party wall and then spreads into multiple different cracks.
The French doors out to the garden from the dining room open and close, no issues. It's a bit stiff when unlocking and initially opening, but it does seem to open and close no issues. Handle is slightly stiff, sticks slightly when lifted. The secondary opener on the French door does stick slightly when closing, needs to be forced. Evidence of kind of shave UPVC from where it's been rubbing against the frame.
The side of the boxing for the beam separating the dining room to the lounge, there is a hairline crack in the party wall abutment of the boxing from the underneath, approximately 150 millimetres, 200 millimetres before fading away.
In the front bedroom, first floor, party wall is clad with a floor-to-ceiling fitted wardrobe. Party wall not visible or lined at the back, so there's no access to the party wall.
Multiple hairline cracks in the original coving on the wall abutting the front bedroom. Refer to photos.
Loft, partial visibility of the party wall. Areas inspected are pretty standard to lofts built of that period. Appears to be lime in force there. Pointing that has kind of perished in places. A couple of sections with what appears to be no pointing around the brickwork.

EXAMPLE 1 — FINISHED SCHEDULE OF CONDITION:

EXTERNAL - FRONT ELEVATION AND ROOF
The chimney breast is positioned over the ridge line. Noticeable perished brickwork was observed to the front face of the chimney stack.
The timber framing surrounding the front bonnet roof on the adjoining owner's side is in poor condition, exhibiting evidence of decay, rot, paint deterioration and flaking finishes.
An open mitre joint is present within the timber framework located at the junction between the adjoining owner's property and the building owner's property. The opening extends continuously along the joint.
Cracking is present within the cement fillet located to the front edge of the bonnet roof where it abuts the valley between the two properties.

EXTERNAL - REAR ELEVATION
Immediately adjoining the rear elevation is a laid patio area. The patio is generally in good condition with no visible defects noted. Moss growth is present between paving joints.
A brick flank wall is situated along the boundary area. The adjoining owner advises that the wall is positioned approximately 150mm inside their boundary and is solely owned by them.
The rear and partial flank faces of the chimney stack exhibit evidence of perished brickwork. All chimney pots were observed to be intact.
The lower section of the rear elevation brickwork has been painted. The upper section comprises rendered finishes. The render exhibits cracking, localised deterioration, paint flaking and areas of perished render.
A significant crack extends diagonally downward from the bottom left-hand corner of the left-hand rear window for approximately 900mm before dissipating. Various subsidiary cracks branch from this defect. The crack transitions into lighter cracking adjacent to the right-hand side of the air vent and extends vertically towards the first brick course.
A horizontal crack is present approximately in line with the underside of the upper opening section of the window nearest the building owner's property. The crack extends from the window area towards the party wall. A secondary horizontal crack is present approximately 300mm to 400mm below the primary crack and similarly extends from the window area towards the party wall.
A further crack extends from the top left-hand corner of the rear window opening and branches away from the party wall, developing into multiple smaller fractures.

INTERNAL - DINING ROOM
The French doors leading to the garden were tested and open and close satisfactorily. The locking mechanism and opening action are slightly stiff. The handle also exhibits slight stiffness when operated. The secondary opening leaf sticks when closing and requires additional force. Evidence of UPVC abrasion is visible where the sash has been rubbing against the frame.
A hairline crack is present at the underside of the beam boxing where it abuts the party wall. The crack extends approximately 150mm to 200mm before fading.

FIRST FLOOR FRONT BEDROOM
The party wall is concealed behind a floor-to-ceiling fitted wardrobe installation. The fitted wardrobe is lined internally and no access was available to inspect the party wall.

FIRST FLOOR REAR BEDROOM
Multiple hairline cracks are present within the original decorative coving. These defects are illustrated within the accompanying photographs.

LOFT
The party wall is partially visible within the loft space. The loft is typical of a property of this age and construction. Lime mortar construction is visible. Pointing is perished in places and isolated areas appear to contain little or no visible mortar between brickwork joints. Subject to the age and construction of the property, the loft is generally in reasonable condition.

---
EXAMPLE 2 — RAW DICTATED NOTES:

Party fence wall between the Building Owner and Adjoining Owner. Under the Act they're going to demolish and rebuild the party fence wall as a party wall. There will be a small section of party fence wall that would remain off the back of the extension. Only approximately 400mm would be left. Most sensible option would be to demolish the full party fence wall because there would only be about 400mm left over once the demolition is done. Safer for everybody if the full wall is demolished and rebuilt. Party wall to be rebuilt in the same position. Face brick to remain on the Adjoining Owner's side where the face brick of the existing party fence wall currently sits.
Building Owner currently has a downpipe on the first floor rear elevation wall. Downpipe runs down onto the shared flat roof of both extensions. Pipe then runs across the flat roof and discharges into guttering on the rear elevation of the extension. Both extensions appear to have been built at the same time. One continuous shared flat roof. Existing roof recently replaced and benefits from a 25-year guarantee. To maintain the guarantee, original roofing contractor to undertake weathering works where the new flank wall ties into the existing roof membrane. Require drawings showing finished height of new extension versus existing extension and guttering arrangements. Need to understand how shared guttering arrangement will work once extension completed. Potential solution is raised parapet continuing up to first floor level to separate the two roofs, fascia and guttering arrangements.
Demolition and rebuilding of party fence wall will require access. Need confirmation from Building Owner regarding duration of access required. Temporary timber hoarding required. Hoarding likely to run diagonally from corner of window nearest party fence wall. Approximately 900mm to 1m working area required. Temporary protection recommended to French doors and adjacent glazing during demolition. Protection can be removed once demolition works are complete. Floor protection required while hoarding remains in place.
Patio laid with paving slabs. Jointing compound missing between slabs. Open joints throughout. Various slabs settled and moved in multiple locations. Patio generally weathered and worn. No cracks noted in paving slabs.
Narrow strip between patio edge and party fence wall. Shrubbery planted along boundary. Various chimney pots being used as planters. Items will require temporary relocation during demolition and rebuilding works. Any damaged horticulture to be replaced on a like-for-like basis and equivalent maturity where reasonably practicable.
Grapevine present immediately adjacent to the party fence wall. Roots appear to run directly alongside the wall line. Originally considered temporary support against hoarding. On reflection, likely that the vine will not survive if left in situ. Preferred option is for the vine to be carefully excavated and temporarily relocated elsewhere within the garden. Vine to be replanted in its original position upon completion of the works. Particular care required due to sentimental value.
UPVC French doors with full-height glazed windows either side. Externally no visible defects noted to frames. Right-hand French door leaf tested. Opens and closes. Very slight sticking noted at lower left-hand corner against frame. Door closes fully. Locking handle operates correctly. Left-hand French door leaf tested. Very slight catching at lower right-hand corner against frame. Door remains fully operational. Inspection undertaken during temperatures exceeding approximately 35 degrees. Possible thermal expansion of UPVC frame contributing to slight sticking.
Open joint noted between coving and ceiling. Joint located in vicinity of party wall and existing rear wall. Hairline crack noted within mitred coving junction at party wall/rear elevation corner. Crack continues around corner. Extends onto party wall and rear elevation wall. Approximately 400mm long before fading. Very slight hairline crack noted slightly left of centre on existing rear elevation wall. Crack extends vertically in staggered fashion. Branches towards arch. Fades away.

EXAMPLE 2 — FINISHED SCHEDULE OF CONDITION:

EXTERNAL REAR
The rear boundary between the Building Owner's and Adjoining Owner's properties is formed by an existing masonry party fence wall. The wall appears generally plumb and stable with no significant distortion observed at the time of inspection.
Immediately adjacent to the party fence wall is a planted border containing various shrubs and planting together with several clay chimney pots utilised as planters. A mature grapevine is present adjacent to and trained against the party fence wall.
The rear garden is predominantly laid with concrete paving slabs. The pointing between the paving slabs is absent in numerous locations resulting in open joints throughout. Localised settlement and displacement of paving slabs was noted in various locations. General weathering consistent with age and external exposure was observed. No cracking was noted within the paving slabs at the time of inspection.

REAR EXTENSION
The rear elevation incorporates a set of white UPVC French doors with full-height glazed side panels. No visible defects were noted to the glazing units, UPVC frames or surrounding masonry.
Operational testing of the French doors confirmed satisfactory operation. Minor rubbing was noted to the lower left-hand corner of the right-hand opening leaf and to the lower right-hand corner of the left-hand opening leaf. The locking mechanisms operated correctly and the doors were capable of being fully secured. The inspection was undertaken during exceptionally warm weather conditions in excess of approximately 35°C and thermal expansion of the UPVC frame may have contributed to the minor operational resistance observed.
An open joint was noted between the coving and ceiling finish extending from the wall adjoining the kitchen towards the party wall and continuing towards the rear elevation wall.
A hairline crack was noted within the mitred junction of the coving at the junction between the party wall and rear elevation wall. The crack extends around the corner and continues onto the adjoining wall surfaces for approximately 400mm before dissipating.
A slight hairline crack was noted within the existing rear elevation wall positioned slightly left of centre between the party wall and the arch opening. The crack extends generally vertically before branching towards the arch opening and fading from view.

SITE NOTES
1. Existing party fence wall proposed to be demolished and reconstructed as a party wall.
2. Consider demolition and reconstruction of the entire wall length rather than leaving an isolated section of approximately 400mm beyond the proposed extension.
3. Reconstructed wall to remain in the same position as the existing wall with the face brick finish retained on the Adjoining Owner's side.
4. Building Owner to confirm the anticipated duration and extent of access required within the Adjoining Owner's property.
5. Temporary timber hoarding required during demolition and reconstruction works.
6. Temporary protection required to the French doors and adjacent glazing during demolition works.
7. Floor protection required beneath all access routes and hoarding locations.
8. Existing planting, planters and horticulture adjacent to the wall line may require temporary relocation during the works.
9. Existing grapevine should be considered for temporary excavation and relocation prior to demolition and excavation works, followed by reinstatement upon completion.
10. Any damaged horticulture to be replaced on a like-for-like basis and with equivalent maturity where reasonably practicable.
11. Building Owner to provide details of the proposed finished levels, guttering arrangements and relationship between the new extension and the existing shared roof construction.
12. Existing shared rubber membrane roof is understood to benefit from a 25-year warranty.
13. Consideration should be given to a parapet detail separating the existing shared roof arrangement.
14. Clarification required regarding proposed weathering details and protection of the existing roofing warranty.
15. Consideration should be given to utilising the original roofing contractor for all tie-in and weathering works associated with the proposed extension.
---

APPROVED SURVEYOR TERMINOLOGY — use these terms where appropriate:

Masonry/Brickwork: arris, arrises, bed joint, perpend joint, perp joint, brick pier, brickwork reveal, brickwork abutment, spalled brickwork, delaminated brickwork, friable brickwork, bulging brickwork, out-of-plumb brickwork, debonded render, blown render, localised repair, historic repair, eroded mortar joints, recessed mortar joints, fractured brick, displaced brick, loose brick, perished brickwork, weathered brickwork, frost-damaged brickwork.

Structural: chimney breast, lintel, door header, window header, load-bearing wall, timber floor joists, purlin, roof truss, bearing point, bearing wall, rolled steel beam, RSJ.

Openings/Joinery: window head, window cill, window reveal, door reveal, threshold, sill, lintel bearing, masonry arch, fanlight, door surround, window surround.

Floors: screed finish, laminate floor finish, floor settlement, differential movement, localised undulation, shrinkage cracking, settlement-related cracking, trip hazard.

Ceilings: ceiling deflection, undulating ceiling finish, sagging ceiling, former chimney breast outline visible, fractured plaster finish, water staining, historic staining, decorative cracking.

Plaster/Decorations: fractured plaster finish, debonded plaster, blown plaster, blistering paintwork, localised making good, surface blemishing, patch repair, uneven decorative finish.

Roofs: displaced roof tile, fractured roof tile, ridge tile, hip tile, verge detail, lead flashing, fascia board, soffit board, parapet wall, coping detail, roof abutment, rainwater gutter, rainwater downpipe, roofing membrane.

External: hardstanding, boundary fencing, paved patio, localised settlement, garden retaining wall, crazy paving, raised planting bed, concrete hardstanding, timber decking, soft landscaping.

Defects: hairline crack, settlement crack, thermal movement crack, differential movement, historic movement, progressive movement, open mortar joint, mortar loss, debonding, delamination, spalling, fracturing, distortion, deflection, bowing, bulging, out of plumb, water ingress, moisture staining, friable, decayed, frost-damaged.

Position/Location: abutment, junction, interface, party wall line, line of junction, head, cill, reveal, soffit, fascia, ridge, verge, flank wall, return wall, party fence wall, coping stone, string course, pier, buttress, parapet, masonry return, corner junction, external elevation, internal elevation.

Approved professional phrases:
- "No visible defects were noted at the time of inspection."
- "The brickwork exhibits general weathering consistent with its age."
- "The brick faces exhibit signs of age-related weathering."
- "The brick arrises are worn and rounded."
- "Localised spalling to the brick faces was observed."
- "Evidence of mortar loss was noted to the bed and perpend joints."
- "The pointing appears weathered and defective."
- "The brickwork remains plumb with no visible distortion."
- "A hairline crack was noted extending from the window head."
- "A stepped crack was noted within the masonry wall."
- "The defect appears historic in nature."
- "No evidence of progressive movement was observed."
- "The render finish exhibits localised cracking and debonding."
- "The paving exhibits localised settlement."
- "The defect is considered cosmetic in nature."
- "General wear and tear was noted throughout."
- "No sticking, binding or jamming was noted during operation."
- "The element was substantially obscured and could not be fully inspected."

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



