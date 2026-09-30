import { describe, it, expect } from 'vitest';
import { htmlToPlainText, stripDisclaimerBoilerplate, plainTextBody } from '../../cron-auto-draft.js';

// Regression coverage for the 2026-09-30 fix: the Alex Frame email had
// the actual instruction Nora needed ("please see attached the PDF...
// sign and return just the two signature pages") sitting in the body
// at raw-HTML character 5,806 - beyond every flat character slice this
// file applies to email content - because raw HTML from Outlook/Word
// is front-loaded with non-content (style blocks, tags, entities) that
// a stripped plain-text version doesn't carry. These tests use a
// trimmed-down version of that real email's structure.

const ALEX_FRAME_STYLE_HTML = `<html><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta name="Generator" content="Microsoft Word 15 (filtered medium)"><style>
<!--
@font-face
\t{font-family:"Cambria Math"}
p.MsoNormal, li.MsoNormal, div.MsoNormal
\t{margin:0cm;
\tfont-size:12.0pt;
\tfont-family:"Aptos",sans-serif}
-->
</style></head><body lang="EN-GB"><div class="WordSection1"><p class="MsoNormal"><span style="font-size:11.0pt">Award pages signed and invoice. I will serve the award on the AOs</span></p><p class="MsoNormal"><span style="font-size:11.0pt">&nbsp;</span></p><p class="MsoNormal"><span style="font-size:10.0pt; font-family:&quot;Tahoma&quot;,sans-serif">Kind regards,</span></p><p class="MsoNormal"><span style="font-size:10.0pt; font-family:&quot;Tahoma&quot;,sans-serif">Alex M. Frame MSc., FRICS.</span></p><p class="MsoNormal"><span style="font-size:7.5pt; font-family:&quot;Arial&quot;,sans-serif">The information in this e-mail and any attached files is confidential and may be covered by legal and/or professional privilege or be subject to privacy legislation. It is intended solely for the individual or entity to which it is addressed.</span></p><p class="MsoNormal"><span style="font-size:7.5pt; font-family:&quot;Arial&quot;,sans-serif">If you receive this e-mail in error please notify the sender and then delete the e-mail immediately. DO NOT open any attachment.</span></p><div><p class="MsoNormal"><b><span>From:</span></b><span> Square One Consulting &lt;help@sq1consulting.co.uk&gt; <br><b>Sent:</b> 30 September 2026 13:59<br><b>To:</b> Alex Frame</span></p></div><p>Hi Alex,</p><p>That said, please see attached the PDF ready for you to countersign. Rather than printing and signing the full document, I'm happy for you to print, sign and return just the two signature pages.</p></div></body></html>`;

describe('cron-auto-draft plain-text extraction', () => {
  it('strips style blocks, tags and entities down to readable text', () => {
    const plain = htmlToPlainText(ALEX_FRAME_STYLE_HTML);
    expect(plain).not.toContain('<p');
    expect(plain).not.toContain('<span');
    expect(plain).not.toContain('font-family');
    expect(plain).not.toContain('&nbsp;');
    expect(plain).toContain('Award pages signed and invoice');
    expect(plain).toContain('please see attached the PDF');
  });

  it('moves the quoted instruction far earlier than it sits in the raw HTML', () => {
    const rawPos = ALEX_FRAME_STYLE_HTML.toLowerCase().indexOf('please see attached');
    const plain = htmlToPlainText(ALEX_FRAME_STYLE_HTML);
    const plainPos = plain.toLowerCase().indexOf('please see attached');
    expect(plainPos).toBeGreaterThan(-1);
    expect(plainPos).toBeLessThan(rawPos);
  });

  it('the real failure mode: instruction falls inside a realistic slice budget after full plain-text processing, but not on raw HTML', () => {
    const plain = plainTextBody({ body: ALEX_FRAME_STYLE_HTML });
    const plainPos = plain.toLowerCase().indexOf('please see attached');
    const rawPos = ALEX_FRAME_STYLE_HTML.toLowerCase().indexOf('please see attached');
    // With a 400-char budget (deliberately tight to mirror the original
    // bug's proportions on this shortened fixture), the raw HTML cuts
    // it off but the fully-processed plain text (stripped + disclaimer
    // removed) does not.
    expect(rawPos).toBeGreaterThan(400);
    expect(plainPos).toBeLessThan(400);
  });

  it('removes standalone confidentiality/legal disclaimer paragraphs', () => {
    const plain = stripDisclaimerBoilerplate(htmlToPlainText(ALEX_FRAME_STYLE_HTML));
    expect(plain).not.toContain('is confidential and may be covered');
    expect(plain).not.toContain('DO NOT open any attachment');
  });

  it('never removes a long substantive paragraph merely for mentioning a disclaimer keyword', () => {
    const longSubstantivePara = 'Please note this is a genuinely long paragraph about the confidential nature of the works schedule and the adjoining owner has raised several detailed points about access, timing, and the proposed underpinning method that go well beyond a simple boilerplate footer and should never be dropped just because it happens to use the word confidential somewhere in the middle of real substance that Nora needs to see and act on. '.repeat(2);
    expect(longSubstantivePara.length).toBeGreaterThan(600);
    const result = stripDisclaimerBoilerplate(longSubstantivePara);
    expect(result).toBe(longSubstantivePara);
  });

  it('preserves the quoted original message that sits after the signature/disclaimer block', () => {
    const plain = plainTextBody({ body: ALEX_FRAME_STYLE_HTML });
    expect(plain).toContain('Award pages signed and invoice');
    expect(plain).toContain('please see attached the PDF');
    expect(plain).not.toContain('is confidential and may be covered');
  });

  it('handles missing/empty body without throwing', () => {
    expect(htmlToPlainText(null)).toBe('');
    expect(htmlToPlainText(undefined)).toBe('');
    expect(htmlToPlainText('')).toBe('');
    expect(plainTextBody({ body: null })).toBe('');
    expect(plainTextBody({})).toBe('');
    expect(plainTextBody(null)).toBe('');
  });

  it('converts <br> and block-level tags into line breaks rather than gluing words together', () => {
    const plain = htmlToPlainText('<p>Line one</p><p>Line two<br>Line three</p>');
    expect(plain).not.toContain('Line oneLine two');
    expect(plain).toContain('Line one');
    expect(plain).toContain('Line two');
    expect(plain).toContain('Line three');
  });
});
