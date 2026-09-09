"use client";

import { useState } from "react";
import { api, ApiRequestError } from "@/lib/client/api";
import { planKeys } from "@/lib/client/tokens";
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
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<{ id: string; token: string; title: string } | null>(null);
  const [exercises, setExercises] = useState<PlanActivitySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const stored = planKeys.list();

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
    try {
      const result = await api<{ plan: { payload: { activities: PlanActivitySummary[] } } }>(
        `/api/plans/${planId}`,
        { method: "POST", body: { token } },
      );
      setExercises(result.plan.payload.activities);
    } catch (err) {
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
                          Reuse an exercise
                        </button>
                        <a
                          className="btn btn-sm"
                          href={`/?plan=${encodeURIComponent(plan.id)}`}
                        >
                          Start a class from it
                        </a>
                      </span>
                    </div>
                    {exercises ? (
                      <ul className="list" style={{ marginTop: 8 }}>
                        {exercises.map((exercise) => (
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
