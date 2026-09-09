"use client";

import { useState } from "react";
import { linkLabel } from "@/lib/domain/links";
import type { MaterialView, SectionView } from "@/lib/types";
import type { HostAction } from "./types";

/**
 * Dataset links, install guides, the LMS submission page.
 *
 * The list is always visible because learners are looking at the same one; the
 * form to add to it is not, because it is preparation. Highlighting is what
 * puts the link that matters right now at the top of forty phones.
 */
export function MaterialsPanel({
  code,
  materials,
  sections,
  currentSectionId,
  disabled,
  act,
}: {
  code: string;
  materials: MaterialView[];
  sections: SectionView[];
  currentSectionId: string | null;
  disabled: boolean;
  act: HostAction;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [sectionId, setSectionId] = useState<string>("");

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !url.trim()) return;
    const ok = await act(`/api/rooms/${code}/materials`, {
      title,
      url,
      note: note.trim() || undefined,
      sectionId: sectionId || undefined,
    });
    if (ok) {
      setTitle("");
      setUrl("");
      setNote("");
    }
  }

  return (
    <section className="card stack">
      <div className="row-between">
        <div className="card-title" style={{ marginBottom: 0 }}>
          Materials
        </div>
        <button className="btn btn-sm" onClick={() => setAdding((open) => !open)} aria-expanded={adding}>
          {adding ? "Done" : "Add a link"}
        </button>
      </div>

      {materials.length === 0 ? (
        <p className="empty">No links yet. Learners see whatever you add here.</p>
      ) : (
        <ul className="list">
          {materials.map((material) => (
            <li key={material.id}>
              <div className="row-between" style={{ gap: 8 }}>
                <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
                  <a className="material-link" href={material.url} target="_blank" rel="noreferrer noopener">
                    {material.highlighted ? "★ " : ""}
                    {material.title}
                  </a>
                  <span className="tiny muted">
                    {material.sectionTitle ? `${material.sectionTitle} · ` : "Whole session · "}
                    {linkLabel(material.url)}
                  </span>
                </div>
                <span className="btn-group" style={{ flexWrap: "nowrap" }}>
                  <button
                    className="btn btn-sm"
                    disabled={disabled}
                    aria-pressed={material.highlighted}
                    onClick={() =>
                      void act(
                        `/api/rooms/${code}/materials/${material.id}`,
                        { highlighted: !material.highlighted },
                        "PATCH",
                      )
                    }
                  >
                    {material.highlighted ? "Unpin" : "Pin"}
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={disabled}
                    aria-label={`Remove ${material.title}`}
                    onClick={() => {
                      if (window.confirm(`Remove “${material.title}”?`)) {
                        void act(`/api/rooms/${code}/materials/${material.id}`, undefined, "DELETE");
                      }
                    }}
                  >
                    Remove
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form className="stack-sm" onSubmit={add}>
          <input
            className="input"
            placeholder="Title — e.g. PostgreSQL download"
            value={title}
            maxLength={120}
            aria-label="Material title"
            onChange={(event) => setTitle(event.target.value)}
          />
          <input
            className="input"
            placeholder="https://…"
            value={url}
            maxLength={2000}
            inputMode="url"
            aria-label="Material link"
            onChange={(event) => setUrl(event.target.value)}
          />
          <input
            className="input"
            placeholder="Note (optional) — e.g. deadline Sunday 23.30 WIB"
            value={note}
            maxLength={300}
            aria-label="Material note"
            onChange={(event) => setNote(event.target.value)}
          />
          <select
            className="select"
            value={sectionId}
            aria-label="Attach to section"
            onChange={(event) => setSectionId(event.target.value)}
          >
            <option value="">The whole session</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.title}
                {section.id === currentSectionId ? " (here now)" : ""}
              </option>
            ))}
          </select>
          <button className="btn btn-sm btn-primary" type="submit" disabled={disabled}>
            Add link
          </button>
          <p className="tiny muted" style={{ margin: 0 }}>
            Web addresses only. Anything that is not http or https is refused.
          </p>
        </form>
      ) : null}
    </section>
  );
}
