// src/utils/adjoiningOwners.js
// Added 2026-09-03, stage 2/4 of the AO consolidation planned and
// audited yesterday. adjoining_owners is now the migrated, verified,
// preferred read source (useProjects.js). This is the single, shared
// write path every AO-editing site should now go through, replacing
// each file's own independent sb.from('projects').update({ aos })
// call — the actual mechanism behind the original 'wrong stored
// contact' class of bug this whole effort started from.
//
// Dual-writes to both the table and the legacy JSON column for now,
// per the safer-transition approach agreed in the audit — the table
// is the real, going-forward source; the JSON write is a temporary
// safety net, not a second source of truth, and is intended to be
// removed once every write site is confirmed switched over and
// stable (stage 4 of the plan).
import sb from '../supabaseClient';

// Maps one AO's in-memory shape (however it currently looks, table-
// shaped or legacy-JSON-shaped) to the table's real column names.
// Accepts either naming convention for every dual-named field, since
// callers may still be passing objects built the old way.

// Helper: PostgreSQL date columns reject empty strings; convert to null
function toDateOrNull(val) {
  return (val === '' || val === null || val === undefined) ? null : val;
}

function toTableRow(ao, projectId) {
  return {
    id: ao.id,
    project_id: projectId,
    num: ao.num ?? null,
    name: ao.name ?? null,
    name2: ao.name2 ?? null,
    email: ao.email ?? null,
    email2: ao.email2 ?? null,
    phone: ao.phone ?? null,
    phone2: ao.phone2 ?? null,
    status: ao.status ?? null,
    address: ao.premise ?? ao.address ?? null,
    reg_addr: ao.reg_addr ?? null,
    service_address: ao.service_address ?? ao.serviceAddress ?? null,
    surveyor_name: ao.surv_name ?? ao.surveyorName ?? ao.surveyor_name ?? null,
    surveyor_email: ao.surv_email ?? ao.surveyorEmail ?? ao.surveyor_email ?? null,
    surveyor_firm: ao.surv_firm ?? ao.surveyorFirm ?? ao.surveyor_firm ?? null,
    third_surveyor_name: ao.third_surveyor_name ?? null,
    third_surveyor_email: ao.third_surveyor_email ?? null,
    third_surveyor_firm: ao.third_surveyor_firm ?? null,
    onedrive_folder_id: ao.onedrive_folder_id ?? null,
    onedrive_folder_url: ao.onedrive_folder_url ?? null,
    consent_deadline: toDateOrNull(ao.consent_deadline ?? ao.consentDeadline),
    s10_deadline: toDateOrNull(ao.s10_deadline ?? ao.s10Deadline),
    s10_served_date: toDateOrNull(ao.s10_served_date ?? ao.s10ServedDate),
    notice_served_date: toDateOrNull(ao.notice_served_date ?? ao.noticeServedDate),
    dissent_received_date: toDateOrNull(ao.dissent_received_date ?? ao.dissentReceivedDate),
    consent_received_date: toDateOrNull(ao.consent_received_date ?? ao.consentReceivedDate),
    s104b_served_date: toDateOrNull(ao.s104b_served_date),
    award_served_date: toDateOrNull(ao.award_served_date ?? ao.awardServedDate),
    award_generated_at: toDateOrNull(ao.award_generated_at ?? ao.awardGeneratedAt),
    award_deadline: toDateOrNull(ao.award_deadline ?? ao.awardDeadline),
    soc_agreed_date: toDateOrNull(ao.soc_agreed_date ?? ao.soc_date ?? ao.socDate ?? ao.socAgreedDate),
    schedule_of_condition_date: toDateOrNull(ao.schedule_of_condition_date ?? ao.scheduleOfConditionDate ?? ao.schedule_of_conditions_date ?? ao.scheduleOfConditionsDate),
    soc_status: ao.soc_status ?? null,
    soc_required: !!ao.soc_required,
    soc_task_id: ao.soc_task_id ?? null,
    third_surveyor_phone: ao.third_surveyor_phone ?? null,
    security_amount: ao.security_amount ?? null,
    section_11_amount: ao.section_11_amount ?? null,
    response_deadline: toDateOrNull(ao.response_deadline ?? ao.responseDeadline),
    sections_served: ao.sections_served ?? null,
    intention_date: toDateOrNull(ao.intention_date),
    intention_noted: !!ao.intention_noted,
    agreed_surveyor: !!ao.agreed_surveyor,
    appointed_by_me: !!ao.appointed_by_me,
  };
}

// Saves the full AO array for a project — dual-write during the
// transition period. Call this instead of writing to
// projects.aos directly. Returns { error } to match the shape
// existing call sites already check.
export async function saveAdjoiningOwners(projectId, aos) {
  if (!sb || !projectId) return { error: new Error('Missing client or projectId') };
  const list = Array.isArray(aos) ? aos : [];

  // Table write first — the real, going-forward source.
  let tableError = null;
  if (list.length) {
    const rows = list.filter(ao => ao?.id).map(ao => toTableRow(ao, projectId));
    if (rows.length) {
      const result = await sb.from('adjoining_owners').upsert(rows, { onConflict: 'id' });
      tableError = result.error;
      if (tableError) console.error('[saveAdjoiningOwners] table write failed:', tableError.message);
    }
  }

  // Fixed 2026-09-10, real, confirmed gap found while building AO
  // deletion: upsert above only ever adds or updates rows — it never
  // removes one for an AO no longer present in the list. Without
  // this, deleting an AO would correctly update the JSON column (a
  // full overwrite) but silently leave its row behind in the table,
  // which the app now reads from first — the deleted AO would still
  // be findable there even though it no longer appears anywhere in
  // the UI. Delete any existing table row for this project not
  // present in the current list, by id.
  if (!tableError) {
    try {
      const keepIds = list.map(ao => ao?.id).filter(Boolean);
      let deleteQuery = sb.from('adjoining_owners').delete().eq('project_id', projectId);
      deleteQuery = keepIds.length ? deleteQuery.not('id', 'in', `(${keepIds.join(',')})`) : deleteQuery;
      const { error: deleteError } = await deleteQuery;
      if (deleteError) console.warn('[saveAdjoiningOwners] stale row cleanup failed:', deleteError.message);
    } catch (err) {
      console.warn('[saveAdjoiningOwners] stale row cleanup failed:', err.message);
    }
  }

  // Legacy JSON write — temporary safety net during the transition,
  // not a second source of truth. Kept so existing read sites that
  // haven't been switched over yet don't silently go stale.
  // CRITICAL FIX 2026-09-15: This MUST happen regardless of table error,
  // otherwise if the table upsert fails, the JSON fallback never updates
  // and you get permanently stale data. The JSON is the true safety net.
  let jsonError = null;
  const result = await sb.from('projects').update({ aos: list }).eq('id', projectId);
  jsonError = result.error;
  if (jsonError) console.warn('[saveAdjoiningOwners] JSON write failed:', jsonError.message);

  return { error: tableError || jsonError || null };
}

// Added 2026-09-09, on request: moved here from Calendar.jsx — the
// only place this could previously be called from, despite the
// building-the-SOC-into-an-award flow needing it available from
// inside a project too. Now a genuinely shared function both the
// calendar and a project's own task modal call, rather than a
// second copy duplicating the same logic — exactly the pattern that
// caused a real, severe bug earlier today when this function's own
// write path fell out of sync with the rest of the app.
function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}
function aoKey(ao = {}) {
  return clean(ao.id || ao.ao_id || ao.num || ao.name || ao.premise || ao.address);
}
function getAOs(project = {}) {
  return Array.isArray(project.aos) ? project.aos : [];
}

export async function syncSocToAO(project, aoId, socData) {
  if (!project?.id || !aoId) return;
  // Always fetch fresh project from DB to avoid stale cache overwriting AO data
  const { data: freshProject, error: fetchErr } = await sb
    .from('projects').select('*').eq('id', project.id).single();
  const liveProject = (!fetchErr && freshProject) ? freshProject : project;
  const aos = getAOs(liveProject);
  if (!aos.length) return;

  const nextAOs = aos.map(ao => {
    const cleanedAoId = clean(aoId);
    if (String(aoKey(ao)) !== String(cleanedAoId)) return ao;

    if (socData.clear) {
      const next = { ...ao };
      delete next.soc_date;
      delete next.soc_time;
      delete next.soc_task_id;
      delete next.soc_status;
      delete next.soc_agreed_date;
      return next;
    }

    return {
      ...ao,
      soc_date: socData.date || '',
      soc_agreed_date: socData.date || '',
      soc_time: socData.time || '',
      soc_task_id: socData.taskId || ao.soc_task_id || '',
      soc_status: socData.status || ao.soc_status || 'booked',
    };
  });

  try {
    await saveAdjoiningOwners(liveProject.id, nextAOs);
  } catch (err) {
    console.warn('[syncSocToAO] Could not sync SOC data to project AO card:', err.message);
  }
}
