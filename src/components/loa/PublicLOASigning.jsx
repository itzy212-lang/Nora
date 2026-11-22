import React,{useEffect,useState} from 'react';
export default function PublicLOASigning(){
 const token=window.location.pathname.split('/').filter(Boolean).pop();
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[step,setStep]=useState('sign'),[signature,setSignature]=useState(''),[date,setDate]=useState(new Date().toISOString().slice(0,10)),[authorised,setAuthorised]=useState(false),[code,setCode]=useState('');
 useEffect(()=>{fetch('/api/loa-public?token='+encodeURIComponent(token)).then(async r=>{const x=await r.json();if(!r.ok)throw Error(x.error);setData(x);if(x.status==='verified')setStep('done');}).catch(e=>setError(e.message));},[token]);
 const send=async(path,body)=>{setBusy(true);setError('');try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,...body})});const x=await r.json();if(!r.ok)throw Error(x.error||'Request failed');return x;}catch(e){setError(e.message);return null;}finally{setBusy(false);}};
 const submit=async()=>{const result=await send('/api/loa-submit',{signature,signedDate:date,authorised});if(result)setStep('verify');};
 const verify=async()=>{const result=await send('/api/loa-verify',{code});if(result)setStep('done');};
 const button={padding:'12px 24px',background:'#173b68',color:'#fff',border:0,borderRadius:8,cursor:'pointer',fontWeight:600};
 return <main style={{fontFamily:'Arial,sans-serif',background:'#f4f7fb',minHeight:'100vh',padding:'24px 12px',color:'#192b3d'}}>
 <div style={{maxWidth:1100,margin:'auto'}}>
 <header style={{background:'#153960',color:'white',padding:'18px 24px',borderRadius:10,marginBottom:16}}><strong style={{fontSize:24}}>Nora</strong><span style={{marginLeft:16}}>Letter of Appointment</span></header>
 {error&&<div role="alert" style={{background:'#fff1f0',padding:15,marginBottom:16,borderRadius:8,color:'#a11'}}>{error}</div>}
 {!data&&!error&&<p>Loading your appointment…</p>}
 {data&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,440px),1fr))',gap:16}}>
 <section style={{background:'white',padding:12,borderRadius:10,minHeight:570}}><h3 style={{margin:'8px 10px'}}>Review your appointment</h3><iframe title="Letter of Appointment" src={'/api/loa-public?pdf=1&token='+encodeURIComponent(token)} style={{width:'100%',height:680,border:'1px solid #d9e2ed'}}/></section>
 <section style={{background:'white',padding:24,borderRadius:10,alignSelf:'start'}}>
 <h2>{step==='done'?'Signature confirmed':step==='verify'?'Verify your email':'Sign your Letter of Appointment'}</h2>
 <p><strong>{data.name}</strong></p>
 {step==='sign'&&<><p>Please read the Letter of Appointment before signing. Your electronic signature will be placed in your designated signature area.</p>
 <label style={{display:'block',marginBottom:16}}>Your signature (type your full name)<input value={signature} onChange={e=>setSignature(e.target.value)} maxLength={180} style={{display:'block',width:'100%',boxSizing:'border-box',padding:12,marginTop:8,fontFamily:'cursive',fontSize:24}} placeholder={data.name}/></label>
 <label style={{display:'block',marginBottom:16}}>Date of signature<input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{display:'block',padding:12,marginTop:8,width:'100%',boxSizing:'border-box'}}/></label>
 <label style={{display:'flex',gap:10,alignItems:'start',marginBottom:20}}><input type="checkbox" checked={authorised} onChange={e=>setAuthorised(e.target.checked)}/><span>I have reviewed the appointment, agree to sign it electronically and confirm I am authorised to sign.</span></label>
 <button style={button} disabled={busy||!signature.trim()||!date||!authorised} onClick={submit}>{busy?'Sending…':'Sign and verify by email'}</button></>}
 {step==='verify'&&<><p>A six-digit verification code has been sent to <strong>{data.email}</strong>. Enter it below to confirm your signature.</p><input aria-label="Six-digit verification code" inputMode="numeric" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\\D/g,''))} style={{fontSize:24,letterSpacing:7,padding:12,width:'100%',boxSizing:'border-box',marginBottom:20}}/><button style={button} disabled={busy||code.length!==6} onClick={verify}>{busy?'Verifying…':'Verify signature'}</button><p><button onClick={submit} disabled={busy} style={{border:0,background:'none',textDecoration:'underline',cursor:'pointer'}}>Resend verification code</button></p></>}
 {step==='done'&&<><p>Thank you. Your signature has been verified and recorded.</p><p>{data.completed?'The fully signed Letter of Appointment is available in the document viewer.':'If another party needs to sign, Nora will automatically invite them next.'}</p></>}
 </section></div>}
 </div></main>;
}
