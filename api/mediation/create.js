import { createClient } from '@supabase/supabase-js';
import { buildMediationHandover } from '../lib/mediation-handover.js';
import { getMediationSupabase } from '../lib/mediation-client.js';
import { randomToken, hashToken, addHours } from '../lib/mediation-security.js';

function getNoraSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Nora authentication backend is not configured');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function verifyNoraUser(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return null;
  const sb = getNoraSupabase();
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user?.id) return null;
  return user;
}

function referenceForCase(id) {
  return `MED-${String(id).split('-')[0].toUpperCase()}`;
}

async function rollbackCase(sb, caseId) {
  if (!caseId) return;
  try {
    await sb.from('mediation_cases').delete().eq('id', caseId);
  } catch (_) {
    // Best-effort rollback. Foreign keys cascade all child records.
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let caseId = null;
  try {
    const noraUser = await verifyNoraUser(req);
    if (!noraUser) return res.status(401).json({ error: 'Unauthorised' });

    const handover = buildMediationHandover({
      ...(req.body || {}),
      created_by_user_id: noraUser.id,
    });

    const sb = getMediationSupabase();
    const feeAmount = handover.fee === null || handover.fee === undefined || handover.fee === ''
      ? null
      : Number(handover.fee);

    if (feeAmount !== null && !Number.isFinite(feeAmount)) {
      return res.status(400).json({ error: 'Invalid mediation fee' });
    }

    const { data: mediation, error: mediationError } = await sb
      .from('mediation_cases')
      .insert({
        external_source: 'nora',
        external_project_id: handover.source_project_id,
        title: handover.mediation_title,
        status: 'draft',
        fee_amount: feeAmount,
        fee_currency: handover.administration?.currency || 'GBP',
      })
      .select('id, reference, status')
      .single();

    if (mediationError) throw mediationError;
    caseId = mediation.id;

    const generatedReference = referenceForCase(caseId);
    await sb.from('mediation_cases').update({ reference: generatedReference }).eq('id', caseId);

    const partyRows = [
      {
        mediation_id: caseId,
        side: 'A',
        legal_name: handover.party_a.legal_name,
        trading_name: handover.party_a.trading_name,
        company_number: handover.party_a.company_number,
        registered_address: handover.party_a.registered_address,
        email: handover.party_a.representative_email,
        phone: handover.party_a.representative_phone,
        source_snapshot: handover.party_a,
        confirmed_legal_identity: true,
        confirmed_at: new Date().toISOString(),
      },
      {
        mediation_id: caseId,
        side: 'B',
        legal_name: handover.party_b.legal_name,
        trading_name: handover.party_b.trading_name,
        company_number: handover.party_b.company_number,
        registered_address: handover.party_b.registered_address,
        email: handover.party_b.representative_email,
        phone: handover.party_b.representative_phone,
        source_snapshot: handover.party_b,
        confirmed_legal_identity: true,
        confirmed_at: new Date().toISOString(),
      },
    ];

    const { data: parties, error: partiesError } = await sb
      .from('mediation_parties')
      .insert(partyRows)
      .select('id, side, legal_name');
    if (partiesError) throw partiesError;

    const partyA = parties.find((p) => p.side === 'A');
    const partyB = parties.find((p) => p.side === 'B');
    if (!partyA || !partyB) throw new Error('Failed to create both mediation parties');

    const invitationExpiresAt = addHours(new Date(), 168).toISOString();
    const rawInviteA = randomToken();
    const rawInviteB = randomToken();

    const participantRows = [
      {
        mediation_id: caseId,
        party_id: partyA.id,
        full_name: handover.party_a.representative_name,
        email: handover.party_a.representative_email,
        phone: handover.party_a.representative_phone,
        role_title: handover.party_a.party_role,
        invitation_token_hash: hashToken(rawInviteA),
        invitation_expires_at: invitationExpiresAt,
      },
      {
        mediation_id: caseId,
        party_id: partyB.id,
        full_name: handover.party_b.representative_name,
        email: handover.party_b.representative_email,
        phone: handover.party_b.representative_phone,
        role_title: handover.party_b.party_role,
        invitation_token_hash: hashToken(rawInviteB),
        invitation_expires_at: invitationExpiresAt,
      },
    ];

    const { data: participants, error: participantsError } = await sb
      .from('mediation_participants')
      .insert(participantRows)
      .select('id, party_id, full_name, email');
    if (participantsError) throw participantsError;

    const intakeRows = [];
    if (handover.party_a_confidential_intake) {
      intakeRows.push({
        mediation_id: caseId,
        party_id: partyA.id,
        statement_text: handover.party_a_confidential_intake,
        immutable_hash: hashToken(handover.party_a_confidential_intake),
      });
    }
    if (handover.party_b_confidential_intake) {
      intakeRows.push({
        mediation_id: caseId,
        party_id: partyB.id,
        statement_text: handover.party_b_confidential_intake,
        immutable_hash: hashToken(handover.party_b_confidential_intake),
      });
    }
    if (intakeRows.length) {
      const { error } = await sb.from('mediation_intake_statements').insert(intakeRows);
      if (error) throw error;
    }

    const { error: roomsError } = await sb.from('mediation_rooms').insert([
      { mediation_id: caseId, room_type: 'joint', party_id: null },
      { mediation_id: caseId, room_type: 'private_a', party_id: partyA.id },
      { mediation_id: caseId, room_type: 'private_b', party_id: partyB.id },
      { mediation_id: caseId, room_type: 'director', party_id: null },
    ]);
    if (roomsError) throw roomsError;

    if (handover.proposed_dates?.length) {
      const dateRows = handover.proposed_dates.map((value) => ({
        mediation_id: caseId,
        proposed_by_party_id: partyA.id,
        starts_at: value,
      }));
      const { error } = await sb.from('mediation_date_options').insert(dateRows);
      if (error) throw error;
    }

    await sb.from('mediation_audit_events').insert({
      mediation_id: caseId,
      actor_type: 'nora_handover',
      actor_id: noraUser.id,
      event_type: 'mediation_created_from_sealed_handover',
      event_data: {
        schema_version: handover.schema_version,
        source_project_id: handover.source_project_id,
        party_count: 2,
        confidential_intake_a_present: !!handover.party_a_confidential_intake,
        confidential_intake_b_present: !!handover.party_b_confidential_intake,
      },
    });

    return res.status(201).json({
      mediation_id: caseId,
      reference: generatedReference,
      status: 'draft',
      parties: {
        A: { id: partyA.id, legal_name: partyA.legal_name },
        B: { id: partyB.id, legal_name: partyB.legal_name },
      },
      invitations: {
        A: { participant_id: participants.find((p) => p.party_id === partyA.id)?.id, token: rawInviteA, expires_at: invitationExpiresAt },
        B: { participant_id: participants.find((p) => p.party_id === partyB.id)?.id, token: rawInviteB, expires_at: invitationExpiresAt },
      },
    });
  } catch (error) {
    try {
      const sb = getMediationSupabase();
      await rollbackCase(sb, caseId);
    } catch (_) {}
    console.error('[mediation/create] failed:', error?.message || error);
    return res.status(500).json({ error: 'Failed to create mediation' });
  }
}
