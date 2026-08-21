// src/components/shared/PartyWallLeadQuote.jsx
// Added 2026-08-21, on request: party wall leads don't get a scope of
// works — they get this fee entry instead, matching the confirmed
// mockup. Generates the real, existing fee-proposal PDF
// (api/generate-fee-quote-html.js) rather than a new template, and
// the computed total feeds the lead pipeline value directly.

import { useState, useEffect } from 'react';
import sb from '../../supabaseClient';

const DEFAULTS = { num_aos: 2, fee_notice: 107, fee_soc: 500, fee_agreed: 950, fee_separate: 950, discount_mode: '25' };

function computeTotal(q) {
  const n = Number(q.num_aos) || 1;
  const notice = Number(q.fee_notice) || 0;
  const soc = Number(q.fee_soc) || 0;
  const award = Number(q.fee_agreed) || 0;
  const discount = q.discount_mode === '50' ? 0.5 : 0.25;
  let awardTotal = award;
  for (let i = 1; i < n; i++) awardTotal += Math.round(award * (1 - discount) * 100) / 100;
  return { noticeTotal: notice * n, socTotal: soc * n, awardTotal, total: notice * n + soc * n + awardTotal };
}

const field = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 };
const input = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' };

export default function PartyWallLeadQuote({ project, onAccept, onBack }) {
  const [q, setQ] = useState({ ...DEFAULTS, ...(project.pw_lead_quote || {}) });
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saved, setSaved] = useState(false);
  const set = (k, v) => setQ(f => ({ ...f, [k]: v }));

  const { noticeTotal, socTotal, awardTotal, total } = computeTotal(q);

  const save = async (patch = {}) => {
    setSaving(true);
    const data = { ...q, ...patch };
    await sb.from('projects').update({ pw_lead_quote: data }).eq('id', project.id);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await fetch('/api/generate-fee-quote-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: project.bo_1_name || project.bo || '',
          property_address: project.bo_premise_address || '',
          works_description: project.works || '',
          num_aos: String(q.num_aos || 1),
          fee_notice: String(q.fee_notice || 0),
          fee_soc: String(q.fee_soc || 0),
          fee_agreed: String(q.fee_agreed || 0),
          fee_separate: String(q.fee_separate || 0),
          quote_ref: q.quote_ref || undefined,
          bo_email: project.bo_1_email || '',
        }),
      });
      const json = await r.json();
      if (!json.success) throw new Error(json.error || 'Could not generate the fee proposal.');

      const pdfRes = await fetch('/api/export-minutes-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: json.html, filename: `${(project.bo_premise_address || 'Fee Proposal').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()}.pdf` }),
      });
      if (!pdfRes.ok) throw new Error('Could not generate the PDF.');
      const blob = await pdfRes.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(project.bo_premise_address || 'Fee Proposal').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      await save({ quote_ref: json.quote_ref, generated_at: new Date().toISOString() });
    } catch (err) {
      alert(err.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={{ maxWidth: 560 }}>
      {onBack && <button onClick={onBack} style={{ padding: '6px 12px', borderRadius: 99, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontSize: 12, cursor: 'pointer', marginBottom: 16 }}>← Back</button>}

      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>Fee proposal</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 16 }}>{project.bo_premise_address || 'No address yet'}</div>

      <div style={{ marginBottom: 14 }}>
        <label style={field}>Number of adjoining owners</label>
        <input type="number" min="1" style={input} value={q.num_aos} onChange={e => set('num_aos', e.target.value)} onBlur={() => save()} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <label style={field}>Notice fee (per owner)</label>
          <input type="number" style={input} value={q.fee_notice} onChange={e => set('fee_notice', e.target.value)} onBlur={() => save()} />
        </div>
        <div>
          <label style={field}>Schedule of condition (per owner)</label>
          <input type="number" style={input} value={q.fee_soc} onChange={e => set('fee_soc', e.target.value)} onBlur={() => save()} />
        </div>
        <div>
          <label style={field}>Award / acting as agreed surveyor</label>
          <input type="number" style={input} value={q.fee_agreed} onChange={e => set('fee_agreed', e.target.value)} onBlur={() => save()} />
        </div>
        <div>
          <label style={field}>If AO appoints their own surveyor</label>
          <input type="number" style={input} value={q.fee_separate} onChange={e => set('fee_separate', e.target.value)} onBlur={() => save()} />
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={field}>Award discount for further appointments</label>
        <div style={{ display: 'flex', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>
            <input type="radio" checked={q.discount_mode !== '50'} onChange={() => { set('discount_mode', '25'); save({ discount_mode: '25' }); }} />
            Different surveyor (25%)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>
            <input type="radio" checked={q.discount_mode === '50'} onChange={() => { set('discount_mode', '50'); save({ discount_mode: '50' }); }} />
            Same surveyor (50%)
          </label>
        </div>
      </div>

      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Total pipeline value</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>£{total.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
          Notices £{noticeTotal.toFixed(2)} + SOC £{socTotal.toFixed(2)} + Award £{awardTotal.toFixed(2)}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={generate} disabled={generating}
          style={{ padding: '9px 16px', borderRadius: 99, border: 'none', background: '#3b82f6', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: generating ? 0.6 : 1 }}>
          {generating ? 'Generating…' : '📄 Generate fee proposal'}
        </button>
        {project.stage !== 'live' && (
          <button onClick={() => onAccept?.(total)}
            style={{ padding: '9px 16px', borderRadius: 99, border: 'none', background: '#10b981', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            ✓ Accept — make this a live job
          </button>
        )}
        {saving && <span style={{ fontSize: 12, color: 'var(--text3)' }}>Saving…</span>}
        {saved && <span style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>✓ Saved</span>}
      </div>
    </div>
  );
}
