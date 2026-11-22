import { createClient } from '@supabase/supabase-js';
import { loaToken, loaTokenHash, loaHash, validateLOASigners } from './_lib/loa-signing.js';
import { sendNoticeEmail } from './_lib/notice-response-mail.js';

const db=()=>createClient(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const reply=(r,s,b)=>r.status(s).json(b);
const host=process.env.LOA_SIGNING_BASE_URL || (process.env.VERCEL_ENV==='production'?'https://loa.sq1consulting.co.uk':'https://'+process.env.VERCEL_URL);
const clean=s=>String(s||'').replace(/[\\r\\n]/g,' ').slice(0,180);
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return reply(res,405,{error:'Method not allowed'});
 try{
  const auth=/^Bearer (.+)$/i.exec(req.headers.authorization||'');
  if(!auth)return reply(res,401,{error:'Sign in to Nora to send an LOA'});
  const sb=db(),{data:{user},error}=await sb.auth.getUser(auth[1]);
  if(error||!user)return reply(res,401,{error:'Invalid session'});
  const {project_id,appointment_type,document_name,pdf_b64,signers}=req.body||{};
  if(!/^proj_[a-zA-Z0-9_]+$/.test(project_id||'')||!['bo_loa','ao_loa','ao_agreed_surveyor_loa','bo_agreed_surveyor_loa'].includes(appointment_type))return reply(res,400,{error:'Invalid appointment'});
  const {data:project,error:pe}=await sb.from('projects').select('id,user_id').eq('id',project_id).maybeSingle();
  if(pe||!project||project.user_id!==user.id)return reply(res,403,{error:'Project not accessible'});
  const people=validateLOASigners(signers);
  const bytes=Buffer.from(String(pdf_b64||'').replace(/^data:application\\/pdf;base64,/,'').trim(),'base64');
  if(bytes.length<100||bytes.length>12_000_000||bytes.subarray(0,5).toString()!=='%PDF-')return reply(res,400,{error:'A valid PDF is required'});
  const id=crypto.randomUUID(),path=project_id+'/loa/in-house/'+id+'/original.pdf';
  const uploaded=await sb.storage.from('documents').upload(path,bytes,{contentType:'application/pdf',upsert:false});
  if(uploaded.error)throw uploaded.error;
  const {error:re}=await sb.from('loa_signing_requests').insert({id,user_id:user.id,project_id,appointment_type,document_name:clean(document_name)||'Letter of Appointment.pdf',original_path:path,original_sha256:loaHash(bytes)});
  if(re)throw re;
  const tokens=people.map(()=>loaToken());
  const {data:rows,error:se}=await sb.from('loa_signers').insert(people.map((p,i)=>({...p,request_id:id,token_hash:loaTokenHash(tokens[i]),status:i===0?'invited':'waiting',invited_at:i===0?new Date().toISOString():null}))).select('id');
  if(se)throw se;
  const intro=people.length>1?'There is more than one person required to sign this appointment. Once you have signed and verified your signature, the next signatory will automatically receive their invitation.':'';
  const message='Dear '+people[0].name.split(' ')[0]+',\\n\\nYour Letter of Appointment is ready for review and electronic signature.\\n\\nPlease use this secure link:\\n'+host+'/loa/sign/'+tokens[0]+'\\n\\n'+intro+'\\n\\nKind regards,\\nNora';
  const sent=await sendNoticeEmail({userId:user.id,to:[people[0].email],subject:'Nora: Your Letter of Appointment is ready to sign',text:message});
  if(!sent.sent)return reply(res,502,{error:'LOA created, but invitation delivery failed: '+sent.reason,signing_request_id:id});
  return reply(res,200,{success:true,provider:'nora',signing_request_id:id,signers:rows?.length});
 }catch(e){console.error('[loa-create]',e);return reply(res,500,{error:e.message||'Could not create LOA signing request'});}
}
