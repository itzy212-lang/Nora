import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { loaHash, loaToken, loaTokenHash, locateLOAAnchors, stampLOASignatures, appendLOAAuditPage } from './_lib/loa-signing.js';
import { sendLOAEmail } from './_lib/loa-email.js';
import { fileCompletedLOA } from './_lib/loa-filing.js';
const db=()=>createClient(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const host=process.env.LOA_SIGNING_BASE_URL || (process.env.VERCEL_ENV==='production'?'https://loa.sq1consulting.co.uk':'https://'+process.env.VERCEL_URL);
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 try{
  const {token,code}=req.body||{};
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(token)||typeof code!=='string'||!/^\d{6}$/.test(code))return res.status(400).json({error:'Invalid verification code'});
  const sb=db(),{data:s}=await sb.from('loa_signers').select('*,loa_signing_requests(*)').eq('token_hash',loaTokenHash(token)).maybeSingle();
  if(!s||s.status!=='pending_verification'||s.loa_signing_requests?.status!=='pending'||!s.otp_hash||s.otp_attempts>=5||Date.parse(s.otp_expires_at)<Date.now())return res.status(409).json({error:'Verification code expired or invitation unavailable'});
  const a=Buffer.from(s.otp_hash,'hex'),b=Buffer.from(loaHash(Buffer.from(s.id+':'+s.email+':'+code)),'hex');
  if(!timingSafeEqual(a,b)){
   await sb.from('loa_signers').update({otp_attempts:s.otp_attempts+1}).eq('id',s.id).eq('otp_attempts',s.otp_attempts);
   return res.status(400).json({error:'Incorrect verification code'});
  }
  const verifiedAt=new Date().toISOString();
  const {data:changed,error:ce}=await sb.from('loa_signers').update({status:'verified',verified_at:verifiedAt,otp_hash:null,otp_expires_at:null}).eq('id',s.id).eq('status','pending_verification').select('id').maybeSingle();
  if(ce||!changed)return res.status(409).json({error:'This signature has already been verified'});
  const request=s.loa_signing_requests;
  const {data:signers,error:se}=await sb.from('loa_signers').select('*').eq('request_id',s.request_id).order('position');
  if(se)throw se;
  const {data:file,error:fe}=await sb.storage.from('documents').download(request.original_path);
  if(fe||!file)throw Error('Original LOA unavailable');
  const original=Buffer.from(await file.arrayBuffer());
  if(loaHash(original)!==request.original_sha256)throw Error('Original LOA checksum mismatch');
  const completed=signers.filter(x=>x.status==='verified').map(x=>({position:x.position,signature:x.signature,signedDate:x.signed_date,verifiedAt:x.verified_at}));
  const placements=await locateLOAAnchors(original,request.appointment_type,signers.length);
  const partial=await stampLOASignatures(original,completed,placements);
  const folder=request.project_id+'/loa/in-house/'+request.id;
  if(signers.every(x=>x.status==='verified')){
   const final=await appendLOAAuditPage(partial,{signers:signers.map(x=>({...x,signedDate:x.signed_date,verifiedAt:x.verified_at})),documentHash:request.original_sha256,projectReference:request.project_id,appointmentType:request.appointment_type});
   const path=folder+'/signed-final.pdf';
   const uploaded=await sb.storage.from('documents').upload(path,final,{contentType:'application/pdf',upsert:false});
   if(uploaded.error)throw uploaded.error;
   const {error:re}=await sb.from('loa_signing_requests').update({status:'completed',completed_at:verifiedAt,final_path:path}).eq('id',request.id).eq('status','pending');
   if(re)throw re;
   await fileCompletedLOA({request:{...request,final_path:path,completed_at:verifiedAt},signers,final});
   const emails=[...new Set(signers.map(x=>x.email))];
   const message='The Letter of Appointment has now been signed and verified by all required parties.\n\nPlease find the completed LOA and electronic signature audit record attached.';
   const deliveries=await Promise.allSettled([sendLOAEmail({userId:request.user_id,to:emails,subject:'Nora: Your signed Letter of Appointment',text:message,attachments:[{filename:'Signed-Letter-of-Appointment.pdf',content:final.toString('base64')}]}),sendLOAEmail({userId:request.user_id,to:[(await sb.auth.admin.getUserById(request.user_id)).data.user?.email].filter(Boolean),subject:'Nora: LOA fully signed - '+request.project_id,text:message,attachments:[{filename:'Signed-Letter-of-Appointment.pdf',content:final.toString('base64')}]})]);
   return res.status(200).json({success:true,completed:true,delivery:deliveries.map(x=>x.status==='fulfilled'?x.value:{sent:false})});
  }
  const path=folder+'/partially-signed.pdf';
  const uploaded=await sb.storage.from('documents').upload(path,partial,{contentType:'application/pdf',upsert:true});
  if(uploaded.error)throw uploaded.error;
  await sb.from('loa_signing_requests').update({partial_path:path}).eq('id',request.id);
  const next=signers.find(x=>x.status==='waiting');
  if(!next)throw Error('Next signer not found');
  const nextToken=loaToken();
  const {data:activated,error:ae}=await sb.from('loa_signers').update({status:'invited',invited_at:verifiedAt,token_hash:loaTokenHash(nextToken)}).eq('id',next.id).eq('status','waiting').select('id').maybeSingle();
  if(ae||!activated)throw Error('Could not activate next signatory');
  const message='Dear '+next.name.split(' ')[0]+',\n\nThe previous signatory has signed the Letter of Appointment. It is now ready for you to review and sign.\n\nPlease use this secure link:\n'+host+'/loa/sign/'+nextToken+'';
  const sent=await sendLOAEmail({userId:request.user_id,to:[next.email],subject:'Nora: Your Letter of Appointment is ready to sign',text:message});
  return res.status(200).json({success:true,completed:false,nextInvitationSent:sent.sent});
 }catch(e){console.error('[loa-verify]',e);return res.status(500).json({error:'Verification could not be finalised. Please contact the surveyor.'});}
}
