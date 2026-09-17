import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const ACTIVE_JOBS_FOLDER_NAME = 'Active Jobs';

async function refreshGoogleToken(refreshToken, userId) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Token refresh failed');

  const newAccessToken = data.access_token;

  await supabase
    .from('user_integrations')
    .update({ google_drive_access_token: newAccessToken })
    .eq('user_id', userId);

  return newAccessToken;
}

async function driveSearch(accessToken, query) {
  const url = new URL(`${DRIVE_API_BASE}/files`);
  url.searchParams.set('q', query);
  url.searchParams.set('spaces', 'drive');
  url.searchParams.set('fields', 'files(id, webViewLink)');
  url.searchParams.set('pageSize', '1');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Drive search failed');
  return data;
}

async function driveCreateFolder(accessToken, name, parents) {
  const url = new URL(`${DRIVE_API_BASE}/files`);
  url.searchParams.set('fields', 'id, webViewLink');

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parents ? { parents } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Drive folder create failed');
  return data;
}

async function getActiveJobsFolder(accessToken, userIntegration) {
  if (userIntegration.google_drive_active_jobs_folder_id) {
    return { id: userIntegration.google_drive_active_jobs_folder_id };
  }

  const searchData = await driveSearch(
    accessToken,
    `name='${ACTIVE_JOBS_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents`
  );

  if (searchData.files?.length > 0) {
    const folderId = searchData.files[0].id;
    await supabase
      .from('user_integrations')
      .update({ google_drive_active_jobs_folder_id: folderId })
      .eq('user_id', userIntegration.user_id);
    return { id: folderId };
  }

  const created = await driveCreateFolder(accessToken, ACTIVE_JOBS_FOLDER_NAME);
  await supabase
    .from('user_integrations')
    .update({ google_drive_active_jobs_folder_id: created.id })
    .eq('user_id', userIntegration.user_id);

  return { id: created.id };
}

async function findOrCreateFolder(accessToken, parentFolderId, folderName) {
  const searchData = await driveSearch(
    accessToken,
    `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parentFolderId}' in parents`
  );

  if (searchData.files?.length > 0) {
    const folder = searchData.files[0];
    return { id: folder.id, webViewLink: folder.webViewLink };
  }

  const created = await driveCreateFolder(accessToken, folderName, [parentFolderId]);
  return { id: created.id, webViewLink: created.webViewLink };
}

async function driveUploadFile(accessToken, { parentFolderId, filename, buffer, mimeType }) {
  const metadata = { name: filename, parents: [parentFolderId] };

  // Simple multipart upload for anything reasonably sized (covers
  // every document this app generates — notices, awards, LOAs are
  // all well under this). Resumable upload for anything larger,
  // matching the same size-based branching onedrive-upload.js already
  // uses (simple PUT vs chunked session).
  if (buffer.length <= 5 * 1024 * 1024) {
    const boundary = 'nora_upload_' + Math.random().toString(36).slice(2);
    const metadataPart = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
    );
    const filePartHeader = Buffer.from(
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const closing = Buffer.from(`\r\n--${boundary}--`);
    const body = Buffer.concat([metadataPart, filePartHeader, buffer, closing]);

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,name',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Drive upload failed');
    return { id: data.id, webViewLink: data.webViewLink, name: data.name };
  }

  // Resumable upload for larger files.
  const startRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink,name',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
      },
      body: JSON.stringify(metadata),
    }
  );
  if (!startRes.ok) {
    const errData = await startRes.json().catch(() => ({}));
    throw new Error(errData.error?.message || 'Drive resumable upload session failed to start');
  }
  const uploadUrl = startRes.headers.get('location');
  if (!uploadUrl) throw new Error('Drive did not return a resumable upload URL');

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType, 'Content-Length': String(buffer.length) },
    body: buffer,
  });
  const putData = await putRes.json();
  if (!putRes.ok) throw new Error(putData.error?.message || 'Drive resumable upload failed');
  return { id: putData.id, webViewLink: putData.webViewLink, name: putData.name };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user_id, action, folder_name, project_address, ao_address, project_folder_id, filename, content_base64, content_type } = req.body;

    if (!user_id || !action) {
      return res.status(400).json({ error: 'Missing user_id or action' });
    }

    const { data: integration, error: intErr } = await supabase
      .from('user_integrations')
      .select('user_id, google_drive_access_token, google_drive_refresh_token, google_drive_active_jobs_folder_id')
      .eq('user_id', user_id)
      .single();

    if (intErr || !integration) {
      return res.status(404).json({ error: 'Google Drive not connected' });
    }

    let accessToken = integration.google_drive_access_token;

    // Fixed 2026-09-17, real, confirmed bug found via server logs
    // (500: "Request had invalid authentication credentials" from
    // Google) — this only ever refreshed when the access token was
    // completely missing, never when it had simply expired. Google
    // access tokens expire roughly hourly; there's no expires_at
    // column tracking that (checked — doesn't exist), so there's no
    // way to know it's stale without trying it. Same gap already
    // found and fixed the same way in sync-gmail.js's
    // syncOneGmailAccount tonight: refresh proactively whenever a
    // refresh_token is available, rather than waiting for the access
    // token to be absent. This was a pre-existing gap in this file
    // specifically — not something introduced by anything else
    // touched tonight — that simply hadn't been hit yet because the
    // token was still fresh during earlier testing today.
    if (integration.google_drive_refresh_token) {
      try {
        accessToken = await refreshGoogleToken(integration.google_drive_refresh_token, user_id);
      } catch (err) {
        console.warn('[create-google-drive-folder] token refresh failed, trying existing token:', err.message);
      }
    }

    if (!accessToken) {
      return res.status(401).json({ error: 'No valid Google Drive token' });
    }

    if (action === 'create_project_folder') {
      if (!project_address) {
        return res.status(400).json({ error: 'Missing project_address' });
      }

      const activeJobsFolder = await getActiveJobsFolder(accessToken, integration);
      const projectFolder = await findOrCreateFolder(accessToken, activeJobsFolder.id, project_address);

      return res.status(200).json({
        success: true,
        folder_id: projectFolder.id,
        web_url: projectFolder.webViewLink,
      });
    }

    if (action === 'create_ao_folder' || action === 'create_subfolder') {
      const subfolderName = ao_address || folder_name;
      if (!subfolderName) {
        return res.status(400).json({ error: 'Missing ao_address or folder_name' });
      }

      if (!project_folder_id) {
        return res.status(400).json({ error: 'Missing project_folder_id' });
      }

      const aoFolder = await findOrCreateFolder(accessToken, project_folder_id, subfolderName);

      return res.status(200).json({
        success: true,
        folder_id: aoFolder.id,
        web_url: aoFolder.webViewLink,
      });
    }

    if (action === 'upload_file') {
      if (!project_folder_id) {
        return res.status(400).json({ error: 'Missing project_folder_id (the parent Drive folder to upload into)' });
      }
      if (!filename || !content_base64) {
        return res.status(400).json({ error: 'Missing filename or content_base64' });
      }

      const buffer = Buffer.from(content_base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      const sanitisedName = String(filename).replace(/[\\/:*?"<>|]/g, '-').trim();
      const mimeType = content_type || 'application/octet-stream';

      const uploaded = await driveUploadFile(accessToken, {
        parentFolderId: project_folder_id,
        filename: sanitisedName,
        buffer,
        mimeType,
      });

      return res.status(200).json({
        success: true,
        item_id: uploaded.id,
        web_url: uploaded.webViewLink,
        name: uploaded.name,
      });
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (error) {
    console.error('Create Google Drive folder error:', error);
    return res.status(500).json({ error: error.message });
  }
}
