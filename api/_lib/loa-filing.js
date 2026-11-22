import { getProjectFolderInfo, getAoFolderInfo, uploadToOneDrive } from '../onedrive-helper.js';
import { createClient } from '@supabase/supabase-js';
const db=()=>createClient(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
export async function fileCompletedLOA({request,signers,final}){
 const sb=db(),isBO=request.appointment_type.startsWith('bo_');
 const {data:{user},error:ue}=await sb.auth.admin.getUserById(request.user_id);
 if(ue||!user?.email)throw Error('Cannot identify connected OneDrive owner');
 const {data:project,error:pe}=await sb.from('projects').select('onedrive_folder_id,bo_premise_address,aos').eq('id',request.project_id).single();
 if(pe||!project?.onedrive_folder_id)throw Error('Project OneDrive folder unavailable');
 let aoId=null,folderId=project.onedrive_folder_id;
 if(!isBO){
  const {data:aos,error:ae}=await sb.from('adjoining_owners').select('id,email,onedrive_folder_id').eq('project_id',request.project_id);
  if(ae)throw ae;
  const embedded=Array.isArray(project.aos)?project.aos:[];
  const candidates=(aos||[]).map(a=>({...a,embedded:embedded.find(e=>String(e.id)===String(a.id))}));
  const norm=v=>String(v||'').trim().toLowerCase();
  const matching=candidates.filter(a=>signers.some(s=>
   (norm(s.email)&&[a.email,a.embedded?.email,a.embedded?.email2].some(e=>norm(e)===norm(s.email))) ||
   (norm(s.name)&&[a.embedded?.name,a.embedded?.name2].some(n=>norm(n)===norm(s.name)))
  ));
  if(matching.length!==1)throw Error('Cannot uniquely identify the adjoining owner for this LOA');
  aoId=matching[0].id;
  folderId=matching[0].onedrive_folder_id||matching[0].embedded?.onedrive_folder_id;
  if(!folderId||folderId===project.onedrive_folder_id)throw Error('Adjoining Owner has no separate OneDrive folder');
 }
 const fileName=(isBO?'Building Owner':'Adjoining Owner')+' - Signed Letter of Appointment - '+request.id.slice(0,8)+'.pdf';
 const existing=await sb.from('documents').select('id,metadata').eq('project_id',request.project_id).eq('file_name',fileName).maybeSingle();
 if(existing.error)throw existing.error;
 if(existing.data?.metadata?.onedrive_item_id)return existing.data;
 const uploaded=await uploadToOneDrive({userId:user.email,folderId,fileName,buffer:final});
 if(!uploaded?.item_id)throw Error('Signed LOA could not be uploaded to OneDrive');
 const payload={project_id:request.project_id,ao_id:aoId,file_name:fileName,file_type:'pdf',category:'loa',section_type:'loa',status:'generated',version:1,storage_path:request.final_path||null,metadata:{loa_request_id:request.id,onedrive_item_id:uploaded.item_id,onedrive_url:uploaded.web_url,appointment_type:request.appointment_type}};
 const {data,error}=existing.data?await sb.from('documents').update(payload).eq('id',existing.data.id).select('id').single():await sb.from('documents').insert(payload).select('id').single();
 if(error)throw error;
 if(isBO)await sb.from('projects').update({bo_loa_signed_at:request.completed_at||new Date().toISOString(),bo_loa_signed_pdf_url:uploaded.web_url}).eq('id',request.project_id);
 else await sb.from('adjoining_owners').update({loa_signed_at:request.completed_at||new Date().toISOString(),loa_signed_pdf_url:uploaded.web_url}).eq('id',aoId);
 return data;
}
