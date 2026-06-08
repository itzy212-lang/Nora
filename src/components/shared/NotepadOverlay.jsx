import { useState, useEffect, useCallback, useRef } from 'react';
import sb from '../../supabaseClient';

const COLORS = [
  { id: 'default',  bg: '#ffffff', border: '#e5e7eb' },
  { id: 'yellow',   bg: '#fff8e1', border: '#ffe082' },
  { id: 'green',    bg: '#f1f8e9', border: '#aed581' },
  { id: 'teal',     bg: '#e0f7fa', border: '#80deea' },
  { id: 'blue',     bg: '#e3f2fd', border: '#90caf9' },
  { id: 'purple',   bg: '#f3e5f5', border: '#ce93d8' },
  { id: 'pink',     bg: '#fce4ec', border: '#f48fb1' },
  { id: 'orange',   bg: '#fff3e0', border: '#ffcc80' },
];

function colorFor(id) {
  return COLORS.find(c => c.id === id) || COLORS[0];
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function NotepadOverlay({ onClose }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('list'); // 'list' | 'edit'
  const [activeNote, setActiveNote] = useState(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [color, setColor] = useState('default');
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef(null);
  const activeNoteId = useRef(null);
  const titleRef = useRef(null);
  const contentRef = useRef(null);

  const loadNotes = useCallback(async () => {
    if (!sb) return;
    const { data } = await sb
      .from('notes')
      .select('*')
      .order('pinned', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(100);
    setNotes(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const saveNote = useCallback(async (id, fields) => {
    if (!sb || !id) return;
    setSaving(true);
    await sb.from('notes').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
    setSaving(false);
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...fields } : n));
  }, []);

  const scheduleSave = useCallback((id, fields) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveNote(id, fields), 800);
  }, [saveNote]);

  const openNote = useCallback((note) => {
    setActiveNote(note);
    activeNoteId.current = note.id;
    setTitle(note.title || '');
    setContent(note.content || '');
    setColor(note.color || 'default');
    setMode('edit');
    setTimeout(() => {
      if (!note.title) titleRef.current?.focus();
      else contentRef.current?.focus();
    }, 80);
  }, []);

  const createNote = useCallback(async () => {
    if (!sb) {
      alert('Supabase not available');
      return;
    }
    try {
      const { data, error } = await sb
        .from('notes')
        .insert({ title: '', content: '', color: 'default' })
        .select()
        .single();
      if (error) throw error;
      if (data) {
        setNotes(prev => [data, ...prev]);
        openNote(data);
      }
    } catch (err) {
      console.error('[Notepad] createNote failed:', err);
      alert('Could not create note: ' + (err?.message || JSON.stringify(err)));
    }
  }, [openNote]);

  const handleTitleChange = (e) => {
    const val = e.target.value;
    setTitle(val);
    scheduleSave(activeNoteId.current, { title: val, content });
  };

  const handleContentChange = (e) => {
    const val = e.target.value;
    setContent(val);
    scheduleSave(activeNoteId.current, { title, content: val });
  };

  const handleColorChange = (colorId) => {
    setColor(colorId);
    saveNote(activeNoteId.current, { title, content, color: colorId });
  };

  const handleTogglePin = async (noteId, pinned, e) => {
    e.stopPropagation();
    await sb.from('notes').update({ pinned: !pinned }).eq('id', noteId);
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, pinned: !pinned } : n)
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)));
  };

  const deleteNote = useCallback(async () => {
    if (!activeNoteId.current || !sb) return;
    if (!window.confirm('Delete this note?')) return;
    await sb.from('notes').delete().eq('id', activeNoteId.current);
    setNotes(prev => prev.filter(n => n.id !== activeNoteId.current));
    setMode('list');
  }, []);

  const backToList = useCallback(() => {
    clearTimeout(saveTimer.current);
    if (activeNoteId.current && (title || content)) {
      saveNote(activeNoteId.current, { title, content, color });
    } else if (activeNoteId.current && !title && !content) {
      // Delete empty note silently
      sb.from('notes').delete().eq('id', activeNoteId.current);
      setNotes(prev => prev.filter(n => n.id !== activeNoteId.current));
    }
    setMode('list');
    setActiveNote(null);
    activeNoteId.current = null;
  }, [title, content, color, saveNote]);

  // Group notes
  const today = new Date().toDateString();
  const todayNotes = notes.filter(n => new Date(n.created_at).toDateString() === today);
  const earlierNotes = notes.filter(n => new Date(n.created_at).toDateString() !== today);
  const activeColor = colorFor(color);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={mode === 'list' ? onClose : backToList}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 9000 }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(420px, 100vw)',
        background: '#f8f9fa',
        zIndex: 9001,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
        animation: 'slideInRight 0.22s ease',
      }}>
        <style>{`
          @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
          .note-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.12); transform: translateY(-1px); }
          .note-card { transition: box-shadow 0.15s, transform 0.15s; }
          .color-btn:hover { transform: scale(1.2); }
          .color-btn { transition: transform 0.12s; }
        `}</style>

        {mode === 'list' ? (
          <>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '16px 16px 12px', borderBottom: '1px solid #e5e7eb', background: '#fff', gap: 10 }}>
              <div style={{ flex: 1, fontSize: 15, fontWeight: 700, color: '#111827' }}>📝 Notes</div>
              <button onClick={createNote} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                + New
              </button>
              <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6b7280', padding: '0 2px', lineHeight: 1 }}>×</button>
            </div>

            {/* Notes list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
              {loading ? (
                <div style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: 40 }}>Loading…</div>
              ) : notes.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📝</div>
                  <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 6 }}>No notes yet</div>
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>Tap + New to get started</div>
                </div>
              ) : (
                <>
                  {todayNotes.length > 0 && (
                    <>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 8 }}>Today</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                        {todayNotes.map(note => <NoteCard key={note.id} note={note} onClick={openNote} onTogglePin={handleTogglePin} />)}
                      </div>
                    </>
                  )}
                  {earlierNotes.length > 0 && (
                    <>
                      {todayNotes.length > 0 && <div style={{ fontSize: 10.5, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 8 }}>Earlier</div>}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {earlierNotes.map(note => <NoteCard key={note.id} note={note} onClick={openNote} onTogglePin={handleTogglePin} />)}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          /* Editor */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: activeColor.bg }}>
            {/* Editor header */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 8, borderBottom: `1px solid ${activeColor.border}` }}>
              <button onClick={backToList} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6b7280', padding: 0, lineHeight: 1 }}>←</button>
              <div style={{ flex: 1, fontSize: 11, color: '#9ca3af' }}>
                {saving ? 'Saving…' : activeNote?.updated_at ? `Saved ${formatDate(activeNote.updated_at)}` : ''}
              </div>
              <button onClick={deleteNote} style={{ background: 'none', border: 'none', fontSize: 15, cursor: 'pointer', color: '#9ca3af', padding: '4px 8px' }} title="Delete note">🗑</button>
            </div>

            {/* Title */}
            <input
              ref={titleRef}
              value={title}
              onChange={handleTitleChange}
              placeholder="Title"
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 18, fontWeight: 600, color: '#111827', padding: '16px 18px 8px', fontFamily: 'inherit' }}
            />

            {/* Content */}
            <textarea
              ref={contentRef}
              value={content}
              onChange={handleContentChange}
              placeholder="Start writing…"
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 14, color: '#374151', padding: '8px 18px 16px', fontFamily: 'inherit', resize: 'none', lineHeight: 1.65 }}
            />

            {/* Color picker */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px 16px', borderTop: `1px solid ${activeColor.border}` }}>
              <span style={{ fontSize: 11, color: '#9ca3af', marginRight: 4 }}>Colour</span>
              {COLORS.map(c => (
                <button
                  key={c.id}
                  className="color-btn"
                  onClick={() => handleColorChange(c.id)}
                  style={{
                    width: 22, height: 22, borderRadius: '50%', border: c.id === color ? '2px solid #3b82f6' : `2px solid ${c.border}`,
                    background: c.bg, cursor: 'pointer', padding: 0,
                  }}
                  title={c.id}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function NoteCard({ note, onClick, onTogglePin }) {
  const c = colorFor(note.color);
  const preview = note.content?.slice(0, 80) || '';

  return (
    <div
      className="note-card"
      onClick={() => onClick(note)}
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 12,
        padding: '10px 12px',
        cursor: 'pointer',
        position: 'relative',
        minHeight: 80,
      }}
    >
      {note.pinned && (
        <div style={{ position: 'absolute', top: 7, right: 7, fontSize: 11, opacity: 0.6 }}>📌</div>
      )}
      {note.title && (
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 4, paddingRight: note.pinned ? 16 : 0, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {note.title}
        </div>
      )}
      {preview && (
        <div style={{ fontSize: 11.5, color: '#6b7280', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
          {preview}
        </div>
      )}
      {!note.title && !preview && (
        <div style={{ fontSize: 11.5, color: '#9ca3af', fontStyle: 'italic' }}>Empty note</div>
      )}
      <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 8 }}>{formatDate(note.updated_at)}</div>
    </div>
  );
}
