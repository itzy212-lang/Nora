import { useState, useEffect, useCallback } from 'react';
import sb from '../../supabaseClient';

const s = {
  page: { padding: '24px 28px', maxWidth: 800 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 },
  subtitle: { fontSize: 13, color: 'var(--text3)', marginTop: 4 },
  addBtn: { padding: '9px 18px', borderRadius: 10, border: 'none', background: 'var(--blue)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 18px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 14 },
  avatar: { width: 38, height: 38, borderRadius: '50%', background: 'var(--blue-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: 'var(--blue)', flexShrink: 0 },
  name: { fontSize: 14, fontWeight: 600, color: 'var(--text)' },
  detail: { fontSize: 12.5, color: 'var(--text3)', marginTop: 2 },
  actions: { marginLeft: 'auto', display: 'flex', gap: 8 },
  editBtn: { padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', fontSize: 12, cursor: 'pointer', color: 'var(--text2)' },
  deleteBtn: { padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', fontSize: 12, cursor: 'pointer', color: 'var(--red)' },
  empty: { textAlign: 'center', padding: '60px 0', color: 'var(--text3)', fontSize: 14 },
  search: { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', fontSize: 13, color: 'var(--text)', outline: 'none', marginBottom: 16, boxSizing: 'border-box' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal: { background: 'var(--bg)', borderRadius: 18, padding: 28, width: '100%', maxWidth: 440 },
  modalTitle: { fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 20 },
  field: { marginBottom: 14 },
  label: { fontSize: 11.5, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5, display: 'block' },
  input: { width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg2)', fontSize: 13, color: 'var(--text)', outline: 'none', boxSizing: 'border-box' },
  modalBtns: { display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' },
  cancelBtn: { padding: '9px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2)', fontSize: 13, cursor: 'pointer', color: 'var(--text2)' },
  saveBtn: { padding: '9px 18px', borderRadius: 10, border: 'none', background: 'var(--blue)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
};

const EMPTY_FORM = { name: '', firm: '', email: '', phone: '', notes: '' };

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null); // null = new, object = edit
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data } = await sb
        .from('contacts')
        .select('*')
        .eq('user_id', user.id)
        .eq('type', 'surveyor')
        .order('name');
      setContacts(data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (c) => {
    setEditing(c);
    setForm({ name: c.name || '', firm: c.firm || '', email: c.email || '', phone: c.phone || '', notes: c.notes || '' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;

      if (editing) {
        await sb.from('contacts').update({
          name: form.name.trim(),
          firm: form.firm.trim() || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          notes: form.notes.trim() || null,
        }).eq('id', editing.id);
      } else {
        await sb.from('contacts').insert([{
          user_id: user.id,
          type: 'surveyor',
          name: form.name.trim(),
          firm: form.firm.trim() || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          notes: form.notes.trim() || null,
        }]);
      }
      setShowModal(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this contact?')) return;
    await sb.from('contacts').delete().eq('id', id);
    setContacts(prev => prev.filter(c => c.id !== id));
  };

  const filtered = contacts.filter(c => {
    const q = search.toLowerCase();
    return !q || c.name?.toLowerCase().includes(q) || c.firm?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q);
  });

  const initials = (name) => name?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Contacts</h1>
          <p style={s.subtitle}>Saved surveyors — auto-populated when you appoint them on projects</p>
        </div>
        <button style={s.addBtn} onClick={openAdd}>+ Add Contact</button>
      </div>

      <input
        style={s.search}
        placeholder="Search by name, firm or email…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {loading ? (
        <div style={s.empty}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={s.empty}>
          {search ? 'No contacts match your search' : 'No surveyor contacts saved yet — they\'ll appear here automatically when you appoint surveyors on projects'}
        </div>
      ) : (
        filtered.map(c => (
          <div key={c.id} style={s.card}>
            <div style={s.avatar}>{initials(c.name)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={s.name}>{c.name}</div>
              {c.firm && <div style={s.detail}>{c.firm}</div>}
              <div style={{ display: 'flex', gap: 12, marginTop: 3 }}>
                {c.email && <span style={s.detail}>{c.email}</span>}
                {c.phone && <span style={s.detail}>{c.phone}</span>}
              </div>
            </div>
            <div style={s.actions}>
              <button style={s.editBtn} onClick={() => openEdit(c)}>Edit</button>
              <button style={s.deleteBtn} onClick={() => handleDelete(c.id)}>Delete</button>
            </div>
          </div>
        ))
      )}

      {showModal && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div style={s.modal}>
            <div style={s.modalTitle}>{editing ? 'Edit Contact' : 'Add Contact'}</div>
            {['name', 'firm', 'email', 'phone', 'notes'].map(f => (
              <div key={f} style={s.field}>
                <label style={s.label}>{f.charAt(0).toUpperCase() + f.slice(1)}{f === 'name' && ' *'}</label>
                <input
                  style={s.input}
                  value={form[f]}
                  onChange={e => setForm(p => ({ ...p, [f]: e.target.value }))}
                  placeholder={f === 'name' ? 'Full name' : f === 'firm' ? 'Firm name' : f === 'email' ? 'email@example.com' : f === 'phone' ? '07700 000000' : 'Optional notes'}
                />
              </div>
            ))}
            <div style={s.modalBtns}>
              <button style={s.cancelBtn} onClick={() => setShowModal(false)}>Cancel</button>
              <button style={s.saveBtn} onClick={handleSave} disabled={saving || !form.name.trim()}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
