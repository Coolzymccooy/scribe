import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

/**
 * Audio Normalizer
 *
 * Browser MediaRecorder output (especially when a recording is interrupted or
 * not cleanly stopped) can produce WebM/Opus files with no duration metadata
 * and corrupt packet headers. Gemini then decodes only a fragment — or nothing —
 * and returns a degenerate/placeholder transcript that does not match the audio.
 *
 * This module re-encodes any incoming audio into a clean, speech-optimised file
 * (16 kHz mono AAC/m4a) with `-err_detect ignore_err` so corrupt packets are
 * skipped rather than aborting the decode. The clean file has proper duration
 * metadata, is much smaller (so more recordings fit Gemini's inline path), and
 * transcribes reliably.
 *
 * Requires the `ffmpeg` binary on PATH (installed in the Docker image).
 */

const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';
// Generous ceiling so a ~90 min recording can finish re-encoding.
const NORMALIZE_TIMEOUT_MS = Number(process.env.AUDIO_NORMALIZE_TIMEOUT_MS || 5 * 60 * 1000);

const runFfmpeg = (args) =>
  new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`ffmpeg timed out after ${NORMALIZE_TIMEOUT_MS}ms`));
    }, NORMALIZE_TIMEOUT_MS);

    proc.stderr.on('data', (chunk) => {
      // Keep only the tail; ffmpeg can be very chatty.
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr}`));
    });
  });

/**
 * Re-encode the audio at `inputPath` into a clean 16 kHz mono m4a.
 *
 * Returns `{ path, mimeType, cleanup }`. On any failure it falls back to the
 * original file untouched (so well-formed recordings keep working even if
 * ffmpeg is unavailable), with a no-op cleanup.
 *
 * @param {string} inputPath  Path to the source audio (e.g. multer temp file).
 * @param {string} mimeType   Original mime type, used for the fallback.
 * @returns {Promise<{ path: string, mimeType: string, cleanup: () => Promise<void> }>}
 */
export async function normalizeAudio(inputPath, mimeType) {
  const outPath = path.join(os.tmpdir(), `norm_${crypto.randomUUID()}.m4a`);
  const noop = async () => {};
  const cleanupOut = async () => {
    await fs.unlink(outPath).catch(() => {});
  };

  try {
    await runFfmpeg([
      '-v', 'error',
      '-err_detect', 'ignore_err',
      '-i', inputPath,
      '-vn', // drop any video stream (e.g. uploaded screen recordings)
      '-ac', '1', // mono
      '-ar', '16000', // 16 kHz is ample for speech and shrinks the file
      '-c:a', 'aac',
      '-b:a', '64k',
      '-y',
      outPath,
    ]);

    const stat = await fs.stat(outPath);
    if (stat.size < 1024) {
      // Effectively empty — treat as a failure and fall back.
      throw new Error('normalized output too small');
    }

    return { path: outPath, mimeType: 'audio/mp4', cleanup: cleanupOut };
  } catch (err) {
    await cleanupOut();
    console.warn('Audio normalization failed, using original file:', err?.message || err);
    return { path: inputPath, mimeType, cleanup: noop };
  }
}
