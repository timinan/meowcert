/**
 * One-slot local store for the player's uploaded "Custom Song" used in
 * rehearsal. Lives in IndexedDB because localStorage tops out around
 * 5-10 MB and an mp3 can blow that easily; IDB handles Blobs natively
 * with multi-GB capacity on both iOS Safari and Android Chrome inside
 * the Reddit Devvit webview.
 *
 * The slot holds:
 *   - the raw audio file as a Blob (we don't re-encode or trim it;
 *     playback uses an Object URL + audio.currentTime to start at the
 *     chosen offset)
 *   - the start-time offset in seconds (where the player wants the song
 *     to start during rehearsal)
 *   - the auto-detected BPM (saved so we don't re-run the analysis on
 *     every PLAY EXISTING tap)
 *
 * One slot ever — "REPLACE" wipes the row and stores the new one. There
 * is no "share" affordance — this audio never leaves the device, which
 * sidesteps copyright/moderation concerns for arbitrary user uploads.
 */

const DB_NAME = 'meowcert';
const STORE = 'custom-song';
const SLOT_KEY = 'slot';
const DB_VERSION = 1;

export interface CustomSongSlot {
  blob: Blob;
  startSec: number;
  bpm: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txn<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) =>
    new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const req = op(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
  );
}

/** Read the current slot. `null` if the player has never uploaded one
 *  (or if they hit REPLACE and bailed before saving the next). */
export async function getSlot(): Promise<CustomSongSlot | null> {
  try {
    const result = await txn<CustomSongSlot | undefined>('readonly', (s) => s.get(SLOT_KEY));
    return result ?? null;
  } catch {
    return null;
  }
}

/** Overwrite the slot with a fresh upload. Idempotent — no migration
 *  concerns since there's only ever one row. */
export async function saveSlot(slot: CustomSongSlot): Promise<void> {
  await txn('readwrite', (s) => s.put(slot, SLOT_KEY));
}

/** Wipe the slot. Called from the REPLACE flow before the new file
 *  picker opens, so a cancelled REPLACE doesn't leave the old song. */
export async function clearSlot(): Promise<void> {
  await txn('readwrite', (s) => s.delete(SLOT_KEY));
}
