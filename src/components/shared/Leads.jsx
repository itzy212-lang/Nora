// src/components/shared/Leads.jsx
// Rewritten 2026-08-21, on request: leads used to be a separate,
// simplified table and form, disconnected from the real project
// once accepted — the exact double-entry problem raised directly.
// A lead is now a real project record from the start, just flagged
// stage='lead'. Accepting it (in PartyWallLeadQuote or via Accept
// Quote in PMProjectDetail) flips that flag — same record, same
// page, now live — nothing is copied or re-entered.

import { useState, useEffect, useCallback } from 'react';
import sb from '../../supabaseClient';
import NewProjectModal from '../projects/NewProjectModal';

const s = {
  page:      { padding: '24px 28px', maxWidth: 900 },
  header:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  title:     { fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 },
  subtitle:  { fontSize: 13, color: 'var(--text3)', marginTop: 4 },
  addBtn:    { padding: '9px 18px', borderRadius: 10, border: 'none', background: 'var(--blue)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  toolbar:   { display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
  search:    { flex: 1, minWidth: 200, padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', fontSize: 13, color: 'var(--text)', outline: 'none' },
  card:      { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', marginBottom: 10, cursor: 'pointer', transition: 'box-shadow 0.15s' },
  cardTop:   { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  ref:       { fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 },
  name:      { fontSize: 15, fontWeight: 600, color: 'var(--text)' },
  meta:      { fontSize: 12.5, color: 'var(--text3)', marginTop: 3 },
  value:     { fontSize: 16, fontWeight: 700, color: '#059669', whiteSpace: 'nowrap' },
  typeBadge: { fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.4px' },
  empty:     { textAlign: 'center', padding: '60px 20px', color: 'var(--text3)' },
};

function leadValue(project) {
  if (project.project_type === 'construction' || project.project_type === 'pm') {
    return project.contract_value || 0;
  }
  const q = project.pw_lead_quote || {};
  if (q.num_aos) {
    const n = Number(q.num_aos) || 1;
    const notice = Number(q.fee_notice) || 0;
    const soc = Number(q.fee_soc) || 0;
    const award = Number(q.fee_agreed) || 0;
    const discount = q.discount_mode === '50' ? 0.5 : 0.25;
    let awardTotal = award;
    for (let i = 1; i < n; i++) awardTotal += Math.round(award * (1 - discount) * 100) / 100;
    return notice * n + soc * n + awardTotal;
  }
  return q.estimated_value || 0;
}

export default function Leads({ onOpenProject }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showNewLead, setShowNewLead] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await sb.from('projects').select('*').eq('stage', 'lead').order('created_at', { ascending: false });
      setLeads(data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = leads.filter(l => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return [l.bo, l.bo_1_name, l.bo_premise_address, l.works, l.ref].filter(Boolean).some(v => String(v).toLowerCase().includes(q));
  });

  const totalPipeline = filtered.reduce((sum, l) => sum + leadValue(l), 0);

  return (
    <div style={s.page}>
      {showNewLead && (
        <NewProjectModal
          defaultStage="lead"
          onClose={() => setShowNewLead(false)}
          onCreated={(project) => {
            setShowNewLead(false);
            load();
            if (project) onOpenProject?.(project);
          }}
        />
      )}

      <div style={s.header}>
        <div>
          <h1 style={s.title}>Leads</h1>
          <div style={s.subtitle}>
            {filtered.length} lead{filtered.length !== 1 ? 's' : ''} in the pipeline
            {totalPipeline > 0 && ` — £${totalPipeline.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total`}
          </div>
        </div>
        <button style={s.addBtn} onClick={() => setShowNewLead(true)}>+ Add New Lead</button>
      </div>

      <div style={s.toolbar}>
        <input style={s.search} placeholder="Search leads…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading && <div style={{ color: 'var(--text3)', fontSize: 13 }}>Loading…</div>}

      {!loading && filtered.length === 0 && (
        <div style={s.empty}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No leads yet</div>
          <div style={{ fontSize: 13 }}>Add one to start tracking it through the pipeline.</div>
        </div>
      )}

      {filtered.map(lead => {
        const isPM = lead.project_type === 'construction' || lead.project_type === 'pm';
        const value = leadValue(lead);
        return (
          <div key={lead.id} style={s.card}
            onClick={() => onOpenProject?.(lead)}
            onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'}
            onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
            <div style={s.cardTop}>
              <div>
                <div style={s.ref}>{lead.ref}</div>
                <div style={s.name}>{lead.bo_1_name || lead.bo || 'Unnamed lead'}</div>
                <div style={s.meta}>{lead.bo_premise_address || 'No address yet'}</div>
                {lead.works && <div style={s.meta}>{lead.works}</div>}
                <span style={{ ...s.typeBadge, background: isPM ? '#eef2ff' : '#e8f9ee', color: isPM ? '#3d5a99' : '#1a7a3c', marginTop: 8, display: 'inline-block' }}>
                  {isPM ? 'Project management' : 'Party wall'}
                </span>
              </div>
              {value > 0 && <div style={s.value}>£{value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
