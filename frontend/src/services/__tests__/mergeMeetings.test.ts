import { describe, it, expect } from "vitest";
import { mergeMeetings } from "../cloudSyncService";
import type { MeetingNote } from "../../types";

const m = (over: Partial<MeetingNote>): MeetingNote =>
  ({
    id: "m1",
    title: "t",
    date: new Date(1_000).toISOString(),
    duration: 1,
    type: "Other" as any,
    transcript: [],
    tags: [],
    accentPreference: "standard",
    ...over,
  }) as MeetingNote;

describe("mergeMeetings (last-write-wins + tombstones)", () => {
  it("keeps the copy with the greater updatedAt", () => {
    const local = [m({ id: "a", title: "old", updatedAt: 100 })];
    const cloud = [m({ id: "a", title: "new", updatedAt: 200 })];
    const merged = mergeMeetings(local, cloud);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("new");
  });

  it("keeps local when local is newer than cloud", () => {
    const local = [m({ id: "a", title: "local-new", updatedAt: 300 })];
    const cloud = [m({ id: "a", title: "cloud-old", updatedAt: 200 })];
    expect(mergeMeetings(local, cloud)[0].title).toBe("local-new");
  });

  it("unions recordings that exist on only one side", () => {
    const local = [m({ id: "a", updatedAt: 1 })];
    const cloud = [m({ id: "b", updatedAt: 1 })];
    const ids = mergeMeetings(local, cloud)
      .map((x) => x.id)
      .sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("drops a tombstoned recording even if the other side still has it", () => {
    const local = [m({ id: "a", title: "alive", updatedAt: 100 })];
    const cloud = [m({ id: "a", title: "gone", updatedAt: 200, deletedAt: 200 })];
    expect(mergeMeetings(local, cloud)).toHaveLength(0);
  });

  it("does not resurrect a locally-deleted recording from stale cloud data", () => {
    const local = [m({ id: "a", updatedAt: 500, deletedAt: 500 })];
    const cloud = [m({ id: "a", title: "stale", updatedAt: 200 })];
    expect(mergeMeetings(local, cloud)).toHaveLength(0);
  });

  // Transcripts now live in Storage/IndexedDB, not the Firestore doc, so the
  // cloud copy arrives with an empty `transcript`. A newer metadata-only cloud
  // snapshot (e.g. a claim heartbeat) must NOT wipe an already-hydrated
  // in-memory transcript — we carry the populated one forward.
  const seg = { id: "s1", speaker: "A", text: "hello", startTime: 0 } as any;

  it("preserves a hydrated transcript when the newer winner has none", () => {
    const local = [m({ id: "a", title: "old", updatedAt: 100, transcript: [seg] })];
    const cloud = [m({ id: "a", title: "new", updatedAt: 200, transcript: [], transcriptStored: true })];
    const merged = mergeMeetings(local, cloud);
    expect(merged[0].title).toBe("new"); // metadata still last-write-wins
    expect(merged[0].transcript).toHaveLength(1); // transcript not lost
    expect(merged[0].transcript[0].text).toBe("hello");
  });

  it("prefers the winner's own transcript when it has one", () => {
    const local = [m({ id: "a", updatedAt: 100, transcript: [seg] })];
    const cloud = [
      m({ id: "a", updatedAt: 200, transcript: [{ ...seg, text: "updated" }] }),
    ];
    expect(mergeMeetings(local, cloud)[0].transcript[0].text).toBe("updated");
  });

  it("does not carry a transcript onto a tombstoned recording", () => {
    const local = [m({ id: "a", updatedAt: 100, transcript: [seg] })];
    const cloud = [m({ id: "a", updatedAt: 200, deletedAt: 200, transcript: [] })];
    expect(mergeMeetings(local, cloud)).toHaveLength(0);
  });
});
