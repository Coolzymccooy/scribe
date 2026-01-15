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

// Parse JSON request bodies and allow large payloads for base64 audio
app.use(express.json({ limit: '50mb' }));

// Configure CORS. If CORS_ORIGINS is provided as a comma-separated
// list of allowed origins, only those origins will be accepted. If
// omitted, all origins are allowed in development for convenience.
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      // If no origin (e.g. curl) or no restrictions, allow.
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  })
);

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
    console.error(err);
    res.status(500).json({ error: 'Error answering support question' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});