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
export async function buildReportSummary(
  report: StructuredReport,
  now?: Date,
): Promise<ReportSummary> {
  const abnormalFindings: SummaryFinding[] = [];
  const normalEntries: NormalEntry[] = [];
  const uncertainEntries: SummaryFinding[] = [];
  let skippedCount = 0;

  const results = await Promise.all(
    report.entries.map(async (entry) => {
      const classification = classifyEntry(entry);

      if (classification === 'skipped') {
        return { type: 'skipped' as const };
      }

      if (entry.uncertain) {
        return {
          type: 'uncertain' as const,
          finding: await buildAbnormalFinding(entry, classification),
        };
      }

      if (ABNORMAL_SEVERITIES.has(classification)) {
        return {
          type: 'abnormal' as const,
          finding: await buildAbnormalFinding(entry, classification),
        };
      }

      return {
        type: 'normal' as const,
        finding: await buildNormalEntry(entry, classification),
      };
    })
  );

  for (const result of results) {
    switch (result.type) {
      case 'skipped':
        skippedCount++;
        break;
      case 'uncertain':
        uncertainEntries.push(result.finding as SummaryFinding);
        break;
      case 'abnormal':
        abnormalFindings.push(result.finding as SummaryFinding);
        break;
      case 'normal':
        normalEntries.push(result.finding as NormalEntry);
        break;
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
): Promise<SummaryFinding> {
  return interpretFinding(entry, classification).then((interpretation) => {
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
  });
}

/**
 * Build a `NormalEntry` for a normal, non-uncertain lab entry.
 */
function buildNormalEntry(
  entry: LabEntry,
  classification: Exclude<ClassificationResult, 'skipped'>,
): Promise<NormalEntry> {
  return interpretFinding(entry, classification).then((interpretation) => {
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
  });
}
