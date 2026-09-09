"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiRequestError } from "@/lib/client/api";
import { planKeys, savedClasses, type SavedClass } from "@/lib/client/tokens";
import type { HostAction } from "./types";

interface PlanActivitySummary {
  key: string;
  title: string;
}

/**
 * Saving this session's preparation, and reusing it.
 *
 * A plan is owned by a token rather than an account, because the product has no
 * sign-up and this is not the place to introduce one. The token is shown once
 * and kept in this browser, exactly like the instructor link — and, like the
 * instructor link, anyone holding it can open the plan, so it is labelled that
 * way rather than presented as an id.
 *
 * A plan carries only what the instructor wrote. No learner, submission,
 * pulse, vote or pick can travel in one; the server builds it from the
 * preparation tables alone.
 */
export function PlanPanel({
  code,
  disabled,
  act,
}: {
  code: string;
  disabled: boolean;
  act: HostAction;
}) {
  const [classes, setClasses] = useState<SavedClass[]>([]);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<{ id: string; token: string; title: string } | null>(null);
  /**
   * Exercises keyed by the plan they came from.
   *
   * A single shared list was wrong twice over: it rendered under every saved
   * plan at once, and the import next to it used the enclosing row's
   * credentials — so clicking "Add here" under plan B could create an exercise
   * from plan A, or fail as not-found, depending on which had been browsed last.
   */
  const [exercises, setExercises] = useState<Record<string, PlanActivitySummary[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * The newest browse per plan. Two requests for the same plan can come back in
   * either order on a venue network, and the older answer must not overwrite
   * the newer one.
   */
  const browseSeq = useRef(0);
  const latestBrowse = useRef<Record<string, number>>({});

  const stored = planKeys.list();

  useEffect(() => {
    setClasses(savedClasses.list().filter((entry) => entry.code !== code));
  }, [code, open]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ id: string; token: string; title: string }>(
        `/api/rooms/${code}/plan`,
        { method: "POST", body: {}, code, role: "instructor" },
      );
      planKeys.remember(result.id, result.token, result.title);
      setSaved(result);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not save the plan.");
    }
    setBusy(false);
  }

  async function browse(planId: string, token: string) {
    setError(null);
    browseSeq.current += 1;
    const seq = browseSeq.current;
    latestBrowse.current[planId] = seq;
    try {
      const result = await api<{ plan: { payload: { activities: PlanActivitySummary[] } } }>(
        `/api/plans/${planId}`,
        { method: "POST", body: { token } },
      );
      // A response that has been overtaken is dropped rather than applied.
      if (latestBrowse.current[planId] !== seq) return;
      setExercises((current) => ({ ...current, [planId]: result.plan.payload.activities }));
    } catch (err) {
      if (latestBrowse.current[planId] !== seq) return;
      setError(err instanceof ApiRequestError ? err.message : "Could not open that plan.");
    }
  }

  return (
    <section className="card stack">
      <div className="row-between">
        <div className="card-title" style={{ marginBottom: 0 }}>
          Prepare &amp; reuse
        </div>
        <button className="btn btn-sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? "Done" : "Open"}
        </button>
      </div>

      {open ? (
        <div className="stack-sm">
          <p className="tiny muted" style={{ margin: 0 }}>
            Optional. Saves this session&apos;s sections, exercises, polls, durations, materials and
            your private reference answers — and nothing any learner did.
          </p>

          <button className="btn btn-sm" disabled={disabled || busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save this session as a plan"}
          </button>

          {saved ? (
            <div className="notice notice-ok">
              <p className="small" style={{ margin: 0 }}>
                Saved as <strong>{saved.title}</strong>. Kept in this browser so you can start next
                week&apos;s class from it. Anyone with the plan key can open it, so treat it like
                the instructor link.
              </p>
            </div>
          ) : null}

          {error ? (
            <div className="notice notice-error" role="alert">
              {error}
            </div>
          ) : null}

          {classes.length > 0 ? (
            <>
              <span className="label">Earlier classes on this device</span>
              <p className="tiny muted" style={{ margin: 0 }}>
                Two different things: <strong>open the answers</strong> reads what that class
                actually wrote, in its own session; <strong>reuse an exercise</strong> below copies
                the question here and collects fresh answers.
              </p>
              <ul className="list">
                {classes.map((entry) => (
                  <li key={entry.code}>
                    <div className="row-between" style={{ gap: 8 }}>
                      <span className="small">
                        {entry.title}
                        <span className="tiny muted"> · {entry.code}</span>
                      </span>
                      <span className="btn-group" style={{ flexWrap: "nowrap" }}>
                        <a className="btn btn-sm" href={savedClasses.link(entry, "summary")}>
                          Open the answers
                        </a>
                        <a className="btn btn-sm" href={savedClasses.link(entry)}>
                          Console
                        </a>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {stored.length > 0 ? (
            <>
              <span className="label">Saved plans in this browser</span>
              <ul className="list">
                {stored.map((plan) => (
                  <li key={plan.id}>
                    <div className="row-between" style={{ gap: 8 }}>
                      <span className="small">{plan.title}</span>
                      <span className="btn-group" style={{ flexWrap: "nowrap" }}>
                        <button className="btn btn-sm" onClick={() => void browse(plan.id, plan.token)}>
                          {exercises[plan.id] ? "Refresh exercises" : "Reuse an exercise"}
                        </button>
                        <a
                          className="btn btn-sm"
                          href={`/?plan=${encodeURIComponent(plan.id)}`}
                        >
                          Start a class from it
                        </a>
                      </span>
                    </div>
                    {exercises[plan.id] ? (
                      <ul className="list" style={{ marginTop: 8 }}>
                        {exercises[plan.id]!.length === 0 ? (
                          <li className="tiny muted">This plan has no exercises saved.</li>
                        ) : null}
                        {exercises[plan.id]!.map((exercise) => (
                          <li key={exercise.key}>
                            <div className="row-between" style={{ gap: 8 }}>
                              <span className="tiny">{exercise.title}</span>
                              <button
                                className="btn btn-sm"
                                disabled={disabled}
                                onClick={() =>
                                  void act(`/api/rooms/${code}/activities`, {
                                    fromPlan: {
                                      planId: plan.id,
                                      token: plan.token,
                                      key: exercise.key,
                                    },
                                    openNow: false,
                                  })
                                }
                              >
                                Add here
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
