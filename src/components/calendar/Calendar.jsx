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
function todayYMD() { return toYMD(new Date()); }
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h);
  return `${hr % 12 || 12}:${m}${hr < 12 ? 'am' : 'pm'}`;
}
function fmtDayFull(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Add Task Modal ─────────────────────────────────────────────────────────────
function AddTaskModal({ defaultDate, projects, onSave, onClose }) {
  const [form, setForm] = useState({ title: '', date: defaultDate || todayYMD(), time: '', type: 'todo', project_id: '', notes: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.title.trim()) return;
    try {
      const { data: { user } } = await sb.auth.getUser();
      await sb.from('tasks').insert({
        title: form.title, due_date: form.date, status: 'pending',
        task_type: form.type, description: form.notes,
        project_id: form.project_id || null, user_id: user?.id,
        project_address_snapshot: projects.find(p => p.id === form.project_id)?.address || '',
      });
      onSave();
    } catch (err) { alert('Could not save: ' + err.message); }
  };

  const inp = { width: '100%', padding: '8px 10px', fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 440, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Add task / appointment</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { label: 'Title', el: <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Site visit — 42 High Street" style={inp} /> },
            { label: 'Type', el: (
              <select value={form.type} onChange={e => set('type', e.target.value)} style={inp}>
                <option value="todo">To-do</option>
                <option value="meeting">Meeting</option>
                <option value="call">Call</option>
                <option value="site_visit">Site visit</option>
                <option value="soc">SOC Appointment</option>
                <option value="surveyor_response">Surveyor response</option>
              </select>
            )},
            { label: 'Date', el: <input type="date" value={form.date} onChange={e => set('date', e.target.value)} style={inp} /> },
            { label: 'Time (optional)', el: <input type="time" value={form.time} onChange={e => set('time', e.target.value)} style={inp} /> },
            { label: 'Project (optional)', el: (
              <select value={form.project_id} onChange={e => set('project_id', e.target.value)} style={inp}>
                <option value="">— no project —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.ref} — {p.address}</option>)}
              </select>
            )},
            { label: 'Notes', el: <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} style={{ ...inp, resize: 'none' }} /> },
          ].map(({ label, el }) => (
            <div key={label}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{label}</div>
              {el}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button onClick={onClose} className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', borderRadius: 99 }}>Cancel</button>
            <button onClick={handleSave} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 99 }}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Day detail panel (below calendar) ─────────────────────────────────────────
function DayDetail({ dateStr, events, onAddTask, onOpenProject }) {
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
      ) : dayEvents.map((ev, i) => {
        const cfg = EVENT_TYPES[ev.type] || EVENT_TYPES.todo;
        return (
          <div key={i}
            onClick={() => ev.projectId && onOpenProject(ev.projectId)}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '10px 12px', borderRadius: 10, marginBottom: 8,
              background: '#f7f7f7', cursor: ev.projectId ? 'pointer' : 'default',
              borderLeft: `3px solid ${cfg.colour}`,
            }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                {ev.time && <span style={{ color: cfg.colour, marginRight: 8, fontSize: 12, fontWeight: 600 }}>{fmtTime(ev.time)}</span>}
                {ev.label}
              </div>
              {ev.projectRef && <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>{ev.projectRef}</div>}
              {ev.notes     && <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>{ev.notes}</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 99, background: cfg.bg, color: cfg.colour }}>{cfg.label}</span>
              {ev.projectId && <span style={{ fontSize: 11, color: 'var(--blue)' }}>open →</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Week view ─────────────────────────────────────────────────────────────────
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

// ── Day view ──────────────────────────────────────────────────────────────────
function DayView({ currentDate, events, onAddTask }) {
  const dateStr = toYMD(currentDate);
  const dayEvts = events.filter(e => e.date === dateStr).sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'));
  const hours = Array.from({ length: 14 }, (_, i) => i + 7);

  return (
    <div style={{ background: '#fcfcfc', border: '1px solid #ececec', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{fmtDayFull(dateStr)}</div>
        <button onClick={() => onAddTask(dateStr)} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 99 }}>+ Add</button>
      </div>
      <div style={{ overflowY: 'auto', maxHeight: '60vh' }}>
        {/* All-day events */}
        {dayEvts.filter(e => !e.time).length > 0 && (
          <div style={{ padding: '8px 12px', background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>All day</div>
            {dayEvts.filter(e => !e.time).map((ev, i) => {
              const cfg = EVENT_TYPES[ev.type] || EVENT_TYPES.todo;
              return <div key={i} style={{ fontSize: 11.5, padding: '2px 7px', borderRadius: 4, background: cfg.bg, color: cfg.colour, marginBottom: 2 }}>{ev.label}</div>;
            })}
          </div>
        )}
        {hours.map(hour => {
          const slotEvts = dayEvts.filter(e => e.time && parseInt(e.time.split(':')[0]) === hour);
          return (
            <div key={hour} style={{ display: 'flex', minHeight: 44, borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: 54, padding: '6px 8px', fontSize: 11, color: 'var(--text3)', flexShrink: 0, borderRight: '1px solid var(--border)' }}>
                {fmtTime(`${String(hour).padStart(2, '0')}:00`)}
              </div>
              <div style={{ flex: 1, padding: '4px 8px' }}>
                {slotEvts.map((ev, i) => {
                  const cfg = EVENT_TYPES[ev.type] || EVENT_TYPES.todo;
                  return <div key={i} style={{ fontSize: 12, padding: '2px 7px', borderRadius: 4, background: cfg.bg, color: cfg.colour, marginBottom: 2 }}>{ev.label}</div>;
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Calendar ─────────────────────────────────────────────────────────────
export default function Calendar({ onOpenProject }) {
  const { state } = useApp();
  const { projects = [] } = state;

  const [view, setView]               = useState('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [taskEvents, setTaskEvents]   = useState([]);
  const [showAddTask, setShowAddTask] = useState(false);
  const [addTaskDate, setAddTaskDate] = useState(todayYMD());

  // Build project deadline events
  const projectEvents = [];
  projects.forEach(p => {
    (p.aos || []).forEach(ao => {
      const cd = ao.consent_deadline  || ao.consentDeadline  || '';
      const sd = ao.s10_deadline      || ao.s10Deadline      || '';
      const ns = ao.notice_served_date || ao.noticeServedDate || '';
      const name = ao.name || `AO${ao.num || ''}`;
      const addr = ao.premise || ao.address || p.address || '';
      if (cd) projectEvents.push({ date: cd, label: `Consent deadline — ${p.ref} ${name} — ${addr}`, type: 'consent_deadline', projectId: p.id, projectRef: p.ref });
      if (sd) projectEvents.push({ date: sd, label: `S.10 deadline — ${p.ref} ${name}`, type: 's10_deadline', projectId: p.id, projectRef: p.ref });
      if (ns) projectEvents.push({ date: ns, label: `Notice served — ${p.ref} ${name} — ${addr}`, type: 'notice_served', projectId: p.id, projectRef: p.ref });
    });
  });

  const loadTasks = useCallback(async () => {
    if (!sb) return;
    try {
      const { data } = await sb.from('tasks').select('*').neq('status', 'complete');
      setTaskEvents((data || []).filter(t => t.due_date).map(t => ({
        id: t.id, date: t.due_date, time: t.time || '',
        label: t.title || 'Task', type: t.task_type || 'todo',
        projectId: t.project_id, projectRef: t.project_address_snapshot || '',
        notes: t.description || '',
      })));
    } catch (err) { console.error('loadTasks', err); }
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const allEvents = [...projectEvents, ...taskEvents];

  const navigate = (dir) => {
    const d = new Date(currentDate);
    if (view === 'month') d.setMonth(d.getMonth() + dir);
    if (view === 'week')  d.setDate(d.getDate() + dir * 7);
    if (view === 'day')   d.setDate(d.getDate() + dir);
    setCurrentDate(d);
  };

  const headerLabel = view === 'month'
    ? `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    : view === 'week' ? (() => {
        const m = new Date(currentDate);
        const day = m.getDay();
        m.setDate(m.getDate() - (day === 0 ? 6 : day - 1));
        const e = new Date(m); e.setDate(m.getDate() + 6);
        return `${m.getDate()} ${MONTH_NAMES[m.getMonth()]} — ${e.getDate()} ${MONTH_NAMES[e.getMonth()]} ${e.getFullYear()}`;
      })()
    : fmtDayFull(toYMD(currentDate));

  const handleDayClick = (dateStr) => {
    setSelectedDate(dateStr);
    if (view !== 'month') setCurrentDate(new Date(dateStr + 'T00:00:00'));
  };

  const handleOpenProj = (projectId) => {
    const proj = projects.find(p => p.id === projectId);
    if (proj) onOpenProject?.(proj);
  };

  // ── Month grid ──────────────────────────────────────────────────────────────
  const renderMonth = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Build 6-row × 7-col grid
    const cells = [];
    for (let i = 0; i < firstDay; i++) {
      const d = new Date(year, month, -(firstDay - i - 1));
      cells.push({ date: toYMD(d), day: d.getDate(), faded: true });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, day: d, faded: false });
    }
    while (cells.length < 42) {
      const d = new Date(year, month + 1, cells.length - daysInMonth - firstDay + 1);
      cells.push({ date: toYMD(d), day: d.getDate(), faded: true });
    }

    return (
      <div>
        {/* Day name headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
          {DAY_NAMES.map(n => (
            <div key={n} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text3)', padding: '6px 0', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{n}</div>
          ))}
        </div>
        {/* Equal-height cell grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {cells.map(({ date, day, faded }) => {
            const isToday    = date === todayYMD();
            const isSelected = date === selectedDate;
            const dayEvts    = allEvents.filter(e => e.date === date);

            return (
              <div key={date} onClick={() => handleDayClick(date)} style={{
                height: 120, /* FIXED equal height — matches old layout */
                background: '#fafafa',
                border: `1px solid ${isToday ? 'var(--blue)' : isSelected ? '#d9d9d9' : '#ececec'}`,
                borderRadius: 10, padding: '6px 7px',
                cursor: 'pointer', overflow: 'hidden',
                opacity: faded ? 0.35 : 1,
              }}>
                {/* Day number */}
                <div style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 22, height: 22, borderRadius: '50%', marginBottom: 4,
                  background: isToday ? 'var(--blue)' : 'transparent',
                  fontSize: 12, fontWeight: isToday ? 700 : 400,
                  color: isToday ? '#fff' : 'var(--text)',
                }}>{day}</div>

                {/* Events — max 3 visible */}
                {dayEvts.slice(0, 3).map((ev, i) => {
                  const cfg = EVENT_TYPES[ev.type] || EVENT_TYPES.todo;
                  return (
                    <div key={i} style={{
                      fontSize: 10.5, padding: '1px 5px', borderRadius: 4, marginBottom: 2,
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
      {showAddTask && (
        <AddTaskModal
          defaultDate={addTaskDate}
          projects={projects}
          onSave={() => { setShowAddTask(false); loadTasks(); }}
          onClose={() => setShowAddTask(false)}
        />
      )}

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => navigate(-1)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', color: 'var(--text)', fontSize: 15 }}>←</button>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', minWidth: 200 }}>{headerLabel}</div>
          <button onClick={() => navigate(1)}  style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', color: 'var(--text)', fontSize: 15 }}>→</button>
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
          <button onClick={() => { setAddTaskDate(selectedDate || todayYMD()); setShowAddTask(true); }}
            className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 99 }}>+ Add</button>
        </div>
      </div>

      {/* Legend */}
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

      {/* Calendar body */}
      {view === 'month' && renderMonth()}
      {view === 'week'  && <WeekView currentDate={currentDate} events={allEvents} onDayClick={handleDayClick} selectedDate={selectedDate} />}
      {view === 'day'   && <DayView  currentDate={currentDate} events={allEvents} onAddTask={(d) => { setAddTaskDate(d); setShowAddTask(true); }} />}

      {/* Day detail — shown in month + week views when a date is selected */}
      {selectedDate && view !== 'day' && (
        <DayDetail
          dateStr={selectedDate}
          events={allEvents}
          onAddTask={(d) => { setAddTaskDate(d); setShowAddTask(true); }}
          onOpenProject={handleOpenProj}
        />
      )}
    </div>
  );
}
