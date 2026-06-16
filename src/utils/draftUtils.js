/**
 * draftUtils.js — shared draft utilities for Nora
 *
 * Imported by ALL composers and chat surfaces.
 * Fix it here = fixed everywhere.
 */

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
 * Convert plain text to HTML paragraphs.
 * If already HTML, returns as-is.
 * Preserves paragraph breaks (double newline → <p>) and line breaks (single newline → <br>).
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
