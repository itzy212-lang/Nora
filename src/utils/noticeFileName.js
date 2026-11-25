/**
 * Short, readable file names for notice packs.
 *
 *   7 Village Close, Belsize Lane, London NW3 5AH  +  8 Village Close, ... NW3 5AH
 *     -> 7_8_Village_Close_NW3_5AH
 *
 * Same street: house numbers first, street once, then the postcode once.
 * Different streets: each number and street, then the first postcode.
 * Anything it cannot read falls back to the first part of each address.
 */

const POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const NUMBER_STREET_RE = /^\s*(\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?)\s+(.+?)\s*$/i;

export function parseAddress(address) {
  const text = String(address || '').trim();
  if (!text) return null;
  const pc = text.match(POSTCODE_RE);
  const postcode = pc ? `${pc[1].toUpperCase()} ${pc[2].toUpperCase()}` : '';
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(NUMBER_STREET_RE);
    if (m) return { number: m[1].replace(/\s+/g, ''), street: m[2], postcode, first: parts[0] };
  }
  return { number: '', street: '', postcode, first: parts[0] || text };
}

const tidy = (s) => String(s || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export function noticeFileBase(boAddress, aoAddress, aoName) {
  const bo = parseAddress(boAddress);
  const ao = parseAddress(aoAddress);

  if (bo?.number && bo.street && ao?.number && ao.street) {
    const same = bo.street.toLowerCase() === ao.street.toLowerCase();
    const postcode = tidy(bo.postcode || ao.postcode);
    const bits = same
      ? [bo.number, ao.number, bo.street, postcode]
      : [bo.number, bo.street, ao.number, ao.street, postcode];
    return tidy(bits.filter(Boolean).join('_'));
  }

  // Fallback: whatever readable part each side has.
  const boPart = bo ? (bo.number && bo.street ? `${bo.number}_${bo.street}` : bo.first) : 'Notice';
  const aoPart = ao ? (ao.number && ao.street ? `${ao.number}_${ao.street}` : ao.first) : (aoName || 'AO');
  return tidy([boPart, aoPart, bo?.postcode].filter(Boolean).join('_')) || 'Notice';
}

export function noticeFileName(boAddress, aoAddress, aoName, kind = 'Notice_Pack') {
  return `${noticeFileBase(boAddress, aoAddress, aoName)}_${kind}.pdf`;
}
