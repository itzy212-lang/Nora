import { useState } from 'react';
import { renderMarkdown } from '../../utils/formatters';
import DraftCard from './DraftCard';

function stripHtml(html = '') {
  const div = document.createElement('div');
  div.innerHTML = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n');

  return div.innerText || div.textContent || '';
}

export function normaliseDraftText(raw = '') {
  let text = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!text) return '';

  text = text.replace(/^```[a-z]*\s*/i, '').replace(/```$/i, '').trim();

  const startMarkers = [
    /\bSubject\s*:/i,
    /\bDear\s+[A-Z0-9]/i,
    /\bHi\s+[A-Z0-9]/i,
    /\bHello\s+[A-Z0-9]/i,
  ];

  const starts = startMarkers
    .map(rx => {
      const m = text.match(rx);
      return m ? m.index : -1;
    })
    .filter(i => i >= 0);

  if (starts.length) text = text.slice(Math.min(...starts)).trim();

  text = text
    .replace(/^Thanks for the direction\.?\s*/i, '')
    .replace(/^Sure,?\s+.*?(?=\bSubject\s*:|\bDear\s+|\bHi\s+|\bHello\s+)/is, '')
    .replace(/^Here(?:'s| is)\s+.*?(?=\bSubject\s*:|\bDear\s+|\bHi\s+|\bHello\s+)/is, '')
    .replace(/^Draft\s*:\s*/i, '')
    .trim();

  [
    /\n-{3,}\s*\n\s*I included[\s\S]*$/i,
    /\n-{3,}\s*\n\s*I've included[\s\S]*$/i,
    /\n-{3,}\s*\n\s*This draft[\s\S]*$/i,
    /\n-{3,}\s*\n\s*Let me know[\s\S]*$/i,
    /\n\s*I included the[\s\S]*$/i,
    /\n\s*I've included the[\s\S]*$/i,
    /\n\s*Let me know if this tone[\s\S]*$/i,
    /\n\s*Let me know if this suits[\s\S]*$/i,
  ].forEach(rx => {
    text = text.replace(rx, '').trim();
  });

  text = text
    .replace(/\n\s*-{3,}\s*$/g, '')
    .replace(/^\s*-{3,}\s*\n/g, '')
    .replace(/(Subject\s*:[^\n]+)\s*(?=Dear\s+)/i, '$1\n\n')
    .replace(/(Subject\s*:[^\n]+)\s*(?=Hi\s+)/i, '$1\n\n')
    .replace(/(Subject\s*:[^\n]+)\s*(?=Hello\s+)/i, '$1\n\n')
    .replace(/([^\n])\s*(Dear\s+[^\n,]+,)/i, '$1\n\n$2')
    .replace(/([^\n])\s*(Hi\s+[^\n,]+,)/i, '$1\n\n$2')
    .replace(/([^\n])\s*(Hello\s+[^\n,]+,)/i, '$1\n\n$2')
    .replace(/([.!?])\s+(Please\s+)/g, '$1\n\n$2')
    .replace(/([.!?])\s+(As\s+stipulated|Under\s+section|However,|I have also|Should you|Additionally,|Kind regards,|Best regards,|Regards,)/g, '$1\n\n$2')
    .replace(/\s*(Kind regards,|Best regards,|Regards,)\s*/i, '\n\n$1\n')
    .replace(/\[Your Name\]|\[Your Position\]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

export function splitSubjectFromDraft(raw = '') {
  const draft = normaliseDraftText(raw);
  const subjectMatch = draft.match(/^Subject\s*:\s*(.+)$/im);

  if (!subjectMatch) return { subject: '', body: draft, full: draft };

  const subject = subjectMatch[1].trim();
  const body = draft.replace(/^Subject\s*:\s*.+\n*/im, '').trim();

  return { subject, body, full: draft };
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
  const isDraft = msg.messageType === 'draft';
  const [copied, setCopied] = useState(false);

  const replyText = msg.content || msg.reply || '';
  const draftSource = msg.draft || msg.documentText || (isDraft ? replyText : '');
  const draftText = normaliseDraftText(draftSource);
  const actionText = isDraft ? draftText : '';

  const handleCopy = async () => {
    const ok = await copyToClipboard(actionText);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  const handleCompose = () => {
    const { subject, body } = splitSubjectFromDraft(actionText);
    if (!body) return;

    onOpenInComposer?.({
      mode: 'compose',
      body,
      subject: msg.subject || subject || '',
      to: msg.to || msg.recipient?.email || '',
      projectId: msg.projectId || msg.project_id || '',
    });
  };

  const handleGenerateDocument = () => {
    if (!actionText) return;
    onUseDraft?.(actionText);
  };

  const handleGeneratePdf = () => {
    if (!actionText) return;

    const win = window.open('', '_blank', 'noopener,noreferrer');
    if (!win) return;

    const escaped = actionText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br />');

    win.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Draft PDF</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              font-size: 12pt;
              line-height: 1.55;
              padding: 36px;
              color: #111827;
            }
          </style>
        </head>
        <body>${escaped}</body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <div className={`chat-msg ${isUser ? 'user' : 'ely'} ${isDraft ? 'draft-only' : ''}`}>
        {isUser ? (
          msg.content
        ) : isDraft ? (
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 1.65 }}>
            {draftText}
          </pre>
        ) : (
          <div className="ely-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(replyText) }} />
        )}
      </div>

      {isDraft && actionText.trim().length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7, marginLeft: 4 }}>
          <button type="button" onClick={handleCopy} style={{
            border: '1px solid var(--border)', background: copied ? 'var(--green-bg)' : 'var(--bg2)',
            color: copied ? 'var(--green)' : 'var(--text2)', borderRadius: 99, padding: '4px 10px',
            fontSize: 11.5, cursor: 'pointer', fontWeight: 500,
          }}>
            {copied ? 'Copied' : 'Copy draft'}
          </button>

          <button type="button" onClick={handleCompose} style={{
            border: '1px solid var(--blue)', background: 'var(--blue-bg)', color: 'var(--blue)',
            borderRadius: 99, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer', fontWeight: 500,
          }}>
            Open in email composer
          </button>

          <button type="button" onClick={handleGenerateDocument} style={{
            border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)',
            borderRadius: 99, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer', fontWeight: 500,
          }}>
            Generate document
          </button>

          <button type="button" onClick={handleGeneratePdf} style={{
            border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)',
            borderRadius: 99, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer', fontWeight: 500,
          }}>
            Generate PDF
          </button>
        </div>
      )}

      {!isUser && !isDraft && msg.draft && (
        <DraftCard draft={draftText || msg.draft} draftType={msg.draftType} onUseDraft={onUseDraft} onOpenInComposer={onOpenInComposer} />
      )}

      {msg.suggestedActions?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {msg.suggestedActions.map((action, i) => (
            <span key={i} style={{
              fontSize: 11, padding: '3px 9px', borderRadius: 99, cursor: 'pointer',
              border: '1px solid var(--border)', background: 'var(--bg4)', color: 'var(--text2)',
              transition: 'all 0.15s',
            }}>
              {action}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
