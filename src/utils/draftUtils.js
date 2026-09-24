/**
 * draftUtils.js — shared draft utilities for Nora
 *
 * Imported by ALL composers and chat surfaces.
 * Fix it here = fixed everywhere.
 */

/**
 * Fire-and-forget diagnostic beacon — see api/client-diagnostic.js for why.
 * Never awaited, never blocks, never throws into the caller. Includes
 * whatever the browser will hand over about memory pressure (Chrome-only,
 * both fields undefined elsewhere — that itself is useful signal).
 */
export function logDiag(event, extra = {}) {
  try {
    const mem = (typeof performance !== 'undefined' && performance.memory) ? {
      usedJSHeapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
      totalJSHeapMB: Math.round(performance.memory.totalJSHeapSize / 1048576),
      limitJSHeapMB: Math.round(performance.memory.jsHeapSizeLimit / 1048576),
    } : null;
    const deviceMemoryGB = (typeof navigator !== 'undefined' && navigator.deviceMemory) || null;
    fetch('/api/client-diagnostic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ event, ...extra, mem, deviceMemoryGB, ua: typeof navigator !== 'undefined' ? navigator.userAgent : null }),
    }).catch(() => {});
  } catch {}
}

/**
 * Strip HTML tags from a draft and convert to plain text.
 * Used when the AI returns HTML markup in a draft despite being told not to.
 */
export function stripHtmlFromDraft(text) {
  if (!text || typeof text !== 'string') return text;
  // Only strip if the text actually contains HTML tags
  if (!/<[a-z][\s\S]*>/i.test(text)) return text;
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Strip embedded base64 image data (data:image/...;base64,....) out of
 * quoted/forwarded HTML before it gets re-appended into a new reply.
 *
 * Added 2026-09-24, real, confirmed live "Aw, Snap!" tab crash on
 * mobile, root-caused directly: every reply quotes the ENTIRE previous
 * email body verbatim underneath the new text — including any inline
 * images (most commonly a signature logo) already embedded as base64
 * text. That reply is then saved as the new email, so the next reply
 * quotes THAT (now-larger) body again, compounding every round trip.
 * Confirmed against real inbox data: active threads only a few days
 * old had grown to 120-266KB per email, almost entirely duplicated
 * base64 image data re-embedded at every hop. Rendering, editing and
 * serialising that much text inside a mobile contentEditable box is a
 * reliable way to exceed mobile Chrome's per-tab memory ceiling - and
 * explains why the crash wasn't tied to one specific action (dictating,
 * generating, copying, sending all have to handle the same bloated
 * content).
 *
 * The recipient has already received these images in the original
 * email - quoting them again adds weight, not information. Replaces
 * each embedded image with a small neutral placeholder so the quoted
 * text/layout is otherwise untouched.
 */
export function stripEmbeddedImagesFromQuote(html) {
  if (!html || typeof html !== 'string') return html;
  // Whole <img> tags with a base64 data: src — most common case
  // (signature logos, pasted screenshots).
  let out = html.replace(
    /<img\b[^>]*\bsrc\s*=\s*["']data:image\/[^"']*["'][^>]*>/gi,
    '<span style="display:inline-block;padding:2px 6px;border:1px solid #ddd;border-radius:4px;font-size:11px;color:#888;">[image omitted from quote]</span>'
  );
  // Catch-all for the same data URI appearing anywhere else (e.g.
  // background-image: url(data:image/...) in an inline style) that
  // the <img>-only pass above wouldn't touch — replace the base64
  // payload itself so nothing this heavy can slip through untouched.
  out = out.replace(
    /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi,
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
  );
  return out;
}

/**
 * Convert plain text to HTML paragraphs.
 * If already HTML, returns as-is.
 * Preserves paragraph breaks (double newline → <p>) and line breaks (single newline → <br>).
 * A block where every line starts "N. " (a genuine numbered list, one
 * item per line) renders as a real <ol><li> list instead of <br>-
 * separated text - added 2026-09-20, since a numbered list read back
 * as one flat, line-broken paragraph doesn't actually look like a
 * list to the recipient, just a wall of text with numbers in it.
 */
export function toHtml(text) {
  if (!text) return '';
  if (typeof text !== 'string') return '';
  if (text.trim().startsWith('<')) return text; // already HTML
  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(Boolean)
    .map((p, i, arr) => {
      const isLast = i === arr.length - 1;
      const margin = isLast ? '0' : '0 0 10px 0';

      const lines = p.split('\n').map(l => l.trim()).filter(Boolean);
      const isNumberedList = lines.length >= 2 && lines.every(l => /^\d+\.\s+/.test(l));
      if (isNumberedList) {
        const items = lines.map(l => `<li style="margin-bottom:6px">${l.replace(/^\d+\.\s+/, '')}</li>`).join('');
        return `<ol style="margin:${margin};padding-left:22px">${items}</ol>`;
      }

      return `<p style="margin:${margin}">${p.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

/**
 * Strip wrong sign-offs and names from a draft.
 * Always ends with "Kind regards," and nothing after it.
 * Handles multi-word names, wrong sign-offs, mixed capitalisation.
 * Also strips HTML tags if the AI generated them.
 */
export function cleanSignOff(draft) {
  if (!draft) return '';

  // Strip any HTML tags the AI may have generated
  let text = stripHtmlFromDraft(String(draft));

  // Remove any name (one or two words) after Kind regards
  // Handles: "Kind regards,\nItzik" or "Kind regards,\nItzik Darel"
  text = text.replace(
    /(Kind regards,?\s*)\n[\s\S]{0,50}$/i,
    'Kind regards,'
  );

  // Replace wrong sign-offs (Best, Cheers, Regards, etc.) with Kind regards
  // Also strips any name that follows on the next line
  text = text.replace(
    /\n(Cheers|Best|Best regards|Best wishes|Regards|Warm regards|Many thanks|Thanks|Yours sincerely|Yours faithfully),?[\s\S]{0,80}$/i,
    '\n\nKind regards,'
  );

  return text.trimEnd();
}

/**
 * Full draft clean — strip HTML, fix sign-off, then convert to HTML.
 * Call this before displaying any draft to the user.
 */
export function cleanDraft(draft) {
  if (!draft) return '';
  const cleaned = cleanSignOff(draft);
  return toHtml(cleaned);
}

/**
 * Strip HTML back to plain text.
 * Used when reading email bodies before sending to AI.
 */
export function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
