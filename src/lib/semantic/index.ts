/**
 * src/lib/semantic/index.ts
 *
 * Phase 9 — Semantic normalization orchestrator.
 *
 * Public entry point: `normalizeSemantic(report)`.
 *
 * Pipeline (in order):
 *
 *  1. Section classification
 *     - Classify each unique category string (medical / pseudo / noise).
 *     - Entries in noise sections are suppressed immediately.
 *     - Entries in pseudo-sections are moved to "Uncategorized".
 *     - Medical sections have their category normalized to canonical Title Case.
 *     - Emit `section_reclassified` / `section_suppressed` / `category_normalized`
 *       events.
 *
 *  2. Analyte canonicalization
 *     - For every surviving entry, resolve testName → canonical name.
 *     - Emit `name_canonicalized` events.
 *
 *  3. Deduplication
 *     - Pass 1: same (testName, category) → keep best.
 *     - Pass 2: same testName in real section + Uncategorized → keep categorized.
 *     - Emit `duplicate_merged` events.
 *
 *  4. QA report assembly
 *     - Aggregate all events into a QAReport.
 *
 *  5. Re-validation
 *     - Run the existing StructuredReport validator on the cleaned report.
 *     - Any validator failures are surfaced as warnings inside the report's
 *       extractionQuality (the existing contract is not broken).
 *
 * Guarantees:
 *  - Never throws. Any internal error is caught and surfaced through the QA
 *    report's events and a warning in extractionQuality.
 *  - The input StructuredReport is NEVER mutated.
 *  - The output StructuredReport satisfies the existing StructuredReport type.
 *  - When the pipeline fails entirely, the original report is returned unchanged
 *    with a QA report that contains a single error event.
 */

import type { LabEntry, StructuredReport } from '../types/index.js';
import type { NormalizationResult, QAEvent, SectionClassification } from './types.js';
import { classifySections, effectiveCategoryFor } from './section-classifier.js';
import { canonicalizeEntries } from './canonicalizer.js';
import { deduplicateEntries } from './deduplicator.js';
import { buildQAReport } from './qa-report.js';
import { TRUE_CATEGORY_MAP } from './ontology.js';
import { validateStructuredReport } from '../validator/index.js';
import { logger } from '../../shared/logger.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the Phase 9 semantic normalization pipeline over a StructuredReport.
 *
 * @param report - A validated StructuredReport produced by Phase 2 or Phase 6.
 * @returns        A NormalizationResult containing the cleaned report and the
 *                 QA audit trail.
 */
export function normalizeSemantic(report: StructuredReport): NormalizationResult {
  const inputEntryCount = report.entries.length;
  const allEvents: QAEvent[] = [];

  try {
    // ── Step 1: Section classification ───────────────────────────────────────
    const uniqueCategories = new Set(report.entries.map(e => e.category));
    const classifications: Map<string, SectionClassification> = classifySections(uniqueCategories);

    // Categorize entries based on section classification.
    const afterSectionFilter: LabEntry[] = [];

    for (const entry of report.entries) {
      const classification = classifications.get(entry.category);
      if (!classification) {
        // Should not happen; pass through unchanged.
        afterSectionFilter.push(entry);
        continue;
      }

      switch (classification.kind) {
        case 'noise': {
          // Suppress this entry entirely.
          allEvents.push({
            kind: 'entry_suppressed',
            reason: `Entry in noise section "${entry.category}": ${classification.reason}`,
            sourceNames: [entry.testName],
            rawCategory: entry.category,
            sectionKind: 'noise',
            suppressedEntry: entry,
          });
          break;
        }

        case 'pseudo': {
          // Move to Uncategorized; emit reclassification event.
          const reclassified: LabEntry = { ...entry, category: 'Uncategorized' };
          afterSectionFilter.push(reclassified);
          allEvents.push({
            kind: 'section_reclassified',
            reason: `Section "${entry.category}" is a pseudo-section (product/package name, not a medical panel); entry moved to Uncategorized`,
            sourceNames: [entry.testName],
            rawCategory: entry.category,
            canonicalCategory: 'Uncategorized',
            sectionKind: 'pseudo',
          });
          break;
        }

        case 'medical': {
          const canonicalCat = effectiveCategoryFor(classification);
          const categoryChanged = canonicalCat !== entry.category;
          const updated: LabEntry = categoryChanged
            ? { ...entry, category: canonicalCat }
            : entry;
          afterSectionFilter.push(updated);

          if (categoryChanged) {
            allEvents.push({
              kind: 'category_normalized',
              reason: `Category "${entry.category}" normalised to "${canonicalCat}"`,
              sourceNames: [entry.testName],
              rawCategory: entry.category,
              canonicalCategory: canonicalCat,
              sectionKind: 'medical',
            });
          }
          break;
        }
      }
    }

    // Emit one section-level event per unique noise section (in addition to
    // per-entry entry_suppressed events) so the QA report shows section-level
    // decisions, not just entry-level ones.
    for (const [rawCat, cls] of classifications) {
      if (cls.kind === 'noise') {
        const count = report.entries.filter(e => e.category === rawCat).length;
        if (count > 0) {
          allEvents.push({
            kind: 'section_suppressed',
            reason: `Section "${rawCat}" classified as noise; ${count} entr${count === 1 ? 'y' : 'ies'} suppressed`,
            sourceNames: [],
            rawCategory: rawCat,
            sectionKind: 'noise',
          });
        }
      }
    }

    // ── Step 2: Analyte name canonicalization ─────────────────────────────────
    const { entries: afterCanon, events: canonEvents } = canonicalizeEntries(afterSectionFilter);
    allEvents.push(...canonEvents);

    // ── Step 2.5: Forced Category Re-assignment ───────────────────────────────
    // If the canonical name strictly belongs to a specific medical category,
    // forcefully assign it. This rescues valid medical tests that fell into
    // "Uncategorized" due to layout header parsing failures.
    const afterReassignment: LabEntry[] = [];
    for (const entry of afterCanon) {
      const trueCategory = TRUE_CATEGORY_MAP.get(entry.testName);
      if (trueCategory && trueCategory !== entry.category) {
        afterReassignment.push({ ...entry, category: trueCategory });
        allEvents.push({
          kind: 'category_normalized',
          reason: `Analyte "${entry.testName}" forcefully reassigned to true category "${trueCategory}" (was "${entry.category}")`,
          sourceNames: [entry.testName],
          rawCategory: entry.category,
          canonicalCategory: trueCategory,
          sectionKind: 'medical',
        });
      } else {
        afterReassignment.push(entry);
      }
    }

    // ── Step 3: Deduplication ─────────────────────────────────────────────────
    const { entries: afterDedup, events: dedupEvents } = deduplicateEntries(afterReassignment);
    allEvents.push(...dedupEvents);

    // ── Step 4: Build cleaned StructuredReport ────────────────────────────────
    const cleanedReport: StructuredReport = {
      ...report,
      entries: afterDedup,
    };

    // ── Step 5: Re-validate ───────────────────────────────────────────────────
    const validation = validateStructuredReport(cleanedReport);
    if (!validation.valid) {
      logger.warn('semantic:validation-failed-after-normalization', {
        errorCount: validation.errors.length,
      });
      cleanedReport.extractionQuality = {
        ...cleanedReport.extractionQuality,
        validationFailed: true,
        warnings: [
          ...cleanedReport.extractionQuality.warnings,
          `Semantic normalization: post-normalization validation failed with ${validation.errors.length} error(s)`,
        ],
      };
    }

    // ── Step 6: Build QA report ───────────────────────────────────────────────
    const qa = buildQAReport(inputEntryCount, afterDedup.length, allEvents);

    logger.info('semantic:normalization-complete', {
      inputEntries:       inputEntryCount,
      outputEntries:      afterDedup.length,
      namesCanonicalised: qa.namesCanonicalizedCount,
      duplicatesMerged:   qa.duplicatesMergedCount,
      suppressed:         qa.suppressedCount,
      reclassified:       qa.sectionsReclassifiedCount,
    });

    return { report: cleanedReport, qa };

  } catch (err: unknown) {
    // Safety net: never propagate an exception from the normalization layer.
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('semantic:normalization-error', { message });

    const errorEvent: QAEvent = {
      kind: 'entry_suppressed',
      reason: `Semantic normalization pipeline failed: ${message}`,
      sourceNames: [],
    };

    const qa = buildQAReport(inputEntryCount, report.entries.length, [errorEvent]);

    // Return the original report unchanged.
    return { report, qa };
  }
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type { NormalizationResult, QAReport, QAEvent } from './types.js';
export { resolveCanonicalAnalyte } from './ontology.js';
export { classifySection }         from './section-classifier.js';
export { canonicalizeEntry }       from './canonicalizer.js';
