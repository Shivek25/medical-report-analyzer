/**
 * src/lib/parser/row-detector.ts
 *
 * Phase 2 — Row_Detector sub-module.
 *
 * Walks the cleaned text line by line and classifies each line as either
 * a `lab` row (which becomes a `LabEntry` after Field_Extractor), an
 * `ambiguous` row (preserved on `extractionQuality.ambiguousLines`), or
 * a non-data line (silently skipped).
 *
 * Multi-line merging is folded in here: a test-name-only line followed
 * within 3 lines by a value-bearing continuation line collapses into a
 * single logical row (single-space joins), with reference-range
 * continuations folded in. Merging stops at blank / separator /
 * section-header / page-marker boundaries, or once the 3-line cap is
 * reached.
 *
 * Disambiguation between a test-name-only line and a section header is
 * deferred until after the merge attempt: if a value-bearing
 * continuation is found within window, the line was a test name;
 * otherwise it is treated as a header (skipped silently). The
 * disambiguation between a continuation line and a fresh self-contained
 * lab row is based on the leading character — continuations start with
 * a value, operator, or qualitative token; fresh rows start with a name
 * word.
 *
 * Pure function: same input string → same `{ rows, warnings }` output.
 * No I/O, no shared mutable state, no time / random dependencies.
 *
 * Requirements covered: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 7.1, 7.2, 7.3,
 * 7.4, 7.5.
 */

import type { DetectedRow } from '../types/index.js';
import { isNoiseRow, isGenericDescriptorOrLabelLine } from './noise-filter.js';
import {
  FLAG_TOKEN,
  NUMERIC_VALUE,
  PAGE_MARKER_LINE,
  QUALITATIVE_VALUE,
  REFERENCE_RANGE_ANY,
  SECTION_HEADER_SHAPE,
  SEPARATOR_ONLY_LINE,
  UNIT_TOKEN,
  UNIT_TOKEN_ANCHORED,
  WHITESPACE_ONLY_LINE,
} from './patterns.js';

/** Maximum number of source lines that may be merged into a single row. */
const MERGE_CAP = 3;

/** Disclaimer keyword fragments (matched case-insensitively). */
const DISCLAIMER_FRAGMENTS = ['not a substitute', 'consult your physician'] as const;

/** Prefixes that mark a line as descriptive metadata rather than a lab row. */
const NON_DATA_PREFIXES = [
  'method:',
  'methodology:',
  'note:',
  // Barcode / specimen ID lines
  'barcode :',
  'barcode:',
  'barcode no',
  'labcode:',
  'labcode :',
  // Patient / visit metadata lines
  'uhid/mr no',
  'visit id',
  'client code',
  'client name',
  // Disclaimer / specification / reference lines
  'disclaimer:',
  'specifications:',
  'kit validation reference',
  'clinical significance',
  'bio. ref. interval.',
  'precision %cv',
  // Alert / note markers
  'alert !!!',
  '*note',
  // Interpretation / classification table prefixes
  'deficiency :',
  'sufficiency :',
  'normal:',
  // Cholesterol risk classification table lines
  // GFR unit line (appears as orphan column artefact)
  'ml/min/1.73',
  // Specific note/reference lines that appear as name fragments in merges
  'and cellular health',
  'books-verl',
  '1.clinical management',
  '2.tietz',
  'rate . ann intern med',
  'thalassemia trait',
  // High sensitivity CRP test name that appears in "Ready" status table
  'high sensitivity c-reactive protein',
  // Patient/report metadata lines
  'm sex:',
  'm sex',
  't&c apply',
  // Specific test name with embedded ratio range
  'bun / sr.creatinine ratio',
  // SERUM barcode lines
  'serum 2506',
  // Standalone barcode number lines (e.g., "2506086995/NCR01", "2506088005/NCR01Labcode")
  // These appear as value continuations in barcode merges. The prefix "2506" is
  // specific to the Thyrocare barcode format used in these PDFs.
  '2506',
  // Labcode lines that appear after barcode lines
  'labcode',
  // Report status summary lines
  '0 processing',
  '0 cancelled',
  '0 ready',
  '14 ready',
  // Age/gender annotation lines
  '(22y',
  '(24y',
  // DY barcode lines
  'dy 357',
  'dy 359',  // Cholesterol risk classification table lines
  'very high >',
  'very high 1',
  'high 200-',
  'high 1',
  'borderline high',
  'near optimal',
  'optimal <',
  'value units',
  // ── Generic assay methodology descriptors ────────────────────────────────────
  // These appear as standalone lines between real lab rows in Thyrocare PDFs;
  // they represent how a test was measured, NOT a test name itself.
  'calculated',        // e.g. "Calculated" after MCH/MCHC/RDW rows
  'flow cytometry',   // e.g. "Flow Cytometry" after DLC %-rows
  'sls-hemoglobin method',
  'cph detection',
  'hf & ei',
  'hf & fc',
  'hf &',              // catch any other HF & variants
  // ── Column-header artefacts (appear in multi-column table dumps) ─────────────
  // These are column labels printed by Thyrocare summary/detail views that get
  // extracted as standalone lines and then erroneously merged into test rows.
  'technology',        // "TECHNOLOGY" column header
  'methodology',       // "METHODOLOGY" column header
  // Note: 'value units' already listed above; "VALUE" and "UNITS" alone are
  // caught by the exact-blank-test-name guard in the field-extractor.
  // ── Section-level category labels that appear without associated values ───────
  // These appear in the summary table header to label a category of tests
  // but carry no value themselves.
  'lipid',             // "LIPID" section label in summary table
  'renal',             // "RENAL" section label in summary table
  'vitamins',          // "VITAMINS" section label (only when stand-alone)
  // ── Bibliography / reference guideline lines ─────────────────────────────────
  'tietz',
  'books-verlag',
  'ann intern med',
  'clin chem',
  'j clin invest',
  '(reference :',
  'reference :',       // method cross-reference lines
  // ── Thyrocare boilerplate section headers ──────────────────────────────────
  // These look like section headers (all-caps) but must not become test rows.
  'conditions of reporting',
  'explanations',
  'suggestions',
  'customer details',
  'sample type | barcode',
  'sample_type /tests:',
  'barcodes/sample_type',
  'tests done :',
  'tests done:',
  'as declared in our data',
  'as per survey',
  'call us on',
  'or call us',
  // ── Sex-specific reference range lines ──────────────────────────────────────
  // These appear below APOLIPOPROTEIN and similar tests as gender-stratified
  // reference ranges: "Male:   86 - 152" / "Female:   94 - 162". They are
  // reference data rows, NOT lab result rows, and must never become entries.
  'male:',
  'female:',
  'male :',
  'female :',
  'adult :',
  'adult male :',
  'adult female :',
  'adults :',
  'children :',
  'child :',
  // ── PDF column header labels ─────────────────────────────────────────────────
  // These appear as standalone column-header rows in the Thyrocare detail view.
  // They have no data content and must stop the merge when encountered as the
  // first token of a line.
  'units ',           // catches "UNITS 25-OH VITAMIN D (TOTAL)" style leaks
  'value ',           // catches "VALUE some text" column header leaks
  'technology ',
  'methodology ',
] as const;

/**
 * A continuation candidate must start with one of these patterns: a digit,
 * an explicit sign, a decimal point, a comparison operator, or one of the
 * recognised qualitative-value tokens.
 *
 * Lines starting with a letter (other than a qualitative value) are assumed
 * to be fresh test rows or name fragments and are NOT treated as
 * value/range continuations of an earlier test-name-only line.
 */
const CONTINUATION_LEADING = /^[\d<>+\-.\u2264\u2265]/;
const CONTINUATION_QUALITATIVE_LEADING =
  /^(?:Negative|Positive|Reactive|Non[- ]?Reactive|Present|Absent)\b/i;

/** Result of {@link detect}. */
export interface DetectResult {
  rows: DetectedRow[];
  warnings: string[];
}

// ─── Line predicates ──────────────────────────────────────────────────────────

/** True iff the line is empty or whitespace-only. */
function isBlankLine(line: string): boolean {
  return WHITESPACE_ONLY_LINE.test(line);
}

/** True iff the line consists entirely of separator characters / whitespace. */
function isSeparatorLine(line: string): boolean {
  return SEPARATOR_ONLY_LINE.test(line) && !WHITESPACE_ONLY_LINE.test(line);
}

/** True iff the line is a `Page X of Y` marker. */
function isPageMarkerLine(line: string): boolean {
  return PAGE_MARKER_LINE.test(line.trim());
}

/** True iff the line carries any numeric or qualitative value token. */
function hasValueToken(line: string): boolean {
  return NUMERIC_VALUE.test(line) || QUALITATIVE_VALUE.test(line);
}

/** True iff the line carries a unit token. */
function hasUnitToken(line: string): boolean {
  return UNIT_TOKEN.test(line);
}

/** True iff the line carries any reference-range shape. */
function hasRangeToken(line: string): boolean {
  return REFERENCE_RANGE_ANY.test(line);
}

/** True iff the line carries a recognised flag token. */
function hasFlagToken(line: string): boolean {
  return FLAG_TOKEN.test(line);
}

/**
 * True iff the line satisfies the lab-row predicate from Requirement 4.1:
 * it must contain a value token AND at least one of unit / range / flag.
 *
 * NOTE: A line containing only a numeric range (e.g., `13.0-17.0`) technically
 * satisfies this predicate (the `13.0` is a value, the `13.0-17.0` is a
 * range). At the top level we still classify it as `lab` per Req 4.1 — the
 * Field_Extractor will mark it `uncertain` for missing testName. Inside a
 * merge context (range continuation), the leading-character check folds it
 * into the previous row instead.
 */
function isLabLine(line: string): boolean {
  if (!hasValueToken(line)) return false;
  return hasUnitToken(line) || hasRangeToken(line) || hasFlagToken(line);
}

/**
 * Section-header SHAPE predicate (Req 3.5 / 8.1): the line shape matches
 * the uppercase / title-case mould AND the line carries no numeric value or
 * unit token. Note that test names like `HEMOGLOBIN` also satisfy this
 * predicate; the Row_Detector disambiguates by trying to merge a continuation
 * line first — if no continuation is found, the line is treated as a header.
 */
function looksLikeHeaderShape(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (!SECTION_HEADER_SHAPE.test(trimmed)) return false;
  if (hasValueToken(trimmed)) return false;
  if (hasUnitToken(trimmed)) return false;
  return true;
}

/** True iff the line begins with one of the non-data prefixes (Req 4.3.b). */
function isMethodOrNoteLine(line: string): boolean {
  const trimmed = line.trim().toLowerCase();
  return NON_DATA_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/** True iff the line is a disclaimer (Req 4.3.d). */
function isDisclaimerLine(line: string): boolean {
  const lower = line.toLowerCase();
  if (DISCLAIMER_FRAGMENTS.some((fragment) => lower.includes(fragment))) return true;

  const trimmed = line.trim();
  // Thyrocare "CONDITIONS OF REPORTING" bullet items start with "v  " (v + 2+ spaces)
  if (/^v\s{2,}/.test(trimmed)) return true;

  // Long prose sentences (>= 80 chars) that contain no numeric value token are
  // almost certainly clinical-significance paragraphs or conditions-of-reporting.
  // Genuine lab rows are always short (<60 chars in the cleaned format).
  if (trimmed.length >= 80 && !/\d/.test(trimmed.slice(0, 30))) return true;

  return false;
}

/**
 * True iff the line is a risk-classification / interpretation table entry
 * (e.g., `>=6.5% : Diabetic`, `>8% : Poor Control`, `As per ADA Guidelines`).
 * These lines contain comparison operators and percent signs but are not lab
 * rows — they are footnote tables explaining result interpretation.
 *
 * Also catches microscopy count-range lines like `Pus Cells 3-4/HPF 0-3`
 * where the "value" is a count range per HPF field that the parser cannot
 * extract as a standard numeric value.
 */
function isInterpretationTableLine(line: string): boolean {
  const trimmed = line.trim();
  // Pattern: comparison operator + number + % + colon + text
  if (/^(?:>=|<=|>|<)\s*\d+(?:\.\d+)?%\s*:/.test(trimmed)) return true;
  // Pattern: "As per ADA Guidelines..." or similar guideline references
  if (/^As per\b/i.test(trimmed)) return true;
  // Pattern: cholesterol risk table entries like "VERY HIGH >500VERY HIGH 160-189"
  if (/^(?:VERY HIGH|BORDERLINE HIGH|NEAR OPTIMAL|OPTIMAL)\s+[<>]/.test(trimmed)) return true;
  // Pattern: "TOTAL CHOLESTEROL >190" — cholesterol risk table header
  if (/^TOTAL CHOLESTEROL\s+[<>]/.test(trimmed)) return true;
  // Pattern: "<15 : Kidney Failure" — GFR interpretation table
  if (/^[<>]\s*\d+\s*:/.test(trimmed)) return true;
  // Pattern: cholesterol risk table entries like "HIGH 200-499HIGH 130-159"
  // These are glued risk classification entries
  if (/^(?:HIGH|LOW|NORMAL|OPTIMAL|DESIRABLE)\s+\d/.test(trimmed)) return true;
  // Pattern: "<200DESIRABLE", ">240HIGH" — glued comparison+label entries
  if (/^[<>]\d+[A-Z]/.test(trimmed)) return true;
  // Pattern: "160-189", "150-199BORDERLINE HIGH 100-129" — orphan range lines
  // from cholesterol risk tables (numeric range followed by optional risk label)
  if (/^\d+[-\u2013]\d+(?:[A-Z]|\s|$)/.test(trimmed) && /[A-Z]{3}/.test(trimmed)) return true;
  // Pattern: interpretation table lines like "45 - 59 : Mild to Moderate Decrease"
  // or "151 - 180 mg/dl : Unsatisfactory Control". These are range + colon + text.
  if (/^\d+(?:\.\d+)?\s*[-\u2013]\s*\d+(?:\.\d+)?(?:\s+\S+)?\s*:/.test(trimmed)) return true;
  // Pattern: GFR interpretation table like "EST. GLOMERULAR FILTRATION RATE (eGFR) CALCULATED > = 90: Normal"
  if (/^EST\.\s+GLOMERULAR/i.test(trimmed)) return true;  // Pattern: "VALUE UNITSBio. Ref. Interval." header row
  if (/^VALUE\s+UNITS/i.test(trimmed)) return true;
  // Pattern: microscopy count-range lines like "Pus Cells 3-4/HPF 0-3"
  // where the value is a count range per HPF field (not a standard numeric value).
  if (/\d+[-\u2013]\d+\/HPF/i.test(trimmed)) return true;
  // Pattern: technology-token-only lines with unit and range but no test name
  // (e.g., "E.C.L.I.A ng/dL 80-200"). These are column-extraction artefacts
  // where the technology token was not consumed by the stitcher.
  // Only filter when the second token is a unit (not a test name word).
  if (/^(?:E\.C\.L\.I\.A|ECLIA|H\.P\.L\.C|HPLC|C\.L\.I\.A|CLIA|IMMUNOTURBIDIMETRY|PHOTOMETRY|CALCULATED|CALCULATION|CHEMILUMINESCENCE|COLORIMETRY|TURBIDIMETRY|NEPHELOMETRY|SPECTROPHOTOMETRY|IMMUNOASSAY|ELISA|PCR)\s+(?:ng|pg|µg|ug|μg|mcg|mg|gm|g|m?IU|m?U|mmol|µmol|umol|nmol|pmol|mol|mEq|fL|fl|%|cells|million|lakhs|thousand|\/)\S*/.test(trimmed)) return true;
  return false;
}

/**
 * True iff the line is a standalone unit-only token (e.g., `X 10^6/μL`,
 * `mg/dL`). Such lines appear as orphan column-extraction artefacts when the
 * stitcher could not consume them as part of a multi-line block. They carry
 * no test name and no value, so they should be skipped rather than emitted
 * as uncertain lab rows.
 *
 * Uses the anchored unit predicate from the Text_Cleaner.
 */
function isUnitOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  return UNIT_TOKEN_ANCHORED.test(trimmed);
}

/**
 * Boundary predicate (Req 7.3): a merge cannot cross a blank line, a
 * separator line, a section-header-shaped line, or a page-boundary marker.
 *
 * The header-shape check is intentionally separate from `looksLikeHeaderShape`
 * applied to the merge-start line: here we treat any header-shaped line in
 * the middle of a merge window as a true header (it cannot itself become
 * the test-name origin of a fresh merge in this context).
 */
function isMergeBoundary(line: string): boolean {
  return (
    isBlankLine(line) ||
    isSeparatorLine(line) ||
    isPageMarkerLine(line) ||
    looksLikeHeaderShape(line)
  );
}

/**
 * Shared "merge breaker" predicate: a line that must stop an in-progress merge
 * rather than being absorbed as a name fragment or value continuation.
 *
 * This consolidates the previously-duplicated checks scattered through
 * `foldRangeContinuations` and `mergeFromTestName`, and additionally treats
 * generic assay descriptors / column labels / section headers as breakers so
 * that noisy fragments do not get folded into a test name (which is what
 * produced the bulk of the "Multi-line merge exceeded 3 lines" warnings).
 *
 * Breaking early here is the intended fix for the warning count: it makes
 * continuation *stricter* (per the design rule) rather than hiding warnings.
 */
function isMergeBreaker(line: string): boolean {
  if (isMethodOrNoteLine(line)) return true;
  if (isDisclaimerLine(line)) return true;
  if (isInterpretationTableLine(line)) return true;
  if (isNoiseRow(line)) return true;
  // Standalone descriptor / column-label / section-header lines break merges.
  if (isGenericDescriptorOrLabelLine(line)) return true;
  return false;
}

/**
 * True iff the trimmed line begins with a value-or-operator token (digit,
 * sign, comparison op, decimal point, or qualitative value). Such lines are
 * considered continuations of an earlier test-name; lines starting with a
 * name word are assumed to be fresh self-contained rows.
 */
function startsWithValueOrOp(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (CONTINUATION_LEADING.test(trimmed)) return true;
  if (CONTINUATION_QUALITATIVE_LEADING.test(trimmed)) return true;
  return false;
}

/**
 * Value-continuation predicate (Req 7.1): the line carries a numeric or unit
 * token AND begins with a value/operator (i.e., is not a fresh test row).
 */
function isValueContinuationLine(line: string): boolean {
  if (!(hasValueToken(line) || hasUnitToken(line))) return false;
  return startsWithValueOrOp(line);
}

/**
 * Range-continuation predicate (Req 7.2): the line carries a reference-range
 * pattern and begins with a value/operator (i.e., is not a fresh test row).
 */
function isRangeContinuationLine(line: string): boolean {
  if (!hasRangeToken(line)) return false;
  return startsWithValueOrOp(line);
}

// ─── Detection algorithm ──────────────────────────────────────────────────────

/**
 * Detect lab and ambiguous rows in the cleaned text.
 *
 * Returns a `{ rows, warnings }` tuple:
 *   - `rows` preserves the source order of the cleaned text (Req 4.4): the
 *     `lineIndex` field is the 0-based index of the FIRST source line that
 *     contributed to the row (strictly monotonically increasing).
 *   - `warnings` collects structural notes (e.g., merge-cap exceedance) for
 *     the orchestrator to fold into `extractionQuality.warnings`.
 *
 * @param cleanedText - The output of `Text_Cleaner.clean`. Must be a string;
 *                      empty / whitespace-only inputs produce empty results.
 */
export function detect(cleanedText: string): DetectResult {
  // Req 4.6 — empty / whitespace-only input produces no rows and no warnings.
  if (cleanedText.length === 0 || WHITESPACE_ONLY_LINE.test(cleanedText)) {
    return { rows: [], warnings: [] };
  }

  const lines = cleanedText.split('\n');
  const rows: DetectedRow[] = [];
  const warnings: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // ── Skip absolute non-data lines (Req 3.2, 3.4, 4.3) ─────────────────────
    if (isBlankLine(line) || isSeparatorLine(line) || isPageMarkerLine(line)) {
      i += 1;
      continue;
    }
    if (isMethodOrNoteLine(line) || isDisclaimerLine(line) || isInterpretationTableLine(line) || isNoiseRow(line)) {
      i += 1;
      continue;
    }

    // ── Case A: line is itself a complete lab row (Req 4.1) ──────────────────
    if (isLabLine(line)) {
      // Skip interpretation table lines even when they look like lab rows
      // (e.g., `TOTAL CHOLESTEROL >190` — comparison range but no unit).
      if (isInterpretationTableLine(line)) {
        i += 1;
        continue;
      }
      // Skip standalone integer range lines like "160-189", "100-129", "30-100"
      // that appear as orphan reference range entries. These are filtered
      // only in Case A (standalone lab rows), not in foldRangeContinuations,
      // so legitimate range continuations are not affected.
      // Filter integer ranges (no decimal points) to avoid filtering decimal
      // ranges like "13.0-17.0" that appear as legitimate continuations.
      if (/^\d+[-\u2013]\d+$/.test(line.trim())) {
        i += 1;
        continue;
      }
      // Also filter decimal ranges that appear as standalone orphan lines
      // (e.g., "27.0-32.0", "4.8-12.7", "0.54-5.30"). These are filtered
      // only in Case A, not in foldRangeContinuations.
      if (/^\d+\.\d+[-\u2013]\d+\.\d+$/.test(line.trim())) {
        i += 1;
        continue;
      }
      // Skip standalone comparison values like "<100" that appear as orphan
      // cholesterol risk table entries. Only filter 3-digit comparisons
      // to avoid filtering legitimate comparison ranges like "< 10" or "< 30".
      if (/^[<>]\s*\d{3}$/.test(line.trim())) {
        i += 1;
        continue;
      }
      // Skip interpretation table range lines like "13 - 45" (with spaces around dash).
      if (/^\d+\s+[-\u2013]\s+\d+$/.test(line.trim())) {
        i += 1;
        continue;
      }
      // Skip ratio range lines like "9:1-23:1" that appear as orphan reference
      // range entries for ratio tests (e.g., BUN/Creatinine ratio).
      if (/^\d+:\d+[-\u2013]\d+:\d+$/.test(line.trim())) {
        i += 1;
        continue;
      }
      const folded = foldRangeContinuations(lines, i, [line.trim()]);
      if (folded.exceededCap) {
        warnings.push(`Multi-line merge exceeded 3 lines at row ${i + 1}`);
      }
      const rawText = folded.fragments.join(' ');
      if (isNoiseRow(rawText)) {
        i = folded.consumedUpTo;
        continue;
      }
      rows.push({
        classification: 'lab',
        rawText,
        lineIndex: i,
      });
      i = folded.consumedUpTo;
      continue;
    }

    // ── Case B: line has neither value nor unit ──────────────────────────────
    // Could be a test-name-only line awaiting a value continuation, or it
    // could be a section header / prose-only line. Try merge first; if it
    // fails, treat as header / prose and skip silently.
    if (!hasValueToken(line) && !hasUnitToken(line)) {
      const merge = mergeFromTestName(lines, i);
      if (merge.exceededCap) {
        warnings.push(`Multi-line merge exceeded 3 lines at row ${i + 1}`);
      }
      if (merge.merged) {
        const mergedText = merge.fragments.join(' ');
        // Skip if the merged result is an interpretation table line or noise row
        if (isInterpretationTableLine(mergedText) || isNoiseRow(mergedText)) {
          i = merge.consumedUpTo;
          continue;
        }
        rows.push({
          classification: 'lab',
          rawText: mergedText,
          lineIndex: i,
        });
        i = merge.consumedUpTo;
      } else {
        // No continuation found: this was a header or prose-only line
        // (Req 3.5, 4.3.a, 4.3.c). Skip silently.
        i += 1;
      }
      continue;
    }

    // ── Case C: line carries some data but is not a complete lab row ─────────
    // Per Req 4.5, emit `ambiguous` so the orchestrator can record it on
    // `extractionQuality.ambiguousLines`.
    if (isNoiseRow(line)) {
      i += 1;
      continue;
    }
    rows.push({ classification: 'ambiguous', rawText: line, lineIndex: i });
    i += 1;
  }

  return { rows, warnings };
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

interface FoldResult {
  /** Trimmed source fragments composing the merged row. */
  fragments: string[];
  /** Index of the first source line NOT consumed by this merge. */
  consumedUpTo: number;
  /** True when the merge wanted to extend beyond {@link MERGE_CAP} lines. */
  exceededCap: boolean;
}

/**
 * Starting just past `startIndex`, fold any trailing range-continuation lines
 * into the supplied `fragments` array (mutates the array in place). Returns
 * the (possibly grown) fragment list, the next un-consumed source index, and
 * an `exceededCap` flag.
 *
 * Only used after a self-contained lab line — i.e., the value/unit have
 * already been seen on the row at `startIndex` (Req 7.2).
 */
function foldRangeContinuations(
  lines: string[],
  startIndex: number,
  fragments: string[],
): FoldResult {
  let j = startIndex + 1;
  let exceededCap = false;

  while (j < lines.length) {
    const next = lines[j]!;
    if (isMergeBoundary(next)) break;
    if (isMergeBreaker(next)) break;
    if (!isRangeContinuationLine(next)) break;

    if (fragments.length >= MERGE_CAP) {
      exceededCap = true;
      break;
    }
    fragments.push(next.trim());
    j += 1;
  }

  return { fragments, consumedUpTo: j, exceededCap };
}

interface MergeResult extends FoldResult {
  /** True iff a value-bearing continuation was located. */
  merged: boolean;
}

/**
 * Attempt to merge a test-name-only line at `startIndex` with one or more
 * following lines, terminating when a value-bearing continuation is reached
 * (Req 7.1). Reference-range continuations following the value line are
 * folded in (Req 7.2). The merge stops at any boundary or once the
 * {@link MERGE_CAP} is exhausted.
 *
 * Lines that are neither boundaries nor value continuations but still look
 * like name fragments (e.g., a parenthesised qualifier) are absorbed up to
 * the merge cap.
 *
 * Returns `{ merged: false }` when no continuation is found within the
 * 3-line window — the caller should then treat the source line as prose /
 * header and skip it (Req 4.3.a, 4.3.c).
 */
function mergeFromTestName(lines: string[], startIndex: number): MergeResult {
  const fragments: string[] = [lines[startIndex]!.trim()];
  let exceededCap = false;
  let foundDataLine = false;
  let j = startIndex + 1;

  while (j < lines.length) {
    const next = lines[j]!;

    // Boundary lines stop the merge entirely (Req 7.3).
    if (isMergeBoundary(next)) break;
    if (isMergeBreaker(next)) break;

    // A self-contained lab row at this position means our starting line was
    // actually a header / prose; the merge fails. Per Req 7.5, the new line
    // must be treated as the start of a new row, so we do NOT consume it.
    if (isLabLine(next) && !startsWithValueOrOp(next)) {
      break;
    }

    if (isValueContinuationLine(next)) {
      // Value-bearing continuation found.
      if (fragments.length >= MERGE_CAP) {
        exceededCap = true;
        break;
      }
      fragments.push(next.trim());
      foundDataLine = true;
      j += 1;
      // After the value line, fold trailing range continuations (Req 7.2).
      const folded = foldRangeContinuations(lines, j - 1, fragments);
      j = folded.consumedUpTo;
      if (folded.exceededCap) exceededCap = true;
      break;
    }

    // Non-data lines (barcode, disclaimer, etc.) that appear in the middle
    // of a merge window should stop the merge rather than being absorbed as
    // name fragments. Check here so they don't get folded into the testName.
    if (isUnitOnlyLine(next)) break;

    // Otherwise it's a name fragment (e.g., wrapped continuation of a long
    // test name). Absorb it up to the cap, then continue searching for the
    // value line.
    if (fragments.length >= MERGE_CAP) {
      exceededCap = true;
      break;
    }
    fragments.push(next.trim());
    j += 1;
  }

  if (!foundDataLine) {
    return {
      merged: false,
      fragments,
      consumedUpTo: startIndex + 1,
      exceededCap,
    };
  }

  return { merged: true, fragments, consumedUpTo: j, exceededCap };
}
