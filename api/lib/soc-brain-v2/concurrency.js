// Added 2026-10-13: bounded-concurrency map that preserves input order.
//
// Why: the SOC pipeline makes one model call per note (D2), per section
// (D3, D5) and per section-pair batch (D6), all strictly one after
// another. A large inspection (e.g. 90 notes) therefore needs well over
// a hundred sequential calls and cannot finish inside the 300-second
// serverless limit - the request is killed with no error logged and the
// user sees nothing happen. The calls are independent of each other, so
// they can run several at a time. Results are returned in INPUT order and
// any rejection rejects the whole map (same failure behaviour as the
// sequential loops it replaces, so a stage still fails loudly).
export async function mapWithConcurrency(items, limit, fn) {
  const list = Array.from(items || []);
  const results = new Array(list.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit || 1, list.length));

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= list.length) return;
      results[i] = await fn(list[i], i);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
