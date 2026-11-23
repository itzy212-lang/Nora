import {createClient} from '@supabase/supabase-js';
import {getValidMicrosoftToken} from './onedrive-helper.js';
import pdfParse from 'pdf-parse';
export const config={maxDuration:120};
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const clean=s=>String(s||'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
const addr=s=>String(s||'').trim().toLowerCase();
async function classify(email){
 const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o',temperature:0,response_format:{type:'json_object'},messages:[{role:'system',content:'Identify a current explicit payment chase by an adjoining owner surveyor for their own professional fee invoice under the Party Wall etc. Act 1996. Do not classify invoices issued by our firm, marketing, quoted older messages, general fee discussions or payment confirmations as chases. Return JSON {chase:boolean,invoice_reference:string|null,reason:string}.'},{role:'user',content:'Subject: '+email.subject+'\nSender: '+email.sender_email+'\nEmail: '+clean(email.body).slice(0,5500)}]})});
 if(!response.ok)throw Error('Classification HTTP '+response.status);
 return JSON.parse((await response.json()).choices[0].message.content);
}
async function graph(token,path){const r=await fetch('https://graph.microsoft.com/v1.0/me/drive/'+path,{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('OneDrive '+r.status);return r;}
async function listPdfs(token,folder,depth=0){
 const r=await graph(token,'items/'+encodeURIComponent(folder)+'/children?$top=200&$select=id,name,file,folder');
 const data=await r.json();let out=[];
 for(const x of data.value||[]){
  if(x.file&&/\.pdf$/i.test(x.name))out.push(x);
  if(x.folder&&depth<2&&/invoice|fee|surveyor|document|aos|adjoining/i.test(x.name))out.push(...await listPdfs(token,x.id,depth+1));
 }
 return out;
}
async function run(email,job){
 const {data:p,error:pe}=await sb.from('projects').select('id,user_id,role,bo_1_email,bo_1_name,bo_2_email,bo_2_name,bo_premise_address,onedrive_folder_id,aos').eq('id',email.project_id).single();
 if(pe||!p||!p.onedrive_folder_id)throw Error('Project or OneDrive folder unavailable');
 if(p.role&&p.role!=='BO')throw Error('Not a building owner appointment');
 const aos=Array.isArray(p.aos)?p.aos:[];
 const surveyors=aos.filter(a=>[a.surv_email,a.surveyorEmail].some(v=>addr(v)===addr(email.sender_email)));
 if(surveyors.length!==1)throw Error('Chaser not uniquely matched to recorded AOS');
 const bos=[p.bo_1_email,p.bo_2_email].filter(Boolean);
 if(bos.length!==1)throw Error('Building owner email is missing or ambiguous');
 if(addr(bos[0])===addr(email.sender_email))throw Error('BO and AOS addresses overlap');
 const classification=await classify(email);
 if(!classification.chase)return 'not_a_chase';
 const {data:payment}=await sb.from('emails').select('id,subject,body').eq('project_id',p.id).gt('received_at',email.received_at).limit(30);
 if((payment||[]).some(x=>/paid|payment made|settled|remittance/i.test(clean(x.subject+' '+x.body).slice(0,600))))throw Error('Possible payment confirmation after chase: review required');
 const token=await getValidMicrosoftToken(String(p.user_id));
 if(!token)throw Error('OneDrive authentication unavailable');
 const files=await listPdfs(token,p.onedrive_folder_id);
 const candidates=files.filter(f=>/inv|invoice|fee/i.test(f.name));
 let matched=[];
 for(const file of candidates.slice(0,35)){
  const response=await graph(token,'items/'+encodeURIComponent(file.id)+'/content');
  const buffer=Buffer.from(await response.arrayBuffer());
  if(buffer.length>8*1024*1024)continue;
  let txt;try{txt=clean((await pdfParse(buffer)).text);}catch{continue;}
  const ref=classification.invoice_reference?.trim();
  if(ref&&!txt.toLowerCase().includes(ref.toLowerCase())&&!file.name.toLowerCase().includes(ref.toLowerCase()))continue;
  if(!/invoice|professional fees|surveyor.?s fees/i.test(txt))continue;
  const surv=surveyors[0];const name=String(surv.surv_firm||surv.surv_name||surv.surveyorFirm||surv.surveyorName||'').trim();
  if(name&&name.length>3&&!txt.toLowerCase().includes(name.toLowerCase())&&!file.name.toLowerCase().includes(name.toLowerCase()))continue;
  matched.push({file,buffer,txt});
 }
 if(matched.length!==1)throw Error('Could not uniquely verify AOS invoice PDF ('+matched.length+' matches)');
 const {file,buffer}=matched[0];
 if(job.invoice_item_id&&job.invoice_item_id!==file.id)throw Error('Invoice changed after initial send');
 const body='Dear '+(p.bo_1_name||'Building Owner')+',\n\nWe have received a payment reminder from the Adjoining Owner\'s Surveyor in relation to their professional fees for '+(p.bo_premise_address||'your property')+'.\n\nPlease find the invoice attached. Would you arrange payment directly to the surveyor using the payment details on the invoice and confirm once settled?\n\nKind regards,\nNora\nSquare One Consulting';
 const reply='Dear '+(email.sender_name||'Colleague')+',\n\nThank you for your reminder. I have forwarded your invoice to the Building Owner and requested payment. I will let you know when payment is confirmed.\n\nKind regards,\nNora\nSquare One Consulting';
 const send=async(to,subject,body,attachments=[])=>{
  const {data,error}=await sb.functions.invoke('send_email_via_microsoft',{body:{user_id:String(p.user_id),to_email:to,subject,body:body.replace(/\n/g,'<br>'),attachments}});
  if(error||data?.error)throw Error('Email delivery failed: '+(error?.message||data?.error));
 };
 if(!job.bo_sent_at){
  await send(bos[0],'AOS surveyor fee invoice: '+(p.bo_premise_address||email.subject),body,[{name:file.name,type:'application/pdf',base64:buffer.toString('base64')}]);
  const {error}=await sb.from('aos_invoice_chase_jobs').update({bo_sent_at:new Date().toISOString(),invoice_item_id:file.id,invoice_name:file.name,status:'bo_sent',updated_at:new Date().toISOString()}).eq('email_id',email.id);
  if(error)throw Error('BO sent but ledger update failed: '+error.message);
 }
 if(!job.aos_sent_at){
  await send(email.sender_email,'Re: '+email.subject,reply);
  const {error}=await sb.from('aos_invoice_chase_jobs').update({aos_sent_at:new Date().toISOString(),status:'completed',updated_at:new Date().toISOString()}).eq('email_id',email.id);
  if(error)throw Error('AOS sent but ledger update failed: '+error.message);
 }
 return 'sent';
}
export default async function handler(req,res){
 if(!process.env.CRON_SECRET||req.headers.authorization!=='Bearer '+process.env.CRON_SECRET)return res.status(401).json({error:'Unauthorized'});
 const since=new Date(Date.now()-72*3600000).toISOString();
 const {data:emails,error}=await sb.from('emails').select('id,project_id,subject,body,sender_email,sender_name,received_at,direction').eq('direction','incoming').not('project_id','is',null).gte('received_at',since).order('received_at',{ascending:false}).limit(100);
 if(error)return res.status(500).json({error:error.message});
 const results=[];
 for(const email of emails||[]){
  if(results.length>=3)break;
  if(!/invoice|payment|fee|outstanding|overdue|reminder|settle/i.test(clean(email.subject+' '+email.body).slice(0,3000)))continue;
  const {data:existing}=await sb.from('aos_invoice_chase_jobs').select('*').eq('email_id',email.id).maybeSingle();
  if(existing?.status==='completed'||existing?.status==='not_a_chase')continue;
  if(existing?.status==='processing'&&Date.now()-new Date(existing.updated_at).getTime()<15*60000)continue;
  const {error:upsertError}=await sb.from('aos_invoice_chase_jobs').upsert({email_id:email.id,project_id:email.project_id,status:'processing',updated_at:new Date().toISOString()},{onConflict:'email_id'});
  if(upsertError){results.push({id:email.id,error:upsertError.message});continue;}
  try{
   const outcome=await run(email,existing||{});
   if(outcome==='not_a_chase')await sb.from('aos_invoice_chase_jobs').update({status:'not_a_chase',updated_at:new Date().toISOString()}).eq('email_id',email.id);
   results.push({id:email.id,outcome});
  }catch(e){
   await sb.from('aos_invoice_chase_jobs').update({status:'needs_review',last_error:String(e.message).slice(0,500),updated_at:new Date().toISOString()}).eq('email_id',email.id);
   results.push({id:email.id,error:String(e.message)});
  }
 }
 return res.status(200).json({checked:emails?.length||0,results});
}