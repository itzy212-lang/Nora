// Shared OneDrive upload helper for all document APIs
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function getValidMicrosoftToken(userId) {
  if (!userId) return null;
  const sb = getSupabase();
  // Single-user system: try exact match first, fall back to any outlook account
  let { data: account } = await sb
    .from('email_accounts')
    .select('*')
    .eq('provider', 'outlook')
    .eq('user_id', userId)
    .maybeSingle();
  if (!account) {
    const { data: fallback } = await sb
      .from('email_accounts')
      .select('*')
      .eq('provider', 'outlook')
      .maybeSingle();
    account = fallback;
  }

  if (!account || account.reconnect_required) return null;

  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (Date.now() > expiresAt - 5 * 60 * 1000) {
    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: account.refresh_token,
        scope: 'offline_access Mail.ReadWrite Mail.Send User.Read Files.ReadWrite',
      }),
    });
    const data = await res.json();
    if (!res.ok) return null;
    await sb.from('email_accounts').update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || account.refresh_token,
      token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    }).eq('id', account.id);
    return data.access_token;
  }
  return account.access_token;
}

export async function getProjectFolderInfo(projectId) {
  if (!projectId) return null;
  const sb = getSupabase();
  const { data } = await sb
    .from('projects')
    .select('onedrive_folder_id, onedrive_folder_url, bo_premise_address')
    .eq('id', projectId)
    .maybeSingle();
  return data || null;
}

export async function getAoFolderInfo(projectId, aoId) {
  if (!projectId) return null;
  const sb = getSupabase();
  const { data: project } = await sb
    .from('projects')
    .select('aos, onedrive_folder_id')
    .eq('id', projectId)
    .maybeSingle();

  if (!project) return null;

  const aos = Array.isArray(project.aos) ? project.aos : [];
  const ao = aos.find(a => a.id === aoId || String(a.num) === String(aoId));
  return {
    folder_id: ao?.onedrive_folder_id || project.onedrive_folder_id || null,
    ao_address: ao?.premise || ao?.address || null,
  };
}

export async function uploadToOneDrive({ userId, folderId, fileName, buffer, mimeType = 'application/pdf' }) {
  if (!userId || !folderId || !buffer) return null;

  const token = await getValidMicrosoftToken(userId);
  if (!token) return null;

  const safeName = String(fileName || 'document.pdf').replace(/[\\/:*?"<>|]/g, '-').trim();

  const uploadRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}:/${encodeURIComponent(safeName)}:/content`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': mimeType },
      body: buffer,
    }
  );

  const uploadData = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok) {
    console.warn('[uploadToOneDrive] failed:', uploadData);
    return null;
  }

  return {
    item_id: uploadData.id,
    web_url: uploadData.webUrl,
    name: uploadData.name,
  };
}

export async function saveDocumentRecord({ projectId, aoId, fileName, category, mimeType, oneDriveItemId, oneDriveUrl, metadata = {} }) {
  if (!projectId) return null;
  const sb = getSupabase();
  const { data, error } = await sb.from('documents').insert([{
    project_id: projectId,
    ao_id: aoId || null,
    file_name: fileName,
    file_type: mimeType?.includes('pdf') ? 'pdf' : 'docx',
    category,
    section_type: category,
    status: 'generated',
    version: 1,
    storage_path: null,
    created_at: new Date().toISOString(),
    metadata: {
      ...metadata,
      onedrive_item_id: oneDriveItemId || null,
      onedrive_url: oneDriveUrl || null,
    },
  }]).select('id').single();

  if (error) console.warn('[saveDocumentRecord] failed:', error.message);
  return data?.id || null;
}
