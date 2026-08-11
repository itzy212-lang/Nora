import { createClient } from '@supabase/supabase-js';

function getSupabase(){
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url&&key?createClient(url,key):null;
}

function extractJson(text=''){
  const raw=String(text||'').trim();
  const candidates=[raw,raw.replace(/^```json\s*/i,'').replace(/^```/,'').replace(/```$/,'').trim()];
  const a=raw.indexOf('{'),b=raw.lastIndexOf('}');
  if(a>=0&&b>a)candidates.push(raw.slice(a,b+1));
  for(const candidate of candidates){try{return JSON.parse(candidate);}catch{}}
  return null;
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{
    const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    const sb=getSupabase();
    if(!token||!sb)return res.status(401).json({error:'Not authenticated'});
    const {data:{user},error:authError}=await sb.auth.getUser(token);
    if(authError||!user)return res.status(401).json({error:'Not authenticated'});

    const intake=req.body?.context?.dispute_intake;
    if(!intake)return res.status(400).json({error:'Missing dispute intake'});

    const system=`You are Nora, the private case analyst for an independent mediator or project manager. Analyse only the supplied dispute intake and supporting material. Compare the parties. Do not decide liability or invent facts. Treat assertions as allegations unless supported or agreed. Distinguish positions, evidence, inference and missing information. Produce a practical mediator working brief: what each party wants, strengths and weaknesses, unsupported or inconsistent points, missing evidence, common ground, pressure points to test, and realistic settlement opportunities. Return valid JSON only.`;
    const schema=`Use exactly these keys: executive_summary:string, dispute_synopsis:string, party_summaries:array of {party,name,position,outcome_sought,key_points}, party_assessments:array of {party,strengths,weaknesses,unsupported_points,leverage_points}, agreed_or_common_facts:array, disputed_facts:array, financial_claims:array, workmanship_issues:array, programme_delay_issues:array, contractual_issues:array, relationship_communication_issues:array, possible_common_ground:array, mediator_pressure_points:array, settlement_opportunities:array, resolution_pathway:string, resolution_steps:array, likely_settlement_blockers:array, mediator_questions_to_explore:array, alternative_exit_path:string, missing_information:array, preparation_points:array. If unsupported use [] or ''.`;

    const response=await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},
      body:JSON.stringify({
        model:'gpt-5.6-terra',
        reasoning_effort:'medium',
        max_completion_tokens:9000,
        response_format:{type:'json_object'},
        messages:[{role:'system',content:system},{role:'user',content:`${schema}\n\nDISPUTE INTAKE:\n${JSON.stringify(intake)}`}]
      })
    });
    const data=await response.json();
    if(!response.ok)throw new Error(data?.error?.message||`OpenAI error ${response.status}`);
    const raw=data?.choices?.[0]?.message?.content||'';
    const parsed=extractJson(raw);
    if(!parsed)throw new Error('Nora did not return a complete structured synopsis.');
    return res.status(200).json({reply:JSON.stringify(parsed),model:data.model||'gpt-5.6-terra',mode:'discuss'});
  }catch(err){
    console.error('[dispute-synopsis]',err);
    return res.status(500).json({error:err.message||'Could not generate dispute synopsis'});
  }
}
