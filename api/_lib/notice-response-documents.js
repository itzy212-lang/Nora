import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { sendNoticeEmail } from './notice-response-mail.js';
import { uploadToOneDrive, saveDocumentRecord } from '../onedrive-helper.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const choices = {
 consent: 'Consent to the proposed works',
 consent_soc: 'Consent subject to a Schedule of Condition',
 dissent_agreed: 'Dissent and appointment of an agreed surveyor',
 dissent_own: 'Dissent and appointment of an adjoining owner surveyor',
 section1_agree: 'Agreement to build astride the boundary under Section 1(2)',
 section1_refuse: 'No agreement to build astride the boundary under Section 1(2); Section 1(5) applies'
};
const clean = value => String(value ?? '').replace(/[\r\n\t]/g,' ').slice(0,500);
const surveyorDetails = surveyor => {
 if(!surveyor || typeof surveyor!=='object')return clean(surveyor);
 return [
  surveyor.name,
  surveyor.firm,
  surveyor.address,
  surveyor.email ? 'Email: '+surveyor.email : '',
  surveyor.phone ? 'Telephone: '+surveyor.phone : ''
 ].filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()).join('\n');
};
export async function makePdf(title, rows) {
 const doc=await PDFDocument.create();
 let page=doc.addPage([595,842]);
 const font=await doc.embedFont(StandardFonts.Helvetica);
 const bold=await doc.embedFont(StandardFonts.HelveticaBold);
 page.drawText(title,{x:48,y:785,size:18,font:bold,color:rgb(.09,.2,.35)});
 let y=740;
 for(const [label,value] of rows) {
  page.drawText(clean(label),{x:48,y,size:10,font:bold});
  const lines=String(value??'').split(/\r?\n/).flatMap(line=>{
   const words=clean(line).split(' ');
   const result=[];let current='';
   for(const word of words){
    const candidate=current?current+' '+word:word;
    if(font.widthOfTextAtSize(candidate,10)>499&&current){result.push(current);current=word;}
    else current=candidate;
   }
   result.push(current);
   return result;
  });
  for(const line of lines){
   if(y<60){y=740;const next=doc.addPage([595,842]);page=next;}
   page.drawText(line,{x:48,y:y-17,size:10,font});
   y-=16;
  }
  y-=21;
  if(y<60)break;
 }
 return Buffer.from(await doc.save());
}
/** Called only after successful OTP verification. No browser-supplied audit facts. */
export async function finaliseNoticeResponse(sb, submissionId) {
 const {data:record,error}=await sb.from('notice_response_submissions')
  .select('id,link_id,choice,signer_name,signer_email,surveyor,signed_at,email_verified_at,status,audit,notice_response_links(notice_id,user_id,pdf_bucket,pdf_path,original_pdf_sha256,notices(project_id,ao_id))')
  .eq('id',submissionId).single();
 if(error||!record||record.status!=='verified'||!record.email_verified_at)throw Error('Response is not verified');
 const link=record.notice_response_links;
 if(!link?.notices?.project_id)throw Error('Project is missing');
 const projectId=link.notices.project_id;
 const base=projectId+'/notice-responses/'+link.notice_id+'/'+record.id;
 const common=[
  ['Notice ID',link.notice_id],['Project ID',projectId],['Adjoining owner ID',link.notices.ao_id],
  ['Original notice PDF SHA-256',link.original_pdf_sha256],
  ['Response',choices[record.choice]||record.choice],
  ['Signatory',record.signer_name],['Email address',record.signer_email],
  ['Electronic signature',record.signer_name],
  ['Signed at (UTC)',record.signed_at],['Email verified at (UTC)',record.email_verified_at]
 ];
 if(record.surveyor)common.push([record.choice==='dissent_agreed'?'Proposed agreed surveyor':'Appointed surveyor',surveyorDetails(record.surveyor)]);
 const acknowledgement=await makePdf('Party Wall Notice - Response Acknowledgement',common);
 const acknowledgementHash=hash(acknowledgement);
 const certificate=await makePdf('Electronic Signature Audit Certificate',[
  ['Certificate type','NORA self-generated event record, not a qualified independent timestamp'],
  ['Submission ID',record.id],...common,
  ['Acknowledgement SHA-256',acknowledgementHash],
  ['Verification method','Six-digit email one-time code'],
  ['Evidence statement','The email verification event was recorded by NORA at the timestamp above.']
 ]);
 const bucket=link.pdf_bucket;
 const aPath=base+'/acknowledgement.pdf',cPath=base+'/audit-certificate.pdf';
 for(const [path,bytes] of [[aPath,acknowledgement],[cPath,certificate]]) {
  const {error:uploadError}=await sb.storage.from(bucket).upload(path,bytes,{
   contentType:'application/pdf',upsert:false
  });
  if(uploadError && !String(uploadError.message).toLowerCase().includes('already exists'))throw uploadError;
 }
 const {data:projectFolders,error:folderError}=await sb.from('projects').select('aos').eq('id',projectId).single();
 if(folderError)throw folderError;
 const ao=(Array.isArray(projectFolders?.aos)?projectFolders.aos:[]).find(a=>
  String(a.id)===String(link.notices.ao_id)||String(a.num)===String(link.notices.ao_id));
 const folderId=ao?.onedrive_folder_id;
 if(!folderId)throw Error('Specific adjoining owner OneDrive folder is not linked');
 const {data:accountUser}=await sb.auth.admin.getUserById(link.user_id);
 if(!accountUser?.user?.email)throw Error('Notice owner account email missing');
 const saved=[];
 for(const [name,bytes,category] of [
  ['Notice Response - '+record.id+'.pdf',acknowledgement,'notice_response'],
  ['Notice Response Audit - '+record.id+'.pdf',certificate,'notice_response_audit']
 ]){
  const upload=await uploadToOneDrive({userId:accountUser.user.email,folderId,fileName:name,buffer:bytes});
  if(!upload?.item_id)throw Error('Failed to save '+name+' to the adjoining owner OneDrive folder');
  const documentId=await saveDocumentRecord({projectId,aoId:link.notices.ao_id,fileName:name,category,
   mimeType:'application/pdf',oneDriveItemId:upload.item_id,oneDriveUrl:upload.web_url,
   metadata:{notice_id:link.notice_id,submission_id:record.id,notice_sha256:link.original_pdf_sha256}});
  if(!documentId)throw Error('OneDrive file uploaded but NORA document index failed');
  saved.push({name,documentId,oneDriveItemId:upload.item_id,oneDriveUrl:upload.web_url});
 }
 const {error:updateError}=await sb.from('notice_response_submissions').update({
  status:'finalised',acknowledgement_path:aPath,certificate_path:cPath,
  finalised_at:new Date().toISOString(),delivery_status:'pending',
  audit:{...record.audit,original_notice_sha256:link.original_pdf_sha256,
   acknowledgement_sha256:acknowledgementHash,certificate_sha256:hash(certificate),
   acknowledgement_path:aPath,certificate_path:cPath,onedrive_documents:saved}
 }).eq('id',record.id).eq('status','verified');
 if(updateError)throw updateError;
 return {record,link,acknowledgement,certificate,acknowledgementPath:aPath,certificatePath:cPath,oneDriveDocuments:saved};
}
export async function emailFinalisedResponse(sb, result) {
 const {record,link,acknowledgement,certificate,acknowledgementPath,certificatePath,oneDriveDocuments}=result;
 // The adjoining owner receives their signed records. The surveyor receives notification only.
 const ownerDelivery=await sendNoticeEmail({
  userId:link.user_id,
  to:[record.signer_email],
  subject:'Your signed party wall notice response',
  text:'Your response has been signed and verified. Attached are your acknowledgement and electronic signature audit certificate.',
  attachments:[
   {filename:'notice-response-acknowledgement.pdf',content:acknowledgement.toString('base64')},
   {filename:'notice-response-audit-certificate.pdf',content:certificate.toString('base64')}
  ]
 });
 const {data:user}=await sb.auth.admin.getUserById(link.user_id);
 let surveyorDelivery={sent:false,reason:'Surveyor email unavailable'};
 if(user?.user?.email && user.user.email.toLowerCase()!==record.signer_email.toLowerCase()) {
  surveyorDelivery=await sendNoticeEmail({
   userId:link.user_id,
   to:[user.user.email],
   subject:'NORA: Notice response signed and saved',
   text:[
    'An adjoining owner has signed and verified their party wall notice response.',
    '',
    'Project ID: '+link.notices.project_id,
    'Adjoining owner ID: '+(link.notices.ao_id||'Not specified'),
    'Notice ID: '+link.notice_id,
    'Response: '+(choices[record.choice]||record.choice),
    'Signed by: '+record.signer_name,
    'Signed at (UTC): '+record.signed_at,
    '',
    'The signed acknowledgement and audit certificate have been saved in the adjoining owner folder linked to this project in OneDrive and indexed in NORA.',
    ...oneDriveDocuments.map(doc=>doc.name+': '+(doc.oneDriveUrl||'Saved to OneDrive')),
    '',
    'Open the project in NORA to view the saved records.'
   ].join('\n'),
   attachments:[]
  });
 }
 const {data:project,error:projectError}=await sb.from('projects')
  .select('bo_1_name,bo_1_email,bo_2_name,bo_2_email,bo_premise_address')
  .eq('id',link.notices.project_id).maybeSingle();
 if(projectError)console.error('notice-response-bo-project:',projectError.message);
 const boRecipients=[project?.bo_1_email,project?.bo_2_email]
  .filter(value=>typeof value==='string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))
  .map(value=>value.trim().toLowerCase())
  .filter((value,index,array)=>array.indexOf(value)===index);
 let boDelivery={sent:false,reason:'No BO email address recorded on project'};
 if(boRecipients.length){
  boDelivery=await sendNoticeEmail({
   userId:link.user_id,
   to:boRecipients,
   subject:'Party wall notice response received: '+(project.bo_premise_address||'Your property'),
   text:[
    'Please find attached the signed response and confirmation record for the party wall notice relating to '+(project.bo_premise_address||'your property')+'.',
    '',
    'Notice outcome: '+(choices[record.choice]||record.choice),
    'Response signed by: '+record.signer_name,
    'Date and time (UTC): '+record.signed_at,
    '',
    'The signed response and audit certificate have been saved in the relevant adjoining owner file in the project OneDrive folder.',
    '',
    'Your appointed surveyor will advise you of any next steps.'
   ].join('\n'),
   attachments:[
    {filename:'signed-notice-response.pdf',content:acknowledgement.toString('base64')},
    {filename:'notice-response-confirmation.pdf',content:certificate.toString('base64')}
   ]
  });
 }
 await sb.from('notice_response_submissions').update({
  delivery_status:ownerDelivery.sent && surveyorDelivery.sent && (!boRecipients.length || boDelivery.sent) ? 'sent' : 'partial'
 }).eq('id',record.id);
 return {sent:ownerDelivery.sent && surveyorDelivery.sent && (!boRecipients.length || boDelivery.sent),
  ownerEmailed:ownerDelivery.sent,surveyorNotified:surveyorDelivery.sent,
  boNotified:boDelivery.sent,boNotificationConfigured:boRecipients.length>0};
}
