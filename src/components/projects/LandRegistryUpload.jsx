/**
 * LandRegistryUpload — "Upload Land Registry" button for the New Project form.
 *
 * Reads a Land Registry register of title, then SHOWS what it found (owners,
 * property address, title number, each owner's address for service) and waits
 * for the user to press "Use these details". Nothing is filled in before that.
 *
 * Props:
 *   target   'bo' | 'ao'  — which side of the form the register is for
 *   onApply  (patch) => void  — patch built by registerToFormPatch()
 */

import { useRef, useState } from 'react';
import {
  readLandRegistryFile,
  registerToFormPatch,
  serviceAddressDiffers,
  displayOwnerName,
} from '../../utils/readLandRegistry';

const box = {
  background: '#fff',
  border: '1px dashed #bfd0ea',
  borderRadius: 14,
  padding: '10px 14px',
};

const smallLabel = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--text3)',
  textTransform: 'uppercase',
  letterSpacing: '0.55px',
};

export default function LandRegistryUpload({ target = 'bo', onApply }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | reading | review | error
  const [error, setError] = useState('');
  const [register, setRegister] = useState(null);
  const [useService, setUseService] = useState(false);

  const sideLabel = target === 'ao' ? 'adjoining owner' : 'building owner';

  const pick = async (file) => {
    if (!file) return;
    setStatus('reading');
    setError('');
    try {
      const result = await readLandRegistryFile(file);
      setRegister(result);
      setUseService(false); // an address for service elsewhere is only used if the user ticks it
      setStatus('review');
    } catch (e) {
      setError(e.message || 'Could not read that document.');
      setStatus('error');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const reset = () => {
    setStatus('idle');
    setRegister(null);
    setError('');
  };

  const apply = () => {
    onApply?.(registerToFormPatch(register, target, { useServiceAddress: useService }), register);
    reset();
  };

  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".pdf,.jpg,.jpeg,.png"
      style={{ display: 'none' }}
      onChange={(e) => pick(e.target.files?.[0])}
    />
  );

  if (status === 'review' && register) {
    const differs = serviceAddressDiffers(register);
    const owners = register.owners || [];
    return (
      <div style={{ ...box, border: '1px solid #bfd0ea', background: '#f5f9ff' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
          Land Registry — please check before using
        </div>

        <div style={smallLabel}>Property</div>
        <div style={{ fontSize: 13.5, marginBottom: 8 }}>
          {register.property_address || <em style={{ color: 'var(--text3)' }}>not found</em>}
          {register.title_number ? <span style={{ color: 'var(--text3)' }}> · Title {register.title_number}</span> : null}
          {register.tenure ? <span style={{ color: 'var(--text3)' }}> · {register.tenure}</span> : null}
        </div>

        <div style={smallLabel}>Registered owner{owners.length === 1 ? '' : 's'}</div>
        {owners.length === 0 ? (
          <div style={{ fontSize: 13.5, marginBottom: 8 }}><em style={{ color: 'var(--text3)' }}>no owner found</em></div>
        ) : (
          <div style={{ marginBottom: 8 }}>
            {owners.map((o, i) => (
              <div key={i} style={{ fontSize: 13.5, marginTop: 2 }}>
                <strong>{displayOwnerName(o)}</strong>
                {o.kind === 'company' ? <span style={{ color: 'var(--text3)' }}> (company{o.company_number ? ` ${o.company_number}` : ''})</span> : null}
                {o.address_for_service ? <div style={{ fontSize: 12, color: 'var(--text3)' }}>Address for service: {o.address_for_service}</div> : null}
              </div>
            ))}
          </div>
        )}

        {owners.length > 2 && (
          <div style={{ fontSize: 12, color: '#b45309', marginBottom: 8 }}>
            The form has room for two owners; the other {owners.length - 2} will need adding afterwards.
          </div>
        )}

        {differs && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text2)', marginBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={useService} onChange={(e) => setUseService(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Also use the first owner’s address for service as the service / correspondence address (it is not the property itself)</span>
          </label>
        )}

        {register.notes && <div style={{ fontSize: 12, color: '#b45309', marginBottom: 8 }}>Note from the reader: {register.notes}</div>}

        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>
          This will fill in the {sideLabel} property and owner names below. You can still change anything afterwards.
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={apply} style={{ padding: '7px 16px', borderRadius: 99, border: 'none', background: 'var(--blue, #3b82f6)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Use these details
          </button>
          <button type="button" onClick={reset} style={{ padding: '7px 16px', borderRadius: 99, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
        {hiddenInput}
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={status === 'reading'}
          style={{ padding: '7px 14px', borderRadius: 99, border: '1px solid #bfd0ea', background: '#f5f9ff', color: '#1e40af', fontSize: 13, fontWeight: 600, cursor: status === 'reading' ? 'default' : 'pointer' }}
        >
          {status === 'reading' ? 'Reading Land Registry…' : '📄 Upload Land Registry'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>
          Optional — fills in the {sideLabel}’s names and property from the register (PDF or photo).
        </span>
      </div>
      {status === 'error' && (
        <div role="alert" style={{ marginTop: 8, fontSize: 12.5, color: 'var(--red, #b91c1c)' }}>{error}</div>
      )}
      {hiddenInput}
    </div>
  );
}
