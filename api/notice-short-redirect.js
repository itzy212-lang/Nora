import { createClient } from '@supabase/supabase-js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).end();
 const slug=String(req.query.slug||'');
 if(!/^[A-Z0-9-]{8,90}$/.test(slug))return res.status(404).end();
 try{
  const sb=createClient(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await sb.from('notice_response_short_links').select('response_token,token_hash,notice_response_links(revoked_at,expires_at)').eq('slug',slug).maybeSingle();
  if(error||!data?.response_token||data.notice_response_links?.revoked_at||(data.notice_response_links?.expires_at&&Date.parse(data.notice_response_links.expires_at)<Date.now()))return res.status(404).end();
  res.setHeader('Location','/respond/'+data.response_token);
  return res.status(302).end();
 }catch(e){console.error('short notice link:',e.message);return res.status(500).end();}
}