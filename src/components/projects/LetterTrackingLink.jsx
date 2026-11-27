// Shows the latest tracked letter posted to an adjoining owner, with a link that opens Royal Mail's
// tracking page already filled in. The tracking number only exists once Intelliprint has the letter, so
// if it is missing we ask the server to refresh it (api/letter-status.js). Nothing shows until a letter
// has been posted. Works for every user: reads the user's own posted_letters rows (row-level security).
import { useCallback, useEffect, useState } from 'react';
import sb from '../../supabaseClient';
import { royalMailTrackingUrl, letterStatusLabel } from '../../../api/lib/letter-post.js';

export default function LetterTrackingLink({ projectId, ao }) {
  const aoKey = String(ao?.id || ao?.num || '');
  const [letter, setLetter] = useState(null);

  const load = useCallback(async () => {
    if (!projectId || !aoKey) return;
    const { data } = await sb.from('posted_letters').select('id, tracking_number, status, testmode, created_at')
      .eq('project_id', String(projectId)).eq('ao_id', aoKey).order('created_at', { ascending: false }).limit(1);
    let row = data?.[0] || null;
    if (row && !letterStatusLabel(row.status).final) {
      try {
        const { data: { session } } = await sb.auth.getSession();
        const res = await fetch(`/api/letter-status?id=${encodeURIComponent(row.id)}`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
        if (res.ok) row = { ...row, ...(await res.json()) };
      } catch { /* the card still shows the posted date */ }
    }
    setLetter(row);
  }, [projectId, aoKey]);

  useEffect(() => {
    load();
    window.addEventListener('ely:refresh-project-detail', load);
    return () => window.removeEventListener('ely:refresh-project-detail', load);
  }, [load]);

  if (!letter) return null;
  const url = royalMailTrackingUrl(letter.tracking_number);
  const posted = new Date(letter.created_at).toLocaleDateString('en-GB');
  return (
    <div style={{ fontSize: 12, color: 'var(--text3)', margin: '2px 0 6px' }}>
      {letter.testmode ? 'Test letter' : letterStatusLabel(letter.status).label} · sent from Nora {posted}
      {url
        ? <> · Tracking: <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent, #3b82f6)', fontWeight: 600 }}>{letter.tracking_number}</a></>
        : ' · tracking number to follow'}
    </div>
  );
}
