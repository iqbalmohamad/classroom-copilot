"use client";

import { useState } from "react";
import { linkLabel } from "@/lib/domain/links";
import type { MaterialView } from "@/lib/types";

/**
 * The links the instructor has shared.
 *
 * Pinned links first, then this section's, then everything from earlier —
 * because on a phone the thing needed right now has to be reachable without
 * scrolling, and the install guide from twenty minutes ago still has to be
 * findable at all.
 */
export function MaterialsCard({
  materials,
  currentSectionId,
}: {
  materials: MaterialView[];
  currentSectionId: string | null;
}) {
  const [showAll, setShowAll] = useState(false);
  if (materials.length === 0) return null;

  const relevant = materials.filter(
    (material) =>
      material.highlighted || material.sectionId === null || material.sectionId === currentSectionId,
  );
  const earlier = materials.filter((material) => !relevant.includes(material));
  const shown = showAll ? [...relevant, ...earlier] : relevant;

  return (
    <section className="card stack">
      <div className="card-title" style={{ marginBottom: 0 }}>
        Links for this class
      </div>

      <ul className="list">
        {shown.map((material) => (
          <li key={material.id}>
            <a
              className="material-link"
              href={material.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {material.highlighted ? "★ " : ""}
              {material.title}
            </a>
            <div className="tiny muted">
              {material.note ? `${material.note} · ` : ""}
              {linkLabel(material.url)}
            </div>
          </li>
        ))}
      </ul>

      {earlier.length > 0 ? (
        <button className="btn" onClick={() => setShowAll((open) => !open)} aria-expanded={showAll}>
          {showAll ? "Show fewer" : `Earlier links (${earlier.length})`}
        </button>
      ) : null}
    </section>
  );
}
