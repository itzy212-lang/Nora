import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const ACTIVE_JOBS_FOLDER_NAME = 'Active Jobs';

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
 * Find or create the "Active Jobs" folder at Drive root
 */
async function getActiveJobsFolder(accessToken, userIntegration) {
  try {
    // Check if we already have the Active Jobs folder ID stored
    if (userIntegration.google_drive_active_jobs_folder_id) {
      return { id: userIntegration.google_drive_active_jobs_folder_id };
    }

    // Search for existing "Active Jobs" folder in Drive root
    const searchRes = await axios.get(`${DRIVE_API_BASE}/files`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        q: `name='${ACTIVE_JOBS_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents`,
        spaces: 'drive',
        fields: 'files(id)',
        pageSize: 1,
      },
    });

    if (searchRes.data.files?.length > 0) {
      const folderId = searchRes.data.files[0].id;
      // Store the folder ID for future use
      await supabase
        .from('user_integrations')
        .update({ google_drive_active_jobs_folder_id: folderId })
        .eq('user_id', userIntegration.user_id);
      return { id: folderId };
    }

    // Create "Active Jobs" folder if it doesn't exist
    const createRes = await axios.post(
      `${DRIVE_API_BASE}/files`,
      {
        name: ACTIVE_JOBS_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        params: { fields: 'id' },
      }
    );

    const folderId = createRes.data.id;
    // Store the folder ID
    await supabase
      .from('user_integrations')
      .update({ google_drive_active_jobs_folder_id: folderId })
      .eq('user_id', userIntegration.user_id);

    return { id: folderId };
  } catch (err) {
    console.error('Get Active Jobs folder failed:', err.message);
    throw err;
  }
}

/**
 * Find or create a folder by name under a parent
 */
async function findOrCreateFolder(accessToken, parentFolderId, folderName) {
  try {
    // Search for existing folder
    const searchRes = await axios.get(`${DRIVE_API_BASE}/files`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parentFolderId}' in parents`,
        spaces: 'drive',
        fields: 'files(id, webViewLink)',
        pageSize: 1,
      },
    });

    if (searchRes.data.files?.length > 0) {
      const folder = searchRes.data.files[0];
      return { id: folder.id, webViewLink: folder.webViewLink };
    }

    // Create folder if it doesn't exist
    const createRes = await axios.post(
      `${DRIVE_API_BASE}/files`,
      {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        params: { fields: 'id, webViewLink' },
      }
    );

    return { id: createRes.data.id, webViewLink: createRes.data.webViewLink };
  } catch (err) {
    console.error('Find or create folder failed:', err.message);
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
    const { user_id, action, folder_name, project_address, ao_address, project_folder_id } = req.body;

    if (!user_id || !action) {
      return res.status(400).json({ error: 'Missing user_id or action' });
    }

    // Get user's Google Drive tokens
    const { data: integration, error: intErr } = await supabase
      .from('user_integrations')
      .select('user_id, google_drive_access_token, google_drive_refresh_token, google_drive_active_jobs_folder_id')
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

    // Handle different actions (matching OneDrive behavior)
    if (action === 'create_project_folder') {
      if (!project_address) {
        return res.status(400).json({ error: 'Missing project_address' });
      }

      // Get or create the "Active Jobs" folder
      const activeJobsFolder = await getActiveJobsFolder(accessToken, integration);

      // Create project folder under Active Jobs
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

      // Create AO subfolder under the project folder
      const aoFolder = await findOrCreateFolder(accessToken, project_folder_id, subfolderName);

      return res.status(200).json({
        success: true,
        folder_id: aoFolder.id,
        web_url: aoFolder.webViewLink,
      });
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (error) {
    console.error('Create Google Drive folder error:', error);
    return res.status(500).json({ error: error.message });
  }
}
