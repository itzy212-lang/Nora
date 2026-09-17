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
export async function createProjectFolder(userId, projectName, options = {}) {
  try {
    const integrations = await getUserIntegrations(userId);

    if (integrations.storage_provider === 'googledrive') {
      // Call Google Drive folder creation with 'create_project_folder' action
      const response = await fetch('/api/create-google-drive-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          action: 'create_project_folder',
          project_address: projectName,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Google Drive folder creation failed');
      }

      // Fixed 2026-09-17, real, confirmed bug found live: the caller
      // (ProjectDetail.jsx's handleSaveAO) has no other way to know
      // which provider's endpoint actually created this folder, and
      // was hardcoding onedrive_folder_id as the field to save the
      // result under regardless — so a Google Drive folder's real id
      // was never written to the field anything actually reads
      // (google_drive_folder_id), and nothing was written under
      // onedrive_folder_id either in a way any code expects. Now
      // tells the caller explicitly.
      const result = await response.json();
      return { ...result, provider: 'googledrive' };
    } else {
      // Fixed 2026-09-17, real, confirmed bug: this branch used to be
      // a stub — 'console.log("Using OneDrive storage")' and a bare
      // { folder_id: null, web_url: null } return, never actually
      // calling the real OneDrive endpoint at all. Every caller using
      // this abstraction for a OneDrive user silently got back nulls
      // instead of a real folder. Now genuinely calls it, matching
      // the same request shape the Google Drive branch above uses.
      const response = await fetch('/api/onedrive-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          action: 'create_project_folder',
          project_address: projectName,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'OneDrive folder creation failed');
      }

      const result = await response.json();
      return { ...result, provider: 'onedrive' };
    }
  } catch (err) {
    console.error('Project folder creation error:', err);
    throw err;
  }
}

/**
 * Create an AO subfolder using the user's configured storage provider
 */
export async function createAOFolder(userId, projectFolderId, aoAddress) {
  try {
    const integrations = await getUserIntegrations(userId);

    if (integrations.storage_provider === 'googledrive') {
      // Call Google Drive folder creation with 'create_ao_folder' action
      const response = await fetch('/api/create-google-drive-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          action: 'create_ao_folder',
          project_folder_id: projectFolderId,
          ao_address: aoAddress,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Google Drive folder creation failed');
      }

      // Same fix as createProjectFolder above — tell the caller which
      // provider actually created this, so it saves the result under
      // the right field.
      const result = await response.json();
      return { ...result, provider: 'googledrive' };
    } else {
      // Fixed 2026-09-17, same real bug as createProjectFolder above —
      // this was a stub that never called the real OneDrive endpoint.
      const response = await fetch('/api/onedrive-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          action: 'create_ao_folder',
          project_folder_id: projectFolderId,
          ao_address: aoAddress,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'OneDrive folder creation failed');
      }

      const result = await response.json();
      return { ...result, provider: 'onedrive' };
    }
  } catch (err) {
    console.error('AO folder creation error:', err);
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
