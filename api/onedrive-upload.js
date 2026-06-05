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

  const expiresAt = account.token_expires_at
    ? new Date(account.token_expires_at).getTime() : 0;

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
    if (!res.ok) throw new Error('Token refresh failed');

    await supabase.from('email_accounts').update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || account.refresh_token,
      token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    }).eq('id', account.id);

    return data.access_token;
  }

  return account.access_token;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user_id, folder_id, filename, content_base64, content_type } = req.body || {};

    if (!user_id || !folder_id || !filename || !content_base64) {
      return res.status(400).json({ error: 'Missing required fields: user_id, folder_id, filename, content_base64' });
    }

    const token = await getValidToken(user_id);

    // Decode base64 to buffer
    const buffer = Buffer.from(
      content_base64.replace(/^data:[^;]+;base64,/, ''),
      'base64'
    );

    const sanitisedName = filename.replace(/[\\/:*?"<>|]/g, '-').trim();
    const mimeType = content_type || 'application/octet-stream';

    // Use upload session for files > 4MB, simple PUT for smaller
    if (buffer.length > 4 * 1024 * 1024) {
      // Create upload session
      const sessionRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${folder_id}:/${encodeURIComponent(sanitisedName)}:/createUploadSession`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            item: {
              '@microsoft.graph.conflictBehavior': 'replace',
              name: sanitisedName,
            },
          }),
        }
      );
      const sessionData = await sessionRes.json();
      if (!sessionRes.ok) throw new Error('Failed to create upload session: ' + JSON.stringify(sessionData));

      // Upload in chunks
      const chunkSize = 3.2 * 1024 * 1024; // 3.2MB chunks
      let offset = 0;
      let uploadedItem = null;

      while (offset < buffer.length) {
        const chunk = buffer.slice(offset, offset + chunkSize);
        const end = Math.min(offset + chunkSize - 1, buffer.length - 1);

        const chunkRes = await fetch(sessionData.uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Length': chunk.length,
            'Content-Range': `bytes ${offset}-${end}/${buffer.length}`,
            'Content-Type': mimeType,
          },
          body: chunk,
        });

        if (chunkRes.status === 200 || chunkRes.status === 201) {
          uploadedItem = await chunkRes.json();
        } else if (chunkRes.status !== 202) {
          throw new Error('Upload chunk failed: ' + chunkRes.status);
        }
        offset += chunkSize;
      }

      return res.status(200).json({
        success: true,
        item_id: uploadedItem?.id,
        web_url: uploadedItem?.webUrl,
        name: uploadedItem?.name,
      });

    } else {
      // Simple PUT upload
      const uploadRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${folder_id}:/${encodeURIComponent(sanitisedName)}:/content`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': mimeType,
          },
          body: buffer,
        }
      );

      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error('Upload failed: ' + JSON.stringify(uploadData));

      return res.status(200).json({
        success: true,
        item_id: uploadData.id,
        web_url: uploadData.webUrl,
        name: uploadData.name,
      });
    }

  } catch (err) {
    console.error('onedrive-upload error:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
