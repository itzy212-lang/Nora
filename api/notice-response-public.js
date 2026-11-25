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
   .select('id,user_id,notice_id,pdf_bucket,pdf_path,original_pdf_sha256,expires_at,revoked_at,notices(id,section_1,section_2,section_3,section_6,section_10,status)')
   .eq('token_hash',sha256(token)).maybeSingle();
  if(error || !link || link.revoked_at || (link.expires_at && new Date(link.expires_at)<new Date()))
    return respond(res,404,{error:'Notice unavailable'});
  const {data:archives,error:archiveError}=await sb.from('notice_response_archives')
   .select('notice_id,pdf_bucket,pdf_path,pdf_sha256,archived_at,notices(id,status,section_1,section_2,section_3,section_6,section_10)')
   .eq('link_id',link.id).order('archived_at',{ascending:false});
  if(archiveError)throw archiveError;
  const current=(archives||[]).find(a=>a.notices?.status==='served');
  // Legacy notices created before the per-owner archive table remain readable.
  const active=current||((link.notices?.status==='served'&&link.pdf_path)?{
   notice_id:link.notice_id,pdf_bucket:link.pdf_bucket,pdf_path:link.pdf_path,pdf_sha256:link.original_pdf_sha256,notices:link.notices
  }:null);
  if(!active)return respond(res,404,{error:'Notice unavailable'});
  if (typeof req.query.surveyorSearch === 'string') {
    const query = req.query.surveyorSearch.trim().slice(0,80);
    if(query.length<2) return respond(res,200,{surveyors:[]});
    const {data:matches,error:contactsError}=await sb.from('contacts')
      .select('id,name,firm,email,phone').eq('user_id',link.user_id).eq('type','surveyor')
      .or('name.ilike.%'+query.replace(/[%_,().]/g,'')+'%,firm.ilike.%'+query.replace(/[%_,().]/g,'')+'%').order('name').limit(8);
    if(contactsError)throw contactsError;
    return respond(res,200,{surveyors:matches||[]});
  }
  const {data:firm}=await sb.from('firm_settings').select('firm_name,surveyor_name,email,tel,logo_base64,logo_url').eq('user_id',link.user_id).maybeSingle();
  const rawLogo=firm?.logo_base64||firm?.logo_url||'';
  const firmLogoUrl=rawLogo ? (/^(data:image\/|https?:\/\/)/.test(rawLogo) ? rawLogo : 'data:image/png;base64,'+rawLogo) : null;
  const {data:completed,error:completedError}=await sb.from('notice_response_submissions')
   .select('choice,signer_name,signed_at,status').eq('link_id',link.id)
   .in('status',['verified','finalised']).order('signed_at',{ascending:false}).limit(1);
  if(completedError)throw completedError;
  const {data:file,error:downloadError}=await sb.storage.from(active.pdf_bucket).download(active.pdf_path);
  if(downloadError || !file) return respond(res,404,{error:'Notice document unavailable'});
  const bytes=Buffer.from(await file.arrayBuffer());
  if(sha256(bytes)!==active.pdf_sha256) return respond(res,409,{error:'The served notice document has changed'});
  const {data:signed,error:signError}=await sb.storage.from(active.pdf_bucket).createSignedUrl(active.pdf_path,300);
  if(signError || !signed) throw signError || new Error('Could not sign URL');
  return respond(res,200,{notice:{id:active.notice_id,firmName:firm?.firm_name||null,firmLogoUrl,servingSurveyor:{name:firm?.surveyor_name||'',firm:firm?.firm_name||'',email:firm?.email||'',phone:firm?.tel||''},reference:'Party Wall Notice',pdfUrl:signed.signedUrl,
   existingResponse:completed?.[0]?{choice:completed[0].choice,signerName:completed[0].signer_name,signedAt:completed[0].signed_at}:null,
   sections:{section1:active.notices.section_1,section2:active.notices.section_2,section3:active.notices.section_3,section6:active.notices.section_6,section10:active.notices.section_10}}});
 }catch(e){console.error('notice-response-public:',e.message);return respond(res,500,{error:'Notice temporarily unavailable'});}
}
