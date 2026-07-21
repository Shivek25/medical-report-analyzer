/**
 * src/lib/semantic/types.ts
 *
 * Phase 9 — Semantic normalization types.
 *
 * All types used by the semantic normalization subsystem are defined here.
 * They are intentionally separate from src/lib/types/index.ts so the
 * normalization layer stays independently testable and the core StructuredReport
 * contract is not polluted.
 *
 * Key design decisions:
 *  - Every QA event carries a `reason` string so the audit trail is human-
 *    readable without having to cross-reference code.
 *  - `sourceNames` preserves the original analyte spelling(s) so the canonical
 *    name change is fully traceable.
 *  - `suppressed` entries are kept in the QA output but never appear in the
 *    cleaned StructuredReport; callers can inspect suppressions without
 *    re-running the pipeline.
 */

import type { LabEntry } from '../types/index.js';

// ─── Section classification ────────────────────────────────────────────────────

/**
 * Classification of a StructuredReport entry category string.
 *
 *  - `medical`     : A real medical panel header (e.g. "Lipid Profile",
 *                    "Complete Blood Count"). Entries keep their category.
 *  - `pseudo`      : A heading that looks like a section but is not a real
 *                    medical panel (e.g. "Test Package", "Aarogyam Pro").
 *                    Entries are re-classified to "Uncategorized".
 *  - `noise`       : Marketing, roadmap, promotional, or boilerplate text
 *                    incorrectly promoted to a section. Entries are suppressed.
 */
export type SectionKind = 'medical' | 'pseudo' | 'noise';

/** Result of classifying a single category string. */
export interface SectionClassification {
  /** Original category string from the StructuredReport entry. */
  rawCategory: string;
  /** Classification verdict. */
  kind: SectionKind;
  /**
   * Normalised display-form of the category for medical sections
   * (e.g. "LIPID PROFILE" → "Lipid Profile"). Same as rawCategory for
   * pseudo and noise sections.
   */
  canonicalCategory: string;
  /** Human-readable reason for this verdict. */
  reason: string;
}

// ─── QA events ────────────────────────────────────────────────────────────────

/** What kind of normalization action was taken. */
export type QAEventKind =
  | 'name_canonicalized'   // analyte name mapped to canonical form
  | 'category_normalized'  // category string normalised to title-case / canonical form
  | 'duplicate_merged'     // two entries referring to the same analyte were merged
  | 'entry_suppressed'     // entry removed because it is boilerplate / noise
  | 'section_reclassified' // a pseudo-section's entries moved to Uncategorized
  | 'section_suppressed';  // a noise section's entries were suppressed

/**
 * A single traceable normalization event.
 *
 * Every event carries:
 *  - `kind`        : What happened.
 *  - `reason`      : Human-readable explanation (auditable without source code).
 *  - `affectedEntries`: The testName(s) of affected entries BEFORE normalization.
 *    At least one entry is always listed.
 *
 * Additional fields are populated based on the event kind (see comments).
 */
export interface QAEvent {
  kind: QAEventKind;
  reason: string;
  /**
   * Test names (raw/pre-normalization) of the entries this event relates to.
   * For merges, both the kept and dropped entry names are listed.
   */
  sourceNames: string[];
  /**
   * The canonical name assigned after normalization.
   * Present for `name_canonicalized` and `duplicate_merged` events.
   */
  canonicalName?: string;
  /**
   * The raw category string that was reclassified or suppressed.
   * Present for `section_reclassified` and `section_suppressed` events.
   */
  rawCategory?: string;
  /**
   * The canonical category assigned.
   * Present for `category_normalized` and `section_reclassified` events.
   */
  canonicalCategory?: string;
  /**
   * The section classification verdict.
   * Present for `section_reclassified` and `section_suppressed` events.
   */
  sectionKind?: SectionKind;
  /**
   * Full snapshot of the suppressed entry (for audit).
   * Present for `entry_suppressed` and `duplicate_merged` (dropped side) events.
   */
  suppressedEntry?: Readonly<LabEntry>;
}

// ─── QA report ────────────────────────────────────────────────────────────────

/**
 * The Phase 9 QA audit report returned alongside the cleaned StructuredReport.
 *
 * Consumers (API routes, tests) receive this as a separate object so that
 * the StructuredReport contract is not modified and existing downstream code
 * (summary generation, PDF export) is unaffected.
 */
export interface QAReport {
  /** ISO 8601 timestamp when normalization completed. */
  normalizedAt: string;

  /** Total entries in the input report before normalization. */
  inputEntryCount: number;

  /** Total entries in the output report after normalization. */
  outputEntryCount: number;

  /** Number of analyte names that were mapped to a canonical form. */
  namesCanonicalizedCount: number;

  /** Number of categories that were normalized. */
  categoriesNormalizedCount: number;

  /** Number of duplicate entries that were merged. */
  duplicatesMergedCount: number;

  /** Number of entries suppressed as noise/boilerplate. */
  suppressedCount: number;

  /** Number of sections reclassified (pseudo → Uncategorized). */
  sectionsReclassifiedCount: number;

  /** Number of sections suppressed (noise sections with entries removed). */
  sectionsSuppressedCount: number;

  /**
   * Ordered log of every normalization action taken.
   * Each event is independently traceable back to the source entry.
   */
  events: QAEvent[];
}

// ─── Normalization result ─────────────────────────────────────────────────────

/**
 * The Phase 9 output envelope.
 *
 * `report` is a new StructuredReport object (the input is never mutated).
 * `qa`     is the fully populated audit trail.
 */
export interface NormalizationResult {
  report: import('../types/index.js').StructuredReport;
  qa: QAReport;
}
