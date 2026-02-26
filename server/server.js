import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { randomUUID } from 'crypto';
import {
  transcribeAudio,
  analyzeMeeting,
  askTranscript,
  generateEmailDraft,
  generateAudioRecap,
  askSupport
} from './geminiService.js';
import dotenv from 'dotenv';
dotenv.config();


/**
 * ScribeAI Backend Server
 *
 * This Express server exposes a handful of API endpoints used by the
 * frontend. All interactions with Gemini happen here so that the
 * GEMINI_API_KEY remains secret. To run locally, set GEMINI_API_KEY
 * and CORS_ORIGINS in your environment. When deploying to Render,
 * configure these as environment variables in the service settings.
 */

// 2ï¸âƒ£ DEBUG CHECK (paste THIS right here)
console.log("ENV loaded:", { 
  hasGemini: Boolean(process.env.GEMINI_API_KEY),
  port: process.env.PORT,
  cors: process.env.CORS_ORIGINS,
});

const app = express();
const PORT = process.env.PORT || 3003;

// 1ï¸âƒ£ Core middleware first
app.use(express.json({ limit: '50mb' }));

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  })
);

// 2ï¸âƒ£ HEALTH CHECKS â€” PUT THEM HERE ðŸ‘‡
app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});


// -----------------------------
// MVP: Calendar + Auto-Listen + OAuth (Google/Microsoft)
// -----------------------------
// Notes:
// - OAuth requires these env vars (set in Render for production):
//   MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_REDIRECT_URI
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
// - For MVP we store tokens in-memory. Restarting the server loses them.
// - These endpoints do NOT affect your existing Gemini routes below.

const tokenStore = {
  microsoft: null, // { access_token, refresh_token, expires_at }
  google: null,    // { access_token, refresh_token, expires_at }
};

const autoListenStore = {
  enabled: false,
  leadMinutes: 2,
  providers: ['google', 'microsoft'],
};

const createAnalyticsStore = () => ({
  endpoints: {},
  autoListen: {
    toggles: 0,
    calendarSyncs: 0,
    calendarErrors: 0,
    lastUpdated: null,
  },
});

const analyticsStore = createAnalyticsStore();

const PROCESSING_JOB_TTL_MS = Number(process.env.PROCESSING_JOB_TTL_MS || 24 * 60 * 60 * 1000);
const PROCESSING_QUEUE_PARALLELISM = Math.max(1, Number(process.env.PROCESSING_QUEUE_PARALLELISM || 1));
const PROCESSING_TRANSCRIBE_TIMEOUT_MS = Number(process.env.PROCESSING_TRANSCRIBE_TIMEOUT_MS || 12 * 60 * 1000);
const PROCESSING_SUMMARY_TIMEOUT_MS = Number(process.env.PROCESSING_SUMMARY_TIMEOUT_MS || 4 * 60 * 1000);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_AUDIO_UPLOAD_BYTES || 300 * 1024 * 1024);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

const createProcessingJobsStore = () => ({
  byId: {},
  queue: [],
  active: 0,
});

const processingJobsStore = createProcessingJobsStore();

const recordEndpointMetric = (name, durationMs, success, error) => {
  if (!analyticsStore.endpoints[name]) {
    analyticsStore.endpoints[name] = { count: 0, totalDurationMs: 0, errors: 0, lastError: null };
  }
  const entry = analyticsStore.endpoints[name];
  entry.count += 1;
  entry.totalDurationMs += durationMs;
  if (!success) {
    entry.errors += 1;
    entry.lastError = error?.message || String(error || 'unknown error');
  }
  scheduleAnalyticsPersist();
};

const buildAnalyticsResponse = () => {
  const endpoints = {};
  Object.entries(analyticsStore.endpoints).forEach(([key, value]) => {
    endpoints[key] = {
      count: value.count,
      averageDurationMs: value.count ? Math.round(value.totalDurationMs / value.count) : 0,
      errors: value.errors,
      errorRate: value.count ? Number(((value.errors / value.count) * 100).toFixed(1)) : 0,
      lastError: value.lastError,
    };
  });

  return {
    endpoints,
    autoListen: analyticsStore.autoListen,
    timestamp: Date.now(),
  };
};

const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async (promiseFactory, timeoutMs, label) => {
  let timeoutId = null;
  try {
    return await Promise.race([
      promiseFactory(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const runWithRetries = async (taskFactory, options = {}) => {
  const retries = Number.isFinite(options.retries) ? options.retries : 2;
  const baseDelayMs = Number.isFinite(options.baseDelayMs) ? options.baseDelayMs : 1500;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await taskFactory();
    } catch (err) {
      lastError = err;
      if (attempt >= retries) break;
      await waitMs(baseDelayMs * (attempt + 1));
    }
  }

  throw lastError || new Error('Operation failed');
};

const toClientJob = (job) => ({
  id: job.id,
  status: job.status,
  phase: job.phase,
  progress: job.progress,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  completedAt: job.completedAt || null,
  error: job.error || null,
  transcript: job.status === 'completed' ? job.transcript : null,
  summary: job.status === 'completed' ? job.summary : null,
});

const serializeJobsForState = () => {
  const jobs = {};
  Object.values(processingJobsStore.byId).forEach((job) => {
    jobs[job.id] = {
      id: job.id,
      status: job.status,
      phase: job.phase,
      progress: job.progress,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt || null,
      error: job.error || null,
      transcript: job.status === 'completed' ? job.transcript : null,
      summary: job.status === 'completed' ? job.summary : null,
    };
  });

  return jobs;
};

const sanitizeSavedJobs = (savedJobs) => {
  const hydrated = {};
  Object.values(savedJobs || {}).forEach((jobLike) => {
    if (!jobLike?.id) return;
    const isDone = jobLike.status === 'completed';
    const isFailed = jobLike.status === 'failed';
    hydrated[jobLike.id] = {
      id: jobLike.id,
      status: isDone ? 'completed' : isFailed ? 'failed' : 'failed',
      phase: isDone ? 'completed' : 'failed',
      progress: isDone ? 100 : Math.min(99, Number(jobLike.progress || 0)),
      createdAt: jobLike.createdAt || Date.now(),
      updatedAt: Date.now(),
      completedAt: jobLike.completedAt || null,
      error: isDone ? null : jobLike.error || 'Server restarted before job completed. Please retry.',
      transcript: isDone ? jobLike.transcript || null : null,
      summary: isDone ? jobLike.summary || null : null,
      audioBase64: null,
      mimeType: null,
      accent: null,
    };
  });
  return hydrated;
};

const pruneOldProcessingJobs = () => {
  const now = Date.now();
  Object.entries(processingJobsStore.byId).forEach(([jobId, job]) => {
    if (job.status !== 'completed' && job.status !== 'failed') return;
    const referenceTime = job.completedAt || job.updatedAt || job.createdAt;
    if (now - referenceTime > PROCESSING_JOB_TTL_MS) {
      delete processingJobsStore.byId[jobId];
    }
  });
};

const updateProcessingJob = (jobId, patch) => {
  const current = processingJobsStore.byId[jobId];
  if (!current) return null;
  const updated = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };
  processingJobsStore.byId[jobId] = updated;
  scheduleAnalyticsPersist();
  return updated;
};

const runProcessingJob = async (jobId) => {
  const job = processingJobsStore.byId[jobId];
  if (!job || job.status !== 'queued') return;

  updateProcessingJob(jobId, {
    status: 'processing',
    phase: 'transcribe',
    progress: 12,
    error: null,
  });

  try {
    const transcript = await runWithRetries(
      () =>
        withTimeout(
          () => transcribeAudio(job.audioBase64, job.mimeType, job.accent || 'standard'),
          PROCESSING_TRANSCRIBE_TIMEOUT_MS,
          'Transcription'
        ),
      { retries: 2, baseDelayMs: 2500 }
    );

    updateProcessingJob(jobId, {
      phase: 'summarize',
      progress: 72,
      transcript,
      audioBase64: null,
    });

    const summary = await runWithRetries(
      () =>
        withTimeout(
          () => analyzeMeeting(transcript, 'meeting', job.accent || 'standard'),
          PROCESSING_SUMMARY_TIMEOUT_MS,
          'Summarization'
        ),
      { retries: 1, baseDelayMs: 2000 }
    );

    updateProcessingJob(jobId, {
      status: 'completed',
      phase: 'completed',
      progress: 100,
      summary,
      completedAt: Date.now(),
      error: null,
      audioBase64: null,
    });
  } catch (err) {
    updateProcessingJob(jobId, {
      status: 'failed',
      phase: 'failed',
      progress: 100,
      completedAt: Date.now(),
      error: err?.message || String(err || 'Processing failed'),
      audioBase64: null,
    });
  }
};

const drainProcessingQueue = () => {
  while (
    processingJobsStore.active < PROCESSING_QUEUE_PARALLELISM &&
    processingJobsStore.queue.length > 0
  ) {
    const nextJobId = processingJobsStore.queue.shift();
    const queuedJob = processingJobsStore.byId[nextJobId];
    if (!queuedJob || queuedJob.status !== 'queued') {
      continue;
    }

    processingJobsStore.active += 1;
    runProcessingJob(nextJobId)
      .catch((err) => {
        updateProcessingJob(nextJobId, {
          status: 'failed',
          phase: 'failed',
          progress: 100,
          completedAt: Date.now(),
          error: err?.message || String(err || 'Processing failed'),
        });
      })
      .finally(() => {
        processingJobsStore.active = Math.max(0, processingJobsStore.active - 1);
        pruneOldProcessingJobs();
        scheduleAnalyticsPersist();
        drainProcessingQueue();
      });
  }
};

const enqueueProcessingJob = (jobId) => {
  processingJobsStore.queue.push(jobId);
  scheduleAnalyticsPersist();
  drainProcessingQueue();
};

const nowMs = () => Date.now();
const iso = (d) => new Date(d).toISOString();

const requireEnv = (keys) => {
  const missing = keys.filter((k) => !process.env[k]);
  return missing.length ? missing : null;
};

const getBaseAppUrl = () => (process.env.APP_BASE_URL || '').replace(/\/$/, '');

const STATE_FILE_PATH = path.resolve(process.cwd(), process.env.STATE_FILE_PATH || 'state.json');

const ensureStateDir = async () => {
  await fs.mkdir(path.dirname(STATE_FILE_PATH), { recursive: true });
};

const persistState = async () => {
  const payload = {
    tokenStore,
    autoListenStore,
    analyticsStore,
    processingJobs: serializeJobsForState(),
  };
  await ensureStateDir();
  await fs.writeFile(STATE_FILE_PATH, JSON.stringify(payload, null, 2));
};

const persistStateSilently = () => {
  persistState().catch((err) => console.error('STATE PERSIST ERROR:', err));
};

const loadPersistentState = async () => {
  try {
    const raw = await fs.readFile(STATE_FILE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const applySavedState = (saved) => {
  if (!saved) return;
  if (saved.tokenStore) {
    tokenStore.microsoft = saved.tokenStore.microsoft ?? tokenStore.microsoft;
    tokenStore.google = saved.tokenStore.google ?? tokenStore.google;
  }
  if (saved.autoListenStore) {
    autoListenStore.enabled = saved.autoListenStore.enabled ?? autoListenStore.enabled;
    autoListenStore.leadMinutes = saved.autoListenStore.leadMinutes ?? autoListenStore.leadMinutes;
    autoListenStore.providers = Array.isArray(saved.autoListenStore.providers)
      ? saved.autoListenStore.providers
      : autoListenStore.providers;
  }
  if (saved.analyticsStore) {
    analyticsStore.endpoints = saved.analyticsStore.endpoints || analyticsStore.endpoints;
    analyticsStore.autoListen = { ...analyticsStore.autoListen, ...saved.analyticsStore.autoListen };
  }
  if (saved.processingJobs) {
    processingJobsStore.byId = sanitizeSavedJobs(saved.processingJobs);
    processingJobsStore.queue = [];
    processingJobsStore.active = 0;
  }
};

let analyticsDirty = false;
let analyticsSaveTimer = null;

const scheduleAnalyticsPersist = () => {
  analyticsDirty = true;
  if (analyticsSaveTimer) return;
  analyticsSaveTimer = setTimeout(() => {
    persistStateSilently();
    analyticsDirty = false;
    analyticsSaveTimer = null;
  }, 3000);
};

const processingJobsPruneTimer = setInterval(() => {
  pruneOldProcessingJobs();
  scheduleAnalyticsPersist();
}, 10 * 60 * 1000);

processingJobsPruneTimer.unref?.();

const buildMicrosoftAuthUrl = () => {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI;
  const tenant = process.env.MICROSOFT_TENANT || 'common';
  const scopes = encodeURIComponent('offline_access User.Read Calendars.Read');
  const state = String(Math.random()).slice(2);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'offline_access User.Read Calendars.Read',
    state,
    prompt: 'select_account',
  });
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params.toString()}`;
};

const exchangeMicrosoftCode = async (code) => {
  const tenant = process.env.MICROSOFT_TENANT || 'common';
  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = await resp.json();
  if (!resp.ok) {
    const msg = json?.error_description || json?.error || 'Microsoft token exchange failed';
    throw new Error(msg);
  }

  const expiresIn = Number(json.expires_in || 3600) * 1000;
  tokenStore.microsoft = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: nowMs() + expiresIn - 60_000, // subtract 60s safety
  };

  persistStateSilently();

  return tokenStore.microsoft;
};

const refreshMicrosoft = async () => {
  if (!tokenStore.microsoft?.refresh_token) return null;
  const tenant = process.env.MICROSOFT_TENANT || 'common';
  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: tokenStore.microsoft.refresh_token,
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = await resp.json();
  if (!resp.ok) {
    return null;
  }

  const expiresIn = Number(json.expires_in || 3600) * 1000;
  tokenStore.microsoft = {
    access_token: json.access_token,
    refresh_token: json.refresh_token || tokenStore.microsoft.refresh_token,
    expires_at: nowMs() + expiresIn - 60_000,
  };

  persistStateSilently();

  return tokenStore.microsoft;
};

const getMicrosoftAccessToken = async () => {
  if (!tokenStore.microsoft) return null;
  if (tokenStore.microsoft.expires_at && tokenStore.microsoft.expires_at > nowMs()) return tokenStore.microsoft.access_token;
  const refreshed = await refreshMicrosoft();
  return refreshed?.access_token || null;
};

const buildGoogleAuthUrl = () => {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

const exchangeGoogleCode = async (code) => {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    }),
  });

  const json = await resp.json();
  if (!resp.ok) {
    const msg = json?.error_description || json?.error || 'Google token exchange failed';
    throw new Error(msg);
  }

  const expiresIn = Number(json.expires_in || 3600) * 1000;
  tokenStore.google = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: nowMs() + expiresIn - 60_000,
  };

  persistStateSilently();

  return tokenStore.google;
};

const refreshGoogle = async () => {
  if (!tokenStore.google?.refresh_token) return null;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: tokenStore.google.refresh_token,
    }),
  });

  const json = await resp.json();
  if (!resp.ok) return null;

  const expiresIn = Number(json.expires_in || 3600) * 1000;
  tokenStore.google = {
    access_token: json.access_token,
    refresh_token: tokenStore.google.refresh_token,
    expires_at: nowMs() + expiresIn - 60_000,
  };

  persistStateSilently();

  return tokenStore.google;
};

const getGoogleAccessToken = async () => {
  if (!tokenStore.google) return null;
  if (tokenStore.google.expires_at && tokenStore.google.expires_at > nowMs()) return tokenStore.google.access_token;
  const refreshed = await refreshGoogle();
  return refreshed?.access_token || null;
};

// ---- OAuth start endpoints (return a URL to redirect to) ----
app.post('/api/auth/microsoft/start', (req, res) => {
  const missing = requireEnv(['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_REDIRECT_URI']);
  if (missing) return res.status(400).json({ error: 'Missing env vars', missing });
  res.json({ url: buildMicrosoftAuthUrl() });
});

app.get('/api/auth/microsoft/callback', async (req, res) => {
  try {
    const missing = requireEnv(['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_REDIRECT_URI']);
    if (missing) return res.status(400).json({ error: 'Missing env vars', missing });

    const code = req.query.code;
    if (!code) return res.status(400).json({ error: 'Missing code' });

    await exchangeMicrosoftCode(String(code));
    const base = getBaseAppUrl();
    if (base) return res.redirect(`${base}/?connected=microsoft`);
    res.json({ ok: true, provider: 'microsoft' });
  } catch (err) {
    console.error('MICROSOFT CALLBACK ERROR:', err);
    res.status(500).json({ error: 'Microsoft auth failed', details: err?.message || String(err) });
  }
});

app.post('/api/auth/google/start', (req, res) => {
  const missing = requireEnv(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']);
  if (missing) return res.status(400).json({ error: 'Missing env vars', missing });
  res.json({ url: buildGoogleAuthUrl() });
});

app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const missing = requireEnv(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']);
    if (missing) return res.status(400).json({ error: 'Missing env vars', missing });

    const code = req.query.code;
    if (!code) return res.status(400).json({ error: 'Missing code' });

    await exchangeGoogleCode(String(code));
    const base = getBaseAppUrl();
    if (base) return res.redirect(`${base}/?connected=google`);
    res.json({ ok: true, provider: 'google' });
  } catch (err) {
    console.error('GOOGLE CALLBACK ERROR:', err);
    res.status(500).json({ error: 'Google auth failed', details: err?.message || String(err) });
  }
});

// ---- Calendar endpoints ----
app.get('/api/calendar/upcoming', async (req, res) => {
  const timer = Date.now();
  analyticsStore.autoListen.calendarSyncs += 1;
  analyticsStore.autoListen.lastUpdated = new Date().toISOString();
  scheduleAnalyticsPersist();

  try {
    const provider = String(req.query.provider || '').toLowerCase();
    const horizonMinutes = Number(req.query.horizonMinutes || 240); // default: next 4h

    const start = new Date();
    const end = new Date(start.getTime() + horizonMinutes * 60 * 1000);

    const events = [];

    const wantMicrosoft = !provider || provider === 'microsoft';
    const wantGoogle = !provider || provider === 'google';

    if (wantMicrosoft) {
      const accessToken = await getMicrosoftAccessToken();
      if (accessToken) {
        const url = new URL('https://graph.microsoft.com/v1.0/me/calendarView');
        url.searchParams.set('startDateTime', iso(start));
        url.searchParams.set('endDateTime', iso(end));
        url.searchParams.set('$select', 'subject,start,end,onlineMeeting,onlineMeetingUrl,bodyPreview');
        url.searchParams.set('$orderby', 'start/dateTime');

        const resp = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (resp.ok) {
          const json = await resp.json();
          for (const it of (json?.value || [])) {
            events.push({
              id: `ms_${it.id}`,
              provider: 'microsoft',
              title: it.subject || 'Meeting',
              startTime: it.start?.dateTime || it.start?.date || null,
              endTime: it.end?.dateTime || it.end?.date || null,
              joinUrl: it.onlineMeetingUrl || it.onlineMeeting?.joinUrl || null,
            });
          }
        }
      }
    }

    if (wantGoogle) {
      const accessToken = await getGoogleAccessToken();
      if (accessToken) {
        const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
        url.searchParams.set('timeMin', iso(start));
        url.searchParams.set('timeMax', iso(end));
        url.searchParams.set('singleEvents', 'true');
        url.searchParams.set('orderBy', 'startTime');
        url.searchParams.set('maxResults', '20');

        const resp = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (resp.ok) {
          const json = await resp.json();
          for (const it of (json?.items || [])) {
            events.push({
              id: `g_${it.id}`,
              provider: 'google',
              title: it.summary || 'Meeting',
              startTime: it.start?.dateTime || it.start?.date || null,
              endTime: it.end?.dateTime || it.end?.date || null,
              joinUrl:
                it.hangoutLink || (it.conferenceData?.entryPoints || []).find((x) => x.uri)?.uri || null,
            });
          }
        }
      }
    }

    // Sort by start time if available
    events.sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')));

    recordEndpointMetric('calendarUpcoming', Date.now() - timer, true);
    res.json({
      events,
      connected: { microsoft: Boolean(tokenStore.microsoft), google: Boolean(tokenStore.google) },
      autoListen: autoListenStore,
    });
  } catch (err) {
    analyticsStore.autoListen.calendarErrors += 1;
    analyticsStore.autoListen.lastUpdated = new Date().toISOString();
    scheduleAnalyticsPersist();
    console.error('CALENDAR UPCOMING ERROR:', err);
    recordEndpointMetric('calendarUpcoming', Date.now() - timer, false, err);
    res.status(500).json({ error: 'Calendar upcoming failed', details: err?.message || String(err) });
  }
});

app.post('/api/calendar/sync-now', async (req, res) => {
  try {
    // For MVP: just call upcoming and return
    req.query.horizonMinutes = req.query.horizonMinutes || 240;
    // Reuse the handler logic by calling fetch manually is messy; instead return a simple OK.
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Sync now failed', details: err?.message || String(err) });
  }
});

// ---- Auto listen settings ----
app.post('/api/auto-listen/settings', async (req, res) => {
  const start = Date.now();
  try {
    const { enabled, leadMinutes, providers } = req.body || {};
    if (typeof enabled === 'boolean') autoListenStore.enabled = enabled;
    if (typeof leadMinutes === 'number' && Number.isFinite(leadMinutes)) autoListenStore.leadMinutes = Math.max(0, leadMinutes);
    if (Array.isArray(providers)) autoListenStore.providers = providers.map((x) => String(x).toLowerCase());

    analyticsStore.autoListen.toggles += 1;
    analyticsStore.autoListen.lastUpdated = new Date().toISOString();
    scheduleAnalyticsPersist();

    persistStateSilently();
    recordEndpointMetric('autoListenSettings', Date.now() - start, true);
    res.json({ ok: true, settings: autoListenStore });
  } catch (err) {
    analyticsStore.autoListen.lastUpdated = new Date().toISOString();
    recordEndpointMetric('autoListenSettings', Date.now() - start, false, err);
    res.status(500).json({ error: 'Auto-listen settings failed', details: err?.message || String(err) });
  }
});

app.get('/api/analytics', (req, res) => {
  try {
    res.json(buildAnalyticsResponse());
  } catch (err) {
    console.error('ANALYTICS FETCH ERROR:', err);
    res.status(500).json({ error: 'Failed to read analytics', details: String(err) });
  }
});

// 3ï¸âƒ£ API ROUTES
app.post('/api/processing-jobs', upload.single('audio'), async (req, res) => {
  const timer = Date.now();
  try {
    const audioFile = req.file;
    if (!audioFile?.buffer?.length) {
      recordEndpointMetric('processingJobCreate', Date.now() - timer, false, new Error('Missing audio payload'));
      return res.status(400).json({ error: 'Audio payload is required.' });
    }

    const accentRaw = String(req.body?.accent || 'standard').toLowerCase();
    const accent = ['standard', 'uk', 'nigerian'].includes(accentRaw) ? accentRaw : 'standard';
    const mimeType = String(req.body?.mimeType || audioFile.mimetype || 'audio/webm');
    const audioBase64 = audioFile.buffer.toString('base64');
    const jobId = randomUUID();

    processingJobsStore.byId[jobId] = {
      id: jobId,
      status: 'queued',
      phase: 'queued',
      progress: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null,
      error: null,
      transcript: null,
      summary: null,
      accent,
      mimeType,
      audioBase64,
    };

    enqueueProcessingJob(jobId);
    recordEndpointMetric('processingJobCreate', Date.now() - timer, true);

    res.status(202).json({
      jobId,
      status: 'queued',
      phase: 'queued',
      progress: 2,
    });
  } catch (err) {
    console.error('PROCESSING JOB CREATE ERROR:', err);
    recordEndpointMetric('processingJobCreate', Date.now() - timer, false, err);
    res.status(500).json({ error: 'Failed to start processing job', details: err?.message || String(err) });
  }
});

app.get('/api/processing-jobs/:jobId', (req, res) => {
  const timer = Date.now();
  try {
    const jobId = String(req.params.jobId || '');
    const job = processingJobsStore.byId[jobId];
    if (!job) {
      recordEndpointMetric('processingJobStatus', Date.now() - timer, false, new Error('Not found'));
      return res.status(404).json({ error: 'Processing job not found' });
    }

    recordEndpointMetric('processingJobStatus', Date.now() - timer, true);
    res.json({ job: toClientJob(job) });
  } catch (err) {
    recordEndpointMetric('processingJobStatus', Date.now() - timer, false, err);
    res.status(500).json({ error: 'Failed to fetch processing job', details: err?.message || String(err) });
  }
});

// API ROUTES
app.post('/api/transcribe', async (req, res) => {
  const timer = Date.now();
  try {
    const { audio, mimeType, accent } = req.body;
    const transcript = await transcribeAudio(audio, mimeType, accent);
    recordEndpointMetric('transcribe', Date.now() - timer, true);
    res.json({ transcript });
  } catch (err) {
    console.error(err);
    recordEndpointMetric('transcribe', Date.now() - timer, false, err);
    res.status(500).json({ error: 'Error during transcription' });
  }
});

app.post('/api/analyze', async (req, res) => {
  const timer = Date.now();
  try {
    const { transcript, type, accent } = req.body;
    const summary = await analyzeMeeting(transcript, type, accent);
    recordEndpointMetric('analyze', Date.now() - timer, true);
    res.json({ summary });
  } catch (err) {
    console.error(err);
    recordEndpointMetric('analyze', Date.now() - timer, false, err);
    res.status(500).json({ error: 'Error during analysis' });
  }
});

app.post('/api/ask', async (req, res) => {
  const timer = Date.now();
  try {
    const { meeting, question, history } = req.body;
    const answer = await askTranscript(meeting, question, history);
    recordEndpointMetric('ask', Date.now() - timer, true);
    res.json({ answer });
  } catch (err) {
    console.error(err);
    recordEndpointMetric('ask', Date.now() - timer, false, err);
    res.status(500).json({ error: 'Error answering question' });
  }
});

app.post('/api/draft-email', async (req, res) => {
  const timer = Date.now();
  try {
    const { meeting } = req.body;
    const email = await generateEmailDraft(meeting);
    recordEndpointMetric('draftEmail', Date.now() - timer, true);
    res.json({ email });
  } catch (err) {
    console.error(err);
    recordEndpointMetric('draftEmail', Date.now() - timer, false, err);
    res.status(500).json({ error: 'Error generating email draft' });
  }
});

app.post('/api/audio-recap', async (req, res) => {
  const timer = Date.now();
  try {
    const { summary } = req.body;
    const audio = await generateAudioRecap(summary);
    recordEndpointMetric('audioRecap', Date.now() - timer, true);
    res.json({ audio });
  } catch (err) {
    console.error(err);
    recordEndpointMetric('audioRecap', Date.now() - timer, false, err);
    res.status(500).json({ error: 'Error generating audio recap' });
  }
});

app.post('/api/support', async (req, res) => {
  const timer = Date.now();
  try {
    const { question, history } = req.body;
    const answer = await askSupport(question, history);
    recordEndpointMetric('support', Date.now() - timer, true);
    res.json({ answer });
  } catch (err) {
    console.error("SUPPORT ERROR:", err);
    recordEndpointMetric('support', Date.now() - timer, false, err);
    res.status(500).json({
      error: "Support failed",
      details: err?.message || String(err),
      gotBodyKeys: Object.keys(req.body || {}),
      gotQuestionType: typeof req.body?.question
    });
  }
});

app.use((err, req, res, next) => {
  if (!(err instanceof multer.MulterError)) {
    return next(err);
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'Uploaded audio is too large.',
      details: `Max allowed size is ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`,
    });
  }

  return res.status(400).json({ error: 'Upload failed', details: err.message });
});


const startServer = async () => {
  try {
    const saved = await loadPersistentState();
    applySavedState(saved);
  } catch (err) {
    console.error('Failed to hydrate saved state:', err);
  }

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
};

startServer();

