import { useEffect, useRef, useState } from 'react';
import PMProjectDetail from './PMProjectDetail';
import DisputeResolution from './DisputeResolution';

const labels=['Overview','Scope','Rooms','Programme','Site Log','Snagging','Payments','Materials','Subcontractors','Financials','Emails','Documents','Portal'];

export default function PMProjectDetailEnhanced(props){
 const {project,onBack}=props;
 const legacyRef=useRef(null);
 const [mode,setMode]=useState('project');
 const [mobileOpen,setMobileOpen]=useState(false);
 const [activeLabel,setActiveLabel]=useState('Overview');
 const clickLegacy=(label)=>{setMode('project');setActiveLabel(label);setMobileOpen(false);requestAnimationFrame(()=>{const buttons=[...(legacyRef.current?.querySelectorAll('button')||[])];const b=buttons.find(x=>x.textContent.trim()===label);b?.click();});};
 useEffect(()=>{const onResize=()=>{if(window.innerWidth>760)setMobileOpen(false);};window.addEventListener('resize',onResize);return()=>window.removeEventListener('resize',onResize);},[]);
 return <div className="pm-enhanced" style={{height:'100%',display:'flex',flexDirection:'column',minHeight:0}}>
  <style>{`@media(max-width:760px){.pm-enhanced .pm-legacy>div>div:first-child>div:last-child{display:none!important}.pm-enhanced .desktop-dispute-tab{display:none!important}.pm-enhanced .mobile-project-menu{display:block!important}}@media(min-width:761px){.pm-enhanced .mobile-project-menu{display:none!important}}`}</style>
  <div className="mobile-project-menu" style={{display:'none',background:'var(--bg)',borderBottom:'1px solid var(--border)',padding:'8px 12px',position:'relative',zIndex:40}}>
   <button onClick={()=>setMobileOpen(v=>!v)} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 12px',border:'1px solid var(--border)',borderRadius:10,background:'var(--bg2)',color:'var(--text)',fontSize:13,fontWeight:700,cursor:'pointer'}}><span>☰ {mode==='dispute'?'Dispute Resolution':activeLabel}</span><span>{mobileOpen?'▲':'▼'}</span></button>
   {mobileOpen&&<div style={{position:'absolute',left:12,right:12,top:'calc(100% - 4px)',background:'var(--bg)',border:'1px solid var(--border)',borderRadius:12,padding:6,boxShadow:'0 10px 30px rgba(0,0,0,.12)',maxHeight:'65vh',overflowY:'auto'}}>{labels.map(l=><button key={l} onClick={()=>clickLegacy(l)} style={{display:'block',width:'100%',textAlign:'left',padding:'10px 11px',border:0,borderRadius:8,background:mode==='project'&&activeLabel===l?'var(--bg2)':'transparent',color:'var(--text)',fontSize:13,cursor:'pointer'}}>{l}</button>)}<div style={{height:1,background:'var(--border)',margin:'5px 4px'}}/><button onClick={()=>{setMode('dispute');setMobileOpen(false);}} style={{display:'block',width:'100%',textAlign:'left',padding:'10px 11px',border:0,borderRadius:8,background:mode==='dispute'?'#eef2ff':'transparent',color:mode==='dispute'?'#4338ca':'var(--text)',fontSize:13,fontWeight:700,cursor:'pointer'}}>Dispute Resolution</button></div>}
  </div>
  <div className="desktop-dispute-tab" style={{background:'var(--bg)',borderBottom:'1px solid var(--border)',padding:'7px 16px',display:'flex',justifyContent:'flex-end'}}><button onClick={()=>setMode(mode==='dispute'?'project':'dispute')} style={{padding:'6px 14px',borderRadius:99,fontSize:12,cursor:'pointer',background:mode==='dispute'?'#4f46e5':'transparent',color:mode==='dispute'?'#fff':'#4f46e5',border:mode==='dispute'?'1px solid #4f46e5':'1px solid #c7d2fe',fontWeight:600}}>Dispute Resolution</button></div>
  {mode==='dispute'?<div style={{flex:1,overflowY:'auto',background:'var(--bg2)'}}><div style={{background:'var(--bg)',borderBottom:'1px solid var(--border)',padding:'12px 16px',display:'flex',alignItems:'center',gap:12}}><button onClick={onBack} style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:99,padding:'6px 14px',fontSize:12,cursor:'pointer',color:'var(--text2)'}}>← Back</button><div style={{minWidth:0}}><div style={{fontSize:15,fontWeight:700,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{project.site_address||project.bo_premise_address||'Unnamed Project'}</div><div style={{fontSize:12,color:'var(--text3)',marginTop:1}}>{project.ref} · Dispute Resolution</div></div></div><div style={{padding:16}}><DisputeResolution project={project}/></div></div>:<div ref={legacyRef} className="pm-legacy" style={{flex:1,minHeight:0}}><PMProjectDetail {...props}/></div>}
 </div>;
}
