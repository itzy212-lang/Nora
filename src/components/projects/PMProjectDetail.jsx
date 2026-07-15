// src/components/projects/PMProjectDetail.jsx
// Phase 1 — Construction / PM project detail page
// Cards: Overview, Subcontractors, Financials

import { useState, useEffect } from 'react';
import sb from '../../supabaseClient';
import DualAIReviewOverlay from '../shared/DualAIReviewOverlay';

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

// ── Scope item modal ─────────────────────────────────────────────────────
function DetachModal({ item, projectId, rooms, onSave, onClose }) {
  const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box', background: '#fff', color: '#111827' };
  const labelStyle = { fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 6 };

  // Try to suggest a starting split. Two patterns handled:
  // 1) Room-count breakdown e.g. "Counted across all rooms: Kitchen 3, Living 4, Bedroom 1 2" — split into one row per room, title = original item title, room = detected room
  // 2) Generic multi-task description e.g. "Excavation, foundations and construction of flank wall" — split into one row per phrase
  const suggestSplit = () => {
    const text = item.description || '';
    const roomNames = rooms.map(r => (r.name || '').trim()).filter(Boolean).sort((a, b) => b.length - a.length);

    // Pattern 1: room-count breakdown — look for "<RoomName> <number>" pairs anywhere in the text
    if (roomNames.length) {
      const roomMatches = [];
      const lowerText = text.toLowerCase();
      for (const roomName of roomNames) {
        const re = new RegExp(`${roomName.toLowerCase().replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*(\\d+)`, 'i');
        const m = lowerText.match(re);
        if (m) {
          const room = rooms.find(r => (r.name || '').trim().toLowerCase() === roomName.toLowerCase());
          roomMatches.push({ title: `${item.title} — ${room.name}`, description: `Qty: ${m[1]}`, room_id: room.id, cost: '' });
        }
      }
      if (roomMatches.length >= 2) return roomMatches;
    }

    // Pattern 2: generic multi-phrase split — only trigger if description looks like a genuine list of separate tasks
    // (avoid mangling free text — require at least 2 comma/semicolon-separated segments each with 2+ words)
    const parts = text.split(/,|;/).map(s => s.trim()).filter(s => s.split(/\s+/).length >= 2);
    if (parts.length >= 2 && parts.length <= 8) {
      return parts.map(p => ({ title: p.charAt(0).toUpperCase() + p.slice(1), description: '', room_id: '', cost: '' }));
    }

    // Fallback: original item + one blank row for manual entry
    return [
      { title: item.title || '', description: item.description || '', room_id: item.room_id || '', cost: item.cost || '' },
      { title: '', description: '', room_id: '', cost: '' },
    ];
  };

  const [rowsState, setRowsState] = useState(suggestSplit());
  const [saving, setSaving] = useState(false);
  const [keepOriginal, setKeepOriginal] = useState(false);

  const updateRow = (i, field, val) => setRowsState(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  const addRow = () => setRowsState(prev => [...prev, { title: '', description: '', room_id: '', cost: '' }]);
  const removeRow = (i) => setRowsState(prev => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    const validRows = rowsState.filter(r => r.title.trim());
    const blankRowCount = rowsState.length - validRows.length;
    if (validRows.length < 1) return;
    if (!keepOriginal && blankRowCount > 0) {
      const proceed = window.confirm(
        `${blankRowCount} row${blankRowCount > 1 ? 's are' : ' is'} blank and will be skipped. ` +
        `The original item "${item.title}" will be permanently deleted and replaced with only the ${validRows.length} filled-in item(s) below. Continue?`
      );
      if (!proceed) return;
    }
    setSaving(true);

    const created = [];
    for (let i = 0; i < validRows.length; i++) {
      const r = validRows[i];
      const { data } = await sb.from('scope_items').insert([{
        project_id: projectId,
        title: r.title.trim(),
        description: r.description.trim() || null,
        trade: item.trade || null,
        subcontractor_name: item.subcontractor_name || null,
        in_house: item.in_house || false,
        cost: r.cost ? parseFloat(r.cost) : null,
        markup_type: 'none',
        client_charge: r.cost ? parseFloat(r.cost) : 0,
        room_id: r.room_id || null,
        position: (item.position || 0) + i,
        extracted_by_ai: item.extracted_by_ai || false,
      }]).select('*').single();
      if (data) created.push(data);
    }

    if (!keepOriginal) {
      await sb.from('scope_items').delete().eq('id', item.id);
    }

    onSave(created, keepOriginal ? null : item.id);
    setSaving(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 4 }}>Detach item</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
          Split "{item.title}" into separate scope items. Edit the titles below, allocate each to a room, and set a price if known.
        </div>

        {rowsState.map((row, i) => (
          <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 10, position: 'relative' }}>
            {rowsState.length > 1 && (
              <button onClick={() => removeRow(i)} style={{ position: 'absolute', top: 8, right: 8, background: 'transparent', border: 'none', color: '#ef4444', fontSize: 14, cursor: 'pointer' }}>✕</button>
            )}
            <div style={{ marginBottom: 8 }}>
              <div style={labelStyle}>Item {i + 1} title</div>
              <input value={row.title} onChange={e => updateRow(i, 'title', e.target.value)} placeholder="e.g. Excavation" style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={labelStyle}>Room</div>
                <select value={row.room_id} onChange={e => updateRow(i, 'room_id', e.target.value)} style={inputStyle}>
                  <option value="">Select room / External</option>
                  <option value="__external__">External</option>
                  {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <div style={labelStyle}>Price (optional)</div>
                <input type="number" value={row.cost} onChange={e => updateRow(i, 'cost', e.target.value)} placeholder="£" style={inputStyle} />
              </div>
            </div>
          </div>
        ))}

        <button onClick={addRow} style={{ padding: '7px 14px', borderRadius: 99, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 16 }}>
          + Add another item
        </button>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6b7280', marginBottom: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={keepOriginal} onChange={e => setKeepOriginal(e.target.checked)} />
          Keep original item as well (don't delete it)
        </label>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 10, background: '#f3f4f6', color: '#374151', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '9px 18px', borderRadius: 10, background: '#f59e0b', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Detaching...' : `Detach into ${rowsState.filter(r => r.title.trim()).length} items`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScopeModal({ item, projectId, rooms, onSave, onClose }) {
  const isNew = !item || item === 'new';
  const [form, setForm] = useState({
    title: isNew ? '' : item.title || '',
    description: isNew ? '' : item.description || '',
    trade: isNew ? '' : item.trade || '',
    subcontractor_name: isNew ? '' : item.subcontractor_name || '',
    in_house: isNew ? false : item.in_house || false,
    cost: isNew ? '' : item.cost || '',
    markup_type: isNew ? 'none' : item.markup_type || 'none',
    markup_value: isNew ? '' : item.markup_value || '',
    client_charge: isNew ? '' : item.client_charge || '',
    room_id: isNew ? '' : item.room_id || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box', background: '#fff', color: '#111827' };
  const labelStyle = { fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 6 };

  const cost = parseFloat(form.cost || 0);
  const markupVal = parseFloat(form.markup_value || 0);
  const calculatedCharge = form.markup_type === 'percentage' ? cost + (cost * markupVal / 100)
    : form.markup_type === 'fixed' ? cost + markupVal
    : parseFloat(form.client_charge || 0);

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    const payload = {
      project_id: projectId,
      title: form.title.trim(),
      description: form.description.trim() || null,
      trade: form.trade.trim() || null,
      subcontractor_name: form.in_house ? null : (form.subcontractor_name.trim() || null),
      in_house: form.in_house || false,
      cost: form.cost ? parseFloat(form.cost) : null,
      markup_type: form.markup_type,
      markup_value: form.markup_value ? parseFloat(form.markup_value) : null,
      client_charge: calculatedCharge || null,
      room_id: form.room_id || null,
    };
    let result;
    if (isNew) {
      const { data } = await sb.from('scope_items').insert([payload]).select('*').single();
      result = data;
    } else {
      const { data } = await sb.from('scope_items').update(payload).eq('id', item.id).select('*').single();
      result = data;
    }
    onSave(result, isNew);
    setSaving(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 16 }}>{isNew ? 'Add Scope Item' : 'Edit Scope Item'}</div>

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Item description *</div>
          <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. First fix plumbing" style={inputStyle} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Details</div>
          <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2} placeholder="Scope details..." style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <div style={labelStyle}>Trade</div>
            <input value={form.trade} onChange={e => set('trade', e.target.value)} placeholder="e.g. Plumber" style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>Who's doing this?</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              {[{ val: false, label: '🏢 Sub' }, { val: true, label: '🔨 In-house' }].map(opt => (
                <button key={String(opt.val)} type="button" onClick={() => set('in_house', opt.val)}
                  style={{ flex: 1, padding: '7px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                    border: (form.in_house || false) === opt.val ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                    background: (form.in_house || false) === opt.val ? '#eff6ff' : 'transparent',
                    color: (form.in_house || false) === opt.val ? '#1e40af' : '#374151' }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {!form.in_house && (
          <div style={{ marginBottom: 12 }}>
            <div style={labelStyle}>Subcontractor</div>
            <input value={form.subcontractor_name} onChange={e => set('subcontractor_name', e.target.value)} placeholder="Company / name" style={inputStyle} />
          </div>
        )}

        {/* Pricing */}
        <div style={{ background: '#f8f9fa', borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 10 }}>Pricing</div>
          {!form.in_house && (
            <div style={{ marginBottom: 10 }}>
              <div style={labelStyle}>Subcontractor / supplier cost (£)</div>
              <input type="number" value={form.cost} onChange={e => set('cost', e.target.value)} placeholder="What you're paying" style={inputStyle} />
            </div>
          )}
          {form.in_house && (
            <div style={{ marginBottom: 10, padding: '8px 12px', background: '#eff6ff', borderRadius: 8, fontSize: 12, color: '#3b82f6' }}>
              In-house — enter your charge to the client below
            </div>
          )}
          <div style={{ marginBottom: 10 }}>
            <div style={labelStyle}>Markup</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {[
                { val: 'none', label: 'None' },
                { val: 'percentage', label: '% markup' },
                { val: 'fixed', label: '£ fixed' },
              ].map(opt => (
                <button key={opt.val} type="button" onClick={() => set('markup_type', opt.val)}
                  style={{ flex: 1, padding: '7px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                    border: form.markup_type === opt.val ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                    background: form.markup_type === opt.val ? '#eff6ff' : 'transparent',
                    color: form.markup_type === opt.val ? '#1e40af' : '#374151' }}>
                  {opt.label}
                </button>
              ))}
            </div>
            {form.markup_type !== 'none' && (
              <input type="number" value={form.markup_value} onChange={e => set('markup_value', e.target.value)}
                placeholder={form.markup_type === 'percentage' ? 'e.g. 20 for 20%' : 'Fixed amount to add'}
                style={inputStyle} />
            )}
          </div>
          {form.markup_type === 'none' && (
            <div>
              <div style={labelStyle}>Client charge (£)</div>
              <input type="number" value={form.client_charge} onChange={e => set('client_charge', e.target.value)}
                placeholder="What you're charging the client" style={inputStyle} />
            </div>
          )}
          {(cost > 0 || calculatedCharge > 0) && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, textAlign: 'center' }}>
              <div><div style={{ fontSize: 10, color: '#9ca3af' }}>YOUR COST</div><div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>£{cost.toLocaleString()}</div></div>
              <div><div style={{ fontSize: 10, color: '#9ca3af' }}>MARKUP</div><div style={{ fontSize: 13, fontWeight: 700, color: '#d97706' }}>£{(calculatedCharge - cost).toLocaleString()}</div></div>
              <div><div style={{ fontSize: 10, color: '#9ca3af' }}>CLIENT PAYS</div><div style={{ fontSize: 13, fontWeight: 700, color: '#16a34a' }}>£{calculatedCharge.toLocaleString()}</div></div>
            </div>
          )}
        </div>

        {rooms?.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={labelStyle}>Room / Area</div>
            <select value={form.room_id} onChange={e => set('room_id', e.target.value)} style={inputStyle}>
              <option value="">— No room linked —</option>
              {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 99, border: '1px solid #e5e7eb', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.title.trim()}
            style={{ flex: 1, padding: '10px', borderRadius: 99, background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {saving ? 'Saving...' : 'Save Item'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Payment stage modal ──────────────────────────────────────────────────
function StageModal({ stage, projectId, onSave, onClose }) {
  const isNew = !stage || stage === 'new';
  const [form, setForm] = useState({
    title: isNew ? '' : stage.title || '',
    description: isNew ? '' : stage.description || '',
    amount: isNew ? '' : stage.amount || '',
    due_date: isNew ? '' : stage.due_date || '',
    status: isNew ? 'pending' : stage.status || 'pending',
  });
  const [saving, setSaving] = useState(false);
  const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box', background: '#fff', color: '#111827' };
  const labelStyle = { fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 6 };

  const handleSave = async () => {
    if (!form.title.trim() || !form.amount) return;
    setSaving(true);
    const payload = {
      project_id: projectId,
      title: form.title.trim(),
      description: form.description.trim() || null,
      amount: parseFloat(form.amount),
      due_date: form.due_date || null,
      status: form.status,
    };
    let result;
    if (isNew) {
      const { data } = await sb.from('payment_stages').insert([payload]).select('*').single();
      result = data;
    } else {
      const { data } = await sb.from('payment_stages').update(payload).eq('id', stage.id).select('*').single();
      result = data;
    }
    onSave(result, isNew);
    setSaving(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 16 }}>{isNew ? 'Add Payment Stage' : 'Edit Payment Stage'}</div>
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Stage name *</div>
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Start on site, First fix, Practical completion" style={inputStyle} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Description</div>
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What work is included in this stage" style={inputStyle} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <div style={labelStyle}>Amount (£) *</div>
            <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>Due date</div>
            <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} style={inputStyle} />
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={labelStyle}>Status</div>
          <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={inputStyle}>
            <option value="pending">Pending</option>
            <option value="certified">Certified</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 99, border: '1px solid #e5e7eb', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.title.trim() || !form.amount}
            style={{ flex: 1, padding: '10px', borderRadius: 99, background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {saving ? 'Saving...' : 'Save Stage'}
          </button>
        </div>
      </div>
    </div>
  );
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

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Task value (£)</div>
          <input type="number" value={form.task_value}
            onChange={e => set('task_value', e.target.value)}
            placeholder="Value of this task e.g. 2500"
            style={inputStyle} />
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Used for payment certification and payment schedule</div>
        </div>

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
    task_value: isNew ? '' : task.task_value || '',
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
        task_value: form.task_value ? parseFloat(form.task_value) : null,
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

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Task value (£)</div>
          <input type="number" value={form.task_value}
            onChange={e => set('task_value', e.target.value)}
            placeholder="Value of this task e.g. 2500"
            style={inputStyle} />
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Used for payment certification and payment schedule</div>
        </div>

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
  const [stages, setStages] = useState([]);
  const [stageModal, setStageModal] = useState(null);
  const [scopeItems, setScopeItems] = useState([]);
  const [scopeModal, setScopeModal] = useState(null);
  const [detachModal, setDetachModal] = useState(null);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [selectedScopeIds, setSelectedScopeIds] = useState(new Set());
  const [drawingExtracting, setDrawingExtracting] = useState(false);
  const [dualAIEnabled, setDualAIEnabled] = useState(() => localStorage.getItem('nora_dual_ai') === 'true');
  const [drawingType, setDrawingType] = useState('general');
  const [dualAIReview, setDualAIReview] = useState(null); // { diff, gptItems, file }
  const [dualAIVerifying, setDualAIVerifying] = useState(false);
  const [drawingError, setDrawingError] = useState('');

  // Load scope items
  useEffect(() => {
    if (tab !== 'scope' || !project?.id) return;
    setScopeLoading(true);
    sb.from('scope_items').select('*').eq('project_id', project.id)
      .order('position').then(({ data }) => { setScopeItems(data || []); setScopeLoading(false); });
  }, [tab, project?.id]);

  // Load payment stages
  useEffect(() => {
    if (tab !== 'payments' || !project?.id) return;
    sb.from('payment_stages').select('*').eq('project_id', project.id).order('position').then(({ data }) => setStages(data || []));
  }, [tab, project?.id]);

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

  const TABS = ['overview', 'scope', 'rooms', 'programme', 'payments', 'materials', 'subcontractors', 'financials', 'emails', 'documents'];

  const handleDeletePMProject = async () => {
    if (!window.confirm('Delete this project and all its records? This cannot be undone.')) return;
    try {
      const cleanupTables = ['scope_items', 'payment_stages', 'programme_tasks', 'materials', 'subcontractors', 'site_visits', 'room_notes', 'snag_items', 'documents', 'ai_messages', 'ai_sessions', 'emails'];
      for (const table of cleanupTables) {
        try { await sb.from(table).delete().eq('project_id', project.id); } catch (_) {}
      }
      await sb.from('projects').delete().eq('id', project.id);
      onBack?.();
    } catch (err) {
      console.error('[PMProjectDetail] delete failed:', err.message);
      alert('Delete failed: ' + err.message);
    }
  };

  const handleMarkComplete = async () => {
    if (!window.confirm('Mark this project as Complete? It will move out of the active list.')) return;
    try {
      const { error } = await sb.from('projects').update({ status: 'complete' }).eq('id', project.id);
      if (error) throw error;
      onBack?.();
    } catch (err) {
      console.error('[PMProjectDetail] mark complete failed:', err.message);
    }
  };


  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg2)' }}>
      {/* Header */}
      <div style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)', padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <button onClick={onBack} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 99, padding: '6px 14px', fontSize: 12, cursor: 'pointer', color: 'var(--text2)' }}>← Back</button>
          {project.status !== 'complete' && (
            <button onClick={handleMarkComplete} style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 99, padding: '6px 14px', fontSize: 12, cursor: 'pointer', color: '#16a34a', fontWeight: 600 }}>✓ Complete</button>
          )}
          <button onClick={handleDeletePMProject} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 99, padding: '6px 14px', fontSize: 12, cursor: 'pointer', color: 'var(--red, #dc2626)' }}>Delete</button>
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
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Project Details</div>
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
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#3b82f6', marginBottom: 4 }}>PM Fee</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>Leave blank if you are managing your own project and not charging a fee.</div>
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

                  {/* Payment mode */}
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.55px', marginBottom: 8 }}>Payment Method</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[
                        { value: 'task', label: '✅ Task completion', desc: 'Payment raised on completion of each task. Most controlled — payment tied to specific work.' },
                        { value: 'milestone', label: '🏁 Milestone', desc: 'Payment stages agreed upfront. Multiple tasks bundled into each stage.' },
                        { value: 'interim', label: '📅 Interim / weekly', desc: 'Percentage of work completed each week. Requires trust or a contract administrator.' },
                      ].map(opt => (
                        <button key={opt.value} type="button"
                          onClick={() => setProject(p => ({ ...p, payment_mode: opt.value }))}
                          style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                            border: (project.payment_mode || 'task') === opt.value ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                            background: (project.payment_mode || 'task') === opt.value ? '#eff6ff' : 'transparent' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{opt.label}</div>
                          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={async () => {
                      setContractSaving(true);
                      // Calculate my fee and save to `fee` column so dashboard picks it up
                      const cv = parseFloat(project.contract_value || project.fee || 0);
                      const myFee = project.user_role === 'pm'
                        ? (project.pm_fee_type === 'fixed'
                            ? parseFloat(project.pm_fee_fixed || 0)
                            : cv * ((parseFloat(project.pm_fee_percentage || 0)) / 100))
                        : cv; // contractor — fee = contract value
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
                        fee: myFee || null, // write my fee back so dashboard reads it correctly
                        payment_mode: project.payment_mode || 'task',
                      }).eq('id', project.id);
                      setProject(p => ({ ...p, fee: myFee }));
                      setContractSaving(false);
                      setContractEditing(false);
                    }}
                    style={{ padding: '10px', borderRadius: 10, background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                  >
                    {contractSaving ? 'Saving...' : 'Save Contract Details'}
                  </button>
                </div>
              )}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f3f4f6' }}>
                <div style={label}>Payment method</div>
                <div style={value}>{{
                  task: '✅ Task completion',
                  milestone: '🏁 Milestone',
                  interim: '📅 Interim / weekly'
                }[project.payment_mode || 'task']}</div>
              </div>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e5e7eb', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={label}>Site address</div>
                  <div style={value}>{project.site_address || project.bo_premise_address || '—'}</div>
                </div>
                <div>
                  <div style={label}>Client</div>
                  <div style={value}>{project.client_name || project.bo_1_name || '—'}</div>
                </div>
                <div>
                  <div style={label}>Contract value</div>
                  <div style={{ ...value, fontWeight: 700, color: '#16a34a' }}>{fmt(contractValue)}</div>
                </div>
                <div>
                  <div style={label}>Status</div>
                  <div style={{ ...value, textTransform: 'capitalize' }}>{project.project_stage?.replace('_', ' ') || project.status || 'Active'}</div>
                </div>
              </div>
              {project.works && (
                <div style={{ marginTop: 10 }}>
                  <div style={label}>Works</div>
                  <div style={{ ...value, fontSize: 13 }}>{project.works}</div>
                </div>
              )}
            </div>

            {/* Financial summary — adapts to role */}
            <div style={card()}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Project Financials</div>

              {project.user_role === 'pm' ? (() => {
                const pmFee = project.pm_fee_type === 'fixed'
                  ? (parseFloat(project.pm_fee_fixed) || 0)
                  : contractValue * ((parseFloat(project.pm_fee_percentage) || 0) / 100);
                return [
                  { label: "Contract value (client's)", val: contractValue, colour: '#6b7280' },
                  { label: `My PM fee (${project.pm_fee_type === 'fixed' ? 'fixed' : `${project.pm_fee_percentage || 0}%`})`, val: pmFee, colour: '#111827', bold: true },
                  { label: 'Received', val: amountPaid, colour: '#16a34a' },
                  { label: 'Outstanding (my fee)', val: pmFee - amountPaid, colour: pmFee - amountPaid > 0 ? '#d97706' : '#16a34a' },
                ].map(({ label: lbl, val, colour, bold }) => (
                  <div key={lbl} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #e5e7eb' }}>
                    <span style={{ fontSize: 13, color: '#374151', fontWeight: bold ? 600 : 400 }}>{lbl}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: colour }}>{fmt(val)}</span>
                  </div>
                ));
              })() : [
                { label: 'Contract value', val: contractValue, colour: '#111827' },
                { label: `Retention held (${project.retention_percent || 5}%)`, val: contractValue * ((project.retention_percent || 5) / 100), colour: '#6b7280' },
                { label: 'Subcontractor costs', val: subsTotal, colour: '#ef4444' },
                { label: 'Gross margin', val: margin, colour: margin >= 0 ? '#16a34a' : '#ef4444' },
                { label: 'Amount received', val: amountPaid, colour: '#16a34a' },
                { label: 'Outstanding balance', val: balance, colour: balance > 0 ? '#d97706' : '#16a34a' },
              ].map(({ label: lbl, val, colour }) => (
                <div key={lbl} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #e5e7eb' }}>
                  <span style={{ fontSize: 13, color: '#374151' }}>{lbl}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: colour }}>{fmt(val)}</span>
                </div>
              ))}

              {/* PM role — contractor costs shown separately */}
              {project.user_role === 'pm' && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '2px solid #e5e7eb' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    Contractor Costs (Client&#39;s Money — not your cash flow)
                  </div>
                  {[
                    { label: 'Total contractor costs', val: subsTotal, colour: '#374151' },
                    { label: 'Paid to contractors', val: subsPaid, colour: '#16a34a' },
                    { label: 'Owed to contractors', val: subsTotal - subsPaid, colour: '#d97706' },
                  ].map(({ label: lbl, val, colour }) => (
                    <div key={lbl} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}>
                      <span style={{ fontSize: 12, color: '#6b7280' }}>{lbl}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: colour }}>{fmt(val)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Payments tab ── */}
        {tab === 'payments' && (() => {
          const retentionPct = parseFloat(project.retention_percent || 5) / 100;
          const paymentMode = project.payment_mode || 'task';
          const totalTaskValue = tasks.reduce((s, t) => s + parseFloat(t.task_value || 0), 0);
          const totalStageAmounts = stages.reduce((s, st) => s + parseFloat(st.amount || 0), 0);
          const contractTotal = totalTaskValue || contractValue;
          const totalPaid = stages.filter(s => s.status === 'paid').reduce((s, st) => s + parseFloat(st.amount_paid || st.amount || 0), 0);
          const totalRetentionHeld = totalPaid * retentionPct;
          const totalNetPaid = totalPaid - totalRetentionHeld;
          const maxPayable = contractTotal * (1 - retentionPct);
          const safeRemaining = maxPayable - totalNetPaid;
          const warningLevel = safeRemaining < contractTotal * 0.1 ? 'red' : safeRemaining < contractTotal * 0.2 ? 'amber' : null;

          // Tasks ready for payment (complete, have value, not yet certified)
          const certifiableTasks = tasks.filter(t =>
            t.status === 'complete' && parseFloat(t.task_value || 0) > 0 && !t.certified_for_payment
          );

          return (
            <div>
              {/* Payment mode banner */}
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1e40af' }}>
                    {{ task: '✅ Task completion payments', milestone: '🏁 Milestone payments', interim: '📅 Interim / weekly payments' }[paymentMode]}
                  </div>
                  <div style={{ fontSize: 11, color: '#3b82f6', marginTop: 2 }}>
                    {{ task: 'Payment raised when tasks are marked complete', milestone: 'Payment raised when agreed milestones are reached', interim: 'Payment raised as percentage of work completed' }[paymentMode]}
                  </div>
                </div>
                <button onClick={() => { setTab('overview'); setContractEditing(true); }}
                  style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}>Change</button>
              </div>

              {/* Negative equity warning */}
              {warningLevel && (
                <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 14,
                  background: warningLevel === 'red' ? '#fef2f2' : '#fff7ed',
                  border: `1px solid ${warningLevel === 'red' ? '#fca5a5' : '#fed7aa'}` }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: warningLevel === 'red' ? '#dc2626' : '#d97706' }}>
                    {warningLevel === 'red' ? '🚨 Stop — do not release further payments' : '⚠️ Approaching payment limit'}
                  </div>
                  <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>
                    {warningLevel === 'red'
                      ? `Total paid (net of retention): ${fmt(totalNetPaid)} of maximum ${fmt(maxPayable)}. Do not make further payments until more work is certified.`
                      : `Only ${fmt(safeRemaining)} remaining before reaching contract sum minus retention.`}
                  </div>
                </div>
              )}

              {/* ── TASK COMPLETION MODE ── */}
              {paymentMode === 'task' && (
                <div>
                  {certifiableTasks.length > 0 && (
                    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d', marginBottom: 10 }}>
                        {certifiableTasks.length} task{certifiableTasks.length !== 1 ? 's' : ''} ready for payment — {fmt(certifiableTasks.reduce((s,t) => s + parseFloat(t.task_value||0), 0))}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                        {certifiableTasks.map(t => (
                          <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 10px', background: '#fff', borderRadius: 8, border: '1px solid #bbf7d0' }}>
                            <input type="checkbox" id={`cert-${t.id}`}
                              onChange={e => {
                                const el = document.getElementById(`cert-${t.id}`);
                              }}
                              style={{ width: 16, height: 16 }} />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{t.title}</div>
                              {t.contractor && <div style={{ fontSize: 11, color: '#6b7280' }}>{t.contractor}</div>}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#16a34a' }}>{fmt(t.task_value)}</div>
                          </label>
                        ))}
                      </div>
                      <button
                        onClick={async () => {
                          const checked = certifiableTasks.filter(t => document.getElementById(`cert-${t.id}`)?.checked);
                          if (checked.length === 0) { alert('Select at least one task to certify.'); return; }
                          const total = checked.reduce((s,t) => s + parseFloat(t.task_value||0), 0);
                          const taskNames = checked.map(t => t.title).join(', ');
                          const confirmed = window.confirm(
                            `You are about to certify payment of ${fmt(total)} for:

${taskNames}

By confirming, you acknowledge these tasks have been satisfactorily completed.

Proceed?`
                          );
                          if (!confirmed) return;
                          // Create payment stage for these tasks
                          const net = total * (1 - retentionPct);
                          const { data: newStage } = await sb.from('payment_stages').insert([{
                            project_id: project.id,
                            title: `Payment -- ${checked.length > 1 ? `${checked.length} tasks` : checked[0].title}`,
                            description: taskNames,
                            amount: total,
                            status: 'certified',
                            certified_date: new Date().toISOString().slice(0,10),
                            payment_type: 'task_completion',
                            task_ids: checked.map(t => t.id),
                            confirmed_complete: true,
                            position: stages.length,
                          }]).select('*').single();
                          // Mark tasks as certified
                          await sb.from('programme_tasks').update({ certified_for_payment: true, payment_stage_id: newStage.id })
                            .in('id', checked.map(t => t.id));
                          setStages(prev => [...prev, newStage]);
                          setTasks(prev => prev.map(t => checked.find(c => c.id === t.id) ? { ...t, certified_for_payment: true } : t));
                        }}
                        style={{ width: '100%', padding: '11px', borderRadius: 10, background: '#16a34a', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                        Certify selected tasks for payment
                      </button>
                    </div>
                  )}

                  {certifiableTasks.length === 0 && tasks.filter(t => t.task_value > 0).length > 0 && (
                    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 16px', marginBottom: 14, color: '#6b7280', fontSize: 13 }}>
                      No tasks ready for payment yet. Mark tasks as complete in the Programme tab to certify them here.
                    </div>
                  )}

                  {tasks.filter(t => t.task_value > 0).length === 0 && (
                    <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#d97706' }}>⚠️ No task values set</div>
                      <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>Go to Programme → Edit each task → add a value to enable task completion payments.</div>
                    </div>
                  )}
                </div>
              )}

              {/* ── INTERIM MODE ── */}
              {paymentMode === 'interim' && (
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Raise Interim Payment</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>% claimed by contractor</div>
                      <input type="number" min="0" max="100" placeholder="e.g. 50"
                        id="interim-claimed"
                        style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>% you approve</div>
                      <input type="number" min="0" max="100" placeholder="e.g. 25"
                        id="interim-approved"
                        style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box' }} />
                    </div>
                  </div>
                  <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#92400e' }}>
                    ⚠️ Interim payments require both parties to agree on the percentage of work completed. Without a contract administrator, you are relying on self-assessment.
                  </div>
                  <button
                    onClick={async () => {
                      const claimed = parseFloat(document.getElementById('interim-claimed')?.value || 0);
                      const approved = parseFloat(document.getElementById('interim-approved')?.value || 0);
                      if (!approved) { alert('Enter the percentage you are approving.'); return; }
                      const amount = contractTotal * (approved / 100);
                      const confirmed = window.confirm(
                        `You are approving an interim payment of ${fmt(amount)} (${approved}% of contract value).

Contractor claimed: ${claimed}%
You approved: ${approved}%

By confirming, you acknowledge this percentage of work has been satisfactorily completed.

Proceed?`
                      );
                      if (!confirmed) return;
                      const { data: newStage } = await sb.from('payment_stages').insert([{
                        project_id: project.id,
                        title: `Interim payment -- ${approved}% complete`,
                        amount,
                        status: 'certified',
                        certified_date: new Date().toISOString().slice(0,10),
                        payment_type: 'interim',
                        percentage_claimed: claimed,
                        percentage_approved: approved,
                        confirmed_complete: true,
                        position: stages.length,
                      }]).select('*').single();
                      setStages(prev => [...prev, newStage]);
                    }}
                    style={{ width: '100%', padding: '11px', borderRadius: 10, background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                    Raise interim payment
                  </button>
                </div>
              )}

              {/* Retention summary — shown for all modes */}
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 10 }}>Retention Tracker</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Total held</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{fmt(totalRetentionHeld)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Release on PC</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#16a34a' }}>{fmt(contractTotal * retentionPct * 0.5)}</div>
                    {project.practical_completion_date && (
                      <div style={{ fontSize: 11, color: '#6b7280' }}>{new Date(project.practical_completion_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Release after defects</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#16a34a' }}>{fmt(contractTotal * retentionPct * 0.5)}</div>
                    {project.practical_completion_date && (() => {
                      const d = new Date(project.practical_completion_date);
                      d.setMonth(d.getMonth() + parseInt(project.defects_period_months || 6));
                      return <div style={{ fontSize: 11, color: '#6b7280' }}>{d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>;
                    })()}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Max payable</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#374151' }}>{fmt(maxPayable)}</div>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>excl. {project.retention_percent || 5}% retention</div>
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>Paid net of retention: {fmt(totalNetPaid)}</span>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>Max: {fmt(maxPayable)}</span>
                  </div>
                  <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4 }}>
                    <div style={{ height: '100%', borderRadius: 4, width: `${Math.min(100, maxPayable > 0 ? (totalNetPaid / maxPayable) * 100 : 0)}%`,
                      background: warningLevel === 'red' ? '#dc2626' : warningLevel === 'amber' ? '#f59e0b' : '#3b82f6', transition: 'width 0.3s' }} />
                  </div>
                </div>
              </div>

              {/* % Paid vs % Complete chart */}
              {(() => {
                const totalTaskVal = tasks.filter(t => t.task_value > 0).reduce((s, t) => s + parseFloat(t.task_value || 0), 0);
                const completedVal = tasks.filter(t => t.status === 'complete' && t.task_value > 0).reduce((s, t) => s + parseFloat(t.task_value || 0), 0);
                const pctComplete = totalTaskVal > 0 ? (completedVal / totalTaskVal) * 100 : 0;
                const pctPaid = maxPayable > 0 ? (totalNetPaid / maxPayable) * 100 : 0;
                const overpaid = pctPaid > pctComplete + 10; // More than 10% ahead = warning
                const severelyOverpaid = pctPaid > pctComplete + 25;
                if (totalTaskVal === 0) return null;
                return (
                  <div style={{ background: '#fff', border: `1px solid ${severelyOverpaid ? '#fca5a5' : overpaid ? '#fed7aa' : '#e5e7eb'}`, borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Payment vs Progress</div>
                      {severelyOverpaid && <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', background: '#fee2e2', padding: '3px 8px', borderRadius: 99 }}>🚨 Overpaid vs work done</div>}
                      {overpaid && !severelyOverpaid && <div style={{ fontSize: 11, fontWeight: 700, color: '#d97706', background: '#fff7ed', padding: '3px 8px', borderRadius: 99 }}>⚠️ Ahead of progress</div>}
                      {!overpaid && <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>✅ On track</div>}
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontSize: 11, color: '#6b7280' }}>Work completed</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>{pctComplete.toFixed(0)}% ({fmt(completedVal)})</span>
                      </div>
                      <div style={{ height: 10, background: '#e5e7eb', borderRadius: 5 }}>
                        <div style={{ height: '100%', borderRadius: 5, width: `${Math.min(100, pctComplete)}%`, background: '#16a34a' }} />
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontSize: 11, color: '#6b7280' }}>Amount paid (net of retention)</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: severelyOverpaid ? '#dc2626' : overpaid ? '#d97706' : '#3b82f6' }}>{pctPaid.toFixed(0)}% ({fmt(totalNetPaid)})</span>
                      </div>
                      <div style={{ height: 10, background: '#e5e7eb', borderRadius: 5 }}>
                        <div style={{ height: '100%', borderRadius: 5, width: `${Math.min(100, pctPaid)}%`,
                          background: severelyOverpaid ? '#dc2626' : overpaid ? '#f59e0b' : '#3b82f6' }} />
                      </div>
                    </div>
                    {(overpaid || severelyOverpaid) && (
                      <div style={{ marginTop: 8, fontSize: 11, color: severelyOverpaid ? '#dc2626' : '#92400e', background: severelyOverpaid ? '#fee2e2' : '#fff7ed', padding: '6px 10px', borderRadius: 6 }}>
                        {severelyOverpaid
                          ? `You have paid ${pctPaid.toFixed(0)}% but only ${pctComplete.toFixed(0)}% of work is complete. Do not release further payments until progress catches up.`
                          : `Payment is ${(pctPaid - pctComplete).toFixed(0)}% ahead of completed work. Monitor progress before next payment.`}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Payment history — all modes */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>
                  {paymentMode === 'milestone' ? 'Payment Stages' : 'Payment History'}
                </div>
                {paymentMode === 'milestone' && (
                  <button onClick={() => setStageModal('new')}
                    style={{ padding: '7px 16px', borderRadius: 99, background: '#3b82f6', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    + Add Stage
                  </button>
                )}
              </div>

              {stages.length === 0 ? (
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 24, color: '#6b7280', fontSize: 13, fontStyle: 'italic' }}>
                  {paymentMode === 'milestone' ? 'No payment stages yet. Add stages to define your payment schedule.' : 'No payments certified yet.'}
                </div>
              ) : (
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 70px 60px', gap: 8, padding: '10px 16px', background: '#f8f9fa', borderBottom: '1px solid #e5e7eb' }}>
                    {['Description', 'Gross', 'Net', 'Status', ''].map((h, i) => (
                      <div key={i} style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</div>
                    ))}
                  </div>
                  {stages.map((stage, i) => {
                    const retention = parseFloat(stage.amount || 0) * retentionPct;
                    const net = parseFloat(stage.amount || 0) - retention;
                    const statusColour = { pending: '#6b7280', certified: '#3b82f6', paid: '#16a34a' }[stage.status];
                    const typeLabel = { task_completion: '✅ Tasks', interim: '📅 Interim', stage: '🏁 Stage' }[stage.payment_type || 'stage'];
                    return (
                      <div key={stage.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 70px 60px', gap: 8, padding: '12px 16px', borderBottom: i < stages.length - 1 ? '1px solid #e5e7eb' : 'none', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{stage.title}</div>
                          {stage.description && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{stage.description}</div>}
                          <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                            <span style={{ fontSize: 10, color: '#9ca3af' }}>{typeLabel}</span>
                            {stage.certified_date && <span style={{ fontSize: 10, color: '#9ca3af' }}>Certified: {new Date(stage.certified_date).toLocaleDateString('en-GB')}</span>}
                            {stage.paid_date && <span style={{ fontSize: 10, color: '#16a34a' }}>Paid: {new Date(stage.paid_date).toLocaleDateString('en-GB')}</span>}
                          </div>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{fmt(stage.amount)}</div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{fmt(net)}</div>
                          <div style={{ fontSize: 10, color: '#9ca3af' }}>-{fmt(retention)}</div>
                        </div>
                        <div>
                          <select value={stage.status}
                            onChange={async e => {
                              const newStatus = e.target.value;
                              const updates = { status: newStatus };
                              if (newStatus === 'certified') updates.certified_date = new Date().toISOString().slice(0, 10);
                              if (newStatus === 'paid') { updates.paid_date = new Date().toISOString().slice(0, 10); updates.amount_paid = parseFloat(stage.amount); }
                              await sb.from('payment_stages').update(updates).eq('id', stage.id);
                              setStages(prev => prev.map(s => s.id === stage.id ? { ...s, ...updates } : s));
                            }}
                            style={{ fontSize: 11, fontWeight: 600, color: statusColour, background: 'transparent', border: 'none', cursor: 'pointer', width: '100%' }}>
                            <option value="pending">Pending</option>
                            <option value="certified">Certified</option>
                            <option value="paid">Paid</option>
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {paymentMode === 'milestone' && <button onClick={() => setStageModal(stage)} style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>}
                          <button onClick={async () => {
                            if (!window.confirm('Delete this payment record?')) return;
                            await sb.from('payment_stages').delete().eq('id', stage.id);
                            setStages(prev => prev.filter(s => s.id !== stage.id));
                          }} style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>Del</button>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 70px 60px', gap: 8, padding: '12px 16px', background: '#f8f9fa', borderTop: '2px solid #e5e7eb' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>Total certified</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{fmt(totalStageAmounts)}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{fmt(totalStageAmounts * (1 - retentionPct))}</div>
                    <div /><div />
                  </div>
                </div>
              )}
            </div>
          );
        })()}

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

        {/* ── Scope of Works tab ── */}
        {tab === 'scope' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Scope of Works</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Price each item — costs flow into financials and payment schedule</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {selectedScopeIds.size === 1 && (
                  <button onClick={() => setDetachModal(scopeItems.find(s => selectedScopeIds.has(s.id)))}
                  style={{ padding: '7px 14px', borderRadius: 99, background: '#f59e0b', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    ⊗ Detach item
                  </button>
                )}
                {selectedScopeIds.size >= 2 && (
                  <button onClick={async () => {
                    const selected = scopeItems.filter(s => selectedScopeIds.has(s.id));
                    const merged = {
                      title: selected.map(s => s.title).join(' + '),
                      description: selected.filter(s => s.description).map(s => s.description).join('; ') || null,
                      trade: selected[0].trade || null,
                      subcontractor_name: selected[0].subcontractor_name || null,
                      in_house: selected[0].in_house || false,
                      cost: selected.reduce((s, i) => s + parseFloat(i.cost || 0), 0),
                      markup_type: selected[0].markup_type || 'none',
                      markup_value: selected[0].markup_value || null,
                      client_charge: selected.reduce((s, i) => {
                        const cost = parseFloat(i.cost || 0);
                        const mv = parseFloat(i.markup_value || 0);
                        return s + (i.markup_type === 'percentage' ? cost + cost * mv / 100 : i.markup_type === 'fixed' ? cost + mv : parseFloat(i.client_charge || 0));
                      }, 0),
                      position: Math.min(...selected.map(s => s.position || 0)),
                      extracted_by_ai: selected.some(s => s.extracted_by_ai),
                      project_id: project.id,
                    };
                    // Delete all selected items
                    for (const s of selected) await sb.from('scope_items').delete().eq('id', s.id);
                    // Insert merged
                    const { data: newItem } = await sb.from('scope_items').insert([merged]).select('*').single();
                    setScopeItems(prev => [...prev.filter(s => !selectedScopeIds.has(s.id)), newItem].sort((a,b) => (a.position||0)-(b.position||0)));
                    setSelectedScopeIds(new Set());
                  }}
                  style={{ padding: '7px 14px', borderRadius: 99, background: '#8b5cf6', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    ⊕ Merge {selectedScopeIds.size} items
                  </button>
                )}
                {selectedScopeIds.size > 0 && (
                  <button onClick={() => setSelectedScopeIds(new Set())}
                    style={{ padding: '7px 10px', borderRadius: 99, background: 'transparent', color: '#6b7280', border: '1px solid #e5e7eb', fontSize: 12, cursor: 'pointer' }}>
                    Clear
                  </button>
                )}
                <button onClick={() => setScopeModal('new')}
                  style={{ padding: '7px 14px', borderRadius: 99, background: '#3b82f6', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  + Add Item
                </button>
                {/* Drawing type selector */}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {[
                    { key: 'general', label: '🏗️ General' },
                    { key: 'electrical', label: '⚡ Electrical' },
                    { key: 'plumbing', label: '🔧 Plumbing' },
                    { key: 'structural', label: '🏛️ Structural' },
                  ].map(t => (
                    <button key={t.key} onClick={() => setDrawingType(t.key)}
                      style={{ padding: '5px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: drawingType === t.key ? '#7c3aed' : '#d1d5db', background: drawingType === t.key ? '#f5f3ff' : '#fff', color: drawingType === t.key ? '#7c3aed' : '#6b7280' }}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <button onClick={() => document.getElementById('drawing-upload-input').click()}
                  disabled={drawingExtracting || dualAIVerifying}
                  style={{ padding: '7px 14px', borderRadius: 99, background: '#7c3aed', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: (drawingExtracting || dualAIVerifying) ? 0.6 : 1 }}>
                  {dualAIVerifying ? '🔎 Claude checking...' : drawingExtracting ? '🔍 Nora\'s on it...' : '📐 Upload drawings'}
                </button>
                <label title="Claude independently checks GPT's extraction for mistakes and missing items" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: dualAIEnabled ? '#7c3aed' : '#6b7280', cursor: 'pointer', userSelect: 'none', padding: '4px 8px', borderRadius: 6, background: dualAIEnabled ? '#f5f3ff' : 'transparent', border: `1px solid ${dualAIEnabled ? '#c4b5fd' : 'transparent'}` }}>
                  <input type="checkbox" checked={dualAIEnabled} onChange={e => { setDualAIEnabled(e.target.checked); localStorage.setItem('nora_dual_ai', e.target.checked); }} style={{ cursor: 'pointer' }} />
                  {dualAIEnabled ? '🔎 Dual AI on' : 'Dual AI verify'}
                </label>
                <input id="drawing-upload-input" type="file" multiple
                  accept=".pdf,.jpg,.jpeg,.png,.docx,.doc,.txt"
                  style={{ display: 'none' }}
                  onChange={async e => {
                    const files = Array.from(e.target.files);
                    if (!files.length) return;
                    setDrawingExtracting(true);
                    setDrawingError('');
                    try {
                      // Process all files and merge results
                      const allItems = [];
                      const allExtractedFiles = [];
                      const allExtractedRoomNames = new Set();
                      for (const file of files) {
                        const formData = new FormData();
                        formData.append('file', file);
                        formData.append('drawing_type', drawingType);
                        const res = await fetch('/api/extract-doc', { method: 'POST', body: formData });
                        const json = await res.json();
                        if (json.extracted?.scope_items?.length) {
                          allItems.push(...json.extracted.scope_items);
                          // If dual AI enabled, store file for verification
                          if (dualAIEnabled) {
                            allExtractedFiles.push({ file, items: json.extracted.scope_items, extracted: json.extracted });
                          }
                        }
                        if (json.extracted?.rooms?.length) {
                          json.extracted.rooms.forEach(r => { if (r && String(r).trim()) allExtractedRoomNames.add(String(r).trim()); });
                        }
                      }
                      if (allItems.length === 0) {
                        setDrawingError('No scope items found in the uploaded files.');
                        return;
                      }

                      // Auto-create rooms from drawing extraction — skip any that already exist (case-insensitive match)
                      const existingRoomNames = new Set(rooms.map(r => (r.name || '').trim().toLowerCase()));
                      const roomsToCreate = [...allExtractedRoomNames].filter(name => !existingRoomNames.has(name.toLowerCase()));
                      const createdRooms = [];
                      for (let i = 0; i < roomsToCreate.length; i++) {
                        const { data: newRoom } = await sb.from('project_rooms').insert([{
                          project_id: project.id,
                          name: roomsToCreate[i].toUpperCase(),
                          position: rooms.length + i,
                        }]).select('*').single();
                        if (newRoom) createdRooms.push(newRoom);
                      }
                      if (createdRooms.length) setRooms(prev => [...prev, ...createdRooms]);
                      // Combined room lookup — existing + newly created, name (lowercase) -> id
                      const roomLookup = {};
                      [...rooms, ...createdRooms].forEach(r => { roomLookup[(r.name || '').trim().toLowerCase()] = r.id; });

                      // Try to match each scope item to a single room if its description clearly indicates one room only
                      const matchRoomIdForItem = (item) => {
                        const text = `${item.title || ''} ${item.description || ''}`.toLowerCase();
                        const matches = Object.keys(roomLookup).filter(name => name && text.includes(name));
                        return matches.length === 1 ? roomLookup[matches[0]] : null;
                      };

                      // Parse per-room quantity breakdown from description text, e.g.
                      // "Kitchen 3, Living 4, Bedroom 1 2" -> [{room:'kitchen',qty:3},{room:'living',qty:4},{room:'bedroom 1',qty:2}]
                      // Matches "RoomName <number>" pairs, comma or semicolon separated, room names matched against known rooms (longest name first).
                      const parseRoomBreakdown = (item) => {
                        const text = item.description || '';
                        if (!text) return [];
                        const roomNames = Object.keys(roomLookup).filter(Boolean).sort((a, b) => b.length - a.length);
                        if (!roomNames.length) return [];
                        const results = [];
                        // Split on commas/semicolons, then match "<room name> <qty>" within each segment
                        const segments = text.split(/[,;]/).map(s => s.trim()).filter(Boolean);
                        for (const seg of segments) {
                          const lower = seg.toLowerCase();
                          const matchedRoom = roomNames.find(name => lower.includes(name));
                          if (!matchedRoom) continue;
                          const numMatch = seg.match(/(\d+)\s*$/) || seg.match(/(\d+)/);
                          if (!numMatch) continue;
                          const qty = parseInt(numMatch[1], 10);
                          if (!qty || qty <= 0) continue;
                          results.push({ room_id: roomLookup[matchedRoom], quantity: qty });
                        }
                        return results;
                      };

                      // Dual AI verification — send to Claude to check GPT's work
                      if (dualAIEnabled && allExtractedFiles.length > 0) {
                        setDrawingExtracting(false);
                        setDualAIVerifying(true);
                        try {
                          const firstFile = allExtractedFiles[0];
                          const verifyFormData = new FormData();
                          verifyFormData.append('file', firstFile.file);
                          verifyFormData.append('gpt_extraction', JSON.stringify(firstFile.extracted));
                          verifyFormData.append('drawing_type', drawingType);
                          const verifyRes = await fetch('/api/verify-extraction', { method: 'POST', body: verifyFormData });
                          const verifyJson = await verifyRes.json();
                          setDualAIVerifying(false);
                          if (verifyJson.diff && (verifyJson.diff.corrections?.length > 0 || verifyJson.diff.additions?.length > 0)) {
                            // Show review overlay
                            setDualAIReview({ diff: verifyJson.diff, gptItems: allItems });
                            e.target.value = '';
                            return;
                          }
                          // No issues — fall through to save normally
                        } catch (err) {
                          console.warn('[dual-ai] verification failed, proceeding with GPT only:', err);
                          setDualAIVerifying(false);
                        }
                      }

                      // Save all items to scope_items table
                      const saved = [];
                      const roomLinksToInsert = [];
                      for (let i = 0; i < allItems.length; i++) {
                        const item = allItems[i];
                        const breakdown = parseRoomBreakdown(item);
                        const { data: newItem } = await sb.from('scope_items').insert([{
                          project_id: project.id,
                          title: item.title,
                          description: item.description || null,
                          trade: item.trade || null,
                          position: (scopeItems.length) + i,
                          extracted_by_ai: true,
                          markup_type: 'none',
                          client_charge: 0,
                          cost: null,
                          room_id: breakdown.length ? null : matchRoomIdForItem(item),
                        }]).select('*').single();
                        if (newItem) {
                          saved.push(newItem);
                          breakdown.forEach(b => roomLinksToInsert.push({ scope_item_id: newItem.id, room_id: b.room_id, quantity: b.quantity }));
                        }
                      }
                      if (roomLinksToInsert.length) {
                        await sb.from('scope_item_rooms').insert(roomLinksToInsert);
                      }
                      setScopeItems(prev => [...prev, ...saved]);
                      setDrawingError('');
                      // Reset input
                      e.target.value = '';
                    } catch (err) {
                      setDrawingError('Extraction failed: ' + err.message);
                    } finally {
                      setDrawingExtracting(false);
                    }
                  }} />
              </div>
            </div>

            {scopeLoading && <div style={{ color: '#6b7280', fontSize: 13, padding: 16 }}>Loading scope...</div>}
            {drawingError && (
              <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, marginBottom: 10, fontSize: 12, color: '#dc2626' }}>
                {drawingError}
              </div>
            )}
            {dualAIReview && (
              <DualAIReviewOverlay
                diff={dualAIReview.diff}
                gptItems={dualAIReview.gptItems}
                onClose={() => setDualAIReview(null)}
                onFinalise={async (finalItems) => {
                  const saved = [];
                  for (let i = 0; i < finalItems.length; i++) {
                    const item = finalItems[i];
                    const { data: newItem } = await sb.from('scope_items').insert([{
                      project_id: project.id,
                      title: item.title,
                      description: item.description || null,
                      trade: item.trade || null,
                      position: (scopeItems.length) + i,
                      extracted_by_ai: true,
                      markup_type: 'none',
                      client_charge: 0,
                      cost: null,
                    }]).select('*').single();
                    if (newItem) saved.push(newItem);
                  }
                  setScopeItems(prev => [...prev, ...saved]);
                  setDualAIReview(null);
                }}
              />
            )}
            {drawingExtracting && (
              <div style={{ padding: '12px 16px', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 10, marginBottom: 10, fontSize: 13, color: '#7c3aed', fontWeight: 600 }}>
                🔍 Nora's squinting at your drawings, counting every socket like her life depends on it... (15-30 seconds)
              </div>
            )}

            {!scopeLoading && scopeItems.length === 0 && (
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 24, color: '#6b7280', fontSize: 13, fontStyle: 'italic', textAlign: 'center' }}>
                <div style={{ fontSize: 16, marginBottom: 8 }}>📋</div>
                No scope items yet. Add items manually or create a new project with document upload to extract them automatically.
              </div>
            )}

            {scopeItems.length > 0 && (
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden', marginBottom: 14 }}>
                {/* Header */}
                <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 90px 90px 90px 70px', gap: 8, padding: '10px 16px', background: '#f8f9fa', borderBottom: '1px solid #e5e7eb' }}>
                  {['', 'Item', 'Sub cost', 'Markup', 'Charge', ''].map((h, i) => (
                    <div key={i} style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</div>
                  ))}
                </div>

                {scopeItems.map((item, i) => {
                  const cost = parseFloat(item.cost || 0);
                  const markupVal = parseFloat(item.markup_value || 0);
                  const charge = item.markup_type === 'percentage'
                    ? cost + (cost * markupVal / 100)
                    : item.markup_type === 'fixed'
                    ? cost + markupVal
                    : parseFloat(item.client_charge || 0);

                  return (
                    <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 90px 90px 90px 70px', gap: 8, padding: '12px 16px', borderBottom: i < scopeItems.length - 1 ? '1px solid #e5e7eb' : 'none', alignItems: 'center',
                      background: selectedScopeIds.has(item.id) ? '#f5f3ff' : item.extracted_by_ai ? '#eff6ff' : 'transparent' }}>
                      <input type="checkbox" checked={selectedScopeIds.has(item.id)}
                        onChange={e => setSelectedScopeIds(prev => { const n = new Set(prev); e.target.checked ? n.add(item.id) : n.delete(item.id); return n; })}
                        style={{ width: 16, height: 16, cursor: 'pointer' }} />
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{item.title}</span>
                          {item.extracted_by_ai
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontSize: 9, background: '#dbeafe', color: '#1d4ed8', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>AI IMPORTED</span>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  await sb.from('scope_items').update({ extracted_by_ai: false }).eq('id', item.id);
                                  setScopeItems(prev => prev.map(s => s.id === item.id ? { ...s, extracted_by_ai: false } : s));
                                }}
                                style={{ fontSize: 9, background: '#dcfce7', color: '#166534', padding: '1px 5px', borderRadius: 4, fontWeight: 700, border: 'none', cursor: 'pointer' }}
                              >✓ Approve</button>
                            </span>
                          : (!item.cost && !item.client_charge && <span style={{ fontSize: 9, background: '#fef3c7', color: '#d97706', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>NEEDS PRICING</span>)
                          }
                        </div>
                        {item.description && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{item.description}</div>}
                        {item.trade && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{item.trade}</div>}
                        {item.in_house && <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 1 }}>🔨 In-house</div>}
                        {!item.in_house && item.subcontractor_name && <div style={{ fontSize: 11, color: '#3b82f6', marginTop: 1 }}>👤 {item.subcontractor_name}</div>}
                      </div>
                      <div style={{ fontSize: 12, color: '#374151' }}>{cost > 0 ? fmt(cost) : '—'}</div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        {item.markup_type === 'percentage' ? `${markupVal}%` : item.markup_type === 'fixed' ? fmt(markupVal) : '--'}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: charge > 0 ? '#16a34a' : '#9ca3af' }}>
                        {charge > 0 ? fmt(charge) : '—'}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setScopeModal(item)} style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
                        <button onClick={async () => {
                          if (!window.confirm('Delete this scope item?')) return;
                          await sb.from('scope_items').delete().eq('id', item.id);
                          setScopeItems(prev => prev.filter(s => s.id !== item.id));
                        }} style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>Del</button>
                      </div>
                    </div>
                  );
                })}

                {/* Totals */}
                {(() => {
                  const totalCost = scopeItems.reduce((s, item) => s + parseFloat(item.cost || 0), 0);
                  const totalCharge = scopeItems.reduce((s, item) => {
                    const cost = parseFloat(item.cost || 0);
                    const markup = parseFloat(item.markup_value || 0);
                    return s + (item.markup_type === 'percentage' ? cost + (cost * markup / 100) : item.markup_type === 'fixed' ? cost + markup : parseFloat(item.client_charge || 0));
                  }, 0);
                  const margin = totalCharge - totalCost;
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 90px 90px 90px 70px', gap: 8, padding: '12px 16px', background: '#f8f9fa', borderTop: '2px solid #e5e7eb' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>Total</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>{fmt(totalCost)}</div>
                      <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>Margin: {fmt(margin)}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#16a34a' }}>{fmt(totalCharge)}</div>
                      <div />
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Generate quote button */}
            {scopeItems.length > 0 && (
              <div style={{ background: '#1e3a5f', borderRadius: 14, padding: '16px 20px' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Ready to generate a quote?</div>
                <div style={{ fontSize: 12, color: '#93c5fd', marginBottom: 12 }}>Price all items first, then generate your quote or tender document.</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['quote', 'tender'].map(type => (
                    <button key={type} type="button"
                      onClick={async () => {
                        const unpricedCount = scopeItems.filter(s => !s.cost && !s.client_charge).length;
                        if (unpricedCount > 0) {
                          if (!window.confirm(`${unpricedCount} item${unpricedCount !== 1 ? 's' : ''} still need pricing. Generate anyway?`)) return;
                        }
                        await sb.from('projects').update({ quote_type: type, quote_status: 'draft' }).eq('id', project.id);
                        alert(`✅ ${type === 'tender' ? 'Tender package' : 'Quote'} saved as draft. Document generation will be available when the quoting platform is connected.`);
                      }}
                      style={{ flex: 1, padding: '10px', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 13,
                        background: type === 'tender' ? 'transparent' : '#3b82f6',
                        color: '#fff',
                        border: type === 'tender' ? '2px solid #93c5fd' : 'none' }}>
                      {type === 'quote' ? '📄 Generate Quote' : '📦 Generate Tender Pack'}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
                        {task.task_value > 0 && <div style={{ fontSize: 11, color: '#16a34a', marginTop: 2 }}>£{Number(task.task_value).toLocaleString()}</div>}
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

      {/* Detach item modal */}
      {detachModal && (
        <DetachModal
          item={detachModal}
          projectId={project.id}
          rooms={rooms}
          onSave={(createdItems, deletedId) => {
            setScopeItems(prev => {
              const withoutDeleted = deletedId ? prev.filter(s => s.id !== deletedId) : prev;
              return [...withoutDeleted, ...createdItems].sort((a, b) => (a.position || 0) - (b.position || 0));
            });
            setSelectedScopeIds(new Set());
            setDetachModal(null);
          }}
          onClose={() => setDetachModal(null)}
        />
      )}

      {/* Scope item modal */}
      {scopeModal && (
        <ScopeModal
          item={scopeModal}
          projectId={project.id}
          rooms={rooms}
          onSave={(result, isNew) => {
            setScopeItems(prev => isNew ? [...prev, result] : prev.map(s => s.id === result.id ? result : s));
            setScopeModal(null);
          }}
          onClose={() => setScopeModal(null)}
        />
      )}

      {/* Payment stage modal */}
      {stageModal && (
        <StageModal
          stage={stageModal}
          projectId={project.id}
          onSave={(result, isNew) => {
            setStages(prev => isNew ? [...prev, result] : prev.map(s => s.id === result.id ? result : s));
            setStageModal(null);
          }}
          onClose={() => setStageModal(null)}
        />
      )}

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
