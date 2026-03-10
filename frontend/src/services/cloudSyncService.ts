/**
 * Cloud Sync Service
 *
 * Provides Firestore (meeting metadata) and Firebase Storage (audio blobs)
 * integration so that recordings survive browser data clearing and are
 * accessible across devices. All operations are scoped to the authenticated
 * user's UID.
 *
 * Firestore structure:
 *   users/{uid}/meetings/{meetingId}  — MeetingNote metadata (no audio blob)
 *
 * Storage structure:
 *   users/{uid}/audio/{audioStorageKey}.webm  — raw audio
 */

import { getApps } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  writeBatch,
  query,
  orderBy,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import {
  getStorage,
  ref,
  uploadBytes,
  getBlob,
  deleteObject,
  type FirebaseStorage,
} from "firebase/storage";
import type { MeetingNote } from "../types";

// ---------------------------------------------------------------------------
// Singleton accessors — reuse the same app instance initialised in firebase.ts
// ---------------------------------------------------------------------------

let _db: Firestore | null = null;
let _storage: FirebaseStorage | null = null;

const getDb = (): Firestore => {
  if (_db) return _db;
  const app = getApps()[0];
  if (!app) throw new Error("Firebase app not initialised");
  _db = getFirestore(app);
  return _db;
};

const getStorageBucket = (): FirebaseStorage => {
  if (_storage) return _storage;
  const app = getApps()[0];
  if (!app) throw new Error("Firebase app not initialised");
  _storage = getStorage(app);
  return _storage;
};

// ---------------------------------------------------------------------------
// Firestore helpers — meeting metadata
// ---------------------------------------------------------------------------

const meetingsCol = (uid: string) =>
  collection(getDb(), "users", uid, "meetings");

const meetingDoc = (uid: string, meetingId: string) =>
  doc(getDb(), "users", uid, "meetings", meetingId);

/** Strip fields that Firestore cannot serialise (undefined, functions, etc.) */
const sanitiseMeetingForFirestore = (m: MeetingNote): Record<string, unknown> => {
  const plain: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(m)) {
    if (value !== undefined && typeof value !== "function") {
      plain[key] = value;
    }
  }
  plain._updatedAt = serverTimestamp();
  return plain;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Upload a single meeting's metadata to Firestore. */
export const saveMeetingToCloud = async (
  uid: string,
  meeting: MeetingNote
): Promise<void> => {
  await setDoc(
    meetingDoc(uid, meeting.id),
    sanitiseMeetingForFirestore(meeting),
    { merge: true }
  );
};

/** Upload audio blob to Firebase Storage. */
export const saveAudioToCloud = async (
  uid: string,
  audioStorageKey: string,
  blob: Blob
): Promise<void> => {
  const storageRef = ref(
    getStorageBucket(),
    `users/${uid}/audio/${audioStorageKey}.webm`
  );
  await uploadBytes(storageRef, blob);
};

/** Download audio blob from Firebase Storage. */
export const getAudioFromCloud = async (
  uid: string,
  audioStorageKey: string
): Promise<Blob | null> => {
  try {
    const storageRef = ref(
      getStorageBucket(),
      `users/${uid}/audio/${audioStorageKey}.webm`
    );
    return await getBlob(storageRef);
  } catch {
    return null;
  }
};

/** Fetch all meetings for a user from Firestore. */
export const fetchMeetingsFromCloud = async (
  uid: string
): Promise<MeetingNote[]> => {
  const q = query(meetingsCol(uid), orderBy("date", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => {
    const data = d.data();
    // Strip Firestore-only fields
    delete data._updatedAt;
    return { ...data, id: d.id } as MeetingNote;
  });
};

/** Delete a meeting and its audio from the cloud. */
export const deleteMeetingFromCloud = async (
  uid: string,
  meetingId: string,
  audioStorageKey?: string
): Promise<void> => {
  await deleteDoc(meetingDoc(uid, meetingId));
  if (audioStorageKey) {
    const storageRef = ref(
      getStorageBucket(),
      `users/${uid}/audio/${audioStorageKey}.webm`
    );
    await deleteObject(storageRef).catch(() => {
      // audio may not have been uploaded yet
    });
  }
};

/**
 * Full sync: push a batch of meetings to Firestore.
 * Used on first cloud enable or periodic background sync.
 */
export const batchSaveMeetingsToCloud = async (
  uid: string,
  meetings: MeetingNote[]
): Promise<void> => {
  const db = getDb();
  // Firestore batches are limited to 500 writes
  const BATCH_SIZE = 400;
  for (let i = 0; i < meetings.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = meetings.slice(i, i + BATCH_SIZE);
    for (const m of chunk) {
      batch.set(meetingDoc(uid, m.id), sanitiseMeetingForFirestore(m), {
        merge: true,
      });
    }
    await batch.commit();
  }
};

/**
 * Merge cloud meetings with local meetings.
 * Cloud wins for metadata; local wins if the local copy is newer
 * (based on which has the longer transcript — heuristic for "more complete").
 */
export const mergeMeetings = (
  local: MeetingNote[],
  cloud: MeetingNote[]
): MeetingNote[] => {
  const merged = new Map<string, MeetingNote>();

  // Seed with local
  for (const m of local) {
    merged.set(m.id, m);
  }

  // Overlay cloud — cloud wins unless local has more transcript data
  for (const cm of cloud) {
    const existing = merged.get(cm.id);
    if (!existing) {
      // New from cloud — mark as cloud
      merged.set(cm.id, { ...cm, syncStatus: "cloud" });
    } else {
      const localHasMoreData =
        (existing.transcript?.length || 0) > (cm.transcript?.length || 0);
      if (localHasMoreData) {
        // Keep local but mark synced
        merged.set(cm.id, { ...existing, syncStatus: "cloud" });
      } else {
        // Cloud version is equal or better
        merged.set(cm.id, { ...cm, syncStatus: "cloud" });
      }
    }
  }

  return Array.from(merged.values());
};
