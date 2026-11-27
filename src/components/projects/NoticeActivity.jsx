// The AO card's list of notices served to this adjoining owner, oldest first. One line per notice:
//   "Sections 6(1) and 1(5) served 27/11/2026 · Posted · Tracking: AB123456789GB"
//   "Section 10 notice served 02/12/2026 · Emailed"
// For posted notices the status comes from the letter provider (accepted, printed, posted, delivered) and is
// refreshed each time the card loads until it is final. Notices served before delivery was recorded show the
// date only. Works for every user: reads the user's own rows (row-level security), no provider code here.
import { useCallback, useEffect, useState } from 'react';
import sb from '../../supabaseClient';
import { noticeSectionsLabel, noticeDeliveryInfo } from '../../../api/lib/notice-activity.js';
import { letterStatusLabel } from '../../../api/lib/letter-post.js';

// placement 'side'   : the status column (wide screens only; hidden on a phone).
// placement 'bottom' : under the Schedule of Condition button at the foot of the AO card (phones only).
// The card renders both; only the one that fits the screen shows and loads, so nothing is fetched twice.
export default function NoticeActivity({ projectId, ao, placement = 'side' }) {
  const aoKey = String(ao?.id || ao?.num || '');
  const [rows, setRows] = useState([]);
  // On a wide screen the list floats beside the address, so it never pushes the card's other lines down.
  // On a phone, or with a long list, it sits in the normal flow instead so nothing overlaps.
  const [wide, setWide] = useState(() => { try { return window.matchMedia('(min-width: 720px)').matches; } catch { return false; } });
  useEffect(() => {
    let mq; try { mq = window.matchMedia('(min-width: 720px)'); } catch { return undefined; }
    const on = () => setWide(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  const show = placement === 'bottom' ? !wide : wide;

  const load = useCallback(async () => {
    if (!show || !projectId || !aoKey) return;
    const { data: notices } = await sb.from('notices')
      .select('id, run_number, notice_date, created_at, section_1, section_2, section_3, section_6, section_10, section_2_subsections, delivery_method, posted_letter_id, status')
      .eq('project_id', String(projectId)).eq('ao_id', aoKey).eq('status', 'served')
      .order('notice_date', { ascending: true }).order('run_number', { ascending: true });
    const list = notices || [];
    const ids = list.map(n => n.posted_letter_id).filter(Boolean);
    const letters = {};
    if (ids.length) {
      const { data } = await sb.from('posted_letters').select('id, tracking_number, status, testmode, shipped_at, returned_reason').in('id', ids);
      for (const l of data || []) letters[l.id] = l;
      // Ask the provider for fresh status/tracking on letters that are still moving.
      const { data: { session } } = await sb.auth.getSession();
      await Promise.all((data || []).filter(l => !letterStatusLabel(l.status).final).map(async l => {
        try {
          const res = await fetch(`/api/letter-status?id=${encodeURIComponent(l.id)}`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
          if (res.ok) letters[l.id] = { ...l, ...(await res.json()) };
        } catch { /* keep the saved status */ }
      }));
    }
    // Hard copies posted later for an already-served notice: own letter, own status and tracking.
    const copies = {};
    if (list.length) {
      const { data: copyRows } = await sb.from('posted_letters')
        .select('id, notice_id, created_at, tracking_number, status, testmode, shipped_at, returned_reason')
        .in('notice_id', list.map(n => n.id)).order('created_at', { ascending: true });
      const { data: { session } } = await sb.auth.getSession();
      const fresh = await Promise.all((copyRows || []).map(async l => {
        if (letterStatusLabel(l.status).final) return l;
        try {
          const res = await fetch(`/api/letter-status?id=${encodeURIComponent(l.id)}`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
          return res.ok ? { ...l, ...(await res.json()) } : l;
        } catch { return l; }
      }));
      for (const l of fresh) (copies[l.notice_id] = copies[l.notice_id] || []).push(l);
    }
    setRows(list.map(n => ({ notice: n, letter: n.posted_letter_id ? letters[n.posted_letter_id] || null : null, copies: copies[n.id] || [] })));
  }, [projectId, aoKey, show]);

  useEffect(() => {
    load();
    window.addEventListener('ely:refresh-project-detail', load);
    return () => window.removeEventListener('ely:refresh-project-detail', load);
  }, [load]);

  if (!show || !rows.length) return null;
  const floating = placement === 'side' && rows.length <= 4;
  return (
    <div style={{
      fontSize: 12, color: 'var(--text3)', lineHeight: 1.5,
      ...(placement === 'bottom'
        ? { textAlign: 'left', margin: '10px 0 0', overflowWrap: 'anywhere' }
        : floating
          ? { textAlign: 'right', position: 'absolute', top: '100%', right: 0, marginTop: 4, width: 'max-content', maxWidth: '60vw' }
          : { textAlign: 'right', margin: '4px 0 0' }),
    }}>
      {rows.map(({ notice, letter, copies }) => {
        const info = noticeDeliveryInfo(notice, letter);
        const date = notice.notice_date ? new Date(`${String(notice.notice_date).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB') : '';
        return (
          <div key={notice.id}>
            <span
              role="button" tabIndex={0} title="Open this notice to post a hard copy"
              onClick={() => window.dispatchEvent(new CustomEvent('ely:open-notice-copy', { detail: { noticeId: notice.id, aoKey } }))}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.click(); }}
              style={{ cursor: 'pointer', color: 'var(--accent, #3b82f6)', textDecoration: 'underline' }}
            >
              {noticeSectionsLabel(notice)} served{date ? ` ${date}` : ''}{info.text ? ` · ${info.text}` : ''}
            </span>
            {notice.delivery_method === 'posted' && !letter?.testmode && (info.trackingUrl
              ? <> · Tracking: <a href={info.trackingUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent, #3b82f6)', fontWeight: 600 }}>{info.trackingNumber}</a></>
              : ' · tracking number to follow')}
            {copies.map(c => {
              const ci = noticeDeliveryInfo({ delivery_method: 'posted' }, c);
              return (
                <div key={c.id} style={{ paddingLeft: 12 }}>
                  ↳ Hard copy posted {new Date(c.created_at).toLocaleDateString('en-GB')} · {ci.text}
                  {!c.testmode && (ci.trackingUrl
                    ? <> · Tracking: <a href={ci.trackingUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent, #3b82f6)', fontWeight: 600 }}>{ci.trackingNumber}</a></>
                    : ' · tracking number to follow')}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
