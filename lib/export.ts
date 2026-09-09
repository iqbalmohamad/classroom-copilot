import "server-only";
import { csvDocument } from "./domain/csv";
import { displayAnswer } from "./domain/activities";
import { PULSE_LABELS, PULSE_VALUES } from "./types";
import type { SessionSummary } from "./summary";

/**
 * The session as a spreadsheet, for the instructor.
 *
 * One flat table with a `record` column rather than several sheets, because the
 * point is to be sortable and filterable in whatever the marker already uses.
 * Named submissions are in here, which is why this is only ever produced behind
 * the host token; pulse appears as counts only, exactly as it does everywhere
 * else. Every cell goes through csvCell, which neutralises the leading
 * characters a spreadsheet would otherwise execute as a formula.
 */
export function summaryCsv(summary: SessionSummary): string {
  const rows: unknown[][] = [
    ["record", "section", "item", "attempt", "person", "detail", "value", "state", "at"],
  ];

  rows.push([
    "session",
    "",
    summary.room.title,
    "",
    "",
    `code ${summary.room.code}`,
    `${summary.learnersJoined} joined`,
    summary.room.status,
    summary.startedAt,
  ]);

  for (const section of summary.sections) {
    rows.push(["section", section.title, "", "", "", `position ${section.position}`, "", "", ""]);
  }

  for (const round of summary.pulseRounds) {
    for (const value of PULSE_VALUES) {
      rows.push([
        "pulse",
        round.sectionTitle ?? "",
        round.label ?? `Round ${round.seq}`,
        round.seq,
        // No name: a pulse row can never be attributed, in this file or anywhere.
        "",
        PULSE_LABELS[value],
        round.summary.counts[value],
        `${round.summary.percents[value]}%`,
        round.openedAt,
      ]);
    }
    rows.push([
      "pulse",
      round.sectionTitle ?? "",
      round.label ?? `Round ${round.seq}`,
      round.seq,
      "",
      "responded",
      round.summary.responded,
      `of ${round.summary.total}`,
      round.openedAt,
    ]);
  }

  for (const poll of summary.polls) {
    for (const tally of poll.tallies) {
      rows.push([
        "poll",
        "",
        poll.prompt,
        poll.seq,
        "",
        tally.label,
        tally.count,
        `${tally.percent}%`,
        poll.openedAt ?? "",
      ]);
    }
  }

  for (const activity of summary.activities) {
    rows.push([
      "activity",
      activity.sectionTitle ?? "",
      activity.title,
      activity.attempt,
      "",
      activity.instructions ?? "",
      `${activity.responseCount} submissions`,
      activity.status,
      activity.openedAt ?? "",
    ]);
    if (activity.referenceAnswer) {
      rows.push([
        "reference",
        activity.sectionTitle ?? "",
        activity.title,
        activity.attempt,
        "",
        "instructor reference answer",
        activity.referenceAnswer,
        "",
        "",
      ]);
    }
    for (const response of activity.responses) {
      for (const field of activity.fields) {
        const value = response.answers[field.key];
        if (value === undefined) continue;
        rows.push([
          "submission",
          activity.sectionTitle ?? "",
          activity.title,
          activity.attempt,
          response.displayName,
          field.label,
          displayAnswer(field, value),
          response.reviewState,
          response.updatedAt,
        ]);
      }
      if (response.feedback) {
        rows.push([
          "feedback",
          activity.sectionTitle ?? "",
          activity.title,
          activity.attempt,
          response.displayName,
          "instructor feedback",
          response.feedback,
          response.reviewState,
          response.updatedAt,
        ]);
      }
    }
  }

  for (const question of summary.questions) {
    rows.push([
      "question",
      question.sectionTitle ?? "",
      question.activityTitle ?? "",
      "",
      question.authorName ?? "anonymous",
      question.body,
      `${question.votes} upvotes`,
      question.unresolved ? "unresolved" : question.status,
      question.createdAt,
    ]);
  }

  for (const pick of summary.picks) {
    rows.push(["pick", "", "", "", pick.displayName, "called on", "", "", pick.createdAt]);
  }

  for (const material of summary.materials) {
    rows.push([
      "material",
      material.sectionTitle ?? "",
      material.title,
      "",
      "",
      material.note ?? "",
      material.url,
      "",
      "",
    ]);
  }

  return csvDocument(rows);
}

/** A filename a marker can find again among thirty downloads. */
export function csvFilename(summary: SessionSummary): string {
  const date = summary.startedAt.slice(0, 10);
  const slug = summary.room.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "class";
  return `${date}-${slug}-${summary.room.code}.csv`;
}
