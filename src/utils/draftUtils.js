/**
 * draftUtils.js — shared draft utilities for Nora
 * 
 * Imported by ALL composers and chat surfaces.
 * Fix it here = fixed everywhere.
 */

/**
 * Convert plain text to HTML paragraphs.
 * If already HTML, returns as-is.
 */
export function toHtml(text) {
  if (!text) return '';
  if (typeof text !== 'string') return '';
  if (text.trim().startsWith('<')) return text; // already HTML
  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Strip wrong sign-offs and names from a draft.
 * Always ends with "Kind regards," and nothing after it.
 */
export function cleanSignOff(draft) {
  if (!draft) return '';
  return draft
    // Remove name after Kind regards
    .replace(/(Kind regards,?\s*)\n\s*\w+\s*$/i, 'Kind regards,')
    // Replace wrong sign-offs with Kind regards
    .replace(/\n(Cheers|Best|Best wishes|Regards|Warm regards|Many thanks|Thanks),?\s*\n?\s*\w*\s*$/i, '\n\nKind regards,')
    // Remove standalone name at very end
    .replace(/\n(Kind regards,)\s*\n\s*[A-Z][a-z]+\s*$/m, '\nKind regards,')
    .trimEnd();
}

/**
 * Full draft clean — HTML conversion + sign-off fix.
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
