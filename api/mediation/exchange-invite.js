import { getMediationSupabase } from '../lib/mediation-client.js';
import { randomToken, hashToken, addHours } from '../lib/mediation-security.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const inviteToken = String(req.body?.token || '').trim();
    if (!inviteToken) return res.status(400).json({ error: 'Invitation token is required' });

    const sb = getMediationSupabase();
    const tokenHash = hashToken(inviteToken);
    const now = new Date();
    const nowIso = now.toISOString();

    const { data: participant, error } = await sb
      .from('mediation_participants')
      .select('id, mediation_id, party_id, full_name, email, invitation_expires_at, invitation_used_at, invitation_revoked_at, active')
      .eq('invitation_token_hash', tokenHash)
      .maybeSingle();

    if (error || !participant || !participant.active) {
      return res.status(401).json({ error: 'Invalid invitation' });
    }

    if (participant.invitation_revoked_at) {
      return res.status(401).json({ error: 'Invitation has been revoked' });
    }

    if (!participant.invitation_expires_at || new Date(participant.invitation_expires_at) <= now) {
      return res.status(401).json({ error: 'Invitation has expired' });
    }

    if (participant.invitation_used_at) {
      return res.status(401).json({ error: 'Invitation has already been used' });
    }

    const rawSessionToken = randomToken(40);
    const sessionExpiresAt = addHours(now, 24).toISOString();

    const { data: session, error: sessionError } = await sb
      .from('mediation_access_sessions')
      .insert({
        mediation_id: participant.mediation_id,
        participant_id: participant.id,
        party_id: participant.party_id,
        session_token_hash: hashToken(rawSessionToken),
        expires_at: sessionExpiresAt,
      })
      .select('id')
      .single();

    if (sessionError) throw sessionError;

    const { error: updateError } = await sb
      .from('mediation_participants')
      .update({
        invitation_accepted_at: nowIso,
        invitation_used_at: nowIso,
      })
      .eq('id', participant.id)
      .is('invitation_used_at', null);

    if (updateError) {
      await sb.from('mediation_access_sessions').delete().eq('id', session.id);
      throw updateError;
    }

    const [{ data: party }, { data: mediation }, { data: room }] = await Promise.all([
      sb.from('mediation_parties').select('id, side, legal_name, trading_name').eq('id', participant.party_id).single(),
      sb.from('mediation_cases').select('id, reference, title, status, confirmed_start_at').eq('id', participant.mediation_id).single(),
      sb.from('mediation_rooms')
        .select('id, room_type, status')
        .eq('mediation_id', participant.mediation_id)
        .eq('party_id', participant.party_id)
        .single(),
    ]);

    await sb.from('mediation_audit_events').insert({
      mediation_id: participant.mediation_id,
      actor_type: 'participant',
      actor_id: participant.id,
      event_type: 'invitation_exchanged_for_access_session',
      event_data: { session_id: session.id, party_id: participant.party_id },
    });

    return res.status(200).json({
      access_token: rawSessionToken,
      expires_at: sessionExpiresAt,
      participant: {
        id: participant.id,
        full_name: participant.full_name,
        email: participant.email,
      },
      party,
      mediation,
      private_room: room || null,
    });
  } catch (error) {
    console.error('[mediation/exchange-invite] failed:', error?.message || error);
    return res.status(500).json({ error: 'Failed to exchange invitation' });
  }
}
