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

  // Caught before shipping by running this against 20 Selborne Road's
  // actual transcript rather than trusting hand-written fixtures alone:
  // a decimal measurement ("approximately 1.8 meters in before fading
  // away") was being split in half, since a bare "." is a sentence
  // terminator too. That tore a whole observation apart — losing most
  // of it, not just mis-filing it under the wrong room.
  it('does not split on the decimal point in a measurement', () => {
    const text = 'There is a hairline crack that extends towards the centre of the room approximately 1.8 meters in before fading away. The next wall has a separate 0.5mm hairline crack.';
    const notes = splitTranscriptIntoNotes(text);
    expect(notes).toEqual([
      'There is a hairline crack that extends towards the centre of the room approximately 1.8 meters in before fading away.',
      'The next wall has a separate 0.5mm hairline crack.',
    ]);
  });

  it('round-trips the full 20 Selborne Road transcript with no content lost and every transition isolated', () => {
    const text = "Ok, starting the schedule of conditions at number 20, works are, notifiable works are localised to the outrigger, two steel beams being inserted into the party wall and the removal of the chimney breast in the building owner's outrigger. The outrigger itself is a kitchen, the party wall has a row, a run of kitchen units along the floor, with a central range cooker and extractor fan sitting above and either side of the extractor fan there are wall units extending out to the rear elevation in one direction and towards the main body of the house in the other where it finishes up against the fridge. Moving into the lean-to off the back of the outrigger. In the junction of the party wall and the connection of the rear elevation of the outrigger you can see that the lean-to is subsiding slightly away from the rear elevation wall. Moving back into the kitchen there is a window on the left-hand side of the door on the rear elevation of the outrigger. Again moving back into the kitchen just to note that the chimney breast at ground floor level in the kitchen has already been removed. Moving to the external rear elevation on the rear window of the first floor on the outrigger there is a hairline crack or there's cracking in the center of the cement windowsill that extends onto the brickwork underneath and staggers down to the top of the lean-to. Okay moving on to the first floor landing which extends from the main part of the property into the outrigger. Moving into the bedroom over the outrigger the chimney breast appears to then not extend into the bedroom so I imagine a section of it may have been removed previously. Extending out from the top left hand corner on the window on the rear elevation of the outrigger on the first floor there is a hairline crack that extends towards the center of the room approximately 1.8 meters in before fading away.";
    const notes = splitTranscriptIntoNotes(text);
    // Nothing lost or reordered.
    expect(notes.join(' ')).toBe(text);
    // The decimal measurement survives as one unbroken sentence.
    expect(notes.some(n => n.includes('approximately 1.8 meters in before fading away.'))).toBe(true);
    // Every "moving" transition is its own standalone note — never
    // sharing a note with the sentence before or after it.
    const transitions = notes.filter(n => /\bmoving\b/i.test(n));
    expect(transitions).toEqual([
      'Moving into the lean-to off the back of the outrigger.',
      'Moving back into the kitchen there is a window on the left-hand side of the door on the rear elevation of the outrigger.',
      'Again moving back into the kitchen just to note that the chimney breast at ground floor level in the kitchen has already been removed.',
      "Moving to the external rear elevation on the rear window of the first floor on the outrigger there is a hairline crack or there's cracking in the center of the cement windowsill that extends onto the brickwork underneath and staggers down to the top of the lean-to.",
      'Okay moving on to the first floor landing which extends from the main part of the property into the outrigger.',
      'Moving into the bedroom over the outrigger the chimney breast appears to then not extend into the bedroom so I imagine a section of it may have been removed previously.',
    ]);
  });
});
