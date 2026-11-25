import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { loaHash, loaSignerToken, loaTokenHash, locateLOAAnchors, stampLOASignatures, appendLOAAuditPage } from './_lib/loa-signing.js';
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
   let filing=null;
   try { filing=await fileCompletedLOA({request:{...request,final_path:path,completed_at:verifiedAt},signers,final}); } catch(e) { console.error('[loa-verify] Signed PDF saved but OneDrive filing failed',e); }
   const appointmentLabel=request.appointment_type.startsWith('bo_')?'Building Owner Letter of Appointment':'Adjoining Owners Letter of Appointment';
   const attachment=[{filename:'Signed-Letter-of-Appointment.pdf',content:final.toString('base64')}];
   const signerEmails=[...new Set(signers.map(x=>x.email))];
   const signerDeliveries=await Promise.allSettled(signerEmails.map(to=>sendLOAEmail({
    userId:request.user_id,to:[to],subject:'Your signed '+appointmentLabel,
    text:'Thank you for signing the '+appointmentLabel+'.\n\nPlease see the attached signed Letter of Appointment.',
    attachments:attachment
   })));
   const {data:ownerLookup}=await sb.auth.admin.getUserById(request.user_id);
   const ownerEmail=ownerLookup?.user?.email;
   const signedNames=signers.map(x=>x.name).join(' and ');
   const filingDescription='appropriate project file';
   const ownerDelivery=ownerEmail?await Promise.allSettled([sendLOAEmail({
    userId:request.user_id,to:[ownerEmail],subject:appointmentLabel+' signed: '+signedNames,
    text:signedNames+' '+(signers.length===1?'has':'have')+' signed the '+appointmentLabel+'.\n\n'+(filing?'The completed document has been saved to the '+filingDescription+'.':'The completed document is attached, but automatic OneDrive filing failed.')+'\n\nPlease see the attached signed Letter of Appointment.',
    attachments:attachment
   })]):[];
   const deliveries=[...signerDeliveries,...ownerDelivery];
   return res.status(200).json({success:true,completed:true,delivery:deliveries.map(x=>x.status==='fulfilled'?x.value:{sent:false})});
  }
  const path=folder+'/partially-signed.pdf';
  const uploaded=await sb.storage.from('documents').upload(path,partial,{contentType:'application/pdf',upsert:true});
  if(uploaded.error)throw uploaded.error;
  await sb.from('loa_signing_requests').update({partial_path:path}).eq('id',request.id);
  const next=signers.find(x=>x.status==='waiting');
  if(!next)throw Error('Next signer not found');
  const nextToken=loaSignerToken(next.id);
  const {data:activated,error:ae}=await sb.from('loa_signers').update({status:'invited',invited_at:verifiedAt,token_hash:loaTokenHash(nextToken)}).eq('id',next.id).eq('status','waiting').select('id').maybeSingle();
  if(ae||!activated)throw Error('Could not activate next signatory');
  const appointmentLabel=request.appointment_type.startsWith('bo_')?'Building Owner Letter of Appointment':'Adjoining Owners Letter of Appointment';
  const previous=signers.find(x=>x.position===next.position-1);
  const nextName=next.name;
  const nextMessage='Hi '+nextName.split(' ')[0]+',\n\nPlease click the link below to review and sign the '+appointmentLabel+':\n'+host+'/loa/sign/'+nextToken;
  const messages=await Promise.allSettled([
   sendLOAEmail({userId:request.user_id,to:[next.email],subject:'Please sign your '+appointmentLabel,text:nextMessage}),
   ...(previous?[sendLOAEmail({userId:request.user_id,to:[previous.email],subject:'Thank you for signing the '+appointmentLabel,text:'Hi '+previous.name.split(' ')[0]+',\n\nThank you for signing the '+appointmentLabel+'.\n\nAs soon as '+nextName+' signs, you will receive a copy of the completed signed document.'})]:[])
  ]);
  const sent=messages[0].status==='fulfilled'?messages[0].value:{sent:false};
  if(!sent?.sent)console.error('[loa-verify] Next signer invitation delivery failed',messages[0]);
  return res.status(200).json({success:true,completed:false,nextInvitationSent:sent.sent});
 }catch(e){console.error('[loa-verify]',e);return res.status(500).json({error:'Verification could not be finalised. Please contact the surveyor.'});}
}
