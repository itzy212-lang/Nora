// Automatic drafting is admins-only for now (28 Nov 2026). Source-level checks, in the same style as
// cron-auto-draft-eligibility.test.js, plus a real parse so a typo here cannot take the whole job down.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../../cron-auto-draft.js'), 'utf8');

describe('cron-auto-draft: admins only for now', () => {
  it('still parses as a module', async () => {
    await expect(transform(source, { loader: 'js', format: 'esm' })).resolves.toBeTruthy();
  });
  it('skips an email whose owner is not an admin, before any AI call for that email', () => {
    const gate = source.indexOf('isAdminUser(supabase, draftOwnerId)');
    const firstAi = source.indexOf("api.openai.com/v1/chat/completions", source.indexOf('for (const email of scopedEmails)'));
    expect(gate).toBeGreaterThan(0);
    expect(firstAi).toBeGreaterThan(gate);
    expect(source).toMatch(/if \(!adminByOwner\.get\(draftOwnerId\)\) \{ results\.skipped\+\+; continue; \}/);
  });
  it('imports the shared admin check rather than carrying its own', () => {
    expect(source).toContain("import { isAdminUser } from './lib/entitlements.js'");
  });
});
