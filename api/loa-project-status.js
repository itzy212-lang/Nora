import { createClient } from '@supabase/supabase-js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{
 const token=/^Bearer (.+)$/i.exec(req.headers.authorization||'')?.[1];
 if(!token)return res.status(401).json({error:'Sign in required'});
 const sb=createClient(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
 const {data:{user},error}=await sb.auth.getUser(token);
 if(error||!user)return res.status(401).json({error:'Invalid session'});
 const {data:project}=await sb.from('projects').select('id,user_id').eq('id',req.query.project_id).maybeSingle();
 if(!project||project.user_id!==user.id)return res.status(403).json({error:'Project not accessible'});
 const {data,error:err}=await sb.from('loa_signing_requests').select('id,appointment_type,status,created_at,loa_signers(position,name,email,status)').eq('project_id',project.id).eq('user_id',user.id).in('status',['pending','completed']).order('created_at',{ascending:false});
 if(err)throw err;
 return res.status(200).json({requests:data||[]});
 }catch(e){console.error('[loa-project-status]',e);return res.status(500).json({error:'Unable to load signing status'});}
}
