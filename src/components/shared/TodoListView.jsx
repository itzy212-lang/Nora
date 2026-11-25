// src/components/shared/TodoListView.jsx
// Added 2026-09-13, on request, after extensive design discussion: a
// permanent to-do list living inside the existing notepad overlay
// (top-right pencil icon). Deliberately NOT a separate data store —
// this is a filtered view over the same tasks table the calendar
// already uses. A "task" (call, email, correspondence) shows here; a
// "task" of type soc/meeting/site_visit/appointment is calendar-only
// and never appears in this list — that distinction lives entirely
// in task_type, decided and confirmed directly with the user.
import { useState, useEffect, useCallback } from 'react';
import sb from '../../supabaseClient';

// Fixed 2026-09-17, real, confirmed gap found live: TaskEditModal.jsx
// (the per-project task editor) offers a richer set of task types
// than this list ever accounted for — including 'todo' ("General
// task", its own default selection), 'surveyor_response', and
// 'award_draft' — genuine go-do-this items, not calendar events
// (meeting/site_visit/soc) or auto-tracked deadlines
// (notice_consent_deadline/notice_section10_deadline/email_action,
// correctly still excluded, all shown elsewhere as AO card badges).
// These three were simply never added here, so anything created as
// one — including every task left at this modal's own default —
// was invisible in the one place meant to show it. A backfill also
// found 24 real tasks from a May bulk import with no task_type set
// at all, predating this whole categorisation scheme entirely.
const TODO_TYPES = ['call', 'email', 'correspondence', 'todo', 'surveyor_response', 'award_draft'];

// Fixed 2026-09-13, on request: colour is about who/what created the
// task, not the task type itself — an assistant-generated email
// follow-up (green) needs to look different from one the user
// created themselves (blue/purple) or a deadline-triggered one (red),
// even though all three might be the same task_type.
function colourFor(task) {
  if (task.source === 'assistant') return '#16a34a'; // green — AI-generated, needs a different kind of review
  if (task.source === 'deadline') return '#dc2626';  // red — a notice/S10 deadline triggered this
  if (task.task_type === 'call') return '#7c3aed';   // purple — phone call
  return '#2563eb'; // blue — a normal, manually-created task
}

function fmtDayHeading(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d - today) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function TodoListView({ onBack, onCloseAll, onOpenEmail, onOpenProject }) {
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [userId, setUserId] = useState(null);

  const load = useCallback(async () => {
    if (!sb) return;
    setLoading(true);
    try {
      // Fixed 2026-09-17, real, confirmed cross-user leak reported
      // live: this list — deliberately shared, per its own comment at
      // the top of this file, "a filtered view over the same tasks
      // table the calendar already uses" — was showing every user's
      // manually-created tasks mixed together. The screen itself is
      // meant to stay universal (anyone can open it); the individual
      // items inside it were never meant to be. tasks.user_id already
      // exists, was just never read from here.
      const { data: { user } } = await sb.auth.getUser();
      const uid = user?.id || null;
      setUserId(uid);
      if (!uid) {
        console.warn('[TodoListView] Could not determine current user — showing nothing rather than someone else\'s tasks.');
        setTasks([]);
        return;
      }
      const todayStr = new Date().toISOString().slice(0, 10);
      // Fixed 2026-09-13, on request: "today" means every incomplete
      // task due today or earlier (so nothing overdue silently
      // disappears — this is the rollover, achieved by query alone,
      // not by physically moving data around), plus anything completed
      // today (so a struck-through item stays visible until the day
      // actually ends, then quietly stops matching this query
      // tomorrow — no separate cleanup job needed for that either).
      // Fixed 2026-09-13, real, confirmed bug reported live: the
      // notepad became entirely unresponsive after opening the to-do
      // list — nothing else in the app worked either, not even the
      // sidebar menu, well beyond just this overlay failing to close.
      // The .or() filter combined with .in() here is exactly the kind
      // of supabase-js pattern already flagged as unreliable earlier
      // today (chained/complex .or() calls) — moved this filtering
      // entirely client-side instead of relying on that query syntax.
      // Wrapped the whole thing in try/catch too — any unexpected
      // error here must never be able to leave the overlay stuck.
      const { data, error } = await sb
        .from('tasks')
        .select('id, title, description, task_type, source, due_date, status, completed_at, project_id, linked_email_message_id')
        .eq('user_id', uid)
        .in('task_type', TODO_TYPES)
        .order('due_date', { ascending: true })
        .limit(300);

      if (error) throw error;

      const rows = (data || []).filter(t => {
        if ((t.status || '').toLowerCase() !== 'complete') return true;
        // Only keep a completed task if it was completed today —
        // otherwise it should have already fallen away.
        return t.completed_at && t.completed_at.slice(0, 10) === todayStr;
      });
      setTasks(rows);

      const projectIds = [...new Set(rows.map(t => t.project_id).filter(Boolean))];
      if (projectIds.length) {
        const { data: projRows } = await sb.from('projects').select('id, ref, bo_premise_address').in('id', projectIds);
        const map = {};
        (projRows || []).forEach(p => { map[p.id] = p; });
        setProjects(map);
      }
    } catch (err) {
      console.warn('[TodoListView] load failed:', err?.message);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleComplete = async (task) => {
    const nowComplete = (task.status || '').toLowerCase() !== 'complete';
    const updates = nowComplete
      ? { status: 'complete', completed_at: new Date().toISOString() }
      : { status: 'open', completed_at: null };
    await sb.from('tasks').update(updates).eq('id', task.id).eq('user_id', userId);
    window.dispatchEvent(new Event('nora:task-added')); // same signal Calendar listens for — completing a task should remove it from Calendar's view too
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...updates } : t));
  };

  const openTask = (task) => {
    if (task.linked_email_message_id && onOpenEmail) {
      onOpenEmail(task.linked_email_message_id);
    } else if (task.project_id && onOpenProject) {
      onOpenProject(task.project_id);
    }
  };

  // Group by due_date. Overdue + today collapse into a single
  // "Today" heading (the rollover); future dates group sparsely —
  // only dates that genuinely have a task get a heading at all.
  const todayStr = new Date().toISOString().slice(0, 10);
  const groups = {};
  tasks.forEach(t => {
    const key = (t.due_date && t.due_date <= todayStr) ? todayStr : (t.due_date || todayStr);
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });
  const sortedKeys = Object.keys(groups).sort();

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 8, borderBottom: '1px solid #e5e7eb' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6b7280', padding: 0, lineHeight: 1 }}>←</button>
        <div style={{ flex: 1, fontSize: 15, fontWeight: 700, color: '#111827' }}>✅ To-do list</div>
        <button onClick={() => setShowAdd(true)} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          + Add task
        </button>
        {/* Fixed 2026-09-13, on request: this view previously had no
            direct way to close the whole overlay — only "back" to the
            notes list. Added a genuine close button here too. */}
        <button onClick={onCloseAll} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6b7280', padding: '0 2px', lineHeight: 1 }}>×</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 16px' }}>
        {loading ? (
          <div style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: 40 }}>Loading…</div>
        ) : sortedKeys.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 14, color: '#6b7280' }}>Nothing on your list right now.</div>
          </div>
        ) : (
          sortedKeys.map(dateKey => (
            <div key={dateKey} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                {fmtDayHeading(dateKey)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {groups[dateKey].map(task => {
                  const complete = (task.status || '').toLowerCase() === 'complete';
                  const proj = task.project_id ? projects[task.project_id] : null;
                  const isCarried = task.due_date && task.due_date < todayStr && !complete;
                  return (
                    <div
                      key={task.id}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
                        padding: '10px 12px', opacity: complete ? 0.65 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={complete}
                        onChange={() => toggleComplete(task)}
                        style={{ marginTop: 2, width: 17, height: 17, flexShrink: 0, cursor: 'pointer' }}
                      />
                      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => openTask(task)}>
                        <div style={{
                          fontSize: 13.5, color: colourFor(task), fontWeight: 500,
                          textDecoration: complete ? 'line-through' : 'none',
                          // Fixed 2026-09-17, on request: strikethrough line
                          // itself should always be red, regardless of the
                          // task's own text colour (which stays whatever
                          // colourFor gives it) — same thickness/style,
                          // just the line colour overridden separately from
                          // the text colour it'd otherwise inherit.
                          textDecorationColor: complete ? '#dc2626' : undefined,
                        }}>
                          {task.title}
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                          {proj && (
                            <span style={{ fontSize: 10.5, color: '#6b7280' }}>{proj.ref || proj.bo_premise_address}</span>
                          )}
                          {isCarried && (
                            <span style={{ fontSize: 10, color: '#b45309', background: '#fef3c7', padding: '1px 6px', borderRadius: 99 }}>Carried over</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {showAdd && (
        <AddTaskInline
          userId={userId}
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); load(); }}
        />
      )}
    </div>
  );
}

// Fixed 2026-09-13: a simple, project-agnostic add form, since the
// existing TaskEditModal lives inside ProjectDetail.jsx and always
// requires a specific project already in context — this view is
// global, across every project, so a task here may or may not have
// one at all.
function AddTaskInline({ userId, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [taskType, setTaskType] = useState('call');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [projectQuery, setProjectQuery] = useState('');
  const [projectResults, setProjectResults] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sb || projectQuery.trim().length < 2) { setProjectResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await sb
        .from('projects')
        .select('id, ref, bo_premise_address')
        .ilike('bo_premise_address', `%${projectQuery}%`)
        .limit(6);
      setProjectResults(data || []);
    }, 250);
    return () => clearTimeout(t);
  }, [projectQuery]);

  const handleSave = async () => {
    if (!title.trim()) return;
    if (!userId) {
      console.warn('[AddTaskInline] Could not determine current user — not saving.');
      return;
    }
    setSaving(true);
    try {
      await sb.from('tasks').insert([{
        title: title.trim(),
        task_type: taskType,
        source: 'manual',
        due_date: dueDate,
        status: 'open',
        project_id: selectedProject?.id || null,
        user_id: userId,
      }]);
      // Fixed 2026-09-17, same real gap found and fixed in
      // ProjectDetail.jsx: nothing told Calendar a task had been
      // created here either.
      window.dispatchEvent(new Event('nora:task-added'));
      onCreated();
    } catch (err) {
      console.warn('[AddTaskInline] save failed:', err.message);
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 10500, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 420, padding: 18 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Add task</div>

        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="What needs doing?"
          style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13.5, marginBottom: 10, boxSizing: 'border-box' }}
        />

        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <select value={taskType} onChange={e => setTaskType(e.target.value)} style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }}>
            <option value="call">Call</option>
            <option value="email">Email</option>
            <option value="correspondence">Correspondence</option>
          </select>
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }}
          />
        </div>

        <div style={{ position: 'relative', marginBottom: 14 }}>
          <input
            value={selectedProject ? (selectedProject.ref || selectedProject.bo_premise_address) : projectQuery}
            onChange={e => { setSelectedProject(null); setProjectQuery(e.target.value); }}
            placeholder="Link to a project (optional)"
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box' }}
          />
          {projectResults.length > 0 && !selectedProject && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, marginTop: 4, maxHeight: 160, overflowY: 'auto', zIndex: 10 }}>
              {projectResults.map(p => (
                <div
                  key={p.id}
                  onClick={() => { setSelectedProject(p); setProjectResults([]); }}
                  style={{ padding: '8px 12px', fontSize: 12.5, cursor: 'pointer', borderBottom: '1px solid #f3f4f6' }}
                >
                  {p.ref} — {p.bo_premise_address}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: 'transparent', fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !title.trim()} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#3b82f6', color: '#fff', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving || !title.trim() ? 0.6 : 1 }}>
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
