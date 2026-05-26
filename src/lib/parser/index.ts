/**
 * src/lib/parser/index.ts
 * Report data extractor — turns raw PDF text into structured ParsedMarker[].
 *
 * Phase 1 implementation will use regex + LLM-assisted extraction.
 */

import type { BloodTestReport, ParsedMarker, PatientInfo } from '../types/index.js';

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
