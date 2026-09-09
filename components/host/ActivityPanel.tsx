"use client";

import { useState } from "react";
import {
  ACTIVITY_FIELD_LABELS,
  type ActivityFieldType,
} from "@/lib/domain/activities";
import type { ActivityView, SectionView } from "@/lib/types";
import type { HostAction } from "./types";

/**
 * Open-ended exercises: the ones the decks actually ask.
 *
 * The quick path is one line and a button — type the question, press Ask now —
 * because that is what happens when a class needs an exercise it did not plan.
 * Fields, an instructor reference answer and a duration are preparation, so
 * they live behind "More options" rather than in the way.
 */
interface DraftField {
  label: string;
  type: ActivityFieldType;
  choices: string;
}

const BLANK_FIELD: DraftField = { label: "", type: "short_text", choices: "" };

export function ActivityPanel({
  code,
  activities,
  sections,
  disabled,
  act,
  onReview,
}: {
  code: string;
  activities: ActivityView[];
  sections: SectionView[];
  disabled: boolean;
  act: HostAction;
  onReview: (activityId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [fields, setFields] = useState<DraftField[]>([{ ...BLANK_FIELD }]);
  const [reference, setReference] = useState("");
  const [minutes, setMinutes] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);

  async function create(openNow: boolean) {
    if (busy || !title.trim()) return;
    setBusy(true);
    const ok = await act(`/api/rooms/${code}/activities`, {
      title,
      instructions: instructions.trim() || undefined,
      fields: fields
        .filter((field) => field.label.trim() || field.type !== "short_text")
        .map((field) => ({
          label: field.label,
          type: field.type,
          choices: field.type === "choice" ? field.choices.split("\n") : undefined,
        })),
      referenceAnswer: reference.trim() || undefined,
      durationSeconds: minutes.trim() ? Math.round(Number(minutes) * 60) : undefined,
      openNow,
    });
    if (ok) {
      setTitle("");
      setInstructions("");
      setFields([{ ...BLANK_FIELD }]);
      setReference("");
      setMinutes("");
    }
    setBusy(false);
  }

  const live = activities.filter((activity) => activity.status === "open");
  const rest = activities.filter((activity) => activity.status !== "open");

  return (
    <section className="card stack">
      <div className="card-title" style={{ marginBottom: 0 }}>
        Activities
      </div>

      <div className="field">
        <label className="visually-hidden" htmlFor="activity-title">
          What should learners do?
        </label>
        <input
          id="activity-title"
          className="input"
          value={title}
          maxLength={200}
          disabled={disabled}
          placeholder="Where does the quantity ordered belong?"
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>

      <div className="btn-group">
        <button
          className="btn btn-primary"
          disabled={disabled || busy || !title.trim()}
          onClick={() => void create(true)}
        >
          {busy ? "Opening…" : "Ask now"}
        </button>
        <button
          className="btn"
          disabled={disabled || busy || !title.trim()}
          onClick={() => void create(false)}
        >
          Save for later
        </button>
        <button className="btn btn-sm" onClick={() => setAdvanced((open) => !open)} aria-expanded={advanced}>
          {advanced ? "Fewer options" : "More options"}
        </button>
      </div>

      {advanced ? (
        <div className="stack-sm">
          <div className="field">
            <label className="label" htmlFor="activity-instructions">
              Extra instructions (optional)
            </label>
            <textarea
              id="activity-instructions"
              className="textarea"
              value={instructions}
              maxLength={2000}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </div>

          <span className="label">Answer fields</span>
          {fields.map((field, index) => (
            <div className="stack-sm" key={index}>
              <div className="row">
                <input
                  className="input"
                  placeholder={`Field ${index + 1} label`}
                  value={field.label}
                  maxLength={120}
                  aria-label={`Field ${index + 1} label`}
                  onChange={(event) =>
                    setFields((current) =>
                      current.map((entry, i) =>
                        i === index ? { ...entry, label: event.target.value } : entry,
                      ),
                    )
                  }
                />
                <select
                  className="select"
                  value={field.type}
                  aria-label={`Field ${index + 1} type`}
                  onChange={(event) =>
                    setFields((current) =>
                      current.map((entry, i) =>
                        i === index
                          ? { ...entry, type: event.target.value as ActivityFieldType }
                          : entry,
                      ),
                    )
                  }
                >
                  {(Object.keys(ACTIVITY_FIELD_LABELS) as ActivityFieldType[]).map((type) => (
                    <option key={type} value={type}>
                      {ACTIVITY_FIELD_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>
              {field.type === "choice" ? (
                <textarea
                  className="textarea"
                  placeholder={"One option per line\nproducts\norders\norder_items"}
                  value={field.choices}
                  aria-label={`Field ${index + 1} options`}
                  onChange={(event) =>
                    setFields((current) =>
                      current.map((entry, i) =>
                        i === index ? { ...entry, choices: event.target.value } : entry,
                      ),
                    )
                  }
                />
              ) : null}
            </div>
          ))}
          <div className="btn-group">
            <button
              className="btn btn-sm"
              disabled={fields.length >= 8}
              onClick={() => setFields((current) => [...current, { ...BLANK_FIELD }])}
            >
              Add a field
            </button>
            {fields.length > 1 ? (
              <button
                className="btn btn-sm"
                onClick={() => setFields((current) => current.slice(0, -1))}
              >
                Remove the last
              </button>
            ) : null}
          </div>

          <div className="field">
            <label className="label" htmlFor="activity-reference">
              Your own answer (private, for marking by eye)
            </label>
            <textarea
              id="activity-reference"
              className="textarea"
              value={reference}
              maxLength={4000}
              onChange={(event) => setReference(event.target.value)}
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="activity-minutes">
              Suggested minutes (optional)
            </label>
            <input
              id="activity-minutes"
              className="input"
              inputMode="numeric"
              value={minutes}
              placeholder="8"
              onChange={(event) => setMinutes(event.target.value.replace(/[^0-9.]/g, ""))}
            />
          </div>
        </div>
      ) : null}

      {activities.length === 0 ? (
        <p className="empty">Nothing yet. Ask something, or prepare it before class.</p>
      ) : null}

      {[...live, ...rest].map((activity) => (
        <ActivityRow
          key={activity.id}
          code={code}
          activity={activity}
          sections={sections}
          disabled={disabled}
          act={act}
          onReview={onReview}
        />
      ))}
    </section>
  );
}

function ActivityRow({
  code,
  activity,
  sections,
  disabled,
  act,
  onReview,
}: {
  code: string;
  activity: ActivityView;
  sections: SectionView[];
  disabled: boolean;
  act: HostAction;
  onReview: (activityId: string) => void;
}) {
  const section = sections.find((entry) => entry.id === activity.sectionId);
  const needsAttention = activity.reviewCounts?.needs_follow_up ?? 0;
  const pending = activity.reviewCounts?.pending ?? 0;

  return (
    <div className="activity-row">
      <div className="row-between" style={{ gap: 8 }}>
        <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
          <strong>{activity.title}</strong>
          <span className="tiny muted">
            {section ? `${section.title} · ` : ""}
            {activity.attempt > 1 ? `attempt ${activity.attempt} · ` : ""}
            {activity.responseCount} {activity.responseCount === 1 ? "answer" : "answers"}
            {pending > 0 ? ` · ${pending} to review` : ""}
            {needsAttention > 0 ? ` · ${needsAttention} need follow-up` : ""}
          </span>
        </div>
        {activity.status === "open" ? (
          <span className="chip chip-live">
            <span className="dot" aria-hidden="true" />
            Open
          </span>
        ) : (
          <span className="chip">{activity.status === "draft" ? "Draft" : "Closed"}</span>
        )}
      </div>

      <div className="btn-group">
        {activity.status === "open" ? (
          <button
            className="btn btn-sm"
            disabled={disabled}
            onClick={() => void act(`/api/rooms/${code}/activities/${activity.id}`, { action: "close" })}
          >
            Close answers
          </button>
        ) : (
          <button
            className="btn btn-sm"
            disabled={disabled}
            onClick={() => void act(`/api/rooms/${code}/activities/${activity.id}`, { action: "open" })}
          >
            {activity.status === "draft" ? "Ask now" : "Reopen"}
          </button>
        )}
        {activity.responseCount > 0 ? (
          <button className="btn btn-sm" onClick={() => onReview(activity.id)}>
            Review {activity.responseCount}
          </button>
        ) : null}
        {activity.status !== "draft" ? (
          <button
            className="btn btn-sm"
            disabled={disabled}
            onClick={() => void act(`/api/rooms/${code}/activities/${activity.id}`, { action: "again" })}
          >
            Run again
          </button>
        ) : null}
        {activity.responseCount === 0 ? (
          <button
            className="btn btn-sm"
            disabled={disabled}
            onClick={() => {
              if (window.confirm(`Delete “${activity.title}”?`)) {
                void act(`/api/rooms/${code}/activities/${activity.id}`, { action: "delete" });
              }
            }}
          >
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}
