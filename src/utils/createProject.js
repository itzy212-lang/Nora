// src/utils/createProject.js
//
// ONE way to create a party wall project record. Used by the New Project form
// AND by the main chat's "create a project from this email" confirm card, so a
// project made either way is identical: same reference numbering, same fields,
// same adjoining-owner record, same storage folder.
//
// Storage is provider-neutral: the folder is created through createProjectFolder
// (utils/providers) for whichever of OneDrive / Google Drive the user has set.

import sb from '../supabaseClient';
import { saveAdjoiningOwners } from './adjoiningOwners';
import { createProjectFolder } from './providers';

export async function getNextRef() {
  try {
    const { data } = await sb
      .from('projects')
      .select('ref')
      .order('created_at', { ascending: false })
      .limit(20);

    const year = new Date().getFullYear();

    const nums = (data || [])
      .map(p => p.ref || '')
      .filter(r => r.startsWith(`SQ1-${year}-`))
      .map(r => parseInt(r.split('-')[2], 10) || 0);

    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;

    return `SQ1-${year}-${String(next).padStart(3, '0')}`;
  } catch {
    return `SQ1-${new Date().getFullYear()}-001`;
  }
}

export function buildAORecord(form, aoService) {
  return {
    // Fixed 2026-09-03, part of the AO consolidation: the old
    // `ao-${Date.now()}` format isn't a valid UUID, which the
    // adjoining_owners table's id column requires — confirmed
    // directly as the exact issue that caused problems migrating
    // existing data with this same legacy format. New AOs now get a
    // real UUID from the start.
    id: crypto.randomUUID(),
    num: 1,

    premise: form.aoPremise.trim(),
    address: form.aoPremise.trim(),
    reg_addr: aoService || form.aoPremise.trim(),
    service_address: aoService || form.aoPremise.trim(),

    name: form.ao1.name.trim(),
    email: form.ao1.email.trim() || '',
    phone: form.ao1.phone.trim() || '',

    name2: form.ao2.name.trim() || '',
    email2: form.ao2.email.trim() || '',
    phone2: form.ao2.phone.trim() || '',

    status: 'appointed_ao',
    appointed_by_me: true,
    agreed_surveyor: false,

    notice_served_date: '',
    noticeServedDate: '',
    consent_deadline: '',
    consentDeadline: '',
    s10_deadline: '',
    s10Deadline: '',

    surv_name: '',
    surveyorName: '',
    surv_firm: '',
    surveyorFirm: '',
    surv_email: '',
    surveyorEmail: '',
    surv_phone: '',
    surveyorPhone: '',
  };
}

/**
 * Insert the project, its adjoining-owner record(s) and its storage folder.
 * Throws if the project itself cannot be saved; a failed folder is logged and
 * does not undo the project (same behaviour the form always had).
 *
 * @param form       the New Project form shape (role, boPremise, bo1, ao1 ...)
 * @param ref        project reference, e.g. SQ1-2026-123 (from getNextRef)
 * @param user       the signed-in user ({ id })
 * @returns          the saved project row, with any storage folder ids merged in
 */
export async function createProjectRecord({ form, ref, user, defaultStage = 'live', isConstruction = false, boSameAddr = false, aoSameAddr = false }) {
  const isAO = form.role === 'AO';
  const fee = form.fee && String(form.fee).trim() ? parseFloat(form.fee) : null;
  const newId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const boPremise = form.boPremise.trim();
      const boService = (boSameAddr ? form.boPremise : form.boService).trim();
      const aoPremise = form.aoPremise.trim();
      const aoService = (aoSameAddr ? form.aoPremise : form.aoService).trim();

      const payload = {
        id: newId,
        user_id: user?.id || null,

        ref,
        role: form.role,   // valid column — appointment_role does not exist
        status: 'active',

        // Building owner — top-level columns that exist in schema
        bo_premise_address: boPremise || null,
        bo_service_address: boService || boPremise || null,
        bo_1_name: form.bo1.name.trim() || null,
        bo: form.bo1.name.trim() || null,       // legacy display field
        bo_1_email: form.bo1.email.trim() || null,
        bo_phone: form.bo1.phone.trim() || null, // only one phone column
        bo_2_name: form.bo2.name.trim() || null,
        bo_2_email: form.bo2.email.trim() || null,
        // bo_email / bo_2_phone do not exist in schema — omitted

        // Adjoining owner — schema has ao_client_name, ao_email, ao_phone (single owner)
        // Owner 2 and full AO details live in the aos jsonb array below
        ao_premise_address: aoPremise || null,
        ao_service_address: aoService || aoPremise || null,
        ao_client_name: form.ao1.name.trim() || null,
        ao_email: form.ao1.email.trim() || null,
        ao_phone: form.ao1.phone.trim() || null,
        // ao_2_name / ao_2_email / ao_2_phone are not top-level columns — in aos jsonb

        // Full AO record (including owner 2) stored in aos jsonb
        aos: isAO ? [buildAORecord(form, aoService || aoPremise)] : [],

        works: form.works.trim() || null,
        fee: Number.isFinite(fee) ? fee : null,
        project_type: form.project_type || 'party_wall',
        // Added 2026-08-21, on request: leads are real project records
        // from the start, just flagged — 'Add New Lead' passes
        // defaultStage='lead' through so the same creation flow marks
        // it correctly, no separate lead table or form.
        stage: defaultStage,
        quote_status: isConstruction ? 'draft' : null,
        client_name: isConstruction ? (form.bo1.name.trim() || null) : null,
        client_email: isConstruction ? (form.bo1.email.trim() || null) : null,
        site_address: isConstruction ? (boPremise || null) : null,
        contract_value: isConstruction && form.fee.trim() ? parseFloat(form.fee) : null,
      };

      const { data, error: err } = await sb
        .from('projects')
        .insert([payload])
        .select('*')
        .single();

      if (err) throw err;

      // Added 2026-09-03, part of the AO consolidation: the project
      // insert above already includes aos in its payload (the JSON
      // write), but the new adjoining_owners table needs its own
      // row created too, which only happens once we have the real
      // project id back from the insert.
      if (payload.aos?.length) {
        await saveAdjoiningOwners(data.id, payload.aos);
      }

      // Auto-create OneDrive folder for new project
      const boAddr = boPremise || payload.bo_premise_address || '';
      if (boAddr && data?.id) {
        try {
          const user = await sb.auth.getUser();
          const userId = user?.data?.user?.id;
          if (!userId) {
            console.warn('[createProject] Could not determine current user — skipping folder creation.');
          } else {
            // Create folder using user's configured provider (OneDrive or Google Drive)
            const folderData = await createProjectFolder(userId, boAddr);
            
            if (folderData?.folder_id) {
              // Update project with folder info (will be stored in either onedrive or google_drive columns)
              const { data: integrations } = await sb
                .from('user_integrations')
                .select('storage_provider')
                .eq('user_id', userId)
                .single();

              const provider = integrations?.storage_provider || 'onedrive';
              const updateData = provider === 'googledrive'
                ? { google_drive_folder_id: folderData.folder_id, google_drive_folder_url: folderData.web_url || null }
                : { onedrive_folder_id: folderData.folder_id, onedrive_folder_url: folderData.web_url || null };

              await sb.from('projects').update(updateData).eq('id', data.id);
              // Fixed 2026-09-17, real, confirmed bug found by
              // tracing the actual code path start to finish: this
              // wrote the folder id to the database but never updated
              // the local `data` object handed off to open the new
              // project — so the in-memory project everything renders
              // from was missing google_drive_folder_id/
              // onedrive_folder_id from the moment the project screen
              // first opened, even though the database had it
              // correctly. Adding an AO straight after checks
              // project.google_drive_folder_id from that stale
              // in-memory copy, finds nothing, and silently skips
              // creating its subfolder — no error, nothing logged.
              Object.assign(data, updateData);
            }
          }
        } catch (folderErr) {
          console.warn('[createProject] Folder creation failed:', folderErr.message);
        }
      }

  return data;
}
