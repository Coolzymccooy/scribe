/**
 * ScribeAI Neural Storage Service
 *
 * Handles high-capacity local persistence using IndexedDB. This module
 * remains in the frontend so that raw audio never leaves the user's
 * device unless explicitly uploaded for transcription.
 */

const DB_NAME = 'ScribeAINeuralCache';
const STORE_NAME = 'audio_blobs';
const LEGACY_CHUNKS_STORE_NAME = 'audio_chunks_temp';
const CHUNKS_STORE_NAME = 'audio_chunks_temp_v2';
const DB_VERSION = 3;

type ChunkRecord = {
  id?: number;
  sessionId: string;
  createdAt: number;
  chunk: Blob;
};

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }

      if (!db.objectStoreNames.contains(CHUNKS_STORE_NAME)) {
        const chunkStore = db.createObjectStore(CHUNKS_STORE_NAME, { keyPath: 'id', autoIncrement: true });
        chunkStore.createIndex('sessionId', 'sessionId', { unique: false });
      }

      // One-time migration from legacy { sessionId -> Blob[] } format.
      if (event.oldVersion < 3 && tx && db.objectStoreNames.contains(LEGACY_CHUNKS_STORE_NAME)) {
        const legacyStore = tx.objectStore(LEGACY_CHUNKS_STORE_NAME);
        const targetStore = tx.objectStore(CHUNKS_STORE_NAME);
        const cursorReq = legacyStore.openCursor();

        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;

          const sessionId = String(cursor.key || '');
          const chunks = Array.isArray(cursor.value) ? (cursor.value as Blob[]) : [];
          chunks.forEach((chunk, idx) => {
            targetStore.add({
              sessionId,
              createdAt: Date.now() + idx,
              chunk,
            } satisfies ChunkRecord);
          });

          cursor.continue();
        };
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveAudioBlob = async (key: string, blob: Blob): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(blob, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getAudioBlob = async (key: string): Promise<Blob | null> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

export const deleteAudioBlob = async (key: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const getLegacySessionChunks = async (db: IDBDatabase, sessionId: string): Promise<Blob[] | null> => {
  if (!db.objectStoreNames.contains(LEGACY_CHUNKS_STORE_NAME)) return null;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEGACY_CHUNKS_STORE_NAME, 'readonly');
    const store = tx.objectStore(LEGACY_CHUNKS_STORE_NAME);
    const req = store.get(sessionId);
    req.onsuccess = () => {
      const value = req.result;
      resolve(Array.isArray(value) ? (value as Blob[]) : null);
    };
    req.onerror = () => reject(req.error);
  });
};

const listLegacySessions = async (db: IDBDatabase): Promise<string[]> => {
  if (!db.objectStoreNames.contains(LEGACY_CHUNKS_STORE_NAME)) return [];

  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEGACY_CHUNKS_STORE_NAME, 'readonly');
    const store = tx.objectStore(LEGACY_CHUNKS_STORE_NAME);
    const req = store.getAllKeys();
    req.onsuccess = () => resolve((req.result as string[]) || []);
    req.onerror = () => reject(req.error);
  });
};

const clearLegacySession = async (db: IDBDatabase, sessionId: string): Promise<void> => {
  if (!db.objectStoreNames.contains(LEGACY_CHUNKS_STORE_NAME)) return;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEGACY_CHUNKS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(LEGACY_CHUNKS_STORE_NAME);
    const req = store.delete(sessionId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

/**
 * AUTO-SAVE METHODS
 */

// Append a chunk without rewriting the full session payload.
export const appendAudioChunk = async (sessionId: string, chunk: Blob): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CHUNKS_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(CHUNKS_STORE_NAME);
    const request = store.add({
      sessionId,
      createdAt: Date.now(),
      chunk,
    } satisfies ChunkRecord);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// Retrieve all chunks for a session (Crash Recovery)
export const getAudioChunks = async (sessionId: string): Promise<Blob[] | null> => {
  const db = await initDB();
  const chunks = await new Promise<Blob[]>((resolve, reject) => {
    const transaction = db.transaction(CHUNKS_STORE_NAME, 'readonly');
    const store = transaction.objectStore(CHUNKS_STORE_NAME);
    const index = store.index('sessionId');
    const request = index.openCursor(IDBKeyRange.only(sessionId));
    const collected: Blob[] = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(collected);
        return;
      }

      const record = cursor.value as ChunkRecord;
      if (record?.chunk) {
        collected.push(record.chunk);
      }
      cursor.continue();
    };

    request.onerror = () => reject(request.error);
  });

  if (chunks.length > 0) {
    return chunks;
  }

  return getLegacySessionChunks(db, sessionId);
};

// Clear temporary chunks after successful save
export const clearAudioChunks = async (sessionId: string): Promise<void> => {
  const db = await initDB();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(CHUNKS_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(CHUNKS_STORE_NAME);
    const index = store.index('sessionId');
    const request = index.openCursor(IDBKeyRange.only(sessionId));

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }

      const deleteReq = cursor.delete();
      deleteReq.onsuccess = () => cursor.continue();
      deleteReq.onerror = () => reject(deleteReq.error);
    };

    request.onerror = () => reject(request.error);
  });

  await clearLegacySession(db, sessionId);
};

// Check if there are any stranded sessions
export const listUnfinishedSessions = async (): Promise<string[]> => {
  const db = await initDB();

  const v2Sessions = await new Promise<string[]>((resolve, reject) => {
    const transaction = db.transaction(CHUNKS_STORE_NAME, 'readonly');
    const store = transaction.objectStore(CHUNKS_STORE_NAME);
    const index = store.index('sessionId');
    const request = index.openKeyCursor(null, 'nextunique');
    const sessions: string[] = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(sessions);
        return;
      }
      sessions.push(String(cursor.key));
      cursor.continue();
    };

    request.onerror = () => reject(request.error);
  });

  const legacySessions = await listLegacySessions(db);
  return Array.from(new Set([...v2Sessions, ...legacySessions]));
};
