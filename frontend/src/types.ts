// src/types.ts

export enum MeetingType {
  STAND_UP = "Stand-up",
  CLIENT_CALL = "Client Call",
  INTERVIEW = "Interview",
  CHURCH = "Church/Service",
  LECTURE = "Lecture",
  OTHER = "Other",
}

export type Theme = "light" | "dark";

export type ChatRole = "user" | "model";

export interface ChatMessage {
  role: ChatRole;
  text: string;
}

export interface TranscriptSegment {
  id: string;
  startTime: number; // seconds
  endTime: number;   // seconds
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
  startTime: string; // ISO
  type: MeetingType;
}

export interface MeetingNote {
  id: string;
  title: string;
  date: string; // ISO
  duration: number; // seconds
  type: MeetingType;

  // Store raw transcript for safety + segments for UI rendering
  transcriptText: string;
  transcriptSegments: TranscriptSegment[];

  summary?: AISummary;
  chatHistory: ChatMessage[];
  tags: string[];

  audioStorageKey?: string; // IndexedDB key
  accentPreference: "standard" | "uk" | "nigerian";
  inputSource?: string;
  syncStatus: "local" | "syncing" | "cloud";
}

export type ViewState =
  | "landing"
  | "dashboard"
  | "recorder"
  | "details"
  | "settings"
  | "integrations"
  | "analytics"
  | "help";
