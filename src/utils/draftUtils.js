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
    import('./crashBreadcrumbs').then(m => m.noteAction('diag: ' + event)).catch(() => {});
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
 * Convert plain text to email-safe HTML.
 * If already HTML, returns as-is.
 * Blank line -> new paragraph; single newline -> <br>.
 * Bullet lines ("- ", "* ", "\u2022 ") become a real <ul> list and numbered lines
 * ("1. " / "1) ", two or more together) a real <ol>, wherever they sit: on
 * their own, or straight after an intro line ("Points raised:"). Items
 * separated by blank lines still join into one list. Rendered as genuine
 * lists so they survive sending as bullets in Outlook and Gmail, instead of
 * a wall of hyphens.
 *
 * opts.gap   - space after each paragraph/list (default '10px'); null gives
 *              bare <p> tags with the client's default spacing.
 * opts.last  - space after the final element (default '0').
 */
const BULLET_RE = /^[-*\u2022\u00b7\u2013]\s+/;
const NUMBER_RE = /^\d+[.)]\s+/;

export function toHtml(text, opts = {}) {
  if (!text) return '';
  if (typeof text !== 'string') return '';
  if (text.trim().startsWith('<')) return text; // already HTML
  const gap = opts.gap === undefined ? '10px' : opts.gap;
  const lastGap = opts.last === undefined ? '0' : opts.last;

  // 1. Split into blocks, then each block into runs of text / bullets / numbers.
  const segments = []; // { type: 'p'|'ul'|'ol', lines: [], sameBlockAsPrev: bool }
  text.split(/\n\n+/).map(b => b.trim()).filter(Boolean).forEach(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    let blockSegs = [];
    lines.forEach(l => {
      const type = BULLET_RE.test(l) ? 'ul' : NUMBER_RE.test(l) ? 'ol' : 'p';
      const last = blockSegs[blockSegs.length - 1];
      const item = type === 'ul' ? l.replace(BULLET_RE, '') : type === 'ol' ? l.replace(NUMBER_RE, '') : l;
      if (last && last.type === type) last.lines.push(item);
      else blockSegs.push({ type, lines: [item] });
    });
    // A lone numbered line is just text, not a list.
    blockSegs = blockSegs.map(sg => (sg.type === 'ol' && sg.lines.length < 2
      ? { type: 'p', lines: sg.lines.map((x, i) => (i === 0 ? '1. ' : '') + x) } : sg));
    // Merge neighbouring text runs created by the step above.
    blockSegs = blockSegs.reduce((acc, sg) => {
      const prev = acc[acc.length - 1];
      if (prev && prev.type === 'p' && sg.type === 'p') prev.lines.push(...sg.lines); else acc.push(sg);
      return acc;
    }, []);
    blockSegs.forEach((sg, i) => segments.push({ ...sg, joinsPrev: i > 0 }));
  });

  // 2. Items separated by blank lines still belong to one list.
  const merged = [];
  segments.forEach(sg => {
    const prev = merged[merged.length - 1];
    if (prev && sg.type !== 'p' && prev.type === sg.type && !sg.joinsPrev) prev.lines.push(...sg.lines);
    else merged.push({ ...sg });
  });

  // 3. Render.
  return merged.map((sg, i) => {
    const isLast = i === merged.length - 1;
    const next = merged[i + 1];
    // An intro line sits close to the list that follows it.
    const introGap = sg.type === 'p' && next && next.type !== 'p' && next.joinsPrev ? '4px' : gap;
    const margin = isLast ? lastGap : introGap;
    if (sg.type === 'p') {
      const inner = sg.lines.join('<br>');
      return gap === null ? `<p>${inner}</p>` : `<p style="margin:0 0 ${margin} 0">${inner}</p>`;
    }
    const tag = sg.type;
    const style = `margin:0 0 ${margin === null ? '10px' : margin} 0;padding-left:22px;list-style-type:${tag === 'ul' ? 'disc' : 'decimal'}`;
    const items = sg.lines.map(x => `<li style="margin-bottom:4px">${x}</li>`).join('');
    return `<${tag} style="${style}">${items}</${tag}>`;
  }).join('');
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
