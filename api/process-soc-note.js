// api/process-soc-note.js
// Receives one dictated note during a live SOC inspection.
// Saves raw note to Supabase immediately.
// Calls GPT-4o for intelligent classification, section inference, amendment detection
// and structured acknowledgement.
// Returns a meaningful response to the surveyor on site.

import {
  CORRECTION_SIGNALS,
  SECTION_KEYWORDS,
  LIVE_NOTE_SYSTEM_PROMPT,
} from './soc-framework.js';

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



const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Infer likely section from note content ────────────────────────────────
function inferSectionFromContent(note) {
  const lower = note.toLowerCase();
  for (const [section, keywords] of Object.entries(SECTION_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return section;
  }
  return null;
}

// ── Build session state summary for the GPT prompt ───────────────────────
function buildSessionState(previousNotes, observations, keywordHint = null, inheritedSection = null) {
  if (!previousNotes?.length) return 'No notes recorded yet. This is the first note.';

  const hintText = keywordHint
    ? `\n\nKEYWORD HINT (supporting only — verify with full context): Subject matter may suggest "${keywordHint}". Use only if consistent with context and physical location. Generic terms (wall, floor, window, door) in many sections must not override context.`
    : '';

  const currentSectionText = inheritedSection
    ? `CURRENT ACTIVE SECTION: ${inheritedSection}`
    : 'CURRENT ACTIVE SECTION: Not yet established.';

  const sections = [...new Set(previousNotes
    .map(n => n.current_section || n.inferred_section)
    .filter(Boolean))];

  const activeObs = observations?.filter(o => o.status === 'active') || [];

  const recentNotes = previousNotes.slice(-8).map(n =>
    `[${n.sequence}]${n.current_section ? ` (${n.current_section})` : ''} ${n.raw_note}`
  ).join('\n');

  const obsState = activeObs.slice(0, 20).map(o =>
    `  ${o.id} | ${o.section} | ${o.element || 'element unspecified'} | ${o.observation.slice(0, 100)}`
  ).join('\n');

  return `${currentSectionText}
SECTIONS VISITED: ${sections.join(', ') || 'None yet'}

RECENT NOTES (last 8):
${recentNotes}

ACTIVE OBSERVATIONS (for amendment lookup):
${obsState || '  None yet.'}${hintText}`;
}

// ── Generate a stable observation ID ─────────────────────────────────────
function makeObsId(section, sequence) {
  const prefix = (section || 'unk')
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .slice(0, 8);
  return `obs-${prefix}-${String(sequence).padStart(2, '0')}`;
}


// ── Live atomic claim extraction + persistence ────────────────────────────
// Called non-blocking after every dictated note.
// Uses gpt-4o-mini (fast, low latency for on-site use).
// Detect note complexity — escalates to gpt-4o for amendments, long notes, multi-element notes
function noteComplexity(note, noteType, isCorrection) {
  const words = note.split(/\s+/).length;
  const hasMeasurement = /\d+\s*(mm|cm|m|ft|inch)/i.test(note);
  const hasMultipleDefects = (note.match(/crack|joint|defect|stain|spall/gi) || []).length > 1;
  const hasDirections = /(left|right|upper|lower|corner|diagonal|vertical|horizontal)/i.test(note);
  if (noteType === 'amendment' || isCorrection) return 'high';
  if (words > 50 || (hasMeasurement && hasMultipleDefects) || (hasMultipleDefects && hasDirections)) return 'high';
  if (words > 25 || hasMeasurement) return 'medium';
  return 'low';
}

async function extractAndPersistClaims({
  note, sequence, session_id, project_id, ao_id,
  aiResult, finalSection, noteType, correctionMode, previousNotes,
}) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return 0;
  
  const complexity = noteComplexity(note, noteType, aiResult?.correction_mode != null);
  const model = complexity === 'high' ? 'gpt-4o' : 'gpt-4o-mini';
  const maxTokens = complexity === 'high' ? 2000 : 1000;

  // Build minimal context from recent notes
  const recentContext = (previousNotes || []).slice(-5).map(n =>
    `[${n.sequence}] (${n.current_section || 'unknown'}) ${n.raw_note}`
  ).join('\n');

  const prompt = `You are extracting atomic factual claims from a single dictated site note.

CURRENT SECTION: ${finalSection || 'Not yet established'}
NOTE TYPE: ${noteType || 'observation'}
NOTE SEQUENCE: ${sequence}

RECENT CONTEXT (last 5 notes):
${recentContext || 'None — this is an early note.'}

CURRENT RAW NOTE: "${note}"

Extract every separate fact from this note as atomic claims.
One note may contain: construction description, finish, general condition, specific defect, access limitation, operational test, section change, correction, context.

If this note is an amendment/correction, set amendment_mode and mark the corrected claim type.

For each claim:
- claim_id: "claim-${sequence}-N" (N = 1,2,3...)
- source_note_id: ${sequence}
- sequence: N
- claim_type: section_declaration|construction_description|finish_description|general_condition|specific_defect|access_limitation|operational_test|contextual|amendment|site_note|award_note|unresolved
- section: section name (carry forward if not explicitly changed)
- element: building element (party wall, ceiling, floor, window, door, etc.) or null
- location: specific location description or null
- content: the fact stated cleanly in plain English (not the raw dictation)
- confidence: high|medium|low
- status: active|superseded|contextual|unresolved
- amendment_mode: replace|supplement|qualify|correct_measurement|correct_location|withdraw|null

Return JSON only: { "claims": [...] }`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer \${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        temperature: 0.05,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: 'Extract atomic claims from a single site note. Return valid JSON only.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!res.ok) return;
    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content || '').trim()
      .replace(/^```json\n?/, '').replace(/\n?```$/, '');

    let claims;
    try { claims = JSON.parse(raw).claims; } catch { return; }
    if (!Array.isArray(claims) || claims.length === 0) return;

    // Persist claims to soc_claims
    const rows = claims.map(c => ({
      session_id,
      project_id: project_id || null,
      ao_id: ao_id || null,
      claim_id: c.claim_id || `claim-\${sequence}-\${c.sequence || 1}`,
      source_note_id: sequence,
      sequence: c.sequence || 1,
      claim_type: c.claim_type || 'unresolved',
      section: c.section || finalSection || null,
      element: c.element || null,
      location: c.location || null,
      content: c.content || note,
      confidence: c.confidence || 'high',
      status: c.status || 'active',
      amendment_mode: c.amendment_mode || null,
    }));

    const { error: insertError } = await supabase.from('soc_claims').insert(rows);
    if (insertError) throw new Error(`soc_claims insert failed: ${insertError.message}`);

    // If this is an amendment, mark prior claims as superseded
    if (noteType === 'amendment' && correctionMode === 'replace') {
      const amendedClaims = claims.filter(c => c.amendment_mode === 'replace');
      if (amendedClaims.length > 0 && finalSection) {
        // Supersede active claims for the same element in the same section from earlier notes
        const affectedElements = [...new Set(amendedClaims.map(c => c.element).filter(Boolean))];
        for (const el of affectedElements) {
          await supabase
            .from('soc_claims')
            .update({ status: 'superseded' })
            .eq('session_id', session_id)
            .eq('element', el)
            .eq('section', finalSection)
            .eq('status', 'active')
            .lt('source_note_id', sequence);
        }
      }
    }
  } catch (e) {
    throw e; // propagate so caller can log
  }
  return rows?.length || 0;
}

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', endpoint: 'process-soc-note' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { note, session_id, project_id, ao_id, resolution, force_section, source_note_index } = req.body;

  // ── Direct resolution path — when user resolves an unresolved note from the UI ─
  // This bypasses normal GPT classification and persists the resolution directly.
  if (resolution && session_id && note) {
    const UUID_RE_local = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const safeAoIdLocal = ao_id && UUID_RE_local.test(String(ao_id)) ? ao_id : null;

    const validResolutions = ['allocated', 'contextual', 'site_note', 'award_note', 'excluded'];
    if (!validResolutions.includes(resolution)) {
      return res.status(400).json({ error: 'Invalid resolution type' });
    }

    try {
      // Update the existing note status if source_note_index is provided
      if (source_note_index != null) {
        await supabase.from('soc_notes')
          .update({ note_status: resolution === 'allocated' ? 'allocated' : resolution })
          .eq('session_id', session_id)
          .eq('sequence', source_note_index);
      }

      // For 'allocated' resolution, send through professional SOC processing
      if (resolution === 'allocated' && force_section) {
        // Call GPT to produce professional observation wording
        const obsId = makeObsId(force_section, source_note_index || Date.now());
        const processPrompt = `You are a party wall surveyor writing a Schedule of Condition.
Convert this raw dictated note into a single professional Schedule of Condition observation row.
Section: ${force_section}
Raw note: "${note}"

Return JSON only: {"element": "...", "observation": "Professional SOC wording.", "action": "Record only"}`;

        let professionalObs = note;
        try {
          const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer \${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.1, max_tokens: 200,
              messages: [{ role: 'user', content: processPrompt }] }),
          });
          const gptData = await gptRes.json();
          const raw = (gptData.choices?.[0]?.message?.content || '').trim()
            .replace(/^```json\n?/, '').replace(/\n?```$/, '');
          const parsed = JSON.parse(raw);
          professionalObs = parsed.observation || note;

          // Create observation in soc_observations
          await supabase.from('soc_observations').insert({
            id: obsId, session_id,
            project_id: project_id || null, ao_id: safeAoIdLocal,
            section: force_section,
            element: parsed.element || null,
            observation: professionalObs,
            status: 'active',
            source_note_ids: source_note_index != null ? [source_note_index] : [],
          });
        } catch (gptErr) {
          // If GPT fails, insert raw note — still persists
          await supabase.from('soc_observations').insert({
            id: obsId, session_id,
            project_id: project_id || null, ao_id: safeAoIdLocal,
            section: force_section, element: null,
            observation: note, status: 'active',
            source_note_ids: source_note_index != null ? [source_note_index] : [],
          }).catch(() => {});
        }
      }

      return res.status(200).json({ ok: true, resolution, section: force_section || null });
    } catch (resErr) {
      return res.status(500).json({ error: resErr.message || 'Resolution failed' });
    }
  }

  const safeAoId = ao_id && UUID_RE.test(String(ao_id)) ? ao_id : null;

  if (!note?.trim()) return res.status(400).json({ error: 'No note provided' });
  if (!session_id)   return res.status(400).json({ error: 'No session_id provided' });

  try {
    // ── 1. Load previous notes and active observations ────────────────────
    const [{ data: previousNotes, error: notesErr }, { data: observations, error: obsErr }] =
      await Promise.all([
        supabase.from('soc_notes')
          .select('id, sequence, raw_note, current_section, inferred_section, is_correction, ai_response, note_type, observation_id')
          .eq('session_id', session_id)
          .order('sequence', { ascending: true }),
        supabase.from('soc_observations')
          .select('id, section, element, observation, status, source_note_ids')
          .eq('session_id', session_id)
          .eq('status', 'active'),
      ]);

    if (notesErr) throw notesErr;

    const sequence = (previousNotes?.length || 0) + 1;
    const isCorrection = CORRECTION_SIGNALS.some(s => note.toLowerCase().includes(s));
    // Keyword inference provides a HINT only — GPT is the primary classifier
    // Generic terms (window, floor, wall, door) must not cause incorrect allocation
    const keywordHint = inferSectionFromContent(note);
    const inheritedSection = previousNotes?.length
      ? [...previousNotes].reverse().find(n => n.current_section || n.inferred_section)
        ?.current_section || null
      : null;
    // currentSection starts as inherited; GPT will confirm, override or create new section
    const currentSection = inheritedSection;

    // ── 2. Save raw note immediately ──────────────────────────────────────
    const { error: insertError } = await supabase.from('soc_notes').insert({
      session_id,
      project_id: project_id || null,
      ao_id: safeAoId,
      sequence,
      raw_note: note.trim(),
      current_section: inheritedSection,
      inferred_section: keywordHint,
      is_correction: isCorrection,
      note_status: 'pending',
      ai_response: 'Noted.',
    });

    if (insertError) throw insertError;

    // ── 3. Call GPT-4o for intelligent classification ─────────────────────
    const sessionState = buildSessionState(previousNotes, observations, keywordHint, inheritedSection);
    const systemPrompt = LIVE_NOTE_SYSTEM_PROMPT.replace('{{SESSION_STATE}}', sessionState);

    let aiResult = null;
    let aiResponse = 'Noted.';
    let noteType = 'observation';
    let finalSection = currentSection;
    let observationId = null;
    let targetObsId = null;
    let correctionMode = null;

    try {
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          temperature: 0.1,
          max_tokens: 300,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: note },
          ],
        }),
      });

      const openaiData = await openaiRes.json();
      const rawContent = openaiData.choices?.[0]?.message?.content?.trim() || '';

      // Parse JSON response
      try {
        const jsonStr = rawContent.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
        aiResult = JSON.parse(jsonStr);
        aiResponse = aiResult.response || 'Noted.';
        noteType = aiResult.note_type || 'observation';
        correctionMode = aiResult.correction_mode || null;
        targetObsId = aiResult.target_observation_id || null;

        // Determine final section
        if (aiResult.section) {
          finalSection = aiResult.section;
        } else if (noteType === 'room_change' && aiResponse.includes('Got it')) {
          finalSection = aiResponse.replace(/\.\s*Got it\.?/i, '').trim();
        }

        // Generate observation ID for new observations
        if (['observation', 'room_change'].includes(noteType) && aiResult.section_action !== 'contextual') {
          observationId = makeObsId(finalSection, sequence);
        }

      } catch (parseErr) {
        // If JSON parse fails, use the raw text as response
        aiResponse = rawContent.split('\n')[0].slice(0, 200) || 'Noted.';
      }

    } catch (aiErr) {
      console.error('[process-soc-note] OpenAI failed — note saved with Noted.:', aiErr.message);
    }

    // ── 4. Update soc_observations — mode-specific correction behaviour ────
    try {
      const existing = targetObsId ? observations?.find(o => o.id === targetObsId) : null;

      if ((noteType === 'amendment' || noteType === 'addition') && targetObsId) {
        const mode = correctionMode || 'replace';

        if (mode === 'replace' && aiResult?.final_observation) {
          // REPLACE: supersede earlier, create corrected observation
          await supabase.from('soc_observations')
            .update({ status: 'superseded' })
            .eq('id', targetObsId).eq('session_id', session_id);
          const newObsId = makeObsId(finalSection || 'unknown', sequence);
          await supabase.from('soc_observations').insert({
            id: newObsId, session_id,
            project_id: project_id || null, ao_id: safeAoId,
            section: finalSection || existing?.section || 'Unknown',
            element: aiResult.element || existing?.element || null,
            observation: aiResult.final_observation,
            status: 'active', supersedes: [targetObsId],
            source_note_ids: [sequence],
          });
          observationId = newObsId;

        } else if (mode === 'supplement') {
          // SUPPLEMENT: add detail, retain earlier substance, no supersession
          if (existing) {
            const newText = aiResult?.final_observation
              ? existing.observation.trimEnd() + ' ' + aiResult.final_observation
              : existing.observation;
            await supabase.from('soc_observations')
              .update({ observation: newText, source_note_ids: [...(existing.source_note_ids || []), sequence] })
              .eq('id', targetObsId).eq('session_id', session_id);
            observationId = targetObsId;
          }

        } else if (mode === 'qualify' && aiResult?.final_observation) {
          // QUALIFY: update in place with reconciled qualified observation (not superseded)
          if (existing) {
            await supabase.from('soc_observations')
              .update({ observation: aiResult.final_observation, source_note_ids: [...(existing.source_note_ids || []), sequence] })
              .eq('id', targetObsId).eq('session_id', session_id);
            observationId = targetObsId;
          }

        } else if (mode === 'withdraw') {
          // WITHDRAW: mark inactive, no replacement
          await supabase.from('soc_observations')
            .update({ status: 'withdrawn' })
            .eq('id', targetObsId).eq('session_id', session_id);
          observationId = null;

        } else if ((mode === 'correct_measurement' || mode === 'correct_location') && aiResult?.final_observation && existing) {
          // CORRECT DETAIL: update only affected detail, preserve rest
          await supabase.from('soc_observations')
            .update({ observation: aiResult.final_observation, source_note_ids: [...(existing.source_note_ids || []), sequence] })
            .eq('id', targetObsId).eq('session_id', session_id);
          observationId = targetObsId;

        } else if (aiResult?.final_observation) {
          // Fallback replace
          await supabase.from('soc_observations')
            .update({ status: 'superseded' })
            .eq('id', targetObsId).eq('session_id', session_id);
          const newObsId = makeObsId(finalSection || 'unknown', sequence);
          await supabase.from('soc_observations').insert({
            id: newObsId, session_id,
            project_id: project_id || null, ao_id: safeAoId,
            section: finalSection || existing?.section || 'Unknown',
            element: aiResult.element || existing?.element || null,
            observation: aiResult.final_observation,
            status: 'active', supersedes: [targetObsId],
            source_note_ids: [sequence],
          });
          observationId = newObsId;
        }

      } else if (observationId && noteType === 'observation' && finalSection) {
        // New observation
        await supabase.from('soc_observations').insert({
          id: observationId, session_id,
          project_id: project_id || null, ao_id: safeAoId,
          section: finalSection,
          element: aiResult?.element || null,
          observation: aiResult?.final_observation || note.trim(),
          status: 'active',
          source_note_ids: [sequence],
        });
      }
    } catch (obsUpdateErr) {
      console.warn('[process-soc-note] observation update failed:', obsUpdateErr.message);
    }
    // ── 5. Determine note_status ──────────────────────────────────────────
    let noteStatus = 'allocated';
    if (noteType === 'unresolved') noteStatus = 'unresolved';
    else if (noteType === 'contextual') noteStatus = 'contextual';
    else if (noteType === 'site_note') noteStatus = 'site_note';
    else if (noteType === 'question') noteStatus = 'question';
    else if (noteType === 'amendment' || noteType === 'addition') noteStatus = 'amended';

    // ── 6. Update note record with AI results ─────────────────────────────
    await supabase.from('soc_notes')
      .update({
        ai_response: aiResponse,
        current_section: finalSection || inheritedSection,
        inferred_section: keywordHint,
        note_type: noteType,
        note_status: noteStatus,
        observation_id: observationId,
        target_observation_ids: targetObsId ? [targetObsId] : null,
        correction_mode: correctionMode,
      })
      .eq('session_id', session_id)
      .eq('sequence', sequence);


    // ── 7. Extract and persist atomic claims SYNCHRONOUSLY before acknowledging ──────
    // Acknowledgement is only returned after claims are committed to DB.
    let claimCount = 0;
    let claimError = null;
    try {
      claimCount = await extractAndPersistClaims({
        note: note.trim(),
        sequence,
        session_id,
        project_id: project_id || null,
        ao_id: safeAoId,
        aiResult,
        finalSection,
        noteType,
        correctionMode,
        previousNotes,
      });
    } catch (claimErr) {
      claimError = claimErr.message;
      console.warn('[process-soc-note] claim extraction failed for note', sequence, claimErr.message);
    }

    return res.status(200).json({
      response: aiResponse,
      sequence,
      current_section: finalSection || inheritedSection,
      inferred_section: keywordHint,
      note_type: noteType,
      note_status: noteStatus,
      observation_id: observationId,
      is_correction: isCorrection,
      claims_extracted: claimCount,
      claim_error: claimError || undefined,
    });

  } catch (err) {
    console.error('[process-soc-note] fatal error:', err.message);
    return res.status(500).json({
      error: err.message || 'Failed to process note',
      stack: err.stack?.split('\n').slice(0, 3),
    });
  }
}
