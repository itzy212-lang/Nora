// Shared helper: the current, actually logged-in user's email.
//
// Added 2026-09-16, on request, real multi-user bug: many places in
// this app hardcoded 'help@sq1consulting.co.uk' as the user_id for
// OneDrive operations (19 call sites across 13 files, confirmed by
// direct search) — every user's documents would have gone to the same
// single account, exactly the same class of cross-account bug already
// fixed for email sending in commit 9a455c93. One shared helper here,
// used consistently, rather than repeating the same session lookup at
// every call site.
//
// Uses Supabase's own current session directly — sb is already a
// singleton import in every file that needs this, so no prop-drilling
// or context changes are needed anywhere this is used.
import sb from '../supabaseClient';

export async function getCurrentUserEmail() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    return session?.user?.email || null;
  } catch {
    return null;
  }
}

// Added 2026-10-17: the logged-in user's auth UUID (Google tokens and the
// user's mail/storage provider settings are keyed by it), and which storage
// provider they use, so every attachment/file feature behaves per account.
export async function getCurrentUserUuid() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    return session?.user?.id || null;
  } catch {
    return null;
  }
}

export async function getUserStorageInfo() {
  const uuid = await getCurrentUserUuid();
  let storage = 'onedrive';
  try {
    if (uuid) {
      const { data } = await sb.from('user_integrations').select('storage_provider').eq('user_id', uuid).maybeSingle();
      if (data?.storage_provider === 'googledrive') storage = 'googledrive';
    }
  } catch { /* default to OneDrive */ }
  return { uuid, storage, folderColumn: storage === 'googledrive' ? 'google_drive_folder_id' : 'onedrive_folder_id' };
}
