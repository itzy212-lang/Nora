import { createClient } from '@supabase/supabase-js';
import { createHash, timingSafeEqual } from 'node:crypto';
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
  const {data:link}=await sb.from('notice_response_links').select('id,revoked_at,expires_at')
   .eq('token_hash',sha(token)).maybeSingle();
  if(!link||link.revoked_at||(link.expires_at&&Date.parse(link.expires_at)<Date.now()))
   return respond(res,404,{error:'Notice unavailable'});
  const {data:submission}=await sb.from('notice_response_submissions')
   .select('id,link_id,signer_email,verification_hash,verification_expires_at,verification_attempts,status,audit')
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
  const {error}=await sb.from('notice_response_submissions').update({
   email_verified_at:now,signed_at:now,status:'verified',verification_hash:null,
   audit:{...submission.audit,verification_method:'email_otp',verified_at:now,signed_at:now}
  }).eq('id',submission.id).eq('status','pending_verification');
  if(error){if(error.code==='23505')return respond(res,409,{error:'This notice already has a verified response'});throw error;}
  return respond(res,200,{verified:true,signedAt:now,message:'Your response has been verified and recorded'});
 }catch(e){console.error('notice-response-verify:',e.message);return respond(res,500,{error:'Could not verify response'});}
}
