import { describe, it, expect } from 'vitest';
import { findDeletedEmailIds } from '../findDeletedEmailIds';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mk = (n, d) => ({ id: id(n), received_at: `2026-10-${d}T10:00:00Z` });

describe('findDeletedEmailIds', () => {
  it('reports emails the database no longer has', () => {
    const local = [mk(1, 29), mk(2, 28), mk(3, 27)];
    expect(findDeletedEmailIds(local, [mk(1, 29), mk(3, 27)])).toEqual([id(2)]);
  });
  it('reports nothing when everything still exists', () => {
    const local = [mk(1, 29), mk(2, 28)];
    expect(findDeletedEmailIds(local, local)).toEqual([]);
  });
  it('ignores local emails older than a full page from the database', () => {
    const db = [mk(1, 29), mk(2, 28)];
    const local = [mk(1, 29), mk(2, 28), mk(9, 5)];
    expect(findDeletedEmailIds(local, db, 2)).toEqual([]);
  });
  it('still reports a missing email inside a full page window', () => {
    const db = [mk(1, 29), mk(3, 27)];
    expect(findDeletedEmailIds([mk(1, 29), mk(2, 28), mk(3, 27)], db, 2)).toEqual([id(2)]);
  });
  it('never touches emails without a real id or a date', () => {
    expect(findDeletedEmailIds([{ id: 'temp-1', received_at: '2026-10-29T00:00:00Z' }, { id: id(5) }], [])).toEqual([]);
  });
});
