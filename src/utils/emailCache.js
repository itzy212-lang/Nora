// src/utils/emailCache.js
//
// Real, persistent local storage for the email inbox — survives a
// full app close, unlike the in-memory-only React state that existed
// before this. Added 2026-08-14, on request: the actual end goal is
// "close and reopen shows the same inbox instantly, refresh just
// checks for what's new" — this is the piece that makes that true.
//
// Deliberately bounded: keeps the most recent MAX_CACHED_EMAILS on
// the device, evicting the oldest once that's exceeded, rather than
// growing without limit as someone scrolls back through months of
// history. IndexedDB, not localStorage — a single day's worth of real
// email bodies can already approach localStorage's ~5-10MB origin
// limit; IndexedDB has no such practical ceiling and handles this
// amount of data correctly.

const DB_NAME = 'nora_email_cache';
const DB_VERSION = 1;
const STORE_NAME = 'emails';
const MAX_CACHED_EMAILS = 1500;

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('received_at', 'received_at', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadCachedEmails() {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return []; // cache unavailable — caller falls back to a real fetch
  }
}

export async function saveCachedEmails(emails) {
  if (!emails || !emails.length) return;
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      emails.forEach(e => store.put(e));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    await enforceCacheBound();
  } catch (err) {
    console.error('[emailCache] save failed:', err);
    // Non-fatal — the app still works from live state, just without
    // a persistent cache for this session.
  }
}

// Added 2026-08-19, real confirmed bug: marking an email as read or
// replied updated the database and in-memory state, but never told
// the local cache — so a real refresh (which reads the cache first)
// would show the old, stale read/replied status, undoing what had
// just been done. This does a proper partial update: reads the
// existing cached entry (if any) and merges the change into it,
// rather than overwriting the whole cached row with just the changed
// fields, which would wipe out subject/sender/body/etc.
export async function updateCachedEmail(id, patch) {
  try {
    const db = await openDB();
    const existing = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (!existing) return; // not cached — nothing to update, the next full/incremental load will pick up the real state
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ ...existing, ...patch });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('[emailCache] update failed:', err);
  }
}

// Added 2026-08-19, same real bug class as updateCachedEmail above,
// found while investigating it further: deleting an email removed it
// from the database and in-memory state, but never the cache — so a
// deleted email would reappear after a real refresh.
export async function deleteCachedEmails(ids) {
  if (!ids || !ids.length) return;
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      ids.forEach(id => store.delete(id));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('[emailCache] delete failed:', err);
  }
}

async function enforceCacheBound() {
  try {
    const db = await openDB();
    const count = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (count <= MAX_CACHED_EMAILS) return;

    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('received_at');
      let toDelete = count - MAX_CACHED_EMAILS;
      const cursorReq = index.openCursor(); // ascending = oldest first
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor && toDelete > 0) {
          store.delete(cursor.primaryKey);
          toDelete -= 1;
          cursor.continue();
        }
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('[emailCache] eviction failed:', err);
  }
}

export async function getNewestCachedReceivedAt() {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const index = tx.objectStore(STORE_NAME).index('received_at');
      const req = index.openCursor(null, 'prev'); // descending = newest first
      req.onsuccess = () => resolve(req.result ? req.result.value.received_at : null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearEmailCache() {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('[emailCache] clear failed:', err);
  }
}

// Added 2026-09-17, real, confirmed bug: Inbox.jsx used to decide
// "has the cache been reconciled for the current user yet" with a
// plain module-level variable. That survives Inbox unmounting and
// remounting from in-app navigation (switching screens within a
// still-loaded page), but resets on any genuine page reload — which
// on mobile happens routinely when the browser/PWA backgrounds the
// tab and later discards it, not just on an actual logout. That
// reset made every such reload look like "a new user", triggering a
// full cache clear on exactly the case the persistent cache exists
// to survive. localStorage persists across real reloads (until
// explicitly cleared, e.g. at logout), which is what this needs.
const RECONCILED_USER_KEY = 'nora_email_cache_reconciled_user';

export function isCacheReconciledFor(userKey) {
  if (!userKey) return false;
  try {
    return localStorage.getItem(RECONCILED_USER_KEY) === userKey;
  } catch {
    return false;
  }
}

export function markCacheReconciled(userKey) {
  try {
    localStorage.setItem(RECONCILED_USER_KEY, userKey);
  } catch {}
}

export function clearReconciledCacheMarker() {
  try {
    localStorage.removeItem(RECONCILED_USER_KEY);
  } catch {}
}
