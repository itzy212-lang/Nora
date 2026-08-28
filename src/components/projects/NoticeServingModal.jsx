import { useMemo, useState } from 'react';

const NOTICE_TYPES = [
  { key: 's6', label: 'Section 6(1) Notice', deadlineDays: 14 },
  { key: 's1', label: 'Section 1(5) Notice', deadlineDays: 14 },
  { key: 's2', label: 'Section 2(2) Notice', deadlineDays: 14 },
  { key: 's10', label: 'Section 10 Notice', deadlineDays: 10 },
];

// Added 2026-08-27, on request: standard, pre-worded work item phrases
// per section — selecting one drops it straight into a new work item,
// still fully editable and still able to use "Polish with AI"
// afterward. Wording confirmed directly, from a real dictated list —
// item s2[1] was the least clear in dictation and was flagged as such
// for review before this went live.
const STANDARD_WORK_ITEMS = {
  s6: [
    "Excavation of trench-fill foundations within 3 metres of the adjoining owner's building or structure.",
    "Excavation of trench-fill foundations supporting a box frame, within 3 metres of the adjoining owner's building or structure.",
    "Excavation of pad foundations within 3 metres of the adjoining owner's building or structure.",
  ],
  s1: [
    "Construction of a new flank wall along the line of junction, entirely upon the Building Owner's land.",
    "Construction of a new wall astride the line of junction.",
  ],
  s2: [
    "Cutting into the party wall for the purpose of, but not limited to, inserting steel beams.",
    "Cutting into the party wall to install flashing, exposing the party wall as necessary while the works proceed, and maintaining adequate and continuous weather protection throughout.",
    "Cutting into the party wall for the purpose of inserting a damp proof course.",
  ],
};

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

export default function NoticeServingModal({ project, ao, aos = [], defaultSections = [], onServe, onClose }) {
  const lockedToSingleAO = !!ao;

  const availableAOs = useMemo(
    () => lockedToSingleAO ? [ao] : normaliseAOList({ ao, aos, project }),
    [ao, aos, project, lockedToSingleAO]
  );

  const [selectedAOKeys, setSelectedAOKeys] = useState(lockedToSingleAO && ao ? [aoKey(ao)] : []);

  // Per-section, per-AO selection: { [sectionKey]: Set of aoKeys }
  // When single AO locked, all selected sections apply to that AO automatically
  const [sectionAOMap, setSectionAOMap] = useState({});

  // Which sections are globally selected (at least one AO assigned)
  const [selected, setSelected] = useState(defaultSections || []);

  const [includeCover, setIncludeCover] = useState(!defaultSections?.includes('s10'));
  const [createDeadlineTask, setCreateDeadlineTask] = useState(true);
  const [noticeDate, setNoticeDate] = useState(todayIso());
  const [loading, setLoading] = useState(false);

  // s2Subsections per AO: { [aoKey]: string }
  const [s2SubsectionsMap, setS2SubsectionsMap] = useState({});

  const [safeguardingMap, setSafeguardingMap] = useState({}); // { [aoKey]: boolean }
  const [aoTenureTypes, setAoTenureTypes] = useState({});

  // Works per section per AO: { [`${sec}-${aoKey}`]: string[] }
  const [sectionWorks, setSectionWorks] = useState({});

  const [polishingIndex, setPolishingIndex] = useState(null);
  const [dictatingIndex, setDictatingIndex] = useState(null);
  const [libraryOpenFor, setLibraryOpenFor] = useState(null); // workKey(sec, ak), or null

  const selectedAOs = availableAOs.filter(item => selectedAOKeys.includes(aoKey(item)));
  const multipleAOs = selectedAOs.length > 1;

  // Sections that have at least one AO assigned (or single AO mode)
  const showWorks = selected.some(s => ['s1', 's2', 's6'].includes(s));

  // Work item helpers — keyed by `${sec}-${ak}`
  const workKey = (sec, ak) => `${sec}-${ak}`;

  const getWorks = (sec, ak) => sectionWorks[workKey(sec, ak)] || [''];

  const updateWork = (sec, ak, index, value) => {
    const k = workKey(sec, ak);
    console.log('[works] updateWork key:', k, 'value:', value);
    setSectionWorks(prev => ({ ...prev, [k]: (prev[k] || ['']).map((item, i) => i === index ? value : item) }));
  };

  const addWork = (sec, ak) => {
    const k = workKey(sec, ak);
    setSectionWorks(prev => ({ ...prev, [k]: [...(prev[k] || ['']), ''] }));
  };

  // Added 2026-08-27, on request: inserts a standard phrase directly
  // as a new work item — same shape as addWork, just pre-filled
  // rather than blank. Still fully editable afterward.
  const addStandardWork = (sec, ak, phrase) => {
    const k = workKey(sec, ak);
    setSectionWorks(prev => {
      const current = prev[k] || [''];
      // Replace a single trailing blank item rather than appending
      // after it, so picking a standard phrase on a fresh, empty
      // section doesn't leave an unwanted empty row above it.
      const isSingleBlank = current.length === 1 && !current[0].trim();
      return { ...prev, [k]: isSingleBlank ? [phrase] : [...current, phrase] };
    });
  };

  const removeWork = (sec, ak, index) => {
    const k = workKey(sec, ak);
    setSectionWorks(prev => {
      const items = prev[k] || [''];
      return { ...prev, [k]: items.length > 1 ? items.filter((_, i) => i !== index) : [''] };
    });
  };

  const polishWork = async (sec, ak, index) => {
    const k = workKey(sec, ak);
    const raw = (sectionWorks[k] || [''])[index]?.trim();
    if (!raw) return;
    const pKey = `${k}-${index}`;
    setPolishingIndex(pKey);
    try {
      const res = await fetch('/api/polish-works', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: raw, section: sec }),
      });
      const data = await res.json();
      if (data.polished) updateWork(sec, ak, index, data.polished);
    } catch (err) {
      console.error('Polish failed:', err);
    } finally {
      setPolishingIndex(null);
    }
  };

  const startDictation = (sec, ak, index) => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = 'en-GB';
    recognition.interimResults = false;
    const dKey = `${workKey(sec, ak)}-${index}`;
    recognition.onresult = (e) => {
      updateWork(sec, ak, index, e.results[0][0].transcript);
      setDictatingIndex(null);
    };
    recognition.onerror = () => setDictatingIndex(null);
    recognition.onend = () => setDictatingIndex(null);
    setDictatingIndex(dKey);
    recognition.start();
  };

  const toggleAO = item => {
    if (lockedToSingleAO) return;
    const key = aoKey(item);
    setSelectedAOKeys(prev =>
      prev.includes(key) ? prev.filter(v => v !== key) : [...prev, key]
    );
  };

  const toggleNotice = key => {
    setSelected(prev =>
      prev.includes(key) ? prev.filter(v => v !== key) : [...prev, key]
    );
  };

  // Toggle whether a section applies to a specific AO
  const toggleSectionAO = (sec, ak) => {
    // Capture current selectedAO keys outside the setter to avoid stale closure
    const allSelectedKeys = selectedAOs.map(a => aoKey(a));
    setSectionAOMap(prev => {
      // If no explicit set yet, initialise with ALL selected AOs first
      // so toggling one deselects it rather than selecting only it
      const existing = prev[sec];
      const current = existing
        ? new Set(existing)
        : new Set(allSelectedKeys);
      if (current.has(ak)) current.delete(ak);
      else current.add(ak);
      return { ...prev, [sec]: current };
    });
  };

  // Which AOs does this section apply to?
  const getSectionAOs = (sec) => {
    if (!multipleAOs) return selectedAOs; // single AO: always applies
    const assigned = sectionAOMap[sec];
    // If nothing explicitly assigned, default to all selected AOs
    if (!assigned || assigned.size === 0) return selectedAOs;
    // Safely convert Set to array for filtering (guards against state serialisation issues)
    const assignedKeys = Array.from(assigned);
    if (!assignedKeys.length) return selectedAOs;
    return selectedAOs.filter(a => assignedKeys.includes(aoKey(a)));
  };

  const handleServe = async () => {
    if (!selectedAOs.length) { alert('Please select at least one adjoining owner/property.'); return; }
    if (!selected.length) { alert('Please select at least one notice type.'); return; }
    if (typeof onServe !== 'function') { alert('Notice workflow handler is not connected.'); return; }

    setLoading(true);
    console.log('[works] sectionWorks at submit:', JSON.stringify(sectionWorks));
    try {
      const tenureMap = Object.fromEntries(selectedAOs.map(a => [aoKey(a), aoTenureTypes[aoKey(a)] || '']));

      // Build per-AO section assignments and works
      const aoSectionMap = {}; // { aoKey: string[] } — which sections each AO gets
      const aoWorksMap = {};   // { aoKey: { sec: string[] } } — works per section per AO
      const aoS2SubsMap = {};  // { aoKey: string }

      for (const ao of selectedAOs) {
        const ak = aoKey(ao);
        aoSectionMap[ak] = [];
        aoWorksMap[ak] = {};
        aoS2SubsMap[ak] = s2SubsectionsMap[ak] || '';

        for (const sec of selected) {
          const sectionAOs = getSectionAOs(sec);
          if (sectionAOs.some(a => aoKey(a) === ak)) {
            aoSectionMap[ak].push(sec);
            const works = getWorks(sec, ak).filter(w => w.trim());
            if (works.length) aoWorksMap[ak][sec] = works;
          }
        }
        // Fallback: if this AO ended up with no sections, give it all selected sections
        if (!aoSectionMap[ak].length) {
          aoSectionMap[ak] = [...selected];
        }
      }

      await onServe({
        aos: selectedAOs,
        aoSectionMap,
        aoWorksMap,
        aoS2SubsMap,
        includeCover,
        createDeadlineTask,
        noticeDate,
        safeguardingMap,
        tenureMap,
        // Legacy flat fields for single-AO compatibility
        sections: selected,
        section2Subsections: s2SubsectionsMap[aoKey(selectedAOs[0])] || '',
        worksItems: Object.entries(sectionWorks).flatMap(([k, items]) => {
          const [sec] = k.split('-');
          return (items || []).filter(w => w.trim()).map(w => ({ text: w.trim(), sections: [sec] }));
        }),
        safeguarding: Object.values(safeguardingMap).some(Boolean), // legacy flat field
      });

      onClose?.();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to serve notices.');
    } finally {
      setLoading(false);
    }
  };

  const cardStyle = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18, padding: 16 };
  const labelStyle = { fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      <div style={{ width: 760, maxWidth: '96vw', maxHeight: '88vh', overflowY: 'auto', background: '#eef1f5', border: '1px solid #d8dde6', borderRadius: 22, boxShadow: '0 24px 70px rgba(15,23,42,0.35)' }}>

        {/* Header */}
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: '#eef1f5', padding: '18px 22px 12px', borderBottom: '1px solid #d8dde6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>Serve Notices</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: '#6b7280', cursor: 'pointer', fontSize: 24, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* AO selection */}
          <div style={cardStyle}>
            <div style={labelStyle}>Adjoining owner / property</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {availableAOs.map(item => {
                const key = aoKey(item);
                const active = selectedAOKeys.includes(key);
                return (
                  <button key={key} type="button" onClick={() => toggleAO(item)} disabled={lockedToSingleAO}
                    style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 14, border: active ? '2px solid #2563eb' : '1px solid #e5e7eb', background: active ? '#eff6ff' : '#fff', color: active ? '#1d4ed8' : '#111827', cursor: lockedToSingleAO ? 'default' : 'pointer' }}>
                    <div>AO{item?.num || ''} — {item?.name || 'Unnamed AO'}</div>
                    {aoAddress(item) && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{aoAddress(item)}</div>}
                    {active && (
                      <div onClick={e => e.stopPropagation()} style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                        {['', 'leaseholder', 'freeholder'].map(t => (
                          <button key={t} type="button" onClick={e => { e.stopPropagation(); setAoTenureTypes(prev => ({ ...prev, [key]: t })); }}
                            style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, cursor: 'pointer', border: (aoTenureTypes[key] || '') === t ? '1.5px solid #2563eb' : '1px solid #d1d5db', background: (aoTenureTypes[key] || '') === t ? '#2563eb' : '#f9fafb', color: (aoTenureTypes[key] || '') === t ? '#fff' : '#6b7280', fontWeight: 600 }}>
                            {t === '' ? 'Default' : t.charAt(0).toUpperCase() + t.slice(1)}
                          </button>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notice date */}
          <div style={cardStyle}>
            <div style={labelStyle}>Notice date</div>
            <input type="date" value={noticeDate} onChange={e => setNoticeDate(e.target.value)}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 12, border: '1px solid #d1d5db', fontSize: 13 }} />
          </div>

          {/* Notice type selection — with per-AO sub-toggles when multiple AOs selected */}
          <div style={cardStyle}>
            <div style={labelStyle}>Select notices</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {NOTICE_TYPES.map(item => {
                const active = selected.includes(item.key);
                const sectionAOs = active && multipleAOs ? getSectionAOs(item.key) : [];

                return (
                  <div key={item.key}>
                    <button type="button" onClick={() => toggleNotice(item.key)}
                      style={{ width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: 14, border: active ? '2px solid #2563eb' : '1px solid #e5e7eb', background: active ? '#eff6ff' : '#fff', color: active ? '#1d4ed8' : '#111827', cursor: 'pointer' }}>
                      {item.label}
                    </button>

                    {/* Per-AO toggles — shown when section selected and multiple AOs */}
                    {active && multipleAOs && (
                      <div style={{ marginTop: 6, paddingLeft: 14, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        <span style={{ fontSize: 11, color: '#6b7280', paddingTop: 4 }}>Applies to:</span>
                        {selectedAOs.map(a => {
                          const ak = aoKey(a);
                          const assigned = sectionAOMap[item.key];
                          // Default: all selected AOs. Once user clicks, track explicitly.
                          const isOn = !assigned || assigned.size === 0 || assigned.has(ak);
                          return (
                            <button key={ak} type="button"
                              onClick={() => toggleSectionAO(item.key, ak)}
                              style={{ fontSize: 11, padding: '3px 9px', borderRadius: 99, cursor: 'pointer', border: isOn ? '1.5px solid #2563eb' : '1px solid #d1d5db', background: isOn ? '#2563eb' : '#f9fafb', color: isOn ? '#fff' : '#6b7280', fontWeight: 600 }}>
                              AO{a.num || ''} — {aoAddress(a) || a.name || ak}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* S6 safeguarding — per AO */}
            {selected.includes('s6') && getSectionAOs('s6').length > 0 && (
              <div style={{ marginTop: 10, padding: '12px 14px', background: '#fef9f0', borderRadius: 12, border: '1px solid #fcd34d' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e', marginBottom: 8 }}>
                  Proposing to underpin / safeguard foundations?
                </div>
                {getSectionAOs('s6').map(aoItem => {
                  const ak = aoKey(aoItem);
                  const addr = aoAddress(aoItem) || aoItem.name || `AO${aoItem.num || ''}`;
                  return (
                    <label key={ak} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: '#92400e', marginBottom: 6 }}>
                      <input type="checkbox" checked={!!safeguardingMap[ak]} onChange={e => setSafeguardingMap(prev => ({ ...prev, [ak]: e.target.checked }))} style={{ width: 15, height: 15, cursor: 'pointer' }} />
                      {getSectionAOs('s6').length > 1 ? addr : 'Yes — tick to confirm'}
                    </label>
                  );
                })}
                <div style={{ fontSize: 11, color: '#92400e', marginTop: 4 }}>
                  Tick for each property where underpinning is proposed. Leave unticked where it is <strong>not</strong> proposed.
                </div>
              </div>
            )}
          </div>

          {/* Notifiable works — per section, per AO */}
          {['s6', 's2', 's1'].filter(sec => selected.includes(sec)).map(sec => {
            const secLabel = sec === 's1' ? 'Section 1' : sec === 's2' ? 'Section 2' : 'Section 6';
            const aosForSection = getSectionAOs(sec);

            return (
              <div key={sec} style={cardStyle}>
                <div style={labelStyle}>{secLabel} — Notifiable works</div>

                {aosForSection.map((aoItem, aoIdx) => {
                  const ak = aoKey(aoItem);
                  const items = getWorks(sec, ak);
                  const addr = aoAddress(aoItem) || aoItem.name || `AO${aoItem.num || ''}`;
                  const showAddrHeader = aosForSection.length > 1;

                  return (
                    <div key={ak} style={{ marginBottom: aoIdx < aosForSection.length - 1 ? 16 : 0 }}>
                      {showAddrHeader && (
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#1d4ed8', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid #e5e7eb' }}>
                          {addr}
                        </div>
                      )}

                      {/* S2 subsections per AO */}
                      {sec === 's2' && (
                        <div style={{ marginBottom: 8, padding: '10px 12px', background: '#f0f9ff', borderRadius: 10, border: '1px solid #bae6fd' }}>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#0369a1', marginBottom: 4 }}>
                            Section 2(2) subsections{showAddrHeader ? ` — ${addr}` : ''}
                          </label>
                          <input type="text" value={s2SubsectionsMap[ak] || ''} onChange={e => setS2SubsectionsMap(prev => ({ ...prev, [ak]: e.target.value }))}
                            placeholder="e.g. a, f, j, k"
                            style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #7dd3fc', fontSize: 13, background: '#fff', boxSizing: 'border-box' }} />
                          <div style={{ fontSize: 11, color: '#0369a1', marginTop: 3 }}>
                            Comma separated — brackets added automatically.
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {items.map((item, index) => (
                          <div key={index} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                            <div style={{ width: 20, paddingTop: 10, color: '#9ca3af', fontSize: 13, flexShrink: 0 }}>•</div>
                            <textarea value={item} onChange={e => updateWork(sec, ak, index, e.target.value)}
                              placeholder="Describe the work item..." rows={2}
                              style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }} />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 2 }}>
                              <button type="button" onClick={() => startDictation(sec, ak, index)} title="Dictate"
                                style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid #d1d5db', background: dictatingIndex === `${workKey(sec, ak)}-${index}` ? '#fee2e2' : '#f9fafb', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>
                                {dictatingIndex === `${workKey(sec, ak)}-${index}` ? 'stop' : 'mic'}
                              </button>
                              <button type="button" onClick={() => polishWork(sec, ak, index)} title="Polish with AI"
                                disabled={polishingIndex === `${workKey(sec, ak)}-${index}` || !item.trim()}
                                style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid #d1d5db', background: '#f0fdf4', cursor: 'pointer', fontSize: 13, lineHeight: 1, opacity: !item.trim() ? 0.4 : 1 }}>
                                {polishingIndex === `${workKey(sec, ak)}-${index}` ? '...' : 'AI'}
                              </button>
                              <button type="button" onClick={() => removeWork(sec, ak, index)} title="Remove"
                                style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid #fecaca', background: '#fff5f5', cursor: 'pointer', fontSize: 13, lineHeight: 1, color: '#ef4444' }}>
                                X
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button type="button" onClick={() => addWork(sec, ak)}
                          style={{ padding: '7px 14px', borderRadius: 10, border: '1px dashed #d1d5db', background: '#f9fafb', color: '#6b7280', cursor: 'pointer', fontSize: 13, flex: 1 }}>
                          + Add work item
                        </button>
                        {STANDARD_WORK_ITEMS[sec]?.length > 0 && (
                          <div style={{ position: 'relative', flex: 1 }}>
                            <button type="button" onClick={() => setLibraryOpenFor(prev => prev === workKey(sec, ak) ? null : workKey(sec, ak))}
                              style={{ padding: '7px 14px', borderRadius: 10, border: '1px solid #93c5fd', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer', fontSize: 13, width: '100%' }}>
                              + Standard item
                            </button>
                            {libraryOpenFor === workKey(sec, ak) && (
                              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #d1d5db', borderRadius: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 20, overflow: 'hidden' }}>
                                {STANDARD_WORK_ITEMS[sec].map((phrase, i) => (
                                  <button key={i} type="button"
                                    onClick={() => { addStandardWork(sec, ak, phrase); setLibraryOpenFor(null); }}
                                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: i < STANDARD_WORK_ITEMS[sec].length - 1 ? '1px solid #f0f0f0' : 'none', background: '#fff', cursor: 'pointer', fontSize: 12.5, lineHeight: 1.4, color: '#111827' }}
                                    onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                                    {phrase}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Cover letter */}
          <div style={cardStyle}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 13, color: '#374151' }}>
              <input type="checkbox" checked={includeCover} onChange={e => setIncludeCover(e.target.checked)} />
              Include covering letter
            </label>
          </div>

          {/* Deadline task */}
          <div style={cardStyle}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 13, color: '#374151' }}>
              <input type="checkbox" checked={createDeadlineTask} onChange={e => setCreateDeadlineTask(e.target.checked)} />
              Create deadline task
            </label>
          </div>

          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '10px 14px', fontSize: 12.5, color: '#6b7280', lineHeight: 1.55 }}>
            S1/S3/S6 create one 14-day deadline task for each selected AO. Section 10 creates one 10-day deadline task. Untick the task box if this is a duplicate or supplementary notice.
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={onClose}
              style={{ padding: '8px 14px', borderRadius: 99, border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="button" disabled={loading} onClick={handleServe}
              style={{ padding: '8px 16px', borderRadius: 99, border: 'none', background: '#2563eb', color: '#fff', cursor: loading ? 'not-allowed' : 'pointer' }}>
              {loading ? 'Serving…' : 'Serve Notice Pack'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
