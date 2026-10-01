import { describe, it, expect } from 'vitest';
import { splitTranscriptIntoNotes } from '../SOC.jsx';

// Regression coverage for the 2026-10-01 fix: uploading a single
// continuous site-visit recording (transcribed via Whisper, then
// imported) used to be sent to the live semantic processor as ONE note
// covering the whole transcript. The live processor resolves which
// section/room a note belongs to once per note, so every observation in
// a multi-room recording ended up filed under whichever single section
// the model picked for the entire thing — confirmed live on 20 Selborne
// Road: 32 observations spanning five distinct areas were all filed
// under "Kitchen". This file covers the fix: splitting the transcript
// back into sentence-sized notes before it reaches the processor, so
// room transitions actually get a fresh section-resolution call each
// time, as they do in ordinary dictation.

describe('splitTranscriptIntoNotes', () => {
  it('keeps a short multi-sentence transcript grouped together, with content intact', () => {
    const text = 'There is a hairline crack to the chimney breast. Moving into the lean-to. The roof shows signs of water ingress.';
    const notes = splitTranscriptIntoNotes(text);
    expect(notes.join(' ')).toContain('Moving into the lean-to');
  });

  it('never produces a single note for a long multi-room transcript', () => {
    const sentences = [
      'In the kitchen there is a hairline crack above the window.',
      'Moving into the lean-to off the back of the outrigger.',
      'There is evidence of subsidence to the lean-to roof.',
      'Moving back into the kitchen for a moment.',
      'The tiled floor shows some wear near the door.',
      'Moving to the external rear elevation.',
      'The render is cracked in several places.',
      'Okay moving on to the first floor landing.',
      'The carpet is slightly worn.',
      'Moving into the bedroom over the outrigger.',
      'There is a damp patch to the ceiling.',
    ];
    const text = sentences.join(' ');
    const notes = splitTranscriptIntoNotes(text);
    expect(notes.length).toBeGreaterThan(1);
    // Every sentence's content should still be present somewhere, unsplit mid-word.
    const rejoined = notes.join(' ');
    for (const s of sentences) {
      expect(rejoined).toContain(s.replace(/\.$/, ''));
    }
  });

  it('groups short consecutive sentences rather than sending one note per sentence', () => {
    const text = 'Small crack. Another small crack. A third one.';
    const notes = splitTranscriptIntoNotes(text);
    expect(notes.length).toBe(1);
  });

  it('keeps a single long sentence intact even with no punctuation', () => {
    const text = 'the wall has a crack running diagonally from the window to the floor roughly a metre long';
    const notes = splitTranscriptIntoNotes(text);
    expect(notes).toEqual([text]);
  });

  it('returns an empty array for empty input', () => {
    expect(splitTranscriptIntoNotes('')).toEqual([]);
  });
});
