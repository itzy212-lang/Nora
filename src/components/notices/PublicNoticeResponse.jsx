import React, { useState } from 'react';

/**
 * Public notice-response screen. A notice must be resolved and validated by
 * the server before this screen can be used for signing or submission.
 * Never infer a notice or expose project documents from a URL slug alone.
 */
export default function PublicNoticeResponse({ notice, onSubmit }) {
  const [choice, setChoice] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [authorised, setAuthorised] = useState(false);
  const [surveyor, setSurveyor] = useState({ name: '', firm: '', email: '', phone: '', address: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const options = [
    ['consent', 'I consent to the proposed works'],
    ['consent_soc', 'I consent, subject to a Schedule of Condition'],
    ['dissent_agreed', 'I dissent and wish to appoint an agreed surveyor'],
    ['dissent_own', 'I dissent and wish to appoint my own surveyor']
  ];
  const section1 = Boolean(notice?.sections?.section1);
  const existingResponse=notice?.existingResponse;
  const ready = notice && !existingResponse && choice && name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    authorised && (choice !== 'dissent_own' || (surveyor.name.trim() && surveyor.email.trim()));
  const field = (label, value, change, type = 'text') => (
    <label className="nora-response-field">{label}<input type={type} value={value} onChange={e => change(e.target.value)} /></label>
  );
  async function submit(e) {
    e.preventDefault();
    if (!ready || !onSubmit) return;
    setBusy(true); setError('');
    try {
      await onSubmit({ noticeId: notice.id, choice, name: name.trim(), email: email.trim(), authorised, surveyor: choice === 'dissent_own' ? surveyor : null });
    } catch (err) { setError(err.message || 'Could not submit response'); }
    finally { setBusy(false); }
  }
  return <div className="nora-response">
    <style>{`
      .nora-response{min-height:100vh;background:#f1f5f9;color:#172b46;font:15px/1.5 system-ui,sans-serif}
      .nora-response *{box-sizing:border-box}
      .nora-response-header{background:#173454;color:white;padding:16px 24px;display:flex;justify-content:space-between;align-items:center}
      .nora-response-header strong{font-size:23px;letter-spacing:2px}
      .nora-response-main{display:grid;grid-template-columns:minmax(0,1fr) minmax(350px,460px);gap:20px;max-width:1450px;margin:20px auto;padding:0 18px;align-items:start}
      .nora-response-panel{background:white;border:1px solid #dce4ef;border-radius:12px;overflow:hidden}
      .nora-response-panel h2{font-size:19px;margin:0 0 8px}
      .nora-response-pdf{height:calc(100vh - 130px);min-height:550px;position:sticky;top:16px;display:flex;flex-direction:column}
      .nora-response-pdf iframe{border:0;flex:1;width:100%;background:#f8fafc}
      .nora-response-body{padding:22px}
      .nora-response-field{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:600;margin:12px 0}
      .nora-response-field input{width:100%;padding:11px;border:1px solid #b9c8d8;border-radius:7px;font:inherit}
      .nora-response-option{display:flex;gap:10px;align-items:start;border:1px solid #dce4ef;padding:12px;margin:8px 0;border-radius:8px;cursor:pointer}
      .nora-response-option:has(input:checked){border-color:#1764b1;background:#eff6ff}
      .nora-response-signature{font:italic 30px cursive;min-height:75px;border-bottom:1px solid #94a3b8;padding:15px 8px;color:#1d3557}
      .nora-response-button{background:#1764b1;color:white;padding:14px;width:100%;border:0;border-radius:8px;font-weight:700;cursor:pointer}
      .nora-response-button:disabled{opacity:.5;cursor:not-allowed}
      .nora-response-muted{font-size:12px;color:#64748b}
      @media(max-width:780px){.nora-response-main{display:flex;flex-direction:column;margin:10px auto;padding:0 10px}.nora-response-panel{width:100%}.nora-response-pdf{position:static;height:auto;min-height:0}.nora-response-pdf iframe{height:65vh;min-height:420px;flex:none}.nora-response-body{padding:17px}}
    `}</style>
    <header className="nora-response-header"><strong>NORA</strong><span>Party Wall Notice Response</span></header>
    <main className="nora-response-main">
      <section className="nora-response-panel nora-response-pdf" aria-label="Notice PDF">
        <div className="nora-response-body"><h2>Read your notice</h2><div className="nora-response-muted">{notice?.reference || 'Notice reference unavailable'}</div></div>
        {notice?.pdfUrl ? <iframe title="Original served notice" src={notice.pdfUrl} /> :
          <div className="nora-response-body" role="status">This notice is not available. Please use the unique link supplied with your notice.</div>}
      </section>
      <form className="nora-response-panel nora-response-body" onSubmit={submit}>
        <h2>Your response</h2>
        {existingResponse && <p role="status" style={{padding:12,background:'#eff6ff',borderRadius:8}}>Your previous response has been received and verified. You do not need to sign again for this notice. {existingResponse.signerName ? 'Signed by '+existingResponse.signerName+'.' : ''}</p>}
        <p className="nora-response-muted">Read the notice before selecting your response. The available statutory options will be confirmed for this notice.</p>
        {section1 && <p className="nora-response-muted">For a Section 1(2) notice, confirm whether you agree to the proposed wall being built astride the boundary. If you do not agree, the building owner may proceed with a wall wholly on their own land under Section 1(5).</p>}
        {(section1 ? [...options,['section1_agree','I agree to the proposed wall being built astride the boundary under Section 1(2)'],['section1_refuse','I do not agree to building astride the boundary under Section 1(2)']] : options).map(([value,label]) => <label key={value} className="nora-response-option"><input type="radio" name="response" value={value} checked={choice===value} onChange={()=>setChoice(value)} disabled={!notice || !!existingResponse}/>{label}</label>)}
        {choice === 'dissent_own' && <section><h2>Your appointed surveyor</h2>
          {field('Surveyor name',surveyor.name,v=>setSurveyor(s=>({...s,name:v})))}
          {field('Practice',surveyor.firm,v=>setSurveyor(s=>({...s,firm:v})))}
          {field('Email',surveyor.email,v=>setSurveyor(s=>({...s,email:v})),'email')}
          {field('Telephone',surveyor.phone,v=>setSurveyor(s=>({...s,phone:v})),'tel')}
          {field('Address',surveyor.address,v=>setSurveyor(s=>({...s,address:v})))}
        </section>}
        {!existingResponse && <><h2>Electronic signature</h2>
        {field('Your full legal name',name,setName)}
        <div className="nora-response-signature" aria-label="Signature preview">{name || 'Your signature appears here'}</div>
        <p className="nora-response-muted">Typing your name and confirming below expresses your intention to sign electronically.</p>
        {field('Email address',email,setEmail,'email')}
        <label className="nora-response-option"><input type="checkbox" checked={authorised} onChange={e=>setAuthorised(e.target.checked)} />I confirm I am the adjoining owner or authorised to respond and intend this electronic signature to authenticate my response.</label>
        <button className="nora-response-button" disabled={!ready || !onSubmit || busy}>{busy?'Submitting…':'Sign and submit response'}</button>
        {error && <p role="alert">{error}</p>}
        <p className="nora-response-muted">Submission will require server-side notice validation and email verification before a signed certificate is issued.</p></>}
      </form>
    </main>
  </div>;
}
