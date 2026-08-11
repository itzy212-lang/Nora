import { useEffect, useMemo, useState } from 'react';
import sb from '../../supabaseClient';

const box = { background:'var(--bg)', border:'1px solid var(--border)', borderRadius:14, padding:16, marginBottom:14 };
const input = { width:'100%', boxSizing:'border-box', padding:'9px 11px', border:'1px solid var(--border)', borderRadius:8, background:'var(--bg)', color:'var(--text)', fontSize:13 };
const btn = { border:'1px solid var(--border)', background:'var(--bg2)', color:'var(--text2)', borderRadius:99, padding:'7px 12px', fontSize:12, cursor:'pointer' };

function partyLabel(i){ return `Party ${String.fromCharCode(65+i)}`; }

export default function DisputeResolution({ project }) {
  const [caseRow,setCaseRow]=useState(null), [parties,setParties]=useState([]), [loading,setLoading]=useState(true), [saving,setSaving]=useState(false);
  const [brief,setBrief]=useState(null);

  useEffect(()=>{ (async()=>{
    setLoading(true);
    let {data:c}=await sb.from('dispute_cases').select('*').eq('project_id',project.id).maybeSingle();
    if(!c){ const r=await sb.from('dispute_cases').insert({project_id:project.id,title:`Dispute - ${project.site_address||project.bo_premise_address||project.ref||'Project'}`}).select('*').single(); c=r.data; }
    setCaseRow(c); setBrief(c?.case_brief||null);
    if(c){ const {data:p}=await sb.from('dispute_parties').select('*, dispute_party_people(*)').eq('case_id',c.id).order('sort_order'); setParties(p||[]); }
    setLoading(false);
  })(); },[project.id]);

  const addParty=async()=>{ if(!caseRow)return; const i=parties.length; const {data}=await sb.from('dispute_parties').insert({case_id:caseRow.id,label:partyLabel(i),sort_order:i}).select('*').single(); setParties(x=>[...x,{...data,dispute_party_people:[]}]); };
  const patchParty=(id,k,v)=>setParties(ps=>ps.map(p=>p.id===id?{...p,[k]:v}:p));
  const saveParty=async p=>{setSaving(true); await sb.from('dispute_parties').update({party_name:p.party_name||null,party_type:p.party_type||null,position_statement:p.position_statement||null,desired_outcome:p.desired_outcome||null}).eq('id',p.id); setSaving(false);};
  const removeParty=async p=>{if(!confirm(`Remove ${p.label}?`))return; await sb.from('dispute_parties').delete().eq('id',p.id); setParties(ps=>ps.filter(x=>x.id!==p.id));};
  const addPerson=async p=>{const {data}=await sb.from('dispute_party_people').insert({party_id:p.id,name:'',sort_order:p.dispute_party_people?.length||0}).select('*').single(); setParties(ps=>ps.map(x=>x.id===p.id?{...x,dispute_party_people:[...(x.dispute_party_people||[]),data]}:x));};
  const patchPerson=(pid,id,k,v)=>setParties(ps=>ps.map(p=>p.id===pid?{...p,dispute_party_people:p.dispute_party_people.map(x=>x.id===id?{...x,[k]:v}:x)}:p));
  const savePerson=async x=>await sb.from('dispute_party_people').update({name:x.name,role:x.role||null,email:x.email||null,phone:x.phone||null}).eq('id',x.id);
  const removePerson=async(pid,id)=>{await sb.from('dispute_party_people').delete().eq('id',id);setParties(ps=>ps.map(p=>p.id===pid?{...p,dispute_party_people:p.dispute_party_people.filter(x=>x.id!==id)}:p));};

  const generated=useMemo(()=>{
    const summaries=parties.filter(p=>p.position_statement||p.desired_outcome).map(p=>({party:p.label,name:p.party_name||p.label,position:p.position_statement||'',outcome:p.desired_outcome||''}));
    return {parties:summaries,agreed_facts:[],disputed_facts:[],financial_claims:[],workmanship_issues:[],programme_delay_issues:[],contractual_issues:[],relationship_issues:[],possible_common_ground:[],missing_information:[]};
  },[parties]);
  const createBrief=async()=>{setSaving(true);setBrief(generated);await sb.from('dispute_cases').update({case_brief:generated,updated_at:new Date().toISOString()}).eq('id',caseRow.id);setSaving(false);};

  if(loading)return <div style={box}>Loading dispute workspace…</div>;
  return <div style={{maxWidth:1000,margin:'0 auto'}}>
    <div style={box}><div style={{fontSize:18,fontWeight:800,color:'var(--text)'}}>Dispute Resolution</div><div style={{fontSize:13,color:'var(--text3)',marginTop:5}}>Set up the parties and record each position before mediation. This workspace remains with Nora until a mediation session is started.</div></div>
    <div style={box}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}><div><div style={{fontSize:14,fontWeight:700,color:'var(--text)'}}>Parties</div><div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>A party may contain one person, several people or a company and its representative.</div></div><button style={btn} onClick={addParty}>+ Add party</button></div></div>
    {parties.length===0&&<div style={{...box,textAlign:'center',color:'var(--text3)'}}>No parties added yet. Add Party A to begin.</div>}
    {parties.map(p=><div key={p.id} style={box}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}><div style={{fontWeight:800,color:'var(--text)'}}>{p.label}</div><button style={{...btn,color:'#dc2626'}} onClick={()=>removeParty(p)}>Remove</button></div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10,marginBottom:10}}><input style={input} value={p.party_name||''} onChange={e=>patchParty(p.id,'party_name',e.target.value)} placeholder="Party / company name"/><input style={input} value={p.party_type||''} onChange={e=>patchParty(p.id,'party_type',e.target.value)} placeholder="Role e.g. Homeowner / Contractor"/></div>
      <textarea style={{...input,minHeight:120,resize:'vertical',marginBottom:10}} value={p.position_statement||''} onChange={e=>patchParty(p.id,'position_statement',e.target.value)} placeholder="Initial position / dispute statement"/>
      <textarea style={{...input,minHeight:72,resize:'vertical'}} value={p.desired_outcome||''} onChange={e=>patchParty(p.id,'desired_outcome',e.target.value)} placeholder="What outcome is this party seeking?"/>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:14,marginBottom:8}}><div style={{fontSize:12,fontWeight:700,color:'var(--text2)'}}>People in {p.label}</div><button style={btn} onClick={()=>addPerson(p)}>+ Add person</button></div>
      {(p.dispute_party_people||[]).map(x=><div key={x.id} style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr)) auto',gap:7,marginBottom:7}}><input style={input} value={x.name||''} onBlur={()=>savePerson(x)} onChange={e=>patchPerson(p.id,x.id,'name',e.target.value)} placeholder="Name"/><input style={input} value={x.role||''} onBlur={()=>savePerson(x)} onChange={e=>patchPerson(p.id,x.id,'role',e.target.value)} placeholder="Role"/><input style={input} value={x.email||''} onBlur={()=>savePerson(x)} onChange={e=>patchPerson(p.id,x.id,'email',e.target.value)} placeholder="Email"/><button style={btn} onClick={()=>removePerson(p.id,x.id)}>×</button></div>)}
      <div style={{display:'flex',justifyContent:'flex-end',marginTop:10}}><button style={{...btn,background:'var(--blue)',color:'#fff',border:'none'}} onClick={()=>saveParty(p)}>{saving?'Saving…':'Save party'}</button></div>
    </div>)}
    <div style={box}><div style={{fontSize:14,fontWeight:700,color:'var(--text)',marginBottom:5}}>Nora Case Brief</div><div style={{fontSize:12,color:'var(--text3)',marginBottom:12}}>Creates a neutral working summary from the positions entered above. It does not start Phoenix or a breakout mediation room.</div><button style={{...btn,background:'var(--blue)',color:'#fff',border:'none'}} disabled={!parties.length||saving} onClick={createBrief}>{brief?'Refresh case brief':'Create case brief'}</button>
      {brief&&<div style={{marginTop:14}}>{brief.parties?.map(x=><div key={x.party} style={{padding:'10px 0',borderTop:'1px solid var(--border)'}}><div style={{fontWeight:700,fontSize:13,color:'var(--text)'}}>{x.party}: {x.name}</div><div style={{fontSize:12,color:'var(--text2)',marginTop:4,whiteSpace:'pre-wrap'}}>{x.position||'No position entered.'}</div>{x.outcome&&<div style={{fontSize:12,color:'var(--text3)',marginTop:4}}><b>Outcome sought:</b> {x.outcome}</div>}</div>)}</div>}
    </div>
    <div style={{...box,border:'1px solid #c7d2fe',background:'#eef2ff'}}><div style={{fontSize:14,fontWeight:800,color:'#3730a3'}}>Mediation</div><div style={{fontSize:12,color:'#4f46e5',marginTop:4}}>Phoenix begins only when the case is ready to move from preparation into live mediation.</div><button disabled style={{...btn,marginTop:12,opacity:.55}}>Start Mediation · Phoenix</button><div style={{fontSize:11,color:'#6366f1',marginTop:6}}>Phoenix room handoff will be enabled when the mediation-room layer is connected.</div></div>
  </div>;
}
