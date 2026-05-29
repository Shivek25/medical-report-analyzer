/**
 * src/lib/parser/index.ts
 *
 * Phase 2 parser barrel.
 *
 * Public surface:
 *
 *   - `parseRawText` — the top-level entry point (re-exported from
 *     `orchestrator.ts`). Callers outside the parser package should depend
 *     on this and on the types in `src/lib/types/index.ts` only.
 *
 *   - Sub-module functions (`clean`, `detect`, `assignCategories`,
 *     `normalize`, `build`, plus `fieldExtractor.extract` and
 *     `metadata.extract` under namespaced exports) are re-exported so
 *     property and unit tests can target each pipeline stage in isolation.
 *     They are not part of the supported runtime API; production code
 *     should always call `parseRawText`.
 *
 * The legacy Phase 0 stubs (`parseReport`, `extractPatientInfo`,
 * `extractMarkers`) are retained verbatim for backwards compatibility.
 *
 * `field-extractor.ts` and `metadata.ts` both export a function called
 * `extract`, so they are exposed as namespaces (`fieldExtractor`,
 * `metadata`) rather than via flat named re-exports.
 */

import type { BloodTestReport, ParsedMarker, PatientInfo } from '../types/index.js';

// ─── Phase 2 public API ───────────────────────────────────────────────────────

export { parseRawText } from './orchestrator.js';

// ─── Sub-module re-exports (testing only) ─────────────────────────────────────

export { clean } from './text-cleaner.js';
export { detect } from './row-detector.js';
export { assignCategories } from './categorizer.js';
export { normalize } from './normalizer.js';
export { build } from './quality.js';

// `field-extractor.ts` and `metadata.ts` both export a function named
// `extract`; namespaced re-exports avoid the name collision.
export * as fieldExtractor from './field-extractor.js';
export * as metadata from './metadata.js';

// ─── Phase 0 legacy exports (backwards compatibility) ─────────────────────────

export interface ParseOptions {
  /** If true, keep rawText on the returned report */
  keepRawText?: boolean;
}

/**
 * Parse raw PDF text into a structured BloodTestReport.
 * @param rawText - Full text extracted from the PDF
 * @param fileName - Original file name (used to seed the report ID)
 */
export function parseReport(
  _rawText: string,
  _fileName: string,
  _options?: ParseOptions,
): BloodTestReport {
  // TODO (Phase 1): implement parsing logic
  throw new Error('parseReport: not yet implemented');
}

/**
 * Extract patient information from the header text of a report.
 */
export function extractPatientInfo(_headerText: string): PatientInfo {
  // TODO (Phase 1): implement
  throw new Error('extractPatientInfo: not yet implemented');
}

/**
 * Identify and parse all biomarker rows from the body text.
 */
export function extractMarkers(_bodyText: string): ParsedMarker[] {
  // TODO (Phase 1): implement
  throw new Error('extractMarkers: not yet implemented');
}
