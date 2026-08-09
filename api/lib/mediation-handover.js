// Independent mediation handover contract.
//
// This module belongs to Nora only. It validates the deliberately limited
// snapshot that may be copied into the separate mediation service.
// It must never hydrate project memory, emails, payment history, variations,
// programme data or Nora brain content.

const HANDOVER_SCHEMA_VERSION = 'mediation_handover_v1';

const ALLOWED_TOP_LEVEL_KEYS = Object.freeze([
  'schema_version',
  'source_project_id',
  'created_by_user_id',
  'mediation_title',
  'fee',
  'proposed_dates',
  'party_a',
  'party_b',
  'party_a_confidential_intake',
  'party_b_confidential_intake',
  'administration',
]);

const PARTY_FIELDS = Object.freeze([
  'legal_name',
  'trading_name',
  'company_number',
  'registered_address',
  'representative_name',
  'representative_email',
  'representative_phone',
  'party_role',
]);

function cleanString(value, max = 4000) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function cleanParty(raw = {}) {
  const party = {};
  for (const key of PARTY_FIELDS) {
    party[key] = cleanString(raw?.[key], key === 'registered_address' ? 1000 : 500);
  }
  return party;
}

function validateParty(party, label) {
  const errors = [];
  if (!party?.legal_name) errors.push(`${label}.legal_name is required`);
  if (!party?.representative_name) errors.push(`${label}.representative_name is required`);
  if (!party?.representative_email) errors.push(`${label}.representative_email is required`);
  return errors;
}

function assertNoUnexpectedTopLevelKeys(raw = {}) {
  const allowed = new Set(ALLOWED_TOP_LEVEL_KEYS);
  return Object.keys(raw).filter((key) => !allowed.has(key));
}

/**
 * Build a sealed, minimal handover snapshot for the independent mediation
 * service. The caller must populate this object explicitly from reviewed
 * fields. Passing an entire project object is intentionally unsupported.
 */
function buildMediationHandover(raw = {}) {
  const unexpected = assertNoUnexpectedTopLevelKeys(raw);
  if (unexpected.length) {
    throw new Error(`Mediation handover rejected unexpected field(s): ${unexpected.join(', ')}`);
  }

  const partyA = cleanParty(raw.party_a || {});
  const partyB = cleanParty(raw.party_b || {});

  const errors = [
    ...validateParty(partyA, 'party_a'),
    ...validateParty(partyB, 'party_b'),
  ];

  if (errors.length) throw new Error(`Mediation handover invalid: ${errors.join('; ')}`);

  const proposedDates = Array.isArray(raw.proposed_dates)
    ? raw.proposed_dates.map((v) => cleanString(v, 100)).filter(Boolean).slice(0, 12)
    : [];

  return {
    schema_version: HANDOVER_SCHEMA_VERSION,
    source_project_id: cleanString(raw.source_project_id, 200),
    created_by_user_id: cleanString(raw.created_by_user_id, 200),
    mediation_title: cleanString(raw.mediation_title, 500),
    fee: raw.fee ?? null,
    proposed_dates: proposedDates,
    party_a: partyA,
    party_b: partyB,
    party_a_confidential_intake: cleanString(raw.party_a_confidential_intake, 50000),
    party_b_confidential_intake: cleanString(raw.party_b_confidential_intake, 50000),
    administration: raw.administration && typeof raw.administration === 'object'
      ? {
          proposed_session_duration_minutes: Number.isFinite(Number(raw.administration.proposed_session_duration_minutes))
            ? Number(raw.administration.proposed_session_duration_minutes)
            : null,
          currency: cleanString(raw.administration.currency || 'GBP', 10),
        }
      : { proposed_session_duration_minutes: null, currency: 'GBP' },
  };
}

export {
  HANDOVER_SCHEMA_VERSION,
  ALLOWED_TOP_LEVEL_KEYS,
  PARTY_FIELDS,
  buildMediationHandover,
};
