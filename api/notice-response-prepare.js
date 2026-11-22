import { createClient } from '@supabase/supabase-js';
import { randomBytes,createHash } from 'node:crypto';
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
  const {data:project}=await sb.from('projects').select('id,user_id').eq('id',projectId).maybeSingle();
  if(!project||String(project.user_id)!==user.id)return res.status(403).json({error:'Project access denied'});
  let notice;
  if(noticeId){
   const {data}=await sb.from('notices').select('id,user_id,project_id,ao_id,status')
    .eq('id',noticeId).eq('project_id',projectId).eq('ao_id',aoId).eq('user_id',user.id).maybeSingle();
   if(!data||data.status==='served')return res.status(409).json({error:'Existing notice cannot be prepared'});
   notice=data;
  }else{
   const {data,error}=await sb.from('notices').insert({
    project_id:projectId,ao_id:aoId,user_id:user.id,status:'draft',notice_date:noticeDate,
    section_1:sections.includes('s1'),section_2:sections.includes('s2'),
    section_3:sections.includes('s3'),section_6:sections.includes('s6'),section_10:sections.includes('s10'),
    template_type:'notice_pack'
   }).select('id').single();
   if(error)throw error;
   notice=data;
  }
  const token=randomBytes(24).toString('base64url');
  const {error:linkError}=await sb.from('notice_response_links').insert({
   notice_id:notice.id,user_id:user.id,token_hash:hash(token)
  });
  if(linkError)throw linkError;
  return res.status(201).json({noticeId:notice.id,url:'https://notices.sq1consulting.co.uk/respond/'+token,token});
 }catch(error){console.error('notice-prepare:',error.message);return res.status(500).json({error:'Unable to prepare response link'});}
}
