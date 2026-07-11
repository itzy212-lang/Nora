import { useState, useEffect, useCallback } from 'react';
import sb from '../../supabaseClient';

const STAGES = ['new', 'contacted', 'quoted', 'follow_up', 'won', 'lost'];
const STAGE_LABELS = { new: 'New', contacted: 'Contacted', quoted: 'Quoted', follow_up: 'Follow Up', won: 'Won', lost: 'Lost' };
const STAGE_COLORS = {
  new:        { bg: '#eef2ff', color: '#3d5a99' },
  contacted:  { bg: '#fff8e1', color: '#b07d00' },
  quoted:     { bg: '#e8f4fd', color: '#1a6fa0' },
  follow_up:  { bg: '#fff0e6', color: '#c05a00' },
  won:        { bg: '#e8f9ee', color: '#1a7a3c' },
  lost:       { bg: '#fce8e8', color: '#b52020' },
};

const SOURCES = ['Email', 'Referral', 'Website', 'Phone', 'Other'];
const ROLES   = ['Building Owner', 'Adjoining Owner', 'Unknown'];

const s = {
  page:      { padding: '24px 28px', maxWidth: 900 },
  header:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  title:     { fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 },
  subtitle:  { fontSize: 13, color: 'var(--text3)', marginTop: 4 },
  addBtn:    { padding: '9px 18px', borderRadius: 10, border: 'none', background: 'var(--blue)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  toolbar:   { display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
  search:    { flex: 1, minWidth: 200, padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', fontSize: 13, color: 'var(--text)', outline: 'none' },
  filter:    { padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', fontSize: 13, color: 'var(--text)', outline: 'none', cursor: 'pointer' },
  card:      { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', marginBottom: 10, cursor: 'pointer', transition: 'box-shadow 0.15s' },
  cardTop:   { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  ref:       { fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 },
  name:      { fontSize: 15, fontWeight: 600, color: 'var(--text)' },
  addr:      { fontSize: 13, color: 'var(--text3)', marginTop: 3 },
  badge:     { flexShrink: 0, padding: '3px 10px', borderRadius: 99, fontSize: 11.5, fontWeight: 600 },
  meta:      { display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' },
  metaItem:  { fontSize: 12, color: 'var(--text3)' },
  empty:     { textAlign: 'center', padding: '60px 0', color: 'var(--text3)', fontSize: 14 },
  overlay:   { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflowY: 'auto' },
  modal:     { background: 'var(--bg)', borderRadius: 18, padding: 28, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' },
  modalTitle:{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 20 },
  grid2:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 },
  field:     { marginBottom: 14 },
  label:     { fontSize: 11.5, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5, display: 'block' },
  input:     { width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg2)', fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' },
  textarea:  { width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg2)', fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box', resize: 'vertical', minHeight: 80 },
  select:    { width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg2)', fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' },
  modalBtns: { display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' },
  cancelBtn: { padding: '9px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', fontSize: 13, cursor: 'pointer', color: 'var(--text2)' },
  saveBtn:   { padding: '9px 18px', borderRadius: 10, border: 'none', background: 'var(--blue)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  deleteBtn: { padding: '9px 18px', borderRadius: 10, border: 'none', background: 'var(--red, #dc3545)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginRight: 'auto' },
  convertBtn: { padding: '9px 18px', borderRadius: 10, border: 'none', background: '#16a34a', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  lostBtn:    { padding: '9px 18px', borderRadius: 10, border: 'none', background: '#6b7280', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  section:   { fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '20px 0 10px', paddingBottom: 6, borderBottom: '1px solid var(--border)' },
};

const EMPTY_FORM = {
  contact_name: '', contact_email: '', contact_phone: '',
  project_address: '', role_type: 'Building Owner', source: 'Email',
  works_summary: '', lead_stage: 'new', estimated_value: '',
  next_action: '', notes: '',
};

function fmt(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function nextRef() {
  const year = new Date().getFullYear();
  const { data } = await sb.from('leads').select('lead_ref').ilike('lead_ref', `%-${year}-%`).order('created_at', { ascending: false }).limit(1);
  const last = data?.[0]?.lead_ref;
  const num = last ? parseInt(last.split('-').pop(), 10) + 1 : 1;
  return `SQ1-LD-${year}-${String(num).padStart(4, '0')}`;
}

export default function Leads() {
  const [leads, setLeads]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await sb.from('leads').select('*').order('created_at', { ascending: false });
      setLeads(data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = async () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (lead, e) => {
    e.stopPropagation();
    setEditing(lead);
    setForm({
      contact_name:    lead.contact_name || '',
      contact_email:   lead.contact_email || '',
      contact_phone:   lead.contact_phone || '',
      project_address: lead.project_address || '',
      role_type:       lead.role_type || 'Building Owner',
      source:          lead.source || lead.lead_source || 'Email',
      works_summary:   lead.works_summary || '',
      lead_stage:      lead.lead_stage || lead.status || 'new',
      estimated_value: lead.estimated_value || '',
      next_action:     lead.next_action || '',
      notes:           lead.notes || '',
    });
    setShowModal(true);
  };

  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.contact_name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await sb.from('leads').update({
          contact_name:    form.contact_name.trim(),
          contact_email:   form.contact_email.trim() || null,
          contact_phone:   form.contact_phone.trim() || null,
          project_address: form.project_address.trim() || null,
          role_type:       form.role_type || null,
          source:          form.source || null,
          works_summary:   form.works_summary.trim() || null,
          lead_stage:      form.lead_stage,
          status:          form.lead_stage,
          estimated_value: form.estimated_value ? parseFloat(form.estimated_value) : null,
          next_action:     form.next_action.trim() || null,
          notes:           form.notes.trim() || null,
          updated_at:      new Date().toISOString(),
        }).eq('id', editing.id);
      } else {
        const ref = await nextRef();
        await sb.from('leads').insert([{
          lead_ref:        ref,
          contact_name:    form.contact_name.trim(),
          contact_email:   form.contact_email.trim() || null,
          contact_phone:   form.contact_phone.trim() || null,
          project_address: form.project_address.trim() || null,
          role_type:       form.role_type || null,
          source:          form.source || null,
          works_summary:   form.works_summary.trim() || null,
          lead_stage:      form.lead_stage,
          status:          form.lead_stage,
          estimated_value: form.estimated_value ? parseFloat(form.estimated_value) : null,
          next_action:     form.next_action.trim() || null,
          notes:           form.notes.trim() || null,
        }]);
      }
      setShowModal(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    if (!window.confirm('Delete this lead?')) return;
    await sb.from('leads').delete().eq('id', editing.id);
    setShowModal(false);
    setLeads(prev => prev.filter(l => l.id !== editing.id));
  };

  const handleConvert = async () => {
    if (!editing) return;
    if (!window.confirm('Convert this lead to a project? The lead will be marked as Won.')) return;
    try {
      setSaving(true);
      const lead = editing;
      const isBO = (lead.role_type || '').toLowerCase().includes('building owner');
      const isAO = (lead.role_type || '').toLowerCase().includes('adjoining');

      // Generate a project id and ref matching existing format
      const fullYear = new Date().getFullYear();
      const { data: refData } = await sb
        .from('projects')
        .select('ref')
        .ilike('ref', `SQ1-${fullYear}-%`)
        .order('created_at', { ascending: false })
        .limit(1);
      const lastRef = refData?.[0]?.ref || '';
      const lastNum = parseInt(lastRef.split('-').pop() || '0', 10);
      const newRef = `SQ1-${fullYear}-${String(lastNum + 1).padStart(3, '0')}`;
      const newId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const projectData = {
        id: newId,
        ref: newRef,
        name: lead.project_address || lead.contact_name,
        bo_premise_address: lead.project_address || null,
        role: lead.role_type || null,
        status: 'active',
        works: lead.works_summary || null,
      };

      if (isBO) {
        projectData.bo_1_name = lead.contact_name || null;
        projectData.bo_1_email = lead.contact_email || null;
        projectData.bo_phone = lead.contact_phone || null;
        projectData.bo = lead.contact_name || null;
      } else if (isAO) {
        projectData.ao_client_name = lead.contact_name || null;
        projectData.ao_email = lead.contact_email || null;
        projectData.ao_phone = lead.contact_phone || null;
        projectData.ao_premise_address = lead.project_address || null;
      }

      console.log('[Convert] projectData:', JSON.stringify(projectData, null, 2));
      const { data: insertData, error } = await sb.from('projects').insert([projectData]).select();
      console.log('[Convert] insert result:', JSON.stringify({ insertData, error }, null, 2));
      if (error) throw new Error(JSON.stringify(error));

      // Delete the lead now it's been converted
      await sb.from('leads').delete().eq('id', lead.id);

      setShowModal(false);
      await load();
      alert(`Project ${newRef} created successfully!`);
    } catch (err) {
      alert('Failed to convert: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleMarkLost = async () => {
    if (!editing) return;
    if (!window.confirm('Mark this lead as lost?')) return;
    await sb.from('leads').update({ status: 'lost', lead_stage: 'lost' }).eq('id', editing.id);
    setShowModal(false);
    await load();
  };

  const filtered = leads.filter(l => {
    const q = search.toLowerCase();
    const matchStage = stageFilter === 'all' || (l.lead_stage || l.status) === stageFilter;
    const matchSearch = !q
      || l.contact_name?.toLowerCase().includes(q)
      || l.project_address?.toLowerCase().includes(q)
      || l.contact_email?.toLowerCase().includes(q)
      || l.lead_ref?.toLowerCase().includes(q)
      || l.works_summary?.toLowerCase().includes(q);
    return matchStage && matchSearch;
  });

  const stageCounts = STAGES.reduce((acc, s) => {
    acc[s] = leads.filter(l => (l.lead_stage || l.status) === s).length;
    return acc;
  }, {});

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Leads</h1>
          <p style={s.subtitle}>
            {leads.length} lead{leads.length !== 1 ? 's' : ''} total
            {leads.filter(l => (l.lead_stage || l.status) === 'new').length > 0 &&
              ` . ${leads.filter(l => (l.lead_stage || l.status) === 'new').length} new`}
          </p>
        </div>
        <button style={s.addBtn} onClick={openAdd}>+ Add Lead</button>
      </div>

      {/* Stage filter pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button
          onClick={() => setStageFilter('all')}
          style={{ padding: '5px 14px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: stageFilter === 'all' ? '2px solid var(--blue)' : '1px solid var(--border)', background: stageFilter === 'all' ? 'var(--blue-bg, #eef2ff)' : 'var(--bg2)', color: stageFilter === 'all' ? 'var(--blue)' : 'var(--text3)' }}>
          All ({leads.length})
        </button>
        {STAGES.map(st => (
          <button key={st}
            onClick={() => setStageFilter(st)}
            style={{ padding: '5px 14px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: stageFilter === st ? `2px solid ${STAGE_COLORS[st].color}` : '1px solid var(--border)', background: stageFilter === st ? STAGE_COLORS[st].bg : 'var(--bg2)', color: stageFilter === st ? STAGE_COLORS[st].color : 'var(--text3)' }}>
            {STAGE_LABELS[st]} {stageCounts[st] > 0 ? `(${stageCounts[st]})` : ''}
          </button>
        ))}
      </div>

      <div style={s.toolbar}>
        <input style={s.search} placeholder="Search by name, address, email…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div style={s.empty}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={s.empty}>{search || stageFilter !== 'all' ? 'No leads match your filter' : 'No leads yet — click + Add Lead to get started'}</div>
      ) : (
        filtered.map(lead => {
          const stage = lead.lead_stage || lead.status || 'new';
          const colors = STAGE_COLORS[stage] || STAGE_COLORS.new;
          return (
            <div key={lead.id} style={s.card}
              onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
              onClick={e => openEdit(lead, e)}>
              <div style={s.cardTop}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={s.ref}>{lead.lead_ref}</div>
                  <div style={s.name}>{lead.contact_name || '—'}</div>
                  {lead.project_address && <div style={s.addr}>{lead.project_address}</div>}
                </div>
                <span style={{ ...s.badge, background: colors.bg, color: colors.color }}>
                  {STAGE_LABELS[stage] || stage}
                </span>
              </div>
              <div style={s.meta}>
                {lead.role_type && <span style={s.metaItem}>👤 {lead.role_type}</span>}
                {lead.contact_email && <span style={s.metaItem}>✉ {lead.contact_email}</span>}
                {lead.contact_phone && <span style={s.metaItem}>📞 {lead.contact_phone}</span>}
                {lead.estimated_value && <span style={s.metaItem}>💷 £{parseFloat(lead.estimated_value).toLocaleString('en-GB')}</span>}
                {lead.works_summary && <span style={{ ...s.metaItem, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🔨 {lead.works_summary}</span>}
                <span style={{ ...s.metaItem, marginLeft: 'auto' }}>{fmt(lead.created_at)}</span>
              </div>
              {lead.next_action && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--blue)', fontWeight: 500 }}>
                  → {lead.next_action}
                </div>
              )}
            </div>
          );
        })
      )}

      {showModal && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div style={s.modal}>
            <div style={s.modalTitle}>{editing ? `Edit Lead -- ${editing.lead_ref}` : 'Add Lead'}</div>

            <div style={s.section}>Contact</div>
            <div style={s.grid2}>
              <div style={s.field}>
                <label style={s.label}>Name *</label>
                <input style={s.input} value={form.contact_name} onChange={e => setF('contact_name', e.target.value)} placeholder="Full name" />
              </div>
              <div style={s.field}>
                <label style={s.label}>Email</label>
                <input style={s.input} value={form.contact_email} onChange={e => setF('contact_email', e.target.value)} placeholder="email@example.com" />
              </div>
              <div style={s.field}>
                <label style={s.label}>Phone</label>
                <input style={s.input} value={form.contact_phone} onChange={e => setF('contact_phone', e.target.value)} placeholder="07700 000000" />
              </div>
              <div style={s.field}>
                <label style={s.label}>Role</label>
                <select style={s.select} value={form.role_type} onChange={e => setF('role_type', e.target.value)}>
                  {ROLES.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
            </div>

            <div style={s.section}>Project</div>
            <div style={s.field}>
              <label style={s.label}>Address / Postcode</label>
              <input style={s.input} value={form.project_address} onChange={e => setF('project_address', e.target.value)} placeholder="e.g. 12 High Street, London N1 2AB" />
            </div>
            <div style={s.field}>
              <label style={s.label}>Works Summary</label>
              <textarea style={s.textarea} value={form.works_summary} onChange={e => setF('works_summary', e.target.value)} placeholder="Brief description of the proposed works…" />
            </div>

            <div style={s.section}>Lead Details</div>
            <div style={s.grid2}>
              <div style={s.field}>
                <label style={s.label}>Stage</label>
                <select style={s.select} value={form.lead_stage} onChange={e => setF('lead_stage', e.target.value)}>
                  {STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                </select>
              </div>
              <div style={s.field}>
                <label style={s.label}>Source</label>
                <select style={s.select} value={form.source} onChange={e => setF('source', e.target.value)}>
                  {SOURCES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div style={s.field}>
                <label style={s.label}>Estimated Value (£)</label>
                <input style={s.input} type="number" value={form.estimated_value} onChange={e => setF('estimated_value', e.target.value)} placeholder="0" />
              </div>
            </div>

            <div style={s.field}>
              <label style={s.label}>Next Action</label>
              <input style={s.input} value={form.next_action} onChange={e => setF('next_action', e.target.value)} placeholder="e.g. Send quote by Friday" />
            </div>
            <div style={s.field}>
              <label style={s.label}>Notes</label>
              <textarea style={s.textarea} value={form.notes} onChange={e => setF('notes', e.target.value)} placeholder="Any additional notes…" />
            </div>

            <div style={s.modalBtns}>
              {editing && <button style={s.deleteBtn} onClick={handleDelete}>Delete</button>}
              {editing && <button style={s.lostBtn} onClick={handleMarkLost}>Lost</button>}
              <button style={s.cancelBtn} onClick={() => setShowModal(false)}>Cancel</button>
              <button style={s.saveBtn} onClick={handleSave} disabled={saving || !form.contact_name.trim()}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              {editing && (
                <button style={s.convertBtn} onClick={handleConvert} disabled={saving}>
                  Convert to Project
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


