import { describe, expect, it } from "vitest";
import {
  displayAnswer,
  normaliseFields,
  parseAnswers,
  parseFields,
  validateAnswers,
} from "@/lib/domain/activities";

describe("activity fields", () => {
  it("gives every activity something answerable, even with no input", () => {
    const fields = normaliseFields(undefined);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ key: "f1", type: "short_text", required: true });
  });

  it("assigns its own keys rather than trusting the browser's", () => {
    // The key is the join between a stored answer and the question it answered.
    // Letting a client choose it would let an edit re-attribute submissions.
    const fields = normaliseFields([{ label: "A" }, { label: "B" }, { label: "C" }]);
    expect(fields.map((f) => f.key)).toEqual(["f1", "f2", "f3"]);
  });

  it("degrades a choice field with nothing to choose from", () => {
    const [field] = normaliseFields([{ label: "Table", type: "choice", choices: ["only one"] }]);
    // A dead control on forty phones is worse than a text box.
    expect(field!.type).toBe("short_text");
  });

  it("builds a choice field from the instructor's options", () => {
    const [field] = normaliseFields([
      { label: "Table", type: "choice", choices: ["products", "orders", "order_items"] },
    ]);
    expect(field!.type).toBe("choice");
    expect(field!.options).toEqual([
      { value: "c1", label: "products" },
      { value: "c2", label: "orders" },
      { value: "c3", label: "order_items" },
    ]);
  });

  it("recovers a stored definition and ignores anything malformed", () => {
    const fields = parseFields([
      { key: "f1", label: "Ok", type: "sql", required: false },
      { key: "f2", label: "No type" },
      null,
      "nonsense",
    ]);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.required).toBe(false);
  });
});

describe("checking a submission", () => {
  const fields = normaliseFields([
    { label: "Rows", type: "number" },
    { label: "Your SQL", type: "sql" },
    { label: "Notes", type: "short_text", required: false },
  ]);

  it("keeps SQL exactly as it was pasted", () => {
    const sql = "SELECT version();\n  -- indented\nSELECT 1;";
    const result = validateAnswers(fields, { f1: "42", f2: `${sql}   ` });
    expect(result.ok).toBe(true);
    // Trailing whitespace goes; leading indentation is the thing being taught.
    if (result.ok) expect(result.answers.f2).toBe(sql);
  });

  it("insists a number is a number", () => {
    const result = validateAnswers(fields, { f1: "forty two", f2: "SELECT 1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Rows");
  });

  it("names the field that is missing", () => {
    const result = validateAnswers(fields, { f2: "SELECT 1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("Rows is required.");
  });

  it("lets an optional field be left out", () => {
    const result = validateAnswers(fields, { f1: "1", f2: "SELECT 1" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.answers.f3).toBeUndefined();
  });

  it("drops a field the learner's page still had after an edit", () => {
    const result = validateAnswers(fields, { f1: "1", f2: "SELECT 1", f9: "stale" });
    expect(result.ok).toBe(true);
    // Losing the stale field is better than rejecting the whole answer.
    if (result.ok) expect(Object.keys(result.answers)).toEqual(["f1", "f2"]);
  });

  it("only accepts an option that exists", () => {
    const choice = normaliseFields([
      { label: "Table", type: "choice", choices: ["products", "order_items"] },
    ]);
    expect(validateAnswers(choice, { f1: "c9" }).ok).toBe(false);
    expect(validateAnswers(choice, { f1: "c2" }).ok).toBe(true);
  });

  it("refuses a body that is not an answer map at all", () => {
    expect(validateAnswers(fields, "nope").ok).toBe(false);
    expect(validateAnswers(fields, ["a"]).ok).toBe(false);
  });

  it("recovers a stored answer map defensively", () => {
    expect(parseAnswers('{"f1":"7"}')).toEqual({ f1: "7" });
    expect(parseAnswers({ f1: "7", f2: 9 })).toEqual({ f1: "7" });
    expect(parseAnswers("not json")).toEqual({});
  });

  it("shows a choice by its label, not its internal value", () => {
    const [field] = normaliseFields([
      { label: "Table", type: "choice", choices: ["products", "order_items"] },
    ]);
    expect(displayAnswer(field!, "c2")).toBe("order_items");
  });
});
