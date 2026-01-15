// Types shared across the ScribeAI frontend. These mirror the
// structures used by the backend API and the original application.

export enum MeetingType {
  STAND_UP = 'Stand-up',
  CLIENT_CALL = 'Client Call',
  INTERVIEW = 'Interview',
  CHURCH = 'Church/Service',
  LECTURE = 'Lecture',
  OTHER = 'Other'
}

export type Theme = 'light' | 'dark';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface TranscriptSegment {
  id: string;
  startTime: number;
  endTime: number;
  speaker: string;
  text: string;
}

export interface AISummary {
  executiveSummary: string[];
  actionItems: string[];
  decisions: string[];
  openQuestions: string[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string; // ISO string
  type: MeetingType;
}

export interface MeetingNote {
  id: string;
  title: string;
  date: string;
  duration: number; // in seconds
  type: MeetingType;
  transcript: TranscriptSegment[];
  summary?: AISummary;
  chatHistory?: ChatMessage[];
  tags: string[];
  audioStorageKey?: string; // Key for IndexedDB
  accentPreference: 'standard' | 'uk' | 'nigerian';
  inputSource?: string;
  syncStatus?: 'local' | 'syncing' | 'cloud';
}

export type ViewState =
  | 'landing'
  | 'dashboard'
  | 'recorder'
  | 'details'
  | 'settings'
  | 'integrations'
  | 'analytics'
  | 'help';