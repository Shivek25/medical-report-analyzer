/**
 * src/lib/parser/categorizer.ts
 *
 * Phase 2 Categorizer sub-module.
 *
 * Walks the cleaned-text lines in source order, tracking the most recent
 * section header encountered, and assigns that header verbatim as the
 * `category` of every {@link DetectedRow} that follows it. Rows preceding any
 * header receive the literal string `'Uncategorized'`.
 *
 * The Row_Detector deliberately strips section-header lines from its output
 * (they are not lab rows), so this module receives the rows alongside the
 * cleaned text and uses each row's `lineIndex` to look up the category that
 * was active when that row appeared in the source.
 *
 * Section header predicate (re-used from the Text_Cleaner contract,
 * Requirement 3.5):
 *   - all-uppercase or title-case shape ({@link SECTION_HEADER_SHAPE}),
 *   - contains no numeric value token ({@link NUMERIC_VALUE}),
 *   - contains no unit token ({@link UNIT_TOKEN}),
 *   - is not whitespace-only / blank ({@link WHITESPACE_ONLY_LINE}).
 *
 * Pure function — no I/O, no shared mutable state.
 *
 * Requirements covered: 8.1, 8.2, 8.3, 8.4.
 */

import type { DetectedRow } from '../types/index.js';
import {
  NUMERIC_VALUE,
  SECTION_HEADER_SHAPE,
  UNIT_TOKEN,
  WHITESPACE_ONLY_LINE,
} from './patterns.js';

/**
 * Default category assigned to rows preceding any section header
 * (Requirement 8.2).
 */
export const UNCATEGORIZED = 'Uncategorized';

/**
 * Decide whether a single line is a section header per the Phase 2 contract.
 *
 * A line is a section header when, and only when, all of the following hold:
 *   1. It is not whitespace-only / blank (Req 8.4).
 *   2. Its trimmed form matches the all-uppercase or title-case shape
 *      defined by {@link SECTION_HEADER_SHAPE}.
 *   3. It contains no numeric value token (Req 3.5).
 *   4. It contains no unit token (Req 3.5).
 *
 * The function is pure and exported for reuse and testability.
 *
 * @param line - A single line as it appears in the cleaned text (no trim).
 * @returns `true` when `line` qualifies as a section header.
 */
export function isSectionHeaderLine(line: string): boolean {
  // Req 8.4: blank / whitespace-only lines do not update `currentCategory`,
  // so they must not qualify as headers.
  if (WHITESPACE_ONLY_LINE.test(line)) return false;

  const trimmed = line.trim();
  if (trimmed.length === 0) return false;

  // Shape predicate is anchored, so test against the trimmed form. Verbatim
  // storage of the line (incl. any surrounding whitespace) is the caller's
  // job; this function only classifies.
  if (!SECTION_HEADER_SHAPE.test(trimmed)) return false;

  // A section header carries no numeric or unit content (Req 3.5).
  if (NUMERIC_VALUE.test(line)) return false;
  if (UNIT_TOKEN.test(line)) return false;

  return true;
}

/**
 * Assign a `category` field to every detected row.
 *
 * Algorithm:
 *   1. Split the cleaned text into lines (preserving order, splitting on `\n`).
 *   2. Walk the lines from index `0` upward, recording the active category at
 *      the *start* of each line (i.e., the most recent header line *before*
 *      that line). Whitespace-only lines never update the active category
 *      (Req 8.4). When a non-blank line satisfies the section-header
 *      predicate, that verbatim line content becomes the category for all
 *      subsequent lines (Req 8.3).
 *   3. For each row, look up its category by its `lineIndex`; if the index is
 *      out of range, fall back to {@link UNCATEGORIZED}. Rows preceding any
 *      header receive {@link UNCATEGORIZED} (Req 8.2).
 *
 * Determinism: the function only reads its arguments and the imported regex
 * tables; the output is fully determined by the inputs.
 *
 * @param rows         - The rows produced by Row_Detector. Order is preserved.
 * @param cleanedText  - The cleaned text from Text_Cleaner that the rows were
 *                       detected against. Used to recover the section headers
 *                       that Row_Detector skipped.
 * @returns A new array of rows in the same order, each with `category`
 *          populated. The original `rows` array is not mutated.
 */
export function assignCategories(
  rows: DetectedRow[],
  cleanedText: string,
): DetectedRow[] {
  if (rows.length === 0) return [];

  const lines = cleanedText.split('\n');

  // categoryAtLine[i] = the active category at the START of line i, i.e., the
  // verbatim text of the most recent section header found in lines 0..i-1
  // (or `undefined` when no header has been seen yet).
  const categoryAtLine = new Array<string | undefined>(lines.length);
  let currentCategory: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    categoryAtLine[i] = currentCategory;
    const line = lines[i] ?? '';
    if (isSectionHeaderLine(line)) {
      // Req 8.3: store verbatim — no trim, no case conversion.
      currentCategory = line;
    }
  }

  return rows.map((row) => {
    const lookup =
      row.lineIndex >= 0 && row.lineIndex < lines.length
        ? categoryAtLine[row.lineIndex]
        : currentCategory;

    return {
      ...row,
      category: lookup ?? UNCATEGORIZED,
    };
  });
}
