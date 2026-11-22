import React, { useEffect, useState } from 'react';
import PublicNoticeResponse from './PublicNoticeResponse';

export default function PublicNoticeRoute() {
 const token = window.location.pathname.split('/').filter(Boolean)[1] || '';
 const [state,setState]=useState({loading:true,notice:null,error:''});
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
 return <PublicNoticeResponse notice={state.notice}/>;
}
