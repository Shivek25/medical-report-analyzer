/**
 * src/lib/summarizer/index.ts
 *
 * Public API for the summarizer module.
 *
 * Phase 3 provides `buildReportSummary` — a deterministic, LLM-free
 * pipeline that converts a `StructuredReport` into a `ReportSummary`.
 *
 * The legacy `generateSummary` and `buildSummaryPrompt` stubs from Phase 0
 * are preserved as deprecated exports for backwards compatibility.
 */

import type { BloodTestReport, MedicalSummary } from '../types/index.js';

// ─── Phase 3 Public API ───────────────────────────────────────────────────────

export { buildReportSummary } from './summary-builder.js';
export { classifyEntry, type ClassificationResult } from './classifier.js';
export { interpretFinding, formatReferenceRange } from './interpreter.js';
export { groupByCategory, groupNormalByCategory } from './grouper.js';
export { buildOverview } from './overview-builder.js';

// ─── Legacy Stubs (Phase 0 — Deprecated) ─────────────────────────────────────

export interface SummaryOptions {
  /** Language for the summary (default: 'en') */
  language?: string;
  /** Include raw LLM response for debugging */
  debug?: boolean;
}

/**
 * @deprecated Use `buildReportSummary` instead. This stub was a Phase 0
 * placeholder for LLM-based summarization and will be removed in Phase 4.
 */
export async function generateSummary(
  _report: BloodTestReport,
  _options?: SummaryOptions,
): Promise<MedicalSummary> {
  throw new Error(
    'generateSummary is deprecated. Use buildReportSummary(structuredReport) instead.',
  );
}

/**
 * @deprecated Use `buildReportSummary` instead. This stub was a Phase 0
 * placeholder for LLM prompt construction and will be removed in Phase 4.
 */
export function buildSummaryPrompt(_report: BloodTestReport): string {
  throw new Error(
    'buildSummaryPrompt is deprecated. Use buildReportSummary(structuredReport) instead.',
  );
}
