import { getMediationSupabase } from '../lib/mediation-client.js';
import { resolveMediationAccess } from '../lib/mediation-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const access = await resolveMediationAccess(req);
    if (!access) return res.status(401).json({ error: 'Unauthorised' });

    const sb = getMediationSupabase();

    const [participantResult, partyResult, mediationResult, roomResult, intakeResult, datesResult, agreementsResult] = await Promise.all([
      sb.from('mediation_participants')
        .select('id, full_name, email, phone, role_title')
        .eq('id', access.participantId)
        .eq('party_id', access.partyId)
        .single(),
      sb.from('mediation_parties')
        .select('id, side, legal_name, trading_name, entity_type, company_number, registered_address, correspondence_address, email, phone, confirmed_legal_identity')
        .eq('id', access.partyId)
        .eq('mediation_id', access.mediationId)
        .single(),
      sb.from('mediation_cases')
        .select('id, reference, title, status, fee_amount, fee_currency, confirmed_start_at')
        .eq('id', access.mediationId)
        .single(),
      sb.from('mediation_rooms')
        .select('id, room_type, status')
        .eq('mediation_id', access.mediationId)
        .eq('party_id', access.partyId)
        .single(),
      sb.from('mediation_intake_statements')
        .select('id, statement_text, submitted_at')
        .eq('mediation_id', access.mediationId)
        .eq('party_id', access.partyId)
        .maybeSingle(),
      sb.from('mediation_date_options')
        .select('id, starts_at, status, selected_at')
        .eq('mediation_id', access.mediationId)
        .order('starts_at', { ascending: true }),
      sb.from('mediation_agreements')
        .select('id, version, document_type, status, issued_at')
        .eq('mediation_id', access.mediationId)
        .order('version', { ascending: false }),
    ]);

    const errors = [participantResult, partyResult, mediationResult, roomResult, intakeResult, datesResult, agreementsResult]
      .map((r) => r.error)
      .filter(Boolean);
    if (errors.length) throw errors[0];

    // Intentionally no query exists here for the other party's intake or private room.
    return res.status(200).json({
      participant: participantResult.data,
      party: partyResult.data,
      mediation: mediationResult.data,
      private_room: roomResult.data,
      confidential_intake: intakeResult.data || null,
      date_options: datesResult.data || [],
      agreements: agreementsResult.data || [],
      access_expires_at: access.expiresAt,
    });
  } catch (error) {
    console.error('[mediation/me] failed:', error?.message || error);
    return res.status(500).json({ error: 'Failed to load mediation access' });
  }
}
