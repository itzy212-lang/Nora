import { describe, it, expect } from 'vitest';
import { splitDraftMessage } from '../splitDraftMessage.js';

const BODY = 'Hi,\n\nI am currently waiting for availability from the two appointed surveyors.\n\nKind regards,';

describe('splitDraftMessage', () => {
  it('recognises an email that opens "Hi," (the Kettlebaston case)', () => {
    const r = splitDraftMessage(BODY);
    expect(r.draft).toContain('waiting for availability');
    expect(r.intro).toBe('');
  });
  it('recognises it after an intro line', () => {
    const r = splitDraftMessage('Sorry. Here it is as plain text for you to select and copy:\n\n' + BODY);
    expect(r.intro).toMatch(/^Sorry/);
    expect(r.draft.startsWith('Hi,')).toBe(true);
  });
  it.each(['Hi Peter,', 'Dear Sir,', 'Hello,', 'Good morning,', 'Subject: x\n\nDear John,'])('recognises %s', (g) => {
    expect(splitDraftMessage(g + '\n\nBody text here.\n\nKind regards,').draft).toBeTruthy();
  });
  it('leaves ordinary chat alone', () => {
    expect(splitDraftMessage('The notice was served on 3 November. This is fine.').draft).toBe('');
  });
});
