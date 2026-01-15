import express from 'express';
import cors from 'cors';
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

const app = express();
const PORT = process.env.PORT || 3003;

// 1️⃣ Core middleware first
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
    }
  })
);

// 2️⃣ HEALTH CHECKS — PUT THEM HERE 👇
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

// 3️⃣ API ROUTES
app.post('/api/transcribe', async (req, res) => {
  try {
    const { audio, mimeType, accent } = req.body;
    const transcript = await transcribeAudio(audio, mimeType, accent);
    res.json({ transcript });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error during transcription' });
  }
});

app.post('/api/analyze', async (req, res) => {
  try {
    const { transcript, type, accent } = req.body;
    const summary = await analyzeMeeting(transcript, type, accent);
    res.json({ summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error during analysis' });
  }
});

app.post('/api/ask', async (req, res) => {
  try {
    const { meeting, question, history } = req.body;
    const answer = await askTranscript(meeting, question, history);
    res.json({ answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error answering question' });
  }
});

app.post('/api/draft-email', async (req, res) => {
  try {
    const { meeting } = req.body;
    const email = await generateEmailDraft(meeting);
    res.json({ email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error generating email draft' });
  }
});

app.post('/api/audio-recap', async (req, res) => {
  try {
    const { summary } = req.body;
    const audio = await generateAudioRecap(summary);
    res.json({ audio });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error generating audio recap' });
  }
});

app.post('/api/support', async (req, res) => {
  try {
    const { question, history } = req.body;
    const answer = await askSupport(question, history);
    res.json({ answer });
  } catch (err) {
    console.error("SUPPORT ERROR:", err);
    res.status(500).json({
      error: "Support failed",
      details: err?.message || String(err),
      gotBodyKeys: Object.keys(req.body || {}),
      gotQuestionType: typeof req.body?.question
    });
  }
});


app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});