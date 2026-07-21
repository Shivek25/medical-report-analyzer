/**
 * tests/unit/parser/normalizer.test.ts
 *
 * Unit tests for the Phase 2 Normalizer (`src/lib/parser/normalizer.ts`).
 *
 * Covers a happy-path case (canonical unit lookup + numeric reference-range
 * parsing) and edge cases where the reference range is qualitative or uses a
 * comparison operator and SHOULD be preserved verbatim in `text` with
 * `low` / `high` left undefined.
 *
 * Validates: Requirements 6.3, 6.4, 6.5, 12.5
 */

import { describe, it, expect } from 'vitest';

import { normalize } from '../../../src/lib/parser/normalizer.js';
import type { LabEntry } from '../../../src/lib/types/index.js';

describe('normalize (happy path)', () => {
  it('canonicalises the unit and parses a numeric reference range', () => {
    // Validates: Requirements 6.3, 6.4
    const entry: LabEntry = {
      testName: 'HEMOGLOBIN',
      value: '14.5',
      unit: 'mg/dl',
      referenceRange: { text: '12.0-16.0' },
      category: 'Hemogram',
      uncertain: false,
    };

    const result = normalize(entry);

    // Unit is looked up in the canonical unit map (case-insensitive).
    expect(result.unit).toBe('mg/dL');

    // Numeric range text matches `lo-hi`, so low/high are populated.
    expect(result.referenceRange).toBeDefined();
    expect(result.referenceRange?.low).toBe(12.0);
    expect(result.referenceRange?.high).toBe(16.0);
    // text is kept (trimmed) verbatim.
    expect(result.referenceRange?.text).toBe('12.0-16.0');

    // Required scalar fields pass through trimmed.
    expect(result.testName).toBe('HEMOGLOBIN');
    expect(result.value).toBe('14.5');
    expect(result.category).toBe('Hemogram');
    expect(result.uncertain).toBe(false);
  });
});

describe('normalize (edge cases)', () => {
  it('parses a comparison-operator range like "< 30" to set high limit (safety fix)', () => {
    const entry: LabEntry = {
      testName: 'CRP',
      value: '4.2',
      unit: 'mg/L',
      referenceRange: { text: '< 30' },
      category: 'Inflammation',
      uncertain: false,
    };

    const result = normalize(entry);

    expect(result.referenceRange?.text).toBe('< 30');
    expect(result.referenceRange?.low).toBeUndefined();
    expect(result.referenceRange?.high).toBe(30);
  });

  it('keeps a qualitative range like "Negative" in text with low/high undefined', () => {
    // Validates: Requirements 6.5
    const entry: LabEntry = {
      testName: 'HIV ANTIBODY',
      value: 'Non-Reactive',
      referenceRange: { text: 'Negative' },
      category: 'Serology',
      uncertain: false,
    };

    const result = normalize(entry);

    expect(result.referenceRange?.text).toBe('Negative');
    expect(result.referenceRange?.low).toBeUndefined();
    expect(result.referenceRange?.high).toBeUndefined();
  });

  it('keeps a numeric-with-unit-suffix range like "197-771 pg/ml" in text with low/high undefined', () => {
    // Validates: Requirements 6.5 — only fully numeric ranges populate low/high.
    const entry: LabEntry = {
      testName: 'VITAMIN B12',
      value: '450',
      unit: 'pg/ml',
      referenceRange: { text: '197-771 pg/ml' },
      category: 'Vitamins',
      uncertain: false,
    };

    const result = normalize(entry);

    expect(result.referenceRange?.text).toBe('197-771 pg/ml');
    expect(result.referenceRange?.low).toBeUndefined();
    expect(result.referenceRange?.high).toBeUndefined();
    // Unit canonicalisation (Req 6.3) still applies on the entry itself.
    expect(result.unit).toBe('pg/mL');
  });

  it('leaves the unit unchanged (only trimmed) when it is not in the canonical map', () => {
    // Validates: Requirements 6.3 — unknown units pass through trimmed without case conversion.
    const entry: LabEntry = {
      testName: 'CUSTOM MARKER',
      value: '1.0',
      unit: '  WidgetUnits  ',
      category: 'Uncategorized',
      uncertain: false,
    };

    const result = normalize(entry);

    expect(result.unit).toBe('WidgetUnits');
  });
});
