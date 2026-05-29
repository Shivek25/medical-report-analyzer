/**
 * src/lib/parser/orchestrator.ts
 *
 * Phase 2 — Top-level parser orchestrator.
 *
 * Wires the Phase 2 sub-modules into a single linear pipeline and exposes the
 * synchronous public entry point `parseRawText`. The pipeline is the one
 * documented in `design.md` "Pipeline":
 *
 *     Text_Cleaner
 *        → MetadataExtractor
 *        → Row_Detector
 *        → Categorizer
 *        → (per row) Field_Extractor
 *        → Normalizer
 *        → Quality Aggregator
 *        → Validator
 *
 * Behavioural contract (Requirement 1, 9.7, 10.5, 11.1, 11.5):
 *
 *   - The function never throws for any `IngestionResult` whose
 *     `extractionStatus` is one of the three recognised values
 *     (`'success' | 'scanned_fallback' | 'failed'`). All thrown errors are
 *     trapped by the outer try/catch and surfaced through
 *     `extractionQuality.warnings`.
 *
 *   - When `extractionStatus === 'failed'`, the function short-circuits with
 *     a fresh empty `StructuredReport` whose `extractionQuality.warnings`
 *     contains the literal string `"Extraction failed"`.
 *
 *   - `extractionQuality.lowConfidence` is set to `true` iff
 *     `extractionStatus === 'scanned_fallback'` (Req 1.3 / 9.7), regardless
 *     of whether the run takes the success, error, or short-circuit path.
 *
 *   - The fully-populated report is *always* returned; validator failures
 *     only set `extractionQuality.validationFailed = true` and emit a single
 *     structural log entry tagged `parser:validation-failed` (counts only,
 *     no PII).
 *
 *   - Per `ParseOptions.keepRawText`: when `true`, the cleaned text is
 *     attached as `rawText`; when `false` or omitted, the `rawText` key is
 *     omitted entirely (not present as `undefined`). This is enforced by
 *     conditional property assignment so the resulting object satisfies
 *     `exactOptionalPropertyTypes` and Property 28.
 */

import type {
  ExtractionQuality,
  IngestionResult,
  LabEntry,
  ParseOptions,
  ReportMetadata,
  StructuredReport,
} from '../types/index.js';
import { logger } from '../../shared/logger.js';
import { validateStructuredReport } from '../validator/index.js';
import { assignCategories } from './categorizer.js';
import { extract as extractFields } from './field-extractor.js';
import { extract as extractMetadata } from './metadata.js';
import { normalize } from './normalizer.js';
import { build as buildQuality, type QualityCounts } from './quality.js';
import { detect as detectRows } from './row-detector.js';
import { clean as cleanText } from './text-cleaner.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert a Phase 1 `IngestionResult` into a typed, validated
 * `StructuredReport`.
 *
 * Synchronous and total over the three recognised `extractionStatus` values:
 * the function will return a well-formed `StructuredReport` for every such
 * input, never propagating an exception (Req 1.6).
 *
 * @param input   - The Phase 1 extraction result.
 * @param options - Optional caller preferences (e.g., `keepRawText`).
 * @returns A `StructuredReport` populated according to the pipeline contract.
 */
export function parseRawText(
  input: IngestionResult,
  options?: ParseOptions,
): StructuredReport {
  const lowConfidence = input.extractionStatus === 'scanned_fallback';
  const keepRawText = options?.keepRawText === true;

  // 1. Short-circuit on upstream extraction failure (Req 1.2).
  if (input.extractionStatus === 'failed') {
    return buildEmptyReport({
      warnings: ['Extraction failed'],
      lowConfidence,
      keepRawText,
      cleanedText: '',
    });
  }

  // 2. Wrap the pipeline in try/catch so no internal throw escapes
  //    `parseRawText` (Req 1.5, 1.6). Any pipeline error is converted to a
  //    fresh empty `StructuredReport` with the error message in
  //    `extractionQuality.warnings`.
  try {
    const cleanedText = cleanText(input.extractedText);
    const metadata = extractMetadata(cleanedText);
    const detectResult = detectRows(cleanedText);
    const categorisedRows = assignCategories(detectResult.rows, cleanedText);

    // Per-row processing. Counts collected as we go so the Quality
    // Aggregator can validate the structural invariant
    // `successfullyParsed + uncertainRows ≤ totalRowsDetected` (Req 9.2).
    const totalRowsDetected = categorisedRows.length;
    let successfullyParsed = 0;
    let uncertainRows = 0;
    let skippedRows = 0;

    const entries: LabEntry[] = [];
    const ambiguousLines: string[] = [];

    for (const row of categorisedRows) {
      if (row.classification === 'lab') {
        // Field_Extractor is total: a missing required field is reported via
        // `uncertain: true` rather than a thrown exception, so we always
        // push the resulting entry into the report.
        const extracted = extractFields(row);
        const normalized = normalize(extracted);
        entries.push(normalized);
        if (normalized.uncertain) {
          uncertainRows += 1;
        } else {
          successfullyParsed += 1;
        }
      } else {
        // 'ambiguous' — surfaced via `extractionQuality.ambiguousLines`
        // (Req 9.3) and never passed to Field_Extractor.
        ambiguousLines.push(row.rawText);
        skippedRows += 1;
      }
    }

    const counts: QualityCounts = {
      totalRowsDetected,
      successfullyParsed,
      uncertainRows,
      skippedRows,
    };

    // Build quality optimistically (`validationFailed = false`); flip the
    // flag below if the validator rejects the report.
    const initialQuality = buildQuality(
      counts,
      ambiguousLines,
      detectResult.warnings,
      lowConfidence,
      false,
      metadata,
    );

    const report: StructuredReport = {
      metadata,
      entries,
      extractionQuality: initialQuality,
    };
    // Conditional assignment satisfies `exactOptionalPropertyTypes` and
    // Property 28: `'rawText' in report` ⇔ `Boolean(options?.keepRawText)`.
    if (keepRawText) {
      report.rawText = cleanedText;
    }

    // 3. Validator round-trip (Req 10.5). The report is always returned,
    //    regardless of outcome; validator failures only flip
    //    `validationFailed` and emit a structural log entry.
    const validation = validateStructuredReport(report);
    if (!validation.valid) {
      logger.warn('parser:validation-failed', {
        totalRowsDetected,
        successfullyParsed,
        uncertainRows,
        skippedRows,
        errorCount: validation.errors.length,
      });
      // Replace the quality object with one that has `validationFailed: true`.
      // We rebuild a plain object instead of calling `buildQuality` again so
      // the structural-invariant check doesn't run twice for the same input.
      report.extractionQuality = {
        ...initialQuality,
        validationFailed: true,
      };
    }

    return report;
  } catch (err) {
    // Any unexpected throw inside the pipeline (e.g., a Quality Aggregator
    // invariant violation) lands here. Convert the message into a structural
    // warning and return a fresh empty report (Req 1.5).
    const message = err instanceof Error ? err.message : String(err);
    return buildEmptyReport({
      warnings: [message],
      lowConfidence,
      keepRawText,
      cleanedText: '',
    });
  }
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Construct the empty `StructuredReport` shape used by both the failure
 * short-circuit and the catch path. The extraction-quality object is built
 * inline (rather than via `buildQuality`) because:
 *
 *   - all counts are zero, so the structural invariant is trivially
 *     satisfied;
 *   - `metadata` is empty, so the defensive PII scrub is a no-op;
 *   - building inline avoids any chance of recursing through the same
 *     `try/catch` boundary that called us.
 */
function buildEmptyReport(args: {
  warnings: string[];
  lowConfidence: boolean;
  keepRawText: boolean;
  cleanedText: string;
}): StructuredReport {
  const metadata: ReportMetadata = {};
  const extractionQuality: ExtractionQuality = {
    totalRowsDetected: 0,
    successfullyParsed: 0,
    uncertainRows: 0,
    skippedRows: 0,
    ambiguousLines: [],
    warnings: [...args.warnings],
    confidence: 0,
    lowConfidence: args.lowConfidence,
  };

  const report: StructuredReport = {
    metadata,
    entries: [],
    extractionQuality,
  };
  if (args.keepRawText) {
    report.rawText = args.cleanedText;
  }
  return report;
}
