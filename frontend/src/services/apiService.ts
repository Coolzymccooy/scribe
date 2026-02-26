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

const readErrorMessage = async (res: Response, fallback: string): Promise<string> => {
  try {
    const payload = await res.json();
    const detail = payload?.details ? `: ${String(payload.details)}` : '';
    const error = payload?.error ? String(payload.error) : fallback;
    return `${error}${detail}`;
  } catch {
    return fallback;
  }
};

export type ProcessingJobStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type ProcessingJobPhase = 'queued' | 'transcribe' | 'summarize' | 'completed' | 'failed';

export interface ProcessingJob {
  id: string;
  status: ProcessingJobStatus;
  phase: ProcessingJobPhase;
  progress: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  error: string | null;
  transcript: any | null;
  summary: any | null;
}

export const startProcessingJob = async (
  audioBlob: Blob,
  mimeType: string,
  accent: string
): Promise<{ jobId: string; status: ProcessingJobStatus; phase: ProcessingJobPhase; progress: number }> => {
  const form = new FormData();
  const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('wav') ? 'wav' : 'webm';
  form.append('audio', audioBlob, `recording.${extension}`);
  form.append('mimeType', mimeType);
  form.append('accent', accent);

  const res = await fetch(`${getBaseUrl()}/api/processing-jobs`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const message = await readErrorMessage(res, `Failed to start processing job (${res.status})`);
    throw new Error(message);
  }

  const payload = await res.json();
  return {
    jobId: String(payload?.jobId || ''),
    status: payload?.status || 'queued',
    phase: payload?.phase || 'queued',
    progress: Number(payload?.progress || 0),
  };
};

export const getProcessingJob = async (jobId: string): Promise<ProcessingJob> => {
  const res = await fetch(`${getBaseUrl()}/api/processing-jobs/${encodeURIComponent(jobId)}`, {
    method: 'GET',
  });

  if (!res.ok) {
    const message = await readErrorMessage(res, `Failed to fetch processing job (${res.status})`);
    throw new Error(message);
  }

  const payload = await res.json();
  return payload?.job as ProcessingJob;
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
