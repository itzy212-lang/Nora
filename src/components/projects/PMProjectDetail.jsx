// src/components/projects/PMProjectDetail.jsx
// Phase 1 — Construction / PM project detail page
// Cards: Overview, Subcontractors, Financials

import { useState, useEffect, useRef } from 'react';
import sb from '../../supabaseClient';
import DualAIReviewOverlay from '../shared/DualAIReviewOverlay';
import WeeklyMinutes from '../minutes/WeeklyMinutes';

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

  // Parse the item into per-room rows wherever possible. Two patterns handled:
  // 1) Room-count breakdown e.g. "Counted across all rooms: Kitchen 3, Living 4, Bedroom 1 2" —
  //    one row PER ROOM, title always stays the original item title, quantity is its own field.
  // 2) Generic multi-task description e.g. "Excavation, foundations and construction of flank wall" —
  //    one row per phrase, quantity defaults to 1.
  // 3) Fallback — single row representing the whole item as-is.
  const parseRows = () => {
    const text = item.description || '';

    const roomsSorted = [...rooms].filter(r => r.name).sort((a, b) => (b.name.length - a.name.length));
    if (roomsSorted.length) {
      let remaining = text;
      const roomMatches = [];
      for (const room of roomsSorted) {
        const escaped = room.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('(^|[,;:]\\s*)' + escaped + '\\s+(\\d+)', 'i');
        const m = remaining.match(re);
        if (m) {
          roomMatches.push({ title: item.title || '', room_id: room.id, quantity: m[2], cost: '', checked: false });
          remaining = remaining.replace(m[0], m[1] || '');
        }
      }
      if (roomMatches.length >= 2) {
        roomMatches.sort((a, b) => rooms.findIndex(r => r.id === a.room_id) - rooms.findIndex(r => r.id === b.room_id));
        return roomMatches;
      }
    }

    const parts = text.split(/,|;/).map(s => s.trim()).filter(s => s.split(/\s+/).length >= 2);
    if (parts.length >= 2 && parts.length <= 8) {
      return parts.map(p => ({ title: p.charAt(0).toUpperCase() + p.slice(1), room_id: '', quantity: '1', cost: '', checked: false }));
    }

    return [{ title: item.title || '', room_id: item.room_id || '', quantity: '1', cost: item.cost || '', checked: false }];
  };

  const [rowsState, setRowsState] = useState(parseRows());
  const [saving, setSaving] = useState(false);

  const updateRow = (i, field, val) => setRowsState(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  const addRow = () => setRowsState(prev => [...prev, { title: item.title || '', room_id: '', quantity: '1', cost: '', checked: true }]);
  const removeRow = (i) => setRowsState(prev => prev.filter((_, idx) => idx !== i));

  const checkedRows = rowsState.filter(r => r.checked && r.title.trim());
  const remainingRows = rowsState.filter(r => !r.checked);

  const handleSave = async () => {
    if (checkedRows.length < 1) return;
    setSaving(true);

    // Create new scope items for each checked (extracted) row
    const created = [];
    for (let i = 0; i < checkedRows.length; i++) {
      const r = checkedRows[i];
      const qty = r.quantity ? parseFloat(r.quantity) : 1;
      const unitCost = r.cost ? parseFloat(r.cost) : null;
      const { data } = await sb.from('scope_items').insert([{
        project_id: projectId,
        title: r.title.trim(),
        description: qty && qty !== 1 ? `Qty: ${qty}` : null,
        trade: item.trade || null,
        subcontractor_name: item.subcontractor_name || null,
        in_house: item.in_house || false,
        cost: unitCost !== null ? unitCost * qty : null,
        markup_type: 'none',
        client_charge: unitCost !== null ? unitCost * qty : 0,
        room_id: (r.room_id && r.room_id !== '__external__') ? r.room_id : null,
        position: (item.position || 0) + i + 1,
        extracted_by_ai: item.extracted_by_ai || false,
      }]).select('*').single();
      if (data) created.push(data);
    }

    // Update or delete the original item to reflect what's left after extraction
    let updatedOriginal = null;
    if (remainingRows.length === 0) {
      // Nothing left — original fully extracted, delete it
      await sb.from('scope_items').delete().eq('id', item.id);
    } else if (remainingRows.length === 1 && !rooms.find(r => r.id === remainingRows[0].room_id)) {
      // Single remaining row with no specific room — just keep original mostly as-is
      updatedOriginal = item;
    } else {
      // Rebuild the description from what's left (room breakdown format), keep item as the "remainder"
      const roomLookup = {};
      rooms.forEach(r => { roomLookup[r.id] = r.name; });
      const remainingDesc = remainingRows
        .map(r => `${roomLookup[r.room_id] || 'Unallocated'} ${r.quantity || 1}`)
        .join(', ');
      const { data } = await sb.from('scope_items')
        .update({ description: `Counted across remaining rooms: ${remainingDesc}` })
        .eq('id', item.id)
        .select('*')
        .single();
      updatedOriginal = data;
    }

    onSave(created, updatedOriginal);
    setSaving(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 4 }}>Detach item</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
          Tick the rooms you want to pull out as their own separate scope items. Anything left unticked stays on the original "{item.title}" item — nothing is lost.
        </div>

        {rowsState.map((row, i) => (
          <div key={i} style={{ border: '1px solid ' + (row.checked ? '#f59e0b' : '#e5e7eb'), background: row.checked ? '#fffbeb' : '#fff', borderRadius: 10, padding: 12, marginBottom: 10, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <input type="checkbox" checked={row.checked} onChange={e => updateRow(i, 'checked', e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
              <div style={{ flex: 1 }}>
                <div style={labelStyle}>Item {i + 1} title</div>
                <input value={row.title} onChange={e => updateRow(i, 'title', e.target.value)} placeholder="e.g. Double switched socket outlet" style={inputStyle} />
              </div>
              {rowsState.length > 1 && (
                <button onClick={() => removeRow(i)} style={{ background: 'transparent', border: 'none', color: '#ef4444', fontSize: 14, cursor: 'pointer', alignSelf: 'flex-start', marginTop: 18 }}>✕</button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.7fr 1fr', gap: 10 }}>
              <div>
                <div style={labelStyle}>Room</div>
                <select value={row.room_id} onChange={e => updateRow(i, 'room_id', e.target.value)} style={inputStyle}>
                  <option value="">Select room</option>
                  <option value="__external__">External</option>
                  {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <div style={labelStyle}>Qty</div>
                <input type="number" value={row.quantity} onChange={e => updateRow(i, 'quantity', e.target.value)} placeholder="1" style={inputStyle} />
              </div>
              <div>
                <div style={labelStyle}>Unit price (optional)</div>
                <input type="number" value={row.cost} onChange={e => updateRow(i, 'cost', e.target.value)} placeholder="£" style={inputStyle} />
              </div>
            </div>
          </div>
        ))}

        <button onClick={addRow} style={{ padding: '7px 14px', borderRadius: 99, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 16 }}>
          + Add another item
        </button>

        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16, padding: '10px 12px', background: '#f9fafb', borderRadius: 8 }}>
          {checkedRows.length === 0
            ? 'Tick at least one row to extract it as a new item.'
            : `${checkedRows.length} item${checkedRows.length > 1 ? 's' : ''} will be created. ${remainingRows.length} room${remainingRows.length !== 1 ? 's' : ''} will remain on the original "${item.title}" item.`}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 10, background: '#f3f4f6', color: '#374151', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || checkedRows.length === 0} style={{ padding: '9px 18px', borderRadius: 10, background: '#f59e0b', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: (saving || checkedRows.length === 0) ? 0.6 : 1 }}>
            {saving ? 'Extracting...' : `Extract ${checkedRows.length} item${checkedRows.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function DocumentsTab({ project, subs, card }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadFiles = () => {
    if (!project.onedrive_folder_id) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    fetch('/api/onedrive-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: 'help@sq1consulting.co.uk',
        action: 'get_folder_contents',
        project_folder_id: project.onedrive_folder_id,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setFiles((data.items || []).filter(i => !!i.file)); // files only, not subfolders
        } else {
          setError(data.error || 'Could not load OneDrive files');
        }
        setLoading(false);
      })
      .catch(() => { setError('Could not load OneDrive files'); setLoading(false); });
  };

  useEffect(() => { loadFiles(); }, [project.id, project.onedrive_folder_id]);

  if (!project.onedrive_folder_id) {
    return (
      <div style={{ ...card(), color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
        No OneDrive folder linked to this project yet.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Documents</div>
        <button onClick={loadFiles} style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer' }}>Refresh</button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>Files uploaded to this project's OneDrive folder. Tick who should see each one on the portal.</div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text3)' }}>Loading...</div>
      ) : error ? (
        <div style={{ ...card(), color: '#ef4444', fontSize: 13 }}>{error}</div>
      ) : files.length === 0 ? (
        <div style={{ ...card(), color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>No files in the OneDrive folder yet. Add files there and hit Refresh.</div>
      ) : (
        files.map(file => <DocumentCard key={file.id} doc={file} project={project} subs={subs} card={card} />)
      )}
    </div>
  );
}

function DocumentCard({ doc, project, subs, card }) {
  const [visOpen, setVisOpen] = useState(false);
  const [visClient, setVisClient] = useState(false);
  const [visSubIds, setVisSubIds] = useState([]);
  const [checkingVis, setCheckingVis] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadVisibility = async () => {
    setCheckingVis(true);
    const { data } = await sb.from('portal_visibility').select('*').eq('project_id', project.id).eq('item_type', 'document').eq('item_id', doc.id);
    setVisClient(!!(data || []).find(v => v.visible_to_type === 'client'));
    setVisSubIds((data || []).filter(v => v.visible_to_type === 'subcontractor').map(v => v.visible_to_subcontractor_id));
    setCheckingVis(false);
  };

  const openPanel = () => {
    setVisOpen(v => !v);
    if (!visOpen) loadVisibility();
  };

  const toggleClient = async (checked) => {
    setVisClient(checked);
    setSaving(true);
    if (checked) {
      await sb.from('portal_visibility').insert([{ project_id: project.id, item_type: 'document', item_id: doc.id, visible_to_type: 'client', item_name: doc.name, item_url: doc.webUrl }]);
    } else {
      await sb.from('portal_visibility').delete().eq('project_id', project.id).eq('item_type', 'document').eq('item_id', doc.id).eq('visible_to_type', 'client');
    }
    setSaving(false);
  };

  const toggleSub = async (subId, checked) => {
    setVisSubIds(prev => checked ? [...prev, subId] : prev.filter(id => id !== subId));
    setSaving(true);
    if (checked) {
      await sb.from('portal_visibility').insert([{ project_id: project.id, item_type: 'document', item_id: doc.id, visible_to_type: 'subcontractor', visible_to_subcontractor_id: subId, item_name: doc.name, item_url: doc.webUrl }]);
    } else {
      await sb.from('portal_visibility').delete().eq('project_id', project.id).eq('item_type', 'document').eq('item_id', doc.id).eq('visible_to_type', 'subcontractor').eq('visible_to_subcontractor_id', subId);
    }
    setSaving(false);
  };

  const isVisible = visClient || visSubIds.length > 0;

  return (
    <div style={card()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <a href={doc.webUrl} target="_blank" rel="noreferrer" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}>
          📄 {doc.name}
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isVisible && <span style={{ fontSize: 10, fontWeight: 700, color: '#1e40af', background: '#eff6ff', padding: '2px 8px', borderRadius: 6 }}>On portal</span>}
          <button onClick={openPanel} style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer' }}>Share</button>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
        {doc.lastModifiedDateTime ? new Date(doc.lastModifiedDateTime).toLocaleDateString('en-GB') : ''}
        {doc.size ? ` · ${(doc.size / 1024).toFixed(0)} KB` : ''}
      </div>

      {visOpen && (
        <div style={{ marginTop: 10, padding: 10, background: 'rgba(59,130,246,0.06)', borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Show on portal to:</div>
          {checkingVis ? (
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Loading...</div>
          ) : (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={visClient} disabled={saving} onChange={e => toggleClient(e.target.checked)} />
                <span style={{ fontSize: 12, color: 'var(--text)' }}>Client</span>
              </label>
              {subs.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 4 }}>Subcontractors</div>
                  {subs.map(s => (
                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, cursor: 'pointer' }}>
                      <input type="checkbox" checked={visSubIds.includes(s.id)} disabled={saving} onChange={e => toggleSub(s.id, e.target.checked)} />
                      <span style={{ fontSize: 12, color: 'var(--text)' }}>{s.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SnaggingTab({ project, rooms, subs, card }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newRoomId, setNewRoomId] = useState('');
  const [newAssignSubId, setNewAssignSubId] = useState('');
  const [newAssignFree, setNewAssignFree] = useState('');
  const [saving, setSaving] = useState(false);
  const [workCardSubId, setWorkCardSubId] = useState('');
  const [selectedForCard, setSelectedForCard] = useState(new Set());

  const loadItems = () => {
    setLoading(true);
    fetch('/api/generate-minutes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list_snagging', project_id: project.id }),
    }).then(r => r.json()).then(j => { setItems(j.items || []); setLoading(false); });
  };

  useEffect(() => { loadItems(); }, [project.id]);

  const addItem = async () => {
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/generate-minutes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_snagging', project_id: project.id,
          title: newTitle.trim(), description: newDesc.trim(),
          room_id: newRoomId || null,
          assigned_subcontractor_id: newAssignSubId || null,
          assigned_to: newAssignSubId ? (subs.find(s => s.id === newAssignSubId)?.name || null) : (newAssignFree.trim() || null),
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setItems(prev => [...prev, json.item]);
        setAddOpen(false);
        setNewTitle(''); setNewDesc(''); setNewRoomId(''); setNewAssignSubId(''); setNewAssignFree('');
      } else {
        alert(json.error || 'Could not add item.');
      }
    } catch (err) {
      alert('Could not add item.');
    }
    setSaving(false);
  };

  const markDone = async (item) => {
    const res = await fetch('/api/generate-minutes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark_snagging_done', item_id: item.id, marked_done_by: 'manual' }),
    });
    const json = await res.json();
    if (res.ok) setItems(prev => prev.map(i => i.id === item.id ? json.item : i));
  };

  const unmarkDone = async (item) => {
    const res = await fetch('/api/generate-minutes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unmark_snagging_done', item_id: item.id }),
    });
    const json = await res.json();
    if (res.ok) setItems(prev => prev.map(i => i.id === item.id ? json.item : i));
  };

  const confirmDone = async (item) => {
    const res = await fetch('/api/generate-minutes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm_snagging', item_id: item.id, confirmed_by: 'manual' }),
    });
    const json = await res.json();
    if (res.ok) setItems(prev => prev.map(i => i.id === item.id ? json.item : i));
  };

  const openItems = items.filter(i => i.status === 'open');
  const groups = {};
  openItems.forEach(i => {
    const roomName = i.project_rooms?.name || 'General';
    if (!groups[roomName]) groups[roomName] = [];
    groups[roomName].push(i);
  });
  const roomNames = Object.keys(groups).sort((a, b) => a === 'General' ? 1 : b === 'General' ? -1 : a.localeCompare(b));

  const subItemsForCard = workCardSubId ? openItems.filter(i => i.assigned_subcontractor_id === workCardSubId) : [];

  const generateWorkCard = () => {
    const sub = subs.find(s => s.id === workCardSubId);
    const chosen = openItems.filter(i => selectedForCard.has(i.id));
    if (!chosen.length) { alert('Select at least one item.'); return; }
    const lines = chosen.map(i => `${i.project_rooms?.name ? `[${i.project_rooms.name}] ` : ''}${i.title}${i.description ? ` — ${i.description}` : ''}`);
    const text = `SNAGGING WORK CARD\n${project.bo_premise_address || project.bo_address || ''}\nFor: ${sub?.name || 'Unassigned'}\n\n${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Snagging Work Card - ${sub?.name || 'Unassigned'}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Snagging</div>
        <button onClick={() => setAddOpen(v => !v)}
          style={{ padding: '7px 16px', borderRadius: 99, background: 'var(--blue)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          {addOpen ? 'Cancel' : '+ Add Snag'}
        </button>
      </div>

      {addOpen && (
        <div style={card()}>
          <div style={label}>Title</div>
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="e.g. Door architrave needs finishing"
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, marginBottom: 10, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' }} />
          <div style={label}>Details (optional)</div>
          <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} rows={2}
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, marginBottom: 10, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical' }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <div style={label}>Room</div>
              <select value={newRoomId} onChange={e => setNewRoomId(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }}>
                <option value="">No specific room</option>
                {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <div style={label}>Assign to subcontractor</div>
              <select value={newAssignSubId} onChange={e => setNewAssignSubId(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }}>
                <option value="">Not linked to a saved sub</option>
                {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          {!newAssignSubId && (
            <>
              <div style={label}>Or free text (e.g. tradesperson name)</div>
              <input value={newAssignFree} onChange={e => setNewAssignFree(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, marginBottom: 10, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' }} />
            </>
          )}
          <button onClick={addItem} disabled={saving || !newTitle.trim()}
            style={{ width: '100%', padding: 10, borderRadius: 8, background: '#1F2937', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: (saving || !newTitle.trim()) ? 0.5 : 1 }}>
            {saving ? 'Adding...' : 'Add to snagging list'}
          </button>
        </div>
      )}

      {subs.length > 0 && openItems.length > 0 && (
        <div style={{ ...card(), background: 'rgba(59,130,246,0.06)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Generate work card</div>
          <select value={workCardSubId} onChange={e => { setWorkCardSubId(e.target.value); setSelectedForCard(new Set()); }}
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, marginBottom: 8, background: 'var(--bg)', color: 'var(--text)' }}>
            <option value="">Select subcontractor...</option>
            {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {workCardSubId && (
            <>
              {subItemsForCard.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>No open snags assigned to this subcontractor.</div>
              ) : (
                <>
                  {subItemsForCard.map(i => (
                    <label key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, cursor: 'pointer' }}>
                      <input type="checkbox" checked={selectedForCard.has(i.id)}
                        onChange={e => setSelectedForCard(prev => { const next = new Set(prev); e.target.checked ? next.add(i.id) : next.delete(i.id); return next; })} />
                      <span style={{ fontSize: 12, color: 'var(--text)' }}>{i.project_rooms?.name ? `[${i.project_rooms.name}] ` : ''}{i.title}</span>
                    </label>
                  ))}
                  <button onClick={generateWorkCard}
                    style={{ marginTop: 8, width: '100%', padding: 8, borderRadius: 8, background: '#1F2937', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Generate work card
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text3)' }}>Loading...</div>
      ) : roomNames.length === 0 ? (
        <div style={{ ...card(), color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>No open snags. Everything's clean.</div>
      ) : (
        roomNames.map(roomName => (
          <div key={roomName} style={{ marginBottom: 20 }}>
            <div style={{ background: '#1F2937', color: '#fff', fontWeight: 700, fontSize: 13, padding: '8px 12px', borderRadius: 6, marginBottom: 8 }}>
              {roomName}
            </div>
            {groups[roomName].map(item => {
              const isMarkedDone = !!item.marked_done_at;
              return (
                <div key={item.id} style={{ ...card(), opacity: isMarkedDone ? 0.7 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <button onClick={() => isMarkedDone ? unmarkDone(item) : markDone(item)}
                      style={{ width: 20, height: 20, borderRadius: 6, border: '2px solid #d1d5db', background: isMarkedDone ? '#1F2937' : '#fff', cursor: 'pointer', flexShrink: 0, marginTop: 1, color: '#fff', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {isMarkedDone ? '✓' : ''}
                    </button>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', textDecoration: isMarkedDone ? 'line-through' : 'none' }}>{item.title}</div>
                      {item.description && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2, textDecoration: isMarkedDone ? 'line-through' : 'none' }}>{item.description}</div>}
                      {item.assigned_to && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Assigned: {item.assigned_to}</div>}
                    </div>
                    {isMarkedDone && (
                      <button onClick={() => confirmDone(item)}
                        style={{ padding: '5px 12px', borderRadius: 8, background: '#10b981', color: '#fff', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
                        Confirm
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}

function PortalTab({ project, subs, card }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [approvals, setApprovals] = useState([]);
  const [loadingApprovals, setLoadingApprovals] = useState(true);
  const [approvalFormOpen, setApprovalFormOpen] = useState(false);
  const [approvalType, setApprovalType] = useState('variation');
  const [approvalTitle, setApprovalTitle] = useState('');
  const [approvalDesc, setApprovalDesc] = useState('');
  const [approvalAmount, setApprovalAmount] = useState('');
  const [approvalTimeImpact, setApprovalTimeImpact] = useState('');
  const [sendingApproval, setSendingApproval] = useState(false);

  const loadUsers = () => {
    setLoading(true);
    fetch('/api/portal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list_users', project_id: project.id }),
    }).then(r => r.json()).then(j => { setUsers(j.users || []); setLoading(false); });
  };

  const loadApprovals = () => {
    setLoadingApprovals(true);
    fetch('/api/portal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list_approvals', project_id: project.id }),
    }).then(r => r.json()).then(j => { setApprovals(j.approvals || []); setLoadingApprovals(false); });
  };

  useEffect(() => { loadUsers(); loadApprovals(); }, [project.id]);

  const hasActiveClient = users.some(u => u.user_type === 'client' && u.invite_status === 'active');

  const sendApproval = async () => {
    if (!approvalTitle.trim()) return;
    setSendingApproval(true);
    try {
      const res = await fetch('/api/portal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_approval', project_id: project.id,
          approval_type: approvalType, title: approvalTitle.trim(), description: approvalDesc.trim() || null,
          client_facing_amount: approvalAmount || null, time_impact_days: approvalTimeImpact || null,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setApprovals(prev => [json.approval, ...prev]);
        setApprovalFormOpen(false);
        setApprovalTitle(''); setApprovalDesc(''); setApprovalAmount(''); setApprovalTimeImpact('');
      } else {
        alert(json.error || 'Could not send approval.');
      }
    } catch (err) {
      alert('Could not send approval.');
    }
    setSendingApproval(false);
  };

  const withdrawApproval = async (id) => {
    if (!window.confirm('Withdraw this approval request?')) return;
    await fetch('/api/portal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_approval', approval_id: id }),
    });
    setApprovals(prev => prev.filter(a => a.id !== id));
  };

  const revoke = async (portalUserId) => {
    if (!window.confirm('Revoke this user\'s portal access?')) return;
    await fetch('/api/portal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'revoke', portal_user_id: portalUserId }),
    });
    loadUsers();
  };

  const statusColour = { pending: '#d97706', active: '#059669', revoked: '#9ca3af' };
  const approvalStatusColour = { pending: '#d97706', accepted: '#059669', rejected: '#ef4444' };

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Portal Access</div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>Invite the client from Overview, or a subcontractor from their profile. This is a status overview of everyone with access.</div>

      {loading ? (
        <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading...</div>
      ) : users.length === 0 ? (
        <div style={{ ...card(), color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>No portal users invited yet.</div>
      ) : (
        users.map(u => (
          <div key={u.id} style={card()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{u.name || u.email}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{u.email} · {u.user_type}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: statusColour[u.invite_status], textTransform: 'capitalize' }}>{u.invite_status}</span>
                {u.invite_status !== 'revoked' && (
                  <button onClick={() => revoke(u.id)} style={{ fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>Revoke</button>
                )}
              </div>
            </div>
          </div>
        ))
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 28, marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Approvals</div>
        {hasActiveClient && (
          <button onClick={() => setApprovalFormOpen(v => !v)}
            style={{ padding: '6px 14px', borderRadius: 99, background: 'var(--blue)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            {approvalFormOpen ? 'Cancel' : '+ Send for approval'}
          </button>
        )}
      </div>
      {!hasActiveClient && (
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12, fontStyle: 'italic' }}>Invite an active client to the portal before sending approvals.</div>
      )}

      {approvalFormOpen && (
        <div style={card()}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Type</div>
          <select value={approvalType} onChange={e => setApprovalType(e.target.value)}
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, marginBottom: 12 }}>
            <option value="variation">Variation</option>
            <option value="request">Request</option>
            <option value="other">Other</option>
          </select>

          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Title</div>
          <input value={approvalTitle} onChange={e => setApprovalTitle(e.target.value)}
            placeholder="e.g. Additional works — rear extension foundations"
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, marginBottom: 12, boxSizing: 'border-box' }} />

          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Description</div>
          <textarea value={approvalDesc} onChange={e => setApprovalDesc(e.target.value)} rows={3}
            placeholder="Explain what this covers — the client will only see this description and the total price below, never a cost breakdown."
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, marginBottom: 12, boxSizing: 'border-box', resize: 'vertical' }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Total price (£)</div>
              <input type="number" value={approvalAmount} onChange={e => setApprovalAmount(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Time impact (days)</div>
              <input type="number" value={approvalTimeImpact} onChange={e => setApprovalTimeImpact(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          </div>

          <button onClick={sendApproval} disabled={sendingApproval || !approvalTitle.trim()}
            style={{ width: '100%', padding: 10, borderRadius: 8, background: '#1F2937', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: (sendingApproval || !approvalTitle.trim()) ? 0.5 : 1 }}>
            {sendingApproval ? 'Sending...' : 'Send to client portal'}
          </button>
        </div>
      )}

      {loadingApprovals ? (
        <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading...</div>
      ) : approvals.length === 0 ? (
        <div style={{ ...card(), color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>No approvals sent yet.</div>
      ) : (
        approvals.map(a => (
          <div key={a.id} style={card()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{a.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', marginTop: 2 }}>{a.approval_type}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {a.client_facing_amount != null && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>£{parseFloat(a.client_facing_amount).toFixed(2)}</span>}
                <span style={{ fontSize: 11, fontWeight: 700, color: approvalStatusColour[a.status], textTransform: 'capitalize' }}>{a.status}</span>
                {a.status === 'pending' && (
                  <button onClick={() => withdrawApproval(a.id)} style={{ fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>Withdraw</button>
                )}
              </div>
            </div>
            {a.portal_approval_comments?.length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                {a.portal_approval_comments.map(c => (
                  <div key={c.id} style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>
                    <strong>{c.is_account_owner ? 'You' : 'Client'}:</strong> {c.content}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function SubCard({ sub, projectId, card, label, fmt, setSubModal, handleDeleteSub }) {
  const balance = parseFloat(sub.contract_value || 0) - parseFloat(sub.amount_paid || 0);
  const [portalStatus, setPortalStatus] = useState(null);
  const [checked, setChecked] = useState(false);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    if (!sub.email || checked) return;
    fetch('/api/portal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list_users', project_id: projectId }),
    }).then(r => r.json()).then(j => {
      const match = (j.users || []).find(u => u.email === sub.email.toLowerCase().trim() && u.invite_status !== 'revoked');
      if (match) setPortalStatus(match.invite_status);
      setChecked(true);
    }).catch(() => setChecked(true));
  }, [sub.email, checked, projectId]);

  const sendInvite = async () => {
    if (!sub.email) return;
    setInviting(true);
    try {
      const res = await fetch('/api/portal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invite', project_id: projectId, email: sub.email, name: sub.name, user_type: 'subcontractor', subcontractor_id: sub.id }),
      });
      const json = await res.json();
      if (res.ok) {
        setPortalStatus('pending');
        if (json.email_sent) {
          alert(`Invite email sent to ${sub.email}.`);
        } else {
          window.prompt('Could not send the email automatically — copy this link to send manually:', json.invite_url);
        }
      } else {
        alert(json.error || 'Could not send invite.');
      }
    } catch (err) {
      alert('Could not send invite.');
    }
    setInviting(false);
  };

  return (
    <div style={card()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{sub.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{sub.trade}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {sub.email && (
            portalStatus ? (
              <span style={{ fontSize: 11, fontWeight: 700, color: portalStatus === 'active' ? '#059669' : '#d97706', textTransform: 'capitalize' }}>{portalStatus}</span>
            ) : (
              <button onClick={sendInvite} disabled={inviting} style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', opacity: inviting ? 0.5 : 1 }}>
                {inviting ? 'Sending...' : '📧 Portal Invite'}
              </button>
            )
          )}
          <button onClick={() => setSubModal(sub)} style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
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
}

function ContractorInput({ value, onChange, subs, inputStyle, placeholder }) {
  const [focused, setFocused] = useState(false);
  const matches = (subs || []).filter(s =>
    value && s.name && s.name.toLowerCase().includes(value.toLowerCase()) && s.name.toLowerCase() !== value.toLowerCase()
  ).slice(0, 6);

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={placeholder || 'Contractor name or company'}
        style={inputStyle}
      />
      {focused && matches.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, marginTop: 4, zIndex: 20, maxHeight: 180, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
          {matches.map(s => (
            <div
              key={s.id}
              onMouseDown={() => onChange(s.name)}
              style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{s.name}</div>
              {s.trade && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{s.trade}</div>}
            </div>
          ))}
        </div>
      )}
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
function MaterialModal({ material, projectId, rooms, subs, onSave, onClose }) {
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
              <ContractorInput
                value={form.contractor}
                onChange={v => set('contractor', v)}
                subs={subs}
                inputStyle={inputStyle}
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
          <div style={labelStyle}>Task value (£) — charged to client</div>
          <input type="number" value={form.task_value}
            onChange={e => set('task_value', e.target.value)}
            placeholder="Value of this task e.g. 2500"
            style={inputStyle} />
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Used for payment certification and payment schedule</div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Task cost (£) — what it costs you</div>
          <input type="number" value={form.task_cost}
            onChange={e => set('task_cost', e.target.value)}
            placeholder="Subcontractor/material cost e.g. 1800"
            style={inputStyle} />
          {form.task_value && form.task_cost && (
            <div style={{ fontSize: 11, color: '#16a34a', marginTop: 4, fontWeight: 600 }}>
              Margin: £{(parseFloat(form.task_value) - parseFloat(form.task_cost)).toLocaleString()}
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
function TaskModal({ task, projectId, allTasks, rooms, subs, onSave, onClose }) {
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
    task_cost: isNew ? '' : task.task_cost || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Portal visibility — does the current contractor text match a subcontractor with portal access?
  const matchedSub = (subs || []).find(s => s.name && form.contractor && s.name.toLowerCase().trim() === form.contractor.toLowerCase().trim());
  const [portalVisible, setPortalVisible] = useState(false);
  const [checkingVis, setCheckingVis] = useState(false);

  useEffect(() => {
    if (isNew || !task?.id) return;
    setCheckingVis(true);
    sb.from('portal_visibility').select('id').eq('project_id', projectId).eq('item_type', 'programme_task').eq('item_id', task.id).eq('visible_to_type', 'subcontractor')
      .then(({ data }) => { setPortalVisible(!!(data && data.length)); setCheckingVis(false); });
  }, [task?.id, projectId, isNew]);

  const togglePortalVisibility = async (checked) => {
    if (!task?.id || !matchedSub) return;
    setPortalVisible(checked);
    if (checked) {
      await sb.from('portal_visibility').insert([{
        project_id: projectId, item_type: 'programme_task', item_id: task.id,
        visible_to_type: 'subcontractor', visible_to_subcontractor_id: matchedSub.id,
      }]);
    } else {
      await sb.from('portal_visibility').delete().eq('project_id', projectId).eq('item_type', 'programme_task').eq('item_id', task.id).eq('visible_to_type', 'subcontractor');
    }
  };

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
        task_cost: form.task_cost ? parseFloat(form.task_cost) : null,
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
              <ContractorInput
                value={form.contractor}
                onChange={v => set('contractor', v)}
                subs={subs}
                inputStyle={inputStyle}
              />
            )}
            {form.in_house && (
              <div style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic', padding: '8px 0' }}>
                In-house — no contractor details needed
              </div>
            )}
          </div>
        )}

        {!isNew && !form.in_house && matchedSub && (
          <div style={{ marginBottom: 12, padding: 10, background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={portalVisible} disabled={checkingVis} onChange={e => togglePortalVisibility(e.target.checked)} style={{ width: 15, height: 15 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#1e40af' }}>Show on {matchedSub.name}'s portal</span>
            </label>
          </div>
        )}
        {!isNew && !form.in_house && form.contractor.trim() && !matchedSub && (
          <div style={{ marginBottom: 12, fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>
            "{form.contractor}" isn't a saved subcontractor with portal access, so this can't be shared to a portal yet.
          </div>
        )}
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Task value (£) — charged to client</div>
          <input type="number" value={form.task_value}
            onChange={e => set('task_value', e.target.value)}
            placeholder="Value of this task e.g. 2500"
            style={inputStyle} />
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Used for payment certification and payment schedule</div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Task cost (£) — what it costs you</div>
          <input type="number" value={form.task_cost}
            onChange={e => set('task_cost', e.target.value)}
            placeholder="Subcontractor/material cost e.g. 1800"
            style={inputStyle} />
          {form.task_value && form.task_cost && (
            <div style={{ fontSize: 11, color: '#16a34a', marginTop: 4, fontWeight: 600 }}>
              Margin: £{(parseFloat(form.task_value) - parseFloat(form.task_cost)).toLocaleString()}
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
function SubModal({ sub, projectId, onSave, onClose }) {
  const [form, setForm] = useState({
    name: sub?.name || '',
    trade: sub?.trade || '',
    email: sub?.email || '',
    contract_value: sub?.contract_value || '',
    amount_paid: sub?.amount_paid || '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [portalStatus, setPortalStatus] = useState(sub?.portal_status || null);

  const sendInvite = async () => {
    if (!form.email.trim()) { alert('Add an email address first.'); return; }
    setInviting(true);
    try {
      const res = await fetch('/api/portal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'invite', project_id: projectId, email: form.email.trim(), name: form.name.trim(),
          user_type: 'subcontractor', subcontractor_id: sub?.id || null,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setInviteResult(json.invite_url);
        setPortalStatus('pending');
      } else {
        alert(json.error || 'Could not send invite.');
      }
    } catch (err) {
      alert('Could not send invite.');
    }
    setInviting(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--bg)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>
          {sub ? 'Edit Subcontractor' : 'Add Subcontractor'}
        </div>
        {[
          { key: 'name', label: 'Name / Company' },
          { key: 'trade', label: 'Trade' },
          { key: 'email', label: 'Email (for portal invite)', type: 'email' },
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

        <div style={{ marginBottom: 12, padding: 12, background: 'rgba(59,130,246,0.06)', borderRadius: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Portal access</div>
            {portalStatus && <span style={{ fontSize: 11, fontWeight: 700, color: portalStatus === 'active' ? '#059669' : '#d97706', textTransform: 'capitalize' }}>{portalStatus}</span>}
          </div>
          {!portalStatus && !sub && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text3)' }}>Save this subcontractor first, then you can invite them to the portal.</div>
          )}
          {!portalStatus && sub && (
            <button onClick={sendInvite} disabled={inviting || !form.email.trim()}
              style={{ marginTop: 8, width: '100%', padding: 8, borderRadius: 8, background: '#1F2937', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: (inviting || !form.email.trim()) ? 0.5 : 1 }}>
              {inviting ? 'Sending...' : '📧 Portal Invite'}
            </button>
          )}
          {inviteResult && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#166534', wordBreak: 'break-all' }}>Invite link: {inviteResult}</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 99, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button
            onClick={() => onSave({
              ...form,
              contract_value: parseFloat(form.contract_value) || 0,
              amount_paid: parseFloat(form.amount_paid) || 0,
              id: sub?.id || `sub_${Date.now()}`,
            })}
            style={{ flex: 1, padding: '10px', borderRadius: 99, background: 'var(--blue)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
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
  const [quoteGenerating, setQuoteGenerating] = useState(false);
  const [tab, setTab] = useState('overview');
  const [subModal, setSubModal] = useState(null); // null | 'new' | {sub object}
  const [clientPortalStatus, setClientPortalStatus] = useState(null);
  const [clientInviting, setClientInviting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [projectTasks, setProjectTasks] = useState([]); // unified task system from Site Log, linked to programme via linked_programme_task_id
  const [taskPopup, setTaskPopup] = useState(null); // { x, y, tasks: [...] } — Gantt dependency arrow click
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

  // Load rooms — always guarantee the two hardcoded zones (Structure, External) exist
  useEffect(() => {
    if (!project?.id) return;
    (async () => {
      const { data } = await sb.from('project_rooms').select('*').eq('project_id', project.id).order('position');
      let rows = data || [];
      const hasStructure = rows.some(r => r.zone_type === 'structure');
      const hasExternal = rows.some(r => r.zone_type === 'external');
      const toCreate = [];
      if (!hasStructure) toCreate.push({ project_id: project.id, name: 'STRUCTURE', zone_type: 'structure', position: -2 });
      if (!hasExternal) toCreate.push({ project_id: project.id, name: 'EXTERNAL', zone_type: 'external', position: -1 });
      if (toCreate.length) {
        const { data: created } = await sb.from('project_rooms').insert(toCreate).select('*');
        if (created) rows = [...created, ...rows];
      }
      setRooms(rows);
    })();
  }, [project?.id]);

  // Load client portal invite status (if any exists for the client email)
  useEffect(() => {
    const clientEmail = project?.client_email || project?.bo_1_email;
    if (!clientEmail || !project?.id) return;
    fetch('/api/portal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list_users', project_id: project.id }),
    }).then(r => r.json()).then(j => {
      const match = (j.users || []).find(u => u.email === clientEmail.toLowerCase().trim() && u.user_type === 'client' && u.invite_status !== 'revoked');
      if (match) setClientPortalStatus(match.invite_status);
    }).catch(() => {});
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
    sb.from('project_tasks')
      .select('*')
      .eq('project_id', project.id)
      .eq('status', 'open')
      .not('linked_programme_task_id', 'is', null)
      .then(({ data }) => setProjectTasks(data || []));
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

  const TABS = ['overview', 'scope', 'rooms', 'programme', 'minutes', 'snagging', 'payments', 'materials', 'subcontractors', 'financials', 'emails', 'documents', 'portal'];
  const TAB_LABELS = { minutes: 'Site Log', snagging: 'Snagging', portal: 'Portal' };

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
                background: tab === t ? 'var(--blue)' : 'transparent',
                color: tab === t ? '#fff' : 'var(--text2)',
                border: tab === t ? 'none' : '1px solid var(--border)',
                fontWeight: tab === t ? 600 : 400,
              }}
            >
              {TAB_LABELS[t] || (t.charAt(0).toUpperCase() + t.slice(1))}
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
                  {(project.client_email || project.bo_1_email) && (
                    clientPortalStatus === 'active' || clientPortalStatus === 'pending' ? (
                      <span style={{ fontSize: 11, fontWeight: 700, color: clientPortalStatus === 'active' ? '#059669' : '#d97706', textTransform: 'capitalize' }}>
                        Portal: {clientPortalStatus}
                      </span>
                    ) : (
                      <button
                        onClick={async () => {
                          setClientInviting(true);
                          try {
                            const res = await fetch('/api/portal', {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                action: 'invite', project_id: project.id,
                                email: project.client_email || project.bo_1_email,
                                name: project.client_name || project.bo_1_name,
                                user_type: 'client',
                              }),
                            });
                            const json = await res.json();
                            if (res.ok) {
                              setClientPortalStatus('pending');
                              const clientEmail = project.client_email || project.bo_1_email;
                              if (json.email_sent) {
                                alert(`Invite email sent to ${clientEmail}.`);
                              } else {
                                window.prompt('Could not send the email automatically — copy this link to send manually:', json.invite_url);
                              }
                            } else {
                              alert(json.error || 'Could not send invite.');
                            }
                          } catch (err) {
                            alert('Could not send invite.');
                          }
                          setClientInviting(false);
                        }}
                        disabled={clientInviting}
                        style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 2 }}>
                        {clientInviting ? 'Sending...' : '📧 Portal Invite'}
                      </button>
                    )
                  )}
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{room.name}</div>
                            {room.zone_type === 'structure' && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: '#9a3412', background: '#ffedd5', padding: '2px 8px', borderRadius: 6 }}>STRUCTURAL</span>
                            )}
                            {room.zone_type === 'external' && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: '#065f46', background: '#d1fae5', padding: '2px 8px', borderRadius: 6 }}>EXTERNAL</span>
                            )}
                          </div>
                          {room.description && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{room.description}</div>}
                          <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                            <span style={{ fontSize: 11, color: '#6b7280' }}>📋 {roomTasks.length} task{roomTasks.length !== 1 ? 's' : ''}</span>
                            <span style={{ fontSize: 11, color: '#6b7280' }}>📦 {roomMaterials.length} material{roomMaterials.length !== 1 ? 's' : ''}</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => setRoomModal(room)} style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
                          {!room.zone_type || room.zone_type === 'room' ? (
                            <button onClick={async () => {
                              if (!window.confirm('Delete this room?')) return;
                              await sb.from('project_rooms').delete().eq('id', room.id);
                              setRooms(prev => prev.filter(r => r.id !== room.id));
                            }} style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>Delete</button>
                          ) : null}
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
                style={{ padding: '7px 16px', borderRadius: 99, background: 'var(--blue)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                + Add
              </button>
            </div>

            {subs.length === 0 ? (
              <div style={{ ...card(), color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
                No subcontractors yet. Add them to track costs and payments.
              </div>
            ) : (
              subs.map(sub => <SubCard key={sub.id} sub={sub} projectId={project.id} card={card} label={label} fmt={fmt} setSubModal={setSubModal} handleDeleteSub={handleDeleteSub} />)
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
                {project.quote_status !== 'accepted' && scopeItems.length > 0 && (
                  <button onClick={async () => {
                    const proceed = window.confirm(
                      `Accept quote and generate the programme?\n\n` +
                      `This will create ${scopeItems.length} programme task(s) from your scope items, carrying over room allocation and pricing. ` +
                      `You'll then just need to add dates. This can be done again later if you add more scope items.`
                    );
                    if (!proceed) return;

                    // Fetch per-room breakdowns for all scope items in one go
                    const { data: allBreakdowns } = await sb.from('scope_item_rooms').select('*').in('scope_item_id', scopeItems.map(s => s.id));
                    const breakdownsByItem = {};
                    (allBreakdowns || []).forEach(b => {
                      if (!breakdownsByItem[b.scope_item_id]) breakdownsByItem[b.scope_item_id] = [];
                      breakdownsByItem[b.scope_item_id].push(b);
                    });

                    const newTasks = [];
                    let position = tasks.length;
                    for (const item of scopeItems) {
                      const breakdown = breakdownsByItem[item.id] || [];
                      if (breakdown.length > 0) {
                        // Item spans multiple rooms — one programme task per room, value split proportionally by quantity
                        const totalQty = breakdown.reduce((s, b) => s + parseFloat(b.quantity || 0), 0) || 1;
                        for (const b of breakdown) {
                          const share = parseFloat(b.quantity || 0) / totalQty;
                          newTasks.push({
                            project_id: project.id,
                            title: item.title,
                            trade: item.trade || null,
                            room_id: b.room_id,
                            contractor: item.subcontractor_name || null,
                            in_house: item.in_house || false,
                            task_value: item.client_charge ? Math.round(item.client_charge * share * 100) / 100 : null,
                            task_cost: item.cost ? Math.round(item.cost * share * 100) / 100 : null,
                            status: 'not_started',
                            position: position++,
                          });
                        }
                      } else {
                        // Single item — one task, room already linked or null (External)
                        newTasks.push({
                          project_id: project.id,
                          title: item.title,
                          trade: item.trade || null,
                          room_id: item.room_id || null,
                          contractor: item.subcontractor_name || null,
                          in_house: item.in_house || false,
                          task_value: item.client_charge || null,
                          task_cost: item.cost || null,
                          status: 'not_started',
                          position: position++,
                        });
                      }
                    }

                    const { data: createdTasks } = await sb.from('programme_tasks').insert(newTasks).select('*');
                    if (createdTasks) setTasks(prev => [...prev, ...createdTasks]);

                    const contractValue = scopeItems.reduce((s, i) => s + parseFloat(i.client_charge || 0), 0);
                    await sb.from('projects').update({ quote_status: 'accepted', contract_value: contractValue }).eq('id', project.id);
                    setProject(prev => ({ ...prev, quote_status: 'accepted', contract_value: contractValue }));

                    alert(`Programme generated with ${createdTasks?.length || 0} task(s). Head to the Programme tab to add dates.`);
                  }}
                  style={{ padding: '7px 14px', borderRadius: 99, background: '#10b981', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    ✓ Accept Quote
                  </button>
                )}
                {project.quote_status === 'accepted' && (
                  <div style={{ padding: '7px 14px', borderRadius: 99, background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0', fontSize: 12, fontWeight: 600 }}>
                    ✓ Quote accepted — programme generated
                  </div>
                )}
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
                      const SMALL_FILE_THRESHOLD = 4 * 1024 * 1024;
                      for (const file of files) {
                        let json;
                        if (file.size < SMALL_FILE_THRESHOLD) {
                          const formData = new FormData();
                          formData.append('file', file);
                          formData.append('drawing_type', drawingType);
                          const res = await fetch('/api/extract-doc', { method: 'POST', body: formData });
                          try {
                            json = await res.json();
                          } catch {
                            throw new Error(`Server error (${res.status}) reading "${file.name}". Please try again.`);
                          }
                          if (!res.ok) throw new Error(json.error || `API error ${res.status} reading "${file.name}"`);
                        } else {
                          const storagePath = `extract-tmp/${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`;
                          const { error: uploadError } = await sb.storage.from('chat-temp-uploads').upload(storagePath, file, {
                            contentType: file.type || 'application/octet-stream',
                          });
                          if (uploadError) throw new Error(`Could not upload "${file.name}": ${uploadError.message}`);
                          const res = await fetch('/api/extract-doc', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ storage_path: storagePath, file_name: file.name, drawing_type: drawingType }),
                          });
                          try {
                            json = await res.json();
                          } catch {
                            throw new Error(`Server error (${res.status}) reading "${file.name}". Please try again.`);
                          }
                          if (!res.ok) throw new Error(json.error || `API error ${res.status} reading "${file.name}"`);
                        }
                        if (json.extracted?.scope_items?.length) {
                          allItems.push(...json.extracted.scope_items);
                          // If dual AI enabled, store file for verification
                          if (dualAIEnabled) {
                            allExtractedFiles.push({ file, items: json.extracted.scope_items, extracted: json.extracted });
                          }
                        }
                      }
                      if (allItems.length === 0) {
                        setDrawingError('No scope items found in the uploaded files.');
                        return;
                      }

                      // Derive room names directly from each scope item's "zone" field — this is the single
                      // source of truth (not a separate AI-generated rooms list, which proved unreliable).
                      // "Structure", "External" and "Unallocated" are excluded here since Structure/External
                      // always already exist, and "Unallocated" isn't a real room.
                      const RESERVED_ZONES = new Set(['structure', 'external', 'unallocated', '']);
                      const allExtractedRoomNames = new Set();
                      allItems.forEach(item => {
                        const zone = String(item.zone || '').trim();
                        if (zone && !RESERVED_ZONES.has(zone.toLowerCase())) allExtractedRoomNames.add(zone);
                      });

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
                      // Always includes the hardcoded Structure/External zones (guaranteed to exist from project load)
                      const roomLookup = {};
                      [...rooms, ...createdRooms].forEach(r => { roomLookup[(r.name || '').trim().toLowerCase()] = r.id; });

                      // Zone is now the single required source for room matching — falls back to text-matching
                      // only in the unlikely case zone is genuinely missing from the item.
                      const matchRoomIdForItem = (item) => {
                        if (item.zone && String(item.zone).trim()) {
                          const zoneKey = String(item.zone).trim().toLowerCase();
                          if (roomLookup[zoneKey]) return roomLookup[zoneKey];
                        }
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
                      console.log('[DEBUG] roomLookup at match time:', roomLookup);
                      console.log('[DEBUG] rooms state at match time:', rooms);
                      console.log('[DEBUG] createdRooms this run:', createdRooms);
                      const saved = [];
                      const roomLinksToInsert = [];
                      for (let i = 0; i < allItems.length; i++) {
                        const item = allItems[i];
                        const zoneRoomId = matchRoomIdForItem(item);
                        const breakdown = parseRoomBreakdown(item);
                        console.log('[DEBUG] item:', item.title, '| zone:', item.zone, '| matched room_id:', zoneRoomId);
                        // A genuine multi-room breakdown only applies when it covers MULTIPLE distinct rooms
                        // (the original intent — "Kitchen 3, Living 4, Bedroom 1 2"). A single spurious match
                        // against prose text must never override a confident zone-based room_id.
                        const isGenuineBreakdown = breakdown.length > 1;
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
                          room_id: isGenuineBreakdown ? null : zoneRoomId,
                        }]).select('*').single();
                        if (newItem) {
                          saved.push(newItem);
                          if (isGenuineBreakdown) {
                            roomLinksToInsert.push(...breakdown.map(b => ({ scope_item_id: newItem.id, room_id: b.room_id, quantity: b.quantity })));
                          }
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
                  const roomLinksToInsert = [];
                  // Rebuild the same zone-aware room lookup used in the main upload path
                  const roomLookup = {};
                  rooms.forEach(r => { roomLookup[(r.name || '').trim().toLowerCase()] = r.id; });
                  const matchZone = (item) => {
                    if (item.zone && String(item.zone).trim()) {
                      const zoneKey = String(item.zone).trim().toLowerCase();
                      if (roomLookup[zoneKey]) return roomLookup[zoneKey];
                    }
                    return null;
                  };
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
                      room_id: matchZone(item),
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
                      disabled={type === 'quote' && quoteGenerating}
                      onClick={async () => {
                        const unpricedCount = scopeItems.filter(s => !s.cost && !s.client_charge).length;
                        if (unpricedCount > 0) {
                          if (!window.confirm(`${unpricedCount} item${unpricedCount !== 1 ? 's' : ''} still need pricing. Generate anyway?`)) return;
                        }
                        await sb.from('projects').update({ quote_type: type, quote_status: 'draft' }).eq('id', project.id);

                        if (type === 'quote') {
                          setQuoteGenerating(true);
                          try {
                            const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            const itemCharge = (item) => {
                              const cost = parseFloat(item.cost || 0);
                              const markup = parseFloat(item.markup_value || 0);
                              if (item.markup_type === 'percentage') return cost + (cost * markup / 100);
                              if (item.markup_type === 'fixed') return cost + markup;
                              return parseFloat(item.client_charge || 0);
                            };
                            const fmtMoney = (v) => `£${parseFloat(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                            const subtotal = scopeItems.reduce((s, item) => s + itemCharge(item), 0);
                            const VAT_RATE = 0.20;
                            const vatAmount = subtotal * VAT_RATE;
                            const grandTotal = subtotal + vatAmount;
                            const projectAddress = project.bo_premise_address || project.bo_address || '';
                            const clientName = project.client_name || project.bo_1_name || '';
                            const quoteDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

                            const { data: firm } = await sb.from('firm_settings').select('*').limit(1).maybeSingle();
                            const firmName = firm?.trading_name || firm?.firm_name || '';
                            const firmAddressParts = [firm?.address_line1, firm?.address_line2, firm?.city, firm?.postcode].filter(Boolean);
                            const firmContactParts = [firm?.tel, firm?.email].filter(Boolean);

                            const rows = scopeItems.map(item => (
                              `<div style="display:flex;border:1px solid #C8C8C8;border-top:none;">` +
                              `<div style="flex:1;padding:8px 10px;font-size:10pt;">` +
                              `<div style="font-weight:700;">${esc(item.title)}</div>` +
                              (item.description ? `<div style="color:#4b5563;margin-top:2px;">${esc(item.description)}</div>` : '') +
                              `</div>` +
                              `<div style="flex:0 0 130px;min-width:130px;padding:8px 10px;font-size:10pt;text-align:right;white-space:nowrap;">${fmtMoney(itemCharge(item))}</div>` +
                              `</div>`
                            )).join('');

                            const infoRow = (label, value) => (
                              `<div style="display:flex;border:1px solid #C8C8C8;border-top:none;">` +
                              `<div style="flex:0 0 120px;min-width:120px;background:#F3F4F6;font-weight:700;color:#374151;padding:8px 12px;font-size:10pt;">${esc(label)}</div>` +
                              `<div style="flex:1;padding:8px 12px;font-size:10pt;">${esc(value)}</div>` +
                              `</div>`
                            );

                            const totalRow = (label, value, bold) => (
                              `<div style="display:flex;border:1px solid #C8C8C8;border-top:none;">` +
                              `<div style="flex:1;padding:${bold ? '10px' : '8px 10px'};text-align:right;font-size:${bold ? '11pt' : '10pt'};font-weight:${bold ? '700' : '400'};">${esc(label)}</div>` +
                              `<div style="flex:0 0 130px;min-width:130px;padding:${bold ? '10px' : '8px 10px'};text-align:right;font-size:${bold ? '11pt' : '10pt'};font-weight:${bold ? '700' : '400'};white-space:nowrap;${bold ? 'background:#F3F4F6;' : ''}">${fmtMoney(value)}</div>` +
                              `</div>`
                            );

                            const html = `<div style="font-family:Arial,sans-serif;">` +
                              `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;">` +
                              `<div style="font-size:24pt;font-weight:700;color:#1F2937;">QUOTATION</div>` +
                              (firmName ? `<div style="text-align:right;font-size:9pt;color:#4b5563;line-height:1.5;">` +
                                `<div style="font-size:12pt;font-weight:700;color:#1F2937;">${esc(firmName)}</div>` +
                                (firmAddressParts.length ? `<div>${esc(firmAddressParts.join(', '))}</div>` : '') +
                                (firmContactParts.length ? `<div>${esc(firmContactParts.join(' · '))}</div>` : '') +
                                `</div>` : '') +
                              `</div>` +
                              `<div style="border-top:1px solid #C8C8C8;margin-bottom:20px;">` +
                              infoRow('Project', projectAddress) +
                              (clientName ? infoRow('Client', clientName) : '') +
                              infoRow('Date', quoteDate) +
                              `</div>` +
                              `<div style="display:flex;background:#1F2937;color:#fff;">` +
                              `<div style="flex:1;padding:8px 10px;font-size:10pt;">Description</div>` +
                              `<div style="flex:0 0 130px;min-width:130px;padding:8px 10px;font-size:10pt;text-align:right;">Price</div>` +
                              `</div>` +
                              rows +
                              totalRow('Subtotal', subtotal, false) +
                              totalRow('VAT (20%)', vatAmount, false) +
                              totalRow('Total', grandTotal, true) +
                              `</div>`;

                            const address = (projectAddress || 'Project').replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
                            const res = await fetch('/api/export-minutes-pdf', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ html, filename: `${address}_Quote.pdf` }),
                            });
                            if (!res.ok) {
                              const err = await res.json().catch(() => ({}));
                              alert(err.error || 'Could not generate quote PDF.');
                            } else {
                              const blob = await res.blob();
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `${address}_Quote.pdf`;
                              document.body.appendChild(a);
                              a.click();
                              a.remove();
                              URL.revokeObjectURL(url);
                            }
                          } catch (err) {
                            alert(err.message);
                          } finally {
                            setQuoteGenerating(false);
                          }
                        } else {
                          alert(`✅ Tender package saved as draft. Document generation for tender packs is not yet built.`);
                        }
                      }}
                      style={{ flex: 1, padding: '10px', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 13,
                        background: type === 'tender' ? 'transparent' : '#3b82f6',
                        color: '#fff',
                        border: type === 'tender' ? '2px solid #93c5fd' : 'none' }}>
                      {type === 'quote' ? (quoteGenerating ? '⏳ Generating...' : '📄 Generate Quote') : '📦 Generate Tender Pack'}
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

            {tasks.length > 0 && (() => {
              const totalValue = tasks.reduce((s, t) => s + parseFloat(t.task_value || 0), 0);
              const totalCost = tasks.reduce((s, t) => s + parseFloat(t.task_cost || 0), 0);
              const margin = totalValue - totalCost;
              const uncostedCount = tasks.filter(t => t.task_value > 0 && !t.task_cost).length;
              return (
                <div style={{ display: 'flex', gap: 16, padding: '10px 14px', background: '#f8f9fa', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                  <div><span style={{ fontSize: 11, color: '#6b7280' }}>Total value: </span><span style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{fmt(totalValue)}</span></div>
                  <div><span style={{ fontSize: 11, color: '#6b7280' }}>Total cost: </span><span style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{fmt(totalCost)}</span></div>
                  <div><span style={{ fontSize: 11, color: '#6b7280' }}>Margin: </span><span style={{ fontSize: 12, fontWeight: 700, color: '#16a34a' }}>{fmt(margin)}</span></div>
                  {uncostedCount > 0 && (
                    <div style={{ fontSize: 11, color: '#d97706', fontStyle: 'italic' }}>{uncostedCount} task{uncostedCount !== 1 ? 's' : ''} missing cost</div>
                  )}
                </div>
              );
            })()}

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
                  // Any open Site Log tasks linked to either side of this dependency
                  const linkedTasks = projectTasks.filter(pt => pt.linked_programme_task_id === task.id || pt.linked_programme_task_id === dep.id);
                  depLines.push({ x_bar_end, x_lag_end, y1, x2, y2, clash, lag_days: lag_days || 0, linkedTasks });
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
                                {/* Linked Site Log task icon — click to view/close */}
                                {line.linkedTasks.length > 0 && (() => {
                                  // Escalate to red if the downstream task starts within 3 days or has already started
                                  const downstreamTask = datedTasks[Math.round(line.y2 / ROW_H - 0.5)];
                                  const daysToStart = downstreamTask?.start_date
                                    ? Math.ceil((new Date(downstreamTask.start_date) - new Date()) / 86400000)
                                    : null;
                                  const isOverdueRisk = daysToStart !== null && daysToStart <= 3;
                                  const iconFill = isOverdueRisk ? '#ef4444' : '#f59e0b';
                                  const iconY = line.lag_days > 0 ? midY - 22 : midY;
                                  return (
                                    <g
                                      style={{ cursor: 'pointer' }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setTaskPopup({
                                          x: elbowX,
                                          y: iconY,
                                          tasks: line.linkedTasks,
                                        });
                                      }}
                                    >
                                      <circle cx={midX} cy={iconY} r={8} fill={iconFill} stroke="#fff" strokeWidth={1.5} />
                                      <text x={midX} y={iconY + 3.5} textAnchor="middle" fontSize={10} fill="#fff" fontWeight="700">!</text>
                                    </g>
                                  );
                                })()}
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#f59e0b', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>!</div>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>Open task blocking this</span>
                    </div>
                  </div>

                  {/* Task popup — click on a dependency task icon */}
                  {taskPopup && (
                    <div onClick={() => setTaskPopup(null)} style={{ position: 'fixed', inset: 0, zIndex: 999 }}>
                      <div onClick={e => e.stopPropagation()} style={{
                        position: 'absolute', left: Math.min(taskPopup.x + LABEL_W + 40, window.innerWidth - 300), top: taskPopup.y + 100,
                        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, width: 280,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                      }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Blocking task{taskPopup.tasks.length > 1 ? 's' : ''}</div>
                        {taskPopup.tasks.map(t => (
                          <div key={t.id} style={{ padding: '8px 10px', border: '1px solid #f3f4f6', borderRadius: 8, marginBottom: 6 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', marginBottom: 6 }}>{t.title}</div>
                            <button
                              onClick={async () => {
                                await sb.from('project_tasks').update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: 'gantt' }).eq('id', t.id);
                                setProjectTasks(prev => prev.filter(pt => pt.id !== t.id));
                                setTaskPopup(prev => {
                                  const remaining = prev.tasks.filter(x => x.id !== t.id);
                                  return remaining.length ? { ...prev, tasks: remaining } : null;
                                });
                              }}
                              style={{ padding: '5px 12px', borderRadius: 6, background: '#1F2937', color: '#fff', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                              Mark complete
                            </button>
                          </div>
                        ))}
                        <button onClick={() => setTaskPopup(null)} style={{ width: '100%', padding: '6px', borderRadius: 6, background: '#f3f4f6', border: 'none', fontSize: 11, color: '#6b7280', cursor: 'pointer', marginTop: 4 }}>Close</button>
                      </div>
                    </div>
                  )}
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

        {/* ── Weekly Minutes tab ── */}
        {tab === 'minutes' && (
          <div style={{ height: 640, border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
            <WeeklyMinutes defaultProjectId={project.id} onOpenComposer={onOpenComposer} />
          </div>
        )}

        {/* ── Emails tab ── */}
        {tab === 'emails' && (
          <div style={{ ...card(), color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
            Project emails coming soon.
          </div>
        )}

        {/* ── Documents tab ── */}
        {tab === 'documents' && <DocumentsTab project={project} subs={subs} card={card} />}

        {tab === 'snagging' && <SnaggingTab project={project} rooms={rooms} subs={subs} card={card} />}

        {tab === 'portal' && <PortalTab project={project} subs={subs} card={card} />}

      </div>

      {/* Detach item modal */}
      {detachModal && (
        <DetachModal
          item={detachModal}
          projectId={project.id}
          rooms={rooms}
          onSave={(createdItems, updatedOriginal) => {
            setScopeItems(prev => {
              const withoutOriginal = prev.filter(s => s.id !== detachModal.id);
              const rebuilt = updatedOriginal ? [...withoutOriginal, updatedOriginal] : withoutOriginal;
              return [...rebuilt, ...createdItems].sort((a, b) => (a.position || 0) - (b.position || 0));
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
          subs={subs}
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
          subs={subs}
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
          projectId={project.id}
          onSave={handleSaveSub}
          onClose={() => setSubModal(null)}
        />
      )}
    </div>
  );
}
