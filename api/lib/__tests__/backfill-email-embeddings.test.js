// api/__tests__/backfill-email-embeddings.test.js
//
// Security correction (2026-08-07): the endpoint previously checked a
// literal, hardcoded header value committed in this public repository —
// not authentication. These tests cover the replacement: a real secret,
// compared in constant time, read only from server-side environment
// configuration, plus the structural guarantees around concurrency,
// retry, and never leaking the secret.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { constantTimeEquals } from '../../backfill-email-embeddings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '../../backfill-email-embeddings.js'), 'utf8');

describe('constantTimeEquals — the actual comparison function, unit tested directly', () => {
  it('returns true for identical secrets', () => {
    expect(constantTimeEquals('abc123', 'abc123')).toBe(true);
  });

  it('returns false for a wrong secret of the same length', () => {
    expect(constantTimeEquals('abc123', 'abc124')).toBe(false);
  });

  it('returns false for a wrong secret of a different length', () => {
    expect(constantTimeEquals('abc123', 'abc123extra')).toBe(false);
  });

  it('returns false for empty or missing input on either side', () => {
    expect(constantTimeEquals('', 'abc123')).toBe(false);
    expect(constantTimeEquals('abc123', '')).toBe(false);
    expect(constantTimeEquals(undefined, 'abc123')).toBe(false);
  });

  it('does not throw on wildly different lengths (the original crypto.timingSafeEqual pitfall)', () => {
    expect(() => constantTimeEquals('a', 'a'.repeat(500))).not.toThrow();
  });
});

describe('backfill-email-embeddings.js — structural security guarantees (source-verified)', () => {
  it('the hardcoded public header check no longer exists as an actual check (a comment documenting the old behaviour is fine)', () => {
    expect(source).not.toContain("req.headers['x-nora-manual']");
  });

  it('requires EMBEDDING_BACKFILL_CRON_SECRET from environment, not a literal value', () => {
    expect(source).toContain('process.env.EMBEDDING_BACKFILL_CRON_SECRET');
  });

  it('fails closed (500, not silently permissive) when the secret is not configured at all', () => {
    const idx = source.indexOf('if (!configuredSecret)');
    const block = source.slice(idx, idx + 200);
    expect(block).toContain('500');
  });

  it('rejects with 401 when the supplied secret does not match', () => {
    expect(source).toMatch(/constantTimeEquals\(suppliedSecret, configuredSecret\)/);
    expect(source).toContain('res.status(401)');
  });

  it('uses node:crypto timingSafeEqual, not a plain === comparison, for the secret check', () => {
    expect(source).toContain("from 'node:crypto'");
    expect(source).toContain('timingSafeEqual');
  });

  it('never includes the secret value in any response payload', () => {
    // Every res.status(...).json(...) call site is checked for the
    // variable names that could carry the secret.
    const jsonCalls = source.match(/res\.status\(\d+\)\.json\(\{[^}]*\}\)/g) || [];
    for (const call of jsonCalls) {
      expect(call).not.toContain('configuredSecret');
      expect(call).not.toContain('suppliedSecret');
    }
  });

  it('uses the embedding_backfill_runs table for concurrency claim and operational logging', () => {
    expect(source).toContain("from('embedding_backfill_runs')");
    expect(source).toContain('.insert({ project_id: project_id || null })'); // atomic claim
  });

  it('treats a claim conflict as a safe skip, not an error', () => {
    const idx = source.indexOf('if (claimErr)');
    const block = source.slice(idx, idx + 400);
    expect(block).toContain('skipped');
  });

  it('logs started_at (via table default), completed_at, rows_selected, rows_embedded, rows_failed, error_summary, duration_ms', () => {
    expect(source).toContain('completed_at:');
    expect(source).toContain('rows_selected:');
    expect(source).toContain('rows_embedded:');
    expect(source).toContain('rows_failed:');
    expect(source).toContain('error_summary:');
    expect(source).toContain('duration_ms:');
  });

  it('never logs the embedding vector itself or email bodies to the operational log', () => {
    const updateIdx = source.indexOf("from('embedding_backfill_runs').update(");
    const block = source.slice(updateIdx, updateIdx + 400);
    expect(block).not.toMatch(/\bembedding:/); // the vector field, not the word inside rows_embedded
    expect(block).not.toContain('body:');
  });

  it('a row is only marked complete by successfully writing its embedding — failed rows stay eligible for retry', () => {
    expect(source).toMatch(/if \(embedding\) \{\s*await supabase\.from\('emails'\)\.update\(\{ embedding \}\)/);
  });

  it('one failed row cannot terminate the whole batch — per-row try/catch inside the loop', () => {
    const forIdx = source.indexOf('for (const row of rows');
    const loopBody = source.slice(forIdx, forIdx + 1400);
    expect(loopBody).toContain('try {');
    expect(loopBody).toContain('catch (rowErr)');
  });

  it('the operational log update runs in a finally block, so it always records the outcome even on error', () => {
    expect(source).toContain('} finally {');
  });
});
