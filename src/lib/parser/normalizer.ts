/**
 * src/lib/parser/normalizer.ts
 *
 * Phase 2 Normalizer — task 6.1.
 *
 * Takes a freshly extracted `LabEntry` from the Field_Extractor and produces a
 * canonical, idempotent form. The Normalizer is a pure function: same input
 * `LabEntry` ⇒ same output `LabEntry`, with no I/O, time, or shared state.
 *
 * Responsibilities (Requirements 6.1–6.6):
 *   1. Trim leading/trailing whitespace on every defined string field
 *      (`testName`, `value`, `unit`, `referenceRange.text`, `flag`, `notes`,
 *      `uncertaintyReason`).
 *   2. Collapse runs of 2+ whitespace characters in `testName` to a single
 *      space.
 *   3. Canonicalise `unit` via `canonicalizeUnit` (trim + lookup against the
 *      shared unit map; unknown units pass through trimmed without case
 *      conversion).
 *   4. Parse numeric reference-range bounds:
 *       a. Two-sided: `12–17` → `{ low:12, high:17 }` via REFERENCE_RANGE_NUMERIC.
 *       b. One-sided: `< 30` → `{ high:30 }`, `> 40` → `{ low:40 }`,
 *          `<= 5` → `{ high:5 }`, `>= 1.5` → `{ low:1.5 }` via
 *          REFERENCE_RANGE_COMPARISON. This fixes the clinical-safety bug
 *          where upper-limit-only references (e.g. LP(a) < 30) were silently
 *          defaulting to 'normal' because no numeric bound was ever parsed.
 *   5. Idempotent: `normalize(normalize(e))` is deeply equal to
 *      `normalize(e)`.
 *
 * Note on `exactOptionalPropertyTypes`: when a source field is absent, we
 * omit the property from the output object entirely rather than assigning
 * `undefined`. This keeps the type contract in `src/lib/types/index.ts`
 * (and the matching Zod schema) honest.
 */

import type { LabEntry, LabReferenceRange } from '../types/index.js';
import { REFERENCE_RANGE_NUMERIC, REFERENCE_RANGE_COMPARISON } from './patterns.js';
import { canonicalizeUnit } from './unit-map.js';

/** Matches any run of 2+ whitespace characters; used to collapse `testName`. */
const MULTI_WHITESPACE = /\s{2,}/g;

/**
 * Normalise a `LabEntry` into its canonical form.
 *
 * Pure and idempotent:
 *   - `normalize(normalize(e))` deep-equals `normalize(e)` for any `e`.
 *   - No I/O, no shared mutable state, no time / random dependencies.
 *
 * @param entry - The `LabEntry` produced by `Field_Extractor.extract`.
 * @returns A new `LabEntry` with whitespace trimmed, units canonicalised,
 *          and reference-range bounds parsed where the text is purely
 *          numeric. Optional fields that were absent on the input remain
 *          absent on the output.
 */
export function normalize(entry: LabEntry): LabEntry {
  // testName and value are required by the type contract; trim + (for name)
  // collapse internal whitespace runs to single spaces (Req 6.1, 6.2).
  const testName = entry.testName.trim().replace(MULTI_WHITESPACE, ' ');
  const value = entry.value.trim();

  // Build the result by starting with required fields and only assigning
  // optional fields when they are defined on the input. This satisfies
  // `exactOptionalPropertyTypes: true`.
  const result: LabEntry = {
    testName,
    value,
    category: entry.category,
    uncertain: entry.uncertain,
  };

  if (entry.unit !== undefined) {
    // canonicalizeUnit already trims and falls back to the trimmed source
    // when no canonical form is known (Req 6.3).
    result.unit = canonicalizeUnit(entry.unit);
  }

  if (entry.flag !== undefined) {
    result.flag = entry.flag.trim();
  }

  if (entry.notes !== undefined) {
    result.notes = entry.notes.trim();
  }

  if (entry.uncertaintyReason !== undefined) {
    result.uncertaintyReason = entry.uncertaintyReason.trim();
  }

  if (entry.referenceRange !== undefined) {
    result.referenceRange = normalizeRange(entry.referenceRange);
  }

  return result;
}

/**
 * Normalise a {@link LabReferenceRange} value.
 *
 * Behaviour (Req 6.4, 6.5):
 *   - When `text` is present, trim it and use it as the source of truth:
 *       * If the trimmed text matches `REFERENCE_RANGE_NUMERIC` (two-sided),
 *         set `low` and `high` to the parsed bounds and keep the trimmed text.
 *       * If the trimmed text matches `REFERENCE_RANGE_COMPARISON` (one-sided),
 *         set either `high` (for `<`/`<=`) or `low` (for `>`/`>=`) to the
 *         parsed bound and keep the trimmed text.
 *       * Otherwise, leave `low` and `high` undefined (omitted) and keep
 *         the trimmed text verbatim.
 *   - When `text` is absent, preserve the input's `low` / `high` as-is
 *     (the Field_Extractor never produces this shape, but external callers
 *     may; we don't fabricate or destroy data).
 *
 * The function only ever assigns properties when their values are defined,
 * so the resulting object plays well with `exactOptionalPropertyTypes`.
 */
function normalizeRange(range: LabReferenceRange): LabReferenceRange {
  const result: LabReferenceRange = {};

  if (range.text !== undefined) {
    const trimmedText = range.text.trim();
    result.text = trimmedText;

    // ── 1. Two-sided numeric range: "12 – 17" ───────────────────────────────
    const twoSidedMatch = REFERENCE_RANGE_NUMERIC.exec(trimmedText);
    if (twoSidedMatch !== null) {
      const lowStr  = twoSidedMatch[1];
      const highStr = twoSidedMatch[2];
      if (lowStr !== undefined && highStr !== undefined) {
        result.low  = Number.parseFloat(lowStr);
        result.high = Number.parseFloat(highStr);
      }
      return result;
    }

    // ── 2. One-sided comparison range: "< 30", "> 40", ">= 1.5", "<= 5" ────
    //
    // Clinical-safety fix (issues #5 and #8):
    //   "LP(a) 31.6 mg/dL, ref < 30"  → high=30 → classifier flags HIGH ✓
    //   "Urea  53.5,        ref < 52"  → high=52 → classifier flags HIGH ✓
    //
    // Operator semantics:
    //   < X  or <= X  (or ≤)  → upper-limit only: set high = X
    //   > X  or >= X  (or ≥)  → lower-limit only: set low  = X
    const compMatch = REFERENCE_RANGE_COMPARISON.exec(trimmedText);
    if (compMatch !== null) {
      const op    = compMatch[1];
      const bound = compMatch[2];
      if (op !== undefined && bound !== undefined) {
        const numericBound = Number.parseFloat(bound);
        if (!Number.isNaN(numericBound)) {
          if (op === '<' || op === '<=' || op === '\u2264') {
            result.high = numericBound;   // anything above → HIGH
          } else {
            result.low = numericBound;    // anything below → LOW
          }
        }
      }
      return result;
    }

    // text present but matches no known numeric form → keep text only (Req 6.5).
  } else {
    // No text: preserve pre-existing numeric bounds verbatim (idempotency).
    if (range.low  !== undefined) result.low  = range.low;
    if (range.high !== undefined) result.high = range.high;
  }

  return result;
}

