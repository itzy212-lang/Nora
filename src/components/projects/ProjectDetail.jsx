import { useState, useEffect } from 'react';
import { useApp } from '../../state/appStore';
import sb from '../../supabaseClient';

const STAGES = ['Notice', 'Response', 'Appointment', 'Award', 'Complete'];

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.5 }}>{value}</div>
    </div>
  );
}

function AOCard({ ao, index }) {
  const [open, setOpen] = useState(false);
  const statusColour = {
    consent: 'var(--green)', dissent: 'var(--red)',
    pending: 'var(--amber)', unknown: 'var(--text3)',
  }[ao.status] || 'var(--text3)';

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      marginBottom: 10, overflow: 'hidden',
    }}>
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', cursor: 'pointer', background: 'var(--bg3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            AO {index + 1}: {ao.name || 'Unknown'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 500, color: statusColour,
            background: `${statusColour}22`, padding: '2px 8px', borderRadius: 99,
          }}>
            {ao.status || 'Unknown'}
          </span>
          <span style={{ color: 'var(--text3)', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>
      {open && (
        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg2)' }}>
          {ao.address     && <DetailRow label="Address"          value={ao.address} />}
          {ao.email       && <DetailRow label="Email"            value={ao.email} />}
          {ao.phone       && <DetailRow label="Phone"            value={ao.phone} />}
          {ao.service_address && <DetailRow label="Service address" value={ao.service_address} />}
          {ao.surveyor_name   && <DetailRow label="AO Surveyor"  value={`${ao.surveyor_name}${ao.surveyor_firm ? ` — ${ao.surveyor_firm}` : ''}`} />}
          {ao.surveyor_email  && <DetailRow label="Surveyor email" value={ao.surveyor_email} />}
          {!ao.address && !ao.email && !ao.phone && (
            <div style={{ fontSize: 12.5, color: 'var(--text3)', fontStyle: 'italic' }}>No further details recorded.</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProjectDetail({ project, onBack, onOpenComposer }) {
  const { state } = useApp();
  const [tab, setTab] = useState('details');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editData, setEditData] = useState({});
  const [emails, setEmails] = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(false);

  // Normalise fields
  const address  = project.address  || project.bo_premise_address || '';
  const bo       = project.bo       || project.bo_1_name || '';
  const boEmail  = project.bo_email || project.bo_1_email || '';
  const boPhone  = project.bo_phone || '';
  const works    = project.works    || '';
  const fee      = project.fee      ? `£${parseFloat(project.fee).toLocaleString('en-GB')}` : '';
  const aos      = project.aos      || [];

  // Stage progress
  const stageIndex = STAGES.findIndex(s => s.toLowerCase() === (project.status || 'notice').toLowerCase());
  const currentStage = stageIndex >= 0 ? stageIndex : 0;

  // Load emails for this project
  useEffect(() => {
    if (tab !== 'emails' || !sb) return;
    setEmailsLoading(true);
    sb.from('emails')
      .select('id, subject, sender_name, sender_email, received_at, is_read, body_preview')
      .eq('project_id', project.id)
      .order('received_at', { ascending: false })
      .limit(50)
      .then(({ data }) => { setEmails(data || []); setEmailsLoading(false); });
  }, [tab, project.id]);

  const handleSave = async () => {
    if (!sb) return;
    setSaving(true);
    try {
      await sb.from('projects').update({
        bo_premise_address: editData.address || address,
        bo_1_name:          editData.bo      || bo,
        bo_1_email:         editData.boEmail || boEmail,
        bo_phone:           editData.boPhone || boPhone,
        works:              editData.works   || works,
        fee:                parseFloat(editData.fee) || parseFloat(project.fee) || 0,
        status:             editData.status  || project.status,
      }).eq('id', project.id);
      setEditing(false);
    } catch (err) {
      alert('Save failed: ' + err.message);
    }
    setSaving(false);
  };

  const tabs = ['Details', 'Emails', 'Documents', 'Timeline', 'Chat'];

  return (
    <div style={{ padding: '24px 28px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={onBack}
            style={{
              background: 'none', border: 'none', color: 'var(--blue)',
              fontSize: 13, cursor: 'pointer', padding: 0, fontWeight: 500,
            }}
          >
            ← Projects
          </button>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{project.ref}</div>
          <span style={{
            fontSize: 11.5, fontWeight: 500, padding: '3px 9px', borderRadius: 99,
            background: 'var(--blue-bg)', color: 'var(--blue)',
          }}>
            {project.status || 'active'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-sm btn-primary"
            style={{ cursor: 'pointer' }}
            onClick={() => onOpenComposer?.({ mode: 'compose', projectId: project.id, projectRef: project.ref })}
          >
            ✉ Compose email
          </button>
          <button
            className="btn btn-sm btn-ghost"
            style={{ cursor: 'pointer' }}
            onClick={() => onOpenComposer?.({ mode: 'chat', projectId: project.id })}
          >
            💬 Chat with Ely
          </button>
        </div>
      </div>

      {/* Stage bar */}
      <div style={{
        display: 'flex', background: 'var(--bg2)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 20,
      }}>
        {STAGES.map((stage, i) => (
          <div
            key={stage}
            style={{
              flex: 1, textAlign: 'center', padding: '10px 0', fontSize: 12.5,
              fontWeight: i === currentStage ? 600 : 400,
              background: i === currentStage ? 'var(--blue)' : i < currentStage ? 'var(--blue-bg)' : 'transparent',
              color: i === currentStage ? '#fff' : i < currentStage ? 'var(--blue)' : 'var(--text3)',
              borderRight: i < STAGES.length - 1 ? '1px solid var(--border)' : 'none',
              cursor: 'default',
            }}
          >
            {stage}
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20, gap: 2 }}>
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t.toLowerCase())}
            style={{
              padding: '8px 16px', fontSize: 13, border: 'none', cursor: 'pointer',
              background: 'none', fontWeight: tab === t.toLowerCase() ? 600 : 400,
              color: tab === t.toLowerCase() ? 'var(--blue)' : 'var(--text2)',
              borderBottom: tab === t.toLowerCase() ? '2px solid var(--blue)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── DETAILS TAB ── */}
      {tab === 'details' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

          {/* AOs */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
              Adjoining Owners
            </div>
            {aos.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--text3)', fontStyle: 'italic' }}>No AOs recorded.</div>
            ) : aos.map((ao, i) => (
              <AOCard key={ao.id || i} ao={ao} index={i} />
            ))}
          </div>

          {/* Project details */}
          <div>
            <div style={{
              background: 'var(--bg2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)', padding: '16px 18px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Project details</div>
                {!editing ? (
                  <button
                    onClick={() => { setEditing(true); setEditData({ address, bo, boEmail, boPhone, works, fee: project.fee, status: project.status }); }}
                    style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: 12.5, cursor: 'pointer', fontWeight: 500 }}
                  >
                    ✎ Edit
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setEditing(false)} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                    <button onClick={handleSave} disabled={saving} style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: 12.5, cursor: 'pointer', fontWeight: 600 }}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                )}
              </div>

              {editing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { label: 'Address',  key: 'address',  val: editData.address  },
                    { label: 'BO Name',  key: 'bo',       val: editData.bo       },
                    { label: 'BO Email', key: 'boEmail',  val: editData.boEmail  },
                    { label: 'BO Phone', key: 'boPhone',  val: editData.boPhone  },
                    { label: 'Works',    key: 'works',    val: editData.works    },
                    { label: 'Fee (£)',  key: 'fee',      val: editData.fee      },
                  ].map(({ label, key, val }) => (
                    <div key={key}>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{label}</div>
                      <input
                        value={val || ''}
                        onChange={e => setEditData(d => ({ ...d, [key]: e.target.value }))}
                        style={{
                          width: '100%', padding: '7px 10px', fontSize: 13,
                          background: 'var(--bg3)', border: '1px solid var(--border2)',
                          borderRadius: 'var(--radius)', color: 'var(--text)', outline: 'none',
                        }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                  <DetailRow label="Ref"     value={project.ref} />
                  <DetailRow label="Status"  value={project.status} />
                  <DetailRow label="Address" value={address} />
                  <DetailRow label="Fee"     value={fee} />
                  <DetailRow label="BO"      value={bo} />
                  <DetailRow label="BO Email" value={boEmail} />
                  <DetailRow label="BO Phone" value={boPhone} />
                  <DetailRow label="Works"   value={works} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── EMAILS TAB ── */}
      {tab === 'emails' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button
              className="btn btn-sm btn-primary"
              style={{ cursor: 'pointer' }}
              onClick={() => onOpenComposer?.({ mode: 'compose', projectId: project.id })}
            >
              + Compose
            </button>
          </div>
          {emailsLoading ? (
            <div style={{ color: 'var(--text3)', fontSize: 13, padding: 20 }}>Loading emails…</div>
          ) : emails.length === 0 ? (
            <div style={{ color: 'var(--text3)', fontSize: 13, fontStyle: 'italic', padding: 20 }}>No emails linked to this project.</div>
          ) : emails.map(email => (
            <div key={email.id} style={{
              padding: '12px 16px', borderBottom: '1px solid var(--border)',
              background: email.is_read ? 'transparent' : 'var(--blue-bg)',
              cursor: 'pointer',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: email.is_read ? 400 : 600, color: 'var(--text)' }}>
                  {email.sender_name || email.sender_email}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                  {email.received_at ? new Date(email.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
                </span>
              </div>
              <div style={{ fontSize: 12.5, fontWeight: email.is_read ? 400 : 600, color: 'var(--text2)', marginBottom: 3 }}>{email.subject}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {email.body_preview}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── DOCUMENTS TAB ── */}
      {tab === 'documents' && (
        <div style={{ color: 'var(--text3)', fontSize: 13, fontStyle: 'italic', padding: 20 }}>
          {(project.documents || []).length === 0
            ? 'No documents uploaded yet.'
            : (project.documents || []).map(d => (
                <div key={d.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', color: 'var(--text2)' }}>
                  📄 {d.file_name}
                </div>
              ))
          }
        </div>
      )}

      {/* ── TIMELINE TAB ── */}
      {tab === 'timeline' && (
        <div style={{ color: 'var(--text3)', fontSize: 13, fontStyle: 'italic', padding: 20 }}>
          Timeline coming soon.
        </div>
      )}

      {/* ── CHAT TAB ── */}
      {tab === 'chat' && (
        <div style={{ color: 'var(--text3)', fontSize: 13, padding: 20 }}>
          <button
            className="btn btn-primary"
            style={{ cursor: 'pointer' }}
            onClick={() => onOpenComposer?.({ mode: 'chat', projectId: project.id, projectRef: project.ref })}
          >
            💬 Open project chat with Ely
          </button>
        </div>
      )}
    </div>
  );
}
