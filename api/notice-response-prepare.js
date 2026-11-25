import { createClient } from '@supabase/supabase-js';
import { createHmac,createHash } from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 try{
  const match=/^Bearer (.+)$/i.exec(req.headers.authorization||'');
  if(!match)return res.status(401).json({error:'Sign in required'});
  const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data:{user},error:authError}=await sb.auth.getUser(match[1]);
  if(authError||!user)return res.status(401).json({error:'Invalid session'});
  const {projectId,aoId,sections,noticeDate,noticeId}=req.body||{};
  if(typeof projectId!=='string'||typeof aoId!=='string'||!Array.isArray(sections)||!sections.length||
     !sections.every(s=>['s1','s2','s3','s6','s10'].includes(s))||!/^\d{4}-\d{2}-\d{2}$/.test(noticeDate||''))
   return res.status(400).json({error:'Invalid notice details'});
  const {data:project}=await sb.from('projects').select('id,user_id,aos').eq('id',projectId).maybeSingle();
  if(!project||String(project.user_id)!==user.id)return res.status(403).json({error:'Project access denied'});
  let notice;
  if(noticeId){
   const {data}=await sb.from('notices').select('id,user_id,project_id,ao_id,status')
    .eq('id',noticeId).eq('project_id',projectId).eq('ao_id',aoId).eq('user_id',user.id).maybeSingle();
   if(!data||data.status==='served')return res.status(409).json({error:'Existing notice cannot be prepared'});
   notice=data;
  }else{
   const {data:runs,error:runsError}=await sb.from('notices').select('run_number')
    .eq('project_id',projectId).eq('ao_id',aoId).order('run_number',{ascending:false}).limit(1);
   if(runsError)throw runsError;
   const runNumber=(Number(runs?.[0]?.run_number)||0)+1;
   const {data,error}=await sb.from('notices').insert({
    project_id:projectId,ao_id:aoId,user_id:user.id,status:'draft',notice_date:noticeDate,run_number:runNumber,
    section_1:sections.includes('s1'),section_2:sections.includes('s2'),
    section_3:sections.includes('s3'),section_6:sections.includes('s6'),section_10:sections.includes('s10'),
    template_type:'notice_pack'
   }).select('id').single();
   if(error)throw error;
   notice=data;
  }
  const secret=process.env.NOTICE_RESPONSE_LINK_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!secret)throw Error('Response link signing key missing');
  // One unguessable, stable link per adjoining owner within a project.
  const token=createHmac('sha256',secret).update(JSON.stringify([user.id,projectId,aoId])).digest('base64url').slice(0,32);
  const {data:existing,error:lookupError}=await sb.from('notice_response_links').select('id').eq('token_hash',hash(token)).is('revoked_at',null).maybeSingle();
  if(lookupError)throw lookupError;
  if(!existing){
   const {error:linkError}=await sb.from('notice_response_links').insert({notice_id:notice.id,user_id:user.id,token_hash:hash(token)});
   if(linkError&&linkError.code!=='23505')throw linkError;
  }
  const {data:settings,error:settingsError}=await sb.from('firm_settings').select('notice_response_domain,notice_response_domain_verified').eq('user_id',user.id).maybeSingle();
  if(settingsError)throw settingsError;
  const domain=settings?.notice_response_domain_verified&&/^[a-z0-9.-]+$/.test(settings.notice_response_domain||'')?settings.notice_response_domain:'nora-d9wy.vercel.app';
  const ao=(Array.isArray(project.aos)?project.aos:[]).find(item=>String(item.id||item.num||'')===aoId);
  const address=String(ao?.address||ao?.premise||ao?.service_address||'');
  const postcode=(address.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i)||[])[0]||'';
  const door=(address.match(/\b\d+[A-Za-z]?\b/)||[])[0]||String(ao?.num||'AO');
  const readable=(door+'-'+(postcode.replace(/\s+/g,'')||'NOTICE')).toUpperCase().replace(/[^A-Z0-9-]/g,'');
  const suffix=createHmac('sha256',secret).update('short:'+token).digest('hex').slice(0,10).toUpperCase();
  const slug=(readable+'-'+suffix).slice(0,90);
  const {data:previous,error:previousError}=await sb.from('notice_response_short_links').select('slug').eq('token_hash',hash(token)).maybeSingle();
  if(previousError)throw previousError;
  if(!previous){
   const {error:aliasError}=await sb.from('notice_response_short_links').insert({slug,token_hash:hash(token),response_token:token,user_id:user.id});
   if(aliasError&&aliasError.code!=='23505')throw aliasError;
  }
  return res.status(201).json({noticeId:notice.id,url:'https://'+domain+'/n/'+(previous?.slug||slug),token});
 }catch(error){console.error('notice-prepare:',error.message);return res.status(500).json({error:'Unable to prepare response link'});}
}
