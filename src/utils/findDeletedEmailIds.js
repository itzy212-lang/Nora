// Given the emails a device is showing and the newest emails the database still
// holds, returns the ids that were deleted elsewhere (e.g. on another device).
// Never reports an email it cannot judge: ones older than the window the database
// returned, ones without a real database id, or ones without a date.
export function findDeletedEmailIds(local = [], dbRows = [], limit = 500) {
  const present = new Set((dbRows || []).map(r => r.id));
  const cutoff = (dbRows || []).length >= limit
    ? Date.parse(dbRows[dbRows.length - 1]?.received_at || '') || Infinity
    : -Infinity;
  const isRealId = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
  return (local || []).filter(e => {
    if (!isRealId(e.id) || present.has(e.id)) return false;
    const t = Date.parse(e.received_at || '');
    return !Number.isNaN(t) && t >= cutoff;
  }).map(e => e.id);
}
