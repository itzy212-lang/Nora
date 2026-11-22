import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { loaHash, loaTokenHash } from './_lib/loa-signing.js';
import { sendLOAEmail } from './_lib/loa-email.js';
const db=()=>createClient(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 try{
  const {token,signature,signedDate,authorised}=req.body||{};
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(token)||authorised!==true||typeof signature!=='string'||signature.trim().length<2||signature.length>180||!/^\d{4}-\d{2}-\d{2}$/.test(signedDate||'')||!Number.isFinite(Date.parse(signedDate)))return res.status(400).json({error:'Enter your signature, date and confirm your authority'});
  const sb=db(),{data:s}=await sb.from('loa_signers').select('id,request_id,position,name,email,status,loa_signing_requests(user_id,status)').eq('token_hash',loaTokenHash(token)).maybeSingle();
  if(!s||!['invited','pending_verification'].includes(s.status)||s.loa_signing_requests?.status!=='pending')return res.status(409).json({error:'This invitation is not available for signing'});
  const code=String(randomInt(100000,1000000));
  const hash=loaHash(Buffer.from(s.id+':'+s.email+':'+code));
  const {data:updated,error}=await sb.from('loa_signers').update({signature:signature.trim(),signed_date:signedDate,otp_hash:hash,otp_expires_at:new Date(Date.now()+10*60_000).toISOString(),otp_attempts:0,status:'pending_verification',audit:{user_agent:String(req.headers['user-agent']||'').slice(0,350),submitted_at:new Date().toISOString()}}).eq('id',s.id).in('status',['invited','pending_verification']).select('id').maybeSingle();
  if(error||!updated)return res.status(409).json({error:'This invitation has already been completed'});
  const sent=await sendLOAEmail({userId:s.loa_signing_requests.user_id,to:[s.email],subject:'Nora: Verify your LOA signature',text:'Dear '+s.name.split(' ')[0]+',\n\nYour verification code is '+code+'.\n\nEnter this code on the LOA signing page to confirm your signature. The code expires in 10 minutes.'});
  if(!sent.sent)return res.status(502).json({error:'Could not deliver verification email: '+sent.reason});
  return res.status(200).json({success:true});
 }catch(e){console.error('[loa-submit]',e);return res.status(500).json({error:'Could not request verification'});}
}
