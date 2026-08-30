// src/components/projects/NoticeHistoryModal.jsx
// Added 2026-08-28, on request: browse an adjoining owner's previously
// generated notices, matching the existing Schedule of Condition
// history pattern directly — a ☰ list of past sessions, titled by
// address and date. Selecting one regenerates the real PDF (the
// underlying database record has no stored file to pull back, only
// the data used to build it) and reuses the existing NoticeReviewModal
// viewer already built and working elsewhere in this same flow.

import { useEffect, useState } from 'react';
import sb from '../../supabaseClient';

const SECTION_LABELS = { section_1: 'Section 1(5)', section_2: 'Section 2(2)', section_6: 'Section 6(1)', section_10: 'Section 10' };

export default function NoticeHistoryModal({ ao, project, onClose, onViewNotice, onEditNotice }) {
  const [notices, setNotices] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const aoId = ao?.id || String(ao?.num || '');
    if (!sb || !project?.id || !aoId) { setNotices([]); return; }
    sb.from('notices')
      .select('*')
      .eq('project_id', project.id)
      .eq('ao_id', aoId)
      .order('notice_date', { ascending: false })
      .order('run_number', { ascending: false })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) { setError(err.message); setNotices([]); return; }
        setNotices(data || []);
      });
    return () => { cancelled = true; };
  }, [ao, project?.id]);

  const aoAddress = ao?.premise || ao?.address || ao?.reg_addr || `AO ${ao?.num || ''}`;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 900, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div
        style={{ background: 'var(--bg)', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Notices</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>{aoAddress}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text2)' }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {notices === null && <div style={{ padding: 20, fontSize: 13, color: 'var(--text3)' }}>Loading…</div>}
          {error && <div style={{ padding: 20, fontSize: 13, color: '#ef4444' }}>{error}</div>}
          {notices?.length === 0 && <div style={{ padding: 20, fontSize: 13, color: 'var(--text3)' }}>No notices generated yet for this owner.</div>}
          {notices?.map(n => {
            const sections = Object.keys(SECTION_LABELS).filter(k => n[k]).map(k => SECTION_LABELS[k]);
            const dateLabel = n.notice_date ? new Date(n.notice_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date';
            return (
              <div key={n.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{dateLabel}{n.run_number > 1 ? ` (v${n.run_number})` : ''}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{sections.join(', ') || 'No sections recorded'}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => onViewNotice?.(n, ao)} style={{ padding: '6px 12px', borderRadius: 99, border: '1px solid var(--blue)', background: 'transparent', color: 'var(--blue)', fontSize: 12, cursor: 'pointer' }}>View</button>
                  <button onClick={() => onEditNotice?.(n, ao)} style={{ padding: '6px 12px', borderRadius: 99, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontSize: 12, cursor: 'pointer' }}>Edit</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
