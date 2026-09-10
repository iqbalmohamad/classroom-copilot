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
export type PublicMode =
  | "join"
  | "poll"
  | "results"
  | "pick"
  | "waiting"
  | "activity"
  | "response";
export type Role = "instructor" | "learner" | "public";

export const PULSE_VALUES: readonly PulseValue[] = ["got_it", "shaky", "lost"];
export const PULSE_LABELS: Record<PulseValue, string> = {
  got_it: "Got it",
  shaky: "Shaky",
  lost: "Lost",
};

/**
 * The on-screen form of the pulse labels. Every surface that renders a pulse
 * choice or result uses these; the CSV export and the AI prompt keep the plain
 * `PULSE_LABELS` above, because those outputs are data read by other software,
 * not product UI.
 */
export const PULSE_DISPLAY_LABELS: Record<PulseValue, string> = {
  got_it: "✅ Got it",
  shaky: "🤔 Shaky",
  lost: "🆘 Lost",
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
  /**
   * Where the question was asked, captured when it was submitted. Moving the
   * class on does not relabel it, so "which bit were they stuck on" survives.
   * Null means the learner chose "general question".
   */
  sectionId: string | null;
  sectionTitle: string | null;
  activityId: string | null;
  activityTitle: string | null;
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


// ------------------------------------------------------------------ sections

export interface SectionView {
  id: string;
  position: number;
  title: string;
}

// -------------------------------------------------------------- pulse rounds

export type PulseRoundStatus = "open" | "closed";

/**
 * One round of the class pulse.
 *
 * Aggregate only, at every level: a round carries counts, never who chose what.
 * That is the promise learners are answering under, and it holds in exports and
 * in the summary as well as on screen.
 */
export interface PulseRoundView {
  id: string;
  seq: number;
  label: string | null;
  sectionId: string | null;
  sectionTitle: string | null;
  status: PulseRoundStatus;
  openedAt: string;
  closedAt: string | null;
  summary: PulseSummary;
}

// --------------------------------------------------------------- activities

export type ActivityStatus = "draft" | "open" | "closed";
export type ReviewState = "pending" | "reviewed" | "needs_follow_up";

export const REVIEW_LABELS: Record<ReviewState, string> = {
  pending: "Pending",
  reviewed: "Reviewed",
  needs_follow_up: "Needs follow-up",
};

export interface ActivityFieldView {
  key: string;
  label: string;
  type: "short_text" | "number" | "long_text" | "sql" | "choice";
  required: boolean;
  placeholder?: string;
  options?: PollOption[];
}

/** An activity as any surface sees it. Never carries anyone's answers. */
export interface ActivityView {
  id: string;
  seq: number;
  sectionId: string | null;
  title: string;
  instructions: string | null;
  fields: ActivityFieldView[];
  status: ActivityStatus;
  attempt: number;
  durationSeconds: number | null;
  responseCount: number;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  /** Instructor only: their own answer, kept for marking by eye. */
  referenceAnswer?: string | null;
  /** Instructor only: how much of the pile still needs attention. */
  reviewCounts?: Record<ReviewState, number>;
}

/**
 * One learner's submission, as the instructor sees it.
 *
 * Named on purpose — the instructor has to be able to invite the author to
 * explain — and learners are told so before they submit. This shape is only
 * ever built for a host-authorised request; no learner or public projection
 * constructs it.
 */
export interface ActivityResponseView {
  id: string;
  activityId: string;
  participantId: string | null;
  displayName: string;
  answers: Record<string, string>;
  reviewState: ReviewState;
  feedback: string | null;
  revealed: boolean;
  revealAuthor: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A learner's own submission, returned only to that learner. */
export interface MySubmission {
  activityId: string;
  answers: Record<string, string>;
  updatedAt: string;
  reviewState: ReviewState;
  /** Private feedback from the instructor, visible only to its author. */
  feedback: string | null;
}

/** A response on the shared screen. The author is anonymous unless named on purpose. */
export interface RevealedResponseView {
  activityTitle: string;
  fields: ActivityFieldView[];
  answers: Record<string, string>;
  /** Present only when the instructor deliberately chose to name the author. */
  authorName: string | null;
}

// ---------------------------------------------------------------- materials

export interface MaterialView {
  id: string;
  sectionId: string | null;
  sectionTitle: string | null;
  title: string;
  url: string;
  note: string | null;
  highlighted: boolean;
}

// ------------------------------------------------------------------- timers

export type TimerStatus = "running" | "paused" | "ended";

/** The activity as the shared screen sees it: the prompt, and nothing to act on. */
export interface PublicActivityView {
  title: string;
  instructions: string | null;
  fields: ActivityFieldView[];
  status: ActivityStatus;
}

/** The countdown as the shared screen sees it. */
export interface PublicTimerView {
  label: string;
  status: TimerStatus;
  durationSeconds: number;
  endsAt: string | null;
  remainingSeconds: number | null;
}

export interface TimerView {
  id: string;
  label: string;
  status: TimerStatus;
  durationSeconds: number;
  endsAt: string | null;
  remainingSeconds: number | null;
  autoClose: boolean;
  expired: boolean;
  activityId: string | null;
}

export interface RoomHeader {
  code: string;
  title: string;
  status: RoomStatus;
  publicMode: PublicMode;
  createdAt: string;
  endedAt: string | null;
  currentSectionId: string | null;
  currentSectionTitle: string | null;
  /**
   * Identity of the current pulse context. Changes when the class navigates
   * (even back to a section it has visited before) or when a round is
   * explicitly started — and at no other time. A tap sent while no round was
   * open carries it, so the tap can only land in the context its screen
   * actually showed.
   */
  pulseEpoch: number;
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
  sections: SectionView[];
  /** The round collecting right now, if any. */
  pulseRound: PulseRoundView | null;
  /** Every earlier round, newest first, so a section can be compared with itself. */
  pulseHistory: PulseRoundView[];
  activities: ActivityView[];
  materials: MaterialView[];
  timer: TimerView | null;
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
  sections: SectionView[];
  /**
   * Just enough of the round to answer it — and to say what it is about, so a
   * learner can see which part of the lesson they are rating rather than
   * guessing from what is on the projector.
   */
  pulseRound: {
    id: string;
    seq: number;
    label: string | null;
    sectionTitle: string | null;
    status: PulseRoundStatus;
  } | null;
  /**
   * What this learner can act on or has acted on: everything open, plus
   * anything closed that they answered — so a submission and its feedback do
   * not vanish from their phone the moment the instructor closes the exercise.
   */
  activities: ActivityView[];
  /** This learner's own submissions, including any private feedback. */
  mySubmissions: MySubmission[];
  materials: MaterialView[];
  timer: TimerView | null;
}

export interface PublicSnapshot {
  role: "public";
  version: number;
  /** The projector never taps a pulse, so it does not carry the epoch. */
  room: Omit<RoomHeader, "pulseEpoch">;
  joinUrl: string;
  presentCount: number;
  activePoll: PollView | null;
  /** Only present while the instructor has the projector on the pick screen. */
  lastPick: { displayName: string } | null;
  /**
   * The activity the class is working on. No identifiers: the projector acts on
   * nothing, so it is handed nothing to act with.
   */
  activity: PublicActivityView | null;
  /** Only present while the instructor has deliberately revealed one. */
  revealedResponse: RevealedResponseView | null;
  timer: PublicTimerView | null;
}

export type Snapshot = InstructorSnapshot | LearnerSnapshot | PublicSnapshot;
