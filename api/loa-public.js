import { createClient } from '@supabase/supabase-js';
import { loaTokenHash } from './_lib/loa-signing.js';
const db=()=>createClient(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const token=String(req.query.token||'');
 if(!/^[A-Za-z0-9_-]{32}$/.test(token))return res.status(404).json({error:'Link unavailable'});
 try{
  const sb=db(),{data:s}=await sb.from('loa_signers').select('id,request_id,position,name,email,status,verified_at,loa_signing_requests(id,appointment_type,document_name,original_path,partial_path,final_path,status,user_id)').eq('token_hash',loaTokenHash(token)).maybeSingle();
  if(!s)return res.status(404).json({error:'Link unavailable'});
  if(s.status==='waiting')return res.status(409).json({error:'The previous signatory must complete their signature first'});
  const request=s.loa_signing_requests;
  if(request?.status==='cancelled')return res.status(410).json({error:'This appointment was cancelled'});
  if(req.query.pdf==='1'){
   const path=request.status==='completed'&&request.final_path?request.final_path:(request.partial_path||request.original_path);
   const {data,error}=await sb.storage.from('documents').download(path);
   if(error||!data)return res.status(404).json({error:'PDF unavailable'});
   const bytes=Buffer.from(await data.arrayBuffer());
   res.setHeader('Content-Type','application/pdf');
   res.setHeader('Content-Disposition','inline; filename="Letter-of-Appointment.pdf"');
   return res.status(200).send(bytes);
  }
  const {data:firm}=await sb.from('firm_settings').select('firm_name,logo_base64,logo_url').eq('user_id',request.user_id).maybeSingle();
  const rawLogo=firm?.logo_base64||firm?.logo_url||'';
  const firmLogoUrl=rawLogo ? (/^(data:image\\/|https?:\\/\\/)/.test(rawLogo) ? rawLogo : 'data:image/png;base64,'+rawLogo) : null;
  return res.status(200).json({firmName:firm?.firm_name||null,firmLogoUrl,name:s.name,email:s.email,position:s.position,status:s.status,documentName:request.document_name,appointmentType:request.appointment_type,completed:request.status==='completed'});
 }catch(e){return res.status(500).json({error:'Could not load appointment'});}
}
