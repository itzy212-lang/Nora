import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../state/appStore';
import sb from '../../supabaseClient';

const EVENT_TYPES = {
  consent_deadline:  { label: 'Consent deadline', colour: '#ef4444', bg: '#fee2e2' },
  s10_deadline:      { label: 'S.10 deadline',     colour: '#ef4444', bg: '#fee2e2' },
  notice_served:     { label: 'Notice served',     colour: '#22c55e', bg: '#dcfce7' },
  soc:               { label: 'SOC',               colour: '#8b5cf6', bg: '#ede9fe' },
  award_draft:       { label: 'Award draft',       colour: '#f59e0b', bg: '#fef3c7' },
  surveyor_response: { label: 'Surveyor response', colour: '#f97316', bg: '#ffedd5' },
  meeting:           { label: 'Meeting',           colour: '#3b82f6', bg: '#dbeafe' },
  call:              { label: 'Call',              colour: '#06b6d4', bg: '#cffafe' },
  site_visit:        { label: 'Site visit',        colour: '#10b981', bg: '#d1fae5' },
  todo:              { label: 'Task',              colour: '#6b7280', bg: '#f3f4f6' },
};

const DAY_NAMES   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function todayYMD() {
  return toYMD(new Date());
}

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':');
  const hr = parseInt(h, 10);
  if (Number.isNaN(hr)) return clean(t);
  return `${hr % 12 || 12}:${m || '00'}${hr < 12 ? 'am' : 'pm'}`;
}

function fmtDayFull(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function normalDate(value) {
  return clean(value).slice(0, 10);
}

function projectAddress(project = {}) {
  return clean(project.bo_premise_address || project.address || project.premise_address || project.appointment_address);
}

function aoAddress(ao = {}, project = {}) {
  return clean(ao.premise || ao.reg_addr || ao.address || ao.ao_premise_address || projectAddress(project));
}

function aoKey(ao = {}) {
  return clean(ao.id || ao.ao_id || ao.num || ao.name || ao.premise || ao.address);
}

function getAOs(project = {}) {
  return Array.isArray(project.aos) ? project.aos : [];
}

function projectDisplay(project = {}) {
  return projectAddress(project) || clean(project.name || project.ref || project.id || 'Project');
}

function findProject(projects = [], projectId) {
  return projects.find(p => String(p.id) === String(projectId)) || null;
}

function findAO(project = {}, aoId) {
  const id = clean(aoId);
  if (!id) return null;
  return getAOs(project).find(ao => String(aoKey(ao)) === String(id)) || null;
}

function taskAddress(task = {}, projects = []) {
  if (task.ao_address_snapshot) return clean(task.ao_address_snapshot);
  const project = findProject(projects, task.project_id || task.projectId);
  const ao = findAO(project || {}, task.ao_id || task.aoId);
  if (ao) return aoAddress(ao, project);
  return clean(task.project_address_snapshot || projectAddress(project || {}) || task.title || 'Task');
}

function buildTaskLabel(task = {}, projects = []) {
  const type = clean(task.task_type || task.type || 'todo');
  const address = taskAddress(task, projects);
  const title = clean(task.title || 'Task');

  if (type === 'soc') return `SOC - ${address || title}`;
  if (type === 'consent_deadline') return `Consent deadline - ${address || title}`;
  if (type === 's10_deadline') return `S.10 deadline - ${address || title}`;
  if (type === 'notice_served') return `Notice served - ${address || title}`;

  return address && title.toLowerCase() !== address.toLowerCase() ? `${title} - ${address}` : title;
}

function taskToEvent(task = {}, projects = []) {
  const date = normalDate(task.due_date || task.date);
  const project = findProject(projects, task.project_id);
  const ao = findAO(project || {}, task.ao_id);
  const type = clean(task.task_type || 'todo') || 'todo';

  return {
    id: task.id,
    task,
    source: 'task',
    date,
    time: clean(task.time || task.start_time),
    label: buildTaskLabel(task, projects),
    type,
    projectId: task.project_id || null,
    aoId: task.ao_id || null,
    address: ao ? aoAddress(ao, project) : taskAddress(task, projects),
    notes: clean(task.description || task.notes),
  };
}

async function safeInsert(table, payload) {
  let working = { ...(payload || {}) };
  let lastError = null;

  for (let i = 0; i < 14; i += 1) {
    const { data, error } = await sb.from(table).insert([working]).select('*').single();
    if (!error) return data || null;

    lastError = error;
    const missing = error.message?.match(/Could not find the '([^']+)' column/)?.[1];
    if (missing && Object.prototype.hasOwnProperty.call(working, missing)) {
      const next = { ...working };
      delete next[missing];
      working = next;
      continue;
    }

    throw error;
  }

  throw lastError || new Error('Could not insert record.');
}

async function safeUpdate(table, id, payload) {
  let working = { ...(payload || {}) };
  let lastError = null;

  for (let i = 0; i < 14; i += 1) {
    const { data, error } = await sb.from(table).update(working).eq('id', id).select('*').single();
    if (!error) return data || null;

    lastError = error;
    const missing = error.message?.match(/Could not find the '([^']+)' column/)?.[1];
    if (missing && Object.prototype.hasOwnProperty.call(working, missing)) {
      const next = { ...working };
      delete next[missing];
      working = next;
      continue;
    }

    throw error;
  }

  throw lastError || new Error('Could not update record.');
}

async function syncSocToAO(project, aoId, socData) {
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
    await safeUpdate('projects', liveProject.id, { aos: nextAOs });
  } catch (err) {
    console.warn('[Calendar] Could not sync SOC data to project AO card:', err.message);
  }
}

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  outline: 'none',
  boxSizing: 'border-box',
};

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function TaskModal({ task, defaultDate, projects, onSave, onDelete, onComplete, onClose }) {
  const isEdit = Boolean(task?.id);
  const initialProjectId = clean(task?.project_id || task?.projectId || '');
  const initialAOId = clean(task?.ao_id || task?.aoId || '');

  const [form, setForm] = useState({
    title: clean(task?.title || task?.label || ''),
    date: normalDate(task?.due_date || task?.date || defaultDate || todayYMD()),
    time: clean(task?.time || task?.start_time || ''),
    type: clean(task?.task_type || task?.type || 'todo') || 'todo',
    project_id: initialProjectId,
    ao_id: initialAOId,
    notes: clean(task?.description || task?.notes || ''),
  });
  const [saving, setSaving] = useState(false);

  const selectedProject = findProject(projects, form.project_id);
  const aos = getAOs(selectedProject || {});
  const showAOSelect = form.type === 'soc' && !!selectedProject;

  const set = (k, v) => setForm(f => {
    const next = { ...f, [k]: v };

    if (k === 'project_id') next.ao_id = '';

    if (k === 'type' && v === 'soc' && !next.title.trim()) {
      next.title = 'Schedule of Condition';
    }

    return next;
  });

  const selectedAO = showAOSelect ? findAO(selectedProject || {}, form.ao_id) : null;
  const resolvedAddress = selectedAO ? aoAddress(selectedAO, selectedProject) : projectDisplay(selectedProject || {});

  const handleSave = async () => {
    if (form.type === 'soc' && !form.project_id) {
      alert('Please select the project for this Schedule of Condition.');
      return;
    }

    if (form.type === 'soc' && aos.length > 0 && !form.ao_id) {
      alert('Please select the adjoining owner for this Schedule of Condition.');
      return;
    }

    setSaving(true);

    try {
      await onSave({
        ...form,
        title: form.title.trim() || (form.type === 'soc' ? 'Schedule of Condition' : 'Task'),
        project_address_snapshot: selectedProject ? projectDisplay(selectedProject) : '',
        ao_address_snapshot: selectedAO ? aoAddress(selectedAO, selectedProject) : '',
      }, task || null);
    } catch (err) {
      alert(err.message || 'Could not save task.');
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: 500, maxWidth: '96vw', maxHeight: '90vh', overflowY: 'auto', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{isEdit ? 'Edit task / appointment' : 'Add task / appointment'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Type">
            <select value={form.type} onChange={e => set('type', e.target.value)} style={inputStyle}>
              <option value="todo">To-do</option>
              <option value="meeting">Meeting</option>
              <option value="call">Call</option>
              <option value="site_visit">Site visit</option>
              <option value="soc">Schedule of Condition</option>
              <option value="surveyor_response">Surveyor response</option>
              <option value="award_draft">Award draft</option>
            </select>
          </Field>

          <Field label="Title">
            <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Schedule of Condition" style={inputStyle} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Date">
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)} style={inputStyle} />
            </Field>

            <Field label="Time">
              <input type="time" value={form.time} onChange={e => set('time', e.target.value)} style={inputStyle} />
            </Field>
          </div>

          <Field label="Project">
            <select value={form.project_id} onChange={e => set('project_id', e.target.value)} style={inputStyle}>
              <option value="">No project</option>
              {[...projects].sort((a,b) => { const na=parseInt((a.ref||'').replace(/\D/g,''),10)||0; const nb=parseInt((b.ref||'').replace(/\D/g,''),10)||0; return na-nb; }).map(p => (
                <option key={p.id} value={p.id}>{projectDisplay(p)}</option>
              ))}
            </select>
          </Field>

          {showAOSelect && (
            <Field label="Adjoining owner / SOC property">
              <select value={form.ao_id} onChange={e => set('ao_id', e.target.value)} style={inputStyle}>
                <option value="">Select adjoining owner</option>
                {aos.map((ao, index) => (
                  <option key={aoKey(ao) || index} value={aoKey(ao) || index}>
                    {aoAddress(ao, selectedProject)}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {form.type === 'soc' && resolvedAddress && (
            <div style={{ padding: '9px 11px', borderRadius: 10, background: 'var(--bg3)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text2)', lineHeight: 1.45 }}>
              This SOC will be linked to: <strong>{resolvedAddress}</strong>
            </div>
          )}

          <Field label="Notes">
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </Field>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 4 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {isEdit && (
                <button onClick={() => onDelete(task)} className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', borderRadius: 99, color: 'var(--red)' }}>
                  Delete
                </button>
              )}

              {isEdit && (
                <button onClick={() => onComplete(task)} className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', borderRadius: 99, color: 'var(--green)' }}>
                  Complete
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', borderRadius: 99 }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn btn-primary btn-sm" style={{ cursor: saving ? 'not-allowed' : 'pointer', borderRadius: 99 }}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EventCard({ ev, onOpenTask, onOpenProject }) {
  const cfg = EVENT_TYPES[ev.type] || EVENT_TYPES.todo;
  const editable = ev.source === 'task';

  return (
    <div
      onClick={() => editable && onOpenTask?.(ev.task || ev)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '10px 12px', borderRadius: 10, marginBottom: 8,
        background: '#f7f7f7', cursor: editable ? 'pointer' : 'default',
        borderLeft: `3px solid ${cfg.colour}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', lineHeight: 1.35 }}>
          {ev.time && <span style={{ color: cfg.colour, marginRight: 8, fontSize: 12, fontWeight: 600 }}>{fmtTime(ev.time)}</span>}
          {ev.label}
        </div>
        {ev.notes && <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2, lineHeight: 1.4 }}>{ev.notes}</div>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 99, background: cfg.bg, color: cfg.colour }}>{cfg.label}</span>
        {ev.projectId && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenProject?.(ev.projectId); }}
            style={{ border: 'none', background: 'transparent', color: 'var(--blue)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', padding: 0 }}
          >
            Project
          </button>
        )}
      </div>
    </div>
  );
}

function DayDetail({ dateStr, events, onAddTask, onOpenTask, onOpenProject }) {
  const dayEvents = events
    .filter(e => e.date === dateStr)
    .sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'));

  return (
    <div style={{ marginTop: 12, padding: '16px 20px', background: '#fcfcfc', border: '1px solid #ececec', borderRadius: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{fmtDayFull(dateStr)}</div>
        <button onClick={() => onAddTask(dateStr)} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 99 }}>+ Add</button>
      </div>

      {dayEvents.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text3)', fontStyle: 'italic' }}>Nothing scheduled. Click + Add to create a task or appointment.</div>
      ) : dayEvents.map((ev, i) => (
        <EventCard key={`${ev.source || 'event'}-${ev.id || i}`} ev={ev} onOpenTask={onOpenTask} onOpenProject={onOpenProject} />
      ))}
    </div>
  );
}

function WeekView({ currentDate, events, onDayClick, selectedDate }) {
  const monday = new Date(currentDate);
  const d = monday.getDay();
  monday.setDate(monday.getDate() - (d === 0 ? 6 : d - 1));
  const days = Array.from({ length: 7 }, (_, i) => { const dt = new Date(monday); dt.setDate(monday.getDate() + i); return dt; });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
      {days.map(dt => {
        const dateStr = toYMD(dt);
        const isToday = dateStr === todayYMD();
        const isSelected = dateStr === selectedDate;
        const dayEvts = events.filter(e => e.date === dateStr);

        return (
          <div key={dateStr} onClick={() => onDayClick(dateStr)} style={{
            background: '#fafafa', border: `1px solid ${isToday ? 'var(--blue)' : isSelected ? '#d9d9d9' : '#ececec'}`,
            borderRadius: 12, padding: 10, height: 140, overflow: 'hidden', cursor: 'pointer',
          }}>
            <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--blue)' : 'var(--text3)', marginBottom: 6 }}>
              {DAY_NAMES[dt.getDay()]} {dt.getDate()}
            </div>
            {dayEvts.slice(0, 3).map((ev, i) => {
              const cfg = EVENT_TYPES[ev.type] || EVENT_TYPES.todo;
              return (
                <div key={i} style={{ fontSize: 10.5, padding: '1px 5px', borderRadius: 4, background: cfg.bg, color: cfg.colour, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ev.label}
                </div>
              );
            })}
            {dayEvts.length > 3 && <div style={{ fontSize: 9.5, color: 'var(--text3)' }}>+{dayEvts.length - 3} more</div>}
          </div>
        );
      })}
    </div>
  );
}

function DayView({ currentDate, events, onAddTask, onOpenTask, onOpenProject }) {
  const dateStr = toYMD(currentDate);
  const dayEvts = events.filter(e => e.date === dateStr).sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'));
  const hours = Array.from({ length: 14 }, (_, i) => i + 7);

  const allDayEvents = dayEvts.filter(e => !e.time);

  return (
    <div style={{ background: '#fcfcfc', border: '1px solid #ececec', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{fmtDayFull(dateStr)}</div>
        <button onClick={() => onAddTask(dateStr)} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 99 }}>+ Add</button>
      </div>

      <div style={{ overflowY: 'auto', maxHeight: '60vh' }}>
        {allDayEvents.length > 0 && (
          <div style={{ padding: '8px 12px', background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>All day</div>
            {allDayEvents.map((ev, i) => (
              <EventCard key={`${ev.id || i}-all`} ev={ev} onOpenTask={onOpenTask} onOpenProject={onOpenProject} />
            ))}
          </div>
        )}

        {hours.map(hour => {
          const slotEvts = dayEvts.filter(e => e.time && parseInt(e.time.split(':')[0], 10) === hour);

          return (
            <div key={hour} style={{ display: 'flex', minHeight: 44, borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: 54, padding: '6px 8px', fontSize: 11, color: 'var(--text3)', flexShrink: 0, borderRight: '1px solid var(--border)' }}>
                {fmtTime(`${String(hour).padStart(2, '0')}:00`)}
              </div>
              <div style={{ flex: 1, padding: '4px 8px' }}>
                {slotEvts.map((ev, i) => (
                  <EventCard key={`${ev.id || i}-slot`} ev={ev} onOpenTask={onOpenTask} onOpenProject={onOpenProject} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Calendar({ onOpenProject }) {
  const { state } = useApp();
  const { projects = [] } = state;

  const [view, setView] = useState('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [taskEvents, setTaskEvents] = useState([]);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskModalDate, setTaskModalDate] = useState(todayYMD());
  const [editingTask, setEditingTask] = useState(null);

  const projectEvents = [];

  projects.forEach(project => {
    getAOs(project).forEach((ao, index) => {
      const cd = normalDate(ao.consent_deadline || ao.consentDeadline || '');
      const sd = normalDate(ao.s10_deadline || ao.s10Deadline || '');
      const ns = normalDate(ao.notice_served_date || ao.noticeServedDate || '');
      const addr = aoAddress(ao, project);
      const id = aoKey(ao) || index;

      if (cd) {
        projectEvents.push({
          id: `consent-${project.id}-${id}`,
          source: 'project_deadline',
          date: cd,
          label: `Consent deadline - ${addr}`,
          type: 'consent_deadline',
          projectId: project.id,
          aoId: id,
          address: addr,
        });
      }

      if (sd) {
        projectEvents.push({
          id: `s10-${project.id}-${id}`,
          source: 'project_deadline',
          date: sd,
          label: `S.10 deadline - ${addr}`,
          type: 's10_deadline',
          projectId: project.id,
          aoId: id,
          address: addr,
        });
      }

      if (ns) {
        projectEvents.push({
          id: `notice-${project.id}-${id}`,
          source: 'project_deadline',
          date: ns,
          label: `Notice served - ${addr}`,
          type: 'notice_served',
          projectId: project.id,
          aoId: id,
          address: addr,
        });
      }
    });
  });

  const loadTasks = useCallback(async () => {
    if (!sb) return;

    try {
      const { data, error } = await sb
        .from('tasks')
        .select('*')
        .neq('status', 'complete');

      if (error) throw error;

      // Exclude notice deadline task types — these are already shown as red AO date events
      const DEADLINE_TASK_TYPES = ['notice_consent_deadline', 'notice_section10_deadline', 'section_10_deadline'];
      setTaskEvents((data || [])
        .filter(t => t.due_date && !DEADLINE_TASK_TYPES.includes(t.task_type))
        .map(t => taskToEvent(t, projects))
      );
    } catch (err) {
      console.error('loadTasks', err);
    }
  }, [projects]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Refresh when a task is added from another component (e.g. inbox booking)
  useEffect(() => {
    const handler = () => loadTasks();
    window.addEventListener('nora:task-added', handler);
    return () => window.removeEventListener('nora:task-added', handler);
  }, [loadTasks]);

  const allEvents = [...projectEvents, ...taskEvents];

  const openAddTask = (dateStr) => {
    setTaskModalDate(dateStr || selectedDate || todayYMD());
    setEditingTask(null);
    setShowTaskModal(true);
  };

  const openEditTask = (task) => {
    if (!task) return;
    setEditingTask(task);
    setTaskModalDate(normalDate(task.due_date || task.date || selectedDate || todayYMD()));
    setShowTaskModal(true);
  };

  const closeTaskModal = () => {
    setShowTaskModal(false);
    setEditingTask(null);
  };

  const handleSaveTask = async (form, existingTask) => {
    const { data: { user } } = await sb.auth.getUser();
    const selectedProject = findProject(projects, form.project_id);
    const selectedAO = findAO(selectedProject || {}, form.ao_id);

    const payload = {
      title: form.title,
      due_date: form.date,
      time: form.time || null,
      status: existingTask?.status || 'pending',
      task_type: form.type,
      description: form.notes || '',
      project_id: form.project_id || null,
      ao_id: form.ao_id || null,
      user_id: user?.id || existingTask?.user_id || null,
      project_address_snapshot: form.project_address_snapshot || (selectedProject ? projectDisplay(selectedProject) : ''),
      ao_address_snapshot: form.ao_address_snapshot || (selectedAO ? aoAddress(selectedAO, selectedProject) : ''),
    };

    const saved = existingTask?.id
      ? await safeUpdate('tasks', existingTask.id, payload)
      : await safeInsert('tasks', payload);

    if (form.type === 'soc' && selectedProject && form.ao_id) {
      await syncSocToAO(selectedProject, form.ao_id, {
        date: form.date,
        time: form.time || '',
        taskId: saved?.id || existingTask?.id || '',
        status: 'booked',
      });
    }

    closeTaskModal();
    await loadTasks();
  };

  const handleDeleteTask = async (task) => {
    if (!task?.id) return;
    if (!window.confirm('Delete this task?')) return;

    const selectedProject = findProject(projects, task.project_id || task.projectId);
    const aoId = task.ao_id || task.aoId;
    const type = task.task_type || task.type;

    try {
      await sb.from('tasks').delete().eq('id', task.id);

      if (type === 'soc' && selectedProject && aoId) {
        await syncSocToAO(selectedProject, aoId, { clear: true });
      }

      closeTaskModal();
      await loadTasks();
    } catch (err) {
      alert(err.message || 'Could not delete task.');
    }
  };

  const handleCompleteTask = async (task) => {
    if (!task?.id) return;

    const selectedProject = findProject(projects, task.project_id || task.projectId);
    const aoId = task.ao_id || task.aoId;
    const type = task.task_type || task.type;

    try {
      await safeUpdate('tasks', task.id, {
        status: 'complete',
        completed_at: new Date().toISOString(),
      });

      if (type === 'soc' && selectedProject && aoId) {
        await syncSocToAO(selectedProject, aoId, {
          date: normalDate(task.due_date || task.date),
          time: clean(task.time || task.start_time),
          taskId: task.id,
          status: 'complete',
        });
      }

      closeTaskModal();
      await loadTasks();
    } catch (err) {
      alert(err.message || 'Could not complete task.');
    }
  };

  const navigate = (dir) => {
    const d = new Date(currentDate);
    if (view === 'month') d.setMonth(d.getMonth() + dir);
    if (view === 'week') d.setDate(d.getDate() + dir * 7);
    if (view === 'day') d.setDate(d.getDate() + dir);
    setCurrentDate(d);
  };

  const headerLabel = view === 'month'
    ? `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    : view === 'week' ? (() => {
        const m = new Date(currentDate);
        const day = m.getDay();
        m.setDate(m.getDate() - (day === 0 ? 6 : day - 1));
        const e = new Date(m); e.setDate(m.getDate() + 6);
        return `${m.getDate()} ${MONTH_NAMES[m.getMonth()]} - ${e.getDate()} ${MONTH_NAMES[e.getMonth()]} ${e.getFullYear()}`;
      })()
    : fmtDayFull(toYMD(currentDate));

  const handleDayClick = (dateStr) => {
    setSelectedDate(dateStr);
    if (view !== 'month') setCurrentDate(new Date(dateStr + 'T00:00:00'));
  };

  const handleOpenProj = (projectId) => {
    const proj = findProject(projects, projectId);
    if (proj) onOpenProject?.(proj);
  };

  const renderMonth = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells = [];

    for (let i = 0; i < firstDay; i += 1) {
      const d = new Date(year, month, -(firstDay - i - 1));
      cells.push({ date: toYMD(d), day: d.getDate(), faded: true });
    }

    for (let d = 1; d <= daysInMonth; d += 1) {
      cells.push({ date: `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, day: d, faded: false });
    }

    while (cells.length < 42) {
      const d = new Date(year, month + 1, cells.length - daysInMonth - firstDay + 1);
      cells.push({ date: toYMD(d), day: d.getDate(), faded: true });
    }

    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
          {DAY_NAMES.map(n => (
            <div key={n} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text3)', padding: '6px 0', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{n}</div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {cells.map(({ date, day, faded }) => {
            const isToday = date === todayYMD();
            const isSelected = date === selectedDate;
            const dayEvts = allEvents.filter(e => e.date === date);
            // 6 rows of cells; fit within ~65vh minus headers (~140px)
            const cellH = Math.max(72, Math.floor((window.innerHeight * 0.72 - 140) / 6));

            return (
              <div key={date} onClick={() => handleDayClick(date)} style={{
                height: cellH,
                background: '#fafafa',
                border: `1px solid ${isToday ? 'var(--blue)' : isSelected ? '#d9d9d9' : '#ececec'}`,
                borderRadius: 10, padding: '5px 6px',
                cursor: 'pointer', overflow: 'hidden',
                opacity: faded ? 0.35 : 1,
              }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 22, height: 22, borderRadius: '50%', marginBottom: 4,
                  background: isToday ? 'var(--blue)' : 'transparent',
                  fontSize: 12, fontWeight: isToday ? 700 : 400,
                  color: isToday ? '#fff' : 'var(--text)',
                }}>{day}</div>

                {dayEvts.slice(0, 3).map((ev, i) => {
                  const cfg = EVENT_TYPES[ev.type] || EVENT_TYPES.todo;
                  return (
                    <div key={i} style={{
                      fontSize: 9.5, padding: '1px 4px', borderRadius: 4, marginBottom: 2,
                      background: cfg.bg, color: cfg.colour, fontWeight: 500,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {ev.label}
                    </div>
                  );
                })}
                {dayEvts.length > 3 && (
                  <div style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 1 }}>+{dayEvts.length - 3} more</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: '24px 28px' }}>
      {showTaskModal && (
        <TaskModal
          task={editingTask}
          defaultDate={taskModalDate}
          projects={projects}
          onSave={handleSaveTask}
          onDelete={handleDeleteTask}
          onComplete={handleCompleteTask}
          onClose={closeTaskModal}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => navigate(-1)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', color: 'var(--text)', fontSize: 15 }}>←</button>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', minWidth: 200 }}>{headerLabel}</div>
          <button onClick={() => navigate(1)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', color: 'var(--text)', fontSize: 15 }}>→</button>
          <button onClick={() => { setCurrentDate(new Date()); setSelectedDate(todayYMD()); }}
            style={{ padding: '5px 14px', border: '1px solid var(--border)', borderRadius: 8, background: 'none', color: 'var(--text2)', fontSize: 12.5, cursor: 'pointer' }}>Today</button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {['Month','Week','Day'].map(v => (
              <button key={v} onClick={() => setView(v.toLowerCase())} style={{
                padding: '6px 16px', border: 'none', cursor: 'pointer', fontSize: 13,
                background: view === v.toLowerCase() ? 'var(--blue)' : 'var(--bg2)',
                color: view === v.toLowerCase() ? '#fff' : 'var(--text2)',
                fontWeight: view === v.toLowerCase() ? 600 : 400,
                borderRight: v !== 'Day' ? '1px solid var(--border)' : 'none',
              }}>{v}</button>
            ))}
          </div>
          <button onClick={() => openAddTask(selectedDate || todayYMD())}
            className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 99 }}>+ Add</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14, padding: '10px 14px', background: '#fcfcfc', border: '1px solid #ececec', borderRadius: 10 }}>
        {[['consent_deadline','Deadline'],['soc','SOC'],['meeting','Meeting/Call'],['todo','Task'],['notice_served','Notice served'],['site_visit','Site visit']].map(([k, lbl]) => {
          const cfg = EVENT_TYPES[k];
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text2)' }}>
              <div style={{ width: 9, height: 9, borderRadius: '50%', background: cfg.colour, flexShrink: 0 }} />
              {lbl}
            </div>
          );
        })}
      </div>

      {view === 'month' && renderMonth()}
      {view === 'week' && <WeekView currentDate={currentDate} events={allEvents} onDayClick={handleDayClick} selectedDate={selectedDate} />}
      {view === 'day' && <DayView currentDate={currentDate} events={allEvents} onAddTask={openAddTask} onOpenTask={openEditTask} onOpenProject={handleOpenProj} />}

      {selectedDate && view !== 'day' && (
        <DayDetail
          dateStr={selectedDate}
          events={allEvents}
          onAddTask={openAddTask}
          onOpenTask={openEditTask}
          onOpenProject={handleOpenProj}
        />
      )}
    </div>
  );
}

