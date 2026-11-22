/**
 * Apply a verified public response to the exact AO card named on the served notice.
 * This is called only after email OTP verification; never from an unverified form.
 */
export async function updateProjectFromVerifiedNotice(sb,{linkId,userId,choice,surveyor,appointServingSurveyor}){
  const {data:link,error:linkError}=await sb.from('notice_response_links')
    .select('notice_id,notices(project_id,ao_id,user_id)').eq('id',linkId).single();
  if(linkError)throw linkError;
  const notice=link?.notices;
  if(!notice?.project_id||!notice?.ao_id||notice.user_id!==userId)throw Error('Notice project or adjoining owner is not linked');
  const {data:project,error:projectError}=await sb.from('projects')
    .select('id,aos').eq('id',notice.project_id).eq('user_id',userId).single();
  if(projectError)throw projectError;
  if(!Array.isArray(project.aos))throw Error('Project adjoining owners are unavailable');
  const index=project.aos.findIndex(a=>String(a.id)===String(notice.ao_id));
  if(index<0)throw Error('The served notice adjoining owner was not found in this project');
  const aos=[...project.aos];
  const ao={...aos[index]};
  const dissent=choice==='dissent_own'||choice==='dissent_agreed';
  const consent=choice==='consent'||choice==='consent_soc';
  if(!dissent&&!consent)throw Error('Unsupported notice response');
  ao.status=dissent?'dissent':'consent';
  ao.last_status_change=new Date().toISOString();
  if(dissent){
    const date=new Date().toISOString().slice(0,10);
    ao.dissent_received_date=date;
    ao.dissentReceivedDate=date;
    ao.s10_deadline='';ao.s10Deadline='';
    ao.consent_deadline='';ao.consentDeadline='';
  }else{
    const date=new Date().toISOString().slice(0,10);
    ao.consent_received_date=date;
    ao.consentReceivedDate=date;
  }
  if(consent){
    ao.soc_required=choice==='consent_soc';
    ao.agreed_surveyor=false;
    ao.agreedSurveyor=false;
    ao.appointed_by_me=false;
  }else{
    const agreed=choice==='dissent_agreed'&&appointServingSurveyor;
    ao.agreed_surveyor=agreed;
    ao.agreedSurveyor=agreed;
    ao.appointed_by_me=agreed;
    if(surveyor?.name){
      ao.surv_name=surveyor.name;
      ao.surveyorName=surveyor.name;
      ao.surv_firm=surveyor.firm||'';
      ao.surveyorFirm=surveyor.firm||'';
      ao.surv_email=surveyor.email||'';
      ao.surveyorEmail=surveyor.email||'';
      ao.surv_phone=surveyor.phone||'';
      ao.surveyorPhone=surveyor.phone||'';
    }
    // A proposed agreed surveyor is not a confirmed agreed appointment.
    if(choice==='dissent_agreed'&&!agreed)ao.agreed_surveyor_proposed=true;
  }
  ao.notice_response_verified_at=new Date().toISOString();
  aos[index]=ao;
  const {data:updated,error:updateError}=await sb.from('projects').update({aos})
    .eq('id',project.id).eq('user_id',userId).select('id');
  if(updateError)throw updateError;
  if(!updated?.length)throw Error('Project card was not updated');
  return true;
}
