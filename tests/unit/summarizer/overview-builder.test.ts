/**
 * tests/unit/summarizer/overview-builder.test.ts
 *
 * Unit tests for the plain-language overview builder.
 */

import { describe, it, expect } from 'vitest';
import { buildOverview } from '../../../src/lib/summarizer/overview-builder.js';
import type { ReportMetadata, SummaryGenerationMeta } from '../../../src/lib/types/index.js';

/** Helper: build a minimal SummaryGenerationMeta with overrides. */
function makeMeta(overrides: Partial<SummaryGenerationMeta> = {}): SummaryGenerationMeta {
  return {
    generatedAt: '2025-06-15T00:00:00.000Z',
    sourceConfidence: 0.95,
    totalEntries: 20,
    abnormalCount: 0,
    normalCount: 20,
    uncertainCount: 0,
    skippedCount: 0,
    ...overrides,
  };
}

/** Helper: build a minimal ReportMetadata with overrides. */
function makeMetadata(overrides: Partial<ReportMetadata> = {}): ReportMetadata {
  return {
    patientName: 'Shivek Sharma',
    reportDate: '2025-06-15',
    ...overrides,
  };
}

describe('buildOverview', () => {
  it('produces "All N results are within normal range" when no abnormals', () => {
    const result = buildOverview(makeMeta(), makeMetadata());
    expect(result).toContain('All 20 test results are within normal range');
    expect(result).toContain('Shivek Sharma');
    expect(result).toContain('2025-06-15');
  });

  it('produces "X of N results are outside the normal range" for abnormals', () => {
    const result = buildOverview(
      makeMeta({ abnormalCount: 3, normalCount: 17 }),
      makeMetadata(),
    );
    expect(result).toContain('3 of 20 test results are outside the normal range');
  });

  it('uses singular grammar for 1 abnormal result', () => {
    const result = buildOverview(
      makeMeta({ totalEntries: 5, abnormalCount: 1, normalCount: 4, skippedCount: 0 }),
      makeMetadata(),
    );
    expect(result).toContain('1 of 5 test results is outside the normal range');
  });

  it('handles missing patient name', () => {
    const result = buildOverview(makeMeta(), makeMetadata({ patientName: undefined }));
    expect(result).toMatch(/^Report dated 2025-06-15/);
    expect(result).not.toContain('for');
  });

  it('handles missing report date', () => {
    const result = buildOverview(
      makeMeta(),
      makeMetadata({ reportDate: undefined, sampleDate: undefined }),
    );
    expect(result).toMatch(/^Report for Shivek Sharma/);
    expect(result).not.toContain('dated');
  });

  it('falls back to sampleDate when reportDate is missing', () => {
    const result = buildOverview(
      makeMeta(),
      makeMetadata({ reportDate: undefined, sampleDate: '2025-06-14' }),
    );
    expect(result).toContain('2025-06-14');
  });

  it('uses "Report summary" when both name and date are missing', () => {
    const result = buildOverview(
      makeMeta(),
      makeMetadata({ patientName: undefined, reportDate: undefined, sampleDate: undefined }),
    );
    expect(result).toMatch(/^Report summary/);
  });

  it('mentions uncertain entries', () => {
    const result = buildOverview(
      makeMeta({ uncertainCount: 2 }),
      makeMetadata(),
    );
    expect(result).toContain('2 results could not be fully verified');
  });

  it('uses singular for 1 uncertain entry', () => {
    const result = buildOverview(
      makeMeta({ uncertainCount: 1 }),
      makeMetadata(),
    );
    expect(result).toContain('1 result could not be fully verified');
  });

  it('notes low-confidence extraction', () => {
    const result = buildOverview(
      makeMeta({ sourceConfidence: 0.5 }),
      makeMetadata(),
    );
    expect(result).toContain('extraction confidence');
    expect(result).toContain('low');
  });

  it('does not note confidence when it is above threshold', () => {
    const result = buildOverview(
      makeMeta({ sourceConfidence: 0.85 }),
      makeMetadata(),
    );
    expect(result).not.toContain('confidence');
  });

  it('handles zero evaluable entries (all skipped)', () => {
    const result = buildOverview(
      makeMeta({ totalEntries: 5, skippedCount: 5, normalCount: 0, abnormalCount: 0 }),
      makeMetadata(),
    );
    expect(result).toContain('No evaluable test results found');
  });

  it('accounts for skipped entries in evaluated count', () => {
    const result = buildOverview(
      makeMeta({ totalEntries: 10, skippedCount: 3, abnormalCount: 2, normalCount: 5 }),
      makeMetadata(),
    );
    // evaluated = 10 - 3 = 7
    expect(result).toContain('2 of 7');
  });
});
