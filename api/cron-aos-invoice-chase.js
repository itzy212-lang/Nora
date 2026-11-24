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
  if(x.folder&&depth<3&&(depth===0||/invoice|fee|surveyor|document|aos|adjoining|award/i.test(x.name)))out.push(...await listPdfs(token,x.id,depth+1));
 }
 return out;
}
const htmlEscape=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function signatureHtml(f){
 const rows=[];
 if(f.surveyor_name)rows.push('<strong>'+htmlEscape(f.surveyor_name)+'</strong>');
 if(f.qualifications)rows.push(htmlEscape(f.qualifications));
 if(f.logo_base64)rows.push('<img src="cid:nora-firm-logo" alt="'+htmlEscape(f.firm_name||'Firm logo')+'" style="max-width:190px;max-height:52px;display:block;margin:8px 0">');
 rows.push('<strong>'+htmlEscape(f.firm_name||f.trading_name||'Square One Consulting')+'</strong>');
 if(f.tel)rows.push('Tel | '+htmlEscape(f.tel));
 if(f.email)rows.push('Email | '+htmlEscape(f.email));
 if(f.website)rows.push(htmlEscape(f.website));
 const address=[f.address_line1,f.address_line2,f.city,f.postcode].filter(Boolean).join(' | ');
 if(address)rows.push(htmlEscape(address));
 if(f.accreditation_b64)rows.push('<img src="cid:nora-accreditation" alt="Accreditations" style="max-width:260px;max-height:46px;display:block;margin-top:10px">');
 return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1a1a1a;line-height:1.55">'+rows.map(r=>'<div>'+r+'</div>').join('')+'</div>';
}
function inlineImages(f){return [['logo_base64','nora-firm-logo','firm-logo.png'],['accreditation_b64','nora-accreditation','accreditation.png']].filter(([key])=>f[key]).map(([key,contentId,name])=>({name,type:'image/png',base64:String(f[key]).replace(/^data:[^;]+;base64,/,''),isInline:true,contentId}));}
async function run(email,job){
 const {data:p,error:pe}=await sb.from('projects').select('id,user_id,role,bo_1_email,bo_1_name,bo_2_email,bo_2_name,bo_premise_address,onedrive_folder_id,aos').eq('id',email.project_id).single();
 if(pe||!p)throw Error('Project unavailable');
 if(p.role&&!['bo','building owner'].includes(String(p.role).toLowerCase()))throw Error('Not a building owner appointment');
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
 let files=[];
 if(p.onedrive_folder_id){
  try{const token=await getValidMicrosoftToken(String(email.user_id));if(token)files=await listPdfs(token,p.onedrive_folder_id);}catch(err){console.warn('[aos-chase] Invoice search unavailable:',err.message);}
 }
 const candidates=files.filter(f=>/inv|invoice|fee/i.test(f.name));
 let matched=[];
 for(const file of candidates.slice(0,35)){
  let buffer;
  try{
   const token=await getValidMicrosoftToken(String(email.user_id));
   if(!token)continue;
   const response=await graph(token,'items/'+encodeURIComponent(file.id)+'/content');
   buffer=Buffer.from(await response.arrayBuffer());
  }catch(err){console.warn('[aos-chase] PDF download unavailable:',err.message);continue;}
  if(buffer.length>8*1024*1024)continue;
  let txt;try{txt=clean((await pdfParse(buffer)).text);}catch{continue;}
  const ref=classification.invoice_reference?.trim();
  if(ref&&!txt.toLowerCase().includes(ref.toLowerCase())&&!file.name.toLowerCase().includes(ref.toLowerCase()))continue;
  if(!/invoice|professional fees|surveyor.?s fees/i.test(txt))continue;
  const surv=surveyors[0];const name=String(surv.surv_firm||surv.surv_name||surv.surveyorFirm||surv.surveyorName||'').trim();
  if(name&&name.length>3&&!txt.toLowerCase().includes(name.toLowerCase())&&!file.name.toLowerCase().includes(name.toLowerCase()))continue;
  matched.push({file,buffer,txt});
 }
 const found=matched.length===1;
 const {file,buffer}=found?matched[0]:{file:null,buffer:null};
 if(found&&job.invoice_item_id&&job.invoice_item_id!==file.id)throw Error('Invoice changed after initial send');
 const body='Dear '+(p.bo_1_name||'Building Owner')+',\n\nWe have received a payment reminder from the Adjoining Owner\'s Surveyor in relation to their professional fees for '+(p.bo_premise_address||'your property')+'.\n\n'+(found?'Please find the invoice attached. Please arrange payment directly to the surveyor as soon as possible, using the payment details on the invoice.':'Please arrange payment of the surveyor\'s outstanding invoice as soon as possible.')+'\n\nKind regards,\nNora\nSquare One Consulting';
 const reply='Dear '+(email.sender_name||'Colleague')+',\n\nThank you for your reminder. '+(found?'I have sent a copy of your invoice to the Building Owner and advised them to make payment as soon as possible.':'I have advised the Building Owner to make payment as soon as possible.')+' I will follow up as necessary.\n\nKind regards,\nNora\nSquare One Consulting';
 const {data:firm}=await sb.from('firm_settings').select('surveyor_name,qualifications,firm_name,trading_name,tel,email,website,address_line1,address_line2,city,postcode,logo_base64,accreditation_b64').eq('user_id',p.user_id).maybeSingle();
 const signature=firm?signatureHtml(firm):'Square One Consulting';
 const images=firm?inlineImages(firm):[];
 const send=async(to,subject,body,attachments=[])=>{
  const {data,error}=await sb.functions.invoke('send_email_via_microsoft',{body:{user_id:String(email.user_id),to_email:to,subject,body:body.replace(/\n/g,'<br>').replace(/<br>Kind regards,<br>Nora<br>Square One Consulting$/, '<br><br>Kind regards,<br><br>Nora on behalf of '+htmlEscape(firm?.surveyor_name||'Itzik Darel')+'<br><br>'+signature),attachments:[...attachments,...images]}});
  if(error||data?.error)throw Error('Email delivery failed: '+(error?.message||data?.error));
 };
 if(!job.bo_sent_at){
  await send(bos[0],'AOS surveyor fee invoice: '+(p.bo_premise_address||email.subject),body,found?[{name:file.name,type:'application/pdf',base64:buffer.toString('base64')}]:[]);
  const {error}=await sb.from('aos_invoice_chase_jobs').update({bo_sent_at:new Date().toISOString(),invoice_item_id:file?.id||null,invoice_name:file?.name||null,status:'bo_sent',updated_at:new Date().toISOString()}).eq('email_id',email.id);
  if(error)throw Error('BO sent but ledger update failed: '+error.message);
 }
 if(!job.aos_sent_at){
  await send(email.sender_email,'Re: '+email.subject,reply);
  const {error}=await sb.from('aos_invoice_chase_jobs').update({aos_sent_at:new Date().toISOString(),status:'completed',updated_at:new Date().toISOString()}).eq('email_id',email.id);
  if(error)throw Error('AOS sent but ledger update failed: '+error.message);
  const {error:flagError}=await sb.from('emails').update({is_replied:true,ai_auto_responded:true,ai_auto_responded_at:new Date().toISOString(),replied_at:new Date().toISOString()}).eq('id',email.id);
  if(flagError)console.warn('[aos-chase] Reply status update failed:',flagError.message);
 }
 return 'sent';
}
export default async function handler(req,res){
 if(!process.env.CRON_SECRET||req.headers.authorization!=='Bearer '+process.env.CRON_SECRET)return res.status(401).json({error:'Unauthorized'});
 const since=new Date(Date.now()-72*3600000).toISOString();
 const {data:emails,error}=await sb.from('emails').select('id,project_id,user_id,subject,body,sender_email,sender_name,received_at,direction').eq('direction','incoming').gte('received_at',since).order('received_at',{ascending:false}).limit(100);
 if(error)return res.status(500).json({error:error.message});
 const results=[];
 for(const email of emails||[]){
  if(results.length>=3)break;
  if(!/invoice|payment|fee|outstanding|overdue|reminder|settle/i.test(clean(email.subject+' '+email.body).slice(0,3000)))continue;
  const {data:existing}=await sb.from('aos_invoice_chase_jobs').select('*').eq('email_id',email.id).maybeSingle();
  if(['completed','not_a_chase','needs_review'].includes(existing?.status))continue;
  if(existing?.status==='processing'&&Date.now()-new Date(existing.updated_at).getTime()<15*60000)continue;
  const {error:upsertError}=await sb.from('aos_invoice_chase_jobs').upsert({email_id:email.id,project_id:email.project_id||'unlinked',status:'processing',updated_at:new Date().toISOString()},{onConflict:'email_id'});
  if(upsertError){results.push({id:email.id,error:upsertError.message});continue;}
  try{
   let outcome;
   if(!email.project_id){
    const {data:knownProjects}=await sb.from('projects').select('aos').eq('user_id',email.user_id).limit(200);
    const knownSurveyor=(knownProjects||[]).some(p=>Array.isArray(p.aos)&&p.aos.some(a=>[a.surv_email,a.surveyorEmail].some(v=>addr(v)===addr(email.sender_email))));
    if(!knownSurveyor)throw Error('Unlinked sender is not a verified AOS; no automatic reply');
    const classification=await classify(email);
    if(!classification.chase){outcome='not_a_chase';}
    else {
     // No project can be verified: do not approach a Building Owner or promise forwarding.
     // Send only a neutral acknowledgement to the original surveyor.
     const {data,error}=await sb.functions.invoke('send_email_via_microsoft',{body:{user_id:email.user_id,to_email:email.sender_email,subject:'Re: '+email.subject,body:'Dear '+(email.sender_name||'Colleague')+',<br><br>Thank you for your email. I will follow this up and come back to you.<br><br>Kind regards,<br>Nora<br>Square One Consulting'}});
     if(error||data?.error)throw Error('Holding reply failed: '+(error?.message||data?.error));
     await sb.from('aos_invoice_chase_jobs').update({aos_sent_at:new Date().toISOString(),status:'completed',updated_at:new Date().toISOString()}).eq('email_id',email.id);
     outcome='holding_reply_sent';
    }
   }else outcome=await run(email,existing||{});
   if(outcome==='not_a_chase')await sb.from('aos_invoice_chase_jobs').update({status:'not_a_chase',updated_at:new Date().toISOString()}).eq('email_id',email.id);
   results.push({id:email.id,outcome});
  }catch(e){
   await sb.from('aos_invoice_chase_jobs').update({status:'needs_review',last_error:String(e.message).slice(0,500),updated_at:new Date().toISOString()}).eq('email_id',email.id);
   results.push({id:email.id,error:String(e.message)});
  }
 }
 return res.status(200).json({checked:emails?.length||0,results});
}