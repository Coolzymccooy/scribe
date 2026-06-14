import { describe, it, expect } from "vitest";
import {
  computeRetryDelayMs,
  effectiveStatus,
  isRetryableNow,
  MAX_AUTO_RETRIES,
} from "../retryPolicy";
import type { MeetingNote } from "../../types";

const base = (over: Partial<MeetingNote>): MeetingNote =>
  ({
    id: "m1",
    title: "t",
    date: new Date(0).toISOString(),
    duration: 1,
    type: "Other" as any,
    transcript: [],
    tags: [],
    accentPreference: "standard",
    ...over,
  }) as MeetingNote;

describe("computeRetryDelayMs", () => {
  it("backs off exponentially and caps at 10 min", () => {
    expect(computeRetryDelayMs(1)).toBe(30_000);
    expect(computeRetryDelayMs(2)).toBe(60_000);
    expect(computeRetryDelayMs(3)).toBe(120_000);
    expect(computeRetryDelayMs(50)).toBe(10 * 60 * 1000);
  });
});

describe("effectiveStatus", () => {
  it("uses explicit status when present", () => {
    expect(effectiveStatus(base({ status: "failed" }))).toBe("failed");
  });
  it("falls back to completed when a legacy doc has a transcript", () => {
    expect(
      effectiveStatus(base({ transcript: [{ id: "s", startTime: 0, endTime: 1, speaker: "x", text: "hi" }] }))
    ).toBe("completed");
  });
  it("falls back to pending when no status and no transcript", () => {
    expect(effectiveStatus(base({}))).toBe("pending");
  });
});

describe("isRetryableNow", () => {
  const now = 1_000_000_000;

  it("retries a fresh pending recording immediately", () => {
    expect(isRetryableNow(base({ status: "pending", retryCount: 0, lastAttemptAt: null }), now)).toBe(true);
  });

  it("honours backoff for failed recordings", () => {
    const m = base({ status: "failed", retryCount: 1, lastAttemptAt: now - 10_000 });
    expect(isRetryableNow(m, now)).toBe(false); // 10s < 30s backoff
    expect(isRetryableNow({ ...m, lastAttemptAt: now - 31_000 }, now)).toBe(true);
  });

  it("stops auto-retrying after the cap", () => {
    expect(
      isRetryableNow(base({ status: "failed", retryCount: MAX_AUTO_RETRIES, lastAttemptAt: 0 }), now)
    ).toBe(false);
  });

  it("never retries completed recordings", () => {
    expect(isRetryableNow(base({ status: "completed", retryCount: 0 }), now)).toBe(false);
  });

  it("recovers a recording wedged in processing past the stuck threshold", () => {
    const stuck = base({ status: "processing", retryCount: 1, lastAttemptAt: now - 31 * 60 * 1000 });
    expect(isRetryableNow(stuck, now)).toBe(true);
    const recent = base({ status: "processing", retryCount: 1, lastAttemptAt: now - 60_000 });
    expect(isRetryableNow(recent, now)).toBe(false);
  });
});
