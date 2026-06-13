/**
 * src/lib/summarizer/overview-builder.ts
 *
 * Pure function that builds a plain-language 1–2 sentence overview of the
 * report. Handles missing patient name and date gracefully.
 */

import type { ReportMetadata, SummaryGenerationMeta } from '../types/index.js';

/**
 * Build a plain-language overview sentence for the report.
 *
 * Examples:
 *   - "Report for Shivek Sharma (dated 2025-06-15): 3 of 24 test results
 *      are outside the normal range. 2 results could not be fully verified."
 *   - "Report dated 2025-06-15: All 18 test results are within normal range."
 *   - "Report summary: 1 of 5 test results is outside the normal range."
 */
export function buildOverview(
  meta: SummaryGenerationMeta,
  metadata: ReportMetadata,
): string {
  const parts: string[] = [];

  // ── Header (patient + date) ─────────────────────────────────────────────
  const hasName = metadata.patientName !== undefined && metadata.patientName.trim().length > 0;
  const date = metadata.reportDate ?? metadata.sampleDate;
  const hasDate = date !== undefined && date.trim().length > 0;

  if (hasName && hasDate) {
    parts.push(`Report for ${metadata.patientName!.trim()} (dated ${date!.trim()})`);
  } else if (hasName) {
    parts.push(`Report for ${metadata.patientName!.trim()}`);
  } else if (hasDate) {
    parts.push(`Report dated ${date!.trim()}`);
  } else {
    parts.push('Report summary');
  }

  // ── Main finding count ──────────────────────────────────────────────────
  const evaluated = meta.totalEntries - meta.skippedCount;

  if (evaluated === 0) {
    parts[0] += ': No evaluable test results found.';
    return parts.join(' ');
  }

  if (meta.abnormalCount === 0) {
    const verb = evaluated === 1 ? 'is' : 'are';
    parts[0] += `: All ${evaluated} test result${evaluated === 1 ? '' : 's'} ${verb} within normal range.`;
  } else {
    const verb = meta.abnormalCount === 1 ? 'is' : 'are';
    parts[0] += `: ${meta.abnormalCount} of ${evaluated} test result${evaluated === 1 ? '' : 's'} ${verb} outside the normal range.`;
  }

  // ── Uncertainty note ────────────────────────────────────────────────────
  if (meta.uncertainCount > 0) {
    const noun = meta.uncertainCount === 1 ? 'result' : 'results';
    parts.push(`${meta.uncertainCount} ${noun} could not be fully verified.`);
  }

  // ── Low-confidence note ─────────────────────────────────────────────────
  if (meta.sourceConfidence < 0.7) {
    parts.push('Note: the extraction confidence for this report is low; some values may be inaccurate.');
  }

  return parts.join(' ');
}
