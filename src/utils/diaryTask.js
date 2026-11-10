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

export function sortProjectsByAddress(projects = []) {
  return [...(Array.isArray(projects) ? projects : [])].sort((a, b) => {
    const nA = streetNumber(projectLabelOf(a));
    const nB = streetNumber(projectLabelOf(b));
    if (nA !== nB) return nA - nB;
    return projectLabelOf(a).localeCompare(projectLabelOf(b));
  });
}

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
 * Save the task. Throws if the database refuses it, so the caller can show the
 * real error instead of telling the user it was added.
 *
 * @param {{title:string,date:string,time?:string,end_time?:string,task_type?:string,
 *          project_id?:string,ao_id?:string,description?:string}} form
 * @param {object|null} project the full project (with .aos) for form.project_id
 */
export async function saveDiaryTask(form, project) {
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.id) throw new Error('You are signed out. Please sign in again and retry.');

  const type = form.task_type || 'appointment';
  const aos = aosOf(project || {});
  const ao = aos.find(a => aoKeyOf(a) === clean(form.ao_id)) || null;

  if (type === 'soc' && project && aos.length > 0 && !ao) {
    throw new Error('Select which adjoining owner this Schedule of Condition is for.');
  }

  const payload = {
    title: clean(form.title) || (type === 'soc' ? 'Schedule of Condition' : 'Task'),
    due_date: form.date || null,
    end_date: null,
    time: form.time || null,
    end_time: (['meeting', 'call', 'site_visit', 'appointment'].includes(type) && form.time && form.end_time && form.end_time > form.time) ? form.end_time : null,
    status: 'pending',
    task_type: type,
    description: form.description || '',
    project_id: form.project_id || null,
    ao_id: ao ? aoKeyOf(ao) : null,
    user_id: user.id,
    project_address_snapshot: project ? projectLabelOf(project) : '',
    ao_address_snapshot: ao ? aoAddressOf(ao, project) : '',
  };

  const { data: saved, error } = await sb.from('tasks').insert([payload]).select('*').single();
  if (error) throw error;

  if (type === 'soc' && project && ao) {
    await syncSocToAO(project, aoKeyOf(ao), {
      date: form.date,
      time: form.time || '',
      taskId: saved?.id || '',
      status: 'booked',
    });
  }

  return saved;
}
