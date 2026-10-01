import { describe, it, expect } from 'vitest';
import { splitTranscriptIntoNotes } from '../SOC.jsx';

// Regression coverage for the 2026-10-01 fix (tightened same day on
// further live evidence): uploading a single continuous site-visit
// recording (transcribed via Whisper, then imported) used to be sent to
// the live semantic processor as ONE note covering the whole transcript.
// The live processor resolves which section/room a note belongs to once
// per note, so every observation in a multi-room recording ended up
// filed under whichever single section the model picked for the entire
// thing — confirmed live on 20 Selborne Road: 32 observations spanning
// five distinct areas were all filed under "Kitchen".
//
// The first fix grouped several sentences per note (up to ~400 chars),
// which was still wrong: a room-transition sentence sharing a note with
// unrelated sentences either side of it got diluted and never triggered
// a section change — confirmed on a second attempt at the same
// recording, where "Moving into the lean-to..." and two separate
// "Moving back into the kitchen" sentences were silently absorbed into
// whatever section was already active. Splitting one sentence per note
// removes that ambiguity entirely.

describe('splitTranscriptIntoNotes', () => {
  it('splits a multi-sentence transcript into one note per sentence', () => {
    const text = 'There is a hairline crack to the chimney breast. Moving into the lean-to. The roof shows signs of water ingress.';
    const notes = splitTranscriptIntoNotes(text);
    expect(notes).toEqual([
      'There is a hairline crack to the chimney breast.',
      'Moving into the lean-to.',
      'The roof shows signs of water ingress.',
    ]);
  });

  it('never bundles a room-transition sentence together with the sentences around it', () => {
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
    expect(notes).toEqual(sentences);
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
