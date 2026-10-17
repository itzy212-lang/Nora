// Added 2026-10-17, on request: attach a file to an email straight from the
// project's OneDrive folder, instead of scrolling a device file picker (which
// is slow, and painful on a phone). Opens at the linked project's folder; with
// no linked project/folder it opens at the top of OneDrive. Tap a folder to go
// in, tick files, Attach. Returns files as {name,type,size,base64}.
import { useState, useEffect } from 'react';
import sb from '../../supabaseClient';
import { getCurrentUserEmail } from '../../utils/getCurrentUserEmail';

// base64 inflates by a third and Vercel caps a response at 4.5 MB.
export const MAX_PICK_BYTES = 3 * 1024 * 1024;

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Today ${time}` : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} ${time}`;
};
const fmtSize = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`;

export default function ProjectFilePicker({ projectId, onAttach, onClose }) {
  const [trail, setTrail] = useState(null);       // [{id,name}] once the start folder is known
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState({});       // id -> item
  const [busy, setBusy] = useState(false);

  // Work out where to start: the linked project's OneDrive folder, else the top.
  useEffect(() => {
    let off = false;
    (async () => {
      let start = { id: 'root', name: 'OneDrive' };
      try {
        if (projectId && sb) {
          const { data } = await sb.from('projects').select('onedrive_folder_id, bo_premise_address').eq('id', projectId).maybeSingle();
          if (data?.onedrive_folder_id) start = { id: data.onedrive_folder_id, name: data.bo_premise_address || 'Project folder' };
        }
      } catch { /* fall back to the top of OneDrive */ }
      if (!off) setTrail([start]);
    })();
    return () => { off = true; };
  }, [projectId]);

  const current = trail?.[trail.length - 1];

  useEffect(() => {
    if (!current) return;
    let off = false;
    setLoading(true); setErr('');
    (async () => {
      try {
        const userEmail = await getCurrentUserEmail();
        if (!userEmail) throw new Error('Could not determine your account - please refresh and try again.');
        const res = await fetch('/api/onedrive-folder', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userEmail, action: 'get_folder_contents', project_folder_id: current.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || 'Could not open this folder');
        const list = data.items || [];
        // Folders first (A-Z), then files newest first - the file you just saved is on top.
        list.sort((a, b) => (!!b.folder - !!a.folder)
          || (a.folder ? String(a.name).localeCompare(String(b.name))
                       : new Date(b.lastModifiedDateTime || 0) - new Date(a.lastModifiedDateTime || 0)));
        if (!off) setItems(list);
      } catch (e) { if (!off) { setErr(e.message); setItems([]); } }
      if (!off) setLoading(false);
    })();
    return () => { off = true; };
  }, [current?.id]);

  const toggle = (it) => setPicked(p => { const n = { ...p }; if (n[it.id]) delete n[it.id]; else n[it.id] = it; return n; });
  const count = Object.keys(picked).length;

  const attach = async () => {
    setBusy(true); setErr('');
    try {
      const userEmail = await getCurrentUserEmail();
      const files = [];
      for (const it of Object.values(picked)) {
        const r = await fetch(`/api/onedrive-download?item_id=${encodeURIComponent(it.id)}&user_id=${encodeURIComponent(userEmail)}`);
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.base64) throw new Error(`${it.name}: ${d.error || 'could not be fetched'}`);
        files.push({ name: d.name || it.name, type: d.mimeType || 'application/octet-stream', size: it.size || 0, base64: d.base64 });
      }
      onAttach(files);
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10050, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: 460, maxWidth: '100%', maxHeight: '86vh', display: 'flex', flexDirection: 'column', background: 'var(--bg, #fff)', color: 'var(--text)', borderRadius: 14, border: '1px solid var(--border)', padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>📁 Attach from project files</div>
        <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(trail || []).map((t, i) => (
            <span key={t.id + i}>
              <button onClick={() => setTrail(trail.slice(0, i + 1))} disabled={i === trail.length - 1}
                style={{ background: 'none', border: 'none', padding: 0, fontSize: 11.5, cursor: i === trail.length - 1 ? 'default' : 'pointer', color: i === trail.length - 1 ? 'var(--text)' : 'var(--blue)', fontWeight: i === trail.length - 1 ? 700 : 500 }}>{t.name}</button>
              {i < trail.length - 1 && ' / '}
            </span>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 120, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 8 }}>
          {loading && <div style={{ padding: 12, fontSize: 12, color: 'var(--text3)' }}>Loading…</div>}
          {!loading && err && <div style={{ padding: 12, fontSize: 12, color: '#c0392b' }}>{err}</div>}
          {!loading && !err && items.length === 0 && <div style={{ padding: 12, fontSize: 12, color: 'var(--text3)' }}>Nothing in this folder.</div>}
          {!loading && items.map(it => {
            const isFolder = !!it.folder;
            const tooBig = !isFolder && (it.size || 0) > MAX_PICK_BYTES;
            return (
              <div key={it.id} onClick={() => isFolder ? setTrail([...trail, { id: it.id, name: it.name }]) : (!tooBig && toggle(it))}
                style={{ padding: '10px 12px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', cursor: tooBig ? 'not-allowed' : 'pointer', opacity: tooBig ? 0.5 : 1, background: picked[it.id] ? 'var(--blue-bg, #eef4ff)' : 'transparent' }}>
                <span>{isFolder ? '📁' : (picked[it.id] ? '☑️' : '📄')}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', wordBreak: 'break-word' }}>{it.name}</span>
                  {!isFolder && <span style={{ display: 'block', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                    {fmtDate(it.lastModifiedDateTime)} · {tooBig ? 'over 3 MB - too large' : fmtSize(it.size)}
                  </span>}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} disabled={busy} style={{ flex: 1, padding: 10, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg3)', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={attach} disabled={!count || busy} style={{ flex: 2, padding: 10, borderRadius: 10, border: 'none', background: count ? 'var(--blue)' : 'var(--bg3)', color: count ? '#fff' : 'var(--text3)', cursor: count ? 'pointer' : 'default', fontSize: 13, fontWeight: 600 }}>
            {busy ? 'Adding…' : count ? `Attach ${count} file${count > 1 ? 's' : ''}` : 'Tick files to attach'}
          </button>
        </div>
      </div>
    </div>
  );
}
