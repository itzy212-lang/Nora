/**
 * diaryTask.js — saving a diary entry (appointment / Schedule of Condition /
 * site visit …) the same way the Calendar screen does.
 *
 * The "Add to diary" pop-up on an email used to insert a bare task row: no
 * owner (user_id), no adjoining owner, no address snapshots, and it never told
 * the project's adjoining-owner card about a Schedule of Condition date. Because
 * tasks are only visible to the user who owns them, a task without user_id could
 * not even appear in the calendar. This is the same payload Calendar.jsx's
 * handleSaveTask builds, so both places now produce an identical task.
 */

import sb from '../supabaseClient';
import { syncSocToAO } from './adjoiningOwners';

const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());

export function projectAddressOf(project = {}) {
  return clean(project.bo_premise_address || project.address || project.premise_address || project.appointment_address);
}

export function projectLabelOf(project = {}) {
  return projectAddressOf(project) || clean(project.name || project.ref || project.id || 'Project');
}

export function aoKeyOf(ao = {}) {
  return clean(ao.id || ao.ao_id || ao.num || ao.name || ao.premise || ao.address);
}

export function aoAddressOf(ao = {}, project = {}) {
  return clean(ao.premise || ao.reg_addr || ao.address || ao.ao_premise_address || projectAddressOf(project));
}

const streetNumber = (addr) => {
  const m = clean(addr).match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : Infinity;
};

export function aosOf(project = {}) {
  const aos = Array.isArray(project?.aos) ? project.aos : [];
  return [...aos].sort((a, b) => {
    const nA = streetNumber(aoAddressOf(a, project));
    const nB = streetNumber(aoAddressOf(b, project));
    if (nA !== nB) return nA - nB;
    return aoAddressOf(a, project).localeCompare(aoAddressOf(b, project));
  });
}

const squash = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Which adjoining owner is this appointment for? Returns the AO's key when
 * there is exactly one candidate: the project has only one AO, or exactly one
 * AO's address appears in the text the email mentioned. Otherwise ''.
 */
export function guessAoId(project, ...hints) {
  const aos = aosOf(project);
  if (aos.length === 1) return aoKeyOf(aos[0]);
  const text = squash(hints.filter(Boolean).join(' '));
  if (!text) return '';
  const matches = aos.filter(ao => {
    const addr = squash(aoAddressOf(ao, project));
    return addr.length >= 4 && (text.includes(addr) || addr.includes(text));
  });
  return matches.length === 1 ? aoKeyOf(matches[0]) : '';
}

/**
 * Save a task from the Calendar's task form (new or existing). Used by the
 * Calendar itself AND by the email "Add to diary" pop-up, which now opens the
 * very same form — so a diary entry is identical wherever it is created.
 *
 * Throws if the database refuses it, so the caller can show the real error.
 *
 * @param form         the Calendar task form: { title, date, time, end_time, type,
 *                     project_id, ao_id, notes, end_date }
 * @param existingTask the task being edited, or null for a new one
 * @param project      the full project (with .aos) for form.project_id, or null
 */
export async function saveTaskFromForm(form, existingTask, project) {
  const { data: { user } } = await sb.auth.getUser();
  const type = form.type || 'todo';
  const ao = aosOf(project || {}).find(a => aoKeyOf(a) === clean(form.ao_id)) || null;

  const payload = {
    title: form.title,
    due_date: form.date,
    end_date: type === 'holiday' ? (form.end_date || form.date) : null,
    time: form.time || null,
    end_time: (['meeting', 'call', 'site_visit', 'appointment'].includes(type) && form.time && form.end_time && form.end_time > form.time) ? form.end_time : null,
    status: existingTask?.status || 'pending',
    task_type: type,
    description: form.notes || '',
    project_id: form.project_id || null,
    ao_id: form.ao_id || null,
    user_id: user?.id || existingTask?.user_id || null,
    project_address_snapshot: form.project_address_snapshot || (project ? projectLabelOf(project) : ''),
    ao_address_snapshot: form.ao_address_snapshot || (ao ? aoAddressOf(ao, project) : ''),
  };

  const query = existingTask?.id
    ? sb.from('tasks').update(payload).eq('id', existingTask.id)
    : sb.from('tasks').insert([payload]);
  const { data: saved, error } = await query.select('*').single();
  if (error) throw error;

  if (type === 'soc' && project && form.ao_id) {
    await syncSocToAO(project, form.ao_id, {
      date: form.date,
      time: form.time || '',
      taskId: saved?.id || existingTask?.id || '',
      status: 'booked',
    });
  }

  return saved;
}
