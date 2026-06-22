// api/soc-regression-test.js
// Protected regression harness for the 17 Park Avenue transcript.
// Runs the full SOC pipeline against stored notes and returns a complete audit.
// GET /api/soc-regression-test?session_id=addc4c06-5224-4141-9dea-214cd3af53b1
// POST with { session_id, force_reextract: true } to bypass cached live claims.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Known 17 Park Avenue session — the canonical regression fixture
const FIXTURE_SESSION_ID = 'addc4c06-5224-4141-9dea-214cd3af53b1';
const REGRESSION_KEY = process.env.REGRESSION_TEST_KEY || 'sq1-regression-2026';

export default async function handler(req, res) {
  // Simple protection — require key header or query param
  const key = req.headers['x-regression-key'] || req.query.key;
  if (key !== REGRESSION_KEY) {
    return res.status(401).json({ error: 'Unauthorised — provide x-regression-key header' });
  }

  const session_id = req.query.session_id || req.body?.session_id || FIXTURE_SESSION_ID;
  const forceReextract = req.query.force_reextract === 'true' || req.body?.force_reextract;

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

  const startAt = Date.now();
  const log = [];

  try {
    // ── 1. Load raw notes ──────────────────────────────────────────────────
    log.push({ stage: 'load_notes', at: 0 });
    const { data: noteRows, error: notesErr } = await supabase
      .from('ai_messages')
      .select('content, created_at, id')
      .eq('session_id', session_id)
      .eq('role', 'user')
      .order('created_at', { ascending: true });

    if (notesErr) throw new Error('Could not load notes: ' + notesErr.message);
    if (!noteRows?.length) return res.status(404).json({ error: 'No notes found for session', session_id });

    log.push({ stage: 'load_notes', note_count: noteRows.length, ms: Date.now() - startAt });
    const rawNotes = noteRows.map((n, i) => `[${i + 1}] ${n.content}`).join('\n\n');

    // ── 2. Load or extract claims ──────────────────────────────────────────
    log.push({ stage: 'claims', at: Date.now() - startAt });
    let claims = [];
    let claimsFromLive = false;

    if (!forceReextract) {
      const { data: liveClaims } = await supabase
        .from('soc_claims')
        .select('*')
        .eq('session_id', session_id)
        .order('source_note_id', { ascending: true })
        .order('sequence', { ascending: true });
      if (liveClaims?.length) {
        claims = liveClaims;
        claimsFromLive = true;
        log.push({ stage: 'claims', source: 'live_session', count: claims.length, ms: Date.now() - startAt });
      }
    }

    if (!claims.length) {
      log.push({ stage: 'claims', source: 'extracting', ms: Date.now() - startAt });
      claims = await extractWithBatching(rawNotes, OPENAI_KEY);
      log.push({ stage: 'claims', source: 'extracted', count: claims.length, ms: Date.now() - startAt });
    }

    // ── 3. Professional drafting ───────────────────────────────────────────
    log.push({ stage: 'drafting', at: Date.now() - startAt });
    const draftedResult = await draftFromClaims(claims, OPENAI_KEY);
    log.push({ stage: 'drafting', sections: draftedResult.sections?.length, ms: Date.now() - startAt });

    // ── 4. Quality audit ──────────────────────────────────────────────────
    log.push({ stage: 'quality_audit', at: Date.now() - startAt });
    const improvedResult = await runQualityAuditBatched(draftedResult, OPENAI_KEY);
    log.push({ stage: 'quality_audit', ms: Date.now() - startAt });

    // ── 5. Fidelity audit ─────────────────────────────────────────────────
    log.push({ stage: 'fidelity', at: Date.now() - startAt });
    const fidelityResult = await runSemanticFidelityBatched(improvedResult, claims, OPENAI_KEY);
    log.push({ stage: 'fidelity', issues: fidelityResult.issues.length, ms: Date.now() - startAt });

    // ── 6. Completeness audit ─────────────────────────────────────────────
    const activeClaims = claims.filter(c => c.status === 'active');
    const claimIdsInRows = new Set();
    for (const s of (improvedResult.sections || [])) {
      for (const r of (s.rows || [])) {
        for (const cid of (r.source_claim_ids || [])) claimIdsInRows.add(cid);
      }
    }
    const missingClaims = activeClaims.filter(c => !claimIdsInRows.has(c.claim_id));
    const completenessRate = activeClaims.length > 0
      ? ((activeClaims.length - missingClaims.length) / activeClaims.length * 100).toFixed(1)
      : '100.0';

    // ── 7. Build response ─────────────────────────────────────────────────
    const totalMs = Date.now() - startAt;
    return res.status(200).json({
      regression_fixture: session_id === FIXTURE_SESSION_ID ? '17_park_avenue' : session_id,
      session_id,
      total_ms: totalMs,
      pipeline_log: log,
      claims_source: claimsFromLive ? 'live_session' : 'extracted_at_regression',
      // All extracted claims
      claims: claims.map(c => ({
        claim_id: c.claim_id,
        source_note_id: c.source_note_id,
        claim_type: c.claim_type,
        section: c.section,
        element: c.element,
        location: c.location,
        content: c.content,
        status: c.status,
        amendment_mode: c.amendment_mode,
        superseded_by: c.superseded_by,
        destination_type: c.destination_type,
      })),
      // Final SOC sections
      sections: improvedResult.sections,
      unresolved_notes: improvedResult.unresolved_notes || [],
      general_notes: improvedResult.general_notes || [],
      award_notes: improvedResult.award_notes || [],
      // Audits
      completeness: {
        active_claims: activeClaims.length,
        accounted_for: activeClaims.length - missingClaims.length,
        missing_claims: missingClaims.map(c => ({ id: c.claim_id, type: c.claim_type, content: c.content?.slice(0, 80) })),
        rate_percent: completenessRate,
        passed: missingClaims.filter(c => !['contextual','site_note','section_declaration'].includes(c.claim_type)).length === 0,
      },
      fidelity: fidelityResult,
      // Acceptance criteria check
      acceptance: {
        all_sections_present: checkRequiredSections(improvedResult),
        first_floor_front_elevation_present: (improvedResult.sections || []).some(s =>
          /first.*floor.*front|front.*elevation.*room/i.test(s.title || '')),
        intermittent_not_in_500mm_crack: !JSON.stringify(improvedResult.sections || []).includes('intermittent') ||
          !JSON.stringify(improvedResult.sections || []).match(/intermittent.*500|500.*intermittent/i),
        no_unsupported_facts: fidelityResult.issues.length === 0,
        completeness_100_percent: missingClaims.filter(c =>
          !['contextual','site_note','section_declaration'].includes(c.claim_type)).length === 0,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, log, ms: Date.now() - startAt });
  }
}

function checkRequiredSections(result) {
  const titles = (result.sections || []).map(s => (s.title || '').toLowerCase());
  const required = ['front elevation', 'rear elevation', 'rear extension', 'rear bedroom', 'front elevation room'];
  return required.map(r => ({ section: r, found: titles.some(t => t.includes(r.split(' ')[0])) }));
}

async function extractWithBatching(rawNotes, apiKey) {
  const lines = rawNotes.split(/\n+/).filter(l => l.trim());
  const BATCH = 20;
  if (lines.length <= BATCH) return extractBatch(rawNotes, apiKey, null);
  let allClaims = [], currentSection = null;
  for (let i = 0; i < lines.length; i += BATCH) {
    const batchText = (currentSection ? `CURRENT SECTION: ${currentSection}\n\n` : '') +
      lines.slice(i, i + BATCH).join('\n');
    const batchClaims = await extractBatch(batchText, apiKey, currentSection);
    const last = batchClaims.filter(c => c.section).slice(-1)[0];
    if (last) currentSection = last.section;
    allClaims = allClaims.concat(batchClaims);
  }
  return allClaims;
}

async function extractBatch(notes, apiKey, currentSection) {
  const prompt = `Extract every atomic factual claim from these site notes. One note may contain many claims.
Section carry-forward: current section is "${currentSection || 'not yet established'}".
Amendment handling: mark superseded claims, create corrected active claim.
Return JSON only: { "claims": [{ "claim_id": "c-N", "source_note_id": N, "sequence": N, "claim_type": "...", "section": "...", "element": "...", "location": "...", "content": "...", "confidence": "high|medium|low", "status": "active|superseded|contextual|unresolved", "superseded_by": null, "amendment_mode": null }] }
NOTES:\n${notes}`;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o', temperature: 0.05, max_tokens: 6000,
      messages: [{ role: 'system', content: 'Extract atomic claims. Return valid JSON only.' }, { role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`OpenAI claim extraction: ${res.status}`);
  const data = await res.json();
  try { return JSON.parse((data.choices?.[0]?.message?.content || '{}').replace(/```json\n?|\n?```/g, '')).claims || []; }
  catch { return []; }
}

async function draftFromClaims(claims, apiKey) {
  const claimsBySection = {};
  for (const c of claims) {
    const s = c.section || 'Unallocated';
    if (!claimsBySection[s]) claimsBySection[s] = [];
    claimsBySection[s].push(c);
  }
  const claimsSummary = Object.entries(claimsBySection).map(([sec, cls]) =>
    `SECTION: ${sec}\n` + cls.map(c => `  [${c.claim_id}] ${c.claim_type} status=${c.status}: ${c.content}`).join('\n')
  ).join('\n\n');

  const prompt = `You are a Senior Chartered Party Wall Surveyor. Write a professional Schedule of Conditions from these reconciled claims.
CRITICAL: You are NOT transcribing. Write from first principles. Preserve every fact, measurement, location, direction exactly.
Every active claim must appear. Group related claims. Keep specific defects separate.
Return JSON: { "sections": [{ "number": N, "title": "...", "rows": [{ "ref": "XX01", "element": "...", "observation": "Professional wording.", "action": "Record only", "source_note_ids": [], "source_claim_ids": ["c-N"] }] }], "general_notes": [], "award_notes": [], "unresolved_notes": [] }
CLAIMS:\n${claimsSummary}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o', temperature: 0.1, max_tokens: 10000,
      messages: [{ role: 'system', content: 'Senior Party Wall Surveyor. Return valid JSON only.' }, { role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`OpenAI drafting: ${res.status}`);
  const data = await res.json();
  try { return JSON.parse((data.choices?.[0]?.message?.content || '{}').replace(/```json\n?|\n?```/g, '')); }
  catch { throw new Error('Drafting returned invalid JSON'); }
}

async function runQualityAuditBatched(result, apiKey) {
  const BATCH = 15;
  const rows = [];
  for (const s of (result.sections || [])) for (const r of (s.rows || [])) rows.push({ ref: r.ref, section: s.title, observation: r.observation });
  if (!rows.length) return result;
  const corrected = {};
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const prompt = `Review these SOC observations. Auto-fix: speech-to-text residue, grammar, "good condition" → "no visible defects noted at the time of inspection". Flag (flagged:true): over-compression, unsupported facts.
Return JSON: { "rows": [{ "ref": "...", "observation": "...", "flagged": false, "flag_reason": null }] }
ROWS: ${JSON.stringify(batch)}`;
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', temperature: 0.1, max_tokens: 3000,
          messages: [{ role: 'system', content: 'Return valid JSON only.' }, { role: 'user', content: prompt }] }),
      });
      const d = await res.json();
      const parsed = JSON.parse((d.choices?.[0]?.message?.content || '{}').replace(/```json\n?|\n?```/g, ''));
      for (const r of (parsed?.rows || [])) corrected[r.ref] = r;
    } catch {}
  }
  const improved = JSON.parse(JSON.stringify(result));
  for (const s of (improved.sections || [])) for (const r of (s.rows || [])) {
    if (corrected[r.ref]) { r.observation = corrected[r.ref].observation || r.observation; if (corrected[r.ref].flagged) { r.flagged = true; r.flag_reason = corrected[r.ref].flag_reason; } }
  }
  return improved;
}

async function runSemanticFidelityBatched(result, claims, apiKey) {
  const claimMap = {};
  for (const c of claims) claimMap[c.claim_id] = c;
  const rowsToCheck = [];
  for (const s of (result.sections || [])) for (const r of (s.rows || [])) {
    const src = (r.source_claim_ids || []).map(id => claimMap[id]).filter(Boolean);
    if (src.some(c => /\d+(mm|m\b)/i.test(c?.content || '') || c?.claim_type === 'amendment')) {
      rowsToCheck.push({ ref: r.ref, observation: r.observation, source_claims: src.map(c => ({ id: c.claim_id, content: c.content, status: c.status })) });
    }
  }
  if (!rowsToCheck.length) return { issues: [], warnings: [] };
  const allIssues = [], allWarnings = [];
  for (let i = 0; i < rowsToCheck.length; i += 10) {
    const batch = rowsToCheck.slice(i, i + 10);
    const prompt = `Audit observations for factual fidelity against source claims. Check measurements, directions, locations unchanged. Amendments applied. No unsupported facts.
Return JSON: { "issues": ["Row XX: ..."], "warnings": [...] }
DATA: ${JSON.stringify(batch)}`;
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', temperature: 0.05, max_tokens: 1500,
          messages: [{ role: 'system', content: 'Return valid JSON only.' }, { role: 'user', content: prompt }] }),
      });
      const d = await res.json();
      const parsed = JSON.parse((d.choices?.[0]?.message?.content || '{}').replace(/```json\n?|\n?```/g, ''));
      allIssues.push(...(parsed?.issues || []));
      allWarnings.push(...(parsed?.warnings || []));
    } catch {}
  }
  return { issues: allIssues, warnings: allWarnings };
}
