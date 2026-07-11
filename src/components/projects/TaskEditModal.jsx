import { useState } from 'react';
import sb from '../../supabaseClient';

const TASK_TYPES = [
  { value: 'todo', label: 'General task' },
  { value: 'notice_consent_deadline', label: 'Consent deadline' },
  { value: 'notice_section10_deadline', label: 'Section 10 deadline' },
  { value: 'email_action', label: 'Email action' },
  { value: 'surveyor_response', label: 'Surveyor response' },
  { value: 'award_draft', label: 'Award draft' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'call', label: 'Call' },
  { value: 'site_visit', label: 'Site visit' },
];

export default function TaskEditModal({ task, projectId, onClose, onSaved, onDeleted }) {
  const isNew = !task;
  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    due_date: task?.due_date || '',
    priority: task?.priority || 'normal',
    task_type: task?.task_type || 'todo',
    status: task?.status || 'open',
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.title.trim()) { setError('Title is required'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        due_date: form.due_date || null,
        priority: form.priority,
        task_type: form.task_type,
        status: form.status,
        project_id: projectId,
      };
      if (isNew) {
        const { data, error: err } = await sb.from('tasks').insert([payload]).select('*').single();
        if (err) throw err;
        onSaved(data);
      } else {
        const { data, error: err } = await sb.from('tasks').update(payload).eq('id', task.id).select('*').single();
        if (err) throw err;
        onSaved(data);
      }
    } catch (e) {
      setError(e.message || 'Could not save task');
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this task?')) return;
    setDeleting(true);
    await sb.from('tasks').delete().eq('id', task.id);
    onDeleted(task.id);
  };

  const handleClose = async () => {
    // Mark as complete if status toggled
    onClose();
  };

  const overlay = {
    position: 'fixed', inset: 0, zIndex: 900,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  };

  const sheet = {
    background: 'var(--bg)',
    borderRadius: '20px 20px 0 0',
    padding: '24px 20px 40px',
    width: '100%',
    maxWidth: 480,
    maxHeight: '90vh',
    overflowY: 'auto',
  };

  const label = { fontSize: 11.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5, display: 'block' };
  const input = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' };
  const field = { marginBottom: 16 };

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={sheet}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            {isNew ? 'New task' : 'Edit task'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text3)' }}>×</button>
        </div>

        {/* Title */}
        <div style={field}>
          <label style={label}>Title</label>
          <input
            style={input}
            value={form.title}
            onChange={e => set('title', e.target.value)}
            placeholder="Task title"
            autoFocus
          />
        </div>

        {/* Description */}
        <div style={field}>
          <label style={label}>Notes</label>
          <textarea
            style={{ ...input, minHeight: 72, resize: 'vertical' }}
            value={form.description}
            onChange={e => set('description', e.target.value)}
            placeholder="Optional notes..."
          />
        </div>

        {/* Due date */}
        <div style={field}>
          <label style={label}>Due date</label>
          <input
            type="date"
            style={input}
            value={form.due_date}
            onChange={e => set('due_date', e.target.value)}
          />
        </div>

        {/* Type + Priority row */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Type</label>
            <select style={input} value={form.task_type} onChange={e => set('task_type', e.target.value)}>
              {TASK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Priority</label>
            <select style={input} value={form.priority} onChange={e => set('priority', e.target.value)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        {/* Status (edit only) */}
        {!isNew && (
          <div style={field}>
            <label style={label}>Status</label>
            <select style={input} value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="open">Open</option>
              <option value="complete">Complete</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        )}

        {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ flex: 1, padding: '11px', borderRadius: 12, background: 'var(--blue)', color: '#fff', border: 'none', fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}
          >
            {saving ? 'Saving...' : isNew ? 'Create task' : 'Save changes'}
          </button>

          {!isNew && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              style={{ padding: '11px 16px', borderRadius: 12, background: '#fee2e2', color: '#ef4444', border: 'none', fontSize: 14, fontWeight: 600, cursor: deleting ? 'default' : 'pointer' }}
            >
              {deleting ? '...' : 'Delete'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
