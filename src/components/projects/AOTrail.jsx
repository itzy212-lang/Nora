// src/components/projects/AOTrail.jsx
//
// The dated timeline on an adjoining owner's card: Letter of Authority, every notice served (with how it was
// delivered, and any hard copy posted later), Section 10, 10(4)(b), the Schedule of Condition, the draft award
// and the served award. It reads what Nora already stores, so it works the same for every user, whichever mail
// or storage provider they use. Wide screens: a panel on the right under the status. Phones: at the bottom.
import { useCallback, useEffect, useState } from 'react';
import sb from '../../supabaseClient';
import { noticeSectionsLabel, noticeDeliveryInfo } from '../../../api/lib/notice-activity.js';
import { letterStatusLabel } from '../../../api/lib/letter-post.js';

const GREEN = '#22c55e', AMBER = '#f59e0b', BLUE = '#3b82f6', RED = '#ef4444', GREY = '#94a3b8';

const fmtDate = v => {
  if (!v) return '';
  const d = new Date(String(v).length <= 10 ? `${String(v).slice(0, 10)}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB');
};
const tsOf = v => { const t = new Date(v || 0).getTime(); return Number.isFinite(t) ? t : 0; };
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// SOC reports are read through the server (the table is not readable from the browser); share one request per project.
const socCache = new Map();
function loadSocReports(projectId, force = false) {
  const hit = socCache.get(projectId);
  if (!force && hit && Date.now() - hit.at < 20000) return hit.promise;
  const promise = (async () => {
    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(`/api/soc-generated?project_id=${encodeURIComponent(projectId)}`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      return res.ok ? (await res.json()).reports || [] : [];
    } catch { return []; }
  })();
  socCache.set(projectId, { at: Date.now(), promise });
  return promise;
}

function socForAO(reports, ao, aoKey) {
  const addrs = [ao?.premise, ao?.address, ao?.reg_addr, ao?.service_address].map(norm).filter(a => a.length > 6);
  return reports.find(r => {
    if (r.ao_id) return String(r.ao_id) === aoKey;
    const ra = norm(r.ao_address);
    return ra.length > 6 && addrs.some(a => a === ra || a.includes(ra) || ra.includes(a));
  }) || null;
}

function Link({ children, onClick, href }) {
  const style = { color: 'var(--blue)', fontWeight: 600, textDecoration: 'none', cursor: 'pointer' };
  if (href) return <a href={href} target="_blank" rel="noreferrer" style={style}>{children}</a>;
  return <span role="button" tabIndex={0} onClick={onClick} onKeyDown={e => { if (e.key === 'Enter') onClick?.(); }} style={style}>{children}</span>;
}

export default function AOTrail({ projectId, ao, loaRequest = null, onOpenSOC, placement = 'side' }) {
  const aoKey = String(ao?.id || ao?.num || '');
  const [notices, setNotices] = useState([]);
  const [soc, setSoc] = useState(null);
  const [wide, setWide] = useState(() => { try { return window.matchMedia('(min-width: 720px)').matches; } catch { return false; } });
  useEffect(() => {
    let mq; try { mq = window.matchMedia('(min-width: 720px)'); } catch { return undefined; }
    const on = () => setWide(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  // The card renders one instance for each placement; only the one that fits the screen shows and loads.
  const show = placement === 'bottom' ? !wide : wide;

  const load = useCallback(async (force = false) => {
    if (!show || !projectId || !aoKey) return;
    const { data: rows } = await sb.from('notices')
      .select('id, run_number, notice_date, created_at, section_1, section_2, section_3, section_6, section_10, section_2_subsections, delivery_method, posted_letter_id, status')
      .eq('project_id', String(projectId)).eq('ao_id', aoKey).eq('status', 'served')
      .order('notice_date', { ascending: true }).order('run_number', { ascending: true });
    const list = rows || [];
    const { data: { session } } = await sb.auth.getSession();
    const refresh = async l => {
      if (letterStatusLabel(l.status).final) return l;
      try {
        const res = await fetch(`/api/letter-status?id=${encodeURIComponent(l.id)}`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
        return res.ok ? { ...l, ...(await res.json()) } : l;
      } catch { return l; }
    };
    const letters = {};
    const ids = list.map(n => n.posted_letter_id).filter(Boolean);
    if (ids.length) {
      const { data } = await sb.from('posted_letters').select('id, tracking_number, status, testmode, shipped_at, returned_reason').in('id', ids);
      for (const l of await Promise.all((data || []).map(refresh))) letters[l.id] = l;
    }
    const copies = {};
    if (list.length) {
      const { data: copyRows } = await sb.from('posted_letters')
        .select('id, notice_id, created_at, tracking_number, status, testmode, shipped_at, returned_reason')
        .in('notice_id', list.map(n => n.id)).order('created_at', { ascending: true });
      for (const l of await Promise.all((copyRows || []).map(refresh))) (copies[l.notice_id] = copies[l.notice_id] || []).push(l);
    }
    setNotices(list.map(n => ({ notice: n, letter: n.posted_letter_id ? letters[n.posted_letter_id] || null : null, copies: copies[n.id] || [] })));
    setSoc(socForAO(await loadSocReports(String(projectId), force), ao, aoKey));
  }, [projectId, aoKey, show, ao]);

  useEffect(() => {
    load();
    const again = () => load(true);
    window.addEventListener('ely:refresh-project-detail', again);
    return () => window.removeEventListener('ely:refresh-project-detail', again);
  }, [load]);

  if (!show) return null;

  // ── Build the rows ───────────────────────────────────────────────────────────────────────────
  const rows = [];

  // Letter of Authority. Signed: just "LOA signed". Otherwise the sent date and who has signed.
  const signers = [...(loaRequest?.loa_signers || [])].sort((a, b) => a.position - b.position);
  const loaSigned = loaRequest ? loaRequest.status === 'completed' : !!ao?.loa_signed_at;
  const loaSent = ao?.loa_sent_at || loaRequest?.created_at || null;
  if (loaSigned) {
    rows.push({ key: 'loa', ts: tsOf(loaSent) || 1, dot: GREEN, label: 'LOA signed',
      onClick: ao?.loa_signed_pdf_url ? () => window.open(ao.loa_signed_pdf_url, '_blank') : null });
  } else if (loaSent || loaRequest) {
    rows.push({ key: 'loa', ts: tsOf(loaSent) || 1, dot: AMBER, label: 'LOA sent', date: fmtDate(loaSent),
      sub: signers.length ? signers.map(sg => ({ text: `AO${sg.position}`, ok: sg.status === 'verified' })) : null });
  }

  // Notices served, each with its delivery and any hard copy posted afterwards.
  let s10Row = false;
  for (const { notice, letter, copies } of notices) {
    const info = noticeDeliveryInfo(notice, letter);
    if (notice.section_10) s10Row = true;
    const branches = copies.map(c => {
      const ci = noticeDeliveryInfo({ delivery_method: 'posted' }, c);
      return { key: c.id, label: 'Hard copy posted', date: fmtDate(c.created_at), text: ci.text, tracking: c.testmode ? null : ci };
    });
    rows.push({
      key: `n-${notice.id}`, ts: tsOf(notice.notice_date) || tsOf(notice.created_at), dot: GREEN,
      label: `${noticeSectionsLabel(notice)} served`, date: fmtDate(notice.notice_date),
      text: info.text, tracking: notice.delivery_method === 'posted' && !letter?.testmode ? info : null,
      onClick: () => window.dispatchEvent(new CustomEvent('ely:open-notice-copy', { detail: { noticeId: notice.id, aoKey } })),
      title: 'Open this notice to post a hard copy', branches,
    });
  }

  // Dates held on the owner itself.
  const s10 = ao?.s10_served_date || ao?.s10ServedDate;
  if (s10 && !s10Row) rows.push({ key: 's10', ts: tsOf(s10), dot: GREEN, label: 'Section 10 notice served', date: fmtDate(s10) });
  const s104b = ao?.s104b_served_date || ao?.s104bServedDate;
  if (s104b) rows.push({ key: 's104b', ts: tsOf(s104b), dot: GREEN, label: 'Section 10(4)(b) served', date: fmtDate(s104b) });
  if (soc) rows.push({ key: 'soc', ts: tsOf(soc.created_at), dot: BLUE, label: 'SOC generated', date: fmtDate(soc.created_at), onClick: () => onOpenSOC?.(ao), title: 'Open the Schedule of Condition editor' });
  const drafted = ao?.award_generated_at || ao?.awardGeneratedAt;
  if (drafted) rows.push({ key: 'draft', ts: tsOf(drafted), dot: BLUE, label: 'Draft award created', date: fmtDate(drafted) });
  const awardServed = ao?.award_served_date || ao?.awardServedDate;
  if (awardServed) rows.push({ key: 'award', ts: tsOf(awardServed), dot: GREEN, label: 'Award served', date: fmtDate(awardServed) });
  const dissent = ao?.dissent_received_date || ao?.dissentReceivedDate;
  if (dissent) rows.push({ key: 'dissent', ts: tsOf(dissent), dot: AMBER, label: 'Dissent received', date: fmtDate(dissent) });

  if (!rows.length) return null;
  rows.sort((a, b) => a.ts - b.ts);

  // Second line under a row: how it was delivered, and the tracking link for a posted letter.
  const metaLine = (text, t) => {
    if (!text && !t) return null;
    return (
      <div style={{ color: 'var(--text2)', fontSize: 12 }}>
        {text}
        {t && (t.trackingUrl
          ? <>{text ? ' · ' : ''}Tracking: <Link href={t.trackingUrl}>{t.trackingNumber}</Link></>
          : <span style={{ color: 'var(--text3)' }}>{text ? ' · ' : ''}tracking to follow</span>)}
      </div>
    );
  };

  const isSide = placement === 'side';
  return (
    <div style={{
      ...(isSide ? { float: 'right', width: 300, maxWidth: '46%', margin: '2px 0 10px 16px' } : { margin: '12px 0 0' }),
      background: 'var(--bg2, #f6f7f9)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 12, padding: '10px 12px 8px',
      fontSize: 12.5, lineHeight: 1.45, textAlign: 'left', boxSizing: 'border-box',
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.7px', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>Progress</div>
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', left: 4.5, top: 9, bottom: 9, width: 2, background: 'var(--border, #e2e5ea)', borderRadius: 2 }} />
        {rows.map(r => (
          <div key={r.key} style={{ position: 'relative', padding: '3px 0' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: r.dot, border: '2px solid var(--bg2, #f6f7f9)', boxSizing: 'content-box', marginTop: 3, flexShrink: 0, zIndex: 1 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    {r.onClick ? <Link onClick={r.onClick}>{r.label}</Link> : <span style={{ fontWeight: 600, color: 'var(--text)' }}>{r.label}</span>}
                  </span>
                  {r.date ? <span style={{ color: 'var(--text3)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{r.date}</span> : null}
                </div>
                {metaLine(r.text, r.tracking)}
                {r.sub ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                    {r.sub.map(s => (
                      <span key={s.text} style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 99,
                        background: s.ok ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.14)', color: s.ok ? '#15803d' : '#b45309' }}>
                        {s.text} {s.ok ? '✓ signed' : 'pending'}
                      </span>
                    ))}
                  </div>
                ) : null}
                {(r.branches || []).map(b => (
                  <div key={b.key} style={{ marginTop: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--text)' }}>
                      <span style={{ fontWeight: 600 }}><span style={{ color: 'var(--text3)', fontWeight: 400 }}>↳ </span>{b.label}</span>
                      <span style={{ color: 'var(--text3)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{b.date}</span>
                    </div>
                    <div style={{ paddingLeft: 14 }}>{metaLine(b.text, b.tracking)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
