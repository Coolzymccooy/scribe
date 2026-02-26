import { GoogleGenAI, Type, Modality } from '@google/genai';

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

export async function transcribeAudio(audio, mimeType, accent) {
  const ai = getClient();
  const prompt = `
    Listen carefully and transcribe in strict chronological order.
    Accent priority: ${accent}

    Instructions:
    1. Identify speakers only when clearly distinct.
    2. Provide timestamps in seconds.
    3. Return JSON array objects with keys: "id", "startTime", "endTime", "speaker", "text".
    4. Do not invent speech. Use "[inaudible]" only for unclear fragments.
    5. If there is one speaker, keep one speaker.
    6. If silence/no speech, return an empty array.
  `;

  const response = await ai.models.generateContent({
    model: TRANSCRIBE_MODEL,
    contents: { parts: [{ inlineData: { mimeType, data: audio } }, { text: prompt }] },
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
