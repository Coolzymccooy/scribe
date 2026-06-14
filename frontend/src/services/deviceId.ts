/**
 * Stable per-device identifier.
 *
 * Minted once and persisted in localStorage. Used to "claim" a recording for
 * transcription so that two browsers signed into the same account don't both
 * transcribe the same audio at the same time.
 */

const DEVICE_ID_KEY = "scribe_device_id_v1";

const randomId = (): string => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to manual generation
  }
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

export const getDeviceId = (): string => {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const fresh = randomId();
    localStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    // localStorage unavailable (e.g. privacy mode) — fall back to an ephemeral id
    return randomId();
  }
};
