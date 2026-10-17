// Which mail provider and which storage provider this user has, so every
// attachment feature behaves the same for every account: mail comes from
// Outlook or Gmail, files go to OneDrive or Google Drive (set independently in
// user_integrations). The client sends user_id (the email, which OneDrive/Outlook
// tokens are keyed by) and user_uuid (which Google tokens and user_integrations
// are keyed by).

export async function getProviderContext({ sb, userEmail, userUuid }) {
  let integ = null;
  if (sb && userUuid) {
    const { data } = await sb.from('user_integrations').select('*').eq('user_id', userUuid).maybeSingle();
    integ = data || null;
  }
  return {
    sb, userEmail: userEmail || null, userUuid: userUuid || null, integ,
    mail: integ?.email_provider === 'gmail' ? 'gmail' : 'outlook',
    storage: integ?.storage_provider === 'googledrive' ? 'googledrive' : 'onedrive',
  };
}
