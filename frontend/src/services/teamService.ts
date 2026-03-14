/**
 * teamService.ts
 * Firestore-based team workspace service.
 *
 * Firestore structure:
 *   orgs/{orgId}                    — ScribeOrg doc
 *   orgs/{orgId}/meetings/{id}      — TeamMeeting (shared recordings)
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

const orgDoc = (orgId: string) => doc(getDb(), "orgs", orgId);
const teamMeetingsCol = (orgId: string) =>
  collection(getDb(), "orgs", orgId, "meetings");
const teamMeetingDoc = (orgId: string, meetingId: string) =>
  doc(getDb(), "orgs", orgId, "meetings", meetingId);

// ── Org CRUD ────────────────────────────────────────────────────────────────

/** Generate a random 8-char invite code. */
const makeInviteCode = (): string =>
  Math.random().toString(36).slice(2, 10).toUpperCase();

/** Create a new organisation. Returns the org. */
export const createOrg = async (
  uid: string,
  email: string,
  orgName: string
): Promise<ScribeOrg> => {
  const id = `org_${uid}_${Date.now()}`;
  const org: ScribeOrg = {
    id,
    name: orgName.trim(),
    ownerId: uid,
    inviteCode: makeInviteCode(),
    createdAt: new Date().toISOString(),
    members: [
      { uid, email, role: "owner", joinedAt: new Date().toISOString() },
    ],
  };
  await setDoc(orgDoc(id), { ...org, _updatedAt: serverTimestamp() });
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

/** Find org by invite code. */
export const findOrgByInviteCode = async (
  inviteCode: string
): Promise<ScribeOrg | null> => {
  // Small orgs — linear scan. For scale, add an inviteCode index.
  // We use a server API endpoint for this instead to keep Firestore rules simple.
  try {
    const resp = await fetch(
      `${import.meta.env.VITE_API_URL ?? "http://localhost:3003"}/api/team/find-org?code=${inviteCode}`
    );
    if (!resp.ok) return null;
    return (await resp.json()) as ScribeOrg;
  } catch {
    return null;
  }
};

/** Join an org by invite code. Returns the org. */
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
  await updateDoc(orgDoc(orgId), { name: name.trim(), _updatedAt: serverTimestamp() });
};

/** Regenerate invite code. */
export const refreshInviteCode = async (orgId: string): Promise<string> => {
  const code = makeInviteCode();
  await updateDoc(orgDoc(orgId), { inviteCode: code, _updatedAt: serverTimestamp() });
  return code;
};

// ── Shared Meetings ─────────────────────────────────────────────────────────

/** Share a personal meeting to the org's shared library. */
export const shareToOrg = async (
  orgId: string,
  uid: string,
  meeting: MeetingNote
): Promise<void> => {
  const teamMeeting: TeamMeeting = {
    ...meeting,
    orgId,
    sharedBy: uid,
  };
  const plain: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(teamMeeting)) {
    if (v !== undefined && typeof v !== "function") plain[k] = v;
  }
  plain._updatedAt = serverTimestamp();
  await setDoc(teamMeetingDoc(orgId, meeting.id), plain, { merge: true });
};

/** Fetch all shared meetings for an org. */
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
