import { describe, expect, it } from 'vitest';
import { buildMediationHandover } from './mediation-handover.js';

function validPayload() {
  return {
    source_project_id: 'project-123',
    created_by_user_id: 'user-123',
    mediation_title: 'Test mediation',
    fee: 750,
    proposed_dates: ['2026-09-01T09:00:00Z'],
    party_a: {
      legal_name: 'Party A Limited',
      representative_name: 'Alice A',
      representative_email: 'alice@example.com',
    },
    party_b: {
      legal_name: 'Party B Limited',
      representative_name: 'Bob B',
      representative_email: 'bob@example.com',
    },
    party_a_confidential_intake: 'A private account',
    party_b_confidential_intake: 'B private account',
  };
}

describe('buildMediationHandover', () => {
  it('accepts only the explicit mediation handover fields', () => {
    const result = buildMediationHandover(validPayload());
    expect(result.party_a.legal_name).toBe('Party A Limited');
    expect(result.party_b.legal_name).toBe('Party B Limited');
    expect(result.party_a_confidential_intake).toBe('A private account');
  });

  it('rejects Nora project context that must never cross into mediation', () => {
    expect(() => buildMediationHandover({
      ...validPayload(),
      emails: [{ subject: 'Do not transfer me' }],
    })).toThrow(/unexpected field/i);

    expect(() => buildMediationHandover({
      ...validPayload(),
      project_memory: ['Do not transfer me'],
    })).toThrow(/unexpected field/i);
  });

  it('requires confirmed legal identity and representative contact fields', () => {
    const payload = validPayload();
    payload.party_a.legal_name = '';
    expect(() => buildMediationHandover(payload)).toThrow(/party_a\.legal_name is required/i);
  });
});
