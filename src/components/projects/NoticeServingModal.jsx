// PATCHES FOR src/components/projects/NoticeServingModal.jsx

// 1. Replace component props with:
export default function NoticeServingModal({
  project,
  ao,
  aos = [],
  defaultSections = [],
  generateDocument,
  onServe,
  onClose,
}) {

// 2. Add these states directly below existing useState declarations:
const [selectedAOId, setSelectedAOId] = useState(
  ao?.id || ao?.num || aos?.[0]?.id || aos?.[0]?.num || ''
);

const [createDeadlineTask, setCreateDeadlineTask] = useState(true);

// 3. Add this helper directly below state declarations:
const selectedAO =
  aos.find(
    a =>
      String(a.id || a.num) === String(selectedAOId)
  ) || ao;

// 4. Replace:
if (!ao) {

// WITH:
if (!selectedAO) {

// 5. Replace every instance of:
ao,

// WITH:
selectedAO,

// inside:
buildNoticePlaceholders(...)
fileName generation
onServe payload

// 6. Add this UI block ABOVE "Include covering letter":

<div style={{
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: 16,
}}>
  <div style={{
    fontSize: 12,
    fontWeight: 700,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    marginBottom: 12,
  }}>
    Adjoining owner / property
  </div>

  <select
    value={selectedAOId}
    onChange={e => setSelectedAOId(e.target.value)}
    style={{
      width: '100%',
      padding: '10px 12px',
      borderRadius: 12,
      border: '1px solid #d1d5db',
      background: '#fff',
      fontSize: 14,
    }}
  >
    {aos.map(item => (
      <option
        key={item.id || item.num}
        value={item.id || item.num}
      >
        AO{item.num || ''} — {item.name || 'Unnamed AO'}
      </option>
    ))}
  </select>
</div>

// 7. Add this UI block BELOW "Include covering letter":

<div style={{
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: 16,
}}>
  <label style={{
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    cursor: 'pointer',
    fontSize: 13,
    color: '#374151',
  }}>
    <input
      type="checkbox"
      checked={createDeadlineTask}
      onChange={e => setCreateDeadlineTask(e.target.checked)}
    />
    Create deadline task
  </label>
</div>

// 8. Replace onServe payload with:
await onServe({
  ao: selectedAO,
  sections: selected,
  includeCover,
  createDeadlineTask,
  warnings,
  generatedCount: generatedDocs.length,
});
