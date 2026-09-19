// api/lib/soc-brain-v2/reference-codes.js
//
// Nora SOC v2 — human-facing SOC observation reference codes.
//
// This is presentation only. It reads the final, stable-row_id output
// (D6's guarded sections, or D3's own sections if used standalone) and
// derives a short, human-friendly reference string per row — nothing
// here touches row_id, section_id, or source_item_ids, and nothing
// here is used as an identity by any other stage. A surveyor-facing
// label and a machine-stable identity are deliberately different
// things; this module produces only the former.
//
// General rule, derived from the requested examples (not hard-coded
// to any specific room name): strip a leading floor-level phrase,
// then take the first letter of each remaining significant word,
// dropping a small set of generic room-type suffix words ("Room",
// "Area", "Space") that add no distinguishing information on their
// own. A single-word room name (Kitchen, Bathroom, Hallway, Landing)
// abbreviates to its own first letter. Collisions within one SOC are
// resolved deterministically, never by silently duplicating a code.

const FLOOR_PREFIX_PATTERN = /^(ground|lower ground|first|second|third|fourth|fifth|top|attic|loft|basement|mezzanine)\s+floor\s+/i;
// Some floor-level words stand alone without "Floor" following (a
// "Basement" or "Loft" is already unambiguous on its own, unlike
// "Ground"/"First"/"Second" which need "Floor" to mean anything).
const BARE_FLOOR_WORD_PATTERN = /^(basement|loft|attic|mezzanine)\s+/i;

const GENERIC_SUFFIX_WORDS = new Set(['room', 'area', 'space']);

function stripFloorPrefix(name) {
  const withoutFullPhrase = (name || '').replace(FLOOR_PREFIX_PATTERN, '').trim();
  return withoutFullPhrase.replace(BARE_FLOOR_WORD_PATTERN, '').trim();
}

function significantWords(name) {
  const words = name.split(/\s+/).filter(Boolean);
  const filtered = words.filter(w => !GENERIC_SUFFIX_WORDS.has(w.toLowerCase()));
  // If filtering removed everything (a room literally named "Room" or
  // similar edge case), fall back to the unfiltered word list rather
  // than producing an empty abbreviation.
  return filtered.length ? filtered : words;
}

/**
 * Derives a base abbreviation for one room name, with no awareness of
 * any other room in the same SOC - collision handling is a separate,
 * later step (assignRoomAbbreviations) so every room's own derivation
 * stays independent and predictable.
 */
export function deriveBaseAbbreviation(sectionName) {
  const stripped = stripFloorPrefix(sectionName);
  const words = significantWords(stripped);
  if (!words.length) return 'RM'; // pathological empty-name fallback only
  return words.map(w => w[0].toUpperCase()).join('');
}

/**
 * Assigns a unique, deterministic abbreviation to every section,
 * given in first-visit order. Collisions are resolved by, in order:
 * 1. using more of each colliding room's own significant words if
 *    more are available than the base abbreviation already uses;
 * 2. falling back to a numeric suffix on the later-occurring room(s)
 *    in first-visit order, so the distinction is stable and never
 *    depends on arbitrary map/object iteration order.
 */
export function assignRoomAbbreviations(sections) {
  const base = sections.map(s => ({
    section_id: s.section_id,
    section_name: s.section_name,
    words: significantWords(stripFloorPrefix(s.section_name)),
    letters: 1,
  }));

  function abbrevFor(entry) {
    const words = entry.words.length ? entry.words : [entry.section_name || 'Room'];
    const n = Math.min(entry.letters, words.length);
    return words.slice(0, n).map(w => w[0].toUpperCase()).join('') || 'RM';
  }

  // Expand letters used for any group that currently collides, up to
  // the longest available word count, before falling back to numbers.
  let changed = true;
  while (changed) {
    changed = false;
    const groups = new Map();
    for (const e of base) {
      const code = abbrevFor(e);
      if (!groups.has(code)) groups.set(code, []);
      groups.get(code).push(e);
    }
    for (const group of groups.values()) {
      if (group.length <= 1) continue;
      for (const e of group) {
        if (e.letters < e.words.length) { e.letters += 1; changed = true; }
      }
    }
  }

  // Anything still colliding after exhausting every room's own words
  // (e.g. two identically-named rooms) gets a stable numeric suffix,
  // assigned in first-visit order - the order `sections` was given in.
  const finalCodes = new Map();
  const seen = new Map();
  for (const e of base) {
    let code = abbrevFor(e);
    if (seen.has(code)) {
      const count = seen.get(code) + 1;
      seen.set(code, count);
      code = `${code}${count}`;
    } else {
      seen.set(code, 1);
    }
    finalCodes.set(e.section_id, code);
  }
  return finalCodes;
}

/**
 * Adds a human_reference field to every row of every section -
 * purely additive presentation data. row_id, section_id, and
 * source_item_ids on each row are passed through completely
 * untouched; this never mutates the object it's given.
 */
export function applyHumanReferenceCodes(sections) {
  const abbreviations = assignRoomAbbreviations(sections);
  return sections.map(section => {
    const abbrev = abbreviations.get(section.section_id) || 'RM';
    return {
      ...section,
      room_abbreviation: abbrev,
      rows: section.rows.map((row, i) => ({
        ...row,
        human_reference: `${abbrev}${String(i + 1).padStart(2, '0')}`,
      })),
    };
  });
}
