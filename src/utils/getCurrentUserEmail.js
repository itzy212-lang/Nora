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
