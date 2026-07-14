/**
 * src/lib/extraction/candidate-generator.ts
 *
 * Phase 6 — Candidate block generator.
 *
 * Splits cleaned report text into `CandidateBlock`s, the unit of work handed to
 * the LLM classifier. The generator is intentionally simple and layout-agnostic
 * (this is the whole point of Phase 6: stop hard-coding Thyrocare layouts):
 *
 *   - Each cleaned line becomes its own candidate by default.
 *   - A short "look-ahead" window collapses obvious continuations of a test
 *     name (a name-only line immediately followed by a value-only line) into a
 *     single block, so multi-line lab rows survive without the deterministic
 *     parser's heavy merge machinery.
 *
 * It does NOT apply layout-specific noise filtering — that is the classifier's
 * job (and the validation gate's job on the way back out). Keeping the generator
 * generic is what lets the LLM path generalize to unfamiliar PDFs.
 *
 * Pure: same input ⇒ same candidates. No I/O, no shared state.
 */

import type { CandidateBlock } from './types.js';
import { NUMERIC_VALUE_ANCHORED, QUALITATIVE_VALUE_ANCHORED } from '../parser/patterns.js';

/** Maximum look-ahead lines folded into a single candidate. */
const MERGE_WINDOW = 2;

/**
 * Generate candidate blocks from cleaned report text.
 *
 * @param cleanedText - Output of the Phase 2 `Text_Cleaner.clean`.
 * @param pages       - Optional parallel array mapping line index → 1-based page
 *                      number. When omitted, every candidate gets `page: undefined`
 *                      (pdf-parse does not expose page boundaries for many PDFs).
 * @returns Ordered `CandidateBlock[]` keyed by source line index.
 */
export function generateCandidates(
  cleanedText: string,
  pages?: ReadonlyArray<number | undefined>,
): CandidateBlock[] {
  const lines = cleanedText.split('\n');
  const candidates: CandidateBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] ?? '').trim();
    if (line.length === 0) {
      i += 1;
      continue;
    }

    // If the line carries no value/unit token but the next line is a value-only
    // line, fold the value (and an optional range line) into this candidate so
    // the classifier sees a complete lab row.
    if (looksLikeTestNameOnly(line)) {
      const merged: string[] = [line];
      let j = i + 1;
      let consumed = 1;
      while (j < lines.length && consumed < MERGE_WINDOW) {
        const next = (lines[j] ?? '').trim();
        if (next.length === 0) break;
        if (!isValueOnlyLine(next)) break;
        merged.push(next);
        j += 1;
        consumed += 1;
      }
      if (consumed > 1) {
        candidates.push({
          text: merged.join(' '),
          lineStart: i,
          lineEnd: j - 1,
          page: pageOf(pages, i, j - 1),
        });
        i = j;
        continue;
      }
    }

    candidates.push({
      text: line,
      lineStart: i,
      lineEnd: i,
      page: pageOf(pages, i),
    });
    i += 1;
  }

  return candidates;
}

// ─── Predicates ──────────────────────────────────────────────────────────────

/** True iff a line is alphabetic-only (no value/unit/range tokens). */
function looksLikeTestNameOnly(line: string): boolean {
  if (line.length < 3) return false;
  if (NUMERIC_VALUE_ANCHORED.test(line)) return false;
  // value-only / range-only lines are not names
  if (isValueOnlyLine(line)) return false;
  // Require at least one alphabetic run so punctuation-only lines are skipped.
  return /[A-Za-z]{3,}/.test(line);
}

/** True iff a trimmed line is entirely a numeric or qualitative value token. */
function isValueOnlyLine(line: string): boolean {
  if (line.length === 0) return false;
  if (NUMERIC_VALUE_ANCHORED.test(line)) return true;
  if (QUALITATIVE_VALUE_ANCHORED.test(line)) return true;
  return false;
}

/**
 * Resolve the page number for a candidate spanning `lineStart..lineEnd`. When
 * the page map is absent or inconsistent across the span, return `undefined`
 * rather than guessing.
 */
function pageOf(
  pages: ReadonlyArray<number | undefined> | undefined,
  lineStart: number,
  lineEnd: number = lineStart,
): number | undefined {
  if (pages === undefined) return undefined;
  const start = pages[lineStart];
  const end = pages[lineEnd];
  if (start === undefined || end === undefined) return undefined;
  return start === end ? start : start;
}
