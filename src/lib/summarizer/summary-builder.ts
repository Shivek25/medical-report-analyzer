/**
 * src/lib/summarizer/summary-builder.ts
 *
 * Orchestrator: converts a `StructuredReport` (Phase 2) into a
 * `ReportSummary` (Phase 3).
 *
 * Pipeline:
 *   1. Classify each entry
 *   2. Build SummaryFinding / NormalEntry objects
 *   3. Separate into abnormal / normal / uncertain buckets
 *      (uncertain entries go ONLY to the uncertain section)
 *   4. Group abnormal and normal findings by category
 *   5. Compute generation metadata
 *   6. Build overview text
 *   7. Attach disclaimer
 */

import type {
  StructuredReport,
  ReportSummary,
  SummaryFinding,
  NormalEntry,
  SummaryGenerationMeta,
  LabEntry,
} from '../types/index.js';
import { classifyEntry, type ClassificationResult } from './classifier.js';
import { interpretFinding } from './interpreter.js';
import { groupByCategory, groupNormalByCategory } from './grouper.js';
import { buildOverview } from './overview-builder.js';
import { SUMMARY_DISCLAIMER } from '../../shared/constants.js';
import { toISOString } from '../../shared/utils.js';

/** Severities that are considered "abnormal" for bucketing purposes. */
const ABNORMAL_SEVERITIES = new Set<string>([
  'high',
  'low',
  'critical-high',
  'critical-low',
  'borderline-high',
  'borderline-low',
]);

/**
 * Build a complete `ReportSummary` from a validated `StructuredReport`.
 *
 * This is the main Phase 3 entry point. The function is deterministic
 * aside from the `generatedAt` timestamp (pass `now` to pin it for tests).
 */
export function buildReportSummary(
  report: StructuredReport,
  now?: Date,
): ReportSummary {
  const abnormalFindings: SummaryFinding[] = [];
  const normalEntries: NormalEntry[] = [];
  const uncertainEntries: SummaryFinding[] = [];
  let skippedCount = 0;

  for (const entry of report.entries) {
    const classification = classifyEntry(entry);

    // Skipped entries (non-numeric, no flag) don't appear in the summary
    if (classification === 'skipped') {
      skippedCount++;
      continue;
    }

    // Uncertain entries go ONLY to the uncertain section
    if (entry.uncertain) {
      uncertainEntries.push(buildAbnormalFinding(entry, classification));
      continue;
    }

    // Bucket by severity
    if (ABNORMAL_SEVERITIES.has(classification)) {
      abnormalFindings.push(buildAbnormalFinding(entry, classification));
    } else {
      normalEntries.push(buildNormalEntry(entry, classification));
    }
  }

  const generationMeta: SummaryGenerationMeta = {
    generatedAt: toISOString(now),
    sourceConfidence: report.extractionQuality.confidence,
    totalEntries: report.entries.length,
    abnormalCount: abnormalFindings.length,
    normalCount: normalEntries.length,
    uncertainCount: uncertainEntries.length,
    skippedCount,
  };

  const overviewText = buildOverview(generationMeta, report.metadata);

  return {
    metadata: report.metadata,
    generationMeta,
    overviewText,
    abnormalFindings: groupByCategory(abnormalFindings),
    normalFindings: groupNormalByCategory(normalEntries),
    uncertainEntries,
    disclaimer: SUMMARY_DISCLAIMER,
  };
}

/**
 * Build a `SummaryFinding` for an abnormal or uncertain entry.
 */
function buildAbnormalFinding(
  entry: LabEntry,
  classification: Exclude<ClassificationResult, 'skipped'>,
): SummaryFinding {
  const interpretation = interpretFinding(entry, classification);

  const finding: SummaryFinding = {
    testName: entry.testName,
    value: entry.value,
    severity: classification === 'normal' ? 'high' : classification, // 'normal' uncertain entries get a default
    category: entry.category,
    interpretation,
    uncertain: entry.uncertain,
  };

  if (entry.unit !== undefined) {
    finding.unit = entry.unit;
  }
  if (entry.referenceRange !== undefined) {
    finding.referenceRange = entry.referenceRange;
  }
  if (entry.uncertaintyReason !== undefined) {
    finding.uncertaintyReason = entry.uncertaintyReason;
  }

  return finding;
}

/**
 * Build a `NormalEntry` for a normal, non-uncertain lab entry.
 */
function buildNormalEntry(
  entry: LabEntry,
  classification: Exclude<ClassificationResult, 'skipped'>,
): NormalEntry {
  const interpretation = interpretFinding(entry, classification);

  const normalEntry: NormalEntry = {
    testName: entry.testName,
    value: entry.value,
    category: entry.category,
    interpretation,
  };

  if (entry.unit !== undefined) {
    normalEntry.unit = entry.unit;
  }
  if (entry.referenceRange !== undefined) {
    normalEntry.referenceRange = entry.referenceRange;
  }

  return normalEntry;
}
