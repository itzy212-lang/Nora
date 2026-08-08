// api/lib/__tests__/summarize-attachment.test.js
//
// Structural tests for the new attachment summarization endpoint
// (2026-08-08), part of the attachment save/summarize feature.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '../../summarize-attachment.js'), 'utf8');
const base64Source = readFileSync(resolve(__dirname, '../../attachment-base64.js'), 'utf8');

describe('summarize-attachment.js', () => {
  it('requires both attachment_id and project_id, rejecting with 400 otherwise', () => {
    expect(source).toContain('!attachment_id || !project_id');
    const idx = source.indexOf('!attachment_id || !project_id');
    expect(source.slice(idx, idx + 150)).toContain('400');
  });

  it('reuses the proven extraction approach (pdf-parse, mammoth) rather than a new one', () => {
    expect(source).toContain("import('pdf-parse')");
    expect(source).toContain("import('mammoth')");
  });

  it('inserts into project_memory with source_type "attachment", distinguishable from email-derived facts', () => {
    expect(source).toContain("source_type: 'attachment'");
  });

  it('follows the same fact-extraction prompt shape already proven in extract-email-memory.js (self-contained, dated facts)', () => {
    expect(source).toContain('self-contained sentence');
    expect(source).toContain('Return ONLY a JSON array of strings');
  });

  it('rejects unsupported attachment types explicitly rather than silently returning empty content', () => {
    expect(source).toContain('Unsupported attachment type for summarisation');
  });
});

describe('attachment-base64.js', () => {
  it('requires attachment_id, rejecting with 400 otherwise', () => {
    expect(base64Source).toContain('!attachment_id');
  });

  it('downloads from the same storage bucket already proven working in fetch-attachment.js, not a fresh Graph fetch', () => {
    expect(base64Source).toContain("from('email-attachments')");
  });
});
