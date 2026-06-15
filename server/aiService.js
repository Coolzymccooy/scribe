/**
 * AI Service Router
 *
 * Chooses the provider (OpenAI or Gemini) per capability so transcription,
 * analysis and the audio recap can be switched independently without touching
 * the route handlers. Server code imports from here instead of a concrete
 * provider.
 *
 * Resolution per capability:
 *   - <CAP>_PROVIDER env (e.g. TRANSCRIBE_PROVIDER=openai), else
 *   - AI_PROVIDER env (global default), else
 *   - 'gemini' (backward compatible).
 * If 'openai' is selected but OPENAI_API_KEY is missing, it falls back to Gemini
 * with a warning so a misconfiguration can't take transcription offline.
 *
 * Examples (Coolify env):
 *   AI_PROVIDER=openai            -> OpenAI for everything
 *   TRANSCRIBE_PROVIDER=openai    -> Whisper for transcription, Gemini elsewhere
 */

import * as gemini from './geminiService.js';
import * as openai from './openaiService.js';

const hasOpenAI = () => Boolean(process.env.OPENAI_API_KEY);

const resolve = (capEnvVar) => {
  const choice = (process.env[capEnvVar] || process.env.AI_PROVIDER || 'gemini').toLowerCase();
  if (choice === 'openai') {
    if (hasOpenAI()) return openai;
    console.warn(`[aiService] ${capEnvVar}=openai but OPENAI_API_KEY is missing — falling back to Gemini.`);
    return gemini;
  }
  return gemini;
};

export const transcribeAudio = (...args) =>
  resolve('TRANSCRIBE_PROVIDER').transcribeAudio(...args);

export const analyzeMeeting = (...args) =>
  resolve('ANALYZE_PROVIDER').analyzeMeeting(...args);

export const generateAudioRecap = (...args) =>
  resolve('RECAP_PROVIDER').generateAudioRecap(...args);

// Text-only helpers stay on Gemini for now (no OpenAI equivalents wired yet).
export const askTranscript = gemini.askTranscript;
export const generateEmailDraft = gemini.generateEmailDraft;
export const askSupport = gemini.askSupport;
