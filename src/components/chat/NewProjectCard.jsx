/**
 * NewProjectCard — the confirm card under a Main Chat reply that proposes a new
 * project from a linked email. Nothing is created until "Create project" is
 * pressed. Creation goes through the same function the New Project form uses
 * (utils/createProject.js), so the project, its adjoining-owner record and its
 * storage folder (OneDrive or Google Drive, whichever the user has) are identical.
 */

import { useState } from 'react';
import sb from '../../supabaseClient';
import { getNextRef, createProjectRecord } from '../../utils/createProject';
import { proposalToForm, proposalProblems, roleLabel } from '../../utils/projectProposal';
import { useProjects } from '../../hooks/useProjects';

const label = { fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.55px' };

export default function NewProjectCard({ proposal }) {
  const { loadProjects } = useProjects();
  const [status, setStatus] = useState('idle'); // idle | creating | done | cancelled | error
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);

  const problems = proposalProblems(proposal);
  const owners = proposal.owners || [];

  const create = async () => {
    if (status === 'creating' || status === 'done') return;
    setStatus('creating');
    setError('');
    try {
      const { form, sameAddr } = proposalToForm(proposal);
      const ref = await getNextRef();
      const { data: { user } } = await sb.auth.getUser();
      const project = await createProjectRecord({
        form, ref, user,
        boSameAddr: form.role === 'BO' && sameAddr,
        aoSameAddr: form.role === 'AO' && sameAddr,
      });
      await loadProjects();
      setCreated(project);
      setStatus('done');
    } catch (e) {
      setError(e?.message || 'Could not create the project.');
      setStatus('error');
    }
  };

  const card = { margin: '4px 16px 12px', padding: '12px 14px', background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)' };

  if (status === 'cancelled') return null;

  if (status === 'done' && created) {
    return (
      <div style={card}>
        <div style={{ fontSize: 13.5, color: 'var(--green, #16a34a)', fontWeight: 600 }}>
          ✅ Project {created.ref} created
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 4 }}>
          {created.bo_premise_address || created.ao_premise_address} — you’ll find it under Projects.
        </div>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>New project — please check before I create it</div>

      <div style={label}>Your role</div>
      <div style={{ fontSize: 13.5, marginBottom: 6 }}>{roleLabel(proposal.role) || <em style={{ color: 'var(--text3)' }}>not stated</em>}</div>

      <div style={label}>{proposal.role === 'AO' ? 'Adjoining owner property' : 'Building owner property'}</div>
      <div style={{ fontSize: 13.5, marginBottom: 6 }}>{proposal.property_address || <em style={{ color: 'var(--text3)' }}>not found</em>}</div>

      <div style={label}>{proposal.role === 'AO' ? 'Adjoining owner' : 'Building owner'}{owners.length > 1 ? 's' : ''}</div>
      <div style={{ marginBottom: 6 }}>
        {owners.length === 0 && <div style={{ fontSize: 13.5 }}><em style={{ color: 'var(--text3)' }}>not found</em></div>}
        {owners.map((o, i) => (
          <div key={i} style={{ fontSize: 13.5 }}>
            <strong>{o.name}</strong>
            {(o.email || o.phone) && <span style={{ color: 'var(--text3)' }}> · {[o.email, o.phone].filter(Boolean).join(' · ')}</span>}
          </div>
        ))}
      </div>

      {proposal.service_address && (
        <>
          <div style={label}>Service / correspondence address</div>
          <div style={{ fontSize: 13.5, marginBottom: 6 }}>{proposal.service_address}</div>
        </>
      )}

      {proposal.works && (
        <>
          <div style={label}>Works</div>
          <div style={{ fontSize: 13.5, marginBottom: 6 }}>{proposal.works}</div>
        </>
      )}

      {problems.length > 0 && (
        <div style={{ fontSize: 12.5, color: '#b45309', margin: '6px 0' }}>
          Still needed: {problems.join('; ')}. Tell me in the chat and I’ll update the details.
        </div>
      )}
      {status === 'error' && <div role="alert" style={{ fontSize: 12.5, color: 'var(--red, #b91c1c)', margin: '6px 0' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          onClick={create}
          disabled={problems.length > 0 || status === 'creating'}
          style={{ fontSize: 12.5, padding: '6px 14px', borderRadius: 99, border: 'none', background: problems.length ? 'var(--border)' : 'var(--blue, #3b82f6)', color: '#fff', fontWeight: 600, cursor: problems.length || status === 'creating' ? 'default' : 'pointer' }}
        >
          {status === 'creating' ? 'Creating…' : 'Create project'}
        </button>
        <button
          type="button"
          onClick={() => setStatus('cancelled')}
          disabled={status === 'creating'}
          style={{ fontSize: 12.5, padding: '6px 14px', borderRadius: 99, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)', cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
