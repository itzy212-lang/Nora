import { useState } from 'react';
import { renderMarkdown } from '../../utils/formatters';
import DraftCard from './DraftCard';

function stripHtml(html = '') {
  const div = document.createElement('div');
  div.innerHTML = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n');

  return div.innerText || div.textContent || '';
}

export function normaliseDraftText(raw = '') {
  let text = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  if (!text) return '';

  text = text.replace(/^```[a-z]*\s*/i, '').replace(/```$/i, '').trim();

  const draftMarkers = [
    /\bSubject\s*:/i,
    /\bDear\s+[A-Z]/i,
    /\bHi\s+[A-Z]/i,
    /\bHello\s+[A-Z]/i,
  ];

  const positions = draftMarkers
    .map(rx => {
      const match = text.match(rx);
      return match ? match.index : -1;
    })
    .filter(index => index >= 0);

  if (positions.length) {
    text = text.slice(Math.min(...positions)).trim();
  }

  text = text
    .replace(/^Sure,?\s+.*?(?=\bSubject\s*:|\bDear\s+|\bHi\s+|\bHello\s+)/is, '')
    .replace(/^Here(?:'s| is)\s+.*?(?=\bSubject\s*:|\bDear\s+|\bHi\s+|\bHello\s+)/is, '')
    .trim();

  text = text
    .replace(/(Subject\s*:[^\n]+)\s*(?=Dear\s+)/i, '$1\n\n')
    .replace(/(Subject\s*:[^\n]+)\s*(?=Hi\s+)/i, '$1\n\n')
    .replace(/(Subject\s*:[^\n]+)\s*(?=Hello\s+)/i, '$1\n\n')
    .replace(/([^\n])\s*(Dear\s+[^\n,]+,)/i, '$1\n\n$2')
    .replace(/([^\n])\s*(Hi\s+[^\n,]+,)/i, '$1\n\n$2')
    .replace(/([^\n])\s*(Hello\s+[^\n,]+,)/i, '$1\n\n$2')
    .replace(/([.!?])\s+(Please\s+)/g, '$1\n\n$2')
    .replace(/([.!?])\s+(As\s+stipulated|Under\s+section|However,|I have also|Should you|Kind regards,|Best regards,|Regards,)/g, '$1\n\n$2')
    .replace(/\s*(Kind regards,|Best regards,|Regards,)\s*/i, '\n\n$1\n')
    .replace(/\[Your Name\]|\[Your Position\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
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
    textarea.style.whiteSpace = 'pre-wrap';

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
  const isDraftOnly = msg.messageType === 'draft';
  const [copied, setCopied] = useState(false);

  const replyText = msg.content || msg.reply || '';
  const rawDraft = msg.draft || msg.documentText || (isDraftOnly ? replyText : '');
  const draftText = normaliseDraftText(rawDraft);
  const actionText = draftText || stripHtml(renderMarkdown(replyText));

  const showActions = !isUser && actionText.trim().length > 0 && (isDraftOnly || msg.draft);

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

    const subjectMatch = body.match(/^Subject\s*:\s*(.+)$/im);

    const bodyWithoutSubject = subjectMatch
      ? body.replace(/^Subject\s*:\s*.+\n*/im, '').trim()
      : body;

    onOpenInComposer?.({
      mode: 'compose',
      body: bodyWithoutSubject,
      subject: msg.subject || subjectMatch?.[1]?.trim() || '',
      to: msg.to || msg.recipient?.email || '',
      projectId: msg.projectId || msg.project_id || '',
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <div className={`chat-msg ${isUser ? 'user' : 'ely'} ${isDraftOnly ? 'draft-only' : ''}`}>
        {isUser ? (
          msg.content
        ) : isDraftOnly ? (
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              fontSize: 'inherit',
              lineHeight: 1.65,
            }}
          >
            {draftText}
          </pre>
        ) : (
          <div
            className="ely-md"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
          />
        )}
      </div>

      {showActions && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            marginTop: 7,
            marginLeft: isUser ? 0 : 4,
          }}
        >
          <button
            type="button"
            onClick={handleCopy}
            style={{
              border: '1px solid var(--border)',
              background: copied ? 'var(--green-bg)' : 'var(--bg2)',
              color: copied ? 'var(--green)' : 'var(--text2)',
              borderRadius: 99,
              padding: '4px 10px',
              fontSize: 11.5,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>

          <button
            type="button"
            onClick={handleCompose}
            style={{
              border: '1px solid var(--blue)',
              background: 'var(--blue-bg)',
              color: 'var(--blue)',
              borderRadius: 99,
              padding: '4px 10px',
              fontSize: 11.5,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Compose email
          </button>
        </div>
      )}

      {!isUser && !isDraftOnly && msg.draft && (
        <DraftCard
          draft={draftText || msg.draft}
          draftType={msg.draftType}
          onUseDraft={onUseDraft}
          onOpenInComposer={onOpenInComposer}
        />
      )}

      {msg.suggestedActions?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {msg.suggestedActions.map((action, i) => (
            <span
              key={i}
              style={{
                fontSize: 11,
                padding: '3px 9px',
                borderRadius: 99,
                cursor: 'pointer',
                border: '1px solid var(--border)',
                background: 'var(--bg4)',
                color: 'var(--text2)',
                transition: 'all 0.15s',
              }}
            >
              {action}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
