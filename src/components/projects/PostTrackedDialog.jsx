// Post the current notice pack to the adjoining owner as a Tracked letter (Intelliprint).
// Shows the page count and the price (before VAT) before anything is sent, and the tracking link after.
// The price rules live in api/lib/letter-post.js, the one place they are defined; the server checks
// them again and refuses if they differ. Works for every user: it does not depend on the user's email
// or storage provider.
import { useMemo, useState } from 'react';
import sb from '../../supabaseClient';
import { MAX_SHEETS, letterPriceBreakdown, formatPounds, splitUkPostcode } from '../../../api/lib/letter-post.js';

const MAX_PDF_BYTES = 3 * 1024 * 1024; // the request limit is about 4.5MB and base64 adds a third

const field = { width: '100%', boxSizing: 'border-box', padding: '9px 10px', background: '#0f1117', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 14, marginBottom: 12 };
const label = { display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 };
const button = (kind, disabled) => ({
  padding: '9px 16px', borderRadius: 7, fontSize: 14, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
  border: kind === 'primary' ? 'none' : '1px solid #334155', background: kind === 'primary' ? '#2563eb' : 'transparent', color: kind === 'primary' ? '#fff' : '#cbd5e1',
});

export default function PostTrackedDialog({ pdfB64, pageCount, ao, project, fileName, onClose }) {
  const initial = useMemo(() => splitUkPostcode(ao?.service_address || ao?.serviceAddress || ao?.reg_addr || ao?.premise || ao?.address || ''), [ao]);
  const [name, setName] = useState(ao?.name || '');
  const [line, setLine] = useState(initial.line);
  const [postcode, setPostcode] = useState(initial.postcode);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const tooMany = pageCount > MAX_SHEETS;
  const tooBig = (pdfB64?.length || 0) * 0.75 > MAX_PDF_BYTES;
  const price = !tooMany && pageCount >= 1 ? letterPriceBreakdown(pageCount) : null;
  const canSend = !!price && !tooBig && line.trim() && postcode.trim() && !sending && !result;

  const send = async () => {
    setSending(true); setError('');
    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch('/api/send-tracked-letter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          pdf_b64: pdfB64, project_id: project?.id, ao_id: ao?.id || ao?.num || '', recipient_name: name,
          address_line: line, postcode, expected_price_pence: price.net, file_name: fileName || 'notice.pdf',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'The letter could not be sent');
      setResult(json);
      window.dispatchEvent(new CustomEvent('ely:refresh-project-detail'));
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#161820', border: '1px solid #2a2d3a', borderRadius: 12, padding: 22, width: 'min(480px, 100%)', maxHeight: '92vh', overflowY: 'auto', color: '#e2e8f0' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 17 }}>Post as a tracked letter</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#94a3b8' }}>Printed single-sided and posted by Royal Mail with a tracking number.</p>

        {result ? (
          <>
            <div style={{ padding: 12, background: '#10261a', border: '1px solid #1f6b3a', borderRadius: 8, fontSize: 14, marginBottom: 12 }}>
              {result.testmode ? 'Test letter created. Nothing was printed, posted or charged.' : 'Letter sent to be printed and posted.'}
              <div style={{ marginTop: 6, color: '#cbd5e1' }}>{result.sheets} pages, {formatPounds(result.price.net)} + VAT</div>
              <div style={{ marginTop: 6, color: '#cbd5e1' }}>
                {result.tracking_number
                  ? <>Tracking: <a href={result.tracking_url} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>{result.tracking_number}</a></>
                  : 'The tracking number appears on the adjoining owner card once the letter has been posted.'}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button style={button('primary')} onClick={onClose}>Done</button></div>
          </>
        ) : (
          <>
            <label style={label}>Recipient name</label>
            <input style={field} value={name} onChange={e => setName(e.target.value)} />
            <label style={label}>Address</label>
            <input style={field} value={line} onChange={e => setLine(e.target.value)} placeholder="Number, street, town" />
            <label style={label}>Postcode</label>
            <input style={field} value={postcode} onChange={e => setPostcode(e.target.value)} />

            {tooMany && <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>This pack has {pageCount} pages. A letter can have at most {MAX_SHEETS}.</div>}
            {tooBig && <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>This pack is too large to post from here. Remove or shrink a drawing and try again.</div>}
            {price && (
              <div style={{ padding: 12, background: '#0f1117', border: '1px solid #2a2d3a', borderRadius: 8, fontSize: 14, marginBottom: 12 }}>
                {pageCount} page{pageCount === 1 ? '' : 's'}: <b>{formatPounds(price.net)}</b> + VAT ({formatPounds(price.gross)} with VAT)
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>£3.32 for the first page, then 6p for each extra page.</div>
              </div>
            )}
            {error && <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button style={button('ghost', sending)} disabled={sending} onClick={onClose}>Cancel</button>
              <button style={button('primary', !canSend)} disabled={!canSend} onClick={send}>{sending ? 'Sending…' : 'Post tracked letter'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
