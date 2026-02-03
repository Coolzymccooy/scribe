// src/App.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";


import { MeetingType } from './types'; // <-- value import (enum used at runtime)
import type {
  ViewState,
  MeetingNote,
  TranscriptSegment,
  ChatMessage,
  Theme,
  AISummary,
  CalendarEvent,
  AnalyticsPayload
} from './types';

import {
  MicIcon,
  FolderIcon,
  SettingsIcon,
  FileTextIcon,
  SearchIcon,
  PlayIcon,
  StopIcon,
} from "./components/Icons";

import {
  analyzeMeeting,
  transcribeAudio,
  generateEmailDraft,
  generateAudioRecap,
  askSupport,
} from "./services/apiService";

import { useWakeLock } from "./hooks/useWakeLock";

import {
  saveAudioBlob,
  getAudioBlob,
  appendAudioChunk,
  clearAudioChunks,
  listUnfinishedSessions,
  getAudioChunks
} from "./services/storageService";

/** -----------------------------
 * Small UI helpers
 * ------------------------------ */

const Tooltip: React.FC<{ text: string; position?: "top" | "bottom" }> = ({
  text,
  position = "top",
}) => (
  <span
    className={`pointer-events-none absolute z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-200
      ${position === "top" ? "-top-8" : "top-10"} left-1/2 -translate-x-1/2
      bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl shadow-xl`}
  >
    {text}
  </span>
);

const formatTime = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const formatDurationHMS = (seconds: number) => formatTime(seconds);

const formatRecordedAt = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Example: 17 Jan 2026 • 12:24
  const datePart = new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
  const timePart = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `${datePart} • ${timePart}`;
};

const normalizeMimeType = (file: File) => {
  const name = (file.name || "").toLowerCase();
  const t = (file.type || "").toLowerCase();

  if (t === "audio/x-m4a" || name.endsWith(".m4a")) return "audio/mp4";
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".webm")) return "audio/webm";
  if (name.endsWith(".ogg")) return "audio/ogg";
  if (name.endsWith(".mp4")) return "video/mp4";

  if (t) return t;
  return "audio/mpeg";
};

const fileToBase64Payload = (fileOrBlob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || "");
      const parts = result.split(",");
      resolve(parts[1] || "");
    };
    reader.onerror = () => reject(new Error("Failed to read audio"));
    reader.readAsDataURL(fileOrBlob);
  });

const MAX_AUDIO_DURATION_SECONDS = 90 * 60;

const decodeBase64ToUint8 = (base64: string) => {
  const binary = atob(base64);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buffer[i] = binary.charCodeAt(i);
  }
  return buffer;
};

const buildWavBlob = (pcmBytes: Uint8Array, sampleRate = 24000) => {
  const buffer = new ArrayBuffer(44 + pcmBytes.length);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, pcmBytes.length, true);
  new Uint8Array(buffer, 44).set(pcmBytes);

  return new Blob([buffer], { type: "audio/wav" });
};

const cleanupRecapUrl = (url: string | null) => {
  if (url) {
    URL.revokeObjectURL(url);
  }
};

const getMediaDuration = (file: File): Promise<number | null> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media =
      file.type.startsWith("video") || file.type.startsWith("audio")
        ? file.type.startsWith("video")
          ? document.createElement("video")
          : document.createElement("audio")
        : document.createElement("video");

    const cleanup = () => {
      URL.revokeObjectURL(url);
      media.src = "";
    };

    media.preload = "metadata";
    media.onloadedmetadata = () => {
      const duration = Number.isFinite(media.duration) ? media.duration : null;
      cleanup();
      resolve(duration);
    };
    media.onerror = () => {
      cleanup();
      resolve(null);
    };
    media.src = url;
  });

const normalizeTranscript = (raw: any): TranscriptSegment[] => {
  // Backend may return a string transcript or a richer structure.
  if (Array.isArray(raw)) {
    // Best effort: if it already looks like TranscriptSegment[], keep it.
    if (raw.length === 0) return [];
    const first = raw[0];
    if (first && typeof first === "object" && "text" in first && "startTime" in first) return raw as TranscriptSegment[];
    // Otherwise map strings/objects into segments.
    return raw.map((x: any, idx: number) => ({
      id: `seg-${Date.now()}-${idx}`,
      startTime: 0,
      endTime: 0,
      speaker: x?.speaker ?? "Speaker",
      text: typeof x === "string" ? x : String(x?.text ?? x ?? ""),
    }));
  }

  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return [];
    return [
      {
        id: `seg-${Date.now()}-0`,
        startTime: 0,
        endTime: 0,
        speaker: "Transcript",
        text,
      },
    ];
  }

  if (raw && typeof raw === "object") {
    const text = String(raw.text ?? raw.transcript ?? "").trim();
    if (!text) return [];
    return [
      {
        id: `seg-${Date.now()}-0`,
        startTime: 0,
        endTime: 0,
        speaker: String(raw.speaker ?? "Transcript"),
        text,
      },
    ];
  }

  return [];
};

const normalizeSummary = (raw: any): AISummary => {
  // If backend returns structured AISummary, keep it.
  if (
    raw &&
    typeof raw === "object" &&
    Array.isArray(raw.executiveSummary) &&
    Array.isArray(raw.actionItems) &&
    Array.isArray(raw.decisions) &&
    Array.isArray(raw.openQuestions)
  ) {
    return raw as AISummary;
  }

  // If backend returns a plain string summary, wrap it into AISummary
  const text =
    typeof raw === "string"
      ? raw
      : raw && typeof raw === "object"
      ? String(raw.summary ?? raw.text ?? "")
      : "";

  const cleaned = text.trim();
  return {
    executiveSummary: cleaned ? [cleaned] : ["Summary not available."],
    actionItems: [],
    decisions: [],
    openQuestions: [],
  };
};

const safeTitleFromTranscript = (segments: TranscriptSegment[], fallback: string) => {
  const firstText = segments?.[0]?.text?.trim();
  if (!firstText) return fallback;
  const cut = firstText.replace(/\s+/g, " ").slice(0, 42);
  return cut.length < firstText.length ? `${cut}…` : cut;
};

const AUTO_LISTEN_PROVIDERS = ["google", "microsoft"];


const SidebarItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  tooltip: string;
}> = ({ icon, label, active, onClick, tooltip }) => (
  <button
    onClick={onClick}
    className={`group relative w-full flex items-center gap-3 p-2.5 md:p-3 rounded-xl transition-all
      ${
        active
          ? "bg-indigo-600/15 text-indigo-400 border border-indigo-500/20 shadow-lg"
          : "text-slate-500 hover:text-slate-900 dark:text-slate-500 dark:hover:text-slate-100 hover:bg-slate-900/5 dark:hover:bg-white/5"
      }`}
  >
    <div className="transition-transform group-hover:scale-110 shrink-0">{icon}</div>
    <span className="font-black text-[9px] md:text-[10px] uppercase tracking-widest truncate">{label}</span>
    <Tooltip text={tooltip} />
  </button>
);

const Layout: React.FC<{
  children: React.ReactNode;
  view: ViewState;
  setView: (v: ViewState) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  toast: { message: string; type: "success" | "info" } | null;
}> = ({ children, view, setView, theme, setTheme, searchQuery, setSearchQuery, toast }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    // Tailwind dark mode uses `dark` class on <html>
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans overflow-hidden transition-colors duration-300">
      <aside
        className={`fixed inset-y-0 left-0 w-52 md:w-60 border-r border-slate-200 dark:border-white/5 bg-white/80 dark:bg-slate-900/40 backdrop-blur-3xl flex flex-col p-6 space-y-8 z-40 transition-transform lg:relative lg:translate-x-0
          ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div
          onClick={() => {
            setView("landing");
            setIsMobileMenuOpen(false);
          }}
          className="flex items-center gap-3 cursor-pointer mb-2"
        >
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-black text-lg shadow-2xl">
            S
          </div>
          <span className="font-black text-xl tracking-tighter">ScribeAI</span>
        </div>

        <nav className="flex-1 space-y-1">
          <SidebarItem
            icon={<FolderIcon className="w-4 h-4" />}
            label="Workspace"
            active={view === "dashboard"}
            onClick={() => {
              setView("dashboard");
              setIsMobileMenuOpen(false);
            }}
            tooltip="Manage your notes"
          />
          <SidebarItem
            icon={<MicIcon className="w-4 h-4" />}
            label="Live Studio"
            active={view === "recorder"}
            onClick={() => {
              setView("recorder");
              setIsMobileMenuOpen(false);
            }}
            tooltip="Start a recording"
          />
          <SidebarItem
            icon={<FileTextIcon className="w-4 h-4" />}
            label="Integrations"
            active={view === "integrations"}
            onClick={() => {
              setView("integrations");
              setIsMobileMenuOpen(false);
            }}
            tooltip="Connect tools"
          />
          <SidebarItem
            icon={<div className="w-4.5 h-4.5 flex items-center justify-center font-bold text-xs">📊</div>}
            label="Analytics"
            active={view === "analytics"}
            onClick={() => {
              setView("analytics");
              setIsMobileMenuOpen(false);
            }}
            tooltip="Insights"
          />
          <SidebarItem
            icon={<div className="w-4.5 h-4.5 flex items-center justify-center font-bold text-xs">💡</div>}
            label="Help Corner"
            active={view === "help"}
            onClick={() => {
              setView("help");
              setIsMobileMenuOpen(false);
            }}
            tooltip="Learn & support"
          />
        </nav>

        <SidebarItem
          icon={<SettingsIcon className="w-5 h-5" />}
          label="Neural Config"
          active={view === "settings"}
          onClick={() => {
            setView("settings");
            setIsMobileMenuOpen(false);
          }}
          tooltip="Preferences"
        />
      </aside>

      <main className="flex-1 flex flex-col min-w-0 z-10 overflow-hidden relative">
        <header className="h-16 md:h-20 flex items-center justify-between px-4 md:px-10 border-b border-slate-200 dark:border-white/5 backdrop-blur-md bg-white/60 dark:bg-transparent">
          <button
            onClick={() => setIsMobileMenuOpen((s) => !s)}
            className="lg:hidden p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
          >
            <div className="w-6 h-0.5 bg-current mb-1"></div>
            <div className="w-6 h-0.5 bg-current mb-1"></div>
            <div className="w-6 h-0.5 bg-current"></div>
          </button>

          <div className="flex-1 max-w-lg mx-4 relative hidden sm:block">
            <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-600" />
            <input
              type="text"
              placeholder="Scan neural cache..."
              className="w-full pl-11 pr-4 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest
                bg-slate-200/50 dark:bg-white/5 border border-slate-300 dark:border-white/5
                focus:border-indigo-500/50 outline-none transition-all placeholder-slate-400"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3 md:gap-6">
            <div className="group relative">
              <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className={`p-2.5 rounded-full border transition-all
                  ${
                    theme === "dark"
                      ? "bg-white/5 text-amber-400 border-white/5"
                      : "bg-indigo-600 text-white shadow-lg border-indigo-600"
                  }`}
              >
                {theme === "dark" ? "☀️" : "🌙"}
              </button>
              <Tooltip text={`Switch to ${theme === "dark" ? "Light" : "Dark"} mode`} position="bottom" />
            </div>

            <div className="group relative">
              <button
                onClick={() => setView("recorder")}
                className="bg-indigo-600 px-4 md:px-6 py-2.5 rounded-full font-black text-[10px] uppercase tracking-widest text-white shadow-lg hover:bg-indigo-700 transition-all"
              >
                Studio Live
              </button>
              <Tooltip text="Begin recording" position="bottom" />
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-10">{children}</div>
      </main>

      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 px-6 py-3 rounded-2xl bg-indigo-600 text-white font-black text-[10px] uppercase tracking-widest shadow-3xl z-50 flex items-center gap-4 border border-white/10">
          <div className="w-2 h-2 rounded-full bg-white animate-ping"></div>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
};

const NeuralVisualizer: React.FC<{ analyser: AnalyserNode | null }> = ({ analyser }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!analyser || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const baseRadius = 40;

      ctx.lineWidth = 2;
      ctx.lineCap = "round";

      for (let i = 0; i < 64; i++) {
        const angle = (i / 64) * Math.PI * 2;
        const frequencyValue = dataArray[i] / 255;
        const radius = baseRadius + frequencyValue * 70;

        // No custom palette: keep it simple
        ctx.strokeStyle = "rgba(99, 102, 241, 0.85)";

        ctx.beginPath();
        ctx.moveTo(centerX + Math.cos(angle) * baseRadius, centerY + Math.sin(angle) * baseRadius);
        ctx.lineTo(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
        ctx.stroke();
      }
    };

    draw();
  }, [analyser]);

  return <canvas ref={canvasRef} width={260} height={260} className="w-[180px] h-[180px] md:w-[260px] md:h-[260px]" />;
};

/** -----------------------------
 * App
 * ------------------------------ */

const HELP_ARTICLES: Record<string, { title: string; content: string }> = {
  "How does IndexedDB work?": {
    title: "Secure Local Storage (IndexedDB)",
    content:
      "ScribeAI stores meeting data locally in your browser using IndexedDB. That means your audio blobs and notes stay on-device by default, and you decide what gets synced.",
  },
  "Data encryption methods": {
    title: "Encryption",
    content:
      "Sensitive data can be kept local-first. If you later add cloud sync, encrypt at rest and in transit, and never ship API keys to the client.",
  },
  "Exporting my audio": {
    title: "Exporting Audio",
    content:
      "You can download your recordings from the meeting details view as .webm. Later you can add WAV export and JSON transcript export.",
  },
  "Tuning accent sensitivity": {
    title: "Accent Mode",
    content:
      "Switch accent mode to improve transcription results for common speech patterns (Standard / UK / Nigerian).",
  },
  "Nigerian Patois tips": {
    title: "Nigerian Mode Tips",
    content:
      "Speak clearly, avoid overlapping speakers if possible, and keep the mic close. Nigerian mode can help when slang/phrasing differs.",
  },
  "UK Dialect optimization": {
    title: "UK Mode Tips",
    content:
      "UK dialect mode helps with common UK pronunciations and spelling conventions. Keep background noise low for best results.",
  },
};

const MOCK_SEED: MeetingNote[] = [
  {
    id: "seed-0",
    title: "Neural Workspace Onboarding",
    date: new Date().toISOString(),
    duration: 320,
    type: MeetingType.STAND_UP,
    transcript: [
      {
        id: "t1",
        startTime: 0,
        endTime: 5,
        speaker: "System",
        text: "Initializing local neural thread. Privacy protocols engaged.",
      },
    ],
    summary: {
      executiveSummary: ["Workspace initialized successfully.", "Local encryption active."],
      actionItems: ["Record your first session"],
      decisions: ["Store data locally"],
      openQuestions: [],
    },
    tags: ["Onboarding"],
    accentPreference: "standard",
    chatHistory: [],
    syncStatus: "local",
  },
];

const MOCK_ENTERPRISE_FEED = [
  {
    id: "ent-1",
    title: "Global Architecture Sync",
    team: "Core Platform",
    duration: "1h 24m",
    date: "Today",
    status: "Analysis Finished",
    details:
      "Focused on scaling local-first sync protocols across European nodes. Decision reached on zero-trust metadata architecture.",
    syncStatus: "cloud",
  },
  {
    id: "ent-2",
    title: "Customer Experience Review",
    team: "Success Ops",
    duration: "45m",
    date: "Yesterday",
    status: "Action Items Sent",
    details: "Reviewed Q3 satisfaction metrics. Automated support pipelines are showing higher throughput.",
    syncStatus: "cloud",
  },
  {
    id: "ent-3",
    title: "Weekly Product Roadmap",
    team: "Design Hub",
    duration: "1h 05m",
    date: "2 days ago",
    status: "Summarized",
    details: "Product vision discussed. Emphasis on multi-modal interactions and clean UX.",
    syncStatus: "cloud",
  },
  {
    id: "ent-4",
    title: "Enterprise Security Audit",
    team: "InfoSec",
    duration: "2h 12m",
    date: "Oct 28",
    status: "Synced",
    details: "Bi-annual security sweep completed. No anomalies detected in encryption partitions.",
    syncStatus: "cloud",
  },
];

const App: React.FC = () => {
  const [view, setView] = useState<ViewState>("landing");

  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("scribeai_theme");
    return saved === "light" ? "light" : "dark";
  });

  useEffect(() => {
    localStorage.setItem("scribeai_theme", theme);
  }, [theme]);

  const [meetings, setMeetings] = useState<MeetingNote[]>(() => {
    const saved = localStorage.getItem("scribe_v3_meetings");
    if (!saved) return MOCK_SEED;
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) && parsed.length ? parsed : MOCK_SEED;
    } catch {
      return MOCK_SEED;
    }
  });

  useEffect(() => {
    localStorage.setItem("scribe_v3_meetings", JSON.stringify(meetings));
  }, [meetings]);

  const [workspaceTab, setWorkspaceTab] = useState<"personal" | "enterprise" | "cloud">("personal");
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [accentMode, setAccentMode] = useState<"standard" | "uk" | "nigerian">("standard");
  const [inputSource, setInputSource] = useState("Studio Mic");
  const [gateSensitivity, setGateSensitivity] = useState(75);

  const [toast, setToast] = useState<{ message: string; type: "success" | "info" } | null>(null);

  // Crash Recovery State
  const [unfinishedSessions, setUnfinishedSessions] = useState<string[]>([]);

  useEffect(() => {
    listUnfinishedSessions().then(setUnfinishedSessions);
  }, []);

  const recoverSession = async (sessionId: string) => {
    try {
      const chunks = await getAudioChunks(sessionId);
      if (!chunks || chunks.length === 0) {
        showToast("Session data corrupted or empty", "info");
        await clearAudioChunks(sessionId);
        setUnfinishedSessions(prev => prev.filter(id => id !== sessionId));
        return;
      }
      
      const blob = new Blob(chunks, { type: "audio/webm" });
      // Treat as uploaded file for processing
      await handleUploadAudio(new File([blob], `Recovered_${sessionId}.webm`, { type: "audio/webm" }));
      
      // Cleanup
      await clearAudioChunks(sessionId);
      setUnfinishedSessions(prev => prev.filter(id => id !== sessionId));
      showToast("Session recovered successfully", "success");
    } catch (err) {
      console.error(err);
      showToast("Recovery failed", "info");
    }
  };

  const { requestWakeLock, releaseWakeLock } = useWakeLock();

  // Modals & details
  const [activeArticle, setActiveArticle] = useState<{ title: string; content: string } | null>(null);
  const [enterpriseDetail, setEnterpriseDetail] = useState<{
    title: string;
    team: string;
    details: string;
    syncStatus?: string;
  } | null>(null);

  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [supportChat, setSupportChat] = useState<ChatMessage[]>([
    { role: "model", text: "Protocol established. ScribeAI Cloud Sync is active. How can I help?" },
  ]);
  const [supportInput, setSupportInput] = useState("");

  const [displayStream, setDisplayStream] = useState<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const [shareMeetingAudio, setShareMeetingAudio] = useState(false);

  const setDisplayStreamState = useCallback((stream: MediaStream | null) => {
    setDisplayStream(stream);
    displayStreamRef.current = stream;
  }, []);

  const clearDisplayStream = useCallback(() => {
    const activeStream = displayStreamRef.current;
    if (activeStream) {
      activeStream.getTracks().forEach((track) => track.stop());
      setDisplayStream(null);
      displayStreamRef.current = null;
    }
    setShareMeetingAudio(false);
  }, []);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [recapAudioUrl, setRecapAudioUrl] = useState<string | null>(null);
  const [recapLoading, setRecapLoading] = useState(false);
  const [isRecapPlaying, setIsRecapPlaying] = useState(false);
  const [recapDuration, setRecapDuration] = useState(0);

  const revokeRecapUrl = () => {
    if (recapAudioUrl) {
      cleanupRecapUrl(recapAudioUrl);
    }
  };

  const resetRecapState = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.src = "";
    }
    revokeRecapUrl();
    setRecapAudioUrl(null);
    setRecapDuration(0);
    setIsRecapPlaying(false);
  };

  const [integrations, setIntegrations] = useState<{ id: string; name: string; icon: string; connected: boolean }[]>([
    { id: "notion", name: "Notion", icon: "📓", connected: false },
    { id: "slack", name: "Slack", icon: "💬", connected: false },
    { id: "hubspot", name: "HubSpot", icon: "📈", connected: false },
    { id: "zoom", name: "Zoom Sync", icon: "📹", connected: false },
  ]);

  const [calendarConnected, setCalendarConnected] = useState<{ google: boolean; microsoft: boolean }>({
    google: false,
    microsoft: false,
  });
  const [analyticsMetrics, setAnalyticsMetrics] = useState<AnalyticsPayload | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  const baseApiUrl = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '') || '';
  const buildApiUrl = useCallback((path: string) => `${baseApiUrl}${path}`, [baseApiUrl]);

  /** -----------------------------
   * Auto-listen (MVP)
   * - Shows a banner shortly before a scheduled event
   * - User still must click "Start listening" (browser mic permission)
   * ------------------------------ */

  const [autoListenEnabled, setAutoListenEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem("scribe_auto_listen_enabled");
    return saved === "1";
  });

  const [autoListenLeadMinutes, setAutoListenLeadMinutes] = useState<number>(() => {
    const saved = localStorage.getItem("scribe_auto_listen_lead_minutes");
    const n = saved ? Number(saved) : 2;
    return Number.isFinite(n) && n >= 0 ? n : 2;
  });

  const [upcomingEvents, setUpcomingEvents] = useState<CalendarEvent[]>([]);
  const [dismissedEventIds, setDismissedEventIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("scribe_auto_listen_dismissed");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [autoListenBannerId, setAutoListenBannerId] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const showToast = useCallback((message: string, type: "success" | "info" = "success") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  // Persist auto-listen prefs
  useEffect(() => {
    localStorage.setItem("scribe_auto_listen_enabled", autoListenEnabled ? "1" : "0");
  }, [autoListenEnabled]);

  useEffect(() => {
    localStorage.setItem("scribe_auto_listen_lead_minutes", String(autoListenLeadMinutes));
  }, [autoListenLeadMinutes]);

  useEffect(() => {
    localStorage.setItem("scribe_auto_listen_dismissed", JSON.stringify(dismissedEventIds));
  }, [dismissedEventIds]);

  const loadUpcomingEvents = useCallback(async () => {
    try {
      const res = await fetch(buildApiUrl("/api/calendar/upcoming"), {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) return;
      const data = await res.json();
      const events = Array.isArray(data?.events) ? data.events : Array.isArray(data) ? data : [];
      setUpcomingEvents(events);

      const connected = data?.connected || {};
      setCalendarConnected({
        google: Boolean(connected.google),
        microsoft: Boolean(connected.microsoft),
      });

      const autoListen = data?.autoListen;
      if (autoListen) {
        if (typeof autoListen.enabled === "boolean") setAutoListenEnabled(autoListen.enabled);
        if (typeof autoListen.leadMinutes === "number") setAutoListenLeadMinutes(autoListen.leadMinutes);
      }
    } catch (err) {
      console.error("UPCOMING EVENTS FETCH ERROR:", err);
    }
  }, [buildApiUrl]);

  // Poll upcoming events when enabled
  useEffect(() => {
    if (!autoListenEnabled) return;
    loadUpcomingEvents();
    const t = window.setInterval(loadUpcomingEvents, 30_000);
    return () => window.clearInterval(t);
  }, [autoListenEnabled, loadUpcomingEvents]);

  useEffect(() => {
    return () => {
      resetRecapState();
    };
  }, []);

  useEffect(() => {
    return () => {
      clearDisplayStream();
    };
  }, [clearDisplayStream]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setIsRecapPlaying(true);
    const onPause = () => setIsRecapPlaying(false);
    const onEnded = () => setIsRecapPlaying(false);
    const onLoaded = () => setRecapDuration(audio.duration || 0);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadeddata", onLoaded);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadeddata", onLoaded);
    };
  }, [recapAudioUrl]);

  useEffect(() => {
    void loadUpcomingEvents();
  }, [loadUpcomingEvents]);

  useEffect(() => {
    const controller = new AbortController();
    const syncSettings = async () => {
      try {
        await fetch(buildApiUrl("/api/auto-listen/settings"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled: autoListenEnabled,
            leadMinutes: autoListenLeadMinutes,
            providers: AUTO_LISTEN_PROVIDERS,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        console.error("AUTO-LISTEN SYNC ERROR:", err);
      }
    };

    void syncSettings();
    return () => controller.abort();
  }, [autoListenEnabled, autoListenLeadMinutes, buildApiUrl]);

  const fetchAnalytics = useCallback(async () => {
    setAnalyticsError(null);
    setAnalyticsLoading(true);
    try {
      const res = await fetch(buildApiUrl("/api/analytics"));
      if (!res.ok) throw new Error("Failed to load analytics");
      const data = await res.json();
      setAnalyticsMetrics(data);
    } catch (err) {
      console.error("ANALYTICS FETCH ERROR:", err);
      setAnalyticsError(String(err));
    } finally {
      setAnalyticsLoading(false);
    }
  }, [buildApiUrl]);

  useEffect(() => {
    if (view !== "analytics") return;
    void fetchAnalytics();
  }, [view, fetchAnalytics]);

  const startOAuth = useCallback(
    async (provider: "google" | "microsoft") => {
      try {
        const res = await fetch(buildApiUrl(`/api/auth/${provider}/start`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        if (!res.ok) throw new Error("OAuth init failed");
        const data = await res.json();
        if (!data?.url) throw new Error("No redirect URL");

        window.open(data.url, "_blank", "noopener,noreferrer");
        showToast(`${provider === "google" ? "Google" : "Microsoft"} authentication opened`, "info");
      } catch (err) {
        console.error("OAuth start failed:", err);
        showToast("Could not start calendar connection", "info");
      }
    },
    [buildApiUrl, showToast]
  );

  const nextAutoListenEvent = useMemo(() => {
    if (!autoListenEnabled) return null;
    const now = Date.now();
    const candidates = (upcomingEvents || [])
      .filter((e) => e && !dismissedEventIds.includes(e.id))
      .map((e) => ({ e, start: new Date(e.startTime).getTime() }))
      .filter((x) => Number.isFinite(x.start) && x.start >= now - 5 * 60_000) // keep a short grace window
      .sort((a, b) => a.start - b.start);

    return candidates.length ? candidates[0].e : null;
  }, [autoListenEnabled, upcomingEvents, dismissedEventIds]);

  // Decide when to surface the banner
  useEffect(() => {
    if (!autoListenEnabled) {
      setAutoListenBannerId(null);
      return;
    }
    if (!nextAutoListenEvent) {
      setAutoListenBannerId(null);
      return;
    }
    const startMs = new Date(nextAutoListenEvent.startTime).getTime();
    if (!Number.isFinite(startMs)) {
      setAutoListenBannerId(null);
      return;
    }

    const tick = () => {
      const now = Date.now();
      const diff = startMs - now;
      const leadMs = Math.max(0, autoListenLeadMinutes) * 60_000;

      // Show banner when within lead window up to meeting start
      if (diff <= leadMs && diff >= -30_000 && !isRecording && !isProcessing) {
        setAutoListenBannerId(nextAutoListenEvent.id);
      }

      // Hide if too early or long after start
      if (diff > leadMs || diff < -2 * 60_000) {
        setAutoListenBannerId(null);
      }
    };

    tick();
    const t = window.setInterval(tick, 1_000);
    return () => window.clearInterval(t);
  }, [autoListenEnabled, nextAutoListenEvent, autoListenLeadMinutes, isRecording, isProcessing]);

  const selectedMeeting = useMemo(
    () => meetings.find((m) => m.id === selectedMeetingId) || null,
    [meetings, selectedMeetingId]
  );

  const filteredMeetings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return meetings;
    return meetings.filter((m) => (m.title || "").toLowerCase().includes(q));
  }, [meetings, searchQuery]);

  const personalMeetings = useMemo(() => filteredMeetings.filter((m) => m.syncStatus !== "cloud"), [filteredMeetings]);
  const cloudMeetings = useMemo(() => filteredMeetings.filter((m) => m.syncStatus === "cloud"), [filteredMeetings]);

  const syncToCloud = async (meetingId: string) => {
    setMeetings((prev) => prev.map((m) => (m.id === meetingId ? { ...m, syncStatus: "syncing" } : m)));
    showToast("Pushing to Neural Cloud...", "info");
    await new Promise((r) => setTimeout(r, 1500));
    setMeetings((prev) => prev.map((m) => (m.id === meetingId ? { ...m, syncStatus: "cloud" } : m)));
    showToast("Successfully Synced to Cloud Backup");
  };

  const downloadAudio = async (meeting: MeetingNote) => {
    if (!meeting.audioStorageKey) {
      showToast("No audio found in local cache", "info");
      return;
    }
    try {
      const blob = await getAudioBlob(meeting.audioStorageKey);
      if (!blob) throw new Error("Blob missing");

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(meeting.title || "scribeai").replace(/\s+/g, "_")}_audio.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast("Audio download started");
    } catch {
      showToast("Download failed", "info");
    }
  };

  const handleSupportSend = async () => {
    if (!supportInput.trim()) return;

    const userMessage = supportInput.trim();
    const nextHistory = [...supportChat, { role: "user" as const, text: userMessage }];

    setSupportChat(nextHistory);
    setSupportInput("");

    try {
      const answer = await askSupport(userMessage, nextHistory);
      setSupportChat((prev) => [...prev, { role: "model", text: answer || "No response." }]);
    } catch {
      setSupportChat((prev) => [...prev, { role: "model", text: "Neural link timeout." }]);
    }
  };

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const startRecording = useCallback(async () => {
    try {
      // 1. Get Mic Permission FIRST (Critical)
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // 2. Request Wake Lock (Non-blocking)
      try {
         // @ts-ignore
         if ('wakeLock' in navigator) {
             const lock = await navigator.wakeLock.request('screen');
             console.log("Wake Lock acquired");
         }
      } catch (e) {
         console.warn("Wake lock failed (ignoring):", e);
      }

      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;

      // 3. Create the Destination (The single mixed stream we will record)
      const destination = ctx.createMediaStreamDestination();

      // 4. Add Microphone to Mix
      const micSource = ctx.createMediaStreamSource(micStream);
      micSource.connect(destination);

      // 5. Add System Audio to Mix (if shared)
      if (shareMeetingAudio && displayStream) {
        try {
          if (displayStream.getAudioTracks().length > 0) {
             const systemSource = ctx.createMediaStreamSource(displayStream);
             systemSource.connect(destination); // To Recorder
             // systemSource.connect(analyser); // Optional: if you want to visualize system audio too
          }
        } catch (err) {
          console.warn("Could not mix system audio", err);
        }
      }

      // --- START BACKGROUND HACK (FAIL-SAFE) ---
      try {
        const dummyOsc = ctx.createOscillator();
        const dummyGain = ctx.createGain();
        dummyGain.gain.value = 0.001; 
        dummyOsc.connect(dummyGain);
        dummyGain.connect(ctx.destination); 
        dummyOsc.start();
        (ctx as any)._dummyOsc = dummyOsc;
      } catch (err) {
        console.warn("Background audio hack failed (ignoring)", err);
      }
      // --- END BACKGROUND HACK ---

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      
      // FIX: Connect SOURCE to Analyser, NOT the Destination node
      micSource.connect(analyser); 

      const recordingStream = destination.stream;
      const mediaRecorder = new MediaRecorder(recordingStream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      // AUTO-SAVE: Generate a Session ID
      const newSessionId = `session_${Date.now()}`;
      setCurrentSessionId(newSessionId);

      mediaRecorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0) {
           audioChunksRef.current.push(e.data);
           try {
             await appendAudioChunk(newSessionId, e.data);
           } catch (err) {
             console.error("Auto-save failed", err);
           }
        }
      };

      mediaRecorder.onstart = () => {
        setRecordingTime(0);
        setIsRecording(true);
      };

      mediaRecorder.start(5000); 
      showToast("Neural Capture (Auto-Save Active)", "info");
    } catch (err: any) {
      console.error("Recording Start Error:", err);
      alert(`Could not start recording: ${err.message || err.name || "Unknown Error"}`);
    }
  }, [shareMeetingAudio, displayStream, showToast]);

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    setIsProcessing(true);

    recorder.onstop = async () => {
      try {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const storageKey = `audio_${Date.now()}`;
        await saveAudioBlob(storageKey, audioBlob);

        // AUTO-SAVE CLEANUP: If successful, clear temp chunks
        if (currentSessionId) {
          await clearAudioChunks(currentSessionId);
          setCurrentSessionId(null);
        }

        const base64Audio = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = String(reader.result || "");
            const parts = result.split(",");
            resolve(parts[1] || "");
          };
          reader.onerror = () => reject(new Error("Failed to read audio"));
          reader.readAsDataURL(audioBlob);
        });

        showToast("AI Processing Transcript...", "info");

        // 1) Transcribe
        const rawTranscript = await transcribeAudio(base64Audio, "audio/webm", accentMode);

        // Store transcript in UI-friendly segments
        const transcriptSegments = normalizeTranscript(rawTranscript);

        // 2) Analyze (send best payload to backend; your backend currently expects `transcript` any)
        // Prefer sending a string if available, else join segments
        const transcriptForBackend =
          typeof rawTranscript === "string"
            ? rawTranscript
            : transcriptSegments.map((s) => s.text).join("\n");

        const rawSummary = await analyzeMeeting(transcriptForBackend, "meeting", accentMode);
        const summary = normalizeSummary(rawSummary);

        // 3) Create meeting note matching your types.ts strictly
        const id = `m_${Date.now()}`;
        const createdAtIso = new Date().toISOString();
        const title = safeTitleFromTranscript(transcriptSegments, "New Recording");

        const newMeeting: MeetingNote = {
          id,
          title,
          date: createdAtIso,
          duration: recordingTime,
          type: MeetingType.OTHER,
          transcript: transcriptSegments,
          summary,
          tags: [],
          accentPreference: accentMode,
          audioStorageKey: storageKey,
          chatHistory: [],
          syncStatus: "local",
          inputSource,
        };

        setMeetings((prev) => [newMeeting, ...prev]);
        setSelectedMeetingId(id);
        setView("details");

        showToast("Session processed", "success");
      } catch {
        showToast("AI synthesis interrupted", "info");
      } finally {
        setIsProcessing(false);
        setIsRecording(false);

        // CLEANUP: Release Wake Lock and Stop Oscillator
        try {
          await releaseWakeLock();
          if (audioContextRef.current && (audioContextRef.current as any)._dummyOsc) {
            try { (audioContextRef.current as any)._dummyOsc.stop(); } catch {}
          }
          audioContextRef.current?.close();
        } catch {
          // ignore
        }
        audioContextRef.current = null;
      }
    };

    recorder.stop();
    setIsRecording(false);
  }, [accentMode, inputSource, recordingTime]);

  const handleUploadAudio = useCallback(async (file: File) => {
    if (isProcessing || isRecording) return;

    try {
      setIsProcessing(true);

      if (file.type.startsWith("video")) {
        const duration = await getMediaDuration(file);
        if (duration !== null) {
          if (duration > MAX_AUDIO_DURATION_SECONDS) {
            showToast("Audio longer than 90 minutes is not recommended; please trim before upload.", "info");
          } else {
            showToast("Video validated; running transcription and analysis.", "info");
          }
        } else {
          showToast("Could not determine video duration; proceeding with processing.", "info");
        }
      }

      const mimeType = normalizeMimeType(file);
      const storageKey = `upload_${Date.now()}_${file.name || 'audio'}`;

      // store original blob so you can replay later (same storage pipeline as recordings)
      try {
        await saveAudioBlob(storageKey, file);
      } catch {
        // storage failure shouldn't block analysis
      }

      const base64Audio = await fileToBase64Payload(file);

      showToast('AI Processing Transcript...', 'info');

      // 1) Transcribe
      const rawTranscript = await transcribeAudio(base64Audio, mimeType, accentMode);
      const transcriptSegments = normalizeTranscript(rawTranscript);

      // 2) Analyze
      const transcriptForBackend =
        typeof rawTranscript === 'string'
          ? rawTranscript
          : transcriptSegments.map((s) => s.text).join('\n');

      const rawSummary = await analyzeMeeting(transcriptForBackend, 'meeting', accentMode);
      const summary = normalizeSummary(rawSummary);

      // 3) Create meeting note
      const id = `m_${Date.now()}`;
      const createdAtIso = new Date().toISOString();
      const titleFromName = (file.name || 'Uploaded Audio').replace(/\.[^/.]+$/, '');
      const title = titleFromName || safeTitleFromTranscript(transcriptSegments, 'Uploaded Audio');

      const newMeeting: MeetingNote = {
        id,
        title,
        date: createdAtIso,
        duration: 0,
        type: MeetingType.OTHER,
        transcript: transcriptSegments,
        summary,
        tags: [],
        accentPreference: accentMode,
        audioStorageKey: storageKey,
        chatHistory: [],
        syncStatus: 'local',
        inputSource: 'Uploaded File',
      };

      setMeetings((prev) => [newMeeting, ...prev]);
      setSelectedMeetingId(id);
      setView('details');

      showToast('Upload processed', 'success');
	    } catch (err: any) {
	      console.error(err);
	      const msg = String(err?.message || err || 'Upload failed');
	      showToast(`Upload failed: ${msg}`, 'info');
    } finally {
      setIsProcessing(false);
    }
  }, [accentMode, isProcessing, isRecording]);

  const handleShareMeetingAudio = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
      });
      stream.getVideoTracks().forEach((track) => track.stop());
      setDisplayStreamState(stream);
      setShareMeetingAudio(true);
      showToast("Meeting audio shared", "info");
    } catch {
      showToast("Meeting audio share cancelled", "info");
    }
  }, [showToast]);

  const playRecap = useCallback(async () => {
    if (!selectedMeeting?.summary) {
      showToast("No summary to recap", "info");
      return;
    }
    setRecapLoading(true);
    try {
      const audioData = await generateAudioRecap(selectedMeeting.summary);
      if (!audioData) {
        showToast("No audio returned", "info");
        return;
      }
      resetRecapState();
      const pcmBytes = decodeBase64ToUint8(audioData);
      const wavBlob = buildWavBlob(pcmBytes, 24000);
      const url = URL.createObjectURL(wavBlob);
      setRecapAudioUrl(url);
      const audio = audioRef.current;
      if (audio) {
        audio.src = url;
        await audio.play();
      }
      showToast("Playing Neural Brief");
    } catch (err) {
      console.error("Playback error", err);
      showToast("Audio recap failed", "info");
    } finally {
      setRecapLoading(false);
    }
  }, [selectedMeeting, showToast]);

  const toggleRecapPlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
    } else {
      audio.pause();
    }
  }, []);

  const stopRecapPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setIsRecapPlaying(false);
  }, []);

  const seekRecap = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + delta));
  }, []);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => setRecordingTime((t) => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  const layoutProps = { view, setView, theme, setTheme, searchQuery, setSearchQuery, toast };

  const calendarProviders = [
    {
      id: "google",
      name: "Google Calendar",
      icon: "📅",
      description: "Sync Google Meet and Calendar events so Auto-Listen can arm ahead of time.",
      connected: calendarConnected.google,
    },
    {
      id: "microsoft",
      name: "Microsoft 365 Calendar",
      icon: "📆",
      description: "Harvest Teams and Outlook invites for instant reminders.",
      connected: calendarConnected.microsoft,
    },
  ];

  const analyticsMetricList = [
    { key: "transcribe", label: "Transcriptions", accent: "from-indigo-500/80 to-violet-500/60" },
    { key: "analyze", label: "Summaries", accent: "from-emerald-500/80 to-cyan-500/60" },
    { key: "ask", label: "Q&A", accent: "from-fuchsia-500/80 to-pink-500/60" },
    { key: "draftEmail", label: "Email drafts", accent: "from-orange-500/80 to-amber-500/60" },
    { key: "audioRecap", label: "Audio recaps", accent: "from-teal-500/80 to-sky-500/60" },
    { key: "support", label: "Support", accent: "from-rose-500/80 to-red-500/60" },
    { key: "calendarUpcoming", label: "Calendar syncs", accent: "from-cyan-500/80 to-blue-500/60" },
    { key: "autoListenSettings", label: "Auto listen saves", accent: "from-lime-500/80 to-emerald-500/60" },
  ];

  /** -----------------------------
   * Views
   * ------------------------------ */

  if (view === "landing") {
    return (
      <div
        className={`min-h-screen ${
          theme === "dark" ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-900"
        } relative flex flex-col items-center justify-center p-6 text-center transition-colors duration-300`}
      >
        <div className="relative z-10 max-w-5xl space-y-12">
          <header className="space-y-10">
            <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center text-white text-4xl font-black shadow-2xl mx-auto">
              S
            </div>
            <h1 className="text-4xl sm:text-6xl md:text-7xl font-black tracking-tighter leading-[0.95]">
              ScribeAI<span className="text-indigo-500">.</span>
            </h1>
            <p className="text-base sm:text-lg md:text-xl font-bold text-slate-400 max-w-2xl mx-auto px-2 sm:px-4 leading-relaxed">
              Local-first recording + server-side AI processing. Responsive workspace built for mobile, tablet, and desktop.
            </p>
            
            {/* RECOVERY BANNER */}
            {unfinishedSessions.length > 0 && (
              <div className="max-w-md mx-auto bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl flex items-center justify-between gap-4">
                <div className="text-left">
                  <div className="text-amber-500 font-black text-xs uppercase tracking-widest">Crash Detected</div>
                  <div className="text-slate-300 text-xs mt-1">Found {unfinishedSessions.length} unfinished recording(s).</div>
                </div>
                <button 
                  onClick={() => recoverSession(unfinishedSessions[0])}
                  className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wide transition"
                >
                  Recover
                </button>
              </div>
            )}
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={() => setView("dashboard")}
                className="bg-indigo-600 px-6 sm:px-10 py-3.5 rounded-full font-black text-sm sm:text-base text-white shadow-lg hover:bg-indigo-700 transition active:scale-95"
              >
                Open Hub
              </button>
              <button
                onClick={() => setView("help")}
                className="px-6 sm:px-10 py-3.5 rounded-full font-black text-sm sm:text-base
                  bg-slate-900/5 text-slate-900 border border-slate-900/10
                  dark:bg-white/5 dark:text-white dark:border-white/10
                  hover:bg-slate-900/10 dark:hover:bg-white/10 transition active:scale-95"
              >
                Documentation
              </button>
            </div>
          </header>
        </div>
      </div>
    );
  }

  return (
    <Layout {...layoutProps}>
      {/* AUTO-LISTEN BANNER (MVP) */}
      {autoListenEnabled && autoListenBannerId && nextAutoListenEvent && nextAutoListenEvent.id === autoListenBannerId && (
        <div className="max-w-7xl mx-auto mb-6">
          <div className="relative overflow-hidden rounded-[2rem] border border-indigo-500/30 bg-indigo-600/10 backdrop-blur-xl p-4 sm:p-5 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                  <span className="text-[10px] font-black uppercase tracking-[0.25em] text-indigo-400">
                    Auto-listen armed
                  </span>
                </div>
                <div className="mt-2 font-black text-white text-base sm:text-lg leading-tight">
                  {nextAutoListenEvent.title || "Upcoming meeting"}
                </div>
                <div className="mt-1 text-[11px] font-bold text-slate-300">
                  Starts at {formatRecordedAt(nextAutoListenEvent.startTime)}
                </div>
              </div>

              <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  setView("recorder");
                  showToast("Ready to capture. Tap mic to allow access.", "info");
                  // Browser mic access still requires user gesture.
                  // We can safely start recording here because this click IS a gesture.
                  try {
                    await startRecording();
                  } catch {
                    // If permissions block, user can tap the mic button.
                  }
                }}
                disabled={isRecording || isProcessing}
                className="px-5 py-3 rounded-2xl bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-indigo-700 transition disabled:opacity-50"
              >
                Start Listening
              </button>
              {nextAutoListenEvent.joinUrl && (
                <a
                  href={nextAutoListenEvent.joinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-3 rounded-2xl border border-white/20 bg-white/90 text-indigo-600 text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-white transition"
                >
                  Join Meeting
                </a>
              )}
              <button
                onClick={() => {
                  setDismissedEventIds((prev) => Array.from(new Set([...prev, autoListenBannerId])));
                  setAutoListenBannerId(null);
                }}
                  className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white/80 text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DASHBOARD */}
      {view === "dashboard" && (
        <div className="max-w-7xl mx-auto space-y-10">
          <header className="flex flex-col sm:flex-row justify-between items-center sm:items-end gap-6">
            <div className="space-y-2 text-center sm:text-left">
              <h1 className="text-4xl sm:text-5xl md:text-7xl font-black tracking-tighter uppercase">Workspace.</h1>
              <div className="flex items-center justify-center sm:justify-start gap-3 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></div>
                <span>Local Cache Active</span>
              </div>
            </div>

            <div className="group relative w-full sm:w-auto">
              <button
                onClick={() => setView("recorder")}
                className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-3 w-full"
              >
                <MicIcon className="w-4 h-4" />
                <span>Capture Insight</span>
              </button>
              <Tooltip text="Record a new session" />
            </div>
          </header>

          <nav className="flex space-x-8 border-b border-slate-200 dark:border-white/5 overflow-x-auto pb-1">
            <button
              onClick={() => setWorkspaceTab("personal")}
              className={`pb-4 text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                workspaceTab === "personal"
                  ? "text-indigo-500 border-b-2 border-indigo-500"
                  : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              Personal Cache
            </button>
            <button
              onClick={() => setWorkspaceTab("cloud")}
              className={`pb-4 text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                workspaceTab === "cloud"
                  ? "text-indigo-500 border-b-2 border-indigo-500"
                  : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              Neural Cloud
            </button>
            <button
              onClick={() => setWorkspaceTab("enterprise")}
              className={`pb-4 text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                workspaceTab === "enterprise"
                  ? "text-indigo-500 border-b-2 border-indigo-500"
                  : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              Enterprise Feed
            </button>
          </nav>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {workspaceTab === "personal" &&
              (personalMeetings.length ? (
                personalMeetings.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => {
                      setSelectedMeetingId(m.id);
                      setView("details");
                    }}
                    className="p-7 rounded-[2.5rem] bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 hover:border-indigo-500/50 hover:bg-slate-50 dark:hover:bg-white/[0.06] transition-all cursor-pointer shadow-xl relative group"
                  >
                    <div className="flex justify-between items-start mb-5">
                      <span className="px-3 py-1.5 bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 rounded-xl text-[8px] font-black uppercase tracking-widest">
                        {m.type}
                      </span>
                      <span className="text-slate-500 text-[9px] font-black uppercase tracking-widest">LOCAL</span>
                    </div>

                    <h3 className="text-lg md:text-xl font-black line-clamp-2 leading-tight">{m.title}</h3>

                    <div className="mt-3 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                      <span>{formatRecordedAt(m.date)}</span>
                      <span>{formatDurationHMS(m.duration)}</span>
                    </div>

                    <div className="mt-7 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-500 border-t border-slate-200 dark:border-white/5 pt-5">
                      <div className="flex items-center">
                        <PlayIcon className="mr-3 w-4 h-4 text-indigo-600" />
                        {formatTime(m.duration)}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          syncToCloud(m.id);
                        }}
                        className="p-2 hover:text-indigo-400 flex items-center gap-2"
                      >
                        {m.syncStatus === "syncing" ? (
                          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <span className="opacity-60 hover:opacity-100 transition-opacity">☁️ Sync</span>
                        )}
                      </button>
                    </div>

                    <Tooltip text="Open meeting" />
                  </div>
                ))
              ) : (
                <div className="col-span-full py-16 text-center opacity-50">
                  <p className="font-black uppercase tracking-[0.3em] text-xs">No local threads found.</p>
                </div>
              ))}

            {workspaceTab === "cloud" &&
              (cloudMeetings.length ? (
                cloudMeetings.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => {
                      setSelectedMeetingId(m.id);
                      setView("details");
                    }}
                    className="p-7 rounded-[2.5rem] bg-indigo-600/5 border border-indigo-500/30 hover:bg-indigo-600/10 transition-all cursor-pointer shadow-2xl relative group"
                  >
                    <div className="flex justify-between items-start mb-5">
                      <span className="px-3 py-1.5 bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 rounded-xl text-[8px] font-black uppercase tracking-widest">
                        {m.type}
                      </span>
                      <span className="text-indigo-500 dark:text-indigo-400 text-[9px] font-black uppercase tracking-widest">
                        CLOUD
                      </span>
                    </div>

                    <h3 className="text-lg md:text-xl font-black text-indigo-900 dark:text-indigo-100 line-clamp-2 leading-tight">
                      {m.title}
                    </h3>

                    <div className="mt-3 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-indigo-400/70">
                      <span>{formatRecordedAt(m.date)}</span>
                      <span>{formatDurationHMS(m.duration)}</span>
                    </div>

                    <div className="mt-7 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-indigo-400/70 border-t border-slate-200 dark:border-white/5 pt-5">
                      <div className="flex items-center">
                        <PlayIcon className="mr-3 w-4 h-4 text-indigo-600" />
                        {formatTime(m.duration)}
                      </div>
                      <span className="flex items-center gap-2">
                        <span>☁️</span> <span>Verified</span>
                      </span>
                    </div>

                    <Tooltip text="Open cloud meeting" />
                  </div>
                ))
              ) : (
                <div className="col-span-full py-16 text-center opacity-50">
                  <p className="font-black uppercase tracking-[0.3em] text-xs">Neural Cloud is empty.</p>
                </div>
              ))}

            {workspaceTab === "enterprise" &&
              MOCK_ENTERPRISE_FEED.map((feed) => (
                <div
                  key={feed.id}
                  onClick={() => setEnterpriseDetail(feed)}
                  className="p-7 rounded-[2.5rem] bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 flex flex-col justify-between h-60 transition-all hover:bg-slate-50 dark:hover:bg-white/[0.05] cursor-pointer group shadow-lg relative"
                >
                  <div className="space-y-3">
                    <div className="flex justify-between items-start">
                      <span className="px-3 py-1 bg-slate-200 dark:bg-white/5 text-slate-600 dark:text-slate-400 rounded-lg text-[9px] font-black uppercase tracking-widest">
                        {feed.team}
                      </span>
                      <span className="text-slate-400 dark:text-slate-600 text-[9px] font-black uppercase tracking-widest">
                        {feed.date}
                      </span>
                    </div>
                    <h3 className="text-lg md:text-xl font-black group-hover:text-indigo-500 transition-colors leading-tight">
                      {feed.title}
                    </h3>
                  </div>
                  <div className="flex items-center text-[10px] font-black uppercase tracking-widest text-indigo-500/80">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mr-3 animate-pulse"></div>
                    {feed.status}
                  </div>
                  <Tooltip text="View details" />
                </div>
              ))}
          </div>
        </div>
      )}

      {/* RECORDER */}
      {view === "recorder" && (
        <div className="max-w-4xl mx-auto h-full flex flex-col items-center justify-center space-y-10">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-indigo-600/10 text-indigo-400 border border-indigo-500/20">
              <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">Neural Engine Ready</span>
            </div>
            <h1 className="text-5xl md:text-[92px] font-black tracking-tighter leading-none">
              {isRecording ? "Listening." : isProcessing ? "Syncing." : "Studio."}
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm font-bold">
              {isRecording ? `Recording • ${formatTime(recordingTime)}` : isProcessing ? "Processing…" : "Tap to start"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => (shareMeetingAudio ? clearDisplayStream() : void handleShareMeetingAudio())}
              className={`px-5 py-3 rounded-2xl border font-black text-[10px] uppercase tracking-widest transition ${
                shareMeetingAudio
                  ? "bg-white text-indigo-600 border-indigo-600"
                  : "bg-transparent text-white border-white/50 hover:border-white"
              }`}
            >
              {shareMeetingAudio ? "Stop sharing meeting" : "Share meeting audio"}
            </button>
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">
              {shareMeetingAudio ? "Remote audio captured" : "Only mic audio recorded"}
            </span>
          </div>
{/* RECORD + UPLOAD (SIDE BY SIDE) */}
<div className="relative flex items-center justify-center gap-5">
  {/* MAIN RECORD CONTROL */}
  <div className="relative group">
    {isRecording ? (
      <div className="relative flex items-center justify-center">
        <NeuralVisualizer analyser={analyserRef.current} />
        <button
          onClick={stopRecording}
          className="absolute inset-0 m-auto w-28 h-28 bg-red-600 rounded-[2.5rem] flex items-center justify-center text-white shadow-[0_0_80px_rgba(220,38,38,0.5)] transform hover:scale-110 transition-transform"
        >
          <StopIcon className="w-10 h-10" />
        </button>
      </div>
    ) : (
      <button
        onClick={startRecording}
        disabled={isProcessing}
        className={`w-56 h-56 ${
          isProcessing ? "bg-indigo-900 animate-pulse" : "bg-indigo-600"
        } rounded-[2.5rem] flex items-center justify-center text-white shadow-[0_0_100px_rgba(79,70,229,0.35)] transform hover:scale-105 active:scale-95 transition-all`}
      >
        <MicIcon className="w-20 h-20 group-hover:rotate-12 transition-transform" />
      </button>
    )}

    <Tooltip text={isRecording ? "Stop Capture" : "Start Capture"} />
  </div>

	  {/* UPLOAD CONTROL (only when not recording) */}
	  {!isRecording && (
	    <div className="relative group">
	      <label
	        className={`cursor-pointer select-none flex items-center gap-2 px-4 h-14 rounded-2xl
	          bg-white/[0.04] border border-white/10 text-white/80 backdrop-blur-md
	          ${isProcessing ? "opacity-40 pointer-events-none" : "hover:bg-white/[0.07] hover:text-white hover:scale-[1.02]"}
	          transition`}
	        title="Upload an audio/video file to transcribe + analyze"
	      >
	        <FolderIcon className="w-5 h-5" />
	        <span className="text-[10px] font-black uppercase tracking-widest">Upload</span>
	        <input
	          type="file"
	          accept="audio/*,video/*"
	          hidden
	          onChange={async (e) => {
	            const file = e.target.files?.[0];
	            if (!file) return;
	
	            // allow selecting the same file again
	            e.currentTarget.value = "";
	            await handleUploadAudio(file);
	          }}
	        />
	      </label>
	      <Tooltip text="Upload Audio" position="bottom" />
	    </div>
	  )}
</div>
          <div className="w-full max-w-3xl p-7 rounded-[3rem] bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 backdrop-blur-3xl shadow-2xl grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="text-[9px] font-black uppercase text-slate-500 tracking-widest ml-4">Input</label>
              <select
                value={inputSource}
                onChange={(e) => setInputSource(e.target.value)}
                className="w-full bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white border-none rounded-2xl p-4 text-[11px] font-black uppercase tracking-widest outline-none focus:ring-1 ring-indigo-500"
              >
                <option>Studio Mic</option>
                <option>System Audio</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[9px] font-black uppercase text-slate-500 tracking-widest ml-4">Accent</label>
              <select
                value={accentMode}
                onChange={(e) => setAccentMode(e.target.value as any)}
                className="w-full bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white border-none rounded-2xl p-4 text-[11px] font-black uppercase tracking-widest outline-none focus:ring-1 ring-indigo-500"
              >
                <option value="standard">Standard</option>
                <option value="uk">UK Dialect</option>
                <option value="nigerian">Nigerian Patois</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[9px] font-black uppercase text-slate-500 tracking-widest ml-4">
                Gate: {gateSensitivity}%
              </label>
              <div className="pt-1">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={gateSensitivity}
                  onChange={(e) => setGateSensitivity(parseInt(e.target.value, 10))}
                  className="w-full h-1 bg-slate-300 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DETAILS */}
      {view === "details" && selectedMeeting && (
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-8">
          <div className="flex-1 space-y-6">
            <button
              onClick={() => setView("dashboard")}
              className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-indigo-500 transition-colors"
            >
              ← Back to Workspace
            </button>

            <div className="p-7 md:p-12 rounded-[3rem] bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 backdrop-blur-3xl shadow-3xl space-y-8">
              <h2 className="text-3xl md:text-5xl font-black tracking-tighter leading-tight">{selectedMeeting.title}</h2>

              <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <span className="px-3 py-1.5 rounded-xl bg-indigo-600/10 text-indigo-400 border border-indigo-500/20">
                  {selectedMeeting.type}
                </span>
                <span>•</span>
                <span>{formatTime(selectedMeeting.duration)}</span>
              </div>

              <div className="space-y-4 max-h-[520px] overflow-y-auto pr-4">
                {selectedMeeting.transcript.length ? (
                  selectedMeeting.transcript.map((s) => (
                    <div
                      key={s.id}
                      className="p-5 rounded-[1.75rem] bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 hover:bg-indigo-500/5 transition-all"
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] font-black uppercase text-indigo-500 tracking-widest">{s.speaker}</span>
                        <span className="text-[9px] font-mono text-slate-500">[{formatTime(s.startTime)}]</span>
                      </div>
                      <p className="text-sm md:text-base font-medium text-slate-700 dark:text-slate-300 leading-relaxed">
                        {s.text}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="opacity-60 text-sm font-bold">No transcript found for this meeting.</div>
                )}
              </div>
            </div>
          </div>

          <div className="w-full lg:w-[400px] space-y-6">
            <div className="p-8 rounded-[2.5rem] bg-indigo-600/10 border border-indigo-500/20 space-y-6 shadow-2xl">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-black tracking-tighter">Summary.</h3>
                <span
                  className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                    selectedMeeting.syncStatus === "cloud"
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-300 dark:bg-slate-500/20 text-slate-700 dark:text-slate-400"
                  }`}
                >
                  {selectedMeeting.syncStatus === "cloud" ? "Synced" : "Offline"}
                </span>
              </div>

              <ul className="space-y-3">
                {(selectedMeeting.summary?.executiveSummary || ["Summary not available."]).slice(0, 6).map((s, i) => (
                  <li key={i} className="text-sm font-bold text-slate-700 dark:text-slate-300 leading-relaxed flex items-start">
                    <div className="w-2 h-2 rounded-full bg-indigo-500 mt-1.5 mr-3 flex-shrink-0"></div>
                    {s}
                  </li>
                ))}
              </ul>

              <div className="space-y-3">
                <button
                  onClick={playRecap}
                  disabled={recapLoading}
                  className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl active:scale-95 transition-all disabled:opacity-50"
                >
                  {recapLoading ? "Synthesizing..." : "Play AI Brief"}
                </button>

                {recapAudioUrl && (
                  <div className="flex flex-wrap gap-3 items-center">
                    <button
                      onClick={toggleRecapPlayback}
                      className="px-4 py-2 rounded-2xl border border-slate-200 dark:border-white/10 font-black text-[10px] uppercase tracking-widest"
                    >
                      {isRecapPlaying ? "Pause" : "Play"}
                    </button>
                    <button
                      onClick={() => seekRecap(-10)}
                      className="px-4 py-2 rounded-2xl border border-slate-200 dark:border-white/10 font-black text-[10px] uppercase tracking-widest"
                    >
                      Rewind 10s
                    </button>
                    <button
                      onClick={() => seekRecap(10)}
                      className="px-4 py-2 rounded-2xl border border-slate-200 dark:border-white/10 font-black text-[10px] uppercase tracking-widest"
                    >
                      Forward 10s
                    </button>
                    <button
                      onClick={stopRecapPlayback}
                      className="px-4 py-2 rounded-2xl border border-slate-200 dark:border-white/10 font-black text-[10px] uppercase tracking-widest"
                    >
                      Stop
                    </button>
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">
                      {recapDuration
                        ? `${formatTime(audioRef.current?.currentTime || 0)} / ${formatTime(recapDuration)}`
                        : "Ready"}
                    </span>
                  </div>
                )}

                <audio ref={audioRef} className="sr-only" />
              </div>
            </div>

            <div className="p-7 rounded-[2.5rem] bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 space-y-3 shadow-lg">
              <button
                className="w-full p-4 text-left text-[11px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-white hover:bg-indigo-50 dark:hover:bg-white/5 rounded-2xl transition-all"
                onClick={async () => {
                  try {
                    const draft = await generateEmailDraft(selectedMeeting);
                    await navigator.clipboard.writeText(draft);
                    showToast("Draft Copied");
                  } catch {
                    showToast("Email draft failed", "info");
                  }
                }}
              >
                Email Follow-up
              </button>

              <button
                className="w-full p-4 text-left text-[11px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-white hover:bg-indigo-50 dark:hover:bg-white/5 rounded-2xl transition-all"
                onClick={() => downloadAudio(selectedMeeting)}
              >
                Download Audio
              </button>

              <button
                className="w-full p-4 text-left text-[11px] font-black uppercase tracking-widest text-indigo-600 hover:text-white hover:bg-indigo-600 dark:hover:bg-indigo-600/20 rounded-2xl transition-all"
                onClick={() => syncToCloud(selectedMeeting.id)}
              >
                Quantum Cloud Sync
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INTEGRATIONS */}
      {view === "integrations" && (
        <div className="max-w-5xl mx-auto space-y-10">
          <header className="space-y-3">
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter uppercase">Integrations.</h1>
            <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">
              Bridge your notes to your workflow.
            </p>
          </header>

          <div className="space-y-6">
            <div className="flex flex-col gap-1">
              <p className="text-[10px] font-black uppercase tracking-[0.35em] text-indigo-500">Calendar connectors</p>
              <p className="text-sm text-slate-300 font-bold">
                Keep Auto-Listen armed by authorizing Google or Microsoft calendars. We only read upcoming meetings.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {calendarProviders.map((provider) => (
                <div
                  key={provider.id}
                  className="p-8 rounded-[2.5rem] bg-slate-950 border border-white/5 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.8)] space-y-5 flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="text-3xl">{provider.icon}</div>
                        <h3 className="text-lg font-black text-white">{provider.name}</h3>
                      </div>
                      <span
                        className={`text-[9px] font-black uppercase tracking-[0.35em] ${
                          provider.connected ? "text-emerald-400" : "text-slate-500"
                        }`}
                      >
                        {provider.connected ? "Connected" : "Disconnected"}
                      </span>
                    </div>
                    <p className="text-slate-300 text-sm font-medium leading-relaxed">
                      {provider.description}
                    </p>
                  </div>

                  <button
                    onClick={() => startOAuth(provider.id as "google" | "microsoft")}
                    className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${
                      provider.connected
                        ? "bg-gradient-to-r from-slate-800 to-slate-950 text-white shadow-lg"
                        : "bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-xl hover:from-indigo-600 hover:to-purple-600"
                    }`}
                  >
                    {provider.connected ? "Refresh connection" : "Connect"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {integrations.map((int) => (
              <div
                key={int.id}
                className="p-8 rounded-[2.5rem] bg-slate-950 border border-white/5 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.9)] space-y-5 relative group"
              >
                <div className="flex justify-between items-center">
                  <div className="text-3xl">{int.icon}</div>
                  <span
                    className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                      int.connected ? "bg-emerald-500 text-white" : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {int.connected ? "Connected" : "Available"}
                  </span>
                </div>

                <h3 className="text-xl font-black text-white">{int.name}</h3>
                <p className="text-slate-300 font-bold text-sm leading-relaxed">
                  Link {int.name} to export future summaries and action items.
                </p>

                <button
                  onClick={() => {
                    setIntegrations((prev) => prev.map((i) => (i.id === int.id ? { ...i, connected: !i.connected } : i)));
                    showToast(`${int.name} ${!int.connected ? "Linked" : "Unlinked"}`);
                  }}
                  className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${
                    int.connected
                      ? "bg-slate-900 text-white shadow-lg border border-white/10"
                      : "bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-xl hover:from-indigo-600 hover:to-purple-600"
                  }`}
                >
                  {int.connected ? "Disconnect" : "Connect Link"}
                </button>

                <Tooltip text={`Manage ${int.name}`} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* HELP */}
      {view === "help" && (
        <div className="max-w-7xl mx-auto space-y-10">
          <header className="space-y-3">
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter">Support.</h1>
            <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">Knowledge base & assistance.</p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { id: "p1", title: "Local-First", items: ["How does IndexedDB work?", "Data encryption methods", "Exporting my audio"], icon: "🛡️" },
              { id: "p2", title: "Neural Models", items: ["Tuning accent sensitivity", "Nigerian Patois tips", "UK Dialect optimization"], icon: "🎙️" },
              { id: "p3", title: "Cloud Sync", items: ["Data encryption methods", "Exporting my audio", "How does IndexedDB work?"], icon: "☁️" },
            ].map((cat) => (
              <div
                key={cat.id}
                className="p-8 rounded-[2.5rem] bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 space-y-6 shadow-lg"
              >
                <div className="text-3xl">{cat.icon}</div>
                <h3 className="text-lg font-black">{cat.title}</h3>

                <ul className="space-y-3">
                  {cat.items.map((item) => (
                    <li
                      key={item}
                      onClick={() => setActiveArticle(HELP_ARTICLES[item] || null)}
                      className="group relative text-slate-500 dark:text-slate-400 font-bold hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer text-sm flex items-center"
                    >
                      <span className="mr-3 text-indigo-500">→</span>
                      {item}
                      <Tooltip text="Read" />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="p-10 md:p-12 rounded-[3rem] bg-indigo-600 flex flex-col md:flex-row items-center justify-between gap-8 text-white shadow-2xl">
            <div className="space-y-3 max-w-lg text-center md:text-left">
              <h2 className="text-3xl md:text-4xl font-black tracking-tighter">Neural Support.</h2>
              <p className="text-base font-bold opacity-80">Ask anything about the app and workflow.</p>
            </div>
            <button
              onClick={() => setIsSupportOpen(true)}
              className="bg-white text-indigo-600 px-8 py-4 rounded-full font-black text-base shadow-2xl hover:scale-105 active:scale-95 transition-all"
            >
              Engage AI Support
            </button>
          </div>
        </div>
      )}

      {/* ANALYTICS */}
      {view === "analytics" && (
        <div className="max-w-7xl mx-auto space-y-10">
          <div className="overflow-hidden rounded-[3rem] bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 border border-white/5 shadow-[0_60px_120px_-40px_rgba(15,23,42,0.95)] p-10 space-y-10">
            <div className="space-y-3 max-w-2xl">
              <p className="text-[10px] font-black uppercase tracking-[0.4em] text-indigo-400">NEURAL INSIGHTS</p>
              <h1 className="text-5xl md:text-7xl font-black uppercase tracking-tight text-white">Analytics.</h1>
              <p className="text-slate-300 text-sm md:text-base">
                Deep metrics for every transcript, summary, and auto-listen engagement. Refresh to pull the latest backend telemetry.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { label: "Meetings", value: String(meetings.length), sub: "Stored locally" },
                { label: "Local Cache", value: String(personalMeetings.length), sub: "Ready" },
                { label: "Cloud Sync", value: String(cloudMeetings.length), sub: "Mirrored" },
                { label: "Accent Mode", value: accentMode.toUpperCase(), sub: "Preference" },
              ].map((summary) => (
                <div
                  key={summary.label}
                  className="flex flex-col rounded-[2rem] bg-white/5 border border-white/5 p-6 backdrop-blur-3xl shadow-lg space-y-2"
                >
                  <p className="text-[10px] font-black uppercase tracking-[0.35em] text-slate-400">{summary.label}</p>
                  <p className="text-4xl font-black text-white">{summary.value}</p>
                  <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{summary.sub}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.4em] text-indigo-500">Backend telemetry</p>
                <h2 className="text-3xl font-black text-white">Gemini & Auto-Listen</h2>
              </div>
              <button
                onClick={() => fetchAnalytics()}
                className="px-5 py-2 rounded-full border border-indigo-500 text-indigo-500 text-[10px] font-black uppercase tracking-[0.35em] transition hover:bg-indigo-500 hover:text-white"
              >
                Refresh
              </button>
            </div>
            {analyticsLoading ? (
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-xl">
                <p className="text-sm font-black text-slate-400">Loading backend metrics…</p>
              </div>
            ) : analyticsError ? (
              <div className="rounded-[2rem] border border-red-400/40 bg-red-500/10 p-6 shadow-xl">
                <p className="text-sm font-black text-red-400">Error: {analyticsError}</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {analyticsMetricList.map((metric) => {
                    const stats = analyticsMetrics?.endpoints?.[metric.key];
                    return (
                      <div
                        key={metric.key}
                        className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-xl space-y-2 backdrop-blur-3xl"
                      >
                        <p className="text-[10px] font-black uppercase tracking-[0.35em] text-slate-400">{metric.label}</p>
                        <p className="text-3xl font-black text-white">{stats?.count ?? 0}</p>
                        <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
                          Avg {stats?.averageDurationMs ?? "—"} ms • {stats?.errors ?? 0} errors
                        </p>
                        <div className="h-2 rounded-full bg-white/10">
                          <div
                            className={`h-full rounded-full bg-gradient-to-r ${metric.accent}`}
                            style={{ width: `${Math.min(stats?.errorRate ?? 0, 100)}%` }}
                          />
                        </div>
                        {stats?.lastError && (
                          <p className="text-[9px] uppercase tracking-[0.35em] text-rose-400">Last error logged</p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-indigo-600/40 to-purple-600/30 p-6 shadow-2xl space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.35em] text-indigo-100">Calendar syncs</p>
                    <p className="text-4xl font-black text-white">{analyticsMetrics?.autoListen.calendarSyncs ?? 0}</p>
                    <p className="text-[10px] uppercase tracking-[0.35em] text-white/70">
                      Errors: {analyticsMetrics?.autoListen.calendarErrors ?? 0}
                    </p>
                  </div>
                  <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-emerald-500/40 to-lime-500/30 p-6 shadow-2xl space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.35em] text-emerald-100">Auto-listen tweaks</p>
                    <p className="text-4xl font-black text-white">{analyticsMetrics?.autoListen.toggles ?? 0}</p>
                    <p className="text-[10px] uppercase tracking-[0.35em] text-white/80">
                      Last saved: {analyticsMetrics?.autoListen.lastUpdated ? new Date(analyticsMetrics.autoListen.lastUpdated).toLocaleString() : "—"}
                    </p>
                  </div>
                  <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-slate-800/80 to-slate-900 p-6 shadow-2xl space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.35em] text-slate-200">Heartbeat</p>
                    <p className="text-4xl font-black text-white">{analyticsMetrics?.timestamp ? "Live" : "Idle"}</p>
                    <p className="text-[10px] uppercase tracking-[0.35em] text-white/70">
                      {analyticsMetrics?.timestamp ? new Date(analyticsMetrics.timestamp).toLocaleTimeString() : "No data yet"}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* SETTINGS */}
      {view === "settings" && (
        <div className="max-w-4xl mx-auto space-y-10">
          <header className="space-y-3">
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter uppercase">Config.</h1>
            <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">Preferences & local reset.</p>
          </header>

          <div className="p-8 rounded-[2.5rem] bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 space-y-8 shadow-xl">
            <div className="space-y-4">
              <h3 className="text-[10px] font-black uppercase text-indigo-500 tracking-widest border-b border-slate-200 dark:border-white/5 pb-3">
                Recording Defaults
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <label className="text-[9px] font-black uppercase text-slate-500 tracking-widest ml-4">Accent</label>
                  <select
                    value={accentMode}
                    onChange={(e) => setAccentMode(e.target.value as any)}
                    className="w-full bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white border-none rounded-2xl p-4 text-[11px] font-black uppercase tracking-widest outline-none focus:ring-1 ring-indigo-500"
                  >
                    <option value="standard">Standard</option>
                    <option value="uk">UK Dialect</option>
                    <option value="nigerian">Nigerian Patois</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-black uppercase text-slate-500 tracking-widest ml-4">
                    Gate Sensitivity: {gateSensitivity}%
                  </label>
                  <div className="pt-3">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={gateSensitivity}
                      onChange={(e) => setGateSensitivity(parseInt(e.target.value, 10))}
                      className="w-full h-1 bg-slate-300 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-[10px] font-black uppercase text-indigo-500 tracking-widest border-b border-slate-200 dark:border-white/5 pb-3">
                Auto-Listen
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="p-5 rounded-[2rem] bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                  <div className="flex items-start justify-between gap-6">
                    <div className="space-y-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Enable</p>
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                        Show a banner shortly before a scheduled meeting starts.
                      </p>
                      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-relaxed">
                        MVP: this doesn’t auto-capture system audio. It prompts you to start recording (one click).
                      </p>
                    </div>

                    <button
                      onClick={() => setAutoListenEnabled((v) => !v)}
                      className={`w-14 h-8 rounded-full border transition-all relative ${
                        autoListenEnabled
                          ? "bg-indigo-600 border-indigo-500"
                          : "bg-slate-200 dark:bg-white/10 border-slate-300 dark:border-white/10"
                      }`}
                      aria-pressed={autoListenEnabled}
                    >
                      <span
                        className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow transition-transform ${
                          autoListenEnabled ? "translate-x-6" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <div className="p-5 rounded-[2rem] bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Lead time</p>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-black text-slate-900 dark:text-white">
                      {autoListenLeadMinutes} min
                    </span>
                    <button
                      onClick={() => {
                        if (!autoListenEnabled) setAutoListenEnabled(true);
                        void loadUpcomingEvents();
                        showToast("Syncing calendar…", "info");
                      }}
                      className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10"
                    >
                      Sync Now
                    </button>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={autoListenLeadMinutes}
                    onChange={(e) => setAutoListenLeadMinutes(parseInt(e.target.value, 10))}
                    className="w-full h-1 bg-slate-300 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    We’ll nudge you when a meeting starts soon.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row justify-end gap-4">
              <button
                onClick={() => {
                  localStorage.clear();
                  window.location.reload();
                }}
                className="px-7 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest text-red-600 border border-red-200 hover:bg-red-50 dark:hover:bg-red-500/10"
              >
                Factory Reset
              </button>

              <button
                onClick={() => showToast("Changes Saved")}
                className="bg-indigo-600 text-white px-10 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl hover:bg-indigo-700"
              >
                Save Protocol
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALS */}
      {activeArticle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-md">
          <div className="max-w-xl w-full p-8 rounded-[2.5rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 shadow-3xl space-y-5 relative">
            <button onClick={() => setActiveArticle(null)} className="absolute top-6 right-7 text-slate-500 hover:text-indigo-500 font-black">
              ✕
            </button>
            <h2 className="text-2xl font-black text-indigo-500">{activeArticle.title}</h2>
            <p className="text-base leading-relaxed text-slate-700 dark:text-slate-300 font-medium">{activeArticle.content}</p>
            <button
              onClick={() => setActiveArticle(null)}
              className="bg-indigo-600 text-white px-7 py-3 rounded-xl font-black text-xs uppercase tracking-widest"
            >
              Acknowledge
            </button>
          </div>
        </div>
      )}

      {enterpriseDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-md">
          <div className="max-w-xl w-full p-8 rounded-[2.5rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 shadow-3xl space-y-5 relative">
            <button
              onClick={() => setEnterpriseDetail(null)}
              className="absolute top-6 right-7 text-slate-500 hover:text-indigo-500 font-black"
            >
              ✕
            </button>
            <div className="space-y-1">
              <p className="text-[10px] font-black uppercase text-indigo-500">{enterpriseDetail.team} Feed</p>
              <h2 className="text-2xl font-black">{enterpriseDetail.title}</h2>
            </div>
            <p className="text-base leading-relaxed text-slate-700 dark:text-slate-300 font-medium">
              {enterpriseDetail.details}
            </p>
            <div className="bg-indigo-600/10 p-4 rounded-2xl flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
              <span className="text-[10px] font-black uppercase">Cloud Verified</span>
            </div>
          </div>
        </div>
      )}

      {isSupportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-2xl">
          <div className="max-w-3xl w-full h-[75vh] flex flex-col p-7 rounded-[2.5rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 shadow-3xl relative">
            <button
              onClick={() => setIsSupportOpen(false)}
              className="absolute top-6 right-7 text-slate-500 hover:text-indigo-500 font-black"
            >
              ✕
            </button>

            <h2 className="text-2xl font-black mb-6">Neural Support</h2>

            <div className="flex-1 overflow-y-auto space-y-3 mb-5 pr-2">
              {supportChat.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] p-4 rounded-2xl ${
                      m.role === "user"
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10"
                    }`}
                  >
                    <p className="text-xs font-bold leading-relaxed whitespace-pre-wrap">{m.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 bg-slate-50 dark:bg-white/5 p-3 rounded-2xl border border-slate-200 dark:border-white/10">
              <input
                type="text"
                value={supportInput}
                onChange={(e) => setSupportInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSupportSend()}
                placeholder="Ask a protocol engineer..."
                className="flex-1 bg-transparent border-none outline-none text-slate-900 dark:text-white text-xs font-bold pl-2"
              />
              <button
                onClick={handleSupportSend}
                className="bg-indigo-600 px-6 py-3 rounded-xl font-black text-[9px] uppercase tracking-widest text-white shadow-lg"
              >
                Engage
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default App;
