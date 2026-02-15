/**
 * ScribeAI Neural Storage Service
 *
 * Handles high-capacity local persistence using IndexedDB. This module
 * remains in the frontend so that raw audio never leaves the user’s
 * device unless explicitly uploaded for transcription. The API
 * exposed here mirrors the original implementation but is tucked
 * beneath the new src/ hierarchy.
 */

const DB_NAME = 'ScribeAINeuralCache';
const STORE_NAME = 'audio_blobs';
const CHUNKS_STORE_NAME = 'audio_chunks_temp'; // New store for incremental saves
const DB_VERSION = 2; // Bump version for new store

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      // Create new store for temporary chunks (Auto-Save)
      if (!db.objectStoreNames.contains(CHUNKS_STORE_NAME)) {
        db.createObjectStore(CHUNKS_STORE_NAME); // Key will be session ID
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

/**
 * AUTO-SAVE METHODS
 */

// Append a chunk to the temporary store
export const appendAudioChunk = async (sessionId: string, chunk: Blob): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CHUNKS_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(CHUNKS_STORE_NAME);
    
    // Get existing chunks first
    const getReq = store.get(sessionId);
    
    getReq.onsuccess = () => {
      const existing: Blob[] = getReq.result || [];
      existing.push(chunk);
      
      const putReq = store.put(existing, sessionId);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    
    getReq.onerror = () => reject(getReq.error);
  });
};

// Retrieve all chunks for a session (Crash Recovery)
export const getAudioChunks = async (sessionId: string): Promise<Blob[] | null> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CHUNKS_STORE_NAME, 'readonly');
    const store = transaction.objectStore(CHUNKS_STORE_NAME);
    const request = store.get(sessionId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

// Clear temporary chunks after successful save
export const clearAudioChunks = async (sessionId: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CHUNKS_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(CHUNKS_STORE_NAME);
    const request = store.delete(sessionId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// Check if there are any stranded sessions
export const listUnfinishedSessions = async (): Promise<string[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CHUNKS_STORE_NAME, 'readonly');
    const store = transaction.objectStore(CHUNKS_STORE_NAME);
    const request = store.getAllKeys();
    request.onsuccess = () => resolve((request.result as string[]) || []);
    request.onerror = () => reject(request.error);
  });
};
