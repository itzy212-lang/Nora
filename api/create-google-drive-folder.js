import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

/**
 * Refresh Google OAuth token if expired
 */
async function refreshGoogleToken(refreshToken, userId) {
  try {
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const newAccessToken = response.data.access_token;

    // Update token in DB
    await supabase
      .from('user_integrations')
      .update({ google_drive_access_token: newAccessToken })
      .eq('user_id', userId);

    return newAccessToken;
  } catch (err) {
    console.error('Token refresh failed:', err.message);
    throw err;
  }
}

/**
 * Create a folder in Google Drive
 */
async function createGoogleDriveFolder(name, parentFolderId = null, accessToken) {
  try {
    const metadata = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };

    if (parentFolderId) {
      metadata.parents = [parentFolderId];
    }

    const response = await axios.post(
      `${DRIVE_API_BASE}/files`,
      metadata,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        params: {
          fields: 'id, webViewLink',
        },
      }
    );

    return {
      folder_id: response.data.id,
      web_url: response.data.webViewLink,
    };
  } catch (err) {
    console.error('Google Drive folder creation failed:', err.message);
    throw err;
  }
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
    const { user_id, folder_name, parent_folder_id } = req.body;

    if (!user_id || !folder_name) {
      return res.status(400).json({ error: 'Missing user_id or folder_name' });
    }

    // Get user's Google Drive tokens
    const { data: integration, error: intErr } = await supabase
      .from('user_integrations')
      .select('google_drive_access_token, google_drive_refresh_token')
      .eq('user_id', user_id)
      .single();

    if (intErr || !integration) {
      return res.status(404).json({ error: 'Google Drive not connected' });
    }

    let accessToken = integration.google_drive_access_token;

    // Refresh if needed
    if (!accessToken && integration.google_drive_refresh_token) {
      accessToken = await refreshGoogleToken(integration.google_drive_refresh_token, user_id);
    }

    if (!accessToken) {
      return res.status(401).json({ error: 'No valid Google Drive token' });
    }

    // Create folder
    const folderData = await createGoogleDriveFolder(folder_name, parent_folder_id, accessToken);

    return res.status(200).json({
      success: true,
      ...folderData,
    });

  } catch (error) {
    console.error('Create Google Drive folder error:', error);
    return res.status(500).json({ error: error.message });
  }
}
