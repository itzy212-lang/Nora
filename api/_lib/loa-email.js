import { createClient } from '@supabase/supabase-js';
import { sendNoticeEmail } from './notice-response-mail.js';

// Server-side equivalent of src/utils/emailSignature.js, using the user's saved firm settings.
const esc=v=>String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const imageSrc=v=>!v?'':String(v).startsWith('data:')?String(v):'data:image/png;base64,'+v;
function firmSignature(s={},images={}){
 const firmName=s.firm_name||s.trading_name||'Square One Consulting',address=[s.address_line1,s.address_line2,s.city,s.postcode].filter(Boolean).join(' | ');
 const signature=images.signature||'',logo=images.logo||'',accreditation=images.accreditation||'';
 let html='<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1a1a1a;line-height:1.55">';
 if(signature)html+='<div style="margin-bottom:8px"><img src="'+esc(signature)+'" style="max-height:60px;max-width:220px;object-fit:contain;display:block" /></div>';
 if(s.surveyor_name)html+='<div style="font-weight:700;font-size:14px;margin-bottom:1px">'+esc(s.surveyor_name)+'</div>';
 if(s.qualifications)html+='<div style="font-size:12px;color:#555;margin-bottom:6px">'+esc(s.qualifications)+'</div>';
 if(logo)html+='<div style="margin:6px 0 8px 0"><img src="'+esc(logo)+'" style="max-height:52px;max-width:190px;object-fit:contain;display:block" /></div>';
 if(firmName)html+='<div style="font-weight:700;font-size:13px;margin-bottom:2px">'+esc(firmName)+'</div>';
 if(s.tel)html+='<div style="font-size:12.5px;color:#555">Tel | '+esc(s.tel)+'</div>';
 if(s.email)html+='<div style="font-size:12.5px;color:#555">Email | <a href="mailto:'+esc(s.email)+'" style="color:#4f7fff">'+esc(s.email)+'</a></div>';
 if(s.website)html+='<div style="font-size:12.5px"><a href="'+esc(s.website)+'" style="color:#4f7fff">'+esc(s.website)+'</a></div>';
 if(address)html+='<div style="font-size:12.5px;color:#555;margin-top:2px">'+esc(address)+'</div>';
 if(accreditation)html+='<div style="margin-top:10px"><img src="'+esc(accreditation)+'" style="max-height:46px;max-width:260px;object-fit:contain;display:block" /></div>';
 return html+'</div>';
}
export async function sendLOAEmail({userId,to,subject,text,attachments=[]}){
 const sb=createClient(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:firm,error}=await sb.from('firm_settings').select('surveyor_name,qualifications,firm_name,trading_name,email,tel,address_line1,address_line2,city,postcode,website,signature_b64,logo_base64,accreditation_b64').eq('user_id',userId).maybeSingle();
 if(error)throw error;
 const inlineImages=[]; const images={};
 for(const [key,field] of [['signature','signature_b64'],['logo','logo_base64'],['accreditation','accreditation_b64']]){
  const raw=firm?.[field]; if(!raw)continue;
  const value=String(raw),match=value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
  const content=match?match[2]:value;
  if(!/^[A-Za-z0-9+/=\s]+$/.test(content))continue;
  const cid='nora-loa-'+key;
  inlineImages.push({filename:key+'.png',contentType:match?.[1]||'image/png',content:content.replace(/\s/g,''),cid});
  images[key]='cid:'+cid;
 }
 const html='<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">'+esc(text).replace(/\\n/g,'\n').replace(/\n/g,'<br>')+'</div><div style="margin-top:18px">'+firmSignature(firm||{},images)+'</div>';
 return sendNoticeEmail({userId,to,subject,html,attachments,inlineImages});
}
