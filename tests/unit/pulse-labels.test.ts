import { describe, expect, it } from "vitest";
import { PULSE_DISPLAY_LABELS, PULSE_LABELS, PULSE_VALUES } from "@/lib/types";

/**
 * The two label maps serve different masters and must stay in step.
 *
 * `PULSE_DISPLAY_LABELS` is what people see on screen — emoji plus the plain
 * label. `PULSE_LABELS` is what software reads — the CSV export and the AI
 * prompt — and deliberately carries no emoji, so a spreadsheet or a prompt
 * never depends on how a consumer renders one.
 */
describe("pulse labels", () => {
  it("gives every value an on-screen label that ends with its plain label", () => {
    for (const value of PULSE_VALUES) {
      expect(PULSE_DISPLAY_LABELS[value].endsWith(PULSE_LABELS[value])).toBe(true);
    }
  });

  it("renders exactly the approved emoji forms", () => {
    expect(PULSE_DISPLAY_LABELS.got_it).toBe("✅ Got it");
    expect(PULSE_DISPLAY_LABELS.shaky).toBe("🤔 Shaky");
    expect(PULSE_DISPLAY_LABELS.lost).toBe("🆘 Lost");
  });

  it("keeps the machine-facing labels plain", () => {
    for (const value of PULSE_VALUES) {
      expect(PULSE_LABELS[value]).toMatch(/^[A-Za-z ]+$/);
    }
  });
});
