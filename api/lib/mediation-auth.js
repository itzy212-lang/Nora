import { getMediationSupabase } from './mediation-client.js';
import { hashToken } from './mediation-security.js';

function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

async function resolveMediationAccess(req) {
  const rawToken = extractBearerToken(req);
  if (!rawToken) return null;

  const sb = getMediationSupabase();
  const tokenHash = hashToken(rawToken);
  const nowIso = new Date().toISOString();

  const { data, error } = await sb
    .from('mediation_access_sessions')
    .select('id, mediation_id, participant_id, party_id, expires_at, revoked_at')
    .eq('session_token_hash', tokenHash)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .maybeSingle();

  if (error || !data) return null;

  await sb
    .from('mediation_access_sessions')
    .update({ last_used_at: nowIso })
    .eq('id', data.id);

  return {
    sessionId: data.id,
    mediationId: data.mediation_id,
    participantId: data.participant_id,
    partyId: data.party_id,
    expiresAt: data.expires_at,
  };
}

export { extractBearerToken, resolveMediationAccess };
