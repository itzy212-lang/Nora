// src/utils/apiAuth.js
//
// Sends the signed-in user's token with every call the app makes to Nora's own server (/api/...), so the server
// always knows who is asking (needed for the plan check, api/lib/ai-gate.js). Added once here instead of at each
// call site. A call that already carries its own Authorization header is left exactly as it is; calls to other
// websites, and calls made while signed out, are untouched.
import sb from '../supabaseClient';

let installed = false;

export function installApiAuth() {
  if (installed || typeof window === 'undefined' || !window.fetch) return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : null;
      const sameOriginApi = url && (url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`));
      if (sameOriginApi) {
        const headers = new Headers(init?.headers || undefined);
        if (!headers.has('Authorization')) {
          const { data: { session } } = await sb.auth.getSession();
          if (session?.access_token) {
            headers.set('Authorization', `Bearer ${session.access_token}`);
            return original(input, { ...(init || {}), headers });
          }
        }
      }
    } catch { /* never let this get in the way of a request */ }
    return original(input, init);
  };
}
