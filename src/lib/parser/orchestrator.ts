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
import { isGenericDescriptorToken } from './noise-filter.js';
import { normalize } from './normalizer.js';
import { build as buildQuality, type QualityCounts } from './quality.js';
import { UNIT_TOKEN_ANCHORED } from './patterns.js';
import { detect as detectRows } from './row-detector.js';
import { clean as cleanText } from './text-cleaner.js';
import { analyzeLayout, candidatesToText } from '../layout/index.js';

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
    // Phase 8: when the extractor captured spatial layout data, use the layout
    // engine to produce a cleaner text representation before row detection.
    // The layout engine collapses multi-line rows, strips headers/footers and
    // boilerplate, and reconstructs table columns — dramatically reducing the
    // merge heuristics in row-detector.ts.
    //
    // If layoutPages is absent or the engine throws, we fall back to the plain
    // flat-text path (identical to pre-Phase-8 behaviour).
    let sourceText = input.extractedText;
    const layoutWarnings: string[] = [];
    if (input.layoutPages && input.layoutPages.length > 0) {
      try {
        const layoutDoc = analyzeLayout(
          input.layoutPages,
          input.isFullySpatial ?? false,
        );
        const layoutText = candidatesToText(layoutDoc.candidates);
        if (layoutText.trim().length > 0) {
          sourceText = layoutText;
          logger.info('parser:layout-engine-active', {
            blocks: layoutDoc.blocks.length,
            candidates: layoutDoc.candidates.length,
            isFullySpatial: layoutDoc.isFullySpatial,
          });
        } else {
          layoutWarnings.push('Layout engine produced empty text — using flat-text fallback');
        }
      } catch (layoutErr: unknown) {
        const msg = layoutErr instanceof Error ? layoutErr.message : String(layoutErr);
        layoutWarnings.push(`Layout engine failed — using flat-text fallback: ${msg}`);
        logger.warn('parser:layout-engine-failed', { error: msg });
      }
    }

    const cleanedText = cleanText(sourceText);
    const metadata = extractMetadata(cleanedText);
    const detectResult = detectRows(cleanedText);
    // Merge any layout warnings into the detect result's warnings.
    detectResult.warnings.push(...layoutWarnings);
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
        // Conservative gate: only drop a row when Field_Extractor could not
        // recover ANY meaningful analyte name (the name reduces to empty, a
        // bare generic descriptor, or a standalone unit after cleaning). Such
        // rows are provably non-medical and would otherwise surface as junk
        // findings. Real analytes — even uncertain ones whose value landed on
        // a separate line — are kept (emitted as uncertain), matching the base
        // pipeline's emission behaviour. It is better to miss a junk row than
        // to invent a test, but never at the cost of dropping a real analyte.
        if (!hasMeaningfulTestName(normalized)) {
          ambiguousLines.push(row.rawText);
          skippedRows += 1;
          continue;
        }
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
 * True iff the entry carries a meaningful analyte name — i.e. the testName is
 * non-empty AND, after descriptor/column-label stripping, yields at least one
 * non-descriptor, non-unit token. Used by the per-row loop to decide whether a
 * row should be emitted or treated as ambiguous and skipped.
 *
 * Deliberately narrow: only rows whose name is *provably* non-medical (empty,
 * a bare generic descriptor, or a standalone unit) are rejected. Real analytes
 * — even uncertain ones whose value landed on a separate line — are kept,
 * matching the base pipeline's emission behaviour.
 *
 * Pure: same input ⇒ same output.
 */
function hasMeaningfulTestName(entry: LabEntry): boolean {
  // Field_Extractor signals a non-meaningful name explicitly via its
  // uncertainty reason (set for rows that are entirely descriptor/label
  // fragments with no parseable value). Trust that verdict.
  if (entry.uncertaintyReason?.startsWith('Ambiguous test name')) return false;
  const name = entry.testName.trim();
  if (name.length === 0) return false;
  // A bare generic descriptor or standalone unit token is never an analyte.
  if (isGenericDescriptorToken(name)) return false;
  if (UNIT_TOKEN_ANCHORED.test(name)) return false;
  // An analyte name must contain at least one alphabetic word of 3+ letters.
  // Rows whose "name" is just numbers, units, ranges, or single symbols (e.g.
  // "16.5 ng/mL", "31.5-34.5", "523") are orphan value/range fragments whose
  // real test name landed on a separate line — they carry no analyte identity
  // and must not be emitted as findings.
  if (!/[A-Za-z]{3,}/.test(name)) return false;
  // Otherwise the row carries something name-shaped; keep it. The
  // Field_Extractor has already cleaned embedded descriptors/labels out of
  // real analyte names via `extractMeaningfulTestName`, so we do not re-run
  // that here — re-running it would risk dropping rows whose value-branch
  // fallback name legitimately still contains a unit/range fragment.
  return true;
}

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
