
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ViewState, MeetingNote, MeetingType, TranscriptSegment, ChatMessage, Theme, CalendarEvent } from './types';
import { MicIcon, FolderIcon, SettingsIcon, FileTextIcon, SearchIcon, PlayIcon, TrashIcon, StopIcon } from './components/Icons';
import {analyzeMeeting, transcribeAudio, generateEmailDraft, askTranscript, generateAudioRecap, askSupport} from './services/apiService';
import { saveAudioBlob, getAudioBlob, deleteAudioBlob } from './services/storageService';

// --- Tooltip Component ---
const Tooltip: React.FC<{ text: string; position?: 'top' | 'bottom' }> = ({ text, position = 'top' }) => (
  <span className={`tooltip ${position === 'top' ? 'tooltip-top' : 'tooltip-bottom'}`}>{text}</span>
);

// --- Help Content Definitions ---
const HELP_ARTICLES: Record<string, { title: string, content: string }> = {
  'How does IndexedDB work?': {
    title: 'Secure Local Storage (IndexedDB)',
    content: 'ScribeAI uses IndexedDB, a high-performance transactional database built directly into your browser. This ensures that large audio files and neural metadata are stored locally on your device hardware, never touching external servers without your explicit permission.'
  },
  'Data encryption methods': {
    title: 'Neural Encryption Protocols',
    content: 'All meeting transcripts are stored with AES-256 equivalent local isolation. By keeping data in the browser\'s private storage partition, ScribeAI ensures data sovereignty above all.'
  },
  'Exporting my audio': {
    title: 'Data Portability',
    content: 'You can export your raw neural data and audio blobs directly from the Workspace settings. We support .WAV and .JSON formats.'
  },
  'Tuning accent sensitivity': {
    title: 'Acoustic Calibration',
    content: 'In the Studio Live view, adjust the Gate Sensitivity. Higher sensitivity captures subtle vocal nuances, while lower sensitivity filters out background ambient noise.'
  },
  'Nigerian Patois tips': {
    title: 'Specialized Accent Support',
    content: 'Our Nigerian Patois model is trained on West African phonetic patterns. For best results, ensure the "Nigerian" model is selected in config.'
  },
  'UK Dialect optimization': {
    title: 'British Isles Linguistics',
    content: 'The UK Dialect engine optimizes for non-rhotic speech patterns and localized terminology. Selection of this model reduces word-error-rate significantly.'
  }
};

const MOCK_PERSONAL_SEED: MeetingNote[] = [
  {
    id: 'seed-0',
    title: 'Neural Workspace Onboarding',
    date: new Date().toLocaleDateString(),
    duration: 320,
    type: MeetingType.STAND_UP,
    transcript: [{ id: 't1', startTime: 0, endTime: 5, speaker: 'System', text: 'Initializing local neural thread. Privacy protocols engaged.' }],
    summary: { executiveSummary: ['Workspace initialized successfully.', 'Local encryption active.'], actionItems: ['Record your first session'], decisions: ['Store all data locally'], openQuestions: [] },
    tags: ['Onboarding'], accentPreference: 'standard', chatHistory: [], syncStatus: 'local'
  }
];

const MOCK_ENTERPRISE_FEED = [
  { id: 'ent-1', title: 'Global Architecture Sync', team: 'Core Platform', duration: '1h 24m', date: 'Today', status: 'Analysis Finished', details: 'Focused on scaling local-first sync protocols across European nodes. Decision reached on zero-trust metadata architecture.', syncStatus: 'cloud' },
  { id: 'ent-2', title: 'Customer Experience Review', team: 'Success Ops', duration: '45m', date: 'Yesterday', status: 'Action Items Sent', details: 'Reviewed Q3 satisfaction metrics. Automated support pipelines are showing 40% higher throughput.', syncStatus: 'cloud' },
  { id: 'ent-3', title: 'Weekly Product Roadmap', team: 'Design Hub', duration: '1h 05m', date: '2 days ago', status: 'Summarized', details: 'Product vision for ScribeAI 4.0 discussed. Emphasis on multi-modal neural interactions.', syncStatus: 'cloud' },
  { id: 'ent-4', title: 'Enterprise Security Audit', team: 'InfoSec', duration: '2h 12m', date: 'Oct 28', status: 'Synced', details: 'Bi-annual security sweep completed. No anomalies detected in browser-level encryption partitions.', syncStatus: 'cloud' }
];

const formatTime = (seconds: number) => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// --- Helper Components ---
const SidebarItem: React.FC<{ icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; tooltip: string }> = ({ icon, label, active, onClick, tooltip }) => (
  <button onClick={onClick} className={`w-full flex items-center space-x-4 p-2 md:p-3 rounded-xl transition-all group relative ${active ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 shadow-lg' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'}`}>
    <div className="transition-transform group-hover:scale-110 flex-shrink-0">{icon}</div>
    <span className="font-black text-[9px] md:text-[10px] uppercase tracking-widest truncate">{label}</span>
    <Tooltip text={tooltip} />
  </button>
);

const Layout: React.FC<{ children: React.ReactNode; view: ViewState; setView: (v: ViewState) => void; theme: Theme; setTheme: (t: Theme) => void; searchQuery: string; setSearchQuery: (q: string) => void; toast: { message: string; type: 'success' | 'info' } | null }> = ({ children, view, setView, theme, setTheme, searchQuery, setSearchQuery, toast }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

 useEffect(() => {
  document.documentElement.classList.toggle("dark", theme === "dark");
}, [theme]);


  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans overflow-hidden transition-colors duration-300">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 w-52 md:w-60 border-r border-slate-200 dark:border-white/5 bg-white/80 dark:bg-slate-900/40 backdrop-blur-3xl flex flex-col p-6 space-y-8 z-40 transition-transform lg:relative lg:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div onClick={() => { setView('landing'); setIsMobileMenuOpen(false); }} className="flex items-center space-x-3 cursor-pointer mb-4">
          <div className="w-8 h-8 md:w-10 md:h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-black text-lg md:text-xl shadow-2xl">S</div>
          <span className="font-black text-xl md:text-2xl tracking-tighter">ScribeAI</span>
        </div>
        <nav className="flex-1 space-y-1">
          <SidebarItem icon={<FolderIcon className="w-4 h-4" />} label="Workspace" active={view === 'dashboard'} onClick={() => { setView('dashboard'); setIsMobileMenuOpen(false); }} tooltip="Manage your local & cloud notes" />
          <SidebarItem icon={<MicIcon className="w-4 h-4" />} label="Live Studio" active={view === 'recorder'} onClick={() => { setView('recorder'); setIsMobileMenuOpen(false); }} tooltip="Start a high-fidelity recording" />
          <SidebarItem icon={<FileTextIcon className="w-4 h-4" />} label="Integrations" active={view === 'integrations'} onClick={() => { setView('integrations'); setIsMobileMenuOpen(false); }} tooltip="Neural bridge to SaaS tools" />
          <SidebarItem icon={<div className="w-4.5 h-4.5 flex items-center justify-center font-bold text-xs">📊</div>} label="Analytics" active={view === 'analytics'} onClick={() => { setView('analytics'); setIsMobileMenuOpen(false); }} tooltip="Deep intelligence insights" />
          <SidebarItem icon={<div className="w-4.5 h-4.5 flex items-center justify-center font-bold text-xs">💡</div>} label="Help Corner" active={view === 'help'} onClick={() => { setView('help'); setIsMobileMenuOpen(false); }} tooltip="Learn the protocol" />
        </nav>
        <SidebarItem icon={<SettingsIcon className="w-5 h-5" />} label="Neural Config" active={view === 'settings'} onClick={() => { setView('settings'); setIsMobileMenuOpen(false); }} tooltip="System and privacy configuration" />
      </aside>

      <main className="flex-1 flex flex-col min-w-0 z-10 overflow-hidden relative">
        <header className="h-16 md:h-20 flex items-center justify-between px-4 md:px-10 border-b border-slate-200 dark:border-white/5 backdrop-blur-md bg-white/40 dark:bg-transparent">
           <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="lg:hidden p-2 text-slate-400 hover:text-white transition-colors">
             <div className="w-6 h-0.5 bg-current mb-1"></div><div className="w-6 h-0.5 bg-current mb-1"></div><div className="w-6 h-0.5 bg-current"></div>
           </button>
           <div className="flex-1 max-w-lg mx-4 relative hidden sm:block">
             <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-600" />
             <input type="text" placeholder="Scan neural cache..." className="w-full pl-11 pr-4 py-2 md:py-2.5 rounded-2xl text-[9px] md:text-[10px] font-black uppercase tracking-widest bg-slate-200/50 dark:bg-white/5 border border-slate-300 dark:border-white/5 focus:border-indigo-500/50 outline-none transition-all placeholder-slate-400" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
           </div>
           <div className="flex items-center space-x-3 md:space-x-6">
              <div className="group relative">
                <button 
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} 
                  className={`p-2 md:p-2.5 rounded-full border transition-all ${theme === 'dark' ? 'bg-white/5 text-amber-400 border-white/5' : 'bg-indigo-600 text-white shadow-lg border-indigo-600'}`}
                >
                  {theme === 'dark' ? '☀️' : '🌙'}
                </button>
                <Tooltip text={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`} position="bottom" />
              </div>
              <div className="group relative">
                <button onClick={() => setView('recorder')} className="bg-indigo-600 px-4 md:px-6 py-2 md:py-2.5 rounded-full font-black text-[9px] md:text-[10px] uppercase tracking-widest text-white shadow-lg hover:bg-indigo-700 transition-all">Studio Live</button>
                <Tooltip text="Begin Recording Studio" position="bottom" />
              </div>
           </div>
        </header>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-10">
          {children}
        </div>
      </main>

      {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden" onClick={() => setIsMobileMenuOpen(false)}></div>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 px-6 py-3 rounded-2xl bg-indigo-600 text-white font-black text-[9px] md:text-[10px] uppercase tracking-widest shadow-3xl z-50 flex items-center space-x-4 animate-in slide-in-from-right-10 border border-white/10">
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
    const ctx = canvas.getContext('2d');
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
      ctx.lineCap = 'round';
      const color = '#6366f1';
      for (let i = 0; i < 64; i++) {
        const angle = (i / 64) * Math.PI * 2;
        const frequencyValue = dataArray[i] / 255;
        const radius = baseRadius + frequencyValue * 70;
        ctx.beginPath();
        ctx.strokeStyle = `${color}${Math.floor(frequencyValue * 255).toString(16).padStart(2, '0')}`;
        ctx.moveTo(centerX + Math.cos(angle) * baseRadius, centerY + Math.sin(angle) * baseRadius);
        ctx.lineTo(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
        ctx.stroke();
      }
    };
    draw();
  }, [analyser]);
  return <canvas ref={canvasRef} width={260} height={260} className="w-[180px] h-[180px] md:w-[260px] md:h-[260px]" />;
};

const App: React.FC = () => {
  const [view, setView] = useState<ViewState>("landing");


  const [theme, setTheme] = useState<Theme>(() => {
  const saved = localStorage.getItem("scribeai_theme");
  return saved === "light" ? "light" : "dark";
});


  const [meetings, setMeetings] = useState<MeetingNote[]>(() => {
    const savedMeetings = localStorage.getItem("scribe_v3_meetings");
    if (!savedMeetings) return MOCK_PERSONAL_SEED;

    try {
      const parsed = JSON.parse(savedMeetings);
      return Array.isArray(parsed) && parsed.length ? parsed : MOCK_PERSONAL_SEED;
    } catch {
      return MOCK_PERSONAL_SEED;
    }
  });


 useEffect(() => {
    document.documentElement.className = theme;
  }, [theme]);

    useEffect(() => {
  localStorage.setItem("scribeai_theme", theme);
}, [theme]);


  const [workspaceTab, setWorkspaceTab] = useState<'personal' | 'enterprise' | 'cloud'>('personal');
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [accentMode, setAccentMode] = useState<'standard' | 'uk' | 'nigerian'>('standard');
  const [inputSource, setInputSource] = useState('Studio Mic');
  const [gateSensitivity, setGateSensitivity] = useState(75);
  const [toast, setToast] = useState<{message: string, type: 'success' | 'info'} | null>(null);

  // Modals & Details
  const [activeArticle, setActiveArticle] = useState<{ title: string, content: string } | null>(null);
  const [enterpriseDetail, setEnterpriseDetail] = useState<{ title: string, team: string, details: string, syncStatus?: string } | null>(null);
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [supportChat, setSupportChat] = useState<ChatMessage[]>([{ role: 'model', text: 'Protocol established. ScribeAI Cloud Sync is active. How can I help?' }]);
  const [supportInput, setSupportInput] = useState('');

  // Integrations state
  const [integrations, setIntegrations] = useState<{id: string, name: string, icon: string, connected: boolean}[]>([
    { id: 'notion', name: 'Notion', icon: '📓', connected: false },
    { id: 'slack', name: 'Slack', icon: '💬', connected: false },
    { id: 'hubspot', name: 'HubSpot', icon: '📈', connected: false },
    { id: 'zoom', name: 'Zoom Sync', icon: '📹', connected: false }
  ]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    localStorage.setItem('scribe_v3_meetings', JSON.stringify(meetings));
  }, [meetings]);

  const showToast = (message: string, type: 'success' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const syncToCloud = async (meetingId: string) => {
    setMeetings(prev => prev.map(m => m.id === meetingId ? { ...m, syncStatus: 'syncing' } : m));
    showToast("Pushing to Neural Cloud...", 'info');
    await new Promise(r => setTimeout(r, 2000));
    setMeetings(prev => prev.map(m => m.id === meetingId ? { ...m, syncStatus: 'cloud' } : m));
    showToast("Successfully Synced to Cloud Backup");
  };

  const downloadAudio = async (meeting: MeetingNote) => {
    if (!meeting.audioStorageKey) {
        showToast("No audio found in local cache", 'info');
        return;
    }
    try {
        const blob = await getAudioBlob(meeting.audioStorageKey);
        if (!blob) throw new Error("Blob missing");
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${meeting.title.replace(/\s+/g, '_')}_audio.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("Audio download started");
    } catch (e) {
        showToast("Download failed", 'info');
    }
  };

  const handleSupportSend = async () => {
    if (!supportInput.trim()) return;
    const userMessage = supportInput.trim();
    setSupportChat(prev => [...prev, { role: 'user', text: userMessage }]);
    setSupportInput('');
    try {
      const answer = await askSupport(userMessage, [...supportChat, { role: 'user', text: userMessage }]);
      setSupportChat(prev => [...prev, { role: 'model', text: answer || "Protocol failure." }]);
    } catch (error) {
      setSupportChat(prev => [...prev, { role: 'model', text: "Neural link timeout." }]);
    }
  };

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      mediaRecorder.start();
      setIsRecording(true);
      showToast("Neural Capture Mode Engaged", 'info');
    } catch (err) {
      alert("Microphone access is required for ScribeAI.");
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!mediaRecorderRef.current) return;
    setIsProcessing(true);
    mediaRecorderRef.current.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const storageKey = `audio_${Date.now()}`;
      await saveAudioBlob(storageKey, audioBlob);
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64Audio = (reader.result as string).split(',')[1];
        try {
          showToast("AI Processing Transcript...", 'info');
          const transcript = await transcribeAudio(base64Audio, 'audio/webm', accentMode);
          const summary = await analyzeMeeting(transcript, MeetingType.OTHER, accentMode);
          const newMeeting: MeetingNote = {
            id: Date.now().toString(), title: `New Session ${new Date().toLocaleTimeString()}`,
            date: new Date().toLocaleDateString(), duration: recordingTime, type: MeetingType.OTHER,
            transcript, summary, tags: [], accentPreference: accentMode, audioStorageKey: storageKey, 
            chatHistory: [], syncStatus: 'local'
          };
          setMeetings(prev => [newMeeting, ...prev]);
          setSelectedMeetingId(newMeeting.id);
          setView('details');
        } catch (e) {
          showToast("AI synthesis interrupted", 'info');
        } finally {
          setIsProcessing(false);
          audioContextRef.current?.close();
        }
      };
    };
    mediaRecorderRef.current.stop();
    setIsRecording(false);
  }, [recordingTime, accentMode]);

  useEffect(() => {
    let timer: number;
    if (isRecording) timer = window.setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    return () => clearInterval(timer);
  }, [isRecording]);

  const filteredMeetings = useMemo(() => meetings.filter(m => m.title.toLowerCase().includes(searchQuery.toLowerCase())), [meetings, searchQuery]);
  const selectedMeeting = meetings.find(m => m.id === selectedMeetingId);
  const layoutProps = { view, setView, theme, setTheme, searchQuery, setSearchQuery, toast };

  // Sub-filtering for Workspace Tabs
  const personalMeetings = useMemo(() => filteredMeetings.filter(m => m.syncStatus !== 'cloud'), [filteredMeetings]);
  const cloudMeetings = useMemo(() => filteredMeetings.filter(m => m.syncStatus === 'cloud'), [filteredMeetings]);

  // --- RENDERING ---

  if (view === 'landing') {
    return (
      <div className={`min-h-screen ${theme === 'dark' ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-900'} relative flex flex-col items-center justify-center p-6 text-center transition-colors duration-300`}>
        <div className="relative z-10 max-w-5xl space-y-12">
          <header className="space-y-10">
            <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center text-white text-4xl font-black shadow-2xl mx-auto">S</div>
            <h1 className="text-4xl sm:text-6xl md:text-7xl font-black tracking-tighter leading-[0.95] neural-text-glow">ScribeAI.</h1>
            <p className="text-base sm:text-lg md:text-xl font-bold text-slate-400 max-w-2xl mx-auto px-2 sm:px-4 leading-relaxed">Local-first neural processing with End-to-End Cloud Synchronization. Secure, private, and always reachable.</p>
            <div className="flex flex-col sm:flex-row gap-6 justify-center">
              <button onClick={() => setView('dashboard')} className="bg-indigo-600 px-6 sm:px-10 py-3 sm:py-4 rounded-full font-black text-sm sm:text-base text-white shadow-lg hover:bg-indigo-700 transition active:scale-95">Open Hub</button>
              <button onClick={() => setView('help')} className="bg-indigo-600 px-6 sm:px-10 py-3 sm:py-4 rounded-full font-black text-sm sm:text-base
    bg-slate-900/5 text-slate-900 border border-slate-900/10
    dark:bg-white/5 dark:text-white dark:border-white/10
    hover:bg-slate-900/10 dark:hover:bg-white/10
    transition active:scale-95">Documentation</button>
            </div>
          </header>
        </div>
      </div>
    );
  }

  return (
    <Layout {...layoutProps}>
      {view === 'dashboard' && (
        <div className="max-w-7xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-5 duration-700">
          <header className="flex flex-col sm:flex-row justify-between items-center sm:items-end gap-6">
            <div className="space-y-2 text-center sm:text-left">
              <h1 className="text-5xl md:text-7xl font-black tracking-tighter uppercase">Workspace.</h1>
              <div className="flex items-center space-x-3 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></div>
                <span>Sync Protocol: Encrypted & Active</span>
              </div>
            </div>
            <div className="group relative w-full sm:w-auto">
              <button onClick={() => setView('recorder')} className="bg-indigo-600 text-white px-8 py-5 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-indigo-700 transition-all flex items-center justify-center space-x-3 w-full"><MicIcon className="w-4 h-4" /><span>Capture Insight</span></button>
              <Tooltip text="Record New Audio Session" />
            </div>
          </header>

          <nav className="flex space-x-8 border-b border-slate-200 dark:border-white/5 overflow-x-auto pb-1">
            <button onClick={() => setWorkspaceTab('personal')} className={`pb-4 text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${workspaceTab === 'personal' ? 'text-indigo-500 border-b-2 border-indigo-500' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}>Personal Cache</button>
            <button onClick={() => setWorkspaceTab('cloud')} className={`pb-4 text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${workspaceTab === 'cloud' ? 'text-indigo-500 border-b-2 border-indigo-500' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}>Neural Cloud</button>
            <button onClick={() => setWorkspaceTab('enterprise')} className={`pb-4 text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${workspaceTab === 'enterprise' ? 'text-indigo-500 border-b-2 border-indigo-500' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}>Enterprise Feed</button>
          </nav>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {workspaceTab === 'personal' && (
              personalMeetings.length > 0 ? (
                personalMeetings.map(m => (
                  <div key={m.id} onClick={() => { setSelectedMeetingId(m.id); setView('details'); }} className="p-8 rounded-[2.5rem] bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 hover:border-indigo-500/50 hover:bg-slate-50 dark:hover:bg-white/[0.08] transition-all cursor-pointer group shadow-xl relative">
                    <div className="flex justify-between items-start mb-6">
                      <span className="px-3 py-1.5 bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 rounded-xl text-[7px] font-black uppercase tracking-widest">{m.type}</span>
                      <span className="text-slate-500 text-[8px] font-black uppercase tracking-widest">LOCAL</span>
                    </div>
                    <h3 className="text-xl md:text-2xl font-black line-clamp-2 leading-tight">{m.title}</h3>
                    <div className="mt-8 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-500 border-t border-slate-200 dark:border-white/5 pt-6">
                      <div className="flex items-center"><PlayIcon className="mr-3 w-4 h-4 text-indigo-600" /> {formatTime(m.duration)}</div>
                      <button onClick={(e) => { e.stopPropagation(); syncToCloud(m.id); }} className="p-2 hover:text-indigo-400 flex items-center space-x-2">
                         {m.syncStatus === 'syncing' ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <span className="opacity-40 hover:opacity-100 transition-opacity">☁️ Sync</span>}
                      </button>
                    </div>
                    <Tooltip text="Access Local Cache" />
                  </div>
                ))
              ) : (
                <div className="col-span-full py-20 text-center opacity-40"><p className="font-black uppercase tracking-[0.3em] text-xs">No local threads found.</p></div>
              )
            )}
            {workspaceTab === 'cloud' && (
              cloudMeetings.length > 0 ? (
                cloudMeetings.map(m => (
                  <div key={m.id} onClick={() => { setSelectedMeetingId(m.id); setView('details'); }} className="p-8 rounded-[2.5rem] bg-indigo-600/5 border border-indigo-500/30 hover:bg-indigo-600/10 transition-all cursor-pointer group shadow-2xl relative">
                    <div className="flex justify-between items-start mb-6">
                      <span className="px-3 py-1.5 bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 rounded-xl text-[7px] font-black uppercase tracking-widest">{m.type}</span>
                      <span className="text-indigo-500 dark:text-indigo-400 text-[8px] font-black uppercase tracking-widest">CLOUD VERIFIED</span>
                    </div>
                    <h3 className="text-xl md:text-2xl font-black text-indigo-900 dark:text-indigo-100 line-clamp-2 leading-tight">{m.title}</h3>
                    <div className="mt-8 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-indigo-400/50 border-t border-slate-200 dark:border-white/5 pt-6">
                      <div className="flex items-center"><PlayIcon className="mr-3 w-4 h-4 text-indigo-600" /> {formatTime(m.duration)}</div>
                      <span className="flex items-center space-x-2"><span>☁️</span> <span>Secure Hub</span></span>
                    </div>
                    <Tooltip text="Access Cloud Mirror" />
                  </div>
                ))
              ) : (
                <div className="col-span-full py-20 text-center flex flex-col items-center space-y-4">
                   <div className="text-4xl opacity-20">☁️</div>
                   <p className="font-black uppercase tracking-[0.2em] text-xs opacity-40">Neural Cloud is empty.</p>
                   <button onClick={() => setWorkspaceTab('personal')} className="text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:underline">Sync your first note</button>
                </div>
              )
            )}
            {workspaceTab === 'enterprise' && (
              MOCK_ENTERPRISE_FEED.map((feed) => (
                <div key={feed.id} onClick={() => setEnterpriseDetail(feed)} className="p-8 rounded-[2.5rem] bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 flex flex-col justify-between h-64 transition-all hover:bg-slate-50 dark:hover:bg-white/[0.05] cursor-pointer group relative shadow-lg">
                   <div className="space-y-4">
                     <div className="flex justify-between items-start"><span className="px-3 py-1 bg-slate-200 dark:bg-white/5 text-slate-600 dark:text-slate-400 rounded-lg text-[8px] font-black uppercase tracking-widest">{feed.team}</span><span className="text-slate-400 dark:text-slate-600 text-[8px] font-black uppercase tracking-widest">{feed.date}</span></div>
                     <h3 className="text-xl md:text-2xl font-black group-hover:text-indigo-500 transition-colors leading-tight">{feed.title}</h3>
                   </div>
                   <div className="flex items-center text-[10px] font-black uppercase tracking-widest text-indigo-500/80">
                     <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mr-3 animate-pulse"></div> {feed.status}
                   </div>
                   <Tooltip text="View Shared Org Note" />
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {view === 'recorder' && (
        <div className="max-w-4xl mx-auto h-full flex flex-col items-center justify-center space-y-12 animate-in slide-in-from-bottom-5 duration-700">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="inline-flex items-center space-x-3 px-6 py-3 rounded-full bg-indigo-600/10 text-indigo-400 border border-indigo-500/20">
               <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
               <span className="text-[10px] font-black uppercase tracking-[0.2em]">Neural Engine Ready</span>
            </div>
            <h1 className="text-5xl md:text-[100px] font-black tracking-tighter leading-none">{isRecording ? "Listening." : isProcessing ? "Syncing." : "Studio."}</h1>
          </div>
          <div className="relative group">
             {isRecording ? (
               <div className="relative flex items-center justify-center">
                 <NeuralVisualizer analyser={analyserRef.current} />
                 <button onClick={stopRecording} className="absolute inset-0 m-auto w-28 h-28 bg-red-600 rounded-[2.5rem] flex items-center justify-center text-white shadow-[0_0_80px_rgba(220,38,38,0.5)] transform hover:scale-110 transition-transform">
                    <StopIcon className="w-10 h-10" />
                 </button>
               </div>
             ) : (
               <button onClick={startRecording} disabled={isProcessing} className={`w-56 h-56 ${isProcessing ? 'bg-indigo-900 animate-pulse' : 'bg-indigo-600'} rounded-[3.5rem] flex items-center justify-center text-white shadow-[0_0_100px_rgba(79,70,229,0.4)] transform hover:scale-105 active:scale-95 transition-all group`}>
                  <MicIcon className="w-20 h-20 group-hover:rotate-12 transition-transform" />
               </button>
             )}
             <Tooltip text={isRecording ? "Stop Capture" : "Start Capture"} />
          </div>
          <div className="w-full max-w-3xl p-8 rounded-[3rem] bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 backdrop-blur-3xl shadow-2xl grid grid-cols-1 md:grid-cols-3 gap-8">
             <div className="space-y-2"><label className="text-[9px] font-black uppercase text-slate-500 tracking-widest ml-4">Input</label><select value={inputSource} onChange={e => setInputSource(e.target.value)} className="w-full bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white border-none rounded-2xl p-4 text-[11px] font-black uppercase tracking-widest outline-none focus:ring-1 ring-indigo-500"><option>Studio Mic</option><option>System Audio</option></select></div>
             <div className="space-y-2"><label className="text-[9px] font-black uppercase text-slate-500 tracking-widest ml-4">Accent</label><select value={accentMode} onChange={e => setAccentMode(e.target.value as any)} className="w-full bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white border-none rounded-2xl p-4 text-[11px] font-black uppercase tracking-widest outline-none focus:ring-1 ring-indigo-500"><option value="standard">Standard</option><option value="uk">UK Dialect</option><option value="nigerian">Nigerian Patois</option></select></div>
             <div className="space-y-2"><label className="text-[9px] font-black uppercase text-slate-500 tracking-widest ml-4">Gate: {gateSensitivity}%</label><div className="pt-1"><input type="range" min="0" max="100" value={gateSensitivity} onChange={e => setGateSensitivity(parseInt(e.target.value))} className="w-full h-1 bg-slate-300 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500" /></div></div>
          </div>
        </div>
      )}

      {view === 'details' && selectedMeeting && (
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-10 animate-in fade-in duration-500">
          <div className="flex-1 space-y-6">
            <button onClick={() => setView('dashboard')} className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-indigo-400 transition-colors">← Back to Workspace</button>
            <div className="p-8 md:p-16 rounded-[3.5rem] bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 backdrop-blur-3xl shadow-3xl space-y-12">
               <h2 className="text-4xl md:text-7xl font-black tracking-tighter leading-tight">{selectedMeeting.title}</h2>
               <div className="space-y-8 max-h-[500px] overflow-y-auto pr-6 custom-scrollbar">
                 {selectedMeeting.transcript.map(s => (
                   <div key={s.id} className="p-8 rounded-[2rem] bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 group hover:bg-indigo-500/5 transition-all"><div className="flex justify-between items-center mb-4"><span className="text-[10px] font-black uppercase text-indigo-500 tracking-widest">{s.speaker}</span><span className="text-[9px] font-mono text-slate-500">[{formatTime(s.startTime)}]</span></div><p className="text-lg font-medium text-slate-700 dark:text-slate-300 leading-relaxed">{s.text}</p></div>
                 ))}
               </div>
            </div>
          </div>
          <div className="w-full lg:w-[400px] space-y-6">
             <div className="p-10 rounded-[3rem] bg-indigo-600/10 border border-indigo-500/20 space-y-8 shadow-2xl">
               <div className="flex justify-between items-center">
                 <h3 className="text-2xl font-black tracking-tighter">Summary.</h3>
                 <span className={`px-4 py-1.5 rounded-full text-[8px] font-black uppercase tracking-widest ${selectedMeeting.syncStatus === 'cloud' ? 'bg-indigo-600 text-white' : 'bg-slate-300 dark:bg-slate-500/20 text-slate-600 dark:text-slate-400'}`}>
                   {selectedMeeting.syncStatus === 'cloud' ? 'Synced' : 'Offline'}
                 </span>
               </div>
               <ul className="space-y-5">
                 {selectedMeeting.summary?.executiveSummary.map((s, i) => (<li key={i} className="text-sm font-bold text-slate-700 dark:text-slate-300 leading-relaxed flex items-start"><div className="w-2 h-2 rounded-full bg-indigo-500 mt-1.5 mr-4 flex-shrink-0"></div> {s}</li>))}
               </ul>
               <button onClick={async () => { showToast("Synthesizing Neural Recap...", 'info'); const audioData = await generateAudioRecap(selectedMeeting.summary!); if (audioData) { const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 }); const decode = (base64: string) => { const binary = atob(base64); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes; }; const decodePCM = async (data: Uint8Array, ctx: AudioContext, rate: number) => { const int16 = new Int16Array(data.buffer); const buffer = ctx.createBuffer(1, int16.length, rate); const channel = buffer.getChannelData(0); for (let i = 0; i < int16.length; i++) channel[i] = int16[i] / 32768.0; return buffer; }; const buffer = await decodePCM(decode(audioData), audioCtx, 24000); const source = audioCtx.createBufferSource(); source.buffer = buffer; source.connect(audioCtx.destination); source.start(); showToast("Playing Neural Brief"); } }} className="w-full py-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl active:scale-95 transition-all">Play AI Brief</button>
             </div>
             <div className="p-8 rounded-[3rem] bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 space-y-4 shadow-lg">
                <button className="w-full p-5 text-left text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-white hover:bg-indigo-50 dark:hover:bg-white/5 rounded-2xl transition-all" onClick={async () => { const draft = await generateEmailDraft(selectedMeeting); navigator.clipboard.writeText(draft); showToast("Draft Copied"); }}>Email Follow-up</button>
                <button className="w-full p-5 text-left text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-white hover:bg-indigo-50 dark:hover:bg-white/5 rounded-2xl transition-all" onClick={() => downloadAudio(selectedMeeting)}>Download Audio</button>
                <button className="w-full p-5 text-left text-[11px] font-black uppercase tracking-widest text-indigo-600 hover:text-white hover:bg-indigo-600 dark:hover:bg-indigo-600/20 rounded-2xl transition-all" onClick={() => syncToCloud(selectedMeeting.id)}>Quantum Cloud Sync</button>
             </div>
          </div>
        </div>
      )}

      {view === 'integrations' && (
        <div className="max-w-5xl mx-auto space-y-12 animate-in fade-in duration-700">
          <header className="space-y-4"><h1 className="text-6xl md:text-8xl font-black tracking-tighter uppercase">Integrations.</h1><p className="text-slate-500 font-bold uppercase tracking-widest text-xs">Bridge your neural thread to your workflow.</p></header>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {integrations.map(int => (
              <div key={int.id} className="p-10 rounded-[3rem] bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 space-y-6 group relative shadow-xl">
                <div className="flex justify-between items-center">
                  <div className="text-4xl">{int.icon}</div>
                  <span className={`px-4 py-1.5 rounded-full text-[8px] font-black uppercase tracking-widest ${int.connected ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'}`}>{int.connected ? 'Connected' : 'Available'}</span>
                </div>
                <h3 className="text-2xl font-black">{int.name}</h3>
                <p className="text-slate-500 dark:text-slate-400 font-bold text-sm leading-relaxed">Automatically sync your analyzed meeting notes and action items to your {int.name} workspace.</p>
                <button 
                  onClick={() => {
                    const newInts = integrations.map(i => i.id === int.id ? {...i, connected: !i.connected} : i);
                    setIntegrations(newInts);
                    showToast(`${int.name} ${!int.connected ? 'Linked' : 'Unlinked'}`);
                  }}
                  className={`w-full py-5 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${int.connected ? 'bg-red-500 text-white shadow-lg' : 'bg-indigo-600 text-white shadow-xl hover:bg-indigo-700'}`}
                >
                  {int.connected ? 'Disconnect' : 'Connect Link'}
                </button>
                <Tooltip text={`Manage ${int.name} link`} />
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'help' && (
        <div className="max-w-7xl mx-auto space-y-12 animate-in fade-in duration-700">
          <header className="space-y-4"><h1 className="text-6xl md:text-8xl font-black tracking-tighter">Support.</h1><p className="text-slate-500 font-bold uppercase tracking-widest text-xs">Knowledge Base & Neural Assistance.</p></header>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[ { id: 'p1', title: 'Local-First', items: ['How does IndexedDB work?', 'Data encryption methods', 'Exporting my audio'], icon: '🛡️' }, { id: 'p2', title: 'Neural Models', items: ['Tuning accent sensitivity', 'Nigerian Patois tips', 'UK Dialect optimization'], icon: '🎙️' }, { id: 'p3', title: 'Cloud Sync', items: ['Neural cloud protocols', 'End-to-end security', 'Multi-device sync'], icon: '☁️' } ].map(cat => (
              <div key={cat.id} className="p-10 rounded-[3rem] bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 space-y-8 shadow-lg">
                <div className="text-3xl">{cat.icon}</div><h3 className="text-xl font-black">{cat.title}</h3>
                <ul className="space-y-4">{cat.items.map((item, i) => (<li key={i} onClick={() => setActiveArticle(HELP_ARTICLES[item] || null)} className="text-slate-500 dark:text-slate-400 font-bold hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer text-sm flex items-center group relative"><span className="mr-3 text-indigo-500">→</span> {item}<Tooltip text="Read Protocol" /></li>))}</ul>
              </div>
            ))}
          </div>
          <div className="p-12 md:p-16 rounded-[4rem] bg-indigo-600 flex flex-col md:flex-row items-center justify-between gap-10 text-white shadow-2xl">
            <div className="space-y-4 max-w-lg text-center md:text-left"><h2 className="text-4xl md:text-5xl font-black tracking-tighter">Quantum Support.</h2><p className="text-lg font-bold opacity-80">Our protocol engineers are available via neural chat 24/7.</p></div>
            <button onClick={() => setIsSupportOpen(true)} className="bg-white text-indigo-600 px-10 py-5 rounded-full font-black text-xl shadow-2xl hover:scale-105 active:scale-95 transition-all">Engage AI Support</button>
          </div>
        </div>
      )}

      {view === 'analytics' && (
        <div className="max-w-7xl mx-auto space-y-12 animate-in fade-in duration-700">
          <header className="space-y-4"><h1 className="text-6xl md:text-8xl font-black tracking-tighter uppercase">Analytics.</h1><p className="text-slate-500 font-bold uppercase tracking-widest text-xs">System Health & Intelligence Metrics.</p></header>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {[ { label: 'Inference Time', value: '124h', sub: 'Total Logged' }, { label: 'Accuracy', value: '99.8%', sub: 'Neural Conf' }, { label: 'Items', value: '1.4k', sub: 'Action Assets' }, { label: 'Cloud Health', value: '99.9%', sub: 'Uplink' } ].map((m, i) => (
              <div key={i} className="p-8 rounded-[2.5rem] bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 space-y-2 shadow-lg"><p className="text-[9px] font-black uppercase text-indigo-500 tracking-[0.2em]">{m.label}</p><p className="text-4xl font-black">{m.value}</p><p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-600 mt-2">{m.sub}</p></div>
            ))}
          </div>
          <div className="p-10 md:p-12 rounded-[3.5rem] bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 h-64 flex items-end gap-2 shadow-xl">
             {Array.from({length: 30}).map((_, i) => (<div key={i} className="flex-1 bg-indigo-600/20 rounded-t-lg group relative" style={{ height: `${Math.random() * 80 + 20}%` }}><div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-indigo-600 text-white px-2 py-1 rounded text-[8px] opacity-0 group-hover:opacity-100 transition-opacity">{(Math.random()*10).toFixed(1)}h</div></div>))}
          </div>
        </div>
      )}

      {view === 'settings' && (
        <div className="max-w-4xl mx-auto space-y-12 animate-in fade-in duration-700">
          <header className="space-y-4"><h1 className="text-6xl md:text-8xl font-black tracking-tighter uppercase">Config.</h1><p className="text-slate-500 font-bold uppercase tracking-widest text-xs">System calibration & Security gateway.</p></header>
          <div className="p-10 rounded-[3.5rem] bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 space-y-10 shadow-xl">
            <div className="space-y-8">
               <h3 className="text-[10px] font-black uppercase text-indigo-500 tracking-widest border-b border-slate-200 dark:border-white/5 pb-4">Neural Cloud Sync</h3>
               <div className="flex items-center justify-between p-6 bg-indigo-600/5 rounded-2xl border border-indigo-500/20">
                 <div><p className="text-sm font-black">Enable Quantum Cloud Mirror</p><p className="text-[10px] font-bold text-slate-500 mt-1">Automatic end-to-end sync for local notes</p></div>
                 <button className="w-12 h-6 bg-indigo-600 rounded-full relative flex items-center px-1"><div className="w-4 h-4 bg-white rounded-full absolute right-1"></div></button>
               </div>
            </div>
            <div className="space-y-8">
               <h3 className="text-[10px] font-black uppercase text-indigo-500 tracking-widest border-b border-slate-200 dark:border-white/5 pb-4">Local Privacy</h3>
               <div className="space-y-4">
                 {[ { t: 'Cache Purge', d: 'Clear local IndexedDB after 30 days', active: true }, { t: 'Biometric Gateway', d: 'Unlock with device ID', active: false } ].map((item, i) => (<div key={i} className="flex items-center justify-between p-6 bg-slate-100 dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-white/5"><div><p className="text-sm font-black">{item.t}</p><p className="text-[10px] font-bold text-slate-500 mt-1">{item.d}</p></div><button className={`w-12 h-6 rounded-full relative flex items-center px-1 transition-colors ${item.active ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-800'}`}><div className={`w-4 h-4 bg-white rounded-full absolute transition-all ${item.active ? 'right-1' : 'left-1'}`}></div></button></div>))}
               </div>
            </div>
            <div className="pt-8 flex justify-end gap-6"><button onClick={() => { localStorage.clear(); window.location.reload(); }} className="px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-red-600 border border-red-200 hover:bg-red-50">Factory Reset</button><button onClick={() => showToast("Changes Saved")} className="bg-indigo-600 text-white px-12 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl hover:bg-indigo-700">Save Protocol</button></div>
          </div>
        </div>
      )}

      {/* MODALS */}
      {activeArticle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="max-w-xl w-full p-10 rounded-[3rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 shadow-3xl space-y-6 relative">
            <button onClick={() => setActiveArticle(null)} className="absolute top-6 right-8 text-slate-500 hover:text-indigo-500 font-black">✕</button>
            <h2 className="text-3xl font-black text-indigo-500">{activeArticle.title}</h2>
            <p className="text-lg leading-relaxed text-slate-700 dark:text-slate-300 font-medium">{activeArticle.content}</p>
            <button onClick={() => setActiveArticle(null)} className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-black text-xs uppercase tracking-widest">Acknowledge</button>
          </div>
        </div>
      )}

      {enterpriseDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="max-w-xl w-full p-10 rounded-[3rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 shadow-3xl space-y-6 relative">
            <button onClick={() => setEnterpriseDetail(null)} className="absolute top-6 right-8 text-slate-500 hover:text-indigo-500 font-black">✕</button>
            <div className="space-y-1"><p className="text-[10px] font-black uppercase text-indigo-500">{enterpriseDetail.team} Feed</p><h2 className="text-3xl font-black">{enterpriseDetail.title}</h2></div>
            <p className="text-lg leading-relaxed text-slate-700 dark:text-slate-300 font-medium">{enterpriseDetail.details}</p>
            <div className="bg-indigo-600/10 p-4 rounded-2xl flex items-center space-x-3"><div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div><span className="text-[10px] font-black uppercase">Cloud Verified | Neural Sync Complete</span></div>
          </div>
        </div>
      )}

      {isSupportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-2xl animate-in fade-in duration-300">
          <div className="max-w-3xl w-full h-[75vh] flex flex-col p-8 rounded-[3.5rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 shadow-3xl relative">
            <button onClick={() => setIsSupportOpen(false)} className="absolute top-6 right-8 text-slate-500 font-black">✕</button>
            <h2 className="text-3xl font-black mb-8">Neural Support</h2>
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 mb-6 pr-4">
              {supportChat.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] p-4 rounded-2xl ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10'}`}>
                     <p className="text-xs font-bold leading-relaxed">{m.text}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center space-x-3 bg-slate-50 dark:bg-white/5 p-3 rounded-2xl border border-slate-200 dark:border-white/5">
              <input type="text" value={supportInput} onChange={e => setSupportInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleSupportSend()} placeholder="Ask a protocol engineer..." className="flex-1 bg-transparent border-none outline-none text-slate-900 dark:text-white text-xs font-bold pl-2" />
              <button onClick={handleSupportSend} className="bg-indigo-600 px-6 py-3 rounded-xl font-black text-[9px] uppercase tracking-widest text-white shadow-lg">Engage</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default App;