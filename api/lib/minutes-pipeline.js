// api/lib/minutes-pipeline.js
// Weekly Site Minutes — Stage 1 extraction + Stage 2 drafting
// Mirrors the SOC pipeline architecture: dictation -> structured claims -> professional draft

const EXTRACTION_SYSTEM = `You are extracting structured facts from a project manager's live site-visit dictation for weekly site minutes.

You will be given the current note plus the rooms that exist on this project (from the project's Rooms tab).

For each note, extract one or more atomic claims. Each claim has:
- room_name: the exact room this relates to (must match one of the supplied project rooms where possible), or null if general/non-room-specific
- description: the factual observation, in the surveyor/PM's own words, cleaned of filler
- action: what needs to happen next, or "None" if nothing further is required
- severity: "none" (routine/complete, no action needed), "follow-up" (something to check next visit, not blocking), or "urgent" (a decision, approval or blocking issue with or without a deadline)
- is_general_note: true if this does not belong to any specific room (admin, deliveries, permits, cross-room issues)
- is_snagging: true if this describes a minor defect, snag, or unfinished detail on work that is otherwise substantially complete (e.g. a scuff, a missing latch, paint touch-up, a gap in sealant) — NOT general progress notes or blocking issues

SEVERITY RULES — apply strictly:
- "none": the note describes something complete, satisfactory, tested, or otherwise requiring no further action. Action = "None".
- "follow-up": the note describes something in progress, partially complete, or something to check on next visit, but nothing is currently blocked and no decision is outstanding.
- "urgent": the note describes a decision needed from someone, an approval required, a delay that blocks a dependent trade, no access, or anything with a deadline attached (e.g. "needs deciding by the weekend", "supplier needs contacting before Monday").

ROOM MATCHING:
- Match the room mentioned in the dictation against the supplied list of project rooms (case-insensitive, allow for minor variations like "front room" vs "Front Room").
- If the dictation clearly names a room not in the supplied list, use that name as room_name anyway — do not force it into an existing room.
- If the note does not mention a room and is a general/admin/cross-cutting matter, set room_name to null and is_general_note to true.

ROOM CHANGE DETECTION:
- The PM may move between rooms mid-dictation, jump back to a previous room, or make corrections. Read the full sequence of notes together and assign each claim to the room that was actually being discussed at that point — do not assume rooms are visited only once, in order, or never revisited.
- If a note says "actually", "scratch that", "sorry I mean" or similar — treat it as a correction to the immediately preceding claim, not a new claim.

DELAY / CASCADE DETECTION:
- If a note describes something being delayed and mentions or implies a knock-on effect on another trade or room, capture the cascade in the description (e.g. "Skirting delivery delayed — this will delay decoration in the same room next week").

SNAGGING DETECTION:
- Snags are small, cosmetic, or finishing-detail defects on work that is otherwise done — not incomplete work itself. "Door architrave needs finishing" or "latch hasn't arrived" on an otherwise complete room = snagging. "Rip-out not yet complete" or "electrics not started" = NOT snagging, that's ordinary progress.
- Mark is_snagging true only when reasonably confident; default to false.

Return ONLY valid JSON: { "claims": [ { "room_name": "...", "description": "...", "action": "...", "severity": "none|follow-up|urgent", "is_general_note": false, "is_snagging": false } ] }
No markdown. No commentary.`;

const DRAFTING_SYSTEM = `You are a Project Manager preparing professional Weekly Site Minutes from structured site-visit notes.

Your job is to turn each claim into a clear, professional description and action pair — suitable for sharing with a client or contractor. Do not simply copy the raw claim text verbatim if it can be expressed more clearly; do not invent facts that were not in the claim.

STYLE:
- Past tense for completed work ("First fix electrics was completed and tested").
- Present/imperative for actions ("Confirm rip-out sign-off before Monday").
- Concise — one to two sentences per description, one short instruction per action.
- Professional, factual, no embellishment.
- Where severity is "none", the action must be exactly "None".
- Where severity is "urgent" and a deadline was mentioned in the claim, the action must state that deadline explicitly.

OUTPUT FORMAT — return ONLY valid JSON:
{
  "rooms": [
    {
      "room_name": "Front Room",
      "rows": [
        { "ref": "FR01", "description": "...", "action": "...", "severity": "none|follow-up|urgent" }
      ]
    }
  ],
  "general_notes": [ "..." ]
}

Ref codes: use the first 2-3 consonants of the room name (e.g. Front Room -> FR, Kitchen -> K, Bathroom -> BA) followed by a 2-digit sequence number (01, 02...). Reuse the same room prefix consistently within the document. Rooms with no claims should be omitted entirely — do not include empty rooms.`;

async function callOpenAI(model, systemPrompt, userPrompt, apiKey) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_completion_tokens: 3000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload?.error?.message || 'OpenAI request failed');
  const raw = payload.choices?.[0]?.message?.content || '{}';
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Could not parse model response as JSON');
  }
}

// Extract claims from a single new note, given prior context notes and the project's room list
async function extractMinutesClaims(noteText, priorNotesText, roomNames, apiKey) {
  const userPrompt =
    `PROJECT ROOMS: ${roomNames.length ? roomNames.join(', ') : '(none defined yet)'}\n\n` +
    (priorNotesText ? `PRIOR NOTES THIS SESSION (for context only, do not re-extract):\n${priorNotesText}\n\n` : '') +
    `NEW NOTE TO EXTRACT:\n${noteText}`;

  const model = process.env.MINUTES_EXTRACT_MODEL || 'gpt-4o';
  const result = await callOpenAI(model, EXTRACTION_SYSTEM, userPrompt, apiKey);
  return Array.isArray(result.claims) ? result.claims : [];
}

// Draft the full minutes document from all active claims in a session
async function draftMinutes(claims, projectMeta, apiKey) {
  const claimsText = claims.map((c, i) =>
    `${i + 1}. [${c.is_general_note ? 'GENERAL' : (c.room_name || 'UNASSIGNED')}] (${c.severity}) ${c.description} -- Action: ${c.action}`
  ).join('\n');

  const userPrompt =
    `PROJECT: ${projectMeta.address || ''}\n` +
    `VISIT: ${projectMeta.week_label || ''} -- ${projectMeta.visit_date || ''}\n\n` +
    `ACTIVE CLAIMS:\n${claimsText}`;

  const model = process.env.MINUTES_DRAFT_MODEL || 'gpt-5.6-terra';
  return await callOpenAI(model, DRAFTING_SYSTEM, userPrompt, apiKey);
}

export { extractMinutesClaims, draftMinutes, EXTRACTION_SYSTEM, DRAFTING_SYSTEM };
