import { useMemo, useState } from 'react';

const NOTICE_TYPES = [
  { key: 's6', label: 'Section 6(1) Notice', deadlineDays: 14 },
  { key: 's1', label: 'Section 1(5) Notice', deadlineDays: 14 },
  { key: 's2', label: 'Section 2(2) Notice', deadlineDays: 14 },
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
  const [s2Subsections, setS2Subsections] = useState('');
  const [worksItems, setWorksItems] = useState(['']);
  const [polishingIndex, setPolishingIndex] = useState(null);
  const [dictatingIndex, setDictatingIndex] = useState(null);

  const showWorks = selected.some(s => ['s1', 's2', 's6'].includes(s));

  const updateWork = (index, value) => {
    setWorksItems(prev => prev.map((item, i) => i === index ? value : item));
  };

  const addWork = () => setWorksItems(prev => [...prev, '']);

  const removeWork = (index) => {
    setWorksItems(prev => prev.length > 1 ? prev.filter((_, i) => i !== index) : ['']);
  };

  const polishWork = async (index) => {
    const raw = worksItems[index]?.trim();
    if (!raw) return;
    const section = selected.find(s => ['s1', 's2', 's6'].includes(s)) || 's2';
    setPolishingIndex(index);
    try {
      const res = await fetch('/api/polish-works', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: raw, section }),
      });
      const data = await res.json();
      if (data.polished) updateWork(index, data.polished);
    } catch (err) {
      console.error('Polish failed:', err);
    } finally {
      setPolishingIndex(null);
    }
  };

  const startDictation = (index) => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = 'en-GB';
    recognition.interimResults = false;
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      updateWork(index, transcript);
      setDictatingIndex(null);
    };
    recognition.onerror = () => setDictatingIndex(null);
    recognition.onend = () => setDictatingIndex(null);
    setDictatingIndex(index);
    recognition.start();
  };

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
          section2Subsections: s2Subsections,
          worksItems: worksItems.filter(w => w.trim()),
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

            {/* Section 2(2) subsections input — only shown when s2 is selected */}
            {selected.includes('s2') && (
              <div style={{ marginTop: 10, padding: '12px 14px', background: '#f0f9ff', borderRadius: 12, border: '1px solid #bae6fd' }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#0369a1', marginBottom: 6 }}>
                  Section 2(2) subsections
                </label>
                <input
                  type="text"
                  value={s2Subsections}
                  onChange={e => setS2Subsections(e.target.value)}
                  placeholder="e.g. a, f, j, k"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid #7dd3fc',
                    fontSize: 13,
                    background: '#fff',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ fontSize: 11, color: '#0369a1', marginTop: 4 }}>
                  Comma separated — brackets added automatically. e.g. "a, f, j, k" → (a)(f)(j)(k)
                </div>
              </div>
            )}
          </div>

          {/* Notifiable Works — shown when s1, s2 or s6 selected */}
          {showWorks && (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18, padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>
                Notifiable works
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {worksItems.map((item, index) => (
                  <div key={index} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <div style={{ width: 20, paddingTop: 10, color: '#9ca3af', fontSize: 13, flexShrink: 0 }}>•</div>
                    <textarea
                      value={item}
                      onChange={e => updateWork(index, e.target.value)}
                      placeholder="Describe the work item..."
                      rows={2}
                      style={{
                        flex: 1,
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid #d1d5db',
                        fontSize: 13,
                        resize: 'vertical',
                        fontFamily: 'inherit',
                      }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 2 }}>
                      <button
                        type="button"
                        onClick={() => startDictation(index)}
                        title="Dictate"
                        style={{
                          padding: '5px 8px',
                          borderRadius: 7,
                          border: '1px solid #d1d5db',
                          background: dictatingIndex === index ? '#fee2e2' : '#f9fafb',
                          cursor: 'pointer',
                          fontSize: 14,
                          lineHeight: 1,
                        }}
                      >
                        {dictatingIndex === index ? '⏹' : '🎤'}
                      </button>
                      <button
                        type="button"
                        onClick={() => polishWork(index)}
                        title="Polish with AI"
                        disabled={polishingIndex === index || !item.trim()}
                        style={{
                          padding: '5px 8px',
                          borderRadius: 7,
                          border: '1px solid #d1d5db',
                          background: '#f0fdf4',
                          cursor: polishingIndex === index ? 'wait' : 'pointer',
                          fontSize: 13,
                          lineHeight: 1,
                          opacity: !item.trim() ? 0.4 : 1,
                        }}
                      >
                        {polishingIndex === index ? '…' : '✨'}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeWork(index)}
                        title="Remove"
                        style={{
                          padding: '5px 8px',
                          borderRadius: 7,
                          border: '1px solid #fecaca',
                          background: '#fff5f5',
                          cursor: 'pointer',
                          fontSize: 13,
                          lineHeight: 1,
                          color: '#ef4444',
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addWork}
                style={{
                  marginTop: 10,
                  padding: '7px 14px',
                  borderRadius: 10,
                  border: '1px dashed #d1d5db',
                  background: '#f9fafb',
                  color: '#6b7280',
                  cursor: 'pointer',
                  fontSize: 13,
                  width: '100%',
                }}
              >
                + Add work item
              </button>
            </div>
          )}

          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18, padding: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 13, color: '#374151' }}>
              <input
                type="checkbox"
                checked={includeCover}
                onChange={e => setIncludeCover(e.target.checked)}
              />
              Include covering letter
            </label>
          </div>

          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18, padding: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 13, color: '#374151' }}>
              <input
                type="checkbox"
                checked={createDeadlineTask}
                onChange={e => setCreateDeadlineTask(e.target.checked)}
              />
              Create deadline task
            </label>
          </div>

          <div style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 14,
            padding: '10px 14px',
            fontSize: 12.5,
            color: '#6b7280',
            lineHeight: 1.55,
          }}>
            S1/S3/S6 create one 14-day deadline task for each selected AO. Section 10 creates one 10-day deadline task. Untick the task box if this is a duplicate or supplementary notice.
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
