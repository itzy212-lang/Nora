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
    consent_deadline: ao.consent_deadline || ao.consentDeadline || null,
    s10_deadline: ao.s10_deadline || ao.s10Deadline || null,
    s10_served_date: ao.s10_served_date || ao.s10ServedDate || null,
    notice_served_date: ao.notice_served_date || ao.noticeServedDate || null,
    dissent_received_date: ao.dissent_received_date || ao.dissentReceivedDate || null,
    s104b_served_date: ao.s104b_served_date || null,
    award_served_date: ao.award_served_date || ao.awardServedDate || null,
    award_generated_at: ao.award_generated_at || ao.awardGeneratedAt || null,
    soc_agreed_date: ao.soc_agreed_date || ao.soc_date || ao.socDate || ao.socAgreedDate || null,
    schedule_of_condition_date: ao.schedule_of_condition_date || ao.scheduleOfConditionDate || ao.schedule_of_conditions_date || ao.scheduleOfConditionsDate || null,
    soc_status: ao.soc_status ?? null,
    soc_required: !!ao.soc_required,
    soc_task_id: ao.soc_task_id ?? null,
    third_surveyor_phone: ao.third_surveyor_phone ?? null,
    security_amount: ao.security_amount ?? null,
    section_11_amount: ao.section_11_amount ?? null,
    response_deadline: ao.response_deadline || ao.responseDeadline || null,
    sections_served: ao.sections_served ?? null,
    intention_date: ao.intention_date || null,
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
  if (list.length) {
    const rows = list.filter(ao => ao?.id).map(ao => toTableRow(ao, projectId));
    if (rows.length) {
      const { error: tableError } = await sb.from('adjoining_owners').upsert(rows, { onConflict: 'id' });
      if (tableError) console.warn('[saveAdjoiningOwners] table write failed:', tableError.message);
    }
  }

  // Legacy JSON write — temporary safety net during the transition,
  // not a second source of truth. Kept so existing read sites that
  // haven't been switched over yet don't silently go stale.
  const { error: jsonError } = await sb.from('projects').update({ aos: list }).eq('id', projectId);
  if (jsonError) console.warn('[saveAdjoiningOwners] JSON write failed:', jsonError.message);

  return { error: jsonError || null };
}
