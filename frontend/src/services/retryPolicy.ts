/**
 * Transcription retry policy.
 *
 * Pure helpers (no side effects) so they can be unit-tested directly and reused
 * by the auto-retry scans in App.tsx.
 */

import type { MeetingNote } from "../types";

/** Stop auto-retrying after this many attempts (manual retry still allowed). */
export const MAX_AUTO_RETRIES = 5;

const RETRY_BASE_DELAY_MS = 30_000; // 30s
const RETRY_MAX_DELAY_MS = 10 * 60 * 1000; // 10 min

/**
 * A recording stuck in "processing" for longer than this (e.g. the tab was
 * closed mid-job, or a device died) is considered dead and eligible for retry.
 * Set well above the server's transcription timeout so genuinely long jobs are
 * never interrupted.
 */
const STUCK_PROCESSING_MS = 30 * 60 * 1000; // 30 min

/** Exponential backoff: 30s, 60s, 120s, … capped at 10 min. */
export const computeRetryDelayMs = (retryCount: number): number => {
  const exp = Math.max(0, retryCount - 1);
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * Math.pow(2, exp));
};

/** Transcription lifecycle status, falling back sensibly for legacy docs. */
export const effectiveStatus = (
  m: Pick<MeetingNote, "status" | "transcript">
): "pending" | "processing" | "completed" | "failed" => {
  if (m.status) return m.status;
  return (m.transcript?.length || 0) > 0 ? "completed" : "pending";
};

/** Whether a recording is eligible for an automatic retry right now. */
export const isRetryableNow = (
  m: Pick<MeetingNote, "status" | "transcript" | "retryCount" | "lastAttemptAt">,
  now: number = Date.now()
): boolean => {
  const status = effectiveStatus(m);
  const count = m.retryCount || 0;
  if (count >= MAX_AUTO_RETRIES) return false;

  const last = m.lastAttemptAt || 0;

  // Recover a recording wedged in "processing" (tab closed / device died).
  if (status === "processing") {
    return last > 0 && now - last > STUCK_PROCESSING_MS;
  }

  if (status !== "pending" && status !== "failed") return false;
  if (!last) return true;
  return now - last >= computeRetryDelayMs(count);
};
