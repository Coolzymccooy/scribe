// frontend/src/types.ts

export enum MeetingType {
  STAND_UP = "Stand-up",
  CLIENT_CALL = "Client Call",
  INTERVIEW = "Interview",
  CHURCH = "Church/Service",
  LECTURE = "Lecture",
  OTHER = "Other"
}

export type Theme = "light" | "dark";

export interface ChatMessage {
  role: "user" | "model";
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

/**
 * Backend might return either a structured summary or a plain string.
 * We support both and normalize for the UI.
 */
export type SummaryPayload = AISummary | string;

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

  transcript: TranscriptSegment[];

  summary?: AISummary; // UI always uses normalized structured format
  rawSummary?: SummaryPayload; // keep original payload if you want

  chatHistory?: ChatMessage[];
  tags: string[];

  audioStorageKey?: string;
  accentPreference: "standard" | "uk" | "nigerian";

  inputSource?: string;
  syncStatus?: "local" | "syncing" | "cloud";
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
