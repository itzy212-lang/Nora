// src/utils/apiAuth.js
//
// Sends the signed-in user's token with every call the app makes to Nora's own server (/api/...), so the server
// always knows who is asking (needed for the plan check, api/lib/ai-gate.js). Added once here instead of at each
// call site. A call that already carries its own Authorization header is left exactly as it is; calls to other
// websites, and calls made while signed out, are untouched.
//
// Also: when the server answers 402 ("this needs Nora Assistant" / "Schedule of Condition"), tell the app so it
// can show the upgrade prompt (src/components/layout/UpgradePrompt.jsx), whichever feature made the call.
import sb from '../supabaseClient';

let installed = false;
let lastPrompt = 0;

function announceUpgradeNeeded(response) {
  const now = Date.now();
  if (now - lastPrompt < 4000) return; // several calls can fail together; one prompt is enough
  response.json().then(body => {
    if (body?.feature && body?.needs) {
      lastPrompt = Date.now();
      window.dispatchEvent(new CustomEvent('nora:upgrade-needed', { detail: { message: body.error, feature: body.feature, needs: body.needs } }));
    }
  }).catch(() => { /* not the plan message: leave it to the feature's own error handling */ });
}

export function installApiAuth() {
  if (installed || typeof window === 'undefined' || !window.fetch) return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    let sameOriginApi = false;
    let finalInit = init;
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : null;
      sameOriginApi = !!url && (url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`));
      if (sameOriginApi) {
        const headers = new Headers(init?.headers || undefined);
        if (!headers.has('Authorization')) {
          const { data: { session } } = await sb.auth.getSession();
          if (session?.access_token) {
            headers.set('Authorization', `Bearer ${session.access_token}`);
            finalInit = { ...(init || {}), headers };
          }
        }
      }
    } catch { /* never let this get in the way of a request */ }
    const response = await original(input, finalInit);
    if (sameOriginApi && response.status === 402) { try { announceUpgradeNeeded(response.clone()); } catch { /* ignore */ } }
    return response;
  };
}
