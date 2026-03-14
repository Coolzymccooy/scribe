import { GoogleGenAI, Type, Modality } from '@google/genai';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

/**
 * Gemini Service
 *
 * This module provides a thin wrapper over the Google GenAI SDK. All
 * calls require a GEMINI_API_KEY to be present in the environment.
 * These functions implement the same behaviour as the original
 * frontend-only implementation but move the secret key out of the
 * browser and into the server. See server.js for route handlers
 * exposing these capabilities to the client.
 */

const TRANSCRIBE_MODEL = process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3-flash-preview';
const ANALYZE_MODEL = process.env.GEMINI_ANALYZE_MODEL || 'gemini-3-flash-preview';
const CHUNKED_ANALYSIS_THRESHOLD_CHARS = Number(process.env.CHUNKED_ANALYSIS_THRESHOLD_CHARS || 16000);
const MAX_ANALYSIS_CHUNK_CHARS = Number(process.env.MAX_ANALYSIS_CHUNK_CHARS || 12000);
const CHUNK_ANALYSIS_PARALLELISM = Math.max(1, Number(process.env.CHUNK_ANALYSIS_PARALLELISM || 2));

const SUMMARY_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    executiveSummary: { type: Type.ARRAY, items: { type: Type.STRING } },
    actionItems: { type: Type.ARRAY, items: { type: Type.STRING } },
    decisions: { type: Type.ARRAY, items: { type: Type.STRING } },
    openQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['executiveSummary', 'actionItems', 'decisions', 'openQuestions'],
};

const getClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set');
  }
  return new GoogleGenAI({ apiKey });
};

const safeJsonParse = (value, fallback) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const normalizeTranscriptInput = (transcript) => {
  if (Array.isArray(transcript)) {
    return transcript
      .map((segment, idx) => ({
        speaker: String(segment?.speaker || `Speaker ${idx + 1}`),
        text: String(segment?.text || '').trim(),
      }))
      .filter((segment) => segment.text);
  }

  if (typeof transcript === 'string') {
    return transcript
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text) => ({ speaker: 'Speaker', text }));
  }

  return [];
};

const splitTranscriptByCharLimit = (lines, maxChars) => {
  const chunks = [];
  let current = [];
  let currentChars = 0;

  for (const line of lines) {
    const lineLength = line.length + 1;
    if (current.length > 0 && currentChars + lineLength > maxChars) {
      chunks.push(current.join('\n'));
      current = [];
      currentChars = 0;
    }
    current.push(line);
    currentChars += lineLength;
  }

  if (current.length) {
    chunks.push(current.join('\n'));
  }

  return chunks;
};

const mapWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const currentIdx = cursor++;
      results[currentIdx] = await worker(items[currentIdx], currentIdx);
    }
  });

  await Promise.all(runners);
  return results;
};

const summarizeTranscriptChunk = async (ai, transcriptChunk, type, accent, label) => {
  const chunkLabel = label ? `Segment: ${label}\n` : '';
  const prompt = `${chunkLabel}Analyze this ${type} meeting transcript.\nContext: prioritize ${accent} accents.\nReturn concise bullet-ready points.\nTranscript:\n${transcriptChunk}`;

  const response = await ai.models.generateContent({
    model: ANALYZE_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: SUMMARY_RESPONSE_SCHEMA,
    },
  });

  return safeJsonParse(response.text || '{}', {
    executiveSummary: [],
    actionItems: [],
    decisions: [],
    openQuestions: [],
  });
};

export async function transcribeAudio(audioFilePath, mimeType, accent) {
  const ai = getClient();

  const accentInstructions = {
    standard: `You are transcribing standard English. Use proper grammar and spelling.`,
    uk: `You are transcribing British English (UK Dialect). Apply UK spelling conventions (e.g., 'colour', 'realise', 'organisation'). 
    Recognise British phrases, idioms, and pronunciation patterns. Common UK slang and expressions should be preserved as spoken.
    Speakers may use words like 'brilliant', 'cheers', 'proper', 'reckon', 'mate', 'bloke', 'sorted'. Transcribe faithfully.`,
    nigerian: `You are transcribing Nigerian English (Nigerian Patois / Pidgin). 
    Nigerian English blends formal English with Yoruba, Igbo, Hausa influences and Nigerian Pidgin.
    Preserve common Nigerian phrases and expressions as spoken: e.g., 'abi', 'o', 'na', 'e don happen', 'how you dey', 'no vex', 'oga', 'aunty', 'bros'.
    Do NOT over-correct Nigerian Pidgin to standard English. Capture the speaker's actual words faithfully.
    If a speaker code-switches between formal English and Pidgin, transcribe both accurately.`,
    ghanaian: `You are transcribing Ghanaian English (Ghanaian Pidgin / Akan-influenced English).
    Ghanaian English is influenced by Twi, Ga, Ewe and local Pidgin. Preserve authentic expressions.
    Common phrases to preserve as spoken: 'chale' (friend/buddy), 'herh' (exclamation), 'ei' (surprise), 'ancient' (used ironically), 'borla' (waste), 'gyimii' (foolishness).
    Speakers frequently drop articles and use tonal stress. Do NOT over-correct to Standard English.
    If a speaker switches between Twi phrases and English, transcribe both faithfully.`,
    southafrican: `You are transcribing South African English (influenced by Zulu, Xhosa, Afrikaans and Cape Malay).
    Preserve authentic SA expressions: 'eish' (frustration/surprise), 'lekker' (great/nice), 'braai' (barbecue), 'ja' (yes), 'now-now' (very soon), 'shame' (sympathy), 'robot' (traffic light), 'bakkie' (pickup truck), 'bra/bru' (friend).
    South African English has distinctive vowel shifts and rhythm — do not flatten to Standard English.
    Code-switching between Zulu, Xhosa, Sotho, or Afrikaans and English should be transcribed faithfully.`,
    kenyan: `You are transcribing Kenyan English (Swahili-influenced, with Sheng code-switching).
    Kenyan English blends formal English with Swahili and Sheng (urban slang). Preserve authentic expressions.
    Common phrases: 'sawa' (okay), 'mambo' (what's up), 'poa' (cool/fine), 'si unaona' (you see), 'kwisha' (finished/done), 'mzuri' (good), 'buda' (guy/friend), 'nilikuwa' (I was).
    Speakers frequently insert Swahili or Sheng into English sentences — preserve both accurately.
    Do NOT flatten Sheng slang to Standard English. Transcribe as spoken.`,
  };

  const dialectNote = accentInstructions[accent] || accentInstructions.standard;

  const prompt = `
    ${dialectNote}

    Now transcribe the audio in strict chronological order.
    Instructions:
    1. Identify speakers only when clearly distinct.
    2. Provide timestamps in seconds.
    3. Return JSON array objects with keys: "id", "startTime", "endTime", "speaker", "text".
    4. Do not invent speech. Use "[inaudible]" only for unclear fragments.
    5. If there is one speaker, keep one speaker.
    6. If silence/no speech, return an empty array.
  `;

  // Check file size without reading entire file into memory
  const fileStat = await fs.stat(audioFilePath);
  const INLINE_LIMIT = 15 * 1024 * 1024; // 15MB

  if (fileStat.size <= INLINE_LIMIT) {
    // Small/medium recordings: use inlineData directly — proven reliable
    const fileBuffer = await fs.readFile(audioFilePath);
    const base64Audio = fileBuffer.toString('base64');
    const response = await ai.models.generateContent({
      model: TRANSCRIBE_MODEL,
      contents: {
        parts: [
          { inlineData: { data: base64Audio, mimeType } },
          { text: prompt },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              startTime: { type: Type.NUMBER },
              endTime: { type: Type.NUMBER },
              speaker: { type: Type.STRING },
              text: { type: Type.STRING },
            },
            required: ['id', 'startTime', 'endTime', 'speaker', 'text'],
          },
        },
      },
    });
    return safeJsonParse(response.text || '[]', []);
  }

  // Large recordings (>15MB): upload directly from multer temp path via the Gemini File API
  // No need to copy — multer already wrote to disk. We rename to add an extension for Gemini.
  let uploadResult;
  const tempFilename = crypto.randomUUID() + (mimeType.includes('mp4') ? '.mp4' : mimeType.includes('wav') ? '.wav' : '.webm');
  const tempFilePath = path.join(os.tmpdir(), tempFilename);
  await fs.copyFile(audioFilePath, tempFilePath);

  try {
    uploadResult = await ai.files.upload({
      file: tempFilePath,
      config: { mimeType },
    });

    const FILE_API_POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max for Gemini to process upload
    const fileApiPollStart = Date.now();
    let fileState = await ai.files.get({ name: uploadResult.name });
    while (fileState.state === 'PROCESSING') {
      if (Date.now() - fileApiPollStart > FILE_API_POLL_TIMEOUT_MS) {
        throw new Error(`Gemini File API processing timed out after ${FILE_API_POLL_TIMEOUT_MS / 1000}s`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      fileState = await ai.files.get({ name: uploadResult.name });
    }

    if (fileState.state === 'FAILED') {
      throw new Error('Gemini File processing failed.');
    }

    const response = await ai.models.generateContent({
      model: TRANSCRIBE_MODEL,
      contents: { parts: [{ fileData: { fileUri: uploadResult.uri, mimeType } }, { text: prompt }] },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              startTime: { type: Type.NUMBER },
              endTime: { type: Type.NUMBER },
              speaker: { type: Type.STRING },
              text: { type: Type.STRING },
            },
            required: ['id', 'startTime', 'endTime', 'speaker', 'text'],
          },
        },
      },
    });
    return safeJsonParse(response.text || '[]', []);
  } finally {
    await fs.unlink(tempFilePath).catch(() => { });
    if (uploadResult && uploadResult.name) {
      await ai.files.delete({ name: uploadResult.name }).catch((err) =>
        console.error('Failed to clean up Gemini file:', err)
      );
    }
  }
}

export async function analyzeMeeting(transcript, type, accent) {
  const ai = getClient();
  const segments = normalizeTranscriptInput(transcript);

  if (!segments.length) {
    throw new Error('Invalid transcript: expected non-empty array or string');
  }

  const lines = segments.map((segment) => `[${segment.speaker}]: ${segment.text}`);
  const fullTranscript = lines.join('\n');

  if (fullTranscript.length <= CHUNKED_ANALYSIS_THRESHOLD_CHARS) {
    return summarizeTranscriptChunk(ai, fullTranscript, type, accent);
  }

  const chunks = splitTranscriptByCharLimit(lines, MAX_ANALYSIS_CHUNK_CHARS);
  const chunkSummaries = await mapWithConcurrency(chunks, CHUNK_ANALYSIS_PARALLELISM, (chunk, idx) =>
    summarizeTranscriptChunk(ai, chunk, type, accent, `${idx + 1}/${chunks.length}`)
  );

  const mergePrompt = `
    Merge the following partial meeting summaries into one final JSON summary.
    Keep key outcomes only, deduplicate repeated items, and preserve high-confidence decisions/actions.
    Return valid JSON with keys: executiveSummary, actionItems, decisions, openQuestions.

    Partial summaries:
    ${JSON.stringify(chunkSummaries)}
  `;

  const merged = await ai.models.generateContent({
    model: ANALYZE_MODEL,
    contents: mergePrompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: SUMMARY_RESPONSE_SCHEMA,
    },
  });

  return safeJsonParse(merged.text || '{}', {
    executiveSummary: [],
    actionItems: [],
    decisions: [],
    openQuestions: [],
  });
}

export async function askTranscript(meeting, question, history) {
  const ai = getClient();
  const transcriptText = meeting.transcript.map((segment) => `[${segment.speaker}]: ${segment.text}`).join('\n');
  const chat = ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: {
      systemInstruction: `You are an AI assistant helping a user understand a meeting transcript. Use the provided transcript to answer questions accurately. Transcript:\n${transcriptText}`,
    },
  });
  const response = await chat.sendMessage({ message: question });
  return response.text || "I couldn't find an answer to that in the transcript.";
}

export async function generateAudioRecap(summary) {
  const ai = getClient();
  const textToSpeak = `Here is your meeting recap. ${summary.executiveSummary.join('. ')}. Key actions include: ${summary.actionItems.join(', ')}.`;
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [{ parts: [{ text: textToSpeak }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
      },
    },
  });

  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || '';
}

export async function generateEmailDraft(meeting) {
  const ai = getClient();
  const prompt = `
    Draft a professional follow-up email based on this meeting summary.
    Meeting Title: ${meeting.title}
    Summary: ${meeting.summary?.executiveSummary.join(', ')}
    Action Items: ${meeting.summary?.actionItems.join(', ')}

    Format the output as plain text suitable for an email body. Do not include a Subject line in the text itself.
  `;
  const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt });
  return response.text || '';
}

export async function askSupport(question, history) {
  const ai = getClient();
  const chat = ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: {
      systemInstruction: 'You are a senior ScribeAI support engineer. Provide technical assistance regarding IndexedDB local storage, cloud sync, and neural encryption.',
    },
  });
  const response = await chat.sendMessage({ message: question });
  return response.text || 'Protocol failure.';
}
