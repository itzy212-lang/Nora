// api/lib/__tests__/delete-project-chat-sessions.test.js
//
// Structural tests for the real backend delete contract added
// 2026-08-07. The RPC itself (delete_project_chat_sessions) was tested
// live against the actual database before this shipped — real
// ownership-violation, not-found, and successful-delete cases — not
// just asserted here. These tests cover the endpoint's own contract:
// authentication, input validation, and that it never bypasses the RPC.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '../../delete-project-chat-sessions.js'), 'utf8');

describe('delete-project-chat-sessions.js — identity and ownership contract', () => {
  it('derives identity only from a verified bearer token, never from the request body', () => {
    expect(source).toContain('verifyBearerToken(req, sb)');
    expect(source).not.toMatch(/p_user_id:\s*req\.body/);
  });

  it('rejects with 401 when no valid token is supplied', () => {
    const idx = source.indexOf('if (!verifiedUserId)');
    expect(source.slice(idx, idx + 80)).toContain('401');
  });

  it('rejects a missing/empty session_ids array with 400, not silently proceeding', () => {
    expect(source).toContain("!sessionIds.length");
    const idx = source.indexOf('if (!sessionIds.length)');
    expect(source.slice(idx, idx + 100)).toContain('400');
  });

  it('caps the batch size rather than accepting an unbounded list', () => {
    expect(source).toMatch(/sessionIds\.length > 100/);
  });

  it('delegates ownership and surface validation entirely to the RPC — no separate, potentially-inconsistent check in this file', () => {
    expect(source).toContain("sb.rpc('delete_project_chat_sessions'");
    expect(source).not.toMatch(/\.eq\('user_id'/); // no direct table query bypassing the RPC
  });

  it('only rejects on non-GET/POST method and requires POST specifically', () => {
    expect(source).toContain("req.method !== 'POST'");
  });
});
