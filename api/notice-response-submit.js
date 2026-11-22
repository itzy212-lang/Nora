import { createClient } from '@supabase/supabase-js';
import { createHash, randomInt } from 'node:crypto';
import { sendNoticeEmail } from './_lib/notice-response-mail.js';
const sha = value => createHash('sha256').update(value).digest('hex');
const reply=(res,status,body)=>res.status(status).json(body);
const choices=new Set(['consent','consent_soc','dissent_agreed','dissent_own','section1_agree','section1_refuse']);
function db(){
 const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error('Database not configured');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function getLink(sb,token){
 const {data,error}=await sb.from('notice_response_links')
 .select('id,notice_id,user_id,revoked_at,expires_at,notices(section_1,section_2,section_3,section_6,section_10,status)')
 .eq('token_hash',sha(token)).maybeSingle();
 if(error||!data||data.revoked_at||(data.expires_at&&Date.parse(data.expires_at)<Date.now())||data.notices?.status!=='served')return null;
 return data;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return reply(res,405,{error:'Method not allowed'});
 try{
  const {token,choice,astrideConsent,name,email,surveyor,appointServingSurveyor,authorised}=req.body||{};
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(token))return reply(res,404,{error:'Notice unavailable'});
  if(!choices.has(choice)||typeof name!=='string'||name.trim().length<2||name.length>180||
    typeof email!=='string'||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||authorised!==true)
    return reply(res,400,{error:'Complete all required response and signature fields'});
  if(choice==='dissent_own'&&(!surveyor||typeof surveyor.name!=='string'||!surveyor.name.trim()||
    typeof surveyor.email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(surveyor.email)))
    return reply(res,400,{error:'Appointed surveyor name and email required'});
  const sb=db(),link=await getLink(sb,token);
  if(!link)return reply(res,404,{error:'Notice unavailable'});
  // Section 1(2) is agreement to build astride the line of junction, not a generic consent/dissent.
  const section1Choice=choice==='section1_agree'||choice==='section1_refuse';
  if(section1Choice&&!link.notices.section_1)return reply(res,400,{error:'Section 1(2) response is not available for this notice'});

  if(link.notices.section_1 && ['consent','consent_soc'].includes(choice) && !['agree','refuse'].includes(astrideConsent))
    return reply(res,400,{error:'Confirm whether you consent to building astride the boundary'});
  let recordedSurveyor=surveyor;
  if(choice==='dissent_agreed'&&appointServingSurveyor===true){
    const {data:firm,error:firmError}=await sb.from('firm_settings')
      .select('surveyor_name,firm_name,email,tel').eq('user_id',link.user_id).maybeSingle();
    if(firmError)throw firmError;
    if(!firm?.surveyor_name)return reply(res,400,{error:'The serving surveyor has not been configured in Nora settings'});
    recordedSurveyor={name:firm.surveyor_name,firm:firm.firm_name||'',email:firm.email||'',phone:firm.tel||''};
  }
  await sb.from('notice_response_submissions').delete().eq('link_id',link.id)
   .eq('status','pending_verification').lt('verification_expires_at',new Date().toISOString());
  const {count}=await sb.from('notice_response_submissions').select('id',{count:'exact',head:true})
   .eq('link_id',link.id).gte('submitted_at',new Date(Date.now()-3600000).toISOString());
  if((count||0)>=5)return reply(res,429,{error:'Too many attempts. Please try again later'});
  const {data:completed}=await sb.from('notice_response_submissions').select('id')
   .eq('link_id',link.id).in('status',['verified','finalised']).limit(1);
  if(completed?.length)return reply(res,409,{error:'This notice already has a verified response'});
  const code=String(randomInt(100000,1000000));
  const verificationHash=sha(link.id+':'+email.toLowerCase()+':'+code);
  const {data:submission,error:insertError}=await sb.from('notice_response_submissions').insert({
   link_id:link.id,choice,signer_name:name.trim(),signer_email:email.trim().toLowerCase(),
   surveyor:['dissent_own','dissent_agreed'].includes(choice)&&recordedSurveyor?.name?.trim()?{name:String(recordedSurveyor.name).slice(0,180),firm:String(recordedSurveyor.firm||'').slice(0,180),email:String(recordedSurveyor.email||'').slice(0,254),phone:String(recordedSurveyor.phone||'').slice(0,80),address:String(recordedSurveyor.address||'').slice(0,400)}:null,
   verification_hash:verificationHash,verification_expires_at:new Date(Date.now()+10*60000).toISOString(),
   audit:{consent_to_electronic_signature:true,notice_id:link.notice_id,appoint_serving_surveyor:choice==='dissent_agreed'&&appointServingSurveyor===true,section1_astride_consent:link.notices.section_1&&['consent','consent_soc'].includes(choice)?astrideConsent:null}
  }).select('id').single();
  if(insertError){if(insertError.code==='23505')return reply(res,409,{error:'A verification code is already pending for this email address'});throw insertError;}
  const result=await sendNoticeEmail({userId:link.user_id,to:[email.trim()],
   subject:'NORA notice response verification code',
   text:'Your NORA verification code is '+code+'. It expires in 10 minutes. If you did not request this, ignore this email.'});
  if(!result.sent){await sb.from('notice_response_submissions').delete().eq('id',submission.id);
   return reply(res,503,{error:'Could not send verification email. Connect your Outlook account in NORA.'});}
  return reply(res,202,{submissionId:submission.id,message:'Verification code sent'});
 }catch(e){console.error('notice-response-submit:',e.message);return reply(res,500,{error:'Unable to start verification'});}
}
