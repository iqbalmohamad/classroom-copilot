"use client";

import { useState } from "react";
import type { SectionView } from "@/lib/types";
import type { HostAction } from "./types";

/**
 * Where the class is, and how to move it.
 *
 * The two things needed mid-lesson — what section we are in, and Next — are
 * always visible. Everything that is preparation rather than teaching (adding,
 * renaming, reordering, jumping) sits behind one clearly-labelled disclosure,
 * because an instructor who never opens it should never have to think about
 * sections at all.
 */
export function SectionBar({
  code,
  sections,
  currentId,
  disabled,
  act,
}: {
  code: string;
  sections: SectionView[];
  currentId: string | null;
  disabled: boolean;
  act: HostAction;
}) {
  const [planning, setPlanning] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");

  const index = sections.findIndex((section) => section.id === currentId);
  const current = index >= 0 ? sections[index] : null;

  async function move(sectionId: string | null) {
    await act(`/api/rooms/${code}/sections/select`, sectionId ? { sectionId } : {});
  }

  async function reorder(id: string, direction: -1 | 1) {
    const order = sections.map((section) => section.id);
    const from = order.indexOf(id);
    const to = from + direction;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to]!, order[from]!];
    await act(`/api/rooms/${code}/sections/reorder`, { order });
  }

  return (
    <section className="section-bar">
      <div className="row-between" style={{ gap: 12 }}>
        <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
          <span className="tiny muted">
            Section {index >= 0 ? index + 1 : 1} of {Math.max(sections.length, 1)}
          </span>
          <strong className="section-bar-title">{current?.title ?? "Section 1"}</strong>
        </div>
        <div className="btn-group" style={{ flexWrap: "nowrap" }}>
          <button className="btn btn-sm" disabled={disabled} onClick={() => void move(null)}>
            Next ▸
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setPlanning((open) => !open)}
            aria-expanded={planning}
          >
            {planning ? "Done" : "Plan sections"}
          </button>
        </div>
      </div>

      {planning ? (
        <div className="stack-sm" style={{ marginTop: 12 }}>
          <p className="tiny muted" style={{ margin: 0 }}>
            Optional. Without any of this the class runs in Section 1, and Next makes Section 2 when
            you need it. Moving on never publishes a draft or erases anything; the pulse round of
            the section you leave is closed and kept as history.
          </p>

          <ul className="list">
            {sections.map((section, position) => (
              <li key={section.id}>
                {renaming === section.id ? (
                  <form
                    className="row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void act(
                        `/api/rooms/${code}/sections/${section.id}`,
                        { title: renameTo },
                        "PATCH",
                      ).then(() => setRenaming(null));
                    }}
                  >
                    <input
                      className="input"
                      value={renameTo}
                      autoFocus
                      maxLength={80}
                      aria-label={`New name for ${section.title}`}
                      onChange={(event) => setRenameTo(event.target.value)}
                    />
                    <button className="btn btn-sm btn-primary" type="submit">
                      Save
                    </button>
                  </form>
                ) : (
                  <div className="row-between" style={{ gap: 8 }}>
                    <span className={section.id === currentId ? "" : "muted"}>
                      {position + 1}. {section.title}
                      {section.id === currentId ? " · here" : ""}
                    </span>
                    <span className="btn-group" style={{ flexWrap: "nowrap" }}>
                      <button
                        className="btn btn-sm"
                        disabled={position === 0}
                        aria-label={`Move ${section.title} up`}
                        onClick={() => void reorder(section.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="btn btn-sm"
                        disabled={position === sections.length - 1}
                        aria-label={`Move ${section.title} down`}
                        onClick={() => void reorder(section.id, 1)}
                      >
                        ↓
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          setRenaming(section.id);
                          setRenameTo(section.title);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        className="btn btn-sm"
                        disabled={disabled || section.id === currentId}
                        onClick={() => void move(section.id)}
                      >
                        Go here
                      </button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault();
              if (!newTitle.trim()) return;
              void act(`/api/rooms/${code}/sections`, { title: newTitle }).then(() =>
                setNewTitle(""),
              );
            }}
          >
            <input
              className="input"
              placeholder="Add a section — e.g. Why SQL Exists"
              value={newTitle}
              maxLength={80}
              aria-label="New section name"
              onChange={(event) => setNewTitle(event.target.value)}
            />
            <button className="btn btn-sm" type="submit" disabled={disabled}>
              Add
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
