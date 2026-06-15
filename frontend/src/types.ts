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
  /**
   * True once the transcript has been offloaded to durable blob storage
   * (Firebase Storage in the cloud, IndexedDB locally) rather than stored
   * inline. The Firestore doc and localStorage metadata never carry the
   * transcript array, so long recordings can't exceed size limits. When this
   * is set but `transcript` is empty, hydrate it on demand.
   */
  transcriptStored?: boolean;

  summary?: AISummary; // UI always uses normalized structured format
  rawSummary?: SummaryPayload; // keep original payload if you want

  chatHistory?: ChatMessage[];
  tags: string[];

  audioStorageKey?: string;
  accentPreference: "standard" | "uk" | "nigerian" | "ghanaian" | "southafrican" | "kenyan";

  inputSource?: string;
  syncStatus?: "local" | "syncing" | "cloud" | "offline" | "failed";
  starred?: boolean;

  // ── Reliability / cross-device durability ────────────────────────────────
  /** Transcription lifecycle, independent of cloud-sync state. */
  status?: "pending" | "processing" | "completed" | "failed";
  /** True once the raw audio blob has been uploaded to Firebase Storage. */
  audioUploaded?: boolean;
  /** Current server-side processing job id, if one is in flight. */
  jobId?: string | null;
  /** Number of transcription attempts so far (for backoff + cap). */
  retryCount?: number;
  /** Last transcription error message, surfaced in the UI. */
  lastError?: string | null;
  /** Epoch ms of the last transcription attempt (for backoff). */
  lastAttemptAt?: number | null;
  /** Cross-device processing lock so two devices don't transcribe the same audio. */
  claim?: { deviceId: string; claimedAt: number } | null;
  /** Client epoch ms of the last mutation — used for last-write-wins merge. */
  updatedAt?: number;
  /** Tombstone: epoch ms when soft-deleted, so deletions propagate across devices. */
  deletedAt?: number | null;
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
  teamStatus?: "recorded" | "transcribed" | "reviewed" | "action_items_sent";
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
