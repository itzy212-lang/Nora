import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

const sha256 = s => createHash('sha256').update(s).digest('hex');
const respond = (res, status, body) => res.status(status).json(body);
function client() {
 const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
 if (!url || !key) throw new Error('Missing server configuration');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export default async function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 if (req.method !== 'GET') return respond(res,405,{error:'Method not allowed'});
 const token = req.query.token;
 if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(token))
   return respond(res,404,{error:'Notice unavailable'});
 try {
  const sb=client();
  const {data:link,error}=await sb.from('notice_response_links')
   .select('id,notice_id,pdf_bucket,pdf_path,original_pdf_sha256,expires_at,revoked_at,notices(id,section_1,section_2,section_3,section_6,section_10,status)')
   .eq('token_hash',sha256(token)).maybeSingle();
  if(error || !link || link.revoked_at || (link.expires_at && new Date(link.expires_at)<new Date()) || link.notices?.status!=='served')
    return respond(res,404,{error:'Notice unavailable'});
  const {data:file,error:downloadError}=await sb.storage.from(link.pdf_bucket).download(link.pdf_path);
  if(downloadError || !file) return respond(res,404,{error:'Notice document unavailable'});
  const bytes=Buffer.from(await file.arrayBuffer());
  if(sha256(bytes)!==link.original_pdf_sha256) return respond(res,409,{error:'The served notice document has changed'});
  const {data:signed,error:signError}=await sb.storage.from(link.pdf_bucket).createSignedUrl(link.pdf_path,300);
  if(signError || !signed) throw signError || new Error('Could not sign URL');
  return respond(res,200,{notice:{id:link.notice_id,reference:'Party Wall Notice',pdfUrl:signed.signedUrl,sections:{section1:link.notices.section_1,section2:link.notices.section_2,section3:link.notices.section_3,section6:link.notices.section_6,section10:link.notices.section_10}}});
 }catch(e){console.error('notice-response-public:',e.message);return respond(res,500,{error:'Notice temporarily unavailable'});}
}
