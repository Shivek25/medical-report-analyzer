/**
 * tests/unit/validator/schema.test.ts
 *
 * Unit tests for the Phase 2 validator schemas and `validateStructuredReport`.
 *
 * Validates: Requirements 10.3, 10.4, 12.5
 */

import { describe, it, expect } from 'vitest';

import { validateStructuredReport } from '../../../src/lib/validator/index.js';
import type { StructuredReport } from '../../../src/lib/types/index.js';

/**
 * Build a minimal, well-formed `StructuredReport` so each test can spread or
 * mutate it without sharing state. Keeping this inline (rather than a shared
 * fixture) keeps the test file self-contained.
 */
function buildValidReport(): StructuredReport {
  return {
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
}

describe('validateStructuredReport', () => {
  it('returns { valid: true, errors: [] } for a known-valid StructuredReport', () => {
    const report = buildValidReport();

    const result = validateStructuredReport(report);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports missing testName with a dot-notation field path', () => {
    const report = buildValidReport();
    // Drop the required `testName` from the second entry. Casting to a
    // partial shape lets us simulate parser output that violates the schema
    // without disabling type-checking globally.
    const broken = {
      ...report,
      entries: [
        report.entries[0],
        { ...report.entries[1], testName: undefined },
      ],
    } as unknown;

    const result = validateStructuredReport(broken);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);

    const testNameError = result.errors.find(
      (e) => e.field === 'entries.1.testName',
    );
    expect(testNameError).toBeDefined();
    expect(typeof testNameError?.message).toBe('string');
    expect(testNameError?.message.length).toBeGreaterThan(0);
  });

  it('reports an empty testName as a validation error (non-empty constraint)', () => {
    const report = buildValidReport();
    const broken: StructuredReport = {
      ...report,
      entries: [{ ...report.entries[0]!, testName: '' }],
    };

    const result = validateStructuredReport(broken);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.field === 'entries.0.testName'),
    ).toBe(true);
  });

  it('reports a non-string value with a dot-notation field path', () => {
    const report = buildValidReport();
    const broken = {
      ...report,
      entries: [{ ...report.entries[0], value: 14.5 }],
    } as unknown;

    const result = validateStructuredReport(broken);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.field === 'entries.0.value'),
    ).toBe(true);
  });

  it('reports an out-of-range confidence at extractionQuality.confidence', () => {
    const report = buildValidReport();
    const broken: StructuredReport = {
      ...report,
      extractionQuality: { ...report.extractionQuality, confidence: 1.5 },
    };

    const result = validateStructuredReport(broken);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.field === 'extractionQuality.confidence'),
    ).toBe(true);
  });
});
