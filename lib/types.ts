/**
 * Shared types for the classroom domain.
 *
 * These are imported by both server and client code, so this module must stay
 * free of any server-only import.
 */

export type PollKind = "yes_no" | "multiple_choice" | "confidence";
export type PollStatus = "draft" | "open" | "closed";
export type PulseValue = "got_it" | "shaky" | "lost";
export type QuestionStatus = "open" | "answered" | "hidden";
export type RoomStatus = "open" | "ended";
export type PublicMode = "join" | "poll" | "results" | "pick" | "waiting";
export type Role = "instructor" | "learner" | "public";

export const PULSE_VALUES: readonly PulseValue[] = ["got_it", "shaky", "lost"];
export const PULSE_LABELS: Record<PulseValue, string> = {
  got_it: "Got it",
  shaky: "Shaky",
  lost: "Lost",
};

export const POLL_KIND_LABELS: Record<PollKind, string> = {
  yes_no: "Yes / No",
  multiple_choice: "Multiple choice",
  confidence: "Confidence 1–5",
};

/** How long after its last heartbeat a participant is still considered present. */
export const PRESENCE_WINDOW_MS = 90_000;

export interface PollOption {
  value: string;
  label: string;
}

export interface PollTally {
  value: string;
  label: string;
  count: number;
  percent: number;
}

/** A poll as any surface sees it. Individual answers are never included. */
export interface PollView {
  id: string;
  seq: number;
  prompt: string;
  kind: PollKind;
  options: PollOption[];
  status: PollStatus;
  revealed: boolean;
  responseCount: number;
  /** Present for the instructor always; for learner/public only once revealed. */
  tallies: PollTally[] | null;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

export interface PulseSummary {
  counts: Record<PulseValue, number>;
  percents: Record<PulseValue, number>;
  responded: number;
  /** Present participants who have not set a pulse yet. */
  noResponse: number;
  total: number;
}

/** Question as learners and the public see it — never carries author identity. */
export interface QuestionView {
  id: string;
  body: string;
  votes: number;
  status: QuestionStatus;
  createdAt: string;
  /** Whether the requesting learner has already upvoted. Null for other roles. */
  votedByMe: boolean | null;
  /** Instructor-only: display name when the learner chose not to be anonymous. */
  authorName?: string | null;
}

/**
 * A roster row.
 *
 * Deliberately carries no pulse and no per-poll answer flag. Learners are told
 * their pulse is reported only as a class aggregate, and the product shows no
 * individual answers to anyone — so this payload must not contain the data that
 * would contradict either promise, whatever the console chooses to render.
 * Watching a named learner's "answered" flag flip while an unrevealed tally
 * moves would also reconstruct their answer, which is the same leak by a longer
 * route.
 */
export interface RosterEntry {
  id: string;
  displayName: string;
  present: boolean;
  joinedAt: string;
  pickedCount: number;
}

export interface PickView {
  id: string;
  displayName: string;
  createdAt: string;
}

export interface RoomHeader {
  code: string;
  title: string;
  status: RoomStatus;
  publicMode: PublicMode;
  createdAt: string;
  endedAt: string | null;
}

export interface InstructorSnapshot {
  role: "instructor";
  version: number;
  room: RoomHeader;
  joinUrl: string;
  roster: RosterEntry[];
  presentCount: number;
  joinedCount: number;
  activePoll: PollView | null;
  polls: PollView[];
  pulse: PulseSummary;
  questions: QuestionView[];
  picks: PickView[];
  aiEnabled: boolean;
}

export interface LearnerSnapshot {
  role: "learner";
  version: number;
  room: RoomHeader;
  me: { displayName: string; pulse: PulseValue | null };
  activePoll: PollView | null;
  myAnswer: string | null;
  questions: QuestionView[];
  /** Set when this learner is the most recently picked participant. */
  spotlight: boolean;
}

export interface PublicSnapshot {
  role: "public";
  version: number;
  room: RoomHeader;
  joinUrl: string;
  presentCount: number;
  activePoll: PollView | null;
  /** Only present while the instructor has the projector on the pick screen. */
  lastPick: { displayName: string } | null;
}

export type Snapshot = InstructorSnapshot | LearnerSnapshot | PublicSnapshot;
