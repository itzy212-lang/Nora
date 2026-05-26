import { useMemo, useState } from 'react';

const NOTICE_TYPES = [
  { key: 's1', label: 'Section 1 Notice', deadlineDays: 14 },
  { key: 's3', label: 'Section 3 Notice', deadlineDays: 14 },
  { key: 's6', label: 'Section 6 Notice', deadlineDays: 14 },
  { key: 's10', label: 'Section 10 Notice', deadlineDays: 10 },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function aoKey(item) {
  return String(item?.id || item?.num || item?.ao_id || item?.name || item?.premise || item?.address || '');
}

function aoAddress(item) {
  return item?.premise || item?.reg_addr || item?.address || item?.service_address || item?.serviceAddress || '';
}

function normaliseAOList({ ao, aos, project }) {
  const sources = [
    Array.isArray(aos) ? aos : [],
    Array.isArray(project?.aos) ? project.aos : [],
    ao ? [ao] : [],
  ];

  const seen = new Set();
  const out = [];

  for (const source of sources) {
    for (const item of source) {
      if (!item) continue;
      const key = aoKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }

  return out;
}

export default function NoticeServingModal({
  project,
  ao,
  aos = [],
  defaultSections = [],
  onServe,
  onClose,
}) {
  const lockedToSingleAO = !!ao;

  const availableAOs = useMemo(
    () => lockedToSingleAO ? [ao] : normaliseAOList({ ao, aos, project }),
    [ao, aos, project, lockedToSingleAO]
  );

  const [selectedAOKeys, setSelectedAOKeys] = useState(
    lockedToSingleAO && ao ? [aoKey(ao)] : []
  );

  const [selected, setSelected] = useState(defaultSections || []);
  const [includeCover, setIncludeCover] = useState(!defaultSections?.includes('s10'));
  const [createDeadlineTask, setCreateDeadlineTask] = useState(true);
  const [noticeDate, setNoticeDate] = useState(todayIso());
  const [loading, setLoading] = useState(false);

  const selectedAOs = availableAOs.filter(item => selectedAOKeys.includes(aoKey(item)));

  const toggleAO = item => {
    if (lockedToSingleAO) return;

    const key = aoKey(item);

    setSelectedAOKeys(prev =>
      prev.includes(key)
        ? prev.filter(v => v !== key)
        : [...prev, key]
    );
  };

  const toggleNotice = key => {
    setSelected(prev =>
      prev.includes(key)
        ? prev.filter(v => v !== key)
        : [...prev, key]
    );
  };

  const handleServe = async () => {
    if (!selectedAOs.length) {
      alert('Please select at least one adjoining owner/property.');
      return;
    }

    if (!selected.length) {
      alert('Please select at least one notice type.');
      return;
    }

    if (typeof onServe !== 'function') {
      alert('Notice workflow handler is not connected.');
      return;
    }

    setLoading(true);

    try {
      for (const selectedAO of selectedAOs) {
        await onServe({
          ao: selectedAO,
          sections: selected,
          includeCover,
          createDeadlineTask,
          noticeDate,
        });
      }

      onClose?.();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to serve notices.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: 'rgba(15,23,42,0.55)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 18,
    }}>
      <div style={{
        width: 760,
        maxWidth: '96vw',
        maxHeight: '88vh',
        overflowY: 'auto',
        background: '#eef1f5',
        border: '1px solid #d8dde6',
        borderRadius: 22,
        boxShadow: '0 24px 70px rgba(15,23,42,0.35)',
      }}>
        <div style={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          background: '#eef1f5',
          padding: '18px 22px 12px',
          borderBottom: '1px solid #d8dde6',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>
              Serve Notices
            </div>
          </div>

          <button onClick={onClose} style={{
            border: 'none',
            background: 'transparent',
            color: '#6b7280',
            cursor: 'pointer',
            fontSize: 24,
            lineHeight: 1,
          }}>
            ×
          </button>
        </div>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>
              Notice date
            </div>

            <input
              type="date"
              value={noticeDate}
              onChange={e => setNoticeDate(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 12,
                border: '1px solid #d1d5db',
                fontSize: 13,
              }}
            />
          </div>

          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>
              Adjoining owner / property
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {availableAOs.map(item => {
                const key = aoKey(item);
                const active = selectedAOKeys.includes(key);

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleAO(item)}
                    disabled={lockedToSingleAO}
                    style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      borderRadius: 14,
                      border: active ? '2px solid #2563eb' : '1px solid #e5e7eb',
                      background: active ? '#eff6ff' : '#fff',
                      color: active ? '#1d4ed8' : '#111827',
                      cursor: lockedToSingleAO ? 'default' : 'pointer',
                    }}
                  >
                    <div>AO{item?.num || ''} — {item?.name || 'Unnamed AO'}</div>
                    {aoAddress(item) && (
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                        {aoAddress(item)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>
              Select notices
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {NOTICE_TYPES.map(item => {
                const active = selected.includes(item.key);

                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggleNotice(item.key)}
                    style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      borderRadius: 14,
                      border: active ? '2px solid #2563eb' : '1px solid #e5e7eb',
                      background: active ? '#eff6ff' : '#fff',
                      color: active ? '#1d4ed8' : '#111827',
                      cursor: 'pointer',
                    }}
                  >
                    <div>{item.label}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 14px',
                borderRadius: 99,
                border: '1px solid #d1d5db',
                background: '#fff',
                color: '#374151',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={handleServe}
              style={{
                padding: '8px 16px',
                borderRadius: 99,
                border: 'none',
                background: '#2563eb',
                color: '#fff',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Serving…' : 'Serve Notice Pack'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
