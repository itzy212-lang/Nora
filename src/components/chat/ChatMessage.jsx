import { useState } from 'react';
import { renderMarkdown } from '../../utils/formatters';
import DraftCard from './DraftCard';

function htmlToText(html = '') {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.innerText || div.textContent || '';
}

async function copyToClipboard(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    } catch {
      document.body.removeChild(textarea);
      return false;
    }
  }
}

export default function ChatMessage({ msg, onUseDraft, onOpenInComposer }) {
  const isUser = msg.role === 'user';
  const [copied, setCopied] = useState(false);
  const draftText = msg.draft || msg.documentText || '';
  const replyText = msg.content || msg.reply || '';
  const actionText = draftText || htmlToText(renderMarkdown(replyText));
  const showActions = !isUser && actionText.trim().length > 0;

  const handleCopy = async () => {
    const ok = await copyToClipboard(actionText);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  const handleCompose = () => {
    const body = actionText.trim();
    if (!body) return;
    onOpenInComposer?.({
      mode: 'compose',
      body,
      subject: msg.subject || '',
      to: msg.to || msg.recipient?.email || '',
      projectId: msg.projectId || msg.project_id || '',
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <div className={`chat-msg ${isUser ? 'user' : 'ely'}`}>
        {isUser ? (
          msg.content
        ) : (
          <div className="ely-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
        )}
      </div>

      {showActions && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7, marginLeft: isUser ? 0 : 4 }}>
          <button type="button" onClick={handleCopy} style={{ border: '1px solid var(--border)', background: copied ? 'var(--green-bg)' : 'var(--bg2)', color: copied ? 'var(--green)' : 'var(--text2)', borderRadius: 99, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer', fontWeight: 500 }}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" onClick={handleCompose} style={{ border: '1px solid var(--blue)', background: 'var(--blue-bg)', color: 'var(--blue)', borderRadius: 99, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer', fontWeight: 500 }}>
            Compose email
          </button>
        </div>
      )}

      {!isUser && msg.draft && (
        <DraftCard draft={msg.draft} draftType={msg.draftType} onUseDraft={onUseDraft} onOpenInComposer={onOpenInComposer} />
      )}

      {msg.suggestedActions?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {msg.suggestedActions.map((a, i) => (
            <span key={i} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 99, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg4)', color: 'var(--text2)', transition: 'all 0.15s' }}>
              {a}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
