import { describe, it, expect } from 'vitest';
import { appointmentTitle } from '../appointment-title.js';

describe('appointmentTitle', () => {
  it('uses the model title when given', () => {
    expect(appointmentTitle({ title: 'Schedule of Condition inspection - 18 Harcourt Road' }, {})).toBe('Schedule of Condition inspection - 18 Harcourt Road');
  });
  it('falls back to the subject without Re:/Fwd: prefixes', () => {
    expect(appointmentTitle({}, { subject: 'RE: Fwd: Inspection at 5 High St' })).toBe('Inspection at 5 High St');
  });
  it('never falls back to "Call with"', () => {
    expect(appointmentTitle({ title: 'null' }, { sender_name: 'Sam' })).toBe('Appointment with Sam');
  });
});
