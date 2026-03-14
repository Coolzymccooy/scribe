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
  endTime?: string;
  joinUrl?: string;
  provider?: string;
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
  accentPreference: "standard" | "uk" | "nigerian" | "ghanaian" | "southafrican" | "kenyan";

  inputSource?: string;
  syncStatus?: "local" | "syncing" | "cloud" | "offline" | "failed";
  starred?: boolean;
}

export type ViewState =
  | "landing"
  | "dashboard"
  | "recorder"
  | "details"
  | "settings"
  | "integrations"
  | "analytics"
  | "help"
  | "team";

// ── Team Workspace Types ────────────────────────────────────────────────────

export interface OrgMember {
  uid: string;
  email: string;
  displayName?: string;
  role: "owner" | "admin" | "viewer";
  joinedAt: string; // ISO
}

export interface ScribeOrg {
  id: string;
  name: string;
  ownerId: string;
  members: OrgMember[];
  createdAt: string; // ISO
  inviteCode: string;
}

export interface TeamMeeting extends MeetingNote {
  orgId: string;
  sharedBy: string; // uid
}

export interface AnalyticsEndpointStats {
  count: number;
  averageDurationMs: number;
  errors: number;
  errorRate: number;
  lastError?: string;
}

export interface AnalyticsPayload {
  endpoints: Record<string, AnalyticsEndpointStats>;
  autoListen: {
    toggles: number;
    calendarSyncs: number;
    calendarErrors: number;
    lastUpdated: string | null;
  };
  timestamp?: number;
}
