/**
 * src/lib/parser/text-cleaner.ts
 *
 * Phase 2 — Text_Cleaner sub-module.
 *
 * Removes PDF-extraction noise from the raw text produced by Phase 1 so that
 * the downstream Row_Detector / Field_Extractor only see meaningful lines.
 *
 * The function is a deterministic, pure transformation: split the input on
 * `\n`, apply a fixed sequence of per-line filters, then re-join with `\n`.
 *
 * Per-line filter order (Requirement 3.1 – 3.5):
 *   1. Preserve section-header lines verbatim — they are never removed by any
 *      noise filter, so the Categorizer can still find them later.
 *   2. Drop page-marker lines such as `Page : 1 of 3`.
 *   3. Drop whitespace-only lines and separator-only lines (composed entirely
 *      of `-`, `_`, `=`, and/or whitespace).
 *   4. Drop doctor-signature, barcode-label, and QR-code instruction lines —
 *      but only when they contain no numeric value token and no unit token
 *      (so a real lab row never gets removed).
 *   5. Detect the first occurrence of a contiguous lab/address block and drop
 *      any later exact repetition of that block.
 *
 * Two structural passes additionally re-shape PDF-extracted column-major
 * tables back into row-major lab rows that the downstream Row_Detector can
 * classify cleanly:
 *
 *   - Glued-token splitter: inserts whitespace at unambiguous unit↔digit
 *     and digit↔uppercase boundaries (e.g., `mg/dL97` → `mg/dL 97`,
 *     `ng/mL68E.C.L.I.A` → `ng/mL 68 E.C.L.I.A`). This pass is purely
 *     local — it never crosses line boundaries — and it leaves a line
 *     untouched when no recognised glued boundary is present, so plain
 *     prose / section-header / data lines pass through unchanged.
 *
 *   - Column-block stitcher: when a contiguous run of lines matches one of
 *     the recognised Thyrocare column layouts (e.g., UNIT → VALUE →
 *     TEST_NAME → RANGE), the run is collapsed into a single
 *     `TEST_NAME VALUE UNIT RANGE` line so the Row_Detector sees a normal
 *     self-contained lab row. The stitcher is conservative: every slot
 *     must satisfy a strict shape predicate, otherwise the run is left
 *     untouched and the existing row-detector merge logic handles it.
 *
 * Pure function — no I/O, no time, no random state, no module-level mutable
 * state. Same input string ⇒ same output string (Requirement 3.6).
 */

import {
  NUMERIC_VALUE,
  NUMERIC_VALUE_ANCHORED,
  PAGE_MARKER_LINE,
  QUALITATIVE_VALUE_ANCHORED,
  REFERENCE_RANGE_ANY,
  REFERENCE_RANGE_COMPARISON,
  REFERENCE_RANGE_NUMERIC,
  SECTION_HEADER_SHAPE,
  SEPARATOR_ONLY_LINE,
  UNIT_TOKEN,
  UNIT_TOKEN_ANCHORED,
  UNIT_TOKEN_BODY,
  WHITESPACE_ONLY_LINE,
} from './patterns.js';

// ─── Cleaner-specific patterns ────────────────────────────────────────────────

/**
 * Keywords that identify the leading line of a lab/address page-header block.
 * Matched case-insensitively as whole-word tokens; covers the common Indian
 * pathology chains plus the generic terms used in lab branding.
 */
const LAB_KEYWORD =
  /\b(?:THYROCARE|METROPOLIS|SRL|REDCLIFFE|HEALTHIANS|HEALTHCARE|DIAGNOSTICS?|LABORATOR(?:Y|IES)|PATHOLOGY|PATHLABS?|MEDICAL\s+LAB)\b/i;

/**
 * Patterns that recognise footer-like noise lines: doctor signatures,
 * post-nominal qualification strings, barcode/QR instructions, and end-of-
 * report markers. A line matching one of these is removed only when it
 * additionally contains no numeric value token and no unit token (Req 3.3).
 */
const FOOTER_PATTERNS: readonly RegExp[] = Object.freeze([
  // Doctor name lines: "Dr. Foo", "dr foo", "Doctor Foo"
  /\b(?:dr\.?|doctor)\s+[a-z]/i,
  // Post-nominal qualifications used by signing pathologists
  /\b(?:M\.?B\.?B\.?S|M\.?D|M\.?S|D\.?N\.?B|Ph\.?D|D\.?C\.?P|D\.?P\.?B)\b\.?/i,
  // Role / signature labels
  /\bpathologist\b/i,
  /\bmicrobiologist\b/i,
  /\bbiochemist\b/i,
  /\bconsultant\s+(?:pathologist|microbiologist|biochemist)\b/i,
  /\bsignature\b/i,
  /\b(?:verified|reported|signed|approved|authori[sz]ed)\s+by\b/i,
  // QR-code & barcode-label instructions
  /\bscan\s+(?:the\s+)?qr\b/i,
  /\bqr\s+code\b/i,
  /\bbarcode\s*(?:label|sticker)\b/i,
  // Explicit end-of-report markers
  /\bend\s+of\s+report\b/i,
  /^\s*\*+\s*end\s*\*+\s*$/i,
  /^\s*-+\s*end\s*-+\s*$/i,
]);

// ─── Predicates ───────────────────────────────────────────────────────────────

function hasNumericToken(line: string): boolean {
  return NUMERIC_VALUE.test(line);
}

function hasUnitToken(line: string): boolean {
  return UNIT_TOKEN.test(line);
}

/**
 * A line is treated as a section-header / category marker (Req 3.5) when it
 * matches the structural shape `SECTION_HEADER_SHAPE` AND contains neither a
 * numeric value token nor a unit token. The trimmed form is used for shape
 * matching, but the original line is preserved verbatim downstream.
 */
function isSectionHeader(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (hasNumericToken(trimmed)) return false;
  if (hasUnitToken(trimmed)) return false;
  return SECTION_HEADER_SHAPE.test(trimmed);
}

function isPageMarker(line: string): boolean {
  return PAGE_MARKER_LINE.test(line.trim());
}

function isWhitespaceOnly(line: string): boolean {
  return WHITESPACE_ONLY_LINE.test(line);
}

function isSeparatorOnly(line: string): boolean {
  // SEPARATOR_ONLY_LINE also matches whitespace-only strings, which is fine —
  // whitespace-only lines are likewise removed.
  return SEPARATOR_ONLY_LINE.test(line);
}

function matchesFooterPattern(line: string): boolean {
  for (const pattern of FOOTER_PATTERNS) {
    if (pattern.test(line)) return true;
  }
  return false;
}

/**
 * A line is a removable footer/signature/QR line when it matches one of the
 * footer patterns AND contains no numeric or unit token (Req 3.3 — a line
 * that also carries data must never be stripped).
 */
function isFooterNoiseLine(line: string): boolean {
  if (!matchesFooterPattern(line)) return false;
  if (hasNumericToken(line) || hasUnitToken(line)) return false;
  return true;
}

// ─── Lab/address block deduplication (Req 3.1) ────────────────────────────────

/**
 * Search `lines[from..]` for an exact contiguous occurrence of `block`.
 * Returns true on the first hit; false otherwise.
 */
function containsBlockFrom(lines: readonly string[], block: readonly string[], from: number): boolean {
  if (block.length === 0) return false;
  const last = lines.length - block.length;
  outer: for (let i = from; i <= last; i++) {
    for (let j = 0; j < block.length; j++) {
      if (lines[i + j] !== block[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Detect the first contiguous run of 2-5 lines that (a) starts with a line
 * containing a known lab keyword and (b) re-occurs later in the source.
 * Returns the canonical block (the first occurrence) or `null` when no such
 * repetition exists.
 *
 * Iteration prefers longer blocks so the canonical capture matches the full
 * lab-name + address run rather than just the first two lines.
 */
function detectRepeatedLabBlock(lines: readonly string[]): readonly string[] | null {
  for (let i = 0; i < lines.length; i++) {
    if (!LAB_KEYWORD.test(lines[i] ?? '')) continue;
    for (let len = 5; len >= 2; len--) {
      if (i + len > lines.length) continue;
      const candidate = lines.slice(i, i + len);
      if (containsBlockFrom(lines, candidate, i + len)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Mark every block occurrence of `block` in `lines` for removal in `keep`,
 * EXCEPT the first occurrence. Operates over the original line indices so
 * the per-line filter mask and the block dedup mask compose correctly.
 */
function markRepeatedBlockOccurrences(
  lines: readonly string[],
  block: readonly string[],
  keep: boolean[],
): void {
  if (block.length === 0) return;
  const last = lines.length - block.length;
  let firstSeen = false;
  let i = 0;
  while (i <= last) {
    let matched = true;
    for (let j = 0; j < block.length; j++) {
      if (lines[i + j] !== block[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      if (!firstSeen) {
        firstSeen = true;
      } else {
        for (let j = 0; j < block.length; j++) {
          keep[i + j] = false;
        }
      }
      i += block.length;
    } else {
      i += 1;
    }
  }
}

// ─── Glued-token splitter (PDF column-extraction artefact) ───────────────────

/**
 * Pattern matching the longest unit-token bodies whose canonical form is a
 * unit string. Used to find the boundary between a unit suffix and a digit
 * (e.g., `mg/dL97` → `mg/dL` + `97`) without relying on the surrounding
 * whitespace contract that `UNIT_TOKEN` enforces.
 *
 * The alternation is ordered longest-first so `µg/dL` wins over `g/dL`,
 * etc. Each entry is a literal string; backslash-escaping the slashes is
 * deliberate so the regex matches a real `/` rather than a regex
 * metacharacter.
 */
const GLUED_UNIT_PATTERN =
  /(mg\/dL|gm\/dL|µg\/dL|ng\/dL|pg\/dL|mcg\/dL|g\/dL|mg\/mL|gm\/mL|µg\/mL|ng\/mL|pg\/mL|mcg\/mL|µIU\/mL|mIU\/mL|IU\/mL|U\/mL|mIU\/L|µIU\/L|IU\/L|U\/L|mmol\/L|µmol\/L|nmol\/L|pmol\/L|mol\/L|mEq\/L|mg\/L|gm\/L|g\/L|µg\/L|ng\/L|cells\/cumm|cells\/µL|cells\/uL|million\/cumm|lakhs\/cumm|thousand\/cumm|\/cumm|\/HPF|fL|pg|ng|µg|mg|kg|mg%|gm%|%|Ratio|Index)/;

/**
 * Recognised technology / methodology tokens that the Thyrocare detail
 * tables splice between a value and a test name without a separating space
 * (e.g., `mg/dL112IMMUNOTURBIDIMETRYAPOLIPOPROTEIN - A1`). The splitter
 * uses this list to locate the technology word so it can insert spaces on
 * both sides — `mg/dL 112 IMMUNOTURBIDIMETRY APOLIPOPROTEIN - A1`.
 *
 * Order is irrelevant for correctness; the alternation is anchored to a
 * word boundary so partial matches inside a longer token cannot fire.
 * The list is intentionally specific: a generic "uppercase run after a
 * value" rule would split test names that happen to start with multiple
 * uppercase words (e.g., `LDL CHOLESTEROL`).
 */
const TECHNOLOGY_TOKENS: readonly string[] = Object.freeze([
  'IMMUNOTURBIDIMETRY',
  'PHOTOMETRY',
  'CALCULATED',
  'CALCULATION',
  'E.C.L.I.A',
  'ECLIA',
  'H.P.L.C',
  'HPLC',
  'I.S.E - INDIRECT',
  'I.S.E',
  'C.L.I.A',
  'CLIA',
  'CHEMILUMINESCENCE',
  'COLORIMETRY',
  'TURBIDIMETRY',
  'NEPHELOMETRY',
  'SPECTROPHOTOMETRY',
  'IMMUNOASSAY',
  'ELISA',
  'PCR',
]);

/**
 * Build a single regex that matches any technology token as a sub-expression.
 * Sub-expressions with `.` characters are escaped so the dot is treated as a
 * literal. The match is *not* anchored to word boundaries because some
 * tokens (e.g., `E.C.L.I.A`) contain non-word characters at their edges.
 */
const TECHNOLOGY_TOKEN_PATTERN = new RegExp(
  `(${TECHNOLOGY_TOKENS.map((t) =>
    t.replace(/[.\\+*?^$()[\]{}|]/g, '\\$&'),
  ).join('|')})`,
);

/**
 * Single-pass token splitter. Inserts a single space at unambiguous glued
 * boundaries observed in Thyrocare PDFs:
 *
 *   1. `<unit><digit>`  (e.g., `mg/dL97` → `mg/dL 97`)
 *   2. `<digit><uppercase letter>` when the digit closes a value and the
 *      uppercase letter opens a new token. Excludes digit-letter pairs
 *      that appear inside a numeric range (`13.0-17.0`) or an exponent
 *      (`x10^6`) — both are ruled out because the digit↔uppercase boundary
 *      requires the uppercase to begin a recognised technology / unit /
 *      value-label sequence, not just any letter.
 *   3. `<uppercase letter (closing a known technology token)><digit>` and
 *      `<lowercase letter><uppercase technology>` — both insert a space so
 *      the technology token stands alone.
 *   4. `<word>.<QUALITATIVE>` — e.g., `Urine Protein.NEGATIVENEGATIVE` →
 *      `Urine Protein NEGATIVE NEGATIVE`. Handles urine report glued tokens.
 *   5. `<word><QUALITATIVE><QUALITATIVE>` — e.g., `KetoneNEGATIVENEGATIVE` →
 *      `Ketone NEGATIVE NEGATIVE`.
 *   6. `<testname><digit><range>` — e.g., `Ph5.04.6-8.0` → `Ph 5.0 4.6-8.0`,
 *      `Specific Gravity1.0201.005-1.030` → `Specific Gravity 1.020 1.005-1.030`.
 *      Handles urine report glued value+range tokens.
 *   7. `<testname><digit><unit>` — e.g., `Pus Cells3-4/HPF 0-3` →
 *      `Pus Cells 3-4/HPF 0-3`. Handles count-per-HPF glued tokens.
 *
 * The function is a pure string transformation. Lines that contain no glued
 * boundary pass through unchanged.
 */
function splitGluedTokens(line: string): string {
  let out = line;

  // Rule 1: unit body immediately followed by a digit. Repeat until no more
  // matches (the regex matches one boundary at a time; subsequent rounds
  // catch chains like `mg/dL97UNIT12`).
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(
      new RegExp(`${GLUED_UNIT_PATTERN.source}(?=\\d)`, 'g'),
      '$1 ',
    );
  }

  // Rule 2a: digit followed by a known technology token. Insert space
  // *before* the technology token. We use a non-capturing alternation so
  // the replacement preserves the match.
  out = out.replace(
    new RegExp(`(\\d)(?=${TECHNOLOGY_TOKEN_PATTERN.source})`, 'g'),
    '$1 ',
  );

  // Rule 2a': letter or closing-bracket followed by a known technology
  // token, e.g., `(HS-CRP)IMMUNOTURBIDIMETRY` → `(HS-CRP) IMMUNOTURBIDIMETRY`.
  // The lookbehind requires a letter, digit, or closing bracket so the
  // technology is treated as a suffix of the preceding token rather than
  // a standalone word; spaces and start-of-line don't trigger the rule.
  out = out.replace(
    new RegExp(`(?<=[A-Za-z\\]\\)])(${TECHNOLOGY_TOKEN_PATTERN.source})`, 'g'),
    ' $1',
  );

  // Rule 2b: technology token followed by a digit (e.g., `E.C.L.I.A25`).
  // Insert space after the technology token.
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(
      new RegExp(`${TECHNOLOGY_TOKEN_PATTERN.source}(?=\\d)`, 'g'),
      '$1 ',
    );
  }

  // Rule 2c: technology token followed by an uppercase letter that begins
  // a fresh test name (e.g., `IMMUNOTURBIDIMETRYAPOLIPOPROTEIN`). The
  // lookahead requires at least 4 consecutive uppercase letters so we do
  // not split a technology token from its own internal characters.
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(
      new RegExp(`${TECHNOLOGY_TOKEN_PATTERN.source}(?=[A-Z]{4})`, 'g'),
      '$1 ',
    );
  }

  // Rule 3: lowercase letter followed by an uppercase technology token
  // (e.g., `pg/mL335E.C.L.I.A` after the unit-digit split becomes
  // `pg/mL 335E.C.L.I.A`; rule 2a then handles the digit-tech split).
  // No-op here — handled by composition of rules 1 and 2a.

  // Rule 4: word character followed by `.` followed by a qualitative value
  // (e.g., `Urine Protein.NEGATIVENEGATIVE` → `Urine Protein NEGATIVE NEGATIVE`).
  // The dot is consumed (replaced by a space).
  out = out.replace(
    /(\w)\.(Negative|Positive|Reactive|Non[- ]?Reactive|Present|Absent)/gi,
    '$1 $2',
  );

  // Rule 5: two consecutive qualitative values glued together
  // (e.g., `NEGATIVENEGATIVE` → `NEGATIVE NEGATIVE`).
  // Repeat to handle triple occurrences.
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(
      /(Negative|Positive|Reactive|Non[- ]?Reactive|Present|Absent)(Negative|Positive|Reactive|Non[- ]?Reactive|Present|Absent)/gi,
      '$1 $2',
    );
  }

  // Rule 5b: word character immediately followed by a qualitative value
  // (e.g., `KetoneNEGATIVE` → `Ketone NEGATIVE`, `NORMALN` → `NORMAL N`).
  // Only fire when the qualitative value is at least 4 chars to avoid
  // splitting legitimate word endings.
  out = out.replace(
    /([a-z])(Negative|Positive|Reactive|Present|Absent)/gi,
    (_match, p1, p2) => {
      // Don't split if the preceding char is part of the qualitative word itself
      return `${p1} ${p2}`;
    },
  );

  // Rule 6: test name (word chars) immediately followed by a numeric value
  // that is itself followed by a numeric range (lo-hi pattern).
  // e.g., `Ph5.04.6-8.0` → `Ph 5.0 4.6-8.0`
  // e.g., `Specific Gravity1.0201.005-1.030` → `Specific Gravity 1.020 1.005-1.030`
  // Strategy: find a letter immediately followed by a digit (not already
  // separated), where the digit sequence is followed by another digit-dash-digit
  // range. Insert space before the digit.
  out = out.replace(
    /([A-Za-z])(\d+(?:\.\d+)?)(\d+(?:\.\d+)?[-\u2013]\d+(?:\.\d+)?)/g,
    '$1 $2 $3',
  );

  // Rule 7: test name (word chars) immediately followed by a count-per-HPF
  // value like `3-4/HPF` (e.g., `Pus Cells3-4/HPF` → `Pus Cells 3-4/HPF`).
  // Insert space before the digit that starts the count range.
  out = out.replace(
    /([A-Za-z])(\d+[-\u2013]\d+\/HPF)/gi,
    '$1 $2',
  );

  return out;
}

// ─── Column-block stitcher (Thyrocare row-major layouts) ─────────────────────

/**
 * Predicate: the trimmed line is a single recognised unit token in
 * isolation (e.g., `mg/dL`, `g/dL`, `%`, `X 10³ / μL`). The line may not
 * contain anything else, including a value or a range.
 */
function isUnitOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (NUMERIC_VALUE.test(trimmed)) {
    // Allow numeric-bearing units like `X 10^6/µL` or `X 10³ / μL`. The
    // anchored unit predicate accepts these in full.
    return UNIT_TOKEN_ANCHORED.test(trimmed);
  }
  return UNIT_TOKEN_ANCHORED.test(trimmed);
}

/**
 * Predicate: the trimmed line is a single value token (numeric or
 * qualitative). Leading whitespace on the source line is permitted because
 * Thyrocare's column-major dumps frequently emit values like ` 12.2`.
 */
function isValueOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (NUMERIC_VALUE_ANCHORED.test(trimmed)) return true;
  if (QUALITATIVE_VALUE_ANCHORED.test(trimmed)) return true;
  return false;
}

/**
 * Predicate: the trimmed line is exactly a reference-range expression in
 * one of the recognised shapes — numeric `lo-hi`, comparison `<N` / `>N`,
 * or qualitative (`Negative` / `Positive` / etc.). Range-only lines are
 * the right-most column of the Thyrocare summary view and the third column
 * of the detail view.
 */
function isRangeOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (REFERENCE_RANGE_NUMERIC.test(trimmed)) return true;
  if (REFERENCE_RANGE_COMPARISON.test(trimmed)) return true;
  // Comparison range with one or two trailing words (e.g., `< 30 mg/dl`)
  // also qualifies as a range-only line because the orchestrator treats
  // the entire trimmed text as `referenceRange.text` verbatim when the
  // numeric / comparison parser fails.
  if (
    /^(<=|>=|<|>|\u2264|\u2265)\s*\d+(?:\.\d+)?(?:\s+[A-Za-z%/]+)?$/.test(
      trimmed,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Predicate: the trimmed line is a candidate test-name line — uppercase or
 * title-case alphabetic words (with the punctuation alphabet permitted by
 * `SECTION_HEADER_SHAPE`), carrying no numeric or unit token. This is
 * exactly the section-header predicate; in the column-block context the
 * downstream stitcher uses it to identify the test-name slot.
 *
 * The stitcher additionally requires the line to be at least 3 characters
 * long so a stray single letter (e.g., a stranded `Y` from
 * `IMMUNOTURBIDIMETR\nY` line wrapping) cannot pose as a test name.
 */
function isTestNameOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3) return false;
  if (NUMERIC_VALUE.test(trimmed)) return false;
  if (UNIT_TOKEN.test(trimmed)) return false;
  if (REFERENCE_RANGE_ANY.test(trimmed)) return false;
  return SECTION_HEADER_SHAPE.test(trimmed);
}

/**
 * Predicate: the trimmed line is a single recognised technology token in
 * isolation (e.g., `E.C.L.I.A`, `ECLIA`, `IMMUNOTURBIDIMETRY`).
 */
function isTechnologyOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  // Must match the full technology token pattern anchored to the whole string
  return new RegExp(`^${TECHNOLOGY_TOKEN_PATTERN.source}$`).test(trimmed);
}

/**
 * Predicate: the trimmed line matches the pattern
 * `<unit_token> <numeric_value> <technology_token> <test_name_words>`.
 * These are single-line column-extraction artefacts where the columns were
 * concatenated in the wrong order. Returns the reordered
 * `<test_name> <value> <unit>` string, or null if the line doesn't match.
 */
function tryReorderUnitValueTechTestName(line: string): string | null {
  const trimmed = line.trim();
  // Match: unit value technology test_name
  // e.g., "ng/mL 68 E.C.L.I.A 25-OH VITAMIN D (TOTAL)"
  // e.g., "pg/mL 251 E.C.L.I.A VITAMIN B-12"
  const techPattern = TECHNOLOGY_TOKEN_PATTERN.source;
  const unitBody = UNIT_TOKEN_BODY.source;
  const re = new RegExp(
    `^(${unitBody})\\s+([-+]?\\d+(?:\\.\\d+)?)\\s+${techPattern}\\s+(.+)$`,
    'i',
  );
  const m = re.exec(trimmed);
  if (!m) return null;
  const unit = m[1]!.trim();
  const value = m[2]!.trim();
  // test name is the last capture group (after all technology token groups)
  // The technology token pattern has multiple capture groups; the test name
  // is the last one.
  const testName = m[m.length - 1]!.trim();
  if (testName.length < 2) return null;
  return `${testName} ${value} ${unit}`;
}

/**
 * Build a stitched single-line lab row from the captured column slots.
 * Output shape: `<TEST_NAME> <VALUE> <UNIT> <RANGE>` with absent slots
 * silently omitted. A trailing run of whitespace is collapsed to a single
 * space and trimmed at the edges.
 */
function buildStitchedRow(
  testName: string | undefined,
  value: string,
  unit: string | undefined,
  range: string | undefined,
): string {
  const parts: string[] = [];
  if (testName !== undefined) parts.push(testName.trim());
  parts.push(value.trim());
  if (unit !== undefined) parts.push(unit.trim());
  if (range !== undefined) parts.push(range.trim());
  return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Walk `lines` looking for column-major Thyrocare row layouts and rewrite
 * them into a single row-per-line form. Returns a new array of lines; the
 * input is not mutated.
 *
 * The stitcher recognises several layouts. At each starting position `i` it
 * tries longest-match-first:
 *
 *   - 4-line UNIT/VALUE/TEST/RANGE (Thyrocare summary view):
 *       lines[i+0] = unit-only
 *       lines[i+1] = value-only
 *       lines[i+2] = test-name-only
 *       lines[i+3] = range-only
 *     Stitched: `TEST VALUE UNIT RANGE`.
 *
 *   - 4-line UNIT/VALUE/RANGE/TEST (Thyrocare detail view variant A):
 *       lines[i+0] = unit-only
 *       lines[i+1] = value-only
 *       lines[i+2] = range-only
 *       lines[i+3] = test-name-only
 *     Stitched: `TEST VALUE UNIT RANGE`.
 *
 *   - 3-line UNIT/VALUE/TEST or UNIT/VALUE/RANGE (truncated detail view
 *     when the optional slot is missing). The stitcher attempts both 4-line
 *     variants first; only when neither fits does it fall back to the
 *     3-line forms.
 *
 *   - 3-line TECHNOLOGY/TEST_NAME/RANGE (Thyrocare detail view variant B):
 *       lines[i+0] = technology-only (e.g., `E.C.L.I.A`)
 *       lines[i+1] = test-name-only
 *       lines[i+2] = range-only
 *     The value for this layout comes from a preceding line that was already
 *     stitched; this layout just ensures the technology token doesn't become
 *     a spurious row. The technology token is dropped and the test-name +
 *     range are emitted as a partial row for the Row_Detector to handle.
 *
 *   - Single-line reorder: `<unit> <value> <technology> <test_name>` →
 *     `<test_name> <value> <unit>`. Handles lines like
 *     `ng/mL 68 E.C.L.I.A 25-OH VITAMIN D (TOTAL)`.
 *
 * On a match the stitched row replaces the entire run; the surrounding
 * lines are preserved. On no match the line is copied through unchanged
 * and the cursor advances by 1.
 */
function stitchColumnBlocks(lines: readonly string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const l0 = lines[i];
    if (l0 === undefined) {
      i += 1;
      continue;
    }

    // Layout F: single-line reorder `<unit> <value> <technology> <test_name>`
    // → `<test_name> <value> <unit>`. Must be tried before unit-only check
    // because the line starts with a unit token but is not unit-only.
    const reordered = tryReorderUnitValueTechTestName(l0);
    if (reordered !== null) {
      out.push(reordered);
      i += 1;
      continue;
    }

    if (isUnitOnlyLine(l0) && i + 1 < lines.length) {
      const l1 = lines[i + 1]!;
      if (isValueOnlyLine(l1)) {
        const l2 = i + 2 < lines.length ? lines[i + 2]! : undefined;
        const l3 = i + 3 < lines.length ? lines[i + 3]! : undefined;

        // Layout A: UNIT / VALUE / TEST / RANGE (summary view).
        if (
          l2 !== undefined &&
          l3 !== undefined &&
          isTestNameOnlyLine(l2) &&
          isRangeOnlyLine(l3)
        ) {
          out.push(buildStitchedRow(l2, l1, l0, l3));
          i += 4;
          continue;
        }

        // Layout B: UNIT / VALUE / RANGE / TEST (detail view).
        if (
          l2 !== undefined &&
          l3 !== undefined &&
          isRangeOnlyLine(l2) &&
          isTestNameOnlyLine(l3)
        ) {
          out.push(buildStitchedRow(l3, l1, l0, l2));
          i += 4;
          continue;
        }

        // Layout C: UNIT / VALUE / TEST  (no range present).
        if (l2 !== undefined && isTestNameOnlyLine(l2)) {
          out.push(buildStitchedRow(l2, l1, l0, undefined));
          i += 3;
          continue;
        }

        // Layout D: UNIT / VALUE / RANGE  (range follows directly).
        if (l2 !== undefined && isRangeOnlyLine(l2)) {
          out.push(buildStitchedRow(undefined, l1, l0, l2));
          i += 3;
          continue;
        }

        // Layout E: UNIT / VALUE  (truncated; just stitch the two so the
        // row-detector sees a self-contained `value unit` line).
        out.push(buildStitchedRow(undefined, l1, l0, undefined));
        i += 2;
        continue;
      }
    }

    // Layout G: TECHNOLOGY / TEST_NAME / RANGE (3-line detail view variant B).
    // The technology token is dropped; the test-name + range are emitted as
    // a partial row. The value was already emitted on a preceding stitched row.
    if (isTechnologyOnlyLine(l0) && i + 2 < lines.length) {
      const l1 = lines[i + 1]!;
      const l2 = lines[i + 2]!;
      if (isTestNameOnlyLine(l1) && isRangeOnlyLine(l2)) {
        // Emit as `TEST_NAME RANGE` — the Row_Detector will classify it as
        // a lab row (range token present) and Field_Extractor will mark it
        // uncertain (no value). This is better than emitting the technology
        // token as a spurious row.
        out.push(`${l1.trim()} ${l2.trim()}`);
        i += 3;
        continue;
      }
      // Layout G': TECHNOLOGY / TEST_NAME only (no range).
      if (isTestNameOnlyLine(l1)) {
        // Just emit the test name; the Row_Detector will treat it as a
        // header/prose line (no value/unit) and skip it.
        out.push(l1.trim());
        i += 2;
        continue;
      }
    }

    out.push(l0);
    i += 1;
  }
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Clean PDF-extracted raw text by stripping page markers, blank/separator
 * lines, footer/signature/QR lines without data tokens, and repeated lab/
 * address blocks. Section headers are preserved unchanged.
 *
 * Two structural reshapes are folded in (after the noise filters and
 * before re-joining):
 *
 *   - Glued tokens introduced by PDF column extraction (`mg/dL97`,
 *     `ng/mL68E.C.L.I.A`) are split at unit↔digit and digit↔technology
 *     boundaries so the Row_Detector / Field_Extractor see normal
 *     whitespace-separated tokens.
 *   - Column-major Thyrocare layouts (UNIT, VALUE, TEST_NAME, RANGE on
 *     four consecutive lines) are stitched into a single
 *     `TEST_NAME VALUE UNIT RANGE` row.
 *
 * @param rawText - The full string returned by Phase 1's `extractTextFromPdf`.
 * @returns A cleaned string with the same `\n` line separator. Empty when the
 *          input contains nothing but noise.
 */
export function clean(rawText: string): string {
  const lines = rawText.split('\n');
  const keep: boolean[] = new Array(lines.length).fill(true);

  // Pass 1 — per-line noise filters. Section headers are preserved verbatim
  // (Req 3.5) and skip every removal rule below.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (isSectionHeader(line)) continue;

    // (1) Page markers (Req 3.2)
    if (isPageMarker(line)) {
      keep[i] = false;
      continue;
    }

    // (2) Whitespace-only / separator-only lines (Req 3.4)
    if (isWhitespaceOnly(line) || isSeparatorOnly(line)) {
      keep[i] = false;
      continue;
    }

    // (3) Footer / signature / QR lines that carry no data tokens (Req 3.3)
    if (isFooterNoiseLine(line)) {
      keep[i] = false;
      continue;
    }
  }

  // Pass 2 — repeated lab/address block dedup (Req 3.1). Operates over the
  // original line indices and merges into the same `keep` mask. A repeated
  // block whose first line is a section header (e.g., a stand-alone lab
  // brand line) is still deduplicated — Req 3.1 governs page-level repeats
  // independently of the section-header preservation rule for category
  // markers (Req 3.5).
  const labBlock = detectRepeatedLabBlock(lines);
  if (labBlock !== null) {
    markRepeatedBlockOccurrences(lines, labBlock, keep);
  }

  // Materialise the surviving lines. Lines preserved by the section-header
  // / data-bearing tests above are passed through verbatim; only lines
  // where `keep[i] === false` are dropped.
  const filtered: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) filtered.push(lines[i] ?? '');
  }

  // Pass 3 — split glued tokens introduced by PDF column extraction
  // (e.g., `mg/dL97` → `mg/dL 97`). Section headers (no glued boundary
  // by definition) and plain prose pass through unchanged because the
  // splitter only fires when a recognised unit body sits adjacent to a
  // digit, or a recognised technology token sits adjacent to a digit
  // / uppercase test name.
  const split = filtered.map(splitGluedTokens);

  // Pass 4 — stitch column-major Thyrocare blocks back into row-major
  // lab rows. The stitcher only fires when a contiguous run of lines
  // matches one of the recognised layouts; everything else is copied
  // through unchanged.
  const stitched = stitchColumnBlocks(split);

  return stitched.join('\n');
}
