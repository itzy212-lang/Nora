import { useEffect, useRef, useState } from 'react';
import sb from '../../supabaseClient';
import { useEly } from '../../hooks/useEly';

const box={background:'var(--bg)',border:'1px solid var(--border)',borderRadius:14,padding:16,marginBottom:14};
const input={width:'100%',boxSizing:'border-box',padding:'9px 11px',border:'1px solid var(--border)',borderRadius:8,background:'var(--bg)',color:'var(--text)',fontSize:13};
const btn={border:'1px solid var(--border)',background:'var(--bg2)',color:'var(--text2)',borderRadius:99,padding:'7px 12px',fontSize:12,cursor:'pointer'};
const primary={...btn,background:'var(--blue)',color:'#fff',border:'none',fontWeight:600};

function partyLabel(i){return `Party ${String.fromCharCode(65+i)}`;}
function cleanJson(text=''){
  const raw=String(text||'').trim();
  const candidates=[raw,raw.replace(/^```json\s*/i,'').replace(/^```/,'').replace(/```$/,'').trim()];
  const a=raw.indexOf('{'),b=raw.lastIndexOf('}');
  if(a>=0&&b>a)candidates.push(raw.slice(a,b+1));
  for(const s of candidates){try{return JSON.parse(s);}catch{}}
  return null;
}
function textValue(v){return typeof v==='string'?v:JSON.stringify(v);}
function arr(v){return Array.isArray(v)?v:[];}

export default function DisputeResolution({project, onBack, onRaiseInvoice}){
  const {send,loading:aiLoading}=useEly({surface:'project_chat',projectId:project.id});
  const fileInputRef=useRef(null);
  const [caseRow,setCaseRow]=useState(null);
  const [parties,setParties]=useState([]);
  const [evidence,setEvidence]=useState([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [brief,setBrief]=useState(null);
  const [error,setError]=useState('');
  const [evidenceForm,setEvidenceForm]=useState({party_id:'',title:'',notes:''});

  const load=async()=>{
    setLoading(true);
    setError('');
    try{
      let {data:c,error:ce}=await sb.from('dispute_cases').select('*').eq('project_id',project.id).maybeSingle();
      if(ce)throw ce;
      if(!c){
        const {data,error}=await sb.from('dispute_cases').insert({
          project_id:project.id,
          title:`Dispute - ${project.site_address||project.bo_premise_address||project.ref||'Project'}`
        }).select('*').single();
        if(error)throw error;
        c=data;
      }
      setCaseRow(c);
      setBrief(c?.case_brief||null);
      const [{data:p,error:pe},{data:e,error:ee}]=await Promise.all([
        sb.from('dispute_parties').select('*, dispute_party_people(*)').eq('case_id',c.id).order('sort_order'),
        sb.from('dispute_evidence').select('*').eq('case_id',c.id).order('created_at')
      ]);
      if(pe)throw pe;
      if(ee)throw ee;
      setParties(p||[]);
      setEvidence(e||[]);
    }catch(e){
      setError(e.message||'Could not load dispute workspace.');
    }finally{
      setLoading(false);
    }
  };

  useEffect(()=>{load();},[project.id]);

  const addParty=async()=>{
    if(!caseRow)return;
    const i=parties.length;
    const {data,error}=await sb.from('dispute_parties').insert({case_id:caseRow.id,label:partyLabel(i),sort_order:i}).select('*').single();
    if(error)return setError(error.message);
    setParties(x=>[...x,{...data,dispute_party_people:[]}]);
  };

  const patchParty=(id,k,v)=>setParties(ps=>ps.map(p=>p.id===id?{...p,[k]:v}:p));

  const saveParty=async(p,manage=true)=>{
    if(manage)setSaving(true);
    const {error}=await sb.from('dispute_parties').update({
      party_name:p.party_name||null,
      party_type:p.party_type||null,
      position_statement:p.position_statement||null,
      desired_outcome:p.desired_outcome||null,
      fee:p.fee===''||p.fee==null?null:Number(p.fee),
      updated_at:new Date().toISOString()
    }).eq('id',p.id);
    if(manage)setSaving(false);
    if(error){setError(error.message);throw error;}
  };

  const removeParty=async p=>{
    if(!confirm(`Remove ${p.label}?`))return;
    const {error}=await sb.from('dispute_parties').delete().eq('id',p.id);
    if(error)return setError(error.message);
    setParties(ps=>ps.filter(x=>x.id!==p.id));
  };

  const addPerson=async p=>{
    const {data,error}=await sb.from('dispute_party_people').insert({party_id:p.id,name:'',sort_order:p.dispute_party_people?.length||0}).select('*').single();
    if(error)return setError(error.message);
    setParties(ps=>ps.map(x=>x.id===p.id?{...x,dispute_party_people:[...(x.dispute_party_people||[]),data]}:x));
  };

  const patchPerson=(pid,id,k,v)=>setParties(ps=>ps.map(p=>p.id===pid?{...p,dispute_party_people:(p.dispute_party_people||[]).map(x=>x.id===id?{...x,[k]:v}:x)}:p));
  const savePerson=async x=>{const {error}=await sb.from('dispute_party_people').update({name:x.name,role:x.role||null,email:x.email||null,phone:x.phone||null,address:x.address||null}).eq('id',x.id);if(error)setError(error.message);};
  const removePerson=async(pid,id)=>{const {error}=await sb.from('dispute_party_people').delete().eq('id',id);if(error)return setError(error.message);setParties(ps=>ps.map(p=>p.id===pid?{...p,dispute_party_people:p.dispute_party_people.filter(x=>x.id!==id)}:p));};

  const addEvidence=async()=>{
    if(!caseRow||!evidenceForm.title.trim())return;
    const {data,error}=await sb.from('dispute_evidence').insert({
      case_id:caseRow.id,
      party_id:evidenceForm.party_id||null,
      title:evidenceForm.title.trim(),
      notes:evidenceForm.notes.trim()||null
    }).select('*').single();
    if(error)return setError(error.message);
    setEvidence(x=>[...x,data]);
    setEvidenceForm({party_id:'',title:'',notes:''});
  };

  const uploadEvidence=async event=>{
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file||!caseRow)return;
    setUploading(true);
    setError('');
    try{
      const form=new FormData();
      form.append('file',file);
      form.append('project_id',String(project.id));
      form.append('project_ref',project.ref||'');
      const response=await fetch('/api/project-chat-upload',{method:'POST',body:form});
      const uploaded=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(uploaded?.error||'Document upload failed.');
      if(!uploaded.extracted_text?.trim())throw new Error(uploaded.extraction_note||'The document uploaded but no readable text could be extracted.');
      const {data,error}=await sb.from('dispute_evidence').insert({
        case_id:caseRow.id,
        party_id:evidenceForm.party_id||null,
        title:file.name,
        notes:uploaded.extracted_text.trim(),
        document_id:uploaded.upload_id||null
      }).select('*').single();
      if(error)throw error;
      setEvidence(x=>[...x,data]);
    }catch(e){
      setError(e.message||'Could not upload this document.');
    }finally{
      setUploading(false);
    }
  };

  const removeEvidence=async id=>{
    const {error}=await sb.from('dispute_evidence').delete().eq('id',id);
    if(error)return setError(error.message);
    setEvidence(x=>x.filter(e=>e.id!==id));
  };

  const createBrief=async()=>{
    if(!caseRow||!parties.length)return;
    setSaving(true);
    setError('');
    try{
      for(const p of parties)await saveParty(p,false);
      const payload={
        project:{id:project.id,reference:project.ref||'',address:project.site_address||project.bo_premise_address||''},
        parties:parties.map(p=>({
          label:p.label,
          name:p.party_name||'',
          type:p.party_type||'',
          people:(p.dispute_party_people||[]).map(x=>({name:x.name,role:x.role})),
          position:p.position_statement||'',
          outcome_sought:p.desired_outcome||''
        })),
        supporting_material:evidence.map(e=>({
          party:parties.find(p=>p.id===e.party_id)?.label||'General',
          title:e.title,
          document_id:e.document_id||null,
          notes:e.notes||''
        }))
      };
      const hasMaterial=payload.parties.some(p=>p.position.trim()||p.outcome_sought.trim())||payload.supporting_material.some(e=>e.notes.trim());
      if(!hasMaterial)throw new Error('Add at least one party brief or supporting document before asking Nora to analyse the dispute.');

      const prompt=`You are Nora, the PRIVATE case analyst for an independent mediator or project manager. Analyse ONLY the supplied dispute intake, including the full text of uploaded supporting documents. Compare every party's account against the others. Do not decide liability and do not invent facts. Treat assertions as allegations unless supported or agreed. Distinguish clearly between stated positions, evidence, inference and missing information.\n\nThe output is for the mediator/project manager only. It must let them understand the case without rereading all of the briefs. Identify what each party is actually asking for, the strongest and weakest parts of each position, unsupported or inconsistent points, missing documents or evidence, areas of genuine agreement, areas where the parties may be closer than they appear, and the specific points a mediator should test, challenge or push on to move the parties toward agreement.\n\nReturn ONLY one valid JSON object. No markdown fences and no commentary before or after it. Use exactly these keys:\nexecutive_summary:string, dispute_synopsis:string, party_summaries:array of {party,name,position,outcome_sought,key_points}, party_assessments:array of {party,strengths,weaknesses,unsupported_points,leverage_points}, agreed_or_common_facts:array, disputed_facts:array, financial_claims:array, workmanship_issues:array, programme_delay_issues:array, contractual_issues:array, relationship_communication_issues:array, possible_common_ground:array, mediator_pressure_points:array, settlement_opportunities:array, resolution_pathway:string, resolution_steps:array, likely_settlement_blockers:array, mediator_questions_to_explore:array, alternative_exit_path:string, missing_information:array, preparation_points:array.\n\nFor party_assessments, strengths and weaknesses are analytical observations, not findings of fact. For mediator_pressure_points, identify concrete matters worth probing or challenging and explain why each could unlock movement. For settlement_opportunities, identify practical compromise structures supported by the material. If a category is unsupported, return an empty array or empty string.\n\nDISPUTE INTAKE:\n${JSON.stringify(payload)}`;

      const result=await send(prompt,{
        projectId:project.id,
        mode:'discuss',
        sessionType:'dispute_preparation',
        context:{dispute_case_id:caseRow.id,dispute_intake:payload}
      });
      const text=result?.reply||result?.replyText||result?.documentText||result?.draft||result?.response||result?.content||result?.message||result?.text||'';
      const parsed=cleanJson(typeof text==='string'?text:JSON.stringify(text));
      if(!parsed)throw new Error('Nora completed the analysis but returned it in an unreadable format. Please refresh the synopsis again.');
      setBrief(parsed);
      const {error}=await sb.from('dispute_cases').update({case_brief:parsed,updated_at:new Date().toISOString()}).eq('id',caseRow.id);
      if(error)throw error;
    }catch(e){
      setError(e.message||'Could not analyse the dispute.');
    }finally{
      setSaving(false);
    }
  };

  // Added 2026-08-14, on request: generates the mediation agreement PDF
  // from whatever template's been uploaded in Settings > Templates,
  // filling in the placeholders documented in Settings > Placeholders.
  // Reuses /api/generate-doc entirely as-is — it's already a fully
  // generic merge+PDF endpoint, no new backend needed. No e-signature
  // yet, deliberately, per instruction — just a downloadable PDF to
  // email manually for now.
  const [generatingAgreement,setGeneratingAgreement]=useState(false);
  const generateMediationAgreement=async()=>{
    setGeneratingAgreement(true);
    setError('');
    try{
      const {data:tpl,error:tplErr}=await sb.from('document_templates')
        .select('file_b64').eq('template_key','mediation_agreement').maybeSingle();
      if(tplErr)throw tplErr;
      if(!tpl?.file_b64){setError("No mediation agreement template uploaded yet — add one in Settings > Templates first.");return;}

      const partyA=parties[0]||{};
      const partyB=parties[1]||{};
      const peopleA=partyA.dispute_party_people||[];
      const peopleB=partyB.dispute_party_people||[];
      const today=new Date();

      const merge_data={
        PARTY_A_NAME_1:peopleA[0]?.name||partyA.party_name||'',
        PARTY_A_ADDRESS_1:peopleA[0]?.address||'',
        PARTY_A_NAME_2:peopleA[1]?.name||'',
        PARTY_A_ADDRESS_2:peopleA[1]?.address||'',
        PARTY_B_NAME_1:peopleB[0]?.name||partyB.party_name||'',
        PARTY_B_ADDRESS_1:peopleB[0]?.address||'',
        PARTY_B_NAME_2:peopleB[1]?.name||'',
        PARTY_B_ADDRESS_2:peopleB[1]?.address||'',
        PARTY_A_FEE:partyA.fee!=null?String(partyA.fee):'',
        PARTY_B_FEE:partyB.fee!=null?String(partyB.fee):'',
        MEDIATION_DATE:caseRow?.mediation_date?new Date(caseRow.mediation_date).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}):'',
        MEDIATION_TIME:caseRow?.mediation_time||'',
        DISPUTE_DESCRIPTION:partyA.position_statement||partyB.position_statement||'',
        AGREEMENT_DAY:String(today.getDate()),
        AGREEMENT_MONTH:today.toLocaleDateString('en-GB',{month:'long'}),
        AGREEMENT_YEAR:String(today.getFullYear()),
        file_name:'Mediation Agreement.docx',
      };

      const res=await fetch('/api/generate-doc',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({template_b64:tpl.file_b64,merge_data,output_format:'pdf',save_to_onedrive:false}),
      });
      const json=await res.json();
      if(!json.success||!json.pdf_b64){setError(json.error||'Could not generate the mediation agreement.');return;}

      const link=document.createElement('a');
      link.href=`data:application/pdf;base64,${json.pdf_b64}`;
      link.download='Mediation Agreement.pdf';
      link.click();
    }catch(e){
      setError(e.message||'Could not generate the mediation agreement.');
    }finally{
      setGeneratingAgreement(false);
    }
  };

  if(loading)return <div style={box}>Loading dispute workspace…</div>;

  // Added 2026-08-14, on request: party-selectable invoicing — a
  // dispute isn't tied to one ongoing project client, so billing needs
  // to pick a side explicitly. Reuses the existing, already-working
  // invoice modal untouched — just pre-fills bill_to_name/email from
  // whichever party is selected here, plus the person's email if the
  // party itself has none. No new invoice UI or PDF logic needed.
  // Added 2026-08-14, on request: mediation date/time, shown once both
  // parties are in — feeds MEDIATION_DATE/MEDIATION_TIME in the
  // agreement, same as PARTY_A_FEE/PARTY_B_FEE do for the fee table.
  const saveMediationDateTime=async(k,v)=>{
    setCaseRow(c=>({...c,[k]:v}));
    const {error}=await sb.from('dispute_cases').update({[k]:v||null}).eq('id',caseRow.id);
    if(error)setError(error.message);
  };

  const raiseInvoiceFor=(p)=>{
    const person=(p.dispute_party_people||[])[0];
    onRaiseInvoice?.({
      id:project.id,
      bo_premise_address:project.bo_premise_address||'',
      bill_to_name:p.party_name||person?.name||p.label,
      bill_to_email:person?.email||'',
      bill_to_address:person?.address||'',
      project_id:project.id,
    });
  };

  return <div style={{maxWidth:1050,margin:'0 auto'}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,flexWrap:'wrap',gap:10}}>
      {onBack?<button style={btn} onClick={onBack}>← Back</button>:<div/>}
      <div style={{display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}>
        {parties.length>=2&&(
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{fontSize:12,color:'var(--text3)'}}>Mediation date:</span>
            <input type="date" style={{...input,width:150}} value={caseRow?.mediation_date||''} onChange={e=>saveMediationDateTime('mediation_date',e.target.value)}/>
            <input type="time" style={{...input,width:110}} value={caseRow?.mediation_time||''} onChange={e=>saveMediationDateTime('mediation_time',e.target.value)}/>
          </div>
        )}
        {parties.length>=2&&(
          <button style={primary} onClick={generateMediationAgreement} disabled={generatingAgreement}>
            {generatingAgreement?'Generating…':'📄 Generate mediation agreement'}
          </button>
        )}
        {parties.length>0&&(
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:12,color:'var(--text3)'}}>Raise invoice to:</span>
            {parties.map(p=>(
              <button key={p.id} style={primary} onClick={()=>raiseInvoiceFor(p)}>
                {p.label}{p.party_name?` (${p.party_name})`:''}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
    <div style={box}>
      <div style={{fontSize:18,fontWeight:800,color:'var(--text)'}}>Dispute Resolution</div>
      <div style={{fontSize:13,color:'var(--text3)',marginTop:5}}>Private case preparation. Add each party's case and any supporting documents, then generate Nora's mediator synopsis.</div>
      {error&&<div style={{marginTop:10,padding:10,borderRadius:8,background:'#fef2f2',color:'#b91c1c',fontSize:12}}>{error}</div>}
    </div>

    <div style={box}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
        <div>
          <div style={{fontSize:14,fontWeight:700,color:'var(--text)'}}>Parties</div>
          <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>Paste each party's original case, response or position.</div>
        </div>
        <button style={btn} onClick={addParty}>+ Add party</button>
      </div>
    </div>

    {parties.length===0&&<div style={{...box,textAlign:'center',color:'var(--text3)'}}>No parties added yet.</div>}

    {parties.map(p=><div key={p.id} style={box}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div style={{fontWeight:800,color:'var(--text)'}}>{p.label}</div>
        <button style={{...btn,color:'#dc2626'}} onClick={()=>removeParty(p)}>Remove</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10,marginBottom:10}}>
        <input style={input} value={p.party_name||''} onChange={e=>patchParty(p.id,'party_name',e.target.value)} placeholder="Party / company name"/>
        <input style={input} value={p.party_type||''} onChange={e=>patchParty(p.id,'party_type',e.target.value)} placeholder="Role e.g. Homeowner / Contractor"/>
        <input style={input} type="number" value={p.fee??''} onChange={e=>patchParty(p.id,'fee',e.target.value)} placeholder="Mediation fee (£) for this party"/>
      </div>
      <textarea style={{...input,minHeight:220,resize:'vertical',marginBottom:10}} value={p.position_statement||''} onChange={e=>patchParty(p.id,'position_statement',e.target.value)} placeholder="Paste this party's complete initial case brief, claim, response or position here"/>
      <textarea style={{...input,minHeight:72,resize:'vertical'}} value={p.desired_outcome||''} onChange={e=>patchParty(p.id,'desired_outcome',e.target.value)} placeholder="What this party is asking for / outcome sought"/>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:14,marginBottom:8}}>
        <div style={{fontSize:12,fontWeight:700,color:'var(--text2)'}}>People in {p.label}</div>
        <button style={btn} onClick={()=>addPerson(p)}>+ Add person</button>
      </div>
      {(p.dispute_party_people||[]).map(x=><div key={x.id} style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr)) auto',gap:7,marginBottom:7}}>
        <input style={input} value={x.name||''} onBlur={()=>savePerson(x)} onChange={e=>patchPerson(p.id,x.id,'name',e.target.value)} placeholder="Name"/>
        <input style={input} value={x.role||''} onBlur={()=>savePerson(x)} onChange={e=>patchPerson(p.id,x.id,'role',e.target.value)} placeholder="Role"/>
        <input style={input} value={x.email||''} onBlur={()=>savePerson(x)} onChange={e=>patchPerson(p.id,x.id,'email',e.target.value)} placeholder="Email"/>
        <input style={{...input,gridColumn:'1 / -2'}} value={x.address||''} onBlur={()=>savePerson(x)} onChange={e=>patchPerson(p.id,x.id,'address',e.target.value)} placeholder="Address — needed for the mediation agreement"/>
        <button style={btn} onClick={()=>removePerson(p.id,x.id)}>×</button>
      </div>)}
      <div style={{display:'flex',justifyContent:'flex-end',marginTop:10}}><button style={primary} onClick={()=>saveParty(p)}>{saving?'Saving…':'Save party'}</button></div>
    </div>)}

    <div style={box}>
      <div style={{fontSize:14,fontWeight:700,color:'var(--text)',marginBottom:4}}>Supporting documents and evidence</div>
      <div style={{fontSize:12,color:'var(--text3)',marginBottom:12}}>Upload PDF, DOCX, TXT or CSV documents for Nora to read, or add a manual evidence note.</div>
      <div style={{display:'grid',gridTemplateColumns:'minmax(130px,.6fr) minmax(180px,1fr)',gap:8,marginBottom:8}}>
        <select style={input} value={evidenceForm.party_id} onChange={e=>setEvidenceForm(f=>({...f,party_id:e.target.value}))}>
          <option value="">General / both parties</option>
          {parties.map(p=><option key={p.id} value={p.id}>{p.label}{p.party_name?` - ${p.party_name}`:''}</option>)}
        </select>
        <input style={input} value={evidenceForm.title} onChange={e=>setEvidenceForm(f=>({...f,title:e.target.value}))} placeholder="Manual evidence title"/>
      </div>
      <textarea style={{...input,minHeight:70,resize:'vertical'}} value={evidenceForm.notes} onChange={e=>setEvidenceForm(f=>({...f,notes:e.target.value}))} placeholder="Relevant extract, correspondence, summary or note"/>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}>
        <button style={btn} onClick={addEvidence}>+ Add note</button>
        <input ref={fileInputRef} type="file" style={{display:'none'}} accept=".pdf,.docx,.txt,.csv" onChange={uploadEvidence}/>
        <button style={primary} disabled={uploading} onClick={()=>fileInputRef.current?.click()}>{uploading?'Reading document…':'Upload document'}</button>
      </div>
      {evidence.map(e=><div key={e.id} style={{display:'flex',gap:8,alignItems:'flex-start',borderTop:'1px solid var(--border)',paddingTop:9,marginTop:9}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:12,fontWeight:700,color:'var(--text)'}}>{parties.find(p=>p.id===e.party_id)?.label||'General'} · {e.title}{e.document_id?' · uploaded':''}</div>
          {e.notes&&<div style={{fontSize:12,color:'var(--text3)',marginTop:3,whiteSpace:'pre-wrap',maxHeight:120,overflow:'auto'}}>{e.notes}</div>}
        </div>
        <button style={{...btn,color:'#dc2626'}} onClick={()=>removeEvidence(e.id)}>Remove</button>
      </div>)}
    </div>

    <div style={box}>
      <div style={{fontSize:16,fontWeight:800,color:'var(--text)',marginBottom:5}}>Nora Case Synopsis</div>
      <div style={{fontSize:12,color:'var(--text3)',marginBottom:12}}>Private mediator analysis of what each party wants, strengths and weaknesses, missing evidence, pressure points and possible routes to agreement.</div>
      <button style={primary} disabled={!parties.length||saving||aiLoading||uploading} onClick={createBrief}>{saving||aiLoading?'Nora is analysing the case…':brief?'Refresh synopsis':'Generate synopsis'}</button>
      {brief&&<Brief brief={brief}/>} 
    </div>

    <div style={{...box,border:'1px solid #c7d2fe',background:'#eef2ff'}}>
      <div style={{fontSize:14,fontWeight:800,color:'#3730a3'}}>Phoenix Mediation</div>
      <div style={{fontSize:12,color:'#4f46e5',marginTop:4}}>The case synopsis remains private to the mediator. Phoenix handoff will use this prepared case material when mediation is started.</div>
      <button disabled style={{...btn,marginTop:12,opacity:.55}}>Start Mediation · Phoenix</button>
    </div>
  </div>;
}

function ListSection({title,items}){
  const xs=arr(items).filter(Boolean);
  if(!xs.length)return null;
  return <div style={{marginTop:16}}><div style={{fontSize:12,fontWeight:800,color:'var(--text2)',marginBottom:6}}>{title}</div>{xs.map((x,i)=><div key={i} style={{fontSize:12,color:'var(--text2)',lineHeight:1.55,marginBottom:4}}>• {textValue(x)}</div>)}</div>;
}

function PartyAssessments({items}){
  const xs=arr(items);
  if(!xs.length)return null;
  return <div style={{marginTop:18}}>
    <div style={{fontSize:15,fontWeight:800,color:'var(--text)',marginBottom:8}}>Private assessment of each position</div>
    {xs.map((p,i)=><div key={i} style={{padding:'12px 0',borderTop:'1px solid var(--border)'}}>
      <div style={{fontSize:13,fontWeight:800,color:'var(--text)'}}>{p.party||`Party ${i+1}`}</div>
      <ListSection title="Strengths" items={p.strengths}/>
      <ListSection title="Weaknesses" items={p.weaknesses}/>
      <ListSection title="Unsupported / vulnerable points" items={p.unsupported_points}/>
      <ListSection title="Potential leverage / movement points" items={p.leverage_points}/>
    </div>)}
  </div>;
}

function Brief({brief}){
  return <div style={{marginTop:18,borderTop:'1px solid var(--border)',paddingTop:16}}>
    {brief.executive_summary&&<><h3 style={{fontSize:15,margin:'0 0 6px',color:'var(--text)'}}>Executive summary</h3><div style={{fontSize:13,lineHeight:1.65,color:'var(--text2)',whiteSpace:'pre-wrap'}}>{brief.executive_summary}</div></>}
    {brief.dispute_synopsis&&<><h3 style={{fontSize:15,margin:'18px 0 6px',color:'var(--text)'}}>What the dispute is about</h3><div style={{fontSize:13,lineHeight:1.65,color:'var(--text2)',whiteSpace:'pre-wrap'}}>{brief.dispute_synopsis}</div></>}
    {arr(brief.party_summaries).length>0&&<div style={{marginTop:18}}>
      <div style={{fontSize:15,fontWeight:800,color:'var(--text)',marginBottom:8}}>What each party is asking for</div>
      {brief.party_summaries.map((p,i)=><div key={i} style={{padding:'10px 0',borderTop:'1px solid var(--border)'}}>
        <div style={{fontSize:13,fontWeight:800,color:'var(--text)'}}>{p.party}{p.name?` · ${p.name}`:''}</div>
        <div style={{fontSize:12,color:'var(--text2)',lineHeight:1.55,marginTop:4}}>{p.position}</div>
        {p.outcome_sought&&<div style={{fontSize:12,color:'var(--text3)',marginTop:4}}><b>Outcome sought:</b> {p.outcome_sought}</div>}
        <ListSection title="Key points" items={p.key_points}/>
      </div>)}
    </div>}
    <PartyAssessments items={brief.party_assessments}/>
    <ListSection title="Common / agreed points" items={brief.agreed_or_common_facts}/>
    <ListSection title="Disputed facts" items={brief.disputed_facts}/>
    <ListSection title="Financial issues" items={brief.financial_claims}/>
    <ListSection title="Workmanship issues" items={brief.workmanship_issues}/>
    <ListSection title="Programme / delay issues" items={brief.programme_delay_issues}/>
    <ListSection title="Contractual issues" items={brief.contractual_issues}/>
    <ListSection title="Relationship / communication issues" items={brief.relationship_communication_issues}/>
    <ListSection title="Possible common ground" items={brief.possible_common_ground}/>
    <ListSection title="Mediator pressure points" items={brief.mediator_pressure_points}/>
    <ListSection title="Settlement opportunities" items={brief.settlement_opportunities}/>
    <div style={{marginTop:20,padding:14,borderRadius:12,background:'var(--bg2)',border:'1px solid var(--border)'}}>
      <div style={{fontSize:15,fontWeight:800,color:'var(--text)'}}>Suggested pathway to resolution</div>
      <div style={{fontSize:13,lineHeight:1.65,color:'var(--text2)',whiteSpace:'pre-wrap',marginTop:7}}>{brief.resolution_pathway||'No resolution pathway identified from the material supplied.'}</div>
      <ListSection title="Recommended sequence" items={brief.resolution_steps}/>
      <ListSection title="Likely settlement blockers" items={brief.likely_settlement_blockers}/>
      <ListSection title="Questions to explore" items={brief.mediator_questions_to_explore}/>
      {brief.alternative_exit_path&&<><div style={{fontSize:12,fontWeight:800,color:'var(--text2)',marginTop:16}}>If continuation cannot be salvaged</div><div style={{fontSize:12,lineHeight:1.6,color:'var(--text2)',marginTop:5,whiteSpace:'pre-wrap'}}>{brief.alternative_exit_path}</div></>}
    </div>
    <ListSection title="Missing information / evidence" items={brief.missing_information}/>
    <ListSection title="Preparation points" items={brief.preparation_points}/>
  </div>;
}
