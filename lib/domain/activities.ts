import type { PollOption } from "../types";

/**
 * Open-ended classroom activities.
 *
 * A poll asks a closed question; an activity asks the kind the SQL decks
 * actually ask — "which table holds quantity, and why", "paste the row count
 * and the largest order total", "paste the SQL you ran". One activity is a
 * small form: a list of fields, each with its own type, answered once per
 * learner and editable while it is open.
 *
 * Everything here is pure so the same rules can be enforced on the server and
 * previewed in the console without a second implementation drifting from it.
 */

export type ActivityFieldType = "short_text" | "number" | "long_text" | "sql" | "choice";

export const ACTIVITY_FIELD_TYPES: readonly ActivityFieldType[] = [
  "short_text",
  "number",
  "long_text",
  "sql",
  "choice",
];

export const ACTIVITY_FIELD_LABELS: Record<ActivityFieldType, string> = {
  short_text: "Short text",
  number: "Number",
  long_text: "Long text",
  sql: "SQL / code",
  choice: "Multiple choice",
};

/** Per-type answer limits. Generous for SQL, tight for a one-word answer. */
export const FIELD_MAX_LENGTH: Record<ActivityFieldType, number> = {
  short_text: 200,
  number: 40,
  long_text: 2000,
  sql: 4000,
  choice: 40,
};

export const MAX_FIELDS = 8;
export const MAX_CHOICES = 6;

export interface ActivityField {
  /** Stable within one activity; answers are keyed by it. */
  key: string;
  label: string;
  type: ActivityFieldType;
  required: boolean;
  placeholder?: string;
  /** Present only for `choice`. */
  options?: PollOption[];
}

export interface ActivityFieldInput {
  label?: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  choices?: (string | undefined)[];
}

function isFieldType(value: unknown): value is ActivityFieldType {
  return typeof value === "string" && (ACTIVITY_FIELD_TYPES as readonly string[]).includes(value);
}

/**
 * Turns instructor input into the canonical field list stored on the activity.
 *
 * Keys are assigned here rather than accepted from the client: they are the
 * join between a stored answer and the question it answered, so letting a
 * browser choose them would let an edit silently reinterpret answers already
 * submitted.
 */
export function normaliseFields(input: ActivityFieldInput[] | undefined): ActivityField[] {
  const raw = (input ?? []).slice(0, MAX_FIELDS);
  const fields: ActivityField[] = [];

  raw.forEach((entry, index) => {
    const type = isFieldType(entry.type) ? entry.type : "short_text";
    const label = (entry.label ?? "").trim().slice(0, 120) || `Answer ${index + 1}`;
    const placeholder = (entry.placeholder ?? "").trim().slice(0, 120) || undefined;

    const field: ActivityField = {
      key: `f${index + 1}`,
      label,
      type,
      required: entry.required !== false,
      ...(placeholder ? { placeholder } : {}),
    };

    if (type === "choice") {
      const options = (entry.choices ?? [])
        .map((choice) => (choice ?? "").trim())
        .filter((choice) => choice.length > 0)
        .slice(0, MAX_CHOICES)
        .map((choice, i) => ({ value: `c${i + 1}`, label: choice.slice(0, 120) }));
      // A choice field with nothing to choose from would be a dead control on
      // forty phones; degrade to a text answer rather than ship that.
      if (options.length >= 2) field.options = options;
      else field.type = "short_text";
    }

    fields.push(field);
  });

  // An activity with no fields cannot be answered at all. The single-answer
  // form is by far the common case, so it is also the fallback.
  if (fields.length === 0) {
    fields.push({ key: "f1", label: "Your answer", type: "short_text", required: true });
  }
  return fields;
}

/** Recovers the field list from jsonb without trusting its shape. */
export function parseFields(raw: unknown): ActivityField[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];

  const fields: ActivityField[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.key !== "string" || typeof record.label !== "string") continue;
    if (!isFieldType(record.type)) continue;

    const field: ActivityField = {
      key: record.key,
      label: record.label,
      type: record.type,
      required: record.required !== false,
    };
    if (typeof record.placeholder === "string") field.placeholder = record.placeholder;
    if (Array.isArray(record.options)) {
      const options = record.options.filter(
        (option): option is PollOption =>
          !!option &&
          typeof option === "object" &&
          typeof (option as PollOption).value === "string" &&
          typeof (option as PollOption).label === "string",
      );
      if (options.length > 0) field.options = options;
    }
    fields.push(field);
  }
  return fields;
}

export type AnswerMap = Record<string, string>;

export type AnswerCheck =
  | { ok: true; answers: AnswerMap }
  | { ok: false; reason: string };

const NUMBER_PATTERN = /^-?\d{1,15}(\.\d{1,6})?$/;

/**
 * Checks one learner's submission against the activity's own fields.
 *
 * Unknown keys are dropped rather than rejected: a learner whose page is a
 * version behind after the instructor edited the prompt should lose the stale
 * field, not their whole answer.
 */
export function validateAnswers(fields: ActivityField[], raw: unknown): AnswerCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "That answer was not in the expected form." };
  }
  const input = raw as Record<string, unknown>;
  const answers: AnswerMap = {};

  for (const field of fields) {
    const value = input[field.key];
    const text = typeof value === "string" ? value : value == null ? "" : String(value);
    // Only trailing whitespace goes: leading indentation is meaningful in SQL,
    // and stripping it would reformat the very thing the learner pasted.
    const cleaned = field.type === "sql" || field.type === "long_text"
      ? text.replace(/\s+$/, "")
      : text.trim();

    if (cleaned.length === 0) {
      if (field.required) return { ok: false, reason: `${field.label} is required.` };
      continue;
    }
    if (cleaned.length > FIELD_MAX_LENGTH[field.type]) {
      return {
        ok: false,
        reason: `${field.label} is too long (max ${FIELD_MAX_LENGTH[field.type]} characters).`,
      };
    }
    if (field.type === "number" && !NUMBER_PATTERN.test(cleaned)) {
      return { ok: false, reason: `${field.label} must be a number.` };
    }
    if (field.type === "choice") {
      const options = field.options ?? [];
      if (!options.some((option) => option.value === cleaned)) {
        return { ok: false, reason: `Choose one of the options for ${field.label}.` };
      }
    }
    answers[field.key] = cleaned;
  }

  if (Object.keys(answers).length === 0) {
    return { ok: false, reason: "Please answer at least one part before submitting." };
  }
  return { ok: true, answers };
}

/** Recovers a stored answer map without trusting its shape. */
export function parseAnswers(raw: unknown): AnswerMap {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const answers: AnswerMap = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") answers[key] = entry;
  }
  return answers;
}

/** Renders one answer for a human: the option's label, not its internal value. */
export function displayAnswer(field: ActivityField, value: string): string {
  if (field.type !== "choice") return value;
  return field.options?.find((option) => option.value === value)?.label ?? value;
}
