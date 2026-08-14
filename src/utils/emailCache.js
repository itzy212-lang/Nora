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
