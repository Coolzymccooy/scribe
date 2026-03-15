/**
 * teamService.ts
 * Firestore-based team workspace service.
 *
 * Firestore structure:
 *   orgs/{orgId}                    — ScribeOrg doc
 *   orgs/{orgId}/meetings/{id}      — TeamMeeting (shared recordings)
 *   inviteCodes/{code}              — { orgId, name } lookup (persists across server restarts)
 */

import { getApps } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
  arrayUnion,
  onSnapshot,
  type Firestore,
} from "firebase/firestore";
import type { MeetingNote, ScribeOrg, OrgMember, TeamMeeting } from "../types";

let _db: Firestore | null = null;
const getDb = (): Firestore => {
  if (_db) return _db;
  const app = getApps()[0];
  if (!app) throw new Error("Firebase not initialised");
  _db = getFirestore(app);
  return _db;
};

// ── Doc/collection helpers ────────────────────────────────────────────────────

const orgDoc = (orgId: string) => doc(getDb(), "orgs", orgId);
const teamMeetingsCol = (orgId: string) =>
  collection(getDb(), "orgs", orgId, "meetings");
const teamMeetingDoc = (orgId: string, meetingId: string) =>
  doc(getDb(), "orgs", orgId, "meetings", meetingId);

/** Top-level invite code lookup doc — persists across all server restarts */
const inviteCodeDoc = (code: string) =>
  doc(getDb(), "inviteCodes", code.toUpperCase());

// ── Invite code helpers ───────────────────────────────────────────────────────

/** Generate a random 8-char invite code. */
const makeInviteCode = (): string =>
  Math.random().toString(36).slice(2, 10).toUpperCase();

/** Write (or overwrite) an inviteCode lookup doc in Firestore. */
const writeInviteCodeDoc = async (
  code: string,
  orgId: string,
  orgName: string
): Promise<void> => {
  await setDoc(inviteCodeDoc(code), { orgId, name: orgName });
};

/** Delete an inviteCode lookup doc (used when refreshing the code). */
const deleteInviteCodeDoc = async (code: string): Promise<void> => {
  try {
    await deleteDoc(inviteCodeDoc(code));
  } catch {
    // non-fatal — code may already be gone
  }
};

// ── Org CRUD ──────────────────────────────────────────────────────────────────

/** Create a new organisation. Returns the org. */
export const createOrg = async (
  uid: string,
  email: string,
  orgName: string
): Promise<ScribeOrg> => {
  const id = `org_${uid}_${Date.now()}`;
  const inviteCode = makeInviteCode();
  const org: ScribeOrg = {
    id,
    name: orgName.trim(),
    ownerId: uid,
    inviteCode,
    createdAt: new Date().toISOString(),
    members: [
      { uid, email, role: "owner", joinedAt: new Date().toISOString() },
    ],
  };

  // Write org doc + invite code lookup in parallel
  await Promise.all([
    setDoc(orgDoc(id), { ...org, _updatedAt: serverTimestamp() }),
    writeInviteCodeDoc(inviteCode, id, org.name),
  ]);

  return org;
};

/** Fetch org by ID. */
export const getOrg = async (orgId: string): Promise<ScribeOrg | null> => {
  const snap = await getDoc(orgDoc(orgId));
  if (!snap.exists()) return null;
  const data = snap.data();
  delete data._updatedAt;
  return data as ScribeOrg;
};

/**
 * Find org by invite code — reads directly from Firestore inviteCodes collection.
 * Works even when the backend server is offline or has been restarted.
 */
export const findOrgByInviteCode = async (
  inviteCode: string
): Promise<{ orgId: string; name: string } | null> => {
  try {
    const snap = await getDoc(inviteCodeDoc(inviteCode));
    if (!snap.exists()) return null;
    return snap.data() as { orgId: string; name: string };
  } catch {
    return null;
  }
};

/** Join an org. Appends authenticated member to org's members array. */
export const joinOrg = async (
  orgId: string,
  member: OrgMember
): Promise<void> => {
  await updateDoc(orgDoc(orgId), {
    members: arrayUnion(member),
    _updatedAt: serverTimestamp(),
  });
};

/** Update org name. */
export const updateOrgName = async (
  orgId: string,
  name: string
): Promise<void> => {
  await updateDoc(orgDoc(orgId), {
    name: name.trim(),
    _updatedAt: serverTimestamp(),
  });
};

/**
 * Regenerate invite code.
 * Deletes old code lookup doc and writes new one atomically.
 */
export const refreshInviteCode = async (orgId: string): Promise<string> => {
  const oldOrg = await getOrg(orgId);
  const newCode = makeInviteCode();
  const orgName = oldOrg?.name ?? "";

  await Promise.all([
    // Remove old code lookup
    oldOrg?.inviteCode ? deleteInviteCodeDoc(oldOrg.inviteCode) : Promise.resolve(),
    // Write new code lookup
    writeInviteCodeDoc(newCode, orgId, orgName),
    // Update org doc
    updateDoc(orgDoc(orgId), {
      inviteCode: newCode,
      _updatedAt: serverTimestamp(),
    }),
  ]);

  return newCode;
};

// ── Shared Meetings ───────────────────────────────────────────────────────────

/** Share a personal meeting to the org's shared library. */
export const shareToOrg = async (
  orgId: string,
  uid: string,
  meeting: MeetingNote
): Promise<void> => {
  const teamMeeting: TeamMeeting = { ...meeting, orgId, sharedBy: uid };
  const plain: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(teamMeeting)) {
    if (v !== undefined && typeof v !== "function") plain[k] = v;
  }
  plain._updatedAt = serverTimestamp();
  await setDoc(teamMeetingDoc(orgId, meeting.id), plain, { merge: true });
};

/** Fetch all shared meetings for an org ordered by date. */
export const fetchOrgMeetings = async (
  orgId: string
): Promise<TeamMeeting[]> => {
  const q = query(teamMeetingsCol(orgId), orderBy("date", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data();
    delete data._updatedAt;
    return { ...data, id: d.id } as TeamMeeting;
  });
};

/** Remove a shared meeting from the org library. */
export const removeFromOrg = async (
  orgId: string,
  meetingId: string
): Promise<void> => {
  await deleteDoc(teamMeetingDoc(orgId, meetingId));
};

/** Subscribe to real-time team meeting updates. Returns an unsubscribe function. */
export const subscribeToOrgMeetings = (
  orgId: string,
  callback: (meetings: TeamMeeting[]) => void
): (() => void) => {
  const q = query(teamMeetingsCol(orgId), orderBy("date", "desc"));
  return onSnapshot(q, (snap) => {
    const meetings = snap.docs.map((d) => {
      const data = d.data();
      delete data._updatedAt;
      return { ...data, id: d.id } as TeamMeeting;
    });
    callback(meetings);
  });
};
