import './lib/ai-usage-install.js'; // AI token tracking (api/lib/ai-usage.js)
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const aiKey = process.env.OPENAI_API_KEY;
async function openai(path,body) {
 const response=await fetch('https://api.openai.com/v1/'+path,{method:'POST',headers:{Authorization:'Bearer '+aiKey,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json();
 if(!response.ok) throw Error(data.error?.message||'OpenAI '+response.status);
 return data;
}
async function processJob(job){
 const {data:email,error}=await db.from('emails').select('id,project_id,subject,body,direction,sender_email,received_at').eq('id',job.email_id).single();
 if(error||!email?.project_id) throw Error(error?.message||'Email not linked');
 const {data:existing}=await db.from('project_memory').select('id,summary,embedding').eq('source_id',email.id);
 if(existing?.length && existing.every(x=>x.embedding)){
  return 'already_indexed';
 }
 // Existing facts without embeddings must be repaired, not duplicated.
 if(existing?.length){
  for(const fact of existing.filter(x=>!x.embedding)){
   const result=await openai('embeddings',{model:'text-embedding-3-small',input:fact.summary});
   const {error:e}=await db.from('project_memory').update({embedding:result.data[0].embedding}).eq('id',fact.id);
   if(e) throw Error(e.message);
  }
  return 'embeddings_repaired';
 }
 const plain=(email.body||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').slice(0,6500);
 const prompt='Extract durable, actionable facts from this UK party wall surveying project email. Include access attempts and outcomes, appointment progress, outstanding requests, decisions, payments, dates and who is responsible. Do not infer completion from a proposal. Ignore quoted historical email chains when possible. Return ONLY a JSON array of self-contained sentences. Return [] only when there are genuinely no useful facts.\nDate: '+email.received_at+'\nDirection: '+email.direction+'\nSender: '+email.sender_email+'\nSubject: '+email.subject+'\nEmail:\n'+plain;
 const response=await openai('chat/completions',{model:'gpt-4o',temperature:0,max_tokens:1100,messages:[{role:'user',content:prompt}]});
 const raw=(response.choices?.[0]?.message?.content||'').replace(/\`\`\`(?:json)?/g,'').trim();
 let facts=JSON.parse(raw);
 if(!Array.isArray(facts)||facts.some(f=>typeof f!=='string')) throw Error('Invalid extraction format');
 if(!facts.length) return 'no_facts';
 for(const fact of facts.slice(0,12)){
  const embedding=await openai('embeddings',{model:'text-embedding-3-small',input:fact});
  const {error:e}=await db.from('project_memory').insert({project_id:email.project_id,source_type:email.direction==='outgoing'?'email_sent':'email_received',source_id:email.id,title:(email.subject||'Email').slice(0,200),summary:fact,content:fact,embedding:embedding.data[0].embedding,importance_score:0.7,metadata:{email_date:email.received_at,extracted_by:'memory_reconciliation'}});
  if(e) throw Error(e.message);
 }
 return 'saved_'+facts.length;
}
export default async function handler(req,res){
 if(req.headers.authorization!=='Bearer '+process.env.CRON_SECRET||!process.env.CRON_SECRET)return res.status(401).json({error:'Unauthorized'});
 const now=new Date().toISOString(), results=[];
 // Reclaim abandoned jobs from interrupted serverless executions.
 await db.from('email_memory_jobs').update({status:'pending',next_attempt_at:now}).eq('status','processing').lt('locked_at',new Date(Date.now()-10*60*1000).toISOString());
 const query=()=>db.from('email_memory_jobs').select('email_id,project_id,attempts').in('status',['pending','failed']).lte('next_attempt_at',now);
 const [oldest,newest]=await Promise.all([query().order('next_attempt_at',{ascending:true}).limit(2),query().order('next_attempt_at',{ascending:false}).limit(2)]);
 if(oldest.error||newest.error)return res.status(500).json({error:oldest.error?.message||newest.error?.message});
 const jobs=[...new Map([...(newest.data||[]),...(oldest.data||[])].map(j=>[j.email_id,j])).values()];
 for(const job of jobs||[]){
  const {data:claimed,error:claimError}=await db.from('email_memory_jobs').update({status:'processing',locked_at:now,attempts:job.attempts+1,updated_at:now}).eq('email_id',job.email_id).in('status',['pending','failed']).select('email_id').maybeSingle();
  if(claimError||!claimed)continue;
  try{
   const outcome=await processJob(job);
   await db.from('email_memory_jobs').update({status:'completed',processed_at:new Date().toISOString(),locked_at:null,last_error:null,updated_at:new Date().toISOString()}).eq('email_id',job.email_id);
   results.push({email_id:job.email_id,outcome});
  }catch(e){
   const wait=Math.min(1440,Math.pow(2,Math.min(job.attempts,8))*5);
   await db.from('email_memory_jobs').update({status:'failed',locked_at:null,last_error:String(e.message).slice(0,500),next_attempt_at:new Date(Date.now()+wait*60000).toISOString(),updated_at:new Date().toISOString()}).eq('email_id',job.email_id);
   results.push({email_id:job.email_id,error:String(e.message).slice(0,100)});
  }
 }
 return res.status(200).json({processed:results.length,results});
}