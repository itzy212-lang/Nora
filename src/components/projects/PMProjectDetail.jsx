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

  // Re-fetch from DB on open
  useEffect(() => {
    if (!initialProject?.id || !sb) return;
    sb.from('projects').select('*').eq('id', initialProject.id).single()
      .then(({ data }) => { if (data) setProject(data); });
  }, [initialProject?.id]);

  // Safety — ensure project is always an object
  if (!project) return <div style={{ padding: 24, color: 'var(--text3)' }}>Loading project...</div>;

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

  const TABS = ['overview', 'subcontractors', 'financials', 'emails', 'documents'];

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
