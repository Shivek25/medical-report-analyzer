/**
 * src/lib/parser/field-extractor.ts
 *
 * Phase 2 sub-module: Field_Extractor.
 *
 * Parses a single (already-merged) `DetectedRow` into a typed `LabEntry`
 * following the row grammar:
 *
 *     <test name> <value> [<unit>] [<flag>] [<reference range>] [<notes>]
 *
 * Behaviour summary (Requirement 5):
 *   - testName / value are required; their absence flips `uncertain` to true
 *     and records `uncertaintyReason = "Missing <field>; raw: '<row text>'"`.
 *   - unit / flag / range / notes are all optional. When absent, they remain
 *     `undefined`.
 *   - Only `H | L | * | HIGH | LOW | CRITICAL | ABNORMAL` are recognised
 *     flags. Anything else in flag position is routed to `notes`.
 *   - When an optional field is *present* in the row but cannot be parsed,
 *     the field is left `undefined` and a parse-failure note is appended to
 *     `uncertaintyReason` (the entry is otherwise emitted normally).
 *
 * Determinism / purity (design.md, Pipeline section):
 *   - This function performs no I/O, accesses no shared mutable state, and
 *     produces the same output for the same input across calls.
 *
 * The function never throws for any `DetectedRow`. Errors during parsing are
 * always converted into the structured uncertainty channel on the returned
 * `LabEntry`.
 */

import type { DetectedRow, LabEntry, LabReferenceRange } from '../types/index.js';
import {
  extractMeaningfulTestName,
  isGenericDescriptorToken,
} from './noise-filter.js';
import {
  FLAG_TOKEN_ANCHORED,
  NUMERIC_VALUE_ANCHORED,
  QUALITATIVE_VALUE_ANCHORED,
  REFERENCE_RANGE_COMPARISON,
  REFERENCE_RANGE_NUMERIC,
  REFERENCE_RANGE_QUALITATIVE,
  UNIT_TOKEN_ANCHORED,
} from './patterns.js';

// ─── Generic test-name guard ───────────────────────────────────────────────────

/**
 * Exact (case-insensitive) test names that are generic descriptors, not real
 * biomarker names. An entry whose testName resolves to one of these after
 * descriptor/column-label stripping (see {@link extractMeaningfulTestName}) is
 * marked `uncertain = true` so downstream summary-builder can skip it.
 *
 * Single-char / single-symbol orphans (`%`, `>`, …) also end up here because
 * they appear as orphan column-extraction artefacts. The full set of technology
 * and methodology descriptors is owned by the noise-filter module and reached
 * through {@link isGenericDescriptorToken}; this local set only carries the
 * symbol/fragment orphans that have no place in the descriptor vocabulary.
 */
const GENERIC_TEST_NAMES = new Set([
  'calculated pq', 'cph detection',
  'hf & ei', 'hf & fc',
  'ratio', '%', '>', '<', 'male:', 'female:', 'male :', 'female :',
  'adults :', 'adult :', 'pq',
  // Empty string / whitespace
  '',
]);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract typed fields from a merged lab row's text.
 *
 * @param row - The detected row (post-merge text in `row.rawText`).
 * @returns A `LabEntry` populated according to the row grammar. Required-field
 *          misses are reported via `uncertain` + `uncertaintyReason`; present-
 *          but-unparseable optional fields are left `undefined` with a
 *          parse-failure note appended to `uncertaintyReason`.
 */
export function extract(row: DetectedRow): LabEntry {
  const rawText = row.rawText;
  const trimmed = rawText.trim();
  const category = row.category ?? 'Uncategorized';

  // Empty / whitespace-only row → both required fields missing.
  if (trimmed === '') {
    return buildUncertainEntry({
      category,
      missingFields: ['testName', 'value'],
      rawText,
    });
  }

  const tokens = trimmed.split(/\s+/);

  // Locate the first token that is a numeric or qualitative value.
  const valueIdx = findValueIndex(tokens);

  if (valueIdx === -1) {
    // No value token found anywhere — required field "value" is missing.
    // We still surface whatever leading text we have as the testName so
    // downstream consumers can see the row's context (Req 5.7 — "continue
    // processing the remaining fields"). The testName is still run through the
    // descriptor/column-label sanitiser so a row that is *entirely* a
    // descriptor/label fragment (e.g. "CALCULATED", "Flow Cytometry") is flagged
    // ambiguous and skipped by the orchestrator rather than emitted as a finding.
    const rawName = tokens.join(' ');
    const meaningfulName = extractMeaningfulTestName(rawName);
    const hasMeaningfulName = meaningfulName.length > 0 && !isGenericDescriptorToken(meaningfulName);
    const entry: LabEntry = {
      testName: rawName,
      value: '',
      category,
      uncertain: true,
      uncertaintyReason: `Missing value; raw: '${rawText}'`,
    };
    if (!hasMeaningfulName) {
      entry.uncertaintyReason = `Ambiguous test name; raw: '${rawText}'`;
    }
    return entry;
  }

  const missingFields: string[] = [];

  // testName is everything before the value token.
  // When the value is the first token (valueIdx === 0), there is no test name.
  // Use the raw text as a fallback so the validator's min(1) constraint is
  // satisfied — the entry is still marked uncertain with a missing-testName
  // reason so downstream consumers know the name was not extracted.
  let testName = '';
  if (valueIdx === 0) {
    missingFields.push('testName');
    testName = trimmed; // fallback: use the full raw text as testName
  } else {
    testName = tokens.slice(0, valueIdx).join(' ');
  }

  // ── Post-extraction test-name sanitisation ───────────────────────────────────
  // Strip leading column-label prefixes and leading/trailing generic assay
  // descriptors from the extracted testName via the shared noise-filter helper.
  //   "UNITS 25-OH VITAMIN D (TOTAL)"   → "25-OH VITAMIN D (TOTAL)"
  //   "TC/ HDL CHOLESTEROL RATIO CALCULATED" → "TC/ HDL CHOLESTEROL RATIO"
  //   "CALCULATED" (orphan)            → ""   → marked uncertain below.
  const meaningfulName = extractMeaningfulTestName(testName);
  if (meaningfulName !== testName) {
    testName = meaningfulName;
    if (testName === '') {
      // The entire testName was a descriptor/column-label — mark uncertain.
      missingFields.push('testName');
      testName = trimmed; // keep raw as fallback for validator min(1)
    }
  }

  // Guard: reject entries whose final testName is a known generic/orphan label,
  // a generic assay descriptor token, or a standalone unit token.
  const lowerName = testName.trim().toLowerCase();
  const isGeneric =
    GENERIC_TEST_NAMES.has(lowerName) ||
    isGenericDescriptorToken(testName) ||
    UNIT_TOKEN_ANCHORED.test(testName.trim());

  const value = tokens[valueIdx] ?? '';
  const remaining = tokens.slice(valueIdx + 1);

  const optional = parseOptionalFields(remaining);

  // ── Assemble the entry ──────────────────────────────────────────────────────
  // exactOptionalPropertyTypes is enabled: only set optional keys when we have
  // a value to assign (assigning `undefined` would be a type error).
  const entry: LabEntry = {
    testName,
    value,
    category,
    uncertain: isGeneric ? true : false,
  };

  if (optional.unit !== undefined) entry.unit = optional.unit;
  if (optional.flag !== undefined) entry.flag = optional.flag;
  if (optional.referenceRange !== undefined) entry.referenceRange = optional.referenceRange;
  if (optional.notes !== undefined) entry.notes = optional.notes;

  // ── Uncertainty + parse-failure aggregation ─────────────────────────────────
  const reasonParts: string[] = [];

  if (isGeneric) {
    reasonParts.push(`Generic test name "${testName}"; raw: '${rawText}'`);
  }

  if (missingFields.length > 0) {
    entry.uncertain = true;
    for (const f of missingFields) {
      reasonParts.push(`Missing ${f}; raw: '${rawText}'`);
    }
  }

  for (const failure of optional.parseFailures) {
    reasonParts.push(failure);
  }

  if (reasonParts.length > 0) {
    entry.uncertaintyReason = reasonParts.join(' | ');
  }

  return entry;
}

// ─── Internals ────────────────────────────────────────────────────────────────

/**
 * Result of parsing the post-value portion of a row. Each optional field is
 * `undefined` when not extracted; `parseFailures` collects structural notes
 * for fields that were present but unparseable.
 */
interface OptionalFields {
  unit: string | undefined;
  flag: string | undefined;
  referenceRange: LabReferenceRange | undefined;
  notes: string | undefined;
  parseFailures: string[];
}

/** Build a `LabEntry` for the case where required fields are missing. */
function buildUncertainEntry(args: {
  category: string;
  missingFields: string[];
  rawText: string;
}): LabEntry {
  const { category, missingFields, rawText } = args;
  const reasons = missingFields.map((f) => `Missing ${f}; raw: '${rawText}'`).join(' | ');
  return {
    testName: '',
    value: '',
    category,
    uncertain: true,
    uncertaintyReason: reasons,
  };
}

/**
 * Find the index of the first token that is, by itself, a recognised value
 * (numeric or qualitative). Returns -1 when no such token exists.
 */
function findValueIndex(tokens: readonly string[]): number {
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (NUMERIC_VALUE_ANCHORED.test(tok) || QUALITATIVE_VALUE_ANCHORED.test(tok)) {
      return i;
    }
  }
  return -1;
}

/**
 * Walk the tokens following the value in grammar order:
 *
 *     [unit] [flag] [reference range] [notes]
 *
 * Each slot is best-effort and optional; unrecognised tokens are routed to
 * the notes accumulator.
 */
function parseOptionalFields(remaining: readonly string[]): OptionalFields {
  const result: OptionalFields = {
    unit: undefined,
    flag: undefined,
    referenceRange: undefined,
    notes: undefined,
    parseFailures: [],
  };
  const notesAccum: string[] = [];

  let idx = 0;

  // Slot 1: unit (optional). Greedy multi-token match — Thyrocare prints
  // composite units like `X 10³ / μL` and `X 10^6 / µL` that tokenise to
  // 4 whitespace-separated tokens but represent a single unit. Try the
  // longest match first (4 tokens), shrinking down to a single token, and
  // accept the first slice whose joined form matches `UNIT_TOKEN_ANCHORED`.
  if (idx < remaining.length) {
    const maxSpan = Math.min(4, remaining.length - idx);
    for (let span = maxSpan; span >= 1; span -= 1) {
      const candidate = remaining.slice(idx, idx + span).join(' ');
      if (UNIT_TOKEN_ANCHORED.test(candidate)) {
        result.unit = candidate;
        idx += span;
        break;
      }
    }
  }

  // Slot 2: flag (optional). Recognised tokens fill `flag`; an unrecognised
  // token in the flag position is routed to `notes` (Req 5.5). A token that
  // looks like the start of a range is left for slot 3.
  if (idx < remaining.length) {
    const tok = remaining[idx]!;
    if (FLAG_TOKEN_ANCHORED.test(tok)) {
      result.flag = tok;
      idx++;
    } else if (!looksLikeRangeStart(tok)) {
      // Unrecognised flag-position token → notes; advance.
      notesAccum.push(tok);
      idx++;
    }
  }

  // Slot 3: reference range (optional).
  if (idx < remaining.length) {
    const rangeMatch = tryParseRange(remaining, idx);
    if (rangeMatch !== null) {
      result.referenceRange = rangeMatch.range;
      idx = rangeMatch.nextIdx;
    }
  }

  // Slot 4: notes — everything left over.
  for (let i = idx; i < remaining.length; i++) {
    notesAccum.push(remaining[i]!);
  }

  if (notesAccum.length > 0) {
    result.notes = notesAccum.join(' ');
  }

  return result;
}

/**
 * Predicate: does this token look like the *first* token of a reference
 * range? Used to decide whether an unrecognised flag-position token should
 * be routed to notes (true → leave it for the range parser).
 */
function looksLikeRangeStart(tok: string): boolean {
  if (tok.length === 0) return false;
  const first = tok[0]!;
  // Numeric (with optional sign) or comparison operator.
  if (/[-+0-9]/.test(first)) return true;
  if (first === '<' || first === '>' || first === '\u2264' || first === '\u2265') return true;
  // Qualitative range token (e.g., "Negative").
  if (REFERENCE_RANGE_QUALITATIVE.test(tok)) return true;
  return false;
}

/**
 * Attempt to consume a reference range starting at `remaining[startIdx]`.
 *
 * Tries, in order:
 *   1. Single-token numeric range (`12.0-16.0`).
 *   2. Single-token comparison range (`<30`).
 *   3. Single-token qualitative range (`Negative`).
 *   4. Two-token comparison range (`< 30`).
 *   5. Three-token numeric range (`12.0 - 16.0`).
 *
 * Returns `null` when nothing range-shaped is found.
 */
function tryParseRange(
  remaining: readonly string[],
  startIdx: number,
): { range: LabReferenceRange; nextIdx: number } | null {
  const tok0 = remaining[startIdx];
  if (tok0 === undefined) return null;

  // 1. Single-token numeric: "12.0-16.0".
  const numMatch = REFERENCE_RANGE_NUMERIC.exec(tok0);
  if (numMatch !== null) {
    const low = Number.parseFloat(numMatch[1]!);
    const high = Number.parseFloat(numMatch[2]!);
    const range: LabReferenceRange = { text: tok0 };
    if (Number.isFinite(low)) range.low = low;
    if (Number.isFinite(high)) range.high = high;
    return { range, nextIdx: startIdx + 1 };
  }

  // 2. Single-token comparison: "<30".
  const compMatch1 = REFERENCE_RANGE_COMPARISON.exec(tok0);
  if (compMatch1 !== null) {
    const operator = compMatch1[1]!;
    const bound = Number.parseFloat(compMatch1[2]!);
    const range: LabReferenceRange = { text: tok0 };
    if (Number.isFinite(bound)) {
      if (operator === '<' || operator === '<=' || operator === '\u2264') range.high = bound;
      else if (operator === '>' || operator === '>=' || operator === '\u2265') range.low = bound;
    }
    return { range, nextIdx: startIdx + 1 };
  }

  // 3. Single-token qualitative: "Negative".
  if (REFERENCE_RANGE_QUALITATIVE.test(tok0)) {
    return { range: { text: tok0 }, nextIdx: startIdx + 1 };
  }

  // 4. Two-token comparison: "< 30".
  if (startIdx + 1 < remaining.length) {
    const combined2 = `${tok0} ${remaining[startIdx + 1]!}`;
    const compMatch2 = REFERENCE_RANGE_COMPARISON.exec(combined2);
    if (compMatch2 !== null) {
      const operator = compMatch2[1]!;
      const bound = Number.parseFloat(compMatch2[2]!);
      const range: LabReferenceRange = { text: combined2 };
      if (Number.isFinite(bound)) {
        if (operator === '<' || operator === '<=' || operator === '\u2264') range.high = bound;
        else if (operator === '>' || operator === '>=' || operator === '\u2265') range.low = bound;
      }
      return { range, nextIdx: startIdx + 2 };
    }
  }

  // 5. Three-token numeric: "12.0 - 16.0".
  if (startIdx + 2 < remaining.length) {
    const combined3 = `${tok0} ${remaining[startIdx + 1]!} ${remaining[startIdx + 2]!}`;
    const num3 = REFERENCE_RANGE_NUMERIC.exec(combined3);
    if (num3 !== null) {
      const low = Number.parseFloat(num3[1]!);
      const high = Number.parseFloat(num3[2]!);
      const range: LabReferenceRange = { text: combined3 };
      if (Number.isFinite(low)) range.low = low;
      if (Number.isFinite(high)) range.high = high;
      return { range, nextIdx: startIdx + 3 };
    }
  }

  return null;
}
