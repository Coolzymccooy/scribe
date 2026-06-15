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
  runTransaction,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getBlob,
  deleteObject,
  type FirebaseStorage,
} from "firebase/storage";
import type { MeetingNote, TranscriptSegment } from "../types";

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

/**
 * Fields that must never be written into the Firestore meeting document.
 * `transcript` can run to many KB/MB for long recordings and would blow
 * Firestore's 1 MiB document limit — it lives in Firebase Storage instead
 * (see saveTranscriptToCloud). The doc only keeps the `transcriptStored` flag.
 */
const FIRESTORE_OMIT_KEYS = new Set(["transcript"]);

/** Strip fields that Firestore cannot serialise (undefined, functions, etc.) */
const sanitiseMeetingForFirestore = (m: MeetingNote): Record<string, unknown> => {
  const plain: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(m)) {
    if (FIRESTORE_OMIT_KEYS.has(key)) continue;
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

/**
 * Upload audio blob to Firebase Storage.
 *
 * Uses a resumable upload so large recordings (5–10 min) survive transient
 * network blips instead of failing the whole request.
 */
export const saveAudioToCloud = async (
  uid: string,
  audioStorageKey: string,
  blob: Blob
): Promise<void> => {
  const storageRef = ref(
    getStorageBucket(),
    `users/${uid}/audio/${audioStorageKey}.webm`
  );
  const task = uploadBytesResumable(storageRef, blob, {
    contentType: blob.type || "audio/webm",
  });
  await new Promise<void>((resolve, reject) => {
    task.on(
      "state_changed",
      undefined,
      (err) => reject(err),
      () => resolve()
    );
  });
};

// ---------------------------------------------------------------------------
// Firebase Storage — transcript JSON (kept out of the Firestore doc so long
// recordings never hit the 1 MiB document limit). Mirrors the audio path.
//   users/{uid}/transcripts/{meetingId}.json
// ---------------------------------------------------------------------------

const transcriptRef = (uid: string, meetingId: string) =>
  ref(getStorageBucket(), `users/${uid}/transcripts/${meetingId}.json`);

/**
 * Upload a meeting's transcript to Firebase Storage as JSON.
 *
 * Uses a resumable upload (like audio) so a long transcript survives the
 * transient network blips that are common on mobile — the exact condition
 * that can otherwise leave the cloud copy missing.
 */
export const saveTranscriptToCloud = async (
  uid: string,
  meetingId: string,
  transcript: TranscriptSegment[]
): Promise<void> => {
  const blob = new Blob([JSON.stringify(transcript)], { type: "application/json" });
  const task = uploadBytesResumable(transcriptRef(uid, meetingId), blob, {
    contentType: "application/json",
  });
  await new Promise<void>((resolve, reject) => {
    task.on("state_changed", undefined, (err) => reject(err), () => resolve());
  });
};

/** Download a meeting's transcript from Firebase Storage. Returns null if absent. */
export const getTranscriptFromCloud = async (
  uid: string,
  meetingId: string
): Promise<TranscriptSegment[] | null> => {
  try {
    const blob = await getBlob(transcriptRef(uid, meetingId));
    const text = await blob.text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as TranscriptSegment[]) : null;
  } catch {
    return null;
  }
};

/** Delete a meeting's transcript from Firebase Storage. */
const deleteTranscriptFromCloud = async (
  uid: string,
  meetingId: string
): Promise<void> => {
  await deleteObject(transcriptRef(uid, meetingId)).catch(() => {
    // transcript may never have been uploaded — non-fatal
  });
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
    // Transcripts live in Storage; the doc never carries one. Keep the type's
    // invariant (always an array) so callers can hydrate lazily.
    if (!Array.isArray(data.transcript)) data.transcript = [];
    return { ...data, id: d.id } as MeetingNote;
  });
};

/** Delete a meeting and its audio + transcript from the cloud. */
export const deleteMeetingFromCloud = async (
  uid: string,
  meetingId: string,
  audioStorageKey?: string
): Promise<void> => {
  await deleteDoc(meetingDoc(uid, meetingId));
  await deleteTranscriptFromCloud(uid, meetingId);
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

/** A recording's effective "last touched" time, for last-write-wins reconciliation. */
const reconcileTimestamp = (m: MeetingNote): number => {
  // Every mutation (including delete) stamps `updatedAt`, so it is authoritative.
  if (typeof m.updatedAt === "number" && m.updatedAt > 0) {
    return Math.max(m.updatedAt, typeof m.deletedAt === "number" ? m.deletedAt : 0);
  }
  // Legacy docs without `updatedAt`: fall back to the recording date so ordering is sane.
  const dateMs = m.date ? Date.parse(m.date) : 0;
  return Number.isFinite(dateMs) ? dateMs : 0;
};

/**
 * Merge cloud + local recordings using last-write-wins on `updatedAt`,
 * honouring `deletedAt` tombstones so deletions propagate across devices.
 *
 * Pure function — no Firestore access — so it can be unit tested directly.
 */
export const mergeMeetings = (
  local: MeetingNote[],
  cloud: MeetingNote[]
): MeetingNote[] => {
  const byId = new Map<string, MeetingNote>();

  const hasTranscript = (m: MeetingNote): boolean =>
    Array.isArray(m.transcript) && m.transcript.length > 0;

  const consider = (incoming: MeetingNote) => {
    const existing = byId.get(incoming.id);
    if (!existing) {
      byId.set(incoming.id, incoming);
      return;
    }
    // Whichever copy was touched most recently wins on metadata.
    const winner =
      reconcileTimestamp(incoming) >= reconcileTimestamp(existing) ? incoming : existing;
    const loser = winner === incoming ? existing : incoming;

    // Transcripts live in Storage/IndexedDB, not the Firestore doc, so a cloud
    // (or metadata-only) copy arrives with an empty `transcript`. If the winner
    // lacks one but the loser still holds a hydrated transcript, carry it
    // forward — but never onto a tombstoned recording.
    const merged =
      !winner.deletedAt && !hasTranscript(winner) && hasTranscript(loser)
        ? { ...winner, transcript: loser.transcript }
        : winner;
    byId.set(incoming.id, merged);
  };

  for (const m of local) consider(m);
  for (const m of cloud) consider(m);

  // Drop tombstoned recordings from the visible set.
  return Array.from(byId.values()).filter((m) => !m.deletedAt);
};

// ---------------------------------------------------------------------------
// Partial updates — patch a single recording without rewriting the whole doc
// ---------------------------------------------------------------------------

/** Merge a partial patch into a cloud recording, stamping `updatedAt`. */
export const patchMeetingInCloud = async (
  uid: string,
  meetingId: string,
  patch: Partial<MeetingNote>
): Promise<void> => {
  const plain: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (FIRESTORE_OMIT_KEYS.has(key)) continue; // transcript lives in Storage
    if (value !== undefined && typeof value !== "function") {
      plain[key] = value;
    }
  }
  plain.updatedAt = Date.now();
  plain._updatedAt = serverTimestamp();
  await setDoc(meetingDoc(uid, meetingId), plain, { merge: true });
};

/** Soft-delete (tombstone) a recording so the deletion syncs to other devices. */
export const softDeleteMeetingInCloud = async (
  uid: string,
  meetingId: string,
  audioStorageKey?: string
): Promise<void> => {
  await patchMeetingInCloud(uid, meetingId, {
    deletedAt: Date.now(),
    status: "completed",
    claim: null,
  });
  await deleteTranscriptFromCloud(uid, meetingId);
  if (audioStorageKey) {
    const storageRef = ref(
      getStorageBucket(),
      `users/${uid}/audio/${audioStorageKey}.webm`
    );
    await deleteObject(storageRef).catch(() => {
      // audio may never have been uploaded — non-fatal
    });
  }
};

// ---------------------------------------------------------------------------
// Live cross-device subscription
// ---------------------------------------------------------------------------

/**
 * Subscribe to all of a user's recordings in real time. The callback fires
 * whenever any device adds, updates, or deletes a recording, keeping every
 * signed-in browser consistent. Returns an unsubscribe function.
 */
export const subscribeToUserMeetings = (
  uid: string,
  onChange: (meetings: MeetingNote[]) => void,
  onError?: (err: unknown) => void
): (() => void) => {
  const q = query(meetingsCol(uid), orderBy("date", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        delete data._updatedAt;
        if (!Array.isArray(data.transcript)) data.transcript = [];
        return { ...(data as object), id: d.id } as MeetingNote;
      });
      onChange(list);
    },
    (err) => onError?.(err)
  );
};

// ---------------------------------------------------------------------------
// Cross-device processing claim (lock)
// ---------------------------------------------------------------------------

/** How long a claim is honoured before another device may steal it. */
export const CLAIM_TTL_MS = 3 * 60 * 1000;

const claimIsFresh = (
  claim: { deviceId?: string; claimedAt?: number } | null | undefined,
  now: number
): boolean =>
  Boolean(claim && typeof claim.claimedAt === "number" && now - claim.claimedAt < CLAIM_TTL_MS);

/**
 * Try to claim a recording for transcription. Returns true if this device now
 * owns the claim. A transaction guarantees only one device wins, even across
 * browsers. A stale claim (older than CLAIM_TTL_MS) can be stolen.
 */
export const claimRecording = async (
  uid: string,
  meetingId: string,
  deviceId: string,
  now: number = Date.now()
): Promise<boolean> => {
  const refDoc = meetingDoc(uid, meetingId);
  try {
    return await runTransaction(getDb(), async (tx) => {
      const snap = await tx.get(refDoc);
      const data = snap.exists() ? (snap.data() as MeetingNote) : null;
      const current = data?.claim ?? null;
      if (current && current.deviceId !== deviceId && claimIsFresh(current, now)) {
        return false; // someone else holds a fresh claim
      }
      tx.set(
        refDoc,
        { claim: { deviceId, claimedAt: now }, updatedAt: now, _updatedAt: serverTimestamp() },
        { merge: true }
      );
      return true;
    });
  } catch {
    return false;
  }
};

/** Refresh an owned claim's heartbeat so long jobs don't expire their own lock. */
export const refreshClaim = async (
  uid: string,
  meetingId: string,
  deviceId: string
): Promise<void> => {
  await patchMeetingInCloud(uid, meetingId, { claim: { deviceId, claimedAt: Date.now() } });
};

/** Release a claim once processing finishes (success or failure). */
export const releaseClaim = async (uid: string, meetingId: string): Promise<void> => {
  await patchMeetingInCloud(uid, meetingId, { claim: null });
};
