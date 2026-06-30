import { useState, useEffect } from 'react';
import { renderMarkdown } from '../../utils/formatters';
import DraftCard from './DraftCard';
import { useSpeech } from '../../hooks/useSpeech';

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
    /\bDear\s+(Sir|Madam|Sirs)/i,
    /\bHi\s+[A-Z0-9]/i,
    /\bHi\s*,/i,
    /\bHello\s+[A-Z0-9]/i,
    /\bHello\s*,/i,
    /\bGood\s+(morning|afternoon|evening)\s*,?\s*[A-Z]?/i,
    /\bTo\s+whom\s+it\s+may\s+concern/i,
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

/**
 * Parse FEE_AGREED: tag from an Ely message.
 * Returns { notice, soc, agreed_surveyor, separate } or null.
 */
export function parseFeeAgreed(text = '') {
  const match = String(text || '').match(/FEE_AGREED:\s*([^\n]+)/i);
  if (!match) return null;
  const parts = match[1].split(',').map(s => s.trim());
  const fees = {};
  parts.forEach(part => {
    const [key, val] = part.split('=').map(s => s.trim());
    if (key && val) fees[key] = val;
  });
  // Return null if no fee keys found
  if (!fees.notice && !fees.soc && !fees.agreed_surveyor && !fees.separate) return null;
  return {
    fee_notice: fees.notice || '100',
    fee_soc: fees.soc || '300',
    fee_agreed: fees.agreed_surveyor || '450',
    fee_separate: fees.separate || '600',
  };
}

/**
 * Parse AO_SUBJECT_REF: tag from an Ely message.
 * Returns an array of AO address strings, or [] if not present.
 */
export function parseAoSubjectRef(text = '') {
  const match = String(text || '').match(/AO_SUBJECT_REF:\s*([^\n]+)/i);
  if (!match) return [];
  return match[1].split(',').map(s => s.trim()).filter(Boolean);
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

export default function ChatMessage({ msg, onUseDraft, onOpenInComposer, onAttachQuote, onPreviewQuote }) {
  const isUser = msg.role === 'user';
  const isDraft = msg.messageType === 'draft';
  const [copied, setCopied] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const { speak, stop, speaking, autoPlay } = useSpeech();

  // Auto-play when a new Ely response arrives
  useEffect(() => {
    if (!isUser && autoPlay && replyText) {
      speak(replyText);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg.id]);

  const replyText = msg.content || msg.reply || '';
  const draftSource = msg.draft || msg.documentText || (isDraft ? replyText : '');
  const draftText = normaliseDraftText(draftSource);
  const actionText = isDraft ? draftText : '';

  // Strip the FEE_AGREED tag from displayed text
  const displayText = actionText
    .replace(/\nFEE_AGREED:[^\n]*/i, '')
    .replace(/\nAO_SUBJECT_REF:[^\n]*/i, '')
    .trim();

  // A FEE_AGREED tag can appear in a plain conversational confirmation message
  // ("Understood, I've got the fee structure locked in...") which is NOT
  // classified as a draft (no greeting/subject line), so it was never showing
  // Preview/Attach Quote at all even though the fees were genuinely agreed.
  // Check the raw reply directly, independent of isDraft.
  // Single source of truth for showing Preview/Attach Quote — fires on ANY
  // message containing FEE_AGREED, whether or not it's also classified as a
  // draft, so there is exactly one set of these buttons per message, never two.
  const hasFeeAgreement = /FEE_AGREED:/i.test(replyText);
  const nonDraftDisplayText = hasFeeAgreement
    ? replyText.replace(/\nFEE_AGREED:[^\n]*/i, '').replace(/FEE_AGREED:[^\n]*/i, '').trim()
    : '';

  const handleCopy = async () => {
    const ok = await copyToClipboard(displayText || actionText);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  const handleCompose = () => {
    const { subject, body } = splitSubjectFromDraft(displayText || actionText);
    if (!body) return;

    let cleanBody = body
      .replace(/(Kind regards,?\s*)\n[\s\S]{0,50}$/i, 'Kind regards,')
      .replace(/\n(Best regards|Best|Regards|Cheers|Warm regards),?[\s\S]{0,80}$/i, '\n\nKind regards,')
      .trim();

    const htmlBody = cleanBody
      .split(/\n\n+/)
      .map((para, i, arr) => `<p style="margin:${i===arr.length-1?'0':'0 0 10px 0'}">${para.replace(/\n/g, '<br>')}</p>`)
      .join('');

    const aoAddresses = parseAoSubjectRef(replyText);

    onOpenInComposer?.({
      mode: 'compose',
      body: htmlBody,
      subject: msg.subject || subject || '',
      to: msg.to || msg.recipient?.email || '',
      projectId: msg.projectId || msg.project_id || '',
      aoAddresses,
    });
  };

  const handleAttachQuote = async () => {
    if (quoteLoading) return;

    // Try to find FEE_AGREED tag from this message's content
    const fees = parseFeeAgreed(replyText) || parseFeeAgreed(draftSource);

    setQuoteLoading(true);
    try {
      await onAttachQuote?.(fees);
    } finally {
      setQuoteLoading(false);
    }
  };

  const handlePreviewQuote = async () => {
    if (previewLoading) return;

    const fees = parseFeeAgreed(replyText) || parseFeeAgreed(draftSource);

    setPreviewLoading(true);
    try {
      await onPreviewQuote?.(fees);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleGenerateDocument = () => {
    if (!actionText) return;
    onUseDraft?.(actionText);
  };

  const handleGeneratePdf = () => {
    if (!actionText) return;

    const escaped = (displayText || actionText)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br />');

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
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
  <body onload="window.print()">${escaped}</body>
</html>`;

    // Build a blob URL — far more reliable across browsers/mobile than
    // window.open('') + document.write, which often yields a blank tab.
    const blob = new Blob([html], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);

    const win = window.open(blobUrl, '_blank', 'noopener,noreferrer');

    if (!win) {
      // Popup blocked — fall back to a direct navigation so the user still sees the content.
      window.location.href = blobUrl;
      return;
    }

    // Release the blob URL once the new tab has had a chance to load it.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  };

  const displayDraftText = displayText || draftText;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <div className={`chat-msg ${isUser ? 'user' : 'ely'} ${isDraft ? 'draft-only' : ''}`}>
        {isUser ? (
          msg.content
        ) : isDraft ? (
          <div
            className="draft-body"
            style={{ lineHeight: 1.65, whiteSpace: 'pre-wrap' }}
            dangerouslySetInnerHTML={{
              __html: displayDraftText.trim().startsWith('<')
                ? displayDraftText
                : displayDraftText.split(/\n\n+/).filter(Boolean).map(p => `<p style="margin:0 0 0.75em 0">${p.replace(/\n/g, '<br>')}</p>`).join('')
            }}
          />
        ) : (
          <div className="ely-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(replyText) }} />
        )}
        {!isUser && replyText && (
          <button
            type="button"
            onClick={() => speaking ? stop() : speak(replyText)}
            title={speaking ? 'Stop reading' : 'Read aloud'}
            style={{
              marginTop: 6, marginLeft: 2,
              background: 'none', border: 'none',
              cursor: 'pointer', fontSize: 13,
              color: speaking ? 'var(--blue)' : 'var(--text3)',
              padding: '2px 4px', borderRadius: 6,
              opacity: 0.7,
            }}
          >
            {speaking ? '⏹' : '🔊'}
          </button>
        )}
      </div>

      {isDraft && (displayDraftText || actionText).trim().length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7, marginLeft: 4 }}>
          <button type="button" onClick={() => speaking ? stop() : speak(displayDraftText || actionText)} style={{
            border: '1px solid var(--border)', background: speaking ? 'var(--blue-bg)' : 'var(--bg2)',
            color: speaking ? 'var(--blue)' : 'var(--text2)', borderRadius: 99, padding: '4px 10px',
            fontSize: 11.5, cursor: 'pointer', fontWeight: 500,
          }} title={speaking ? 'Stop reading' : 'Read aloud'}>
            {speaking ? '⏹ Stop' : '🔊 Read'}
          </button>
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

          {/* Preview/Attach Quote intentionally NOT rendered here even on
              FEE_AGREED drafts — they render exactly once, below, from the
              single shared block (regardless of isDraft), to guarantee there
              is never more than one Preview Quote button per message. */}

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

      {/* Fee agreed in plain conversation, not classified as a draft —
          show just Preview/Attach Quote so the fees aren't stranded with no
          way to act on them. */}
      {hasFeeAgreement && (onPreviewQuote || onAttachQuote) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7, marginLeft: 4 }}>
          {onPreviewQuote && (
            <button type="button" onClick={handlePreviewQuote} disabled={previewLoading} style={{
              border: '1px solid var(--blue)', background: 'var(--blue-bg)', color: 'var(--blue)',
              borderRadius: 99, padding: '4px 10px', fontSize: 11.5, cursor: previewLoading ? 'not-allowed' : 'pointer',
              fontWeight: 500, opacity: previewLoading ? 0.6 : 1,
            }}>
              {previewLoading ? 'Generating…' : '👁 Preview Quote'}
            </button>
          )}
          {onAttachQuote && (
            <button type="button" onClick={handleAttachQuote} disabled={quoteLoading} style={{
              border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)',
              borderRadius: 99, padding: '4px 10px', fontSize: 11.5, cursor: quoteLoading ? 'not-allowed' : 'pointer',
              fontWeight: 500, opacity: quoteLoading ? 0.6 : 1,
            }}>
              {quoteLoading ? 'Generating…' : '📎 Attach Quote'}
            </button>
          )}
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
