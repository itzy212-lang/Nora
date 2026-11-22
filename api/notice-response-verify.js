import { createClient } from '@supabase/supabase-js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { finaliseNoticeResponse, emailFinalisedResponse } from './_lib/notice-response-documents.js';
import { updateProjectFromVerifiedNotice } from './_lib/notice-response-project.js';
const sha=v=>createHash('sha256').update(v).digest('hex');
const respond=(res,s,b)=>res.status(s).json(b);
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return respond(res,405,{error:'Method not allowed'});
 const {token,submissionId,code}=req.body||{};
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(token)||
 typeof submissionId!=='string'||!/^[a-f0-9-]{36}$/i.test(submissionId)||
 typeof code!=='string'||!/^\d{6}$/.test(code))
 return respond(res,400,{error:'Invalid verification request'});
 try{
  const sb=createClient(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,
   process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:link}=await sb.from('notice_response_links').select('id,user_id,revoked_at,expires_at')
   .eq('token_hash',sha(token)).maybeSingle();
  if(!link||link.revoked_at||(link.expires_at&&Date.parse(link.expires_at)<Date.now()))
   return respond(res,404,{error:'Notice unavailable'});
  const {data:submission}=await sb.from('notice_response_submissions')
   .select('id,link_id,choice,surveyor,signer_email,verification_hash,verification_expires_at,verification_attempts,status,audit')
   .eq('id',submissionId).eq('link_id',link.id).maybeSingle();
  if(!submission||submission.status!=='pending_verification'||
   !submission.verification_hash||submission.verification_attempts>=5||Date.parse(submission.verification_expires_at)<Date.now())
   return respond(res,400,{error:'Verification code expired or invalid'});
  const expected=Buffer.from(submission.verification_hash,'hex');
  const actual=Buffer.from(sha(link.id+':'+submission.signer_email+':'+code),'hex');
  if(!timingSafeEqual(expected,actual)){
   await sb.from('notice_response_submissions').update({verification_attempts:submission.verification_attempts+1}).eq('id',submission.id).eq('verification_attempts',submission.verification_attempts);
   return respond(res,400,{error:'Incorrect verification code'});
  }
  const now=new Date().toISOString();
  const {data:updated,error}=await sb.from('notice_response_submissions').update({
   email_verified_at:now,signed_at:now,status:'verified',verification_hash:null,
   audit:{...submission.audit,verification_method:'email_otp',verified_at:now,signed_at:now}
  }).eq('id',submission.id).eq('status','pending_verification').select('id');
  if(error){if(error.code==='23505')return respond(res,409,{error:'This notice already has a verified response'});throw error;}
  if(!updated?.length)return respond(res,409,{error:'This response has already been processed'});
  if(['dissent_own','dissent_agreed'].includes(submission.choice)&&submission.surveyor?.name&&!submission.audit?.appoint_serving_surveyor){
    try{
      const s=submission.surveyor;
      let match=sb.from('contacts').select('id').eq('user_id',link.user_id).eq('type','surveyor');
      match=s.email?match.ilike('email',s.email):match.ilike('name',s.name);
      const {data:existing}=await match.limit(1);
      if(!existing?.length){
        const {error:contactError}=await sb.from('contacts').insert({
          user_id:link.user_id,type:'surveyor',name:s.name,firm:s.firm||null,email:s.email||null,phone:s.phone||null
        });
        if(contactError)console.error('notice-response-contact:',contactError.message);
      }
    }catch(contactError){console.error('notice-response-contact:',contactError.message);}
  }
  let projectUpdated=false;
  try{projectUpdated=await updateProjectFromVerifiedNotice(sb,{linkId:link.id,userId:link.user_id,choice:submission.choice,surveyor:submission.surveyor,appointServingSurveyor:submission.audit?.appoint_serving_surveyor===true});}
  catch(projectError){console.error('notice-response-project:',projectError.message);}
  let documentsSaved=false,emailed=false,surveyorNotified=false,boNotified=false;
  try{
   const files=await finaliseNoticeResponse(sb,submission.id);
   documentsSaved=true;
   try{const delivery=await emailFinalisedResponse(sb,files);emailed=delivery.ownerEmailed===true;surveyorNotified=delivery.surveyorNotified===true;boNotified=delivery.boNotified===true;}
   catch(deliveryError){console.error('notice-response-email:',deliveryError.message);}
  }catch(documentError){console.error('notice-response-documents:',documentError.message);}
  return respond(res,200,{verified:true,signedAt:now,projectUpdated,documentsSaved,emailed,surveyorNotified,boNotified,
   message:documentsSaved?'Your response has been verified and filed':'Your response was verified. Document generation is pending.'});
 }catch(e){console.error('notice-response-verify:',e.message);return respond(res,500,{error:'Could not verify response'});}
}
