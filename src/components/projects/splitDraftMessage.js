// Splits an assistant chat message into intro / draft email / outro.
// Lives in its own module so it can be tested (ProjectDetail.jsx is too large to import in tests).

export function splitDraftMessage(content = '') {
  let text = String(content || '').trim();

  // Extract and strip AO_SUBJECT_REF tag before any other processing
  let aoSubjectRef = '';
  const aoRefMatch = text.match(/^AO_SUBJECT_REF:\s*(.+)$/m);
  if (aoRefMatch) {
    aoSubjectRef = aoRefMatch[1].trim();
    text = text.replace(/\n?AO_SUBJECT_REF:\s*.+$/m, '').trim();
  }

  // A greeting counts when it starts a line ("Hi,", "Hi Peter,", "Dear Sir",
  // "Hello,", "Good morning,") or, as before, appears with a trailing space.
  // Previously only "Hi " / "Dear " / "Hello " (with a space) matched, so an
  // email opening "Hi,\n\n..." was never recognised as a draft and got no
  // Copy / Open-in-composer buttons.
  const markers = ['Subject:', 'Dear ', 'Hi ', 'Hello '];
  let idx = -1;

  for (const marker of markers) {
    const found = text.indexOf(marker);
    if (found !== -1 && (idx === -1 || found < idx)) idx = found;
  }
  const lineStart = text.match(/(?:^|\n)[ \t]*(Subject\s*:|Dear\b|Hi\b|Hello\b|Good (?:morning|afternoon|evening)\b)/i);
  if (lineStart) {
    const at = lineStart.index + lineStart[0].search(/\S/);
    if (idx === -1 || at < idx) idx = at;
  }

  if (idx === -1) {
    return { intro: text, draft: '', outro: '', aoSubjectRef };
  }

  const intro = text.slice(0, idx).trim();
  let draft = text.slice(idx).trim();
  let outro = '';

  const outroPatterns = [
    /\n\s*Let me know if[\s\S]*$/i,
    /\n\s*Please let me know if[\s\S]*$/i,
    /\n\s*Happy to amend[\s\S]*$/i,
    /\n\s*I can amend[\s\S]*$/i,
    /\n\s*I can revise[\s\S]*$/i,
    /\n\s*I can also[\s\S]*$/i,
    /\n\s*This keeps[\s\S]*$/i,
    /\n\s*That should[\s\S]*$/i,
  ];

  for (const rx of outroPatterns) {
    const match = draft.match(rx);
    if (match) {
      outro = match[0].trim();
      draft = draft.replace(rx, '').trim();
      break;
    }
  }

  return { intro, draft, outro, aoSubjectRef };
}
