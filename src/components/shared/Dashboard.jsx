import { useState } from 'react';

export default function DraftCard({ draft, draftType = 'general', onUseDraft, onOpenInComposer, compact = false }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const el = document.createElement('textarea');
      el.value = draft;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const typeLabel = {
    email: '📧 Email draft',
    letter: '📄 Letter draft',
    notice: '📋 Notice draft',
    award: '🏆 Award draft',
    soc: '🎙 SOC transcript',
    general: '📝 Draft',
  }[draftType] || '📝 Draft';

  return (
    <div className="draft-card fade-in">
      <div className="draft-card-header">
        <span>{typeLabel}</span>
        <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 400 }}>
          {draft.length} chars
        </span>
      </div>
      {!compact && (
        <div className="draft-card-body">{draft}</div>
      )}
      <div className="draft-card-actions">
        {onUseDraft && (
          <button className="btn btn-sm btn-primary" onClick={() => onUseDraft(draft)}>
            ✓ Use this draft
          </button>
        )}
        {onOpenInComposer && (
          <button className="btn btn-sm" onClick={() => onOpenInComposer(draft)}>
            ✏ Open in composer
          </button>
        )}
        <button className="btn btn-sm" onClick={handleCopy}>
          {copied ? '✓ Copied!' : '📋 Copy'}
        </button>
      </div>
    </div>
  );
}
