/**
 * src/lib/semantic/qa-report.ts
 *
 * Phase 9 — QA report builder.
 *
 * Assembles a QAReport from the individual event lists produced by the
 * section-classifier, canonicalizer, and deduplicator. Keeps the aggregation
 * logic separate so each sub-module stays focused on its own domain.
 *
 * Pure: same input → same output. No I/O, no shared mutable state.
 */

import type { QAEvent, QAReport } from './types.js';

/**
 * Build a QAReport from the collected events and entry counts.
 *
 * @param inputEntryCount  - Number of entries in the report BEFORE normalization.
 * @param outputEntryCount - Number of entries in the report AFTER normalization.
 * @param events           - All QA events from all normalization steps, in order.
 * @returns                  A fully populated QAReport.
 */
export function buildQAReport(
  inputEntryCount: number,
  outputEntryCount: number,
  events: ReadonlyArray<QAEvent>,
): QAReport {
  let namesCanonicalizedCount      = 0;
  let categoriesNormalizedCount    = 0;
  let duplicatesMergedCount        = 0;
  let suppressedCount              = 0;
  let sectionsReclassifiedCount    = 0;
  let sectionsSuppressedCount      = 0;

  for (const event of events) {
    switch (event.kind) {
      case 'name_canonicalized':    namesCanonicalizedCount   += 1; break;
      case 'category_normalized':   categoriesNormalizedCount += 1; break;
      case 'duplicate_merged':      duplicatesMergedCount     += 1; break;
      case 'entry_suppressed':      suppressedCount           += 1; break;
      case 'section_reclassified':  sectionsReclassifiedCount += 1; break;
      case 'section_suppressed':    sectionsSuppressedCount   += 1; break;
    }
  }

  return {
    normalizedAt:              new Date().toISOString(),
    inputEntryCount,
    outputEntryCount,
    namesCanonicalizedCount,
    categoriesNormalizedCount,
    duplicatesMergedCount,
    suppressedCount,
    sectionsReclassifiedCount,
    sectionsSuppressedCount,
    events: [...events],  // defensive copy
  };
}
