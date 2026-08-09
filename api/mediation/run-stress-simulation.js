import { runMediationModel } from '../lib/mediation-model.js';
import { getMediationSupabase } from '../lib/mediation-client.js';

const EVENT_TYPE = 'phoenix_hazelwood_two_party_simulation_v1';

const partyA = `Isaac Stein and Karin Kovalsky, clients at 132 Hazelwood Drive, St Albans. Their confidential account: contract with FL Design & Build LTD / Fatos Perlesha, original value £70,000 + VAT, start 10/06/2026, completion 19/07/2026. They acknowledge £4,250 non-disputed variations (£3,600 kitchen steel beam, £650 Velux) and say £64,000 has been paid. They dispute £3,800 stud wall, £1,000 stairs and £1,000 electrical extras. They allege incomplete/defective works, delay, structural damage/lack of propping, extractor ducting issue, flooring defects, en-suite layout/shower issues, wardrobe/radiator issues, no procurement schedule, inaccurate measurements, refusal to install kitchen, and repeated payment demands. They say the contractor stopped attending, removed materials including a boiler overnight without consent, left waste, stopped responding, and made threats. These are allegations, not established facts. They seek termination, no further contractor access, return/credit for removed materials, financial adjustment for incomplete/defective works, rent and engineer costs, no further sums due, and insurance details. In a second brief they acknowledge additional works including manhole relocation, Saniflo connection, pipe rerouting and downstairs WC layout changes, but say significant variations were undertaken without prior written agreement. They say a 29 June meeting led to some proposed extras being dropped and they subsequently insisted on prior written agreement for costs. Their stated position is that the relationship has broken down and the contractor should not return.`;

const partyB = `Fatos Perlesha, Director of FL Design & Build Limited. His confidential account: he left site because communication had broken down despite requests for respectful professional communication. He alleges repeated payment delays and delays in client-supplied materials disrupted progress and caused costs/delay. He says many arrangements were verbal, acknowledges this was a mistake, and says he acted in good faith, carried out numerous additional works, discounts and absorbed costs. He says the vast majority of works are complete to a high standard. He claims £16,050 outstanding for agreed works plus £1,710.26 reimbursable receipts, total £17,760.26. He says he is prepared to return and complete because he does not want the family/children affected and will not seek payment for many extras. His initial return conditions: communication through Isaac only, no direct communication with Karin, clients absent while works occur except arranged meetings with Isaac, £12,760.26 paid before return and £5,000 on completion, no further variations, and only already-agreed works completed. He calls these conditions reasonable and not open to negotiation. These are Party B's assertions and position, not established facts.`;

const scriptedA = [
  "Winning means this is over. We don't want Fatos back in the house. We've paid £64,000, the job is late and unfinished, and after everything that's happened I don't see why we should pay him anything else.",
  "The biggest thing now is trust. Even if he says he'll come back, how do we know we don't pay more money and then end up in exactly the same position again?",
  "The workmanship isn't all terrible. Some of it is good. But there are defects and unfinished items. The real problem is I don't trust the process anymore or that paying him more means the job actually gets finished.",
  "If somebody independent was actually checking what had been completed before money was released, that would be different. I wouldn't want to just hand over another £12,760 before he even comes back.",
  "If we could be protected against overpaying and didn't have to manage every argument with Fatos ourselves, then yes, I could at least consider him finishing. But there would need to be a clear list and dates."
];

const scriptedB = [
  "I've already said I'm willing to finish, but my conditions are not negotiable. I'm owed £17,760.26 and I'm not going back there to do more work and then have another argument about being paid.",
  "The work itself isn't the problem. I know I can finish it. The problem is every time we get somewhere there is another dispute, another withheld payment, another issue. I don't trust that I finish and then get my money.",
  "If I knew completed work would be checked fairly and payment couldn't just be withheld because they changed their mind, then obviously that gives me more confidence. But I need protection too.",
  "I could work to proper milestones if they're clear about what is actually left in my contract. I don't want new work being added and then another argument about whether it was included.",
  "If an independent person signs off the stages and there is a proper payment schedule, I would consider that. I still need the money I say I'm owed dealt with, but finishing the job is better than court if I know I'm actually going to be paid."
];

async function caucus(roleLabel, confidentialBrief, scriptedTurns, sharedOpening) {
  const messages = [];
  const transcript = [];
  let usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let brainVersions = null;
  const scenarioContext = `REAL-BRIEF PHOENIX STRESS TEST. Central Mediator private caucus with ${roleLabel}. Treat allegations as party assertions, not facts. Do not adjudicate. Do not disclose the other party's confidential brief. Shared/open material available to both parties only: ${sharedOpening}\nCONFIDENTIAL material from this party only: ${confidentialBrief}\nThe test must not be told a settlement solution. Explore naturally, preserve confidentiality, and allow the party to author movement.`;
  for (let i=0;i<scriptedTurns.length;i++) {
    messages.push({ role:'user', content: scriptedTurns[i] });
    const result = await runMediationModel({ roleType:'central_mediator', messages, scenarioContext, reasoningEffort:'medium' });
    transcript.push({ turn:i+1, party:scriptedTurns[i], mediator:result.text });
    messages.push({ role:'assistant', content:result.text });
    usage.input_tokens += result.usage?.input_tokens || 0;
    usage.output_tokens += result.usage?.output_tokens || 0;
    usage.total_tokens += result.usage?.total_tokens || 0;
    brainVersions = result.brainVersions;
  }
  return { transcript, usage, brainVersions };
}

export async function runStressSimulation({ force=false }={}) {
  const sb=getMediationSupabase();
  if(!force){ const {data}=await sb.from('mediation_audit_events').select('event_data,created_at').eq('event_type',EVENT_TYPE).order('created_at',{ascending:false}).limit(1).maybeSingle(); if(data?.event_data?.result)return {cached:true,...data.event_data.result}; }
  const sharedOpening = `Party A says the project is overdue/incomplete, disputes further charges and does not presently want FL Design & Build to return. Party B says substantial work is complete, money remains outstanding, and he is prepared to return subject to conditions. Both positions are disputed accounts.`;
  const A=await caucus('Party A (Isaac/Karin)',partyA,scriptedA,sharedOpening);
  const B=await caucus('Party B (Fatos / FL Design & Build)',partyB,scriptedB,sharedOpening);
  const payload={test:'hazelwood_real_briefs_two_party_confidential_caucus',model:'gpt-5.6-terra',partyA:A,partyB:B,sourcePolicy:'Only the three supplied briefs plus scripted party responses; allegations remain unverified; no Nora project history.'};
  const {error}=await sb.from('mediation_audit_events').insert({mediation_id:null,actor_type:'system_test',actor_id:'phoenix_regression',event_type:EVENT_TYPE,event_data:{result:payload}}); if(error)throw error;
  return {cached:false,...payload};
}

export default async function handler(req,res){ if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'}); if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='feature/phoenix-mediation-foundation')return res.status(404).json({error:'Not found'}); try{return res.status(200).json(await runStressSimulation());}catch(error){console.error('[mediation/run-stress-simulation] failed:',error?.message||error);return res.status(500).json({error:error?.message||'Stress simulation failed'});} }
