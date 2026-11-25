// api/lib/land-registry.js
//
// Reading a HM Land Registry "official copy of the register" (title register).
// Used by api/extract-land-registry.js (new project form button). Provider-
// neutral: it only reads a file's bytes, it never touches mail or storage.
//
// The register is a fixed, official layout: Property Register (the address and
// tenure), Proprietorship Register (the owners, each with an address for
// service) and Charges Register. We only want the first two. The model is told
// to COPY what is printed — never to tidy, complete or guess — and everything
// it returns is shown to the user to confirm before it is used.

const LAND_REGISTRY_PROMPT = `You are reading a HM Land Registry official copy of a register of title (England and Wales). Extract only what is printed. Copy names and addresses exactly as they appear — do not tidy, expand, complete, translate or guess anything. If a value is not printed, use null (or an empty array).

Where to look:
- TITLE NUMBER: printed near the top ("Title number ...").
- PROPERTY: the "A: Property Register" section gives the address of the land (for example "The Freehold land shown edged with red on the plan ... known as 18 Harcourt Road, London (N22 7XW)"). Take the postal address, with postcode if printed. Also note whether it is freehold or leasehold.
- OWNERS: the "B: Proprietorship Register" section lists the registered proprietor(s) under "PROPRIETOR:". There may be one, two or more people, or a company. For each, take the full name exactly as printed, and the address printed for them, which is their address for service (it may be the property itself, or somewhere else, or a company's registered office). If a company, note that, and copy the company registration number if printed.
- Ignore the Charges Register (mortgages), restrictions, covenants and notes — we do not need them. Do NOT treat a lender or a chargee as an owner.

If the document is not a Land Registry register of title at all, set "is_land_registry_register" to false and leave the rest empty.

Return ONLY valid JSON, no markdown:
{
  "is_land_registry_register": true,
  "title_number": "e.g. NGL123456 or null",
  "tenure": "freehold | leasehold | null",
  "property_address": "as printed, with postcode, or null",
  "owners": [
    {
      "name": "full name exactly as printed",
      "kind": "person | company",
      "company_number": "if a company and printed, else null",
      "address_for_service": "exactly as printed for this proprietor, or null"
    }
  ],
  "notes": "anything unclear, cut off or hard to read, in one short sentence, or null"
}`;

const clean = (v) => (v === undefined || v === null ? '' : String(v).replace(/\s+/g, ' ').trim());

function parseModelJson(raw) {
  const text = String(raw || '').replace(/```json|```/g, '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Model sometimes wraps the object in prose — take the outermost braces.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Turn whatever the model returned into the shape the app uses. Never invents:
 * anything missing stays empty, and owners without a name are dropped.
 */
function normaliseLandRegistry(raw) {
  const obj = typeof raw === 'string' ? parseModelJson(raw) : raw;
  if (!obj || typeof obj !== 'object') return null;

  const owners = (Array.isArray(obj.owners) ? obj.owners : [])
    .map((o) => ({
      name: clean(o?.name),
      kind: clean(o?.kind).toLowerCase() === 'company' ? 'company' : 'person',
      company_number: clean(o?.company_number),
      address_for_service: clean(o?.address_for_service),
    }))
    .filter((o) => o.name);

  const tenure = clean(obj.tenure).toLowerCase();

  return {
    is_land_registry_register: obj.is_land_registry_register !== false && (owners.length > 0 || !!clean(obj.title_number) || !!clean(obj.property_address)),
    title_number: clean(obj.title_number),
    tenure: tenure === 'freehold' || tenure === 'leasehold' ? tenure : '',
    property_address: clean(obj.property_address),
    owners,
    notes: clean(obj.notes),
  };
}

/**
 * Same thing, from the register's own text, WITHOUT a model: used only to
 * decide whether a PDF has readable text at all (a scan has none), and to
 * recognise a register before spending a model call on it.
 */
function looksLikeRegisterText(text) {
  const t = String(text || '');
  return /register of title|title number|proprietorship register|property register/i.test(t);
}

export { LAND_REGISTRY_PROMPT, normaliseLandRegistry, parseModelJson, looksLikeRegisterText };
