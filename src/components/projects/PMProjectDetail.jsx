// src/components/projects/PMProjectDetail.jsx
// Phase 1 — Construction / PM project detail page
// Cards: Overview, Subcontractors, Financials

import { useState, useEffect } from 'react';
import sb from '../../supabaseClient';

const card = () => ({
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: '16px 18px',
  marginBottom: 14,
});

const label = { fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 };
const value = { fontSize: 14, color: 'var(--text)', fontWeight: 500 };

function fmt(n) {
  if (!n && n !== 0) return '—';
  return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ── Task modal ───────────────────────────────────────────────────────────
function TaskModal({ task, projectId, allTasks, onSave, onClose }) {
  const isNew = !task || task === 'new';
  const [form, setForm] = useState({
    title: isNew ? '' : task.title || '',
    trade: isNew ? '' : task.trade || '',
    start_date: isNew ? '' : task.start_date || '',
    end_date: isNew ? '' : task.end_date || '',
    status: isNew ? 'not_started' : task.status || 'not_started',
    depends_on: isNew ? [] : task.depends_on || [],
    notes: isNew ? '' : task.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        project_id: projectId,
        title: form.title.trim(),
        trade: form.trade.trim() || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        status: form.status,
        depends_on: form.depends_on,
        notes: form.notes.trim() || null,
      };
      let result;
      if (isNew) {
        const { data } = await sb.from('programme_tasks').insert([payload]).select('*').single();
        result = data;
      } else {
        const { data } = await sb.from('programme_tasks').update(payload).eq('id', task.id).select('*').single();
        result = data;
      }
      onSave(result, isNew);
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box', background: '#fff', color: '#111827' };
  const labelStyle = { fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 6 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 16 }}>
          {isNew ? 'Add Task' : 'Edit Task'}
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Task name *</div>
          <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. First fix plumbing" style={inputStyle} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Trade</div>
          <input value={form.trade} onChange={e => set('trade', e.target.value)} placeholder="e.g. Plumber, Electrician" style={inputStyle} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <div style={labelStyle}>Start date</div>
            <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>End date</div>
            <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Status</div>
          <select value={form.status} onChange={e => set('status', e.target.value)} style={inputStyle}>
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="complete">Complete</option>
            <option value="delayed">Delayed</option>
          </select>
        </div>

        {allTasks?.filter(t => t.id !== task?.id).length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={labelStyle}>Depends on (can't start until these are complete)</div>
            {allTasks.filter(t => t.id !== task?.id).map(t => (
              <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.depends_on.includes(t.id)}
                  onChange={e => set('depends_on', e.target.checked
                    ? [...form.depends_on, t.id]
                    : form.depends_on.filter(id => id !== t.id)
                  )}
                />
                <span style={{ fontSize: 13, color: '#374151' }}>{t.title}</span>
              </label>
            ))}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <div style={labelStyle}>Notes</div>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
            placeholder="Any notes about this task..."
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 99, border: '1px solid #e5e7eb', background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#374151' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.title.trim()}
            style={{ flex: 1, padding: '10px', borderRadius: 99, background: saving ? '#93c5fd' : '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {saving ? 'Saving...' : 'Save Task'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Subcontractor modal ───────────────────────────────────────────────────
function SubModal({ sub, onSave, onClose }) {
  const [form, setForm] = useState({
    name: sub?.name || '',
    trade: sub?.trade || '',
    contract_value: sub?.contract_value || '',
    amount_paid: sub?.amount_paid || '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>
          {sub ? 'Edit Subcontractor' : 'Add Subcontractor'}
        </div>
        {[
          { key: 'name', label: 'Name / Company' },
          { key: 'trade', label: 'Trade' },
          { key: 'contract_value', label: 'Contract value (£)', type: 'number' },
          { key: 'amount_paid', label: 'Amount paid (£)', type: 'number' },
        ].map(({ key, label: lbl, type }) => (
          <div key={key} style={{ marginBottom: 12 }}>
            <div style={label}>{lbl}</div>
            <input
              type={type || 'text'}
              value={form[key]}
              onChange={e => set(key, e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box' }}
            />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 99, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button
            onClick={() => onSave({
              ...form,
              contract_value: parseFloat(form.contract_value) || 0,
              amount_paid: parseFloat(form.amount_paid) || 0,
              id: sub?.id || `sub_${Date.now()}`,
            })}
            style={{ flex: 1, padding: '10px', borderRadius: 99, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────
export default function PMProjectDetail({ project: initialProject, onBack, onOpenComposer }) {
  const [project, setProject] = useState(initialProject);
  const [tab, setTab] = useState('overview');
  const [subModal, setSubModal] = useState(null); // null | 'new' | {sub object}
  const [saving, setSaving] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskModal, setTaskModal] = useState(null); // null | 'new' | {task}

  // Load tasks when programme tab opens
  useEffect(() => {
    if (tab !== 'programme' || !project?.id) return;
    setTasksLoading(true);
    sb.from('programme_tasks')
      .select('*')
      .eq('project_id', project.id)
      .order('position', { ascending: true })
      .order('start_date', { ascending: true })
      .then(({ data }) => {
        setTasks(data || []);
        setTasksLoading(false);
      });
  }, [tab, project?.id]);

  // Re-fetch from DB on open
  useEffect(() => {
    if (!initialProject?.id || !sb) return;
    sb.from('projects').select('*').eq('id', initialProject.id).single()
      .then(({ data }) => { if (data) setProject(data); });
  }, [initialProject?.id]);

  const subs = Array.isArray(project.subcontractors) ? project.subcontractors : [];
  const contractValue = parseFloat(project.contract_value || project.fee || 0);
  const amountPaid = parseFloat(project.amount_paid || 0);
  const subsTotal = subs.reduce((s, sub) => s + parseFloat(sub.contract_value || 0), 0);
  const subsPaid = subs.reduce((s, sub) => s + parseFloat(sub.amount_paid || 0), 0);
  const margin = contractValue - subsTotal;
  const balance = contractValue - amountPaid;

  const saveSubs = async (updatedSubs) => {
    setSaving(true);
    const { data } = await sb.from('projects').update({ subcontractors: updatedSubs }).eq('id', project.id).select('*').single();
    if (data) setProject(data);
    setSaving(false);
  };

  const handleSaveSub = async (sub) => {
    const existing = subs.findIndex(s => s.id === sub.id);
    const updated = existing >= 0
      ? subs.map(s => s.id === sub.id ? sub : s)
      : [...subs, sub];
    await saveSubs(updated);
    setSubModal(null);
  };

  const handleDeleteSub = async (id) => {
    if (!window.confirm('Remove this subcontractor?')) return;
    await saveSubs(subs.filter(s => s.id !== id));
  };

  const TABS = ['overview', 'programme', 'subcontractors', 'financials', 'emails', 'documents'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg2)' }}>
      {/* Header */}
      <div style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)', padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <button onClick={onBack} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 99, padding: '6px 14px', fontSize: 12, cursor: 'pointer', color: 'var(--text2)' }}>← Back</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {project.site_address || project.bo_premise_address || 'Unnamed Project'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>
              {project.ref} · <span style={{ color: '#c2410c', fontWeight: 600 }}>🏗️ Construction / PM</span>
            </div>
          </div>
        </div>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '6px 14px', borderRadius: 99, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
                background: tab === t ? 'var(--accent)' : 'transparent',
                color: tab === t ? '#fff' : 'var(--text2)',
                border: tab === t ? 'none' : '1px solid var(--border)',
                fontWeight: tab === t ? 600 : 400,
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>

        {/* ── Overview tab ── */}
        {tab === 'overview' && (
          <div>
            <div style={card()}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Project Details</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={label}>Site address</div>
                  <div style={value}>{project.site_address || project.bo_premise_address || '—'}</div>
                </div>
                <div>
                  <div style={label}>Status</div>
                  <div style={{ ...value, textTransform: 'capitalize' }}>{project.project_stage?.replace('_', ' ') || project.status || 'Active'}</div>
                </div>
                <div>
                  <div style={label}>Client</div>
                  <div style={value}>{project.client_name || project.bo_1_name || '—'}</div>
                </div>
                <div>
                  <div style={label}>Client email</div>
                  <div style={{ ...value, fontSize: 12, wordBreak: 'break-all' }}>{project.client_email || project.bo_1_email || '—'}</div>
                </div>
                <div>
                  <div style={label}>Contract value</div>
                  <div style={{ ...value, color: 'var(--green)', fontWeight: 700 }}>{fmt(contractValue)}</div>
                </div>
                <div>
                  <div style={label}>Balance remaining</div>
                  <div style={{ ...value, color: balance > 0 ? 'var(--amber, #d97706)' : 'var(--green)', fontWeight: 700 }}>{fmt(balance)}</div>
                </div>
              </div>
              {project.works && (
                <div style={{ marginTop: 12 }}>
                  <div style={label}>Works</div>
                  <div style={{ ...value, fontSize: 13 }}>{project.works}</div>
                </div>
              )}
            </div>

            {/* Financial summary */}
            <div style={card()}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Financial Summary</div>
              {[
                { label: 'Contract value', val: contractValue, colour: 'var(--text)' },
                { label: 'Subcontractor costs', val: subsTotal, colour: '#ef4444' },
                { label: 'Gross margin', val: margin, colour: margin >= 0 ? 'var(--green)' : '#ef4444' },
                { label: 'Amount received', val: amountPaid, colour: 'var(--green)' },
                { label: 'Outstanding balance', val: balance, colour: balance > 0 ? 'var(--amber, #d97706)' : 'var(--green)' },
              ].map(({ label: lbl, val, colour }) => (
                <div key={lbl} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13, color: 'var(--text2)' }}>{lbl}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: colour }}>{fmt(val)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Subcontractors tab ── */}
        {tab === 'subcontractors' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Subcontractors</div>
              <button
                onClick={() => setSubModal('new')}
                style={{ padding: '7px 16px', borderRadius: 99, background: 'var(--accent)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                + Add
              </button>
            </div>

            {subs.length === 0 ? (
              <div style={{ ...card(), color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
                No subcontractors yet. Add them to track costs and payments.
              </div>
            ) : (
              subs.map(sub => {
                const balance = parseFloat(sub.contract_value || 0) - parseFloat(sub.amount_paid || 0);
                return (
                  <div key={sub.id} style={card()}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{sub.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{sub.trade}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setSubModal(sub)} style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
                        <button onClick={() => handleDeleteSub(sub.id)} style={{ fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      <div>
                        <div style={label}>Contract</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{fmt(sub.contract_value)}</div>
                      </div>
                      <div>
                        <div style={label}>Paid</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>{fmt(sub.amount_paid)}</div>
                      </div>
                      <div>
                        <div style={label}>Owed</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: balance > 0 ? 'var(--amber, #d97706)' : 'var(--green)' }}>{fmt(balance)}</div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {/* Totals */}
            {subs.length > 0 && (
              <div style={{ ...card(), background: 'var(--bg3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: 'var(--text2)' }}>Total owed to subcontractors</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber, #d97706)' }}>{fmt(subsTotal - subsPaid)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: 'var(--text2)' }}>Remaining on contract</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>{fmt(balance)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Financials tab ── */}
        {tab === 'financials' && (
          <div>
            <div style={card()}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Project Financials</div>
              {[
                { label: 'Contract value', val: contractValue, colour: 'var(--text)', bold: true },
                { label: 'Total subcontractor costs', val: subsTotal, colour: '#ef4444' },
                { label: 'Gross margin', val: margin, colour: margin >= 0 ? 'var(--green)' : '#ef4444', bold: true },
                null,
                { label: 'Amount received from client', val: amountPaid, colour: 'var(--green)' },
                { label: 'Outstanding from client', val: balance, colour: balance > 0 ? 'var(--amber, #d97706)' : 'var(--green)' },
                null,
                { label: 'Paid to subcontractors', val: subsPaid, colour: '#ef4444' },
                { label: 'Owed to subcontractors', val: subsTotal - subsPaid, colour: 'var(--amber, #d97706)', bold: true },
              ].map((row, i) => {
                if (!row) return <div key={i} style={{ height: 1, background: 'var(--border)', margin: '8px 0' }} />;
                return (
                  <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                    <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: row.bold ? 600 : 400 }}>{row.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: row.colour }}>{fmt(row.val)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Programme tab ── */}
        {tab === 'programme' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Programme</div>
              <button
                onClick={() => setTaskModal('new')}
                style={{ padding: '7px 16px', borderRadius: 99, background: '#3b82f6', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                + Add Task
              </button>
            </div>

            {/* ── Gantt chart ── */}
            {!tasksLoading && tasks.length > 0 && (() => {
              // Calculate date range
              const dates = tasks.flatMap(t => [t.start_date, t.end_date].filter(Boolean));
              if (dates.length === 0) return null;
              const minDate = new Date(dates.reduce((a, b) => a < b ? a : b));
              const maxDate = new Date(dates.reduce((a, b) => a > b ? a : b));
              const totalDays = Math.max(1, Math.ceil((maxDate - minDate) / 86400000) + 1);

              const statusColours = {
                not_started: '#e5e7eb',
                in_progress: '#3b82f6',
                complete: '#16a34a',
                delayed: '#dc2626',
              };

              // Generate week markers
              const weeks = [];
              const cur = new Date(minDate);
              cur.setDate(cur.getDate() - cur.getDay() + 1); // start of week
              while (cur <= maxDate) {
                const pct = Math.max(0, (cur - minDate) / (totalDays * 86400000)) * 100;
                weeks.push({ date: new Date(cur), pct });
                cur.setDate(cur.getDate() + 7);
              }

              return (
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 16, marginBottom: 14, overflowX: 'auto' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Gantt Chart</div>

                  {/* Week headers */}
                  <div style={{ position: 'relative', height: 24, marginLeft: 120, marginBottom: 4 }}>
                    {weeks.map((w, i) => (
                      <div key={i} style={{
                        position: 'absolute', left: `${w.pct}%`,
                        fontSize: 10, color: '#9ca3af', whiteSpace: 'nowrap',
                      }}>
                        {w.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </div>
                    ))}
                  </div>

                  {/* Task rows */}
                  {tasks.filter(t => t.start_date && t.end_date).map((task, idx) => {
                    const start = new Date(task.start_date);
                    const end = new Date(task.end_date);
                    const left = ((start - minDate) / (totalDays * 86400000)) * 100;
                    const width = Math.max(1, ((end - start) / (totalDays * 86400000)) * 100);
                    const colour = statusColours[task.status] || '#e5e7eb';

                    return (
                      <div key={task.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                        {/* Task label */}
                        <div style={{ width: 120, flexShrink: 0, fontSize: 12, color: '#374151', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>
                          {task.title}
                        </div>
                        {/* Bar track */}
                        <div style={{ flex: 1, position: 'relative', height: 22, background: '#f3f4f6', borderRadius: 4 }}>
                          {/* Week grid lines */}
                          {weeks.map((w, i) => (
                            <div key={i} style={{ position: 'absolute', left: `${w.pct}%`, top: 0, bottom: 0, borderLeft: '1px solid #e5e7eb' }} />
                          ))}
                          {/* Task bar */}
                          <div style={{
                            position: 'absolute',
                            left: `${left}%`,
                            width: `${width}%`,
                            top: 2, bottom: 2,
                            background: colour,
                            borderRadius: 3,
                            display: 'flex', alignItems: 'center', paddingLeft: 4,
                            overflow: 'hidden',
                          }}>
                            {width > 5 && (
                              <span style={{ fontSize: 10, color: task.status === 'not_started' ? '#374151' : '#fff', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                                {task.duration_days || Math.ceil((end - start) / 86400000) + 1}d
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Today marker */}
                  {(() => {
                    const today = new Date();
                    if (today >= minDate && today <= maxDate) {
                      const pct = ((today - minDate) / (totalDays * 86400000)) * 100;
                      return (
                        <div style={{ position: 'relative', marginLeft: 120 }}>
                          <div style={{ position: 'absolute', left: `${pct}%`, top: -((tasks.filter(t => t.start_date && t.end_date).length * 28) + 28), bottom: 0, borderLeft: '2px dashed #f59e0b', zIndex: 10 }}>
                            <div style={{ position: 'absolute', top: 0, left: 2, fontSize: 9, color: '#f59e0b', whiteSpace: 'nowrap', fontWeight: 700 }}>TODAY</div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  {/* Legend */}
                  <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
                    {Object.entries({ not_started: 'Not started', in_progress: 'In progress', complete: 'Complete', delayed: 'Delayed' }).map(([s, lbl]) => (
                      <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{ width: 12, height: 12, borderRadius: 2, background: statusColours[s] }} />
                        <span style={{ fontSize: 11, color: '#6b7280' }}>{lbl}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {tasksLoading && <div style={{ color: '#6b7280', fontSize: 13, padding: 16 }}>Loading programme...</div>}

            {!tasksLoading && tasks.length === 0 && (
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 24, color: '#6b7280', fontSize: 13, fontStyle: 'italic' }}>
                No tasks yet. Add tasks to build your programme.
              </div>
            )}

            {tasks.length > 0 && (
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden', marginBottom: 14 }}>
                {/* Column headers */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px 70px', gap: 8, padding: '10px 16px', background: '#f8f9fa', borderBottom: '1px solid #e5e7eb' }}>
                  {['Task', 'Start', 'End', 'Status', ''].map((h, i) => (
                    <div key={i} style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</div>
                  ))}
                </div>

                {tasks.map((task, idx) => {
                  const statusColour = {
                    not_started: '#6b7280',
                    in_progress: '#3b82f6',
                    complete: '#16a34a',
                    delayed: '#dc2626',
                  }[task.status] || '#6b7280';

                  const statusLabel = {
                    not_started: 'Not started',
                    in_progress: 'In progress',
                    complete: 'Complete',
                    delayed: 'Delayed',
                  }[task.status] || task.status;

                  // Check if any dependencies are delayed
                  const depDelayed = (task.depends_on || []).some(depId =>
                    tasks.find(t => t.id === depId)?.status === 'delayed'
                  );

                  return (
                    <div key={task.id} style={{
                      display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px 70px',
                      gap: 8, padding: '12px 16px',
                      borderBottom: idx < tasks.length - 1 ? '1px solid #e5e7eb' : 'none',
                      background: depDelayed ? '#fff7ed' : 'transparent',
                    }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{task.title}</div>
                        {task.trade && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{task.trade}</div>}
                        {depDelayed && <div style={{ fontSize: 11, color: '#d97706', marginTop: 2 }}>⚠️ Dependency delayed</div>}
                        {task.notes && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2, fontStyle: 'italic' }}>{task.notes}</div>}
                      </div>
                      <div style={{ fontSize: 12, color: '#374151' }}>
                        {task.start_date ? new Date(task.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                      </div>
                      <div style={{ fontSize: 12, color: '#374151' }}>
                        {task.end_date ? new Date(task.end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                      </div>
                      <div>
                        <select
                          value={task.status}
                          onChange={async e => {
                            const newStatus = e.target.value;
                            await sb.from('programme_tasks').update({ status: newStatus }).eq('id', task.id);
                            setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
                          }}
                          style={{ fontSize: 11, fontWeight: 600, color: statusColour, background: 'transparent', border: 'none', cursor: 'pointer', width: '100%' }}
                        >
                          {['not_started', 'in_progress', 'complete', 'delayed'].map(s => (
                            <option key={s} value={s}>{s.replace('_', ' ')}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setTaskModal(task)} style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
                        <button onClick={async () => {
                          if (!window.confirm('Delete this task?')) return;
                          await sb.from('programme_tasks').delete().eq('id', task.id);
                          setTasks(prev => prev.filter(t => t.id !== task.id));
                        }} style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>Del</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Summary */}
            {tasks.length > 0 && (
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '12px 16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                  {[
                    { label: 'Total tasks', val: tasks.length, colour: '#111827' },
                    { label: 'Complete', val: tasks.filter(t => t.status === 'complete').length, colour: '#16a34a' },
                    { label: 'In progress', val: tasks.filter(t => t.status === 'in_progress').length, colour: '#3b82f6' },
                    { label: 'Delayed', val: tasks.filter(t => t.status === 'delayed').length, colour: '#dc2626' },
                  ].map(({ label, val, colour }) => (
                    <div key={label} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: colour }}>{val}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Emails tab ── */}
        {tab === 'emails' && (
          <div style={{ ...card(), color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
            Project emails coming soon.
          </div>
        )}

        {/* ── Documents tab ── */}
        {tab === 'documents' && (
          <div style={{ ...card(), color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
            Project documents coming soon.
          </div>
        )}

      </div>

      {/* Task modal */}
      {taskModal && (
        <TaskModal
          task={taskModal}
          projectId={project.id}
          allTasks={tasks}
          onSave={(result, isNew) => {
            setTasks(prev => isNew ? [...prev, result] : prev.map(t => t.id === result.id ? result : t));
            setTaskModal(null);
          }}
          onClose={() => setTaskModal(null)}
        />
      )}

      {/* Subcontractor modal */}
      {subModal && (
        <SubModal
          sub={subModal === 'new' ? null : subModal}
          onSave={handleSaveSub}
          onClose={() => setSubModal(null)}
        />
      )}
    </div>
  );
}
