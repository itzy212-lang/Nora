// api/lib/__tests__/extract-email-memory.test.js
//
// Structural tests for extract-email-memory.js's new dual authentication
// (2026-08-08) — fixes a genuine, previously-unauthenticated endpoint
// found while wiring it to also be called automatically from a database
// trigger, not just the frontend.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '../../extract-email-memory.js'), 'utf8');

describe('extract-email-memory.js — dual authentication (2026-08-08)', () => {
  it('rejects requests with no valid authorization at all', () => {
    expect(source).toContain('isAuthorised(req)');
    const idx = source.indexOf('if (!(await isAuthorised(req)))');
    expect(source.slice(idx, idx + 80)).toContain('401');
  });

  it('accepts the trigger secret via constant-time comparison, not a plain string check', () => {
    expect(source).toContain('constantTimeEquals');
    expect(source).toContain('timingSafeEqual');
    expect(source).toContain('EXTRACT_EMAIL_MEMORY_TRIGGER_SECRET');
  });

  it('also accepts a real user session token, so existing frontend callers keep working', () => {
    expect(source).toContain('supabase.auth.getUser(token)');
  });

  it('no duplicate imports or declarations were left behind by the edit', () => {
    const importCount = (source.match(/^import \{ createClient \}/gm) || []).length;
    const supabaseDeclCount = (source.match(/^const supabase = createClient\(/gm) || []).length;
    expect(importCount).toBe(1);
    expect(supabaseDeclCount).toBe(1);
  });
});
