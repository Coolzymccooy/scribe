import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { normalizeAudio } from './audioNormalizer.js';

/**
 * OpenAI Service
 *
 * Drop-in alternative to geminiService for transcription, meeting analysis and
 * the spoken audio recap. Selected per-capability via aiService.js. Uses the
 * platform REST API through Node's global fetch/FormData (no extra dependency).
 *
 * Models are configurable via env:
 *   OPENAI_TRANSCRIBE_MODEL (default whisper-1 — handles long audio up to 25 MB;
 *     gpt-4o-transcribe is stronger but caps at ~25 min, so whisper-1 is the
 *     safe default for full meetings)
 *   OPENAI_ANALYZE_MODEL    (default gpt-4o-mini)
 *   OPENAI_TTS_MODEL        (default gpt-4o-mini-tts)
 *   OPENAI_TTS_VOICE        (default alloy)
 */

const OPENAI_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
const ANALYZE_MODEL = process.env.OPENAI_ANALYZE_MODEL || 'gpt-4o-mini';
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'alloy';
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';
// Each transcription chunk stays comfortably under OpenAI's 25 MB hard limit.
const CHUNK_SECONDS = Number(process.env.OPENAI_TRANSCRIBE_CHUNK_SECONDS || 600); // 10 min
const FFMPEG_TIMEOUT_MS = Number(process.env.AUDIO_NORMALIZE_TIMEOUT_MS || 5 * 60 * 1000);

const apiKey = () => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set');
  return key;
};

const accentHint = (accent) => {
  const hints = {
    uk: 'British English speakers.',
    nigerian: 'Nigerian English / Pidgin speakers; preserve words like abi, oga, no vex.',
    ghanaian: 'Ghanaian English speakers; preserve words like chale, herh.',
    southafrican: 'South African English speakers; preserve words like eish, lekker, braai.',
    kenyan: 'Kenyan English with Swahili/Sheng; preserve words like sawa, poa, mambo.',
    standard: 'Standard English speakers.',
  };
  return hints[accent] || hints.standard;
};

const runFfmpeg = (args) =>
  new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`ffmpeg timed out after ${FFMPEG_TIMEOUT_MS}ms`));
    }, FFMPEG_TIMEOUT_MS);
    proc.stderr.on('data', (c) => { stderr = (stderr + c.toString()).slice(-2000); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr}`));
    });
  });

/** Split audio into low-bitrate mono mp3 chunks, each safely under 25 MB. */
const splitToMp3Chunks = async (srcPath) => {
  const dir = path.join(os.tmpdir(), `oai_chunks_${crypto.randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  const pattern = path.join(dir, 'chunk_%03d.mp3');
  await runFfmpeg([
    '-v', 'error',
    '-err_detect', 'ignore_err',
    '-i', srcPath,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-b:a', '32k',
    '-f', 'segment',
    '-segment_time', String(CHUNK_SECONDS),
    '-reset_timestamps', '1',
    pattern,
  ]);
  const files = (await fs.readdir(dir))
    .filter((f) => f.endsWith('.mp3'))
    .sort();
  return { dir, files: files.map((f) => path.join(dir, f)) };
};

const openaiTranscribeFile = async (filePath, accent) => {
  const buf = await fs.readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'audio/mpeg' }), path.basename(filePath));
  form.append('model', TRANSCRIBE_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('language', 'en');
  form.append('prompt', accentHint(accent));

  const res = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI transcription failed (${res.status}): ${detail.slice(0, 400)}`);
  }
  return res.json();
};

/**
 * Transcribe an audio file into the same segment shape geminiService returns:
 *   [{ id, startTime, endTime, speaker, text }]
 *
 * Whisper does not diarize, so every segment is attributed to a single
 * "Speaker 1" — the words are recovered faithfully, which is what matters.
 *
 * @param {string} audioFilePath
 * @param {string} mimeType
 * @param {string} accent
 * @returns {Promise<Array<{id:string,startTime:number,endTime:number,speaker:string,text:string}>>}
 */
export async function transcribeAudio(audioFilePath, mimeType, accent = 'standard') {
  // Repair/normalize first (handles malformed WebM/Opus), then chunk for the API limit.
  const normalized = await normalizeAudio(audioFilePath, mimeType);
  let chunkDir = null;
  try {
    const { dir, files } = await splitToMp3Chunks(normalized.path);
    chunkDir = dir;
    if (files.length === 0) return [];

    const segments = [];
    let idx = 0;
    for (let i = 0; i < files.length; i++) {
      const offset = i * CHUNK_SECONDS;
      const result = await openaiTranscribeFile(files[i], accent);
      const chunkSegments = Array.isArray(result?.segments) ? result.segments : [];
      for (const seg of chunkSegments) {
        const text = String(seg?.text || '').trim();
        if (!text) continue;
        segments.push({
          id: `seg-${idx++}`,
          startTime: Math.round((Number(seg.start) || 0) + offset),
          endTime: Math.round((Number(seg.end) || 0) + offset),
          speaker: 'Speaker 1',
          text,
        });
      }
    }
    return segments;
  } finally {
    await normalized.cleanup();
    if (chunkDir) await fs.rm(chunkDir, { recursive: true, force: true }).catch(() => {});
  }
}

const transcriptToText = (transcript) => {
  if (Array.isArray(transcript)) {
    return transcript
      .map((s) => `[${s?.speaker || 'Speaker'}]: ${String(s?.text || '').trim()}`)
      .filter((l) => l.length > 12)
      .join('\n');
  }
  return String(transcript || '');
};

/**
 * Analyze a transcript into the structured summary shape the UI expects:
 *   { executiveSummary[], actionItems[], decisions[], openQuestions[] }
 */
export async function analyzeMeeting(transcript, type = 'meeting', accent = 'standard') {
  const text = transcriptToText(transcript);
  if (!text.trim()) {
    return { executiveSummary: [], actionItems: [], decisions: [], openQuestions: [] };
  }

  const system =
    'You are an expert meeting analyst. Return STRICT JSON with keys: ' +
    'executiveSummary (array of concise bullet strings), actionItems (array of strings, ' +
    'include the owner when stated), decisions (array of strings), openQuestions (array of strings). ' +
    `Context: ${type} meeting, prioritize ${accent} accents. Be specific and faithful to the transcript.`;

  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ANALYZE_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text.slice(0, 240000) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI analysis failed (${res.status}): ${detail.slice(0, 400)}`);
  }
  const data = await res.json();
  let parsed;
  try {
    parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  } catch {
    parsed = {};
  }
  return {
    executiveSummary: Array.isArray(parsed.executiveSummary) ? parsed.executiveSummary : [],
    actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
    openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions : [],
  };
}

/**
 * Generate a spoken audio recap of the summary.
 *
 * Returns base64-encoded raw 24 kHz 16-bit mono PCM — identical to the Gemini
 * TTS output the frontend already wraps via buildWavBlob(pcmBytes, 24000), so
 * it plays without any client change.
 */
export async function generateAudioRecap(summary) {
  const exec = Array.isArray(summary?.executiveSummary) ? summary.executiveSummary : [];
  const actions = Array.isArray(summary?.actionItems) ? summary.actionItems : [];
  const textToSpeak =
    `Here is your meeting recap. ${exec.join('. ')}. ` +
    (actions.length ? `Key actions include: ${actions.join(', ')}.` : '');

  const res = await fetch(`${OPENAI_BASE}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: textToSpeak,
      response_format: 'pcm', // 24 kHz, 16-bit, mono — matches the client's WAV wrapper
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI TTS failed (${res.status}): ${detail.slice(0, 400)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}
