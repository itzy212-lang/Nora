import React, { useEffect, useState } from 'react';
import PublicNoticeResponse from './PublicNoticeResponse';

export default function PublicNoticeRoute() {
 const token = window.location.pathname.split('/').filter(Boolean)[1] || '';
 const [state,setState]=useState({loading:true,notice:null,error:''});
 const [pending,setPending]=useState(null);
 const [code,setCode]=useState('');
 const [verified,setVerified]=useState(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 async function submit(payload){const response=await fetch('/api/notice-response-submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,token})});const body=await response.json();if(!response.ok)throw Error(body.error||'Could not submit');setPending(body.submissionId);}
 async function verify(e){e.preventDefault();setBusy(true);setError('');try{const response=await fetch('/api/notice-response-verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,submissionId:pending,code})});const body=await response.json();if(!response.ok)throw Error(body.error||'Could not verify');setVerified(body);}catch(e){setError(e.message);}finally{setBusy(false);}}
 useEffect(()=>{
  let active=true;
  if(!/^[A-Za-z0-9_-]{32}$/.test(token)){setState({loading:false,notice:null,error:'Invalid notice link'});return;}
  fetch('/api/notice-response-public?token='+encodeURIComponent(token),{cache:'no-store'})
   .then(async r=>{const body=await r.json();if(!r.ok)throw Error(body.error||'Notice unavailable');return body;})
   .then(body=>{if(active)setState({loading:false,notice:body.notice,error:''});})
   .catch(e=>{if(active)setState({loading:false,notice:null,error:e.message});});
  return ()=>{active=false;};
 },[token]);
 if(state.loading)return <main style={{padding:40,fontFamily:'system-ui'}}>Loading notice…</main>;
 if(state.error)return <main style={{padding:40,fontFamily:'system-ui'}} role="alert"><h1>Notice unavailable</h1><p>{state.error}</p></main>;
 if(verified)return <main style={{padding:40,fontFamily:'system-ui'}}><h1>Response verified</h1><p>Your electronic response has been recorded.</p><p>{verified.documentsSaved ? 'The acknowledgement and audit certificate have been filed.' : 'The acknowledgement documents are awaiting generation.'}</p><p>{verified.emailed ? 'Copies have been emailed.' : 'Email copies have not yet been confirmed as delivered.'}</p></main>;
 if(pending)return <main style={{padding:40,fontFamily:'system-ui',maxWidth:520,margin:'auto'}}><h1>Verify your email</h1><p>Enter the six-digit code sent to your email address.</p><form onSubmit={verify}><input aria-label="Six-digit verification code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e=>setCode(e.target.value)} style={{padding:12,width:'100%'}}/><button disabled={busy||!/^[0-9]{6}$/.test(code)} style={{padding:12,marginTop:12}}>Verify and sign</button></form>{error&&<p role="alert">{error}</p>}</main>;
 return <PublicNoticeResponse notice={state.notice} onSubmit={submit}/>;
}
