/**
 * readLandRegistry.js — reading a Land Registry register for the New Project
 * form, and turning what was read into form fields.
 *
 * The server (api/extract-land-registry.js) reads the document. Nothing is
 * filled in until the user has seen what was read and confirmed it; these
 * helpers only build the patch that the confirm button applies.
 */

import sb from '../supabaseClient';

const SMALL_FILE_BYTES = 4 * 1024 * 1024; // stay under Vercel's ~4.5MB request ceiling

/** Send the file to the reader. Resolves to the register, or throws a plain-English Error. */
export async function readLandRegistryFile(file) {
  let res;
  if (file.size < SMALL_FILE_BYTES) {
    const formData = new FormData();
    formData.append('file', file);
    res = await fetch('/api/extract-land-registry', { method: 'POST', body: formData });
  } else {
    const storagePath = `extract-tmp/${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`;
    const { error: uploadError } = await sb.storage.from('chat-temp-uploads').upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
    });
    if (uploadError) throw new Error('Could not upload the file: ' + uploadError.message);
    res = await fetch('/api/extract-land-registry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storage_path: storagePath, file_name: file.name }),
    });
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Server error (${res.status}). Please try again.`);
  }
  if (!res.ok || !json?.register) throw new Error(json?.error || `Could not read the document (${res.status}).`);
  return json.register;
}

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Land Registry prints people's names in capitals. Make "JOHN ALAN SMITH" read "John Alan Smith". */
export function tidyPersonName(name) {
  const n = String(name || '').trim();
  if (!n || n !== n.toUpperCase()) return n; // already mixed case — leave exactly as given
  return n
    .toLowerCase()
    .replace(/(^|[\s\-'])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, ch) => 'Mc' + ch.toUpperCase());
}

export function displayOwnerName(owner) {
  return owner?.kind === 'company' ? String(owner.name || '').trim() : tidyPersonName(owner?.name);
}

/** Is the first owner's address for service somewhere other than the property itself? */
export function serviceAddressDiffers(register) {
  const svc = register?.owners?.[0]?.address_for_service;
  if (!svc) return false;
  const prop = squash(register.property_address);
  const s = squash(svc);
  if (!s) return false;
  if (!prop) return true;
  return !(s.includes(prop) || prop.includes(s));
}

/**
 * What to put into the form. target 'bo' fills the building owner fields,
 * 'ao' the adjoining owner fields. Only the first two owners fit the form;
 * `extraOwners` says how many were left out so the screen can tell the user.
 */
export function registerToFormPatch(register, target, { useServiceAddress = false } = {}) {
  const owners = (register?.owners || []).map((o) => ({ name: displayOwnerName(o) }));
  const prefix = target === 'ao' ? 'ao' : 'bo';
  const patch = {
    [`${prefix}Premise`]: register?.property_address || '',
    [`${prefix}1Name`]: owners[0]?.name || '',
    [`${prefix}2Name`]: owners[1]?.name || '',
  };
  const service = useServiceAddress ? (register?.owners?.[0]?.address_for_service || '') : '';
  patch[`${prefix}Service`] = service;
  patch.useService = !!service;
  patch.extraOwners = Math.max(0, owners.length - 2);
  return patch;
}
