/**
 * API Service
 *
 * This module centralizes all HTTP calls made by the frontend. By
 * routing interactions with Gemini through your own backend, you
 * remove any direct dependency on the @google/genai library from the
 * client bundle. Each function accepts parameters used by the
 * respective backend endpoints and returns a typed result or throws
 * on error. The backend URL can be configured at build time via
 * VITE_BACKEND_URL; if omitted, relative URLs will be used (useful
 * when the frontend is deployed behind a proxy that rewrites /api/* to
 * your backend).
 */

const getBaseUrl = (): string => {
  // Vercel and Vite expose environment variables on import.meta.env. If
  // VITE_BACKEND_URL is defined, prefix requests with it; otherwise
  // rely on relative paths (suitable for local dev with a proxy or
  // deployment where /api is proxied).
  return import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '') || '';
};

export const transcribeAudio = async (
  audio: string,
  mimeType: string,
  accent: string
): Promise<any> => {
  const res = await fetch(`${getBaseUrl()}/api/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio, mimeType, accent })
  });
  if (!res.ok) {
    throw new Error('Failed to transcribe audio');
  }
  const data = await res.json();
  return data.transcript;
};

export const analyzeMeeting = async (
  transcript: any,
  type: string,
  accent: string
): Promise<any> => {
  const res = await fetch(`${getBaseUrl()}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, type, accent })
  });
  if (!res.ok) {
    throw new Error('Failed to analyze meeting');
  }
  const data = await res.json();
  return data.summary;
};

export const askTranscript = async (
  meeting: any,
  question: string,
  history: any[]
): Promise<string> => {
  const res = await fetch(`${getBaseUrl()}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meeting, question, history })
  });
  if (!res.ok) {
    throw new Error('Failed to answer transcript question');
  }
  const data = await res.json();
  return data.answer;
};

export const generateEmailDraft = async (meeting: any): Promise<string> => {
  const res = await fetch(`${getBaseUrl()}/api/draft-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meeting })
  });
  if (!res.ok) {
    throw new Error('Failed to generate email draft');
  }
  const data = await res.json();
  return data.email;
};

export const generateAudioRecap = async (summary: any): Promise<string> => {
  const res = await fetch(`${getBaseUrl()}/api/audio-recap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary })
  });
  if (!res.ok) {
    throw new Error('Failed to generate audio recap');
  }
  const data = await res.json();
  return data.audio;
};

export const askSupport = async (
  question: string,
  history: any[]
): Promise<string> => {
  const res = await fetch(`${getBaseUrl()}/api/support`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, history })
  });
  if (!res.ok) {
    throw new Error('Failed to get support response');
  }
  const data = await res.json();
  return data.answer;
};