import React, { useState, useEffect } from 'react';

/**
 * Public notice-response screen. A notice must be resolved and validated by
 * the server before this screen can be used for signing or submission.
 * Never infer a notice or expose project documents from a URL slug alone.
 */
export default function PublicNoticeResponse({ notice, onSubmit }) {
  const [choice, setChoice] = useState('');
  const [astrideConsent, setAstrideConsent] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [authorised, setAuthorised] = useState(false);
  const [surveyor, setSurveyor] = useState({ name: '', firm: '', email: '', phone: '', address: '' });
  const [suggestions, setSuggestions] = useState([]);
  const [selectedContact, setSelectedContact] = useState(null);
  const [appointServingSurveyor, setAppointServingSurveyor] = useState(false);
  const [suggestionError, setSuggestionError] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(()=>{
    if(!['dissent_own','dissent_agreed'].includes(choice) || surveyor.name.trim().length<2 || selectedContact){setSuggestions([]);return;}
    const controller=new AbortController();
    const token=window.location.pathname.split('/').filter(Boolean)[1];
    const timer=setTimeout(()=>fetch('/api/notice-response-public?token='+encodeURIComponent(token)+'&surveyorSearch='+encodeURIComponent(surveyor.name),{signal:controller.signal})
      .then(r=>{if(!r.ok)throw Error('Contact search unavailable');return r.json();}).then(data=>{setSuggestions(data.surveyors||[]);setSuggestionError(false);}).catch(e=>{if(e.name!=='AbortError')setSuggestionError(true);}),220);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[choice,surveyor.name,selectedContact]);
  const options = [
    ['consent', 'I consent to the proposed works'],
    ['consent_soc', 'I consent, subject to a Schedule of Condition'],
    ['dissent_agreed', 'I dissent and wish to appoint an agreed surveyor'],
    ['dissent_own', 'I dissent and wish to appoint my own surveyor']
  ];
  const section1 = Boolean(notice?.sections?.section1);
  const section1Astride = section1 && notice?.sections?.section1Astride !== false;
  const existingResponse=notice?.existingResponse;
  const otherSections=Boolean(notice?.sections?.section2||notice?.sections?.section3||notice?.sections?.section6||notice?.sections?.section10);
  const ready = notice && !existingResponse && choice && name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    authorised && (!section1Astride || !['consent','consent_soc'].includes(choice) || !!astrideConsent) && (choice !== 'dissent_own' || (surveyor.name.trim() && surveyor.email.trim()));
  const field = (label, value, change, type = 'text') => (
    <label className="nora-response-field">{label}<input type={type} value={value} onChange={e => change(e.target.value)} /></label>
  );
  async function submit(e) {
    e.preventDefault();
    if (!ready || !onSubmit) return;
    setBusy(true); setError('');
    try {
      await onSubmit({ noticeId: notice.id, choice, astrideConsent: section1Astride && ['consent','consent_soc'].includes(choice) ? astrideConsent : null, name: name.trim(), email: email.trim(), authorised, surveyor: ['dissent_own','dissent_agreed'].includes(choice) ? (choice==='dissent_agreed'&&appointServingSurveyor ? notice.servingSurveyor : surveyor) : null, appointServingSurveyor:choice==='dissent_agreed'&&appointServingSurveyor });
    } catch (err) { setError(err.message || 'Could not submit response'); }
    finally { setBusy(false); }
  }
  return <div className="nora-response">
    <style>{`
      .nora-response{min-height:100vh;background:#f1f5f9;color:#172b46;font:15px/1.5 system-ui,sans-serif}
      .nora-response *{box-sizing:border-box}
      .nora-response-header{background:#fff;color:#0b2346;padding:18px 24px;display:flex;justify-content:center;align-items:center;border-bottom:3px solid #1764d1;min-height:105px}
      .nora-response-header strong{font-size:23px;letter-spacing:2px}
      .nora-response-main{display:block;max-width:900px;margin:28px auto;padding:0 18px}
      .nora-response-panel{background:white;border:1px solid #dce4ef;border-radius:12px;overflow:hidden}
      .nora-response-panel h2{font-size:19px;margin:0 0 8px}
      .nora-response-pdf{display:none}
      .nora-response-pdf iframe{border:0;flex:1;width:100%;background:#f8fafc}
      .nora-response-body{padding:28px}
      .nora-response-field{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:600;margin:12px 0}
      .nora-response-field input{width:100%;padding:11px;border:1px solid #b9c8d8;border-radius:7px;font:inherit}
      .nora-response-option{display:flex;gap:10px;align-items:start;border:1px solid #dce4ef;padding:12px;margin:8px 0;border-radius:8px;cursor:pointer}
      .nora-response-option:has(input:checked){border-color:#1764b1;background:#eff6ff}
      .nora-response-signature{font:italic 30px cursive;min-height:75px;border-bottom:1px solid #94a3b8;padding:15px 8px;color:#1d3557}
      .nora-response-button{background:#0963ce;color:white;padding:17px;width:100%;border:0;border-radius:9px;font-weight:700;font-size:16px;cursor:pointer}
      .nora-preview-button{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;padding:18px 22px;margin:22px 0 30px;border:3px solid #1261d2;border-radius:12px;background:white;color:#0b357a;font:700 19px system-ui,sans-serif;cursor:pointer}
      .nora-preview-button:hover,.nora-preview-button:focus-visible{background:#eff6ff}
      .nora-response-heading{display:flex;align-items:center;gap:15px;margin-bottom:10px}
      .nora-response-heading h1{font-size:29px;line-height:1.15;margin:0;color:#071b39}
      .nora-response-heading p{margin:0;color:#66758b}
      .nora-response-intro{font-size:16px;color:#56647a;margin:12px 0 20px}
      .nora-response-section1{padding:20px;border:1px solid #d8e2f1;background:#f5f8fc;border-radius:12px;margin:24px 0}
      .nora-response-button:disabled{opacity:.5;cursor:not-allowed}
      .nora-response-muted{font-size:12px;color:#64748b}
      @media(max-width:780px){.nora-response-header{min-height:84px;padding:12px}.nora-response-main{margin:16px auto;padding:0 10px}.nora-response-panel{width:100%}.nora-response-body{padding:18px}.nora-response-heading h1{font-size:24px}.nora-preview-button{padding:15px;font-size:17px;margin:18px 0 24px}}
    `}</style>
    <header className="nora-response-header">{notice?.firmLogoUrl ? <img src={notice.firmLogoUrl} alt={notice.firmName || 'Surveyor firm'} style={{maxHeight:70,maxWidth:'min(85vw,360px)',objectFit:'contain'}}/> : <strong style={{fontSize:24,letterSpacing:0}}>{notice?.firmName || 'Party Wall Notices'}</strong>}</header>
    <main className="nora-response-main">
      <form className="nora-response-panel nora-response-body" onSubmit={submit}>
        <div className="nora-response-heading"><span aria-hidden="true" style={{fontSize:38,color:'#1261d2'}}>▤</span><div><p>Notice acknowledgement</p><h1>Party Wall Notice</h1></div></div>
        <p className="nora-response-intro">Please review the notice and select your response below.</p>
        <button className="nora-preview-button" type="button" aria-expanded={previewOpen} onClick={()=>setPreviewOpen(v=>!v)}><span aria-hidden="true">▤</span>{previewOpen ? 'Hide notice preview' : 'Preview notice'}<span aria-hidden="true" style={{marginLeft:'auto'}}>›</span></button>
        {previewOpen && notice?.pdfUrl && <iframe title="Notice preview" src={notice.pdfUrl} style={{width:'100%',height:'55vh',border:'1px solid #dce4ef',borderRadius:8,marginBottom:12}}/>}
        <h2>Your response</h2>
        {existingResponse && <p role="status" style={{padding:12,background:'#eff6ff',borderRadius:8}}>Your previous response has been received and verified. You do not need to sign again for this notice. {existingResponse.signerName ? 'Signed by '+existingResponse.signerName+'.' : ''}</p>}
        <p className="nora-response-muted">Read the notice before selecting your response. The available statutory options will be confirmed for this notice.</p>
        {options.map(([value,label]) => <label key={value} className="nora-response-option"><input type="radio" name="response" value={value} checked={choice===value} onChange={()=>{setChoice(value);setAstrideConsent('');setAppointServingSurveyor(false);setSelectedContact(null);}} disabled={!notice || !!existingResponse}/>{label}</label>)}
        {section1Astride && ['consent','consent_soc'].includes(choice) && <section aria-label="Section 1(2) consent" className="nora-response-section1">
          <h2>Section 1(2): Wall astride the boundary</h2>
          <p>Do you expressly consent to the proposed wall being built astride the boundary?</p>
          {[['agree','Yes, I consent to building astride the boundary'],['refuse','No, I do not consent to building astride the boundary']].map(([v,label])=><label key={v} className="nora-response-option"><input type="radio" name="astrideConsent" checked={astrideConsent===v} onChange={()=>setAstrideConsent(v)}/>{label}</label>)}
          {astrideConsent==='refuse' && <p className="nora-response-muted">Your response to the other works remains as selected above. The Building Owner may consider a wall wholly on their own land under Section 1(5).</p>}
        </section>}
        {choice==='dissent_agreed' && notice?.servingSurveyor?.name && <label className="nora-response-option"><input type="checkbox" checked={appointServingSurveyor} onChange={e=>{setAppointServingSurveyor(e.target.checked);setSuggestions([]);}}/>I wish to appoint {notice.servingSurveyor.name} ({notice.servingSurveyor.firm||'the serving surveyor'}) as the agreed surveyor.</label>}
        {['dissent_own','dissent_agreed'].includes(choice) && !(choice==='dissent_agreed'&&appointServingSurveyor) && <section><h2>{choice==='dissent_agreed'?'Proposed agreed surveyor':'Your appointed surveyor'}</h2>
          {field('Surveyor Name',surveyor.name,v=>{setSelectedContact(null);setSurveyor(s=>({...s,name:v}));})}
          {suggestions.length>0 && <div role="listbox" aria-label="Existing surveyor contacts" style={{border:'1px solid #dce4ef',borderRadius:8}}>{suggestions.map(s=><button type="button" key={s.id} onClick={()=>{setSelectedContact(s.id);setSurveyor({name:s.name||'',firm:s.firm||'',email:s.email||'',phone:s.phone||'',address:''});setSuggestions([]);}} style={{display:'block',width:'100%',padding:10,textAlign:'left',background:'white',border:0,borderBottom:'1px solid #eee',cursor:'pointer'}}>{s.name}{s.firm?' · '+s.firm:''}</button>)}</div>}
          {selectedContact && <p className="nora-response-muted">Existing Nora contact selected. You can edit the fields below.</p>}
          {suggestionError && <p className="nora-response-muted">Contact suggestions are temporarily unavailable. You can enter the details manually.</p>}
          {field('Surveyor Firm',surveyor.firm,v=>setSurveyor(s=>({...s,firm:v})))}
          {field('Email Address',surveyor.email,v=>setSurveyor(s=>({...s,email:v})),'email')}
          {field('Telephone Number',surveyor.phone,v=>setSurveyor(s=>({...s,phone:v})),'tel')}
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
