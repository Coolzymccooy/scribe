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

const getClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set');
  }
  return new GoogleGenAI({ apiKey });
};

export async function transcribeAudio(audio, mimeType, accent) {
  const ai = getClient();
  const prompt = `
    Listen to this audio carefully and transcribe it.
    Accents to prioritize: ${accent}
    
    Instructions:
    1. Identify different speakers.
    2. Provide timestamps in seconds.
    3. Return a JSON array of objects: "id", "startTime", "endTime", "speaker", "text".
  `;
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
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
            text: { type: Type.STRING }
          },
          required: ['id', 'startTime', 'endTime', 'speaker', 'text']
        }
      }
    }
  });
  return JSON.parse(response.text || '[]');
}

export async function analyzeMeeting(transcript, type, accent) {
  const ai = getClient();

  // ✅ Accept both:
  // 1) array of segments [{speaker,text,...}]
  // 2) plain string transcript "line1\nline2"
  const segments = Array.isArray(transcript)
    ? transcript
    : typeof transcript === "string"
      ? transcript
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(Boolean)
          .map((text, i) => ({ speaker: `Speaker`, text }))
      : null;

  if (!segments || segments.length === 0) {
    throw new Error("Invalid transcript: expected array or string");
  }

  const fullTranscript = segments
    .map(s => `[${s.speaker}]: ${s.text}`)
    .join("\n");

  const prompt = `Analyze this ${type} meeting. Context: ${accent} accents.\nTranscript:\n${fullTranscript}`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          executiveSummary: { type: Type.ARRAY, items: { type: Type.STRING } },
          actionItems: { type: Type.ARRAY, items: { type: Type.STRING } },
          decisions: { type: Type.ARRAY, items: { type: Type.STRING } },
          openQuestions: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["executiveSummary", "actionItems", "decisions", "openQuestions"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
}

export async function askTranscript(meeting, question, history) {
  const ai = getClient();
  const transcriptText = meeting.transcript.map(s => `[${s.speaker}]: ${s.text}`).join('\n');
  const chat = ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: {
      systemInstruction: `You are an AI assistant helping a user understand a meeting transcript. Use the provided transcript to answer questions accurately. Transcript:\n${transcriptText}`
    }
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
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
      }
    }
  });
  return (
    response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || ''
  );
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
      systemInstruction: 'You are a senior ScribeAI support engineer. Provide technical assistance regarding IndexedDB local storage, cloud sync, and neural encryption.'
    }
  });
  const response = await chat.sendMessage({ message: question });
  return response.text || 'Protocol failure.';
}