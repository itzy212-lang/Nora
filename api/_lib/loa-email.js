import { createClient } from '@supabase/supabase-js';
import { sendNoticeEmail } from './notice-response-mail.js';

import { buildFirmSignatureHTML } from '../../src/utils/emailSignature.js';
import { escapeHtml } from '../../src/utils/formatters.js';
export function renderNoraEmail(text,firm){
 if(!firm)throw Error('Configured firm signature unavailable');
 const inlineImages=[];
 const signature=buildFirmSignatureHTML(firm).replace(/src="data:(image\/[a-zA-Z0-9.+-]+);base64,([^"]+)"/g,(_,type,content)=>{
  const cid='nora-signature-'+inlineImages.length;
  inlineImages.push({filename:cid+'.'+(type==='image/jpeg'?'jpg':type.split('/')[1]),contentType:type,content:content.replace(/\s/g,''),cid});
  return 'src="cid:'+cid+'"';
 });
 const html=escapeHtml(String(text||'').trim()+'\n\nKind regards,\n\nNora on behalf of Itzik Darel').replace(/\n/g,'<br>')+'<br><br>'+signature;
 return {html,inlineImages};
}
export async function sendLOAEmail({userId,to,subject,text,attachments=[]}){
 const sb=createClient(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:firm,error}=await sb.from('firm_settings').select('surveyor_name,qualifications,firm_name,trading_name,email,tel,address_line1,address_line2,city,postcode,website,signature_b64,logo_base64,accreditation_b64').eq('user_id',userId).maybeSingle();
 if(error)throw error;
 const {html,inlineImages}=renderNoraEmail(text,firm);
 return sendNoticeEmail({userId,to,subject,html,attachments,inlineImages});
}
