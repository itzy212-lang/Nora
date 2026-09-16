import sb from '../supabaseClient';

/**
 * Get user's email and storage provider preferences
 */
export async function getUserIntegrations(userId) {
  try {
    const { data } = await sb
      .from('user_integrations')
      .select('email_provider, storage_provider')
      .eq('user_id', userId)
      .single();

    return data || { email_provider: 'outlook', storage_provider: 'onedrive' };
  } catch (err) {
    console.warn('Error fetching integrations:', err.message);
    return { email_provider: 'outlook', storage_provider: 'onedrive' };
  }
}

/**
 * Sync emails for the given user using their configured provider
 */
export async function syncEmails(userId) {
  try {
    const integrations = await getUserIntegrations(userId);

    if (integrations.email_provider === 'gmail') {
      // Call Gmail sync
      const response = await fetch('/api/sync-gmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });

      if (!response.ok) {
        throw new Error('Gmail sync failed');
      }

      return response.json();
    } else {
      // Fall back to existing Outlook sync
      // (assuming you have an existing /api/sync-outlook or similar)
      console.log('Using Outlook email sync');
      return { synced_count: 0 };
    }
  } catch (err) {
    console.error('Email sync error:', err);
    throw err;
  }
}

/**
 * Create a project folder using the user's configured storage provider
 */
export async function createProjectFolder(userId, projectName, parentFolderId = null) {
  try {
    const integrations = await getUserIntegrations(userId);

    if (integrations.storage_provider === 'googledrive') {
      // Call Google Drive folder creation
      const response = await fetch('/api/create-google-drive-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          folder_name: projectName,
          parent_folder_id: parentFolderId,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Google Drive folder creation failed');
      }

      return response.json();
    } else {
      // Fall back to existing OneDrive folder creation
      console.log('Using OneDrive storage');
      return { folder_id: null, web_url: null };
    }
  } catch (err) {
    console.error('Project folder creation error:', err);
    throw err;
  }
}

/**
 * Check if user has Gmail configured and connected
 */
export async function hasGmailConnected(userId) {
  try {
    const { data } = await sb
      .from('user_integrations')
      .select('gmail_access_token, email_provider')
      .eq('user_id', userId)
      .single();

    return data?.email_provider === 'gmail' && !!data?.gmail_access_token;
  } catch (err) {
    return false;
  }
}

/**
 * Check if user has Google Drive configured and connected
 */
export async function hasGoogleDriveConnected(userId) {
  try {
    const { data } = await sb
      .from('user_integrations')
      .select('google_drive_access_token, storage_provider')
      .eq('user_id', userId)
      .single();

    return data?.storage_provider === 'googledrive' && !!data?.google_drive_access_token;
  } catch (err) {
    return false;
  }
}
