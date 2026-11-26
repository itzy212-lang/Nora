// api/model-diagnostic.js
//
// TEMPORARY (26 Nov 2026). Compares models on the SOC live note processor using the REAL
// callLiveSemanticProcessor (same prompts, same parsing) on made-up scenarios. Uses the OpenAI key
// already in this deployment, so the key never leaves Vercel. Never reads or writes the database,
// never sends email, returns no secrets. Deleted after the comparison. Protected by DIAG_SECRET.
//
//   GET ?key=...&i=0&model=gpt-4o      run scenario i on a model, returns parsed output + timing
import crypto from 'crypto';
import { callLiveSemanticProcessor } from './lib/soc-brain-v2/live-processor.js';

const same = (a, b) => {
  const x = Buffer.alloc(128); Buffer.from(String(a || '')).copy(x);
  const y = Buffer.alloc(128); Buffer.from(String(b || '')).copy(y);
  return crypto.timingSafeEqual(x, y) && String(a || '').length === String(b || '').length;
};

const sec = (id, key, name, floor, seq) => ({ id, section_key: key, display_name: name, floor_level: floor, last_active_sequence: seq, status: 'active' });
const claim = (id, type, element, defect, measurement, raw) => ({ claim_id: id, claim_type: type, element, defect_type: defect, measurement, raw_fragment: raw });

const kitchen = [sec('s1', 'ground_kitchen', 'Kitchen', 'ground', 4)];
const kitchenClaims = [
  claim('c1', 'observation', 'ceiling', 'hairline crack', '650mm', 'ceiling has a hairline crack about 650 millimetres from the party wall'),
  claim('c2', 'observation', 'party wall', 'paint blistering', null, 'party wall has some paint blistering near the window'),
];

const SCENARIOS = [
  { name: 'Room move', context: { sections: kitchen, currentSection: kitchen[0], recentNotes: kitchenClaims }, note: 'okay that is the kitchen done, moving upstairs now into the front bedroom' },
  { name: 'Correction to earlier measurement', context: { sections: kitchen, currentSection: kitchen[0], recentNotes: kitchenClaims }, note: 'sorry that crack in the ceiling I said 650, it is actually 450' },
  { name: 'Unclear dictation (should ask)', context: { sections: kitchen, currentSection: kitchen[0], recentNotes: kitchenClaims }, note: 'and there is a gap on the left about a hundred mil' },
  { name: 'Site note: flat roof access', context: { sections: kitchen, currentSection: kitchen[0], recentNotes: kitchenClaims }, note: 'add a side note no access to the flat roof above the kitchen, once the scaffolding is up if the contractors could take a series of photos and provide them to us before the works start' },
  { name: 'Site note: CCTV and access', context: { sections: kitchen, currentSection: kitchen[0], recentNotes: kitchenClaims }, note: 'just as a site note request a CCTV inspection of the shared drain before and after the works, as no award is being made discuss access between the parties' },
  { name: 'Ordinary observation', context: { sections: kitchen, currentSection: kitchen[0], recentNotes: kitchenClaims }, note: 'floor is vinyl tiles, couple of them lifting by the back door and a stain under the sink' },
  { name: 'Answer to a pending question', context: { sections: kitchen, currentSection: kitchen[0], recentNotes: kitchenClaims },
    pending: { question: 'Which wall is the 100mm gap on: the party wall or the flank wall?' }, note: 'it is the party wall, left of the window' },
];

export default async function handler(req, res) {
  if (!process.env.DIAG_SECRET || !same(req.query?.key, process.env.DIAG_SECRET)) return res.status(404).json({ error: 'Not found' });
  const sc = SCENARIOS[Number(req.query.i)];
  if (!sc) return res.status(400).json({ error: 'bad scenario', count: SCENARIOS.length });
  const model = req.query.model;
  const t0 = Date.now();
  try {
    const out = await callLiveSemanticProcessor({ apiKey: process.env.OPENAI_API_KEY, context: sc.context, pendingClarification: sc.pending || null, noteText: sc.note, model });
    return res.status(200).json({ scenario: sc.name, note: sc.note, model, ms: Date.now() - t0, output: out });
  } catch (err) {
    return res.status(200).json({ scenario: sc.name, model, ms: Date.now() - t0, error: String(err.message || err).slice(0, 300) });
  }
}
