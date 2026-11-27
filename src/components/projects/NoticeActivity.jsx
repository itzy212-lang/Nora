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

export default function NoticeActivity({ projectId, ao }) {
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

  const load = useCallback(async () => {
    if (!projectId || !aoKey) return;
    const { data: notices } = await sb.from('notices')
      .select('id, run_number, notice_date, created_at, section_1, section_2, section_3, section_6, section_10, section_2_subsections, delivery_method, posted_letter_id, status')
      .eq('project_id', String(projectId)).eq('ao_id', aoKey).eq('status', 'served')
      .order('notice_date', { ascending: true }).order('run_number', { ascending: true });
    const list = notices || [];
    const ids = list.map(n => n.posted_letter_id).filter(Boolean);
    const letters = {};
    if (ids.length) {
      const { data } = await sb.from('posted_letters').select('id, tracking_number, status, testmode').in('id', ids);
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
    setRows(list.map(n => ({ notice: n, letter: n.posted_letter_id ? letters[n.posted_letter_id] || null : null })));
  }, [projectId, aoKey]);

  useEffect(() => {
    load();
    window.addEventListener('ely:refresh-project-detail', load);
    return () => window.removeEventListener('ely:refresh-project-detail', load);
  }, [load]);

  if (!rows.length) return null;
  const floating = wide && rows.length <= 4;
  return (
    <div style={{
      fontSize: 12, color: 'var(--text3)', textAlign: 'right', lineHeight: 1.5,
      ...(floating ? { position: 'absolute', top: '100%', right: 0, marginTop: 4, width: 'max-content', maxWidth: '60vw' } : { margin: '4px 0 0' }),
    }}>
      {rows.map(({ notice, letter }) => {
        const info = noticeDeliveryInfo(notice, letter);
        const date = notice.notice_date ? new Date(`${String(notice.notice_date).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB') : '';
        return (
          <div key={notice.id}>
            {noticeSectionsLabel(notice)} served{date ? ` ${date}` : ''}
            {info.text && <> · {info.text}</>}
            {notice.delivery_method === 'posted' && !letter?.testmode && (info.trackingUrl
              ? <> · Tracking: <a href={info.trackingUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent, #3b82f6)', fontWeight: 600 }}>{info.trackingNumber}</a></>
              : ' · tracking number to follow')}
          </div>
        );
      })}
    </div>
  );
}
