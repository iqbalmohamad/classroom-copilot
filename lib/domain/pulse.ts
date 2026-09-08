import { PULSE_VALUES, type PulseSummary, type PulseValue } from "../types";

export function isPulseValue(value: unknown): value is PulseValue {
  return typeof value === "string" && (PULSE_VALUES as readonly string[]).includes(value);
}

/**
 * Aggregates one pulse per participant.
 *
 * The caller passes the *current* pulse of each present participant, so a
 * learner who taps "Shaky" five times still contributes exactly one signal —
 * the replacement semantics live in the database (a single column per row),
 * not in this reducer.
 */
export function summarisePulse(
  pulses: readonly (PulseValue | null)[],
): PulseSummary {
  const counts: Record<PulseValue, number> = { got_it: 0, shaky: 0, lost: 0 };
  let responded = 0;

  for (const pulse of pulses) {
    if (pulse === null) continue;
    counts[pulse] += 1;
    responded += 1;
  }

  const percents: Record<PulseValue, number> = { got_it: 0, shaky: 0, lost: 0 };
  for (const value of PULSE_VALUES) {
    percents[value] = responded === 0 ? 0 : Math.round((counts[value] / responded) * 100);
  }

  return {
    counts,
    percents,
    responded,
    noResponse: pulses.length - responded,
    total: pulses.length,
  };
}
