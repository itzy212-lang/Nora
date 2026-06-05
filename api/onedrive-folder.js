import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getValidToken(userId) {
  const { data: account, error } = await supabase
    .from('email_accounts')
    .select('*')
    .eq('provider', 'outlook')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !account) throw new Error('No Outlook account found');
  if (account.reconnect_required) throw new Error('Outlook needs reconnecting');

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
        scope: 'offline_access Mail.Read Mail.ReadWrite Mail.Send User.Read Files.ReadWrite',
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error('Token refresh failed: ' + JSON.stringify(data));

    await supabase.from('email_accounts').update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || account.refresh_token,
      token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    }).eq('id', account.id);

    return data.access_token;
  }

  return account.access_token;
}

function safeFolderName(value, fallback = 'Untitled') {
  return String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240) || fallback;
}

function graphChildrenUrl(parentId) {
  return parentId === 'root'
    ? 'https://graph.microsoft.com/v1.0/me/drive/root/children'
    : `https://graph.microsoft.com/v1.0/me/drive/items/${parentId}/children`;
}

async function findExistingFolder(token, parentId, folderName) {
  const url = graphChildrenUrl(parentId) + '?$select=id,name,webUrl,folder';
  const listRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const listData = await listRes.json();
  if (!listRes.ok) throw new Error('Failed to list OneDrive folder: ' + JSON.stringify(listData));

  return (listData.value || []).find((item) =>
    item.folder && String(item.name || '').toLowerCase() === String(folderName || '').toLowerCase()
  ) || null;
}

async function findOrCreateFolder(token, parentId, folderName) {
  const sanitised = safeFolderName(folderName);
  const existing = await findExistingFolder(token, parentId, sanitised);
  if (existing) return existing;

  const createRes = await fetch(graphChildrenUrl(parentId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: sanitised,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    }),
  });

  const created = await createRes.json();

  if (createRes.status === 409 || createRes.status === 400) {
    const retry = await findExistingFolder(token, parentId, sanitised);
    if (retry) return retry;
  }

  if (!createRes.ok) throw new Error('Failed to create folder: ' + JSON.stringify(created));
  return created;
}

async function getActiveJobsFolder(token, rootFolderId) {
  if (rootFolderId) return { id: rootFolderId, name: 'Configured root folder', webUrl: '' };
  return findOrCreateFolder(token, 'root', 'Active Jobs');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      user_id,
      action,
      project_address,
      ao_address,
      project_folder_id,
      root_folder_id,
      folder_name
    } = req.body || {};

    if (!user_id || !action) return res.status(400).json({ error: 'Missing user_id or action' });

    const token = await getValidToken(user_id);

    if (action === 'create_project_folder') {
      if (!project_address) return res.status(400).json({ error: 'Missing project_address' });
      const root = await getActiveJobsFolder(token, root_folder_id);
      const projectFolder = await findOrCreateFolder(token, root.id, project_address);
      return res.status(200).json({
        success: true,
        folder_id: projectFolder.id,
        folder_name: projectFolder.name,
        web_url: projectFolder.webUrl,
        root_folder_id: root.id,
      });
    }

    if (action === 'create_ao_folder' || action === 'create_subfolder') {
      const subfolderName = ao_address || folder_name;
      if (!subfolderName) return res.status(400).json({ error: 'Missing ao_address or folder_name' });

      let parentId = project_folder_id;
      if (!parentId && project_address) {
        const root = await getActiveJobsFolder(token, root_folder_id);
        const projectFolder = await findOrCreateFolder(token, root.id, project_address);
        parentId = projectFolder.id;
      }
      if (!parentId) {
        const root = await getActiveJobsFolder(token, root_folder_id);
        parentId = root.id;
      }

      const folder = await findOrCreateFolder(token, parentId, subfolderName);
      return res.status(200).json({
        success: true,
        folder_id: folder.id,
        folder_name: folder.name,
        web_url: folder.webUrl,
      });
    }

    if (action === 'get_folder_contents') {
      if (!project_folder_id) return res.status(400).json({ error: 'Missing project_folder_id' });
      const listRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${project_folder_id}/children?$select=id,name,size,webUrl,file,folder,lastModifiedDateTime&$orderby=lastModifiedDateTime desc`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await listRes.json();
      if (!listRes.ok) throw new Error('Failed to list folder contents: ' + JSON.stringify(data));
      return res.status(200).json({ success: true, items: data.value || [] });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (err) {
    console.error('onedrive-folder error:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
