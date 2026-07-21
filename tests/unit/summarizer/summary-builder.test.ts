/**
 * tests/unit/summarizer/summary-builder.test.ts
 *
 * Integration-level unit tests for the full summary pipeline.
 * Verifies that StructuredReport → ReportSummary conversion is correct,
 * with proper bucketing, counts, and structural integrity.
 */

import { describe, it, expect } from 'vitest';
import { buildReportSummary } from '../../../src/lib/summarizer/summary-builder.js';
import type {
  StructuredReport,
  LabEntry,
  ExtractionQuality,
  ReportMetadata,
} from '../../../src/lib/types/index.js';
import { SUMMARY_DISCLAIMER } from '../../../src/shared/constants.js';

/** Fixed date for deterministic tests. */
const NOW = new Date('2025-07-01T12:00:00.000Z');

/** Helper: build a minimal ExtractionQuality. */
function makeQuality(overrides: Partial<ExtractionQuality> = {}): ExtractionQuality {
  return {
    totalRowsDetected: 10,
    successfullyParsed: 10,
    uncertainRows: 0,
    skippedRows: 0,
    ambiguousLines: [],
    warnings: [],
    confidence: 0.95,
    lowConfidence: false,
    ...overrides,
  };
}

/** Helper: build a minimal ReportMetadata. */
function makeMetadata(overrides: Partial<ReportMetadata> = {}): ReportMetadata {
  return {
    patientName: 'Test Patient',
    reportDate: '2025-06-15',
    ...overrides,
  };
}

/** Helper: build a minimal LabEntry. */
function makeEntry(overrides: Partial<LabEntry> = {}): LabEntry {
  return {
    testName: 'Hemoglobin',
    value: '14',
    unit: 'g/dL',
    referenceRange: { low: 12, high: 16 },
    category: 'Hemogram',
    uncertain: false,
    ...overrides,
  };
}

/** Helper: build a minimal StructuredReport. */
function makeReport(
  entries: LabEntry[] = [],
  metadataOverrides: Partial<ReportMetadata> = {},
  qualityOverrides: Partial<ExtractionQuality> = {},
): StructuredReport {
  return {
    metadata: makeMetadata(metadataOverrides),
    entries,
    extractionQuality: makeQuality(qualityOverrides),
  };
}

describe('buildReportSummary', () => {
  // ── Structural integrity ──────────────────────────────────────────────

  it('returns a valid ReportSummary for an empty entries array', async () => {
    const report = makeReport([]);
    const summary = await buildReportSummary(report, NOW);

    expect(summary.metadata).toEqual(report.metadata);
    expect(summary.generationMeta.totalEntries).toBe(0);
    expect(summary.generationMeta.abnormalCount).toBe(0);
    expect(summary.generationMeta.normalCount).toBe(0);
    expect(summary.generationMeta.uncertainCount).toBe(0);
    expect(summary.generationMeta.skippedCount).toBe(0);
    expect(summary.abnormalFindings).toEqual([]);
    expect(summary.normalFindings).toEqual([]);
    expect(summary.uncertainEntries).toEqual([]);
    expect(summary.disclaimer).toBe(SUMMARY_DISCLAIMER);
  });

  it('always includes the standard disclaimer', async () => {
    const report = makeReport([makeEntry()]);
    const summary = await buildReportSummary(report, NOW);
    expect(summary.disclaimer).toBe(SUMMARY_DISCLAIMER);
  });

  it('uses the pinned timestamp', async () => {
    const report = makeReport([]);
    const summary = await buildReportSummary(report, NOW);
    expect(summary.generationMeta.generatedAt).toBe('2025-07-01T12:00:00.000Z');
  });

  // ── All-normal report ─────────────────────────────────────────────────

  it('handles an all-normal report correctly', async () => {
    const entries = [
      makeEntry({ testName: 'Hemoglobin', value: '14', referenceRange: { low: 12, high: 16 } }),
      makeEntry({ testName: 'WBC', value: '7', referenceRange: { low: 4, high: 11 }, unit: 'K/uL' }),
    ];
    const report = makeReport(entries);
    const summary = await buildReportSummary(report, NOW);

    expect(summary.abnormalFindings).toEqual([]);
    expect(summary.generationMeta.abnormalCount).toBe(0);
    expect(summary.generationMeta.normalCount).toBe(2);
    expect(summary.normalFindings.length).toBeGreaterThan(0);
    expect(summary.overviewText).toContain('All 2 test results are within normal range');
  });

  // ── Mixed normal/abnormal ─────────────────────────────────────────────

  it('correctly separates normal and abnormal entries', async () => {
    const entries = [
      makeEntry({ testName: 'Normal Test', value: '5', referenceRange: { low: 1, high: 10 } }),
      makeEntry({ testName: 'High Test', value: '15', referenceRange: { low: 1, high: 10 } }),
      makeEntry({ testName: 'Low Test', value: '0.3', referenceRange: { low: 1, high: 10 } }),
    ];
    const report = makeReport(entries);
    const summary = await buildReportSummary(report, NOW);

    expect(summary.generationMeta.abnormalCount).toBe(2);
    expect(summary.generationMeta.normalCount).toBe(1);

    // Abnormal findings should be grouped
    const allAbnormalNames = summary.abnormalFindings
      .flatMap((g) => g.findings)
      .map((f) => f.testName);
    expect(allAbnormalNames).toContain('High Test');
    expect(allAbnormalNames).toContain('Low Test');
    expect(allAbnormalNames).not.toContain('Normal Test');
  });

  // ── Uncertain entries isolation ───────────────────────────────────────

  it('places uncertain entries only in uncertainEntries, not in normal/abnormal', async () => {
    const entries = [
      makeEntry({ testName: 'Normal Test', value: '5', referenceRange: { low: 1, high: 10 } }),
      makeEntry({
        testName: 'Uncertain Normal',
        value: '5',
        referenceRange: { low: 1, high: 10 },
        uncertain: true,
        uncertaintyReason: 'Ambiguous unit',
      }),
      makeEntry({
        testName: 'Uncertain High',
        value: '15',
        referenceRange: { low: 1, high: 10 },
        uncertain: true,
        uncertaintyReason: 'Bad OCR',
      }),
    ];
    const report = makeReport(entries);
    const summary = await buildReportSummary(report, NOW);

    // Should have 1 normal, 0 abnormal, 2 uncertain
    expect(summary.generationMeta.normalCount).toBe(1);
    expect(summary.generationMeta.abnormalCount).toBe(0);
    expect(summary.generationMeta.uncertainCount).toBe(2);

    // Verify uncertain entries
    const uncertainNames = summary.uncertainEntries.map((e) => e.testName);
    expect(uncertainNames).toContain('Uncertain Normal');
    expect(uncertainNames).toContain('Uncertain High');

    // Verify they're not in normal or abnormal
    const allNormalNames = summary.normalFindings
      .flatMap((g) => g.entries)
      .map((e) => e.testName);
    const allAbnormalNames = summary.abnormalFindings
      .flatMap((g) => g.findings)
      .map((f) => f.testName);
    expect(allNormalNames).not.toContain('Uncertain Normal');
    expect(allNormalNames).not.toContain('Uncertain High');
    expect(allAbnormalNames).not.toContain('Uncertain Normal');
    expect(allAbnormalNames).not.toContain('Uncertain High');
  });

  it('preserves uncertaintyReason in uncertain entries', async () => {
    const entries = [
      makeEntry({
        testName: 'Bad OCR',
        value: '5',
        referenceRange: { low: 1, high: 10 },
        uncertain: true,
        uncertaintyReason: 'OCR confidence low',
      }),
    ];
    const report = makeReport(entries);
    const summary = await buildReportSummary(report, NOW);

    expect(summary.uncertainEntries[0].uncertaintyReason).toBe('OCR confidence low');
  });

  // ── Skipped entries ───────────────────────────────────────────────────

  it('counts non-numeric entries without flags as skipped', async () => {
    const entries = [
      makeEntry({ testName: 'HIV Antibody', value: 'Negative' }),
      makeEntry({ testName: 'Hemoglobin', value: '14', referenceRange: { low: 12, high: 16 } }),
    ];
    const report = makeReport(entries);
    const summary = await buildReportSummary(report, NOW);

    expect(summary.generationMeta.skippedCount).toBe(1);
    expect(summary.generationMeta.normalCount).toBe(1);
    expect(summary.generationMeta.totalEntries).toBe(2);
  });

  // ── Generation metadata accuracy ──────────────────────────────────────

  it('has accurate generationMeta counters for a mixed report', async () => {
    const entries = [
      makeEntry({ testName: 'Normal', value: '5', referenceRange: { low: 1, high: 10 } }),
      makeEntry({ testName: 'High', value: '15', referenceRange: { low: 1, high: 10 } }),
      makeEntry({ testName: 'Skipped', value: 'Positive' }),
      makeEntry({
        testName: 'Uncertain',
        value: '7',
        referenceRange: { low: 1, high: 10 },
        uncertain: true,
      }),
    ];
    const report = makeReport(entries);
    const summary = await buildReportSummary(report, NOW);

    expect(summary.generationMeta.totalEntries).toBe(4);
    expect(summary.generationMeta.normalCount).toBe(1);
    expect(summary.generationMeta.abnormalCount).toBe(1);
    expect(summary.generationMeta.uncertainCount).toBe(1);
    expect(summary.generationMeta.skippedCount).toBe(1);
    expect(summary.generationMeta.sourceConfidence).toBe(0.95);
  });

  // ── Overview text ─────────────────────────────────────────────────────

  it('includes abnormal count in overview text', async () => {
    const entries = [
      makeEntry({ testName: 'A', value: '15', referenceRange: { low: 1, high: 10 } }),
      makeEntry({ testName: 'B', value: '5', referenceRange: { low: 1, high: 10 } }),
    ];
    const report = makeReport(entries);
    const summary = await buildReportSummary(report, NOW);

    expect(summary.overviewText).toContain('1 of 2');
    expect(summary.overviewText).toContain('outside the normal range');
  });

  // ── Low-confidence report ─────────────────────────────────────────────

  it('notes low confidence in overview when confidence is below 0.7', async () => {
    const report = makeReport(
      [makeEntry()],
      {},
      { confidence: 0.4, lowConfidence: true },
    );
    const summary = await buildReportSummary(report, NOW);

    expect(summary.overviewText).toContain('extraction confidence');
  });

  // ── Grouping correctness ──────────────────────────────────────────────

  it('groups abnormal findings by category', async () => {
    const entries = [
      makeEntry({ testName: 'LDL', value: '200', category: 'Lipid', referenceRange: { low: 0, high: 130 } }),
      makeEntry({ testName: 'HDL', value: '25', category: 'Lipid', referenceRange: { low: 40, high: 60 } }),
      makeEntry({ testName: 'Creatinine', value: '3', category: 'Renal', referenceRange: { low: 0.5, high: 1.2 } }),
    ];
    const report = makeReport(entries);
    const summary = await buildReportSummary(report, NOW);

    expect(summary.abnormalFindings).toHaveLength(2); // Lipid, Renal
    const categories = summary.abnormalFindings.map((g) => g.category);
    expect(categories).toContain('Lipid');
    expect(categories).toContain('Renal');

    const lipidGroup = summary.abnormalFindings.find((g) => g.category === 'Lipid')!;
    expect(lipidGroup.findings).toHaveLength(2);
  });
});
