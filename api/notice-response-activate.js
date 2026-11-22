import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 try{
  const auth=/^Bearer (.+)$/i.exec(req.headers.authorization||'');
  if(!auth)return res.status(401).json({error:'Sign in required'});
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data:{user}}=await sb.auth.getUser(auth[1]);
  if(!user)return res.status(401).json({error:'Invalid session'});
  const {noticeId,token,pdfB64}=req.body||{};
  if(typeof noticeId!=='string'||typeof token!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(token)||
     typeof pdfB64!=='string'||pdfB64.length>4500000)
   return res.status(400).json({error:'Invalid or oversized notice PDF'});
  const {data:link}=await sb.from('notice_response_links').select('id,notice_id,user_id,pdf_path')
   .eq('notice_id',noticeId).eq('user_id',user.id).eq('token_hash',sha(token)).is('revoked_at',null).maybeSingle();
  const {data:notice}=await sb.from('notices').select('id,user_id,project_id,status')
   .eq('id',noticeId).eq('user_id',user.id).maybeSingle();
  if(!link||!notice)return res.status(403).json({error:'Notice access denied'});
  if(link.pdf_path)return res.status(409).json({error:'Original served notice is already archived'});
  const bytes=Buffer.from(pdfB64,'base64');
  if(bytes.length<20||bytes.subarray(0,5).toString()!=='%PDF-')return res.status(400).json({error:'Invalid PDF'});
  const path=notice.project_id+'/served-notices/'+noticeId+'.pdf';
  const {error:uploadError}=await sb.storage.from('documents').upload(path,bytes,{contentType:'application/pdf',upsert:false});
  if(uploadError)throw uploadError;
  const {error:linkError}=await sb.from('notice_response_links').update({
   pdf_bucket:'documents',pdf_path:path,original_pdf_sha256:sha(bytes),original_pdf_bytes:bytes.length
  }).eq('id',link.id).is('pdf_path',null);
  if(linkError)throw linkError;
  return res.status(200).json({success:true,noticeId,pdfSha256:sha(bytes)});
 }catch(error){console.error('notice-activate:',error.message);return res.status(500).json({error:'Could not archive original served notice'});}
}
