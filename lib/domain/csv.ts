/**
 * CSV for the session export.
 *
 * Two separate concerns, both easy to get wrong:
 *
 *  * quoting, so a SQL answer containing a comma, a quote or a newline survives
 *    the round trip;
 *  * formula injection, because the instructor opens this in Excel or Sheets.
 *    A learner who answers `=HYPERLINK("http://evil","click")` — or, far more
 *    likely, pastes SQL beginning with `-` or `+` — must not become a live
 *    formula in the marker's spreadsheet.
 */

/** Characters a spreadsheet treats as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  // A leading apostrophe is the documented way to force a literal in both Excel
  // and Google Sheets; it survives the quoting below untouched.
  const guarded = FORMULA_LEAD.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(",");
}

export function csvDocument(rows: readonly (readonly unknown[])[]): string {
  // CRLF and a BOM: Excel opens UTF-8 CSV as the local codepage otherwise, and
  // a class list with accented names comes out mangled.
  return "﻿" + rows.map(csvRow).join("\r\n") + "\r\n";
}
