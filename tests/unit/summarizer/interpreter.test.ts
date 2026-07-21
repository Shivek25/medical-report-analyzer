/**
 * tests/unit/summarizer/interpreter.test.ts
 *
 * Unit tests for the interpretation string generator.
 * Verifies that output is factual, includes reference ranges when available,
 * and never contains diagnosis or treatment language.
 */

import { describe, it, expect } from 'vitest';
import { interpretFinding, formatReferenceRange } from '../../../src/lib/summarizer/interpreter.js';
import type { LabEntry } from '../../../src/lib/types/index.js';

/** Helper: build a minimal LabEntry with overrides. */
function makeEntry(overrides: Partial<LabEntry> = {}): LabEntry {
  return {
    testName: 'Test',
    value: '10',
    category: 'General',
    uncertain: false,
    ...overrides,
  };
}

describe('formatReferenceRange', () => {
  it('formats low–high range', async () => {
    expect(formatReferenceRange({ low: 4.0, high: 11.0 })).toBe('4 – 11');
  });

  it('formats high-only range', async () => {
    expect(formatReferenceRange({ high: 5.0 })).toBe('up to 5');
  });

  it('formats low-only range', async () => {
    expect(formatReferenceRange({ low: 1.5 })).toBe('1.5 or above');
  });

  it('formats text-only range', async () => {
    expect(formatReferenceRange({ text: 'Negative' })).toBe('Negative');
  });

  it('returns undefined for undefined input', async () => {
    expect(formatReferenceRange(undefined)).toBeUndefined();
  });

  it('returns undefined for empty object (no bounds, no text)', async () => {
    expect(formatReferenceRange({})).toBeUndefined();
  });

  it('strips trailing zeros from decimal numbers', async () => {
    expect(formatReferenceRange({ low: 4.10, high: 11.00 })).toBe('4.1 – 11');
  });
});

describe('interpretFinding', () => {
  it('generates "Above normal range" for high severity with ref range', async () => {
    const entry = makeEntry({ referenceRange: { low: 0, high: 5 }, unit: 'mg/dL' });
    const result = await interpretFinding(entry, 'high');
    expect(result).toContain('Above normal range');
    expect(result).toContain('ref:');
    expect(result).toContain('0 – 5');
    expect(result).toContain('mg/dL');
  });

  it('generates "Below normal range" for low severity', async () => {
    const entry = makeEntry({ referenceRange: { low: 1, high: 10 } });
    const result = await interpretFinding(entry, 'low');
    expect(result).toContain('Below normal range');
  });

  it('generates "Significantly above" for critical-high', async () => {
    const entry = makeEntry({ referenceRange: { low: 1, high: 10 } });
    const result = await interpretFinding(entry, 'critical-high');
    expect(result).toContain('Significantly above');
  });

  it('generates "Significantly below" for critical-low', async () => {
    const entry = makeEntry({ referenceRange: { low: 1, high: 10 } });
    const result = await interpretFinding(entry, 'critical-low');
    expect(result).toContain('Significantly below');
  });

  it('generates "Slightly above" for borderline-high', async () => {
    const entry = makeEntry({ referenceRange: { low: 1, high: 10 } });
    const result = await interpretFinding(entry, 'borderline-high');
    expect(result).toContain('Slightly above');
  });

  it('generates "Slightly below" for borderline-low', async () => {
    const entry = makeEntry({ referenceRange: { low: 1, high: 10 } });
    const result = await interpretFinding(entry, 'borderline-low');
    expect(result).toContain('Slightly below');
  });

  it('generates "Within normal range" for normal', async () => {
    const entry = makeEntry({ referenceRange: { low: 1, high: 10 } });
    const result = await interpretFinding(entry, 'normal');
    expect(result).toContain('Within normal range');
  });

  it('handles missing reference range gracefully', async () => {
    const entry = makeEntry();
    const result = await interpretFinding(entry, 'high');
    expect(result).toBe('Above normal range');
    expect(result).not.toContain('ref:');
  });

  it('generates "Unable to interpret" for skipped entry with no ref range', async () => {
    const entry = makeEntry({ value: 'Negative' });
    const result = await interpretFinding(entry, 'skipped');
    expect(result).toContain('Unable to interpret');
    expect(result).toContain('reference range not available');
  });

  it('generates "Non-numeric result" for skipped entry with ref range', async () => {
    const entry = makeEntry({ value: 'Reactive', referenceRange: { text: 'Non-Reactive' } });
    const result = await interpretFinding(entry, 'skipped');
    expect(result).toContain('Non-numeric result');
    expect(result).toContain('manual review');
  });

  // ── Safety assertions: no diagnosis or treatment ────────────────────

  const FORBIDDEN_WORDS = [
    'diagnos',
    'prescri',
    'treat',
    'medic',
    'therap',
    'disease',
    'condition',
    'disorder',
  ];

  for (const word of FORBIDDEN_WORDS) {
    it(`never contains "${word}" in any classification`, async () => {
      const classifications = [
        'high', 'low', 'critical-high', 'critical-low',
        'borderline-high', 'borderline-low', 'normal', 'skipped',
      ] as const;
      const entry = makeEntry({ referenceRange: { low: 1, high: 10 } });
      for (const c of classifications) {
        const result = await interpretFinding(entry, c);
        expect(result.toLowerCase()).not.toContain(word);
      }
    });
  }
});
