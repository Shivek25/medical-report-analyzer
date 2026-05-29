/**
 * src/lib/parser/quality.ts
 *
 * Phase 2 Quality Aggregator sub-module.
 *
 * Combines the count totals collected by the orchestrator with the
 * `ambiguousLines`, `warnings`, `lowConfidence`, and `validationFailed`
 * signals produced by upstream stages, and returns a fully-populated
 * `ExtractionQuality` object.
 *
 * Responsibilities (per Requirement 9 and design "Quality Aggregator" section):
 *
 *   - Compute `confidence = totalRowsDetected === 0 ? 0 : successfullyParsed
 *     / totalRowsDetected` (Req 9.4).
 *   - Enforce the structural invariant
 *     `successfullyParsed + uncertainRows ≤ totalRowsDetected` (Req 9.2).
 *     A violation throws an internal `Error` that the orchestrator's outer
 *     try/catch converts into a warning on the returned `StructuredReport`
 *     (design "Error Handling" → "Quality invariant violation").
 *   - Defensive PII scrub: remove any patient-identifiable substrings
 *     derived from the supplied `ReportMetadata` from every entry of
 *     `warnings` and `ambiguousLines` before returning (Req 9.6).
 *   - Pass `lowConfidence` and `validationFailed` through unchanged
 *     (Req 9.7 / Req 10.5).
 *
 * The function is pure — no I/O, no shared mutable state, deterministic for
 * a given input. Callers SHOULD treat the returned object as immutable.
 */

import type { ExtractionQuality, ReportMetadata } from '../types/index.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Aggregated row counts produced by the orchestrator and passed into
 * {@link build} after the per-row pipeline finishes.
 */
export interface QualityCounts {
  /** All rows emitted by Row_Detector (lab + ambiguous). */
  totalRowsDetected: number;
  /** `LabEntry` items where `uncertain === false`. */
  successfullyParsed: number;
  /** `LabEntry` items where `uncertain === true`. */
  uncertainRows: number;
  /** Rows classified as non-data and never passed to Field_Extractor. */
  skippedRows: number;
}

/**
 * Build an `ExtractionQuality` object from the orchestrator's row counts and
 * accumulated structural warnings / ambiguous lines.
 *
 * @param counts            Row counts collected during parsing.
 * @param ambiguousLines    Raw text of every line Row_Detector marked as
 *                          ambiguous (already structural-only by contract;
 *                          this function performs a defensive scrub on top).
 * @param warnings          Human-readable structural warnings (e.g.,
 *                          `"Multi-line merge exceeded 3 lines at row N"`).
 * @param lowConfidence     `true` iff `extractionStatus === 'scanned_fallback'`
 *                          (Req 9.7).
 * @param validationFailed  `true` iff the validator rejected the parser's own
 *                          output (Req 10.5). Passed through unchanged.
 * @param metadata          Optional report metadata used to seed the PII
 *                          scrub. When omitted, the scrub is skipped — the
 *                          arrays are still copied so callers cannot mutate
 *                          the returned object via their original references.
 *
 * @throws {Error} when `successfullyParsed + uncertainRows > totalRowsDetected`.
 *         The orchestrator catches this via its outer try/catch (Req 1.5).
 */
export function build(
  counts: QualityCounts,
  ambiguousLines: string[],
  warnings: string[],
  lowConfidence: boolean,
  validationFailed: boolean,
  metadata?: ReportMetadata,
): ExtractionQuality {
  const { totalRowsDetected, successfullyParsed, uncertainRows, skippedRows } = counts;

  // ── Invariant check (Req 9.2) ───────────────────────────────────────────────
  if (successfullyParsed + uncertainRows > totalRowsDetected) {
    throw new Error(
      `Quality count invariant violated: successfullyParsed (${successfullyParsed}) + ` +
        `uncertainRows (${uncertainRows}) > totalRowsDetected (${totalRowsDetected})`,
    );
  }

  // ── Confidence (Req 9.4) ────────────────────────────────────────────────────
  const confidence = totalRowsDetected === 0 ? 0 : successfullyParsed / totalRowsDetected;

  // ── Defensive PII scrub (Req 9.6) ───────────────────────────────────────────
  const forbiddenTokens = collectForbiddenTokens(metadata);
  const scrubbedAmbiguous = ambiguousLines.map((line) => scrub(line, forbiddenTokens));
  const scrubbedWarnings = warnings.map((line) => scrub(line, forbiddenTokens));

  return {
    totalRowsDetected,
    successfullyParsed,
    uncertainRows,
    skippedRows,
    ambiguousLines: scrubbedAmbiguous,
    warnings: scrubbedWarnings,
    confidence,
    lowConfidence,
    validationFailed,
  };
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Minimum length for a metadata value to participate in the PII scrub.
 *
 * Single-character values (notably `patientGender ∈ { 'M', 'F', 'O' }`) and
 * two-character ages would otherwise over-redact unrelated content (e.g.,
 * stripping the `M` from a unit token, or `22` from the substring `row 22`).
 * Three-character minimums are enough to cover realistic patient names,
 * dates, IDs, and lab names without trampling structural strings.
 */
const MIN_SCRUB_TOKEN_LENGTH = 3;

/**
 * Collect every metadata value worth scrubbing from `warnings` and
 * `ambiguousLines`. Values are stringified (numbers → decimal string),
 * trimmed, deduplicated, and filtered to those at least
 * {@link MIN_SCRUB_TOKEN_LENGTH} characters long.
 *
 * Sorting by descending length ensures longer tokens are removed before any
 * shorter token that might appear as their substring (e.g., a patient name
 * is removed before a date that happens to share digits with it).
 */
function collectForbiddenTokens(metadata: ReportMetadata | undefined): string[] {
  if (metadata === undefined) return [];

  const seen = new Set<string>();
  const candidates: Array<string | number | undefined> = [
    metadata.patientName,
    metadata.patientAge,
    metadata.reportDate,
    metadata.sampleDate,
    metadata.labName,
    metadata.reportId,
  ];

  for (const raw of candidates) {
    if (raw === undefined) continue;
    const value = String(raw).trim();
    if (value.length < MIN_SCRUB_TOKEN_LENGTH) continue;
    seen.add(value);
  }

  return [...seen].sort((a, b) => b.length - a.length);
}

/**
 * Remove every occurrence of every forbidden token from `input`. The match is
 * literal (not regex) and case-sensitive; downstream callers only ever push
 * structural strings into `warnings` / `ambiguousLines`, so case-sensitive
 * substring removal is sufficient for the defensive scrub contract (Req 9.6).
 *
 * Whitespace produced by the redaction is collapsed to a single space and
 * trimmed at the edges so the resulting structural strings stay readable.
 */
function scrub(input: string, forbiddenTokens: string[]): string {
  if (forbiddenTokens.length === 0) return input;

  let output = input;
  for (const token of forbiddenTokens) {
    if (token.length === 0) continue;
    // Repeated `split(token).join('')` removes every literal occurrence
    // without needing to escape the token for use in a RegExp.
    output = output.split(token).join('');
  }

  // Collapse any whitespace runs introduced by the redactions and trim the
  // edges, so a scrubbed line like `"row  for patient "` becomes `"row for patient"`.
  return output.replace(/\s{2,}/g, ' ').trim();
}
