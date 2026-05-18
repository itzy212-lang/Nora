import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../state/appStore';
import sb from '../../supabaseClient';

// ── Event types & colours ─────────────────────────────────────────────────────
const EVENT_TYPES = {
  consent_deadline:   { label: 'Consent deadline',   colour: '#ef4444', bg: '#fee2e2' },
  s10_deadline:       { label: 'S.10 deadline',       colour: '#ef4444', bg: '#fee2e2' },
  notice_served:      { label: 'Notice served',       colour: '#22c55e', bg: '#dcfce7' },
  soc:                { label: 'SOC Appointment',     colour: '#8b5cf6', bg: '#ede9fe' },
  award_draft:        { label: 'Award draft due',     colour: '#f59e0b', bg: '#fef3c7' },
  surveyor_response:  { label: 'Surveyor response',   colour: '#f97316', bg: '#ffedd5' },
  meeting:            { label: 'Meeting',             colour: '#3b82f6', bg: '#dbeafe' },
  call:               { label: 'Call',                colour: '#06b6d4', bg: '#cffafe' },
  site_visit:         { label: 'Site visit',          colour: '#10b981', bg: '#d1fae5' },
  todo:               { label: 'To-do',               colour: '#6b7280', bg: '#f3f4f6' },
};

const DAY_NAMES   = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function toYMD(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function todayYMD() { return toYMD(new Date()); }
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour < 12 ? 'am' : 'pm'}`;
}
function fmtDayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Add Task Modal ─────────────────────────────────────────────────────────────
function AddTaskModal({ defaultDate, projects, onSave, onClose }) {
  const [form, setForm] = useState({
    title: '', date: defaultDate || todayYMD(), time: '',
    type: 'todo', project_id: '', notes: '',
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.title.trim()) return;
    try {
      const { data: { user } } = await sb.auth.getUser();
      await sb.from('tasks').insert({
        title: form.title, due_date: form.date,
        status: 'pending', task_type: form.type,
        description: form.notes,
        project_id: form.project_id || null,
        user_id: user?.id,
        project_address_snapshot: projects.find(p => p.id === form.project_id)?.address || '',
      });
      onSave();
    } catch (err) { alert('Could not save task: ' + err.message); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 440, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Add task / appointment</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { label: 'Title', el: <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Site visit — 42 High Street" style={inputStyle} /> },
            { label: 'Type', el: (
              <select value={form.type} onChange={e => set('type', e.target.value)} style={inputStyle}>
                {Object.entries(EVENT_TYPES).filter(([k]) => !['consent_deadline','s10_deadline','notice_served','award_draft','surveyor_response'].includes(k))
                  .map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            )},
            { label: 'Date', el: <input type="date" value={form.date} onChange={e => set('date', e.target.value)} style={inputStyle} /> },
            { label: 'Time', el: <input type="time" value={form.time} onChange={e => set('time', e.target.value)} style={inputStyle} /> },
            { label: 'Project (optional)', el: (
              <select value={form.project_id} onChange={e => set('project_id', e.target.value)} style={inputStyle}>
                <option value="">— no project —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.ref} — {p.address}</option>)}
              </select>
            )},
            { label: 'Notes', el: <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="Optional notes…" style={{ ...inputStyle, resize: 'none' }} /> },
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

const inputStyle = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  background: 'var(--bg3)', border: '1px solid var(--border)',
  borderRadius: 8, color: 'var(--text)', outline: 'none',
};

// ── Event pill ─────────────────────────────────────────────────────────────────
function EventPill({ event, onClick }) {
  const cfg = EVENT_TYPES[event.type] || EVENT_TYPES.todo;
  return (
    <div onClick={e => { e.stopPropagation(); onClick(event); }}
      style={{
        padding: '1px 6px', borderRadius: 4, fontSize: 10.5, fontWeight: 500,
        background: cfg.bg, color: cfg.colour, cursor: 'pointer',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        marginBottom: 2, lineHeight: 1.5,
        border: `1px solid ${cfg.colour}33`,
      }}>
      {event.time ? fmtTime(event.time) + ' ' : ''}{event.label}
    </div>
  );
}

// ── Day detail (below calendar) ────────────────────────────────────────────────
function DayDetail({ dateStr, events, onAddTask, onOpenProject }) {
  const dayEvents = events.filter(e => e.date === dateStr).sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'));
  const cfg_map = EVENT_TYPES;

  return (
    <div style={{ marginTop: 16, padding: '16px 20px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{fmtDayLabel(dateStr)}</div>
        <button onClick={() => onAddTask(dateStr)} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 99 }}>+ Add</button>
      </div>
      {dayEvents.length === 0
        ? <div style={{ fontSize: 13, color: 'var(--text3)', fontStyle: 'italic' }}>Nothing scheduled. Click + Add to create a task or appointment.</div>
        : dayEvents.map((ev, i) => {
          const cfg = cfg_map[ev.type] || cfg_map.todo;
          return (
            <div key={i}
              onClick={() => ev.projectId && onOpenProject(ev.projectId)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px',
                borderRadius: 10, marginBottom: 8, cursor: ev.projectId ? 'pointer' : 'default',
                background: 'var(--bg3)', border: `1px solid ${cfg.colour}44`,
                borderLeft: `3px solid ${cfg.colour}`,
              }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>
                  {ev.time && <span style={{ color: cfg.colour, marginRight: 8, fontSize: 12, fontWeight: 600 }}>{fmtTime(ev.time)}</span>}
                  {ev.label}
                </div>
                {ev.projectRef && <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{ev.projectRef}</div>}
                {ev.notes && <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>{ev.notes}</div>}
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 99, background: cfg.bg, color: cfg.colour, flexShrink: 0 }}>
                {cfg.label}
              </span>
              {ev.projectId && <span style={{ fontSize: 11, color: 'var(--blue)', flexShrink: 0 }}>open →</span>}
            </div>
          );
        })
      }
    </div>
  );
}

// ── Week view ──────────────────────────────────────────────────────────────────
function WeekView({ currentDate, events, onDayClick, onEventClick }) {
  // Get Monday of current week
  const monday = new Date(currentDate);
  const day = monday.getDay();
  monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1));

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    return d;
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
      {days.map(d => {
        const dateStr = toYMD(d);
        const isToday = dateStr === todayYMD();
        const dayEvts = events.filter(e => e.date === dateStr).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        return (
          <div key={dateStr} onClick={() => onDayClick(dateStr)}
            style={{ background: 'var(--bg2)', border: `1px solid ${isToday ? 'var(--blue)' : 'var(--border)'}`, borderRadius: 12, padding: 10, minHeight: 120, cursor: 'pointer' }}>
            <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--blue)' : 'var(--text3)', marginBottom: 8 }}>
              {DAY_NAMES[(d.getDay() + 6) % 7]} {d.getDate()}
            </div>
            {dayEvts.slice(0, 4).map((ev, i) => <EventPill key={i} event={ev} onClick={onEventClick} />)}
            {dayEvts.length > 4 && <div style={{ fontSize: 10, color: 'var(--text3)' }}>+{dayEvts.length - 4} more</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── Day view ──────────────────────────────────────────────────────────────────
function DayView({ currentDate, events, onEventClick, onAddTask }) {
  const dateStr = toYMD(currentDate);
  const dayEvts = events.filter(e => e.date === dateStr).sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'));
  const hours = Array.from({ length: 14 }, (_, i) => i + 7); // 7am - 8pm

  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{fmtDayLabel(dateStr)}</div>
        <button onClick={() => onAddTask(dateStr)} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 99 }}>+ Add</button>
      </div>
      <div style={{ overflowY: 'auto', maxHeight: '60vh' }}>
        {hours.map(hour => {
          const timeStr = `${String(hour).padStart(2, '0')}:00`;
          const slotEvts = dayEvts.filter(e => (e.time || '').startsWith(String(hour).padStart(2, '0')));
          return (
            <div key={hour} style={{ display: 'flex', minHeight: 48, borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: 52, padding: '4px 8px', fontSize: 11, color: 'var(--text3)', flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', paddingTop: 6 }}>
                {fmtTime(timeStr)}
              </div>
              <div style={{ flex: 1, padding: '4px 8px' }}>
                {slotEvts.map((ev, i) => <EventPill key={i} event={ev} onClick={onEventClick} />)}
              </div>
            </div>
          );
        })}
        {/* All-day / no-time events */}
        {dayEvts.filter(e => !e.time).length > 0 && (
          <div style={{ padding: '8px 12px', background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10.5, color: 'var(--text3)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>All day</div>
            {dayEvts.filter(e => !e.time).map((ev, i) => <EventPill key={i} event={ev} onClick={onEventClick} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Calendar ──────────────────────────────────────────────────────────────
export default function Calendar({ onOpenProject }) {
  const { state } = useApp();
  const { projects = [] } = state;

  const [view, setView]               = useState('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [allEvents, setAllEvents]     = useState([]);
  const [tasks, setTasks]             = useState([]);
  const [showAddTask, setShowAddTask] = useState(false);
  const [addTaskDate, setAddTaskDate] = useState(todayYMD());

  // ── Build events from projects ─────────────────────────────────────────────
  const buildProjectEvents = useCallback(() => {
    const evts = [];
    projects.forEach(p => {
      (p.aos || []).forEach(ao => {
        const cd = ao.consent_deadline || ao.consentDeadline || '';
        const sd = ao.s10_deadline     || ao.s10Deadline     || '';
        const ns = ao.notice_served_date || ao.noticeServedDate || '';
        const aoLabel = `${ao.name || `AO${ao.num}`} — ${ao.premise || ao.address || p.address}`;
        if (cd) evts.push({ date: cd, label: `Consent deadline — ${p.ref} ${ao.num ? `AO${ao.num}` : ''} — ${ao.premise || p.address}`, type: 'consent_deadline', projectId: p.id, projectRef: p.ref });
        if (sd) evts.push({ date: sd, label: `S.10 deadline — ${p.ref} ${aoLabel}`, type: 's10_deadline', projectId: p.id, projectRef: p.ref });
        if (ns) evts.push({ date: ns, label: `Notice served — ${p.ref} ${aoLabel}`, type: 'notice_served', projectId: p.id, projectRef: p.ref });
      });
    });
    return evts;
  }, [projects]);

  // ── Load tasks from Supabase ───────────────────────────────────────────────
  const loadTasks = useCallback(async () => {
    if (!sb) return;
    try {
      const { data } = await sb.from('tasks').select('*').neq('status', 'complete');
      const taskEvts = (data || []).map(t => ({
        id: t.id, date: t.due_date || '', time: t.time || '',
        label: t.title || 'Task',
        type: t.task_type || 'todo',
        projectId: t.project_id || null,
        projectRef: t.project_address_snapshot || '',
        notes: t.description || '',
        source: 'task',
      })).filter(e => e.date);
      setTasks(taskEvts);
    } catch (err) { console.error('loadTasks:', err); }
  }, []);

  // ── Load SOC appointments ──────────────────────────────────────────────────
  const loadSOC = useCallback(async () => {
    if (!sb) return;
    try {
      const { data } = await sb.from('soc_reports').select('id, project_id, inspection_date, address, ao_address');
      const socEvts = (data || []).filter(s => s.inspection_date).map(s => {
        const proj = projects.find(p => p.id === s.project_id);
        return {
          date: s.inspection_date, time: '',
          label: `SOC — ${proj?.ref || s.project_id} — ${s.ao_address || s.address || ''}`,
          type: 'soc', projectId: s.project_id, projectRef: proj?.ref || '',
        };
      });
      return socEvts;
    } catch { return []; }
  }, [projects]);

  useEffect(() => {
    const load = async () => {
      const projEvts = buildProjectEvents();
      await loadTasks();
      const socEvts = await loadSOC() || [];
      setAllEvents([...projEvts, ...socEvts]);
    };
    load();
  }, [buildProjectEvents, loadTasks, loadSOC]);

  // Combine all events
  const events = [...allEvents, ...tasks];

  // ── Navigation ─────────────────────────────────────────────────────────────
  const navigate = (dir) => {
    const d = new Date(currentDate);
    if (view === 'month')  { d.setMonth(d.getMonth() + dir); }
    if (view === 'week')   { d.setDate(d.getDate() + dir * 7); }
    if (view === 'day')    { d.setDate(d.getDate() + dir); }
    setCurrentDate(d);
  };

  const label = view === 'month'
    ? `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    : view === 'week'
    ? (() => { const m = new Date(currentDate); const day = m.getDay(); m.setDate(m.getDate()-(day===0?6:day-1)); const e=new Date(m); e.setDate(m.getDate()+6); return `${m.getDate()} ${MONTH_NAMES[m.getMonth()]} — ${e.getDate()} ${MONTH_NAMES[e.getMonth()]} ${e.getFullYear()}`; })()
    : fmtDayLabel(toYMD(currentDate));

  const handleDayClick = (dateStr) => {
    setSelectedDate(dateStr);
    if (view !== 'month') setCurrentDate(new Date(dateStr + 'T00:00:00'));
  };

  const handleEventClick = (ev) => {
    if (ev.projectId) onOpenProject?.(ev.projectId);
  };

  const handleAddTask = (dateStr) => {
    setAddTaskDate(dateStr);
    setShowAddTask(true);
  };

  // ── Month grid ─────────────────────────────────────────────────────────────
  const renderMonthGrid = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);
    const startOffset = (firstDay.getDay() + 6) % 7; // Mon=0

    const cells = [];
    // Leading empty cells
    for (let i = 0; i < startOffset; i++) {
      const d = new Date(year, month, -startOffset + i + 1);
      cells.push({ date: toYMD(d), day: d.getDate(), faded: true });
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
      cells.push({ date: `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, day: d, faded: false });
    }
    // Trailing
    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const dt = new Date(year, month + 1, d);
      cells.push({ date: toYMD(dt), day: d, faded: true });
    }

    return (
      <div>
        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
          {DAY_NAMES.map(n => (
            <div key={n} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text3)', padding: '4px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{n}</div>
          ))}
        </div>
        {/* Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
          {cells.map(({ date, day, faded }) => {
            const isToday    = date === todayYMD();
            const isSelected = date === selectedDate;
            const dayEvts    = events.filter(e => e.date === date);

            return (
              <div key={date}
                onClick={() => handleDayClick(date)}
                style={{
                  background: isSelected ? 'var(--blue-bg)' : 'var(--bg2)',
                  border: `1px solid ${isToday ? 'var(--blue)' : isSelected ? 'var(--blue)' : 'var(--border)'}`,
                  borderRadius: 10, padding: '6px 7px', minHeight: 80, cursor: 'pointer',
                  opacity: faded ? 0.4 : 1,
                  transition: 'border-color 0.1s',
                }}
                onMouseEnter={e => !isSelected && !isToday && (e.currentTarget.style.borderColor = 'var(--border2)')}
                onMouseLeave={e => !isSelected && !isToday && (e.currentTarget.style.borderColor = 'var(--border)')}
              >
                <div style={{
                  fontSize: 12, fontWeight: isToday ? 700 : 400,
                  color: isToday ? '#fff' : 'var(--text)',
                  background: isToday ? 'var(--blue)' : 'transparent',
                  width: isToday ? 22 : 'auto', height: isToday ? 22 : 'auto',
                  borderRadius: isToday ? '50%' : 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 4,
                }}>{day}</div>
                {dayEvts.slice(0, 3).map((ev, i) => <EventPill key={i} event={ev} onClick={handleEventClick} />)}
                {dayEvts.length > 3 && <div style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 1 }}>+{dayEvts.length - 3} more</div>}
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

      {/* Header controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => navigate(-1)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', color: 'var(--text)', fontSize: 16 }}>‹</button>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', minWidth: 220 }}>{label}</div>
          <button onClick={() => navigate(1)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', color: 'var(--text)', fontSize: 16 }}>›</button>
          <button onClick={() => { setCurrentDate(new Date()); setSelectedDate(todayYMD()); }}
            style={{ padding: '4px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'none', color: 'var(--text2)', fontSize: 12.5, cursor: 'pointer' }}>Today</button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* View toggle */}
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {['month','week','day'].map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '5px 14px', border: 'none', cursor: 'pointer', fontSize: 12.5,
                background: view === v ? 'var(--blue)' : 'var(--bg2)',
                color: view === v ? '#fff' : 'var(--text2)', fontWeight: view === v ? 600 : 400,
                borderRight: v !== 'day' ? '1px solid var(--border)' : 'none',
              }}>{v.charAt(0).toUpperCase() + v.slice(1)}</button>
            ))}
          </div>
          <button onClick={() => handleAddTask(selectedDate || todayYMD())} className="btn btn-primary btn-sm" style={{ cursor: 'pointer', borderRadius: 99 }}>+ Add</button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        {[['consent_deadline','Consent deadline'],['soc','SOC'],['meeting','Meeting/Call'],['todo','Task'],['notice_served','Notice served']].map(([k, label]) => {
          const cfg = EVENT_TYPES[k];
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text3)' }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: cfg.colour }} />
              {label}
            </div>
          );
        })}
      </div>

      {/* Calendar body */}
      {view === 'month' && renderMonthGrid()}
      {view === 'week' && <WeekView currentDate={currentDate} events={events} onDayClick={handleDayClick} onEventClick={handleEventClick} />}
      {view === 'day'  && <DayView  currentDate={currentDate} events={events} onEventClick={handleEventClick} onAddTask={handleAddTask} />}

      {/* Day detail (month + week views) */}
      {selectedDate && view !== 'day' && (
        <DayDetail
          dateStr={selectedDate}
          events={events}
          onAddTask={handleAddTask}
          onOpenProject={(id) => {
            const proj = projects.find(p => p.id === id);
            if (proj) onOpenProject?.(proj);
          }}
        />
      )}
    </div>
  );
}
