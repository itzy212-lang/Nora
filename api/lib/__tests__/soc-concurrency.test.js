import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../soc-brain-v2/concurrency.js';

describe('mapWithConcurrency', () => {
  it('returns results in input order even when later items finish first', async () => {
    const out = await mapWithConcurrency([30, 5, 20, 1], 4, async (ms, i) => { await new Promise(r => setTimeout(r, ms)); return i; });
    expect(out).toEqual([0, 1, 2, 3]);
  });
  it('never runs more than the limit at once', async () => {
    let running = 0, peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      running++; peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, 5));
      running--;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
  it('handles empty input and rejects if any call fails', async () => {
    expect(await mapWithConcurrency([], 5, async x => x)).toEqual([]);
    await expect(mapWithConcurrency([1, 2, 3], 2, async x => { if (x === 2) throw new Error('boom'); return x; })).rejects.toThrow('boom');
  });
});
