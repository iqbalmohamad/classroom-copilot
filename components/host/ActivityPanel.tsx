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

  /**
   * Grouped by section, in the order the instructor put them in.
   *
   * Section-aware, because "which exercises belong to Environment Setup" is the
   * question being asked when preparing; ordered, because that order is what
   * gets run and what a saved plan preserves.
   */
  const grouped: { key: string; title: string; items: ActivityView[] }[] = [];
  for (const section of sections) {
    const items = activities.filter((activity) => activity.sectionId === section.id);
    if (items.length > 0) grouped.push({ key: section.id, title: section.title, items });
  }
  const loose = activities.filter(
    (activity) => !sections.some((section) => section.id === activity.sectionId),
  );
  if (loose.length > 0) grouped.push({ key: "none", title: "No section", items: loose });

  /**
   * Moves one activity past its visible neighbour, sending the whole order.
   *
   * The arrows work on the list as displayed — grouped by section — not on the
   * stored order. When sections were created in an interleaved order, the
   * stored neighbour can sit in another group, and swapping with it would
   * change nothing the instructor can see. So: find the neighbour inside the
   * same displayed group and exchange the two entries' stored positions. Every
   * other entry keeps its position, so the other sections' order is untouched.
   * Moving an activity to a different section is the Edit form's job, not the
   * arrows'.
   */
  async function move(activity: ActivityView, direction: -1 | 1) {
    const group = grouped.find((entry) => entry.items.some((item) => item.id === activity.id));
    if (!group) return;
    const at = group.items.findIndex((item) => item.id === activity.id);
    const neighbour = group.items[at + direction];
    if (!neighbour) return;

    const order = activities.map((entry) => entry.id);
    const from = order.indexOf(activity.id);
    const to = order.indexOf(neighbour.id);
    if (from < 0 || to < 0) return;
    [order[from], order[to]] = [order[to]!, order[from]!];
    await act(`/api/rooms/${code}/activities/reorder`, { order });
  }

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

      {grouped.map((group) => (
        <div className="stack-sm" key={group.key}>
          {grouped.length > 1 ? <span className="label">{group.title}</span> : null}
          {group.items.map((activity, index) => (
            <ActivityRow
              key={activity.id}
              code={code}
              activity={activity}
              sections={sections}
              disabled={disabled}
              act={act}
              onReview={onReview}
              onMove={move}
              // The arrows stop at the edges of the displayed group: the row
              // above the first entry of a section belongs to another section,
              // and "move earlier" must never look like "move elsewhere".
              first={index === 0}
              last={index === group.items.length - 1}
            />
          ))}
        </div>
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
  onMove,
  first,
  last,
}: {
  code: string;
  activity: ActivityView;
  sections: SectionView[];
  disabled: boolean;
  act: HostAction;
  onReview: (activityId: string) => void;
  onMove: (activity: ActivityView, direction: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  const [editing, setEditing] = useState(false);
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

      {editing ? (
        <ActivityEditor
          code={code}
          activity={activity}
          sections={sections}
          disabled={disabled}
          act={act}
          onDone={() => setEditing(false)}
        />
      ) : null}

      <div className="btn-group">
        <button
          className="btn btn-sm"
          disabled={disabled || first}
          aria-label={`Move ${activity.title} earlier`}
          onClick={() => onMove(activity, -1)}
        >
          ↑
        </button>
        <button
          className="btn btn-sm"
          disabled={disabled || last}
          aria-label={`Move ${activity.title} later`}
          onClick={() => onMove(activity, 1)}
        >
          ↓
        </button>
        <button
          className="btn btn-sm"
          onClick={() => setEditing((open) => !open)}
          aria-expanded={editing}
        >
          {editing ? "Done editing" : "Edit"}
        </button>
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

/**
 * Editing a prepared activity: every field the composer offers.
 *
 * The answer fields are the one part that can stop being editable — the server
 * refuses to change them once anyone has answered, because doing so would
 * silently re-attribute submissions to questions that were never asked. The
 * form says so rather than letting the instructor discover it from an error.
 */
function ActivityEditor({
  code,
  activity,
  sections,
  disabled,
  act,
  onDone,
}: {
  code: string;
  activity: ActivityView;
  sections: SectionView[];
  disabled: boolean;
  act: HostAction;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(activity.title);
  const [instructions, setInstructions] = useState(activity.instructions ?? "");
  const [reference, setReference] = useState(activity.referenceAnswer ?? "");
  const [minutes, setMinutes] = useState(
    activity.durationSeconds ? String(Math.round(activity.durationSeconds / 60)) : "",
  );
  const [sectionId, setSectionId] = useState(activity.sectionId ?? "");
  const [fields, setFields] = useState<DraftField[]>(
    activity.fields.map((field) => ({
      label: field.label,
      type: field.type,
      choices: (field.options ?? []).map((option) => option.label).join("\n"),
    })),
  );
  const [busy, setBusy] = useState(false);

  const answered = activity.responseCount > 0;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const ok = await act(
      `/api/rooms/${code}/activities/${activity.id}`,
      {
        title,
        instructions: instructions.trim() || null,
        referenceAnswer: reference.trim() || null,
        durationSeconds: minutes.trim() ? Math.round(Number(minutes) * 60) : null,
        sectionId: sectionId || null,
        ...(answered
          ? {}
          : {
              fields: fields.map((field) => ({
                label: field.label,
                type: field.type,
                choices: field.type === "choice" ? field.choices.split("\n") : undefined,
              })),
            }),
      },
      "PATCH",
    );
    setBusy(false);
    if (ok) onDone();
  }

  return (
    <form className="stack-sm activity-editor" onSubmit={save}>
      <div className="field">
        <label className="label" htmlFor={`edit-title-${activity.id}`}>
          Prompt
        </label>
        <input
          id={`edit-title-${activity.id}`}
          className="input"
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor={`edit-instructions-${activity.id}`}>
          Extra instructions
        </label>
        <textarea
          id={`edit-instructions-${activity.id}`}
          className="textarea"
          value={instructions}
          maxLength={2000}
          onChange={(event) => setInstructions(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor={`edit-section-${activity.id}`}>
          Section
        </label>
        <select
          id={`edit-section-${activity.id}`}
          className="select"
          value={sectionId}
          onChange={(event) => setSectionId(event.target.value)}
        >
          <option value="">No section</option>
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.title}
            </option>
          ))}
        </select>
      </div>

      {answered ? (
        <p className="tiny muted" style={{ margin: 0 }}>
          {activity.responseCount} {activity.responseCount === 1 ? "learner has" : "learners have"}{" "}
          answered, so the answer fields are fixed. Use <strong>Run again</strong> to ask a changed
          version without touching what they wrote.
        </p>
      ) : (
        <>
          <span className="label">Answer fields</span>
          {fields.map((field, index) => (
            <div className="stack-sm" key={index}>
              <div className="row">
                <input
                  className="input"
                  value={field.label}
                  maxLength={120}
                  aria-label={`Edit field ${index + 1} label`}
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
                  aria-label={`Edit field ${index + 1} type`}
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
                  value={field.choices}
                  aria-label={`Edit field ${index + 1} options`}
                  placeholder="One option per line"
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
              type="button"
              className="btn btn-sm"
              disabled={fields.length >= 8}
              onClick={() => setFields((current) => [...current, { ...BLANK_FIELD }])}
            >
              Add a field
            </button>
            {fields.length > 1 ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setFields((current) => current.slice(0, -1))}
              >
                Remove the last
              </button>
            ) : null}
          </div>
        </>
      )}

      <div className="field">
        <label className="label" htmlFor={`edit-reference-${activity.id}`}>
          Your own answer (private)
        </label>
        <textarea
          id={`edit-reference-${activity.id}`}
          className="textarea"
          value={reference}
          maxLength={4000}
          onChange={(event) => setReference(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor={`edit-minutes-${activity.id}`}>
          Suggested minutes
        </label>
        <input
          id={`edit-minutes-${activity.id}`}
          className="input"
          inputMode="numeric"
          value={minutes}
          onChange={(event) => setMinutes(event.target.value.replace(/[^0-9.]/g, ""))}
        />
      </div>

      <div className="btn-group">
        <button className="btn btn-sm btn-primary" type="submit" disabled={disabled || busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button className="btn btn-sm" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
