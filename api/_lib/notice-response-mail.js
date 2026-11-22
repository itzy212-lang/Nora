import { getValidMicrosoftToken } from '../onedrive-helper.js';
import { createClient } from '@supabase/supabase-js';

/** Uses the NORA user's existing Outlook connection; never sends through another user's account. */
export async function sendNoticeEmail({ userId, to, subject, text, attachments = [] }) {
 const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await sb.auth.admin.getUserById(userId);
 if(error||!user?.email)return {sent:false,reason:'Notice owner email unavailable'};
 // NORA stores Outlook connections against the account email, not the auth UUID.
 const token = await getValidMicrosoftToken(user.email);
 if (!token) return { sent: false, reason: 'Outlook account not connected or requires reconnect' };
 const recipients = [...new Set(to.map(x => String(x).trim().toLowerCase()))].filter(x=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
 if (!recipients.length) throw Error('No valid email recipients');
 const message = {
  subject,
  body: { contentType: 'Text', content: text },
  toRecipients: recipients.map(address => ({ emailAddress: { address } })),
  attachments: attachments.map(a => ({
   '@odata.type': '#microsoft.graph.fileAttachment',
   name: a.filename,
   contentType: 'application/pdf',
   contentBytes: a.content
  }))
 };
 const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
  method:'POST',
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({message,saveToSentItems:true})
 });
 if(!response.ok){
  console.error('notice email Microsoft Graph error',response.status);
  return {sent:false,reason:'Microsoft Graph returned '+response.status};
 }
 return {sent:true};
}
