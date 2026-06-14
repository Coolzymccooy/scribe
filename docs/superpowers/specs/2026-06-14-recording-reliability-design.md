# ScribeAI — Recording Reliability & Cross-Device Sync (Design)

**Date:** 2026-06-14
**Status:** ✅ Implemented (branch `feat/recording-reliability-cross-device`, commit `2300b56`)
**Workstream:** 1 of 2 (reliability first, redesign second)

## Problem

1. Long recordings (5–10 min) often failed transcription and the job was **lost** — audio existed only in one browser's IndexedDB.
2. No guardrail for failed transcriptions across devices: a failure on device A was invisible/unrecoverable on device B.
3. Same account in different browsers showed **inconsistent** data.

## Root causes (in code, before the fix)

- Audio was uploaded to the cloud **only after a successful transcription** (`createMeetingFromProcessingResult`); a failure left audio local-only.
- Server kept jobs in memory + `state.json` and stored the upload in `os.tmpdir()`, **deleting it in `finally`**. On restart, `sanitizeSavedJobs` force-failed every in-flight job and nulled the audio path → guaranteed loss on a redeploy/sleep mid-job.
- Cloud sync **excluded** `failed`/`offline` recordings (`transcript.length > 0 && syncStatus !== 'failed' && !== 'offline'`).
- `mergeMeetings` reconciled by transcript length ("cloud wins"), with no `updatedAt`/version field and no delete tombstones.

## Solution — cloud as durable source of truth (Approach A)

**Data model** (`MeetingNote`): split transcription lifecycle from sync state.
- `status: 'pending' | 'processing' | 'completed' | 'failed'`
- `audioUploaded`, `jobId`, `retryCount`, `lastError`, `lastAttemptAt`
- `claim: { deviceId, claimedAt } | null` (cross-device lock, 3-min TTL)
- `updatedAt` (LWW), `deletedAt` (tombstone)

**Recording stop is cloud-first** (`createPendingRecording`): blob → IndexedDB, then a Firestore doc (`status: 'pending'`) + resumable Storage upload, **before** transcription. A recording can never exist in only one browser.

**Transcription worker** (`processRecording`): claim (Firestore transaction + 60 s heartbeat) → submit to server → poll → patch `status`/`transcript`/`lastError` in local state + cloud. A same-device in-flight guard plus the cross-device claim prevent duplicate work.

**Auto-retry** (`retryPolicy.ts`): scans on app-open, on reconnect, and every 60 s; exponential backoff (30 s → 10 min), cap 5 attempts, manual Retry resets. Recovers recordings stuck in `processing` after 30 min.

**Cross-device consistency**: live `onSnapshot` subscription; `mergeMeetings` is now last-write-wins on `updatedAt` + tombstone-aware.

**Server hardening**: uploads land on the persistent `/data/uploads` volume; in-flight audio path persisted; on restart, recoverable jobs are **re-enqueued** instead of failed.

## Tests
- `mergeMeetings` (LWW + tombstones) — 5 cases.
- `retryPolicy` (backoff, cap, stuck-processing recovery, status fallback) — 9 cases.
- 14 passing; `tsc --noEmit` clean; `vite build` green.

## Known trade-offs / follow-ups
- Every recording's audio now lives in Firebase Storage (more usage). A retention/cleanup policy (e.g. delete cloud audio N days after `completed`) is deferred.
- No delete UI exists yet; `softDeleteMeetingInCloud` (tombstone) is wired in the service for when one is added.
- `App.tsx` is ~5,000 lines — see the redesign spec for decomposition.
