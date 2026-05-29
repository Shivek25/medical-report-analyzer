/**
 * Smoke test for Phase 2 type and module surface.
 *
 * Asserts that the Phase 2 types (StructuredReport, LabEntry, ReportMetadata,
 * ExtractionQuality, ParseOptions) are importable from `src/lib/types/index.ts`
 * and that a hand-written valid object compiles against the types.
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4
 */

import { describe, it, expect } from 'vitest';
import type {
  StructuredReport,
  LabEntry,
  LabReferenceRange,
  ReportMetadata,
  ExtractionQuality,
  ParseOptions,
} from '../../src/lib/types/index.js';

describe('Phase 2 type and module surface', () => {
  it('exposes ParseOptions with optional keepRawText', () => {
    const empty: ParseOptions = {};
    const withFlag: ParseOptions = { keepRawText: true };

    expect(empty).toEqual({});
    expect(withFlag.keepRawText).toBe(true);
  });

  it('exposes ReportMetadata with optional patient and lab fields', () => {
    const metadata: ReportMetadata = {
      patientName: 'Shivek Sharma',
      patientAge: 22,
      patientGender: 'M',
      reportDate: '2025-06-25',
      sampleDate: '2025-06-24',
      labName: 'Thyrocare',
      reportId: 'BC-12345',
    };

    expect(metadata.patientName).toBe('Shivek Sharma');
    expect(metadata.patientAge).toBe(22);
    expect(metadata.patientGender).toBe('M');
    expect(metadata.reportId).toBe('BC-12345');
  });

  it('exposes LabEntry with structured reference range', () => {
    const range: LabReferenceRange = { low: 12.0, high: 16.0, text: '12.0-16.0' };

    const entry: LabEntry = {
      testName: 'HEMOGLOBIN',
      value: '14.5',
      unit: 'g/dL',
      referenceRange: range,
      flag: undefined,
      notes: undefined,
      category: 'Hemogram',
      uncertain: false,
    };

    expect(entry.testName).toBe('HEMOGLOBIN');
    expect(entry.value).toBe('14.5');
    expect(entry.unit).toBe('g/dL');
    expect(entry.referenceRange?.low).toBe(12.0);
    expect(entry.referenceRange?.high).toBe(16.0);
    expect(entry.uncertain).toBe(false);
    expect(entry.category).toBe('Hemogram');
  });

  it('supports an uncertain LabEntry with a traceable reason', () => {
    const entry: LabEntry = {
      testName: 'UNKNOWN MARKER',
      value: '',
      category: 'Uncategorized',
      uncertain: true,
      uncertaintyReason: "Missing value; raw: 'UNKNOWN MARKER'",
    };

    expect(entry.uncertain).toBe(true);
    expect(entry.uncertaintyReason).toContain('Missing value');
  });

  it('exposes ExtractionQuality with required count and confidence fields', () => {
    const quality: ExtractionQuality = {
      totalRowsDetected: 10,
      successfullyParsed: 8,
      uncertainRows: 1,
      skippedRows: 1,
      ambiguousLines: ['line at index 4'],
      warnings: ['Multi-line merge exceeded 3 lines at row 7'],
      confidence: 0.8,
      lowConfidence: false,
      validationFailed: false,
    };

    expect(quality.totalRowsDetected).toBe(10);
    expect(quality.successfullyParsed + quality.uncertainRows).toBeLessThanOrEqual(
      quality.totalRowsDetected,
    );
    expect(quality.confidence).toBeGreaterThanOrEqual(0);
    expect(quality.confidence).toBeLessThanOrEqual(1);
    expect(quality.lowConfidence).toBe(false);
    expect(quality.ambiguousLines).toHaveLength(1);
  });

  it('compiles a hand-written valid StructuredReport object', () => {
    const report: StructuredReport = {
      metadata: {
        patientName: 'Shivek Sharma',
        patientAge: 22,
        patientGender: 'M',
        reportDate: '2025-06-25',
        labName: 'Thyrocare',
      },
      entries: [
        {
          testName: 'HEMOGLOBIN',
          value: '14.5',
          unit: 'g/dL',
          referenceRange: { low: 12.0, high: 16.0, text: '12.0-16.0' },
          category: 'Hemogram',
          uncertain: false,
        },
        {
          testName: 'HIV ANTIBODY',
          value: 'Non-Reactive',
          referenceRange: { text: 'Non-Reactive' },
          category: 'Serology',
          uncertain: false,
        },
      ],
      extractionQuality: {
        totalRowsDetected: 2,
        successfullyParsed: 2,
        uncertainRows: 0,
        skippedRows: 0,
        ambiguousLines: [],
        warnings: [],
        confidence: 1,
        lowConfidence: false,
      },
    };

    expect(report.metadata.patientName).toBe('Shivek Sharma');
    expect(report.entries).toHaveLength(2);
    expect(report.entries[0]?.testName).toBe('HEMOGLOBIN');
    expect(report.entries[1]?.value).toBe('Non-Reactive');
    expect(report.extractionQuality.confidence).toBe(1);
    // Requirement 11.5: when keepRawText is not requested, rawText key may be absent.
    expect('rawText' in report).toBe(false);
  });

  it('supports StructuredReport with optional rawText when requested', () => {
    const reportWithRaw: StructuredReport = {
      metadata: {},
      entries: [],
      rawText: 'cleaned text body',
      extractionQuality: {
        totalRowsDetected: 0,
        successfullyParsed: 0,
        uncertainRows: 0,
        skippedRows: 0,
        ambiguousLines: [],
        warnings: [],
        confidence: 0,
        lowConfidence: false,
      },
    };

    expect(reportWithRaw.rawText).toBe('cleaned text body');
    expect(reportWithRaw.entries).toEqual([]);
  });
});
