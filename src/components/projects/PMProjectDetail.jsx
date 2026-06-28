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

// ── Room modal ───────────────────────────────────────────────────────────
function RoomModal({ room, projectId, onSave, onClose }) {
  const isNew = !room || room === 'new';
  const [form, setForm] = useState({ name: isNew ? '' : room.name || '', description: isNew ? '' : room.description || '' });
  const [saving, setSaving] = useState(false);
  const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box', background: '#fff', color: '#111827' };
  const labelStyle = { fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 6 };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    const payload = { project_id: projectId, name: form.name.trim(), description: form.description.trim() || null };
    let result;
    if (isNew) {
      const { data } = await sb.from('project_rooms').insert([payload]).select('*').single();
      result = data;
    } else {
      const { data } = await sb.from('project_rooms').update(payload).eq('id', room.id).select('*').single();
      result = data;
    }
    onSave(result, isNew);
    setSaving(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 380 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 16 }}>{isNew ? 'Add Room' : 'Edit Room'}</div>
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Room / Area name *</div>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Front Room, Loft, Rear Extension" style={inputStyle} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={labelStyle}>Description (optional)</div>
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Any notes about this room" style={inputStyle} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 99, border: '1px solid #e5e7eb', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.name.trim()} style={{ flex: 1, padding: '10px', borderRadius: 99, background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Material modal ────────────────────────────────────────────────────────
function MaterialModal({ material, projectId, rooms, onSave, onClose }) {
  const isNew = !material || material === 'new';
  const [form, setForm] = useState({
    name: isNew ? '' : material.name || '',
    supplier: isNew ? '' : material.supplier || '',
    cost: isNew ? '' : material.cost || '',
    quantity: isNew ? '' : material.quantity || '',
    unit: isNew ? '' : material.unit || '',
    lead_time_days: isNew ? '' : material.lead_time_days || '',
    order_date: isNew ? '' : material.order_date || '',
    delivery_date: isNew ? '' : material.delivery_date || '',
    status: isNew ? 'not_ordered' : material.status || 'not_ordered',
    room_ids: isNew ? [] : material.room_ids || [],
    notes: isNew ? '' : material.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box', background: '#fff', color: '#111827' };
  const labelStyle = { fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 6 };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    const payload = {
      project_id: projectId,
      name: form.name.trim(),
      supplier: form.supplier.trim() || null,
      cost: form.cost ? parseFloat(form.cost) : null,
      quantity: form.quantity ? parseFloat(form.quantity) : null,
      unit: form.unit.trim() || null,
      lead_time_days: form.lead_time_days ? parseInt(form.lead_time_days) : null,
      order_date: form.order_date || null,
      delivery_date: form.delivery_date || null,
      status: form.status,
      room_ids: form.room_ids,
      notes: form.notes.trim() || null,
    };
    let result;
    if (isNew) {
      const { data } = await sb.from('project_materials').insert([payload]).select('*').single();
      result = data;
    } else {
      const { data } = await sb.from('project_materials').update(payload).eq('id', material.id).select('*').single();
      result = data;
    }
    onSave(result, isNew);
    setSaving(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 16 }}>{isNew ? 'Add Material' : 'Edit Material'}</div>

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Material name *</div>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Hardwood flooring, Plasterboard" style={inputStyle} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Supplier</div>
          <input value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} placeholder="Supplier name" style={inputStyle} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <div style={labelStyle}>Cost (£)</div>
            <input type="number" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} placeholder="0.00" style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>Lead time (days)</div>
            <input type="number" value={form.lead_time_days} onChange={e => setForm(f => ({ ...f, lead_time_days: e.target.value }))} placeholder="e.g. 42" style={inputStyle} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <div style={labelStyle}>Order date</div>
            <input type="date" value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>Delivery date</div>
            <input type="date" value={form.delivery_date} onChange={e => setForm(f => ({ ...f, delivery_date: e.target.value }))} style={inputStyle} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Task type</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { value: 'trade', label: '🔨 Trade', desc: 'Work by a person or contractor' },
              { value: 'material', label: '📦 Material', desc: 'Delivery or order milestone' },
            ].map(opt => (
              <button key={opt.value} type="button"
                onClick={() => set('task_type', opt.value)}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  border: form.task_type === opt.value ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                  background: form.task_type === opt.value ? '#eff6ff' : 'transparent' }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{opt.label}</div>
                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {form.task_type === 'trade' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={labelStyle}>Contractor / Tradesperson</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.in_house}
                  onChange={e => set('in_house', e.target.checked)}
                  style={{ width: 14, height: 14 }}
                />
                <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 500 }}>In-house</span>
              </label>
            </div>
            {!form.in_house && (
              <input
                value={form.contractor}
                onChange={e => set('contractor', e.target.value)}
                placeholder="Contractor name or company"
                style={inputStyle}
              />
            )}
            {form.in_house && (
              <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic', padding: '8px 0' }}>
                In-house — no contractor details needed
              </div>
            )}
          </div>
        )}

        {rooms?.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={labelStyle}>Room / Area</div>
            <select value={form.room_id} onChange={e => set('room_id', e.target.value)} style={inputStyle}>
              <option value="">— No room linked —</option>
              {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Status</div>
          <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={inputStyle}>
            <option value="not_ordered">Not ordered</option>
            <option value="ordered">Ordered</option>
            <option value="delivered">Delivered</option>
            <option value="delayed">Delayed</option>
          </select>
        </div>

        {rooms.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={labelStyle}>Linked rooms (select all that apply)</div>
            {rooms.map(r => (
              <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}>
                <input type="checkbox"
                  checked={form.room_ids.includes(r.id)}
                  onChange={e => setForm(f => ({ ...f, room_ids: e.target.checked ? [...f.room_ids, r.id] : f.room_ids.filter(id => id !== r.id) }))}
                />
                <span style={{ fontSize: 13, color: '#374151' }}>{r.name}</span>
              </label>
            ))}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <div style={labelStyle}>Notes</div>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 99, border: '1px solid #e5e7eb', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.name.trim()} style={{ flex: 1, padding: '10px', borderRadius: 99, background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {saving ? 'Saving...' : 'Save Material'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Task modal ───────────────────────────────────────────────────────────
function TaskModal({ task, projectId, allTasks, rooms, onSave, onClose }) {
  const isNew = !task || task === 'new';
  const [form, setForm] = useState({
    title: isNew ? '' : task.title || '',
    trade: isNew ? '' : task.trade || '',
    start_date: isNew ? '' : task.start_date || '',
    end_date: isNew ? '' : task.end_date || '',
    status: isNew ? 'not_started' : task.status || 'not_started',
    depends_on: isNew ? [] : (task.depends_on || []).map(d => typeof d === 'string' ? { task_id: d, lag_days: 0 } : d),
    notes: isNew ? '' : task.notes || '',
    room_id: isNew ? '' : task.room_id || '',
    task_type: isNew ? 'trade' : task.task_type || 'trade',
    contractor: isNew ? '' : task.contractor || '',
    in_house: isNew ? false : task.in_house || false,
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
        room_id: form.room_id || null,
        task_type: form.task_type,
        contractor: form.in_house ? null : (form.contractor.trim() || null),
        in_house: form.in_house,
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
          <div style={labelStyle}>Task type</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { value: 'trade', label: '🔨 Trade', desc: 'Work by a person or contractor' },
              { value: 'material', label: '📦 Material', desc: 'Delivery or order milestone' },
            ].map(opt => (
              <button key={opt.value} type="button"
                onClick={() => set('task_type', opt.value)}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  border: form.task_type === opt.value ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                  background: form.task_type === opt.value ? '#eff6ff' : 'transparent' }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{opt.label}</div>
                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {form.task_type === 'trade' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={labelStyle}>Contractor / Tradesperson</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.in_house}
                  onChange={e => set('in_house', e.target.checked)}
                  style={{ width: 14, height: 14 }}
                />
                <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 500 }}>In-house</span>
              </label>
            </div>
            {!form.in_house && (
              <input
                value={form.contractor}
                onChange={e => set('contractor', e.target.value)}
                placeholder="Contractor name or company"
                style={inputStyle}
              />
            )}
            {form.in_house && (
              <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic', padding: '8px 0' }}>
                In-house — no contractor details needed
              </div>
            )}
          </div>
        )}

        {rooms?.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={labelStyle}>Room / Area</div>
            <select value={form.room_id} onChange={e => set('room_id', e.target.value)} style={inputStyle}>
              <option value="">— No room linked —</option>
              {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        )}

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
            <div style={labelStyle}>Depends on</div>
            {allTasks.filter(t => t.id !== task?.id).map(t => {
              const existing = form.depends_on.find(d => d.task_id === t.id);
              return (
                <div key={t.id} style={{ marginBottom: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!existing}
                      onChange={e => set('depends_on', e.target.checked
                        ? [...form.depends_on, { task_id: t.id, lag_days: 0 }]
                        : form.depends_on.filter(d => d.task_id !== t.id)
                      )}
                    />
                    <span style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>{t.title}</span>
                  </label>
                  {existing && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 24, marginTop: 4 }}>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>Lag (days after completion):</span>
                      <input
                        type="number"
                        min="0"
                        value={existing.lag_days || 0}
                        onChange={e => set('depends_on', form.depends_on.map(d =>
                          d.task_id === t.id ? { ...d, lag_days: parseInt(e.target.value) || 0 } : d
                        ))}
                        style={{ width: 60, padding: '3px 6px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 12, textAlign: 'center' }}
                      />
                      {existing.lag_days > 0 && <span style={{ fontSize: 11, color: '#3b82f6' }}>+{existing.lag_days}d wait</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Dates — AFTER dependencies so min date reflects lag */}
        {(() => {
          const minStart = form.depends_on.reduce((latest, { task_id, lag_days }) => {
            const dep = allTasks?.find(t => t.id === task_id);
            if (!dep?.end_date) return latest;
            const d = new Date(dep.end_date);
            d.setDate(d.getDate() + (lag_days || 0) + 1);
            return !latest || d > latest ? d : latest;
          }, null);
          const minStartStr = minStart ? minStart.toISOString().slice(0, 10) : null;
          const minEndStr = form.start_date || minStartStr;
          if (minStartStr && form.start_date && form.start_date < minStartStr) {
            setTimeout(() => set('start_date', minStartStr), 0);
          }
          return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <div style={labelStyle}>
                  Start date
                  {minStartStr && <span style={{ color: '#3b82f6', fontWeight: 400, fontSize: 10, marginLeft: 6 }}>earliest: {new Date(minStartStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
                </div>
                <input type="date" value={form.start_date} min={minStartStr || undefined}
                  onChange={e => { set('start_date', e.target.value); if (form.end_date && e.target.value > form.end_date) set('end_date', ''); }}
                  style={{ ...inputStyle, borderColor: minStartStr && form.start_date && form.start_date < minStartStr ? '#ef4444' : '#e5e7eb' }} />
                {minStartStr && form.start_date && form.start_date < minStartStr && (
                  <div style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>⚠️ Too early — dependency + lag requires later start</div>
                )}
              </div>
              <div>
                <div style={labelStyle}>End date</div>
                <input type="date" value={form.end_date} min={minEndStr || undefined}
                  onChange={e => set('end_date', e.target.value)} style={inputStyle} />
              </div>
            </div>
          );
        })()}

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
  const [rooms, setRooms] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [roomModal, setRoomModal] = useState(null);
  const [materialModal, setMaterialModal] = useState(null);
  const [contractEditing, setContractEditing] = useState(false);
  const [contractSaving, setContractSaving] = useState(false);

  // Load rooms
  useEffect(() => {
    if (!project?.id) return;
    sb.from('project_rooms').select('*').eq('project_id', project.id).order('position').then(({ data }) => setRooms(data || []));
  }, [project?.id]);

  // Load materials when tab opens
  useEffect(() => {
    if (tab !== 'materials' || !project?.id) return;
    sb.from('project_materials').select('*').eq('project_id', project.id).order('created_at').then(({ data }) => setMaterials(data || []));
  }, [tab, project?.id]);

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

  const TABS = ['overview', 'programme', 'rooms', 'materials', 'subcontractors', 'financials', 'emails', 'documents'];

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

            {/* ── Role & Contract card ── */}
            <div style={{ ...card(), marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Contract & Role</div>
                <button onClick={() => setContractEditing(!contractEditing)}
                  style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                  {contractEditing ? 'Done' : 'Edit'}
                </button>
              </div>

              {!contractEditing ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={label}>My role</div>
                    <div style={{ ...value, textTransform: 'capitalize' }}>{project.user_role === 'pm' ? '📋 Project Manager' : '🔨 Contractor'}</div>
                  </div>
                  <div>
                    <div style={label}>Contract type</div>
                    <div style={value}>{
                      { none: 'No formal contract', own: 'Own contract', riba: 'RIBA contract', jct: 'JCT contract' }[project.contract_type] || 'Not set'
                    }</div>
                  </div>
                  <div>
                    <div style={label}>Start date</div>
                    <div style={value}>{project.project_start_date ? new Date(project.project_start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</div>
                  </div>
                  <div>
                    <div style={label}>Practical completion</div>
                    <div style={value}>{project.practical_completion_date ? new Date(project.practical_completion_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</div>
                  </div>
                  <div>
                    <div style={label}>Retention</div>
                    <div style={value}>{project.retention_percent || 5}%</div>
                  </div>
                  <div>
                    <div style={label}>Defects period</div>
                    <div style={value}>{project.defects_period_months || 6} months</div>
                  </div>
                  {project.liquidated_damages_per_day && (
                    <div>
                      <div style={label}>Liquidated damages</div>
                      <div style={value}>£{project.liquidated_damages_per_day}/day</div>
                    </div>
                  )}
                  {project.user_role === 'pm' && (
                    <div>
                      <div style={label}>PM fee</div>
                      <div style={value}>
                        {project.pm_fee_type === 'percentage'
                          ? `${project.pm_fee_percentage || 0}% of contract value = ${fmt((contractValue * (project.pm_fee_percentage || 0)) / 100)}`
                          : fmt(project.pm_fee_fixed)}
                        {project.pm_fee_billing ? ` (${project.pm_fee_billing})` : ''}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Edit mode */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <div style={label}>My role</div>
                      <select value={project.user_role || 'contractor'}
                        onChange={e => setProject(p => ({ ...p, user_role: e.target.value }))}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, background: '#fff', color: '#111827' }}>
                        <option value="contractor">🔨 Contractor</option>
                        <option value="pm">📋 Project Manager</option>
                      </select>
                    </div>
                    <div>
                      <div style={label}>Contract type</div>
                      <select value={project.contract_type || 'none'}
                        onChange={e => setProject(p => ({ ...p, contract_type: e.target.value }))}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, background: '#fff', color: '#111827' }}>
                        <option value="none">No formal contract</option>
                        <option value="own">Own contract</option>
                        <option value="riba">RIBA contract</option>
                        <option value="jct">JCT contract</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <div style={label}>Start date</div>
                      <input type="date" value={project.project_start_date || ''}
                        onChange={e => setProject(p => ({ ...p, project_start_date: e.target.value }))}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box', background: '#fff', color: '#111827' }} />
                    </div>
                    <div>
                      <div style={label}>Practical completion date</div>
                      <input type="date" value={project.practical_completion_date || ''}
                        onChange={e => setProject(p => ({ ...p, practical_completion_date: e.target.value }))}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box', background: '#fff', color: '#111827' }} />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                    <div>
                      <div style={label}>Retention %</div>
                      <input type="number" value={project.retention_percent || 5}
                        onChange={e => setProject(p => ({ ...p, retention_percent: parseFloat(e.target.value) || 5 }))}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box', background: '#fff', color: '#111827' }} />
                    </div>
                    <div>
                      <div style={label}>Defects period (months)</div>
                      <input type="number" value={project.defects_period_months || 6}
                        onChange={e => setProject(p => ({ ...p, defects_period_months: parseInt(e.target.value) || 6 }))}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box', background: '#fff', color: '#111827' }} />
                    </div>
                    <div>
                      <div style={label}>Liquidated damages/day (£)</div>
                      <input type="number" value={project.liquidated_damages_per_day || ''}
                        onChange={e => setProject(p => ({ ...p, liquidated_damages_per_day: parseFloat(e.target.value) || null }))}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box', background: '#fff', color: '#111827' }} />
                    </div>
                  </div>

                  {/* PM fee fields — only if PM role */}
                  {project.user_role === 'pm' && (
                    <div style={{ background: '#eff6ff', borderRadius: 8, padding: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#3b82f6', marginBottom: 8 }}>PM Fee</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                          <div style={label}>Fee type</div>
                          <select value={project.pm_fee_type || 'percentage'}
                            onChange={e => setProject(p => ({ ...p, pm_fee_type: e.target.value }))}
                            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, background: '#fff', color: '#111827' }}>
                            <option value="percentage">% of contract value</option>
                            <option value="fixed">Fixed fee</option>
                          </select>
                        </div>
                        <div>
                          <div style={label}>{project.pm_fee_type === 'fixed' ? 'Fixed fee (£)' : 'Percentage (%)'}</div>
                          <input type="number"
                            value={project.pm_fee_type === 'fixed' ? (project.pm_fee_fixed || '') : (project.pm_fee_percentage || '')}
                            onChange={e => setProject(p => ({
                              ...p,
                              [project.pm_fee_type === 'fixed' ? 'pm_fee_fixed' : 'pm_fee_percentage']: parseFloat(e.target.value) || null
                            }))}
                            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box', background: '#fff', color: '#111827' }} />
                        </div>
                        <div>
                          <div style={label}>Billing method</div>
                          <select value={project.pm_fee_billing || 'monthly'}
                            onChange={e => setProject(p => ({ ...p, pm_fee_billing: e.target.value }))}
                            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, background: '#fff', color: '#111827' }}>
                            <option value="monthly">Monthly</option>
                            <option value="milestone">Milestone</option>
                            <option value="hourly">Hourly</option>
                            <option value="lump_sum">Lump sum</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={async () => {
                      setContractSaving(true);
                      await sb.from('projects').update({
                        user_role: project.user_role,
                        contract_type: project.contract_type,
                        project_start_date: project.project_start_date || null,
                        practical_completion_date: project.practical_completion_date || null,
                        retention_percent: project.retention_percent,
                        defects_period_months: project.defects_period_months,
                        liquidated_damages_per_day: project.liquidated_damages_per_day || null,
                        pm_fee_type: project.pm_fee_type,
                        pm_fee_percentage: project.pm_fee_percentage || null,
                        pm_fee_fixed: project.pm_fee_fixed || null,
                        pm_fee_billing: project.pm_fee_billing,
                      }).eq('id', project.id);
                      setContractSaving(false);
                      setContractEditing(false);
                    }}
                    style={{ padding: '10px', borderRadius: 10, background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                  >
                    {contractSaving ? 'Saving...' : 'Save Contract Details'}
                  </button>
                </div>
              )}
            </div>

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

        {/* ── Rooms tab ── */}
        {tab === 'rooms' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Rooms & Areas</div>
              <button onClick={() => setRoomModal('new')}
                style={{ padding: '7px 16px', borderRadius: 99, background: '#3b82f6', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                + Add Room
              </button>
            </div>
            {rooms.length === 0 ? (
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 24, color: '#6b7280', fontSize: 13, fontStyle: 'italic' }}>
                No rooms yet. Add rooms to link tasks, materials and scope of works together.
              </div>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden' }}>
                {rooms.map((room, i) => {
                  const roomTasks = tasks.filter(t => t.room_id === room.id);
                  const roomMaterials = materials.filter(m => (m.room_ids || []).includes(room.id));
                  return (
                    <div key={room.id} style={{ padding: '14px 16px', borderBottom: i < rooms.length - 1 ? '1px solid #e5e7eb' : 'none' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{room.name}</div>
                          {room.description && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{room.description}</div>}
                          <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                            <span style={{ fontSize: 11, color: '#6b7280' }}>📋 {roomTasks.length} task{roomTasks.length !== 1 ? 's' : ''}</span>
                            <span style={{ fontSize: 11, color: '#6b7280' }}>📦 {roomMaterials.length} material{roomMaterials.length !== 1 ? 's' : ''}</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => setRoomModal(room)} style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
                          <button onClick={async () => {
                            if (!window.confirm('Delete this room?')) return;
                            await sb.from('project_rooms').delete().eq('id', room.id);
                            setRooms(prev => prev.filter(r => r.id !== room.id));
                          }} style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>Delete</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Materials tab ── */}
        {tab === 'materials' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Materials</div>
              <button onClick={() => setMaterialModal('new')}
                style={{ padding: '7px 16px', borderRadius: 99, background: '#3b82f6', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                + Add Material
              </button>
            </div>
            {materials.length === 0 ? (
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 24, color: '#6b7280', fontSize: 13, fontStyle: 'italic' }}>
                No materials yet. Add materials to track orders, lead times and delivery dates.
              </div>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden' }}>
                {materials.map((mat, i) => {
                  const statusColour = { not_ordered: '#6b7280', ordered: '#3b82f6', delivered: '#16a34a', delayed: '#dc2626' }[mat.status];
                  const statusLabel = { not_ordered: 'Not ordered', ordered: 'Ordered', delivered: 'Delivered', delayed: 'Delayed' }[mat.status];
                  const linkedRooms = rooms.filter(r => (mat.room_ids || []).includes(r.id));
                  // Calculate latest order date from linked tasks
                  const linkedTasks = tasks.filter(t => t.material_id === mat.id);
                  const earliestStart = linkedTasks.reduce((min, t) => t.start_date && (!min || t.start_date < min) ? t.start_date : min, null);
                  const latestOrderDate = earliestStart && mat.lead_time_days
                    ? new Date(new Date(earliestStart).getTime() - mat.lead_time_days * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                    : null;
                  const orderDeadlinePassed = latestOrderDate && !mat.order_date && new Date() > new Date(new Date(earliestStart).getTime() - mat.lead_time_days * 86400000);

                  return (
                    <div key={mat.id} style={{ padding: '14px 16px', borderBottom: i < materials.length - 1 ? '1px solid #e5e7eb' : 'none', background: orderDeadlinePassed ? '#fff7ed' : 'transparent' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{mat.name}</span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: statusColour }}>{statusLabel}</span>
                          </div>
                          {mat.supplier && <div style={{ fontSize: 12, color: '#6b7280' }}>Supplier: {mat.supplier}</div>}
                          <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                            {mat.cost && <span style={{ fontSize: 11, color: '#374151' }}>£{Number(mat.cost).toLocaleString()}</span>}
                            {mat.lead_time_days && <span style={{ fontSize: 11, color: '#6b7280' }}>⏱ {mat.lead_time_days} day lead time</span>}
                            {latestOrderDate && !mat.order_date && (
                              <span style={{ fontSize: 11, color: orderDeadlinePassed ? '#dc2626' : '#d97706', fontWeight: 600 }}>
                                {orderDeadlinePassed ? '⚠️ Order overdue!' : `📅 Order by ${latestOrderDate}`}
                              </span>
                            )}
                            {mat.order_date && <span style={{ fontSize: 11, color: '#6b7280' }}>Ordered: {new Date(mat.order_date).toLocaleDateString('en-GB')}</span>}
                            {mat.delivery_date && <span style={{ fontSize: 11, color: '#6b7280' }}>Delivery: {new Date(mat.delivery_date).toLocaleDateString('en-GB')}</span>}
                          </div>
                          {linkedRooms.length > 0 && (
                            <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                              {linkedRooms.map(r => (
                                <span key={r.id} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: '#eff6ff', color: '#3b82f6', border: '1px solid #bfdbfe' }}>{r.name}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 8 }}>
                          <button onClick={() => setMaterialModal(mat)} style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
                          <button onClick={async () => {
                            if (!window.confirm('Delete this material?')) return;
                            await sb.from('project_materials').delete().eq('id', mat.id);
                            setMaterials(prev => prev.filter(m => m.id !== mat.id));
                          }} style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>Delete</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
              const ROW_H = 36;
              const LABEL_W = 130;
              const DAY_W = 28; // pixels per day

              const datedTasks = tasks.filter(t => t.start_date && t.end_date);
              if (datedTasks.length === 0) return (
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 16, marginBottom: 14, color: '#6b7280', fontSize: 13, fontStyle: 'italic' }}>
                  Add start and end dates to tasks to see the Gantt chart.
                </div>
              );

              const allDates = datedTasks.flatMap(t => [new Date(t.start_date), new Date(t.end_date)]);
              const minDate = new Date(Math.min(...allDates));
              const maxDate = new Date(Math.max(...allDates));
              minDate.setDate(minDate.getDate() - 2); // padding
              maxDate.setDate(maxDate.getDate() + 4);
              const totalDays = Math.ceil((maxDate - minDate) / 86400000) + 1;
              const totalW = totalDays * DAY_W;

              const dayOffset = d => Math.floor((new Date(d) - minDate) / 86400000);
              const dayCount = (s, e) => Math.max(1, Math.ceil((new Date(e) - new Date(s)) / 86400000) + 1);

              const statusColours = {
                not_started: '#d1d5db',
                in_progress: '#3b82f6',
                complete: '#16a34a',
                delayed: '#dc2626',
                clash: '#f59e0b',
              };

              // ── Full cascade clash detection ────────────────────────────────
              const taskMap = Object.fromEntries(tasks.map(t => [t.id, t]));

              // Get earliest valid start for a task based on its dependencies + lags
              const getEarliestStart = task => {
                const deps = (task.depends_on || []).map(d => typeof d === 'string' ? { task_id: d, lag_days: 0 } : d);
                if (!deps.length) return null;
                return deps.reduce((latest, { task_id, lag_days }) => {
                  const dep = taskMap[task_id];
                  if (!dep?.end_date) return latest;
                  const earliest = new Date(dep.end_date);
                  earliest.setDate(earliest.getDate() + (lag_days || 0) + 1);
                  return !latest || earliest > latest ? earliest : latest;
                }, null);
              };

              // ── Cascading date clash detection ───────────────────────────
              // Each task checks its actual start date against dep end + lag.
              // If a dep is clashed, we use the dep's start date + its duration
              // as a proxy for its new (slipped) end date, then check downstream.
              const clashedIds = new Set();

              // First pass — find direct clashes
              tasks.forEach(task => {
                if (!task.start_date) return;
                const earliest = getEarliestStart(task);
                if (earliest && new Date(task.start_date) < earliest) {
                  clashedIds.add(task.id);
                }
              });

              // Second pass — cascade: if a dep is clashed, its effective end date
              // is pushed. Check if that pushes downstream tasks into a clash too.
              let changed = true;
              while (changed) {
                changed = false;
                tasks.forEach(task => {
                  if (clashedIds.has(task.id) || !task.start_date) return;
                  const deps = (task.depends_on || []).map(d => typeof d === 'string' ? { task_id: d, lag_days: 0 } : d);
                  const hasClashedDep = deps.some(({ task_id }) => clashedIds.has(task_id));
                  if (!hasClashedDep) return;
                  // Recalculate earliest start accounting for clashed deps
                  // For clashed deps, their effective end = their start + original duration (they slipped)
                  const effectiveEarliest = deps.reduce((latest, { task_id, lag_days }) => {
                    const dep = taskMap[task_id];
                    if (!dep?.end_date) return latest;
                    let depEnd;
                    if (clashedIds.has(task_id) && dep.start_date) {
                      // Dep is clashed — use its original duration from its new earliest start
                      const depEarliest = getEarliestStart(dep);
                      if (depEarliest) {
                        const dur = Math.max(1, Math.ceil((new Date(dep.end_date) - new Date(dep.start_date)) / 86400000));
                        depEnd = new Date(depEarliest);
                        depEnd.setDate(depEnd.getDate() + dur);
                      } else {
                        depEnd = new Date(dep.end_date);
                      }
                    } else {
                      depEnd = new Date(dep.end_date);
                    }
                    const earliest = new Date(depEnd);
                    earliest.setDate(earliest.getDate() + (lag_days || 0) + 1);
                    return !latest || earliest > latest ? earliest : latest;
                  }, null);
                  if (effectiveEarliest && new Date(task.start_date) < effectiveEarliest) {
                    clashedIds.add(task.id);
                    changed = true;
                  }
                });
              }

              const getStatus = task => {
                if (clashedIds.has(task.id)) return 'clash';
                return task.status;
              };

              // Week markers
              const weeks = [];
              const cur = new Date(minDate);
              cur.setDate(cur.getDate() - cur.getDay() + 1);
              while (cur <= maxDate) {
                const offset = dayOffset(cur.toISOString().slice(0, 10));
                if (offset >= 0) weeks.push({ date: new Date(cur), x: offset * DAY_W });
                cur.setDate(cur.getDate() + 7);
              }

              // Today
              const today = new Date();
              const todayX = dayOffset(today.toISOString().slice(0, 10)) * DAY_W;
              const showToday = today >= minDate && today <= maxDate;

              // Dependency lines — connect end of dep bar (+ lag) to start of task bar
              const depLines = [];
              datedTasks.forEach((task, taskIdx) => {
                const deps = (task.depends_on || []).map(d => typeof d === 'string' ? { task_id: d, lag_days: 0 } : d);
                deps.forEach(({ task_id, lag_days }) => {
                  const dep = datedTasks.find(t => t.id === task_id);
                  if (!dep || !dep.end_date || !task.start_date) return;
                  const depIdx = datedTasks.indexOf(dep);
                  // x_bar_end = right edge of dep bar
                  // x_lag_end = x_bar_end + lag days (where the lag period ends)
                  // x2 = left edge of task bar (task start)
                  const x_bar_end = (dayOffset(dep.end_date) + 1) * DAY_W;
                  const x_lag_end = x_bar_end + (lag_days || 0) * DAY_W;
                  const y1 = depIdx * ROW_H + ROW_H / 2;
                  const x2 = dayOffset(task.start_date) * DAY_W;
                  const y2 = taskIdx * ROW_H + ROW_H / 2;
                  const depEndWithLag = new Date(dep.end_date);
                  depEndWithLag.setDate(depEndWithLag.getDate() + (lag_days || 0));
                  const clash = new Date(task.start_date) < depEndWithLag;
                  depLines.push({ x_bar_end, x_lag_end, y1, x2, y2, clash, lag_days: lag_days || 0 });
                });
              });

              const chartH = datedTasks.length * ROW_H;

              return (
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, marginBottom: 14, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Gantt Chart</div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>Drag to scroll →</div>
                  </div>

                  {/* Main Gantt area */}
                  <div style={{ display: 'flex' }}>
                    {/* Fixed label column */}
                    <div style={{ width: LABEL_W, flexShrink: 0, borderRight: '1px solid #e5e7eb' }}>
                      <div style={{ height: 28, borderBottom: '1px solid #e5e7eb' }} />
                      {datedTasks.map(task => (
                        <div key={task.id} style={{
                          height: ROW_H, display: 'flex', alignItems: 'center',
                          padding: '0 10px', borderBottom: '1px solid #f3f4f6',
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 500, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {task.title}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Scrollable chart area */}
                    <div
                      style={{ flex: 1, overflowX: 'auto', cursor: 'grab', WebkitOverflowScrolling: 'touch' }}
                      onMouseDown={e => {
                        const el = e.currentTarget;
                        const startX = e.pageX + el.scrollLeft;
                        el.style.cursor = 'grabbing';
                        const onMove = ev => { el.scrollLeft = startX - ev.pageX; };
                        const onUp = () => {
                          el.style.cursor = 'grab';
                          window.removeEventListener('mousemove', onMove);
                          window.removeEventListener('mouseup', onUp);
                        };
                        window.addEventListener('mousemove', onMove);
                        window.addEventListener('mouseup', onUp);
                      }}
                    >
                      <div style={{ width: totalW, position: 'relative' }}>
                        {/* Week header row */}
                        <div style={{ height: 28, position: 'relative', borderBottom: '1px solid #e5e7eb', background: '#f8f9fa' }}>
                          {weeks.map((w, i) => (
                            <div key={i} style={{ position: 'absolute', left: w.x, top: 0, bottom: 0, borderLeft: '1px solid #e5e7eb', paddingLeft: 4, display: 'flex', alignItems: 'center' }}>
                              <span style={{ fontSize: 10, color: '#9ca3af', whiteSpace: 'nowrap' }}>
                                {w.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* SVG layer for bars, grid and dep lines */}
                        <svg width={totalW} height={chartH} style={{ display: 'block' }}>
                          {/* Week grid lines */}
                          {weeks.map((w, i) => (
                            <line key={i} x1={w.x} y1={0} x2={w.x} y2={chartH} stroke="#f3f4f6" strokeWidth={1} />
                          ))}

                          {/* Row backgrounds */}
                          {datedTasks.map((_, i) => (
                            <rect key={i} x={0} y={i * ROW_H} width={totalW} height={ROW_H}
                              fill={i % 2 === 0 ? '#fff' : '#fafafa'} />
                          ))}

                          {/* Today line */}
                          {showToday && (
                            <>
                              <line x1={todayX} y1={0} x2={todayX} y2={chartH} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4,3" />
                              <text x={todayX + 3} y={12} fontSize={9} fill="#f59e0b" fontWeight="bold">TODAY</text>
                            </>
                          )}

                          {/* Dependency lines */}
                          {depLines.map((line, i) => {
                            const stroke = line.clash ? '#ef4444' : '#334155';
                            // Elbow path: right from dep end → fixed offset right → drop down → right to task start
                            // Always go at least 14px right before dropping, to ensure visible horizontal
                            // Path: dep bar end → (lag period) → drop → task start
                            // elbowX: fixed 14px right of dep bar end
                            // This ensures the vertical drop always sits just right of the dep bar
                            // regardless of where the task bar starts (even if far away due to lag)
                            const elbowX = line.x_bar_end + 14;
                            const path = line.y1 === line.y2
                              ? `M ${line.x_bar_end} ${line.y1} L ${line.x2} ${line.y2}`
                              : `M ${line.x_bar_end} ${line.y1} L ${elbowX} ${line.y1} L ${elbowX} ${line.y2} L ${line.x2} ${line.y2}`;
                            // Badge sits on the vertical drop, midway between rows
                            const midX = elbowX;
                            const midY = (line.y1 + line.y2) / 2;
                            return (
                              <g key={i}>
                                {/* Exit dot at start of line */}
                                <circle cx={line.x_bar_end} cy={line.y1} r={2} fill={stroke} />
                                <path
                                  d={path}
                                  fill="none"
                                  stroke={stroke}
                                  strokeWidth={1.5}
                                  strokeDasharray={line.clash ? '4,2' : 'none'}
                                  markerEnd={line.clash ? 'url(#arrow-red)' : 'url(#arrow-grey)'}
                                />
                                {/* Lag label on the vertical segment */}
                                {line.lag_days > 0 && (
                                  <g>
                                    <rect x={midX - 12} y={midY - 8} width={24} height={16} rx={3} fill="#fff" stroke={stroke} strokeWidth={1} />
                                    <text x={midX} y={midY + 4} textAnchor="middle" fontSize={9} fill={stroke} fontWeight="700">
                                      +{line.lag_days}d
                                    </text>
                                  </g>
                                )}
                              </g>
                            );
                          })}

                          {/* Arrow markers */}
                          <defs>
                            <marker id="arrow-grey" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                              <path d="M0,0 L0,6 L6,3 z" fill="#64748b" />
                            </marker>
                            <marker id="arrow-red" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                              <path d="M0,0 L0,6 L6,3 z" fill="#ef4444" />
                            </marker>
                          </defs>

                          {/* Task bars */}
                          {datedTasks.map((task, i) => {
                            const x = dayOffset(task.start_date) * DAY_W;
                            const w = dayCount(task.start_date, task.end_date) * DAY_W;
                            const y = i * ROW_H + 6;
                            const h = ROW_H - 12;
                            const status = getStatus(task);
                            const colour = statusColours[status];
                            const textColour = status === 'not_started' ? '#374151' : '#fff';

                            return (
                              <g key={task.id}>
                                <rect x={x} y={y} width={w} height={h} rx={4} ry={4} fill={colour} />
                                {w > 20 && (
                                  <text x={x + 6} y={y + h / 2 + 4} fontSize={10} fill={textColour} fontWeight="500">
                                    {dayCount(task.start_date, task.end_date)}d
                                  </text>
                                )}
                              </g>
                            );
                          })}
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* Legend */}
                  <div style={{ display: 'flex', gap: 12, padding: '8px 16px', flexWrap: 'wrap', borderTop: '1px solid #f3f4f6' }}>
                    {[
                      ['#d1d5db', 'Not started'],
                      ['#3b82f6', 'In progress'],
                      ['#16a34a', 'Complete'],
                      ['#dc2626', 'Delayed'],
                      ['#f59e0b', 'Date clash'],
                    ].map(([colour, label]) => (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 12, height: 12, borderRadius: 2, background: colour }} />
                        <span style={{ fontSize: 11, color: '#6b7280' }}>{label}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <svg width="20" height="12"><line x1="0" y1="6" x2="20" y2="6" stroke="#94a3b8" strokeWidth="1.5" /><polygon points="16,3 20,6 16,9" fill="#94a3b8" /></svg>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>Dependency</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <svg width="20" height="12"><line x1="0" y1="6" x2="20" y2="6" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4,2" /></svg>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>Clash</span>
                    </div>
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
                  const deps = (task.depends_on || []).map(d => typeof d === 'string' ? { task_id: d, lag_days: 0 } : d);
                  // Only warn if this task's own start date is actually too early
                  const taskEarliest = deps.reduce((latest, { task_id, lag_days }) => {
                    const dep = tasks.find(t => t.id === task_id);
                    if (!dep?.end_date) return latest;
                    const d = new Date(dep.end_date);
                    d.setDate(d.getDate() + (lag_days || 0) + 1);
                    return !latest || d > latest ? d : latest;
                  }, null);
                  const depDelayed = taskEarliest && task.start_date && new Date(task.start_date) < taskEarliest;

                  return (
                    <div key={task.id} style={{
                      display: 'grid', gridTemplateColumns: '1fr 80px 80px 90px 70px',
                      gap: 8, padding: '12px 16px',
                      borderBottom: idx < tasks.length - 1 ? '1px solid #e5e7eb' : 'none',
                      background: depDelayed ? '#fff7ed' : 'transparent',
                    }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{task.title}</span>
                          {depDelayed && task.start_date && (() => {
                            const deps2 = (task.depends_on || []).map(d => typeof d === 'string' ? { task_id: d, lag_days: 0 } : d);
                            const earliest = deps2.reduce((latest, { task_id, lag_days }) => {
                              const dep = tasks.find(t => t.id === task_id);
                              if (!dep?.end_date) return latest;
                              const d = new Date(dep.end_date);
                              d.setDate(d.getDate() + (lag_days || 0) + 1);
                              return !latest || d > latest ? d : latest;
                            }, null);
                            if (!earliest) return null;
                            const newStart = earliest.toISOString().slice(0, 10);
                            const dur = task.end_date ? Math.ceil((new Date(task.end_date) - new Date(task.start_date)) / 86400000) : 0;
                            const newEnd = new Date(earliest);
                            newEnd.setDate(newEnd.getDate() + dur);
                            const newEndStr = newEnd.toISOString().slice(0, 10);
                            return (
                              <button
                                onClick={async () => {
                                  await sb.from('programme_tasks')
                                    .update({ start_date: newStart, end_date: newEndStr })
                                    .eq('id', task.id);
                                  setTasks(prev => prev.map(t => t.id === task.id
                                    ? { ...t, start_date: newStart, end_date: newEndStr }
                                    : t
                                  ));
                                }}
                                style={{ fontSize: 10, color: '#fff', background: '#f59e0b', border: 'none', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}
                              >
                                ↻ Realign
                              </button>
                            );
                          })()}
                        </div>
                        {task.in_house && <div style={{ fontSize: 11, color: '#3b82f6', marginTop: 2 }}>In-house</div>}
                        {!task.in_house && task.contractor && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{task.contractor}</div>}
                        {task.trade && !task.contractor && !task.in_house && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{task.trade}</div>}
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
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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

      {/* Room modal */}
      {roomModal && (
        <RoomModal
          room={roomModal}
          projectId={project.id}
          onSave={(result, isNew) => {
            setRooms(prev => isNew ? [...prev, result] : prev.map(r => r.id === result.id ? result : r));
            setRoomModal(null);
          }}
          onClose={() => setRoomModal(null)}
        />
      )}

      {/* Material modal */}
      {materialModal && (
        <MaterialModal
          material={materialModal}
          projectId={project.id}
          rooms={rooms}
          onSave={(result, isNew) => {
            setMaterials(prev => isNew ? [...prev, result] : prev.map(m => m.id === result.id ? result : m));
            setMaterialModal(null);
          }}
          onClose={() => setMaterialModal(null)}
        />
      )}

      {/* Task modal */}
      {taskModal && (
        <TaskModal
          task={taskModal}
          projectId={project.id}
          allTasks={tasks}
          rooms={rooms}
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
