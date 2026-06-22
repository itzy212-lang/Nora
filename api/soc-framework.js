// api/soc-framework.js
// Centralised SOC terminology, correction signals, sentence templates and section inference.
// Used by: process-soc-note.js, generate-soc.js, soc-vision.js
// Update this file only — do not duplicate across routes.

// ── Correction signals ────────────────────────────────────────────────────
export const CORRECTION_SIGNALS = [
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
export const SECTION_KEYWORDS = {
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
export const SPEECH_CORRECTIONS = {
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
export const SOC_TERMINOLOGY = `
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
export const SOC_SENTENCE_TEMPLATES = `
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
export const LIVE_NOTE_SYSTEM_PROMPT = `You are assisting a party wall surveyor during a live Schedule of Condition inspection on site.

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
export const GENERATOR_SYSTEM_PROMPT = `You are a Senior Chartered Building Surveyor and Party Wall Surveyor.
Return valid JSON only. No markdown. No commentary. No code fences.
Convert raw dictated Schedule of Condition notes into professional structured JSON.
Do not invent observations. Reconcile all amendments. Record every distinct observation.
Do not silently omit any note. Separate condition observations from award notes and actions.`;
