/**
 * tests/unit/summarizer/classifier.test.ts
 *
 * Unit tests for the entry classifier — verifies severity classification
 * logic for flag-based, numeric-range, borderline, and edge-case inputs.
 */

import { describe, it, expect } from 'vitest';
import { classifyEntry } from '../../../src/lib/summarizer/classifier.js';
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

describe('classifyEntry', () => {
  // ── Flag-based classification ─────────────────────────────────────────

  describe('flag-based classification', () => {
    it('classifies flag "H" as high', () => {
      expect(classifyEntry(makeEntry({ flag: 'H' }))).toBe('high');
    });

    it('classifies flag "L" as low', () => {
      expect(classifyEntry(makeEntry({ flag: 'L' }))).toBe('low');
    });

    it('classifies flag "HH" as critical-high', () => {
      expect(classifyEntry(makeEntry({ flag: 'HH' }))).toBe('critical-high');
    });

    it('classifies flag "LL" as critical-low', () => {
      expect(classifyEntry(makeEntry({ flag: 'LL' }))).toBe('critical-low');
    });

    it('classifies flag "*" as high', () => {
      expect(classifyEntry(makeEntry({ flag: '*' }))).toBe('high');
    });

    it('classifies flag "**" as critical-high', () => {
      expect(classifyEntry(makeEntry({ flag: '**' }))).toBe('critical-high');
    });

    it('is case-insensitive for flags', () => {
      expect(classifyEntry(makeEntry({ flag: 'high' }))).toBe('high');
      expect(classifyEntry(makeEntry({ flag: 'Low' }))).toBe('low');
    });

    it('treats unknown flags as normal (falls through to numeric check)', () => {
      const entry = makeEntry({
        flag: 'UNKNOWN_FLAG',
        value: '5',
        referenceRange: { low: 1, high: 10 },
      });
      expect(classifyEntry(entry)).toBe('normal');
    });

    it('ignores empty/whitespace-only flags', () => {
      const entry = makeEntry({
        flag: '   ',
        value: '5',
        referenceRange: { low: 1, high: 10 },
      });
      expect(classifyEntry(entry)).toBe('normal');
    });
  });

  // ── Numeric comparison ────────────────────────────────────────────────

  describe('numeric range comparison', () => {
    it('classifies value above high bound as high', () => {
      const entry = makeEntry({ value: '12', referenceRange: { low: 1, high: 10 } });
      expect(classifyEntry(entry)).toBe('high');
    });

    it('classifies value below low bound as low', () => {
      const entry = makeEntry({ value: '0.8', referenceRange: { low: 1, high: 10 } });
      expect(classifyEntry(entry)).toBe('low');
    });

    it('classifies value within range as normal', () => {
      const entry = makeEntry({ value: '5', referenceRange: { low: 1, high: 10 } });
      expect(classifyEntry(entry)).toBe('normal');
    });

    it('classifies value at exactly the high bound as normal (not above)', () => {
      // value === high is not > high, so it's not 'high'
      // But it IS within 5% of the boundary, so it's borderline-high
      const entry = makeEntry({ value: '10', referenceRange: { low: 1, high: 10 } });
      expect(classifyEntry(entry)).toBe('borderline-high');
    });

    it('classifies value at exactly the low bound as normal (not below)', () => {
      // value === low is not < low, so it's not 'low'
      // But it IS within 5% of the boundary, so it's borderline-low
      const entry = makeEntry({ value: '1', referenceRange: { low: 1, high: 10 } });
      expect(classifyEntry(entry)).toBe('borderline-low');
    });
  });

  // ── Critical thresholds ───────────────────────────────────────────────

  describe('critical thresholds', () => {
    it('classifies value at 2x high bound as critical-high', () => {
      const entry = makeEntry({ value: '20', referenceRange: { low: 1, high: 10 } });
      expect(classifyEntry(entry)).toBe('critical-high');
    });

    it('classifies value above 2x high bound as critical-high', () => {
      const entry = makeEntry({ value: '25', referenceRange: { low: 1, high: 10 } });
      expect(classifyEntry(entry)).toBe('critical-high');
    });

    it('classifies value at 0.5x low bound as critical-low', () => {
      const entry = makeEntry({ value: '0.5', referenceRange: { low: 1, high: 10 } });
      // 0.5 <= 1 * 0.5 = 0.5, so critical-low
      expect(classifyEntry(entry)).toBe('critical-low');
    });

    it('classifies value below 0.5x low bound as critical-low', () => {
      const entry = makeEntry({ value: '0.3', referenceRange: { low: 1, high: 10 } });
      expect(classifyEntry(entry)).toBe('critical-low');
    });
  });

  // ── Borderline thresholds ─────────────────────────────────────────────

  describe('borderline thresholds', () => {
    it('classifies value within 5% below high bound as borderline-high', () => {
      // high = 100, 5% threshold = 95, so value 96 is borderline-high
      const entry = makeEntry({ value: '96', referenceRange: { low: 10, high: 100 } });
      expect(classifyEntry(entry)).toBe('borderline-high');
    });

    it('classifies value within 5% above low bound as borderline-low', () => {
      // low = 100, 5% threshold = 105, so value 104 is borderline-low
      const entry = makeEntry({ value: '104', referenceRange: { low: 100, high: 200 } });
      expect(classifyEntry(entry)).toBe('borderline-low');
    });

    it('does not classify well-within-range value as borderline', () => {
      const entry = makeEntry({ value: '50', referenceRange: { low: 10, high: 100 } });
      expect(classifyEntry(entry)).toBe('normal');
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns skipped for non-numeric value with no flag', () => {
      const entry = makeEntry({ value: 'Negative' });
      expect(classifyEntry(entry)).toBe('skipped');
    });

    it('returns normal when no reference range is provided', () => {
      const entry = makeEntry({ value: '10' });
      expect(classifyEntry(entry)).toBe('normal');
    });

    it('returns normal when reference range is text-only', () => {
      const entry = makeEntry({ value: '10', referenceRange: { text: 'Negative' } });
      expect(classifyEntry(entry)).toBe('normal');
    });

    it('handles reference range with only high bound', () => {
      const entry = makeEntry({ value: '12', referenceRange: { high: 10 } });
      expect(classifyEntry(entry)).toBe('high');
    });

    it('handles reference range with only low bound', () => {
      const entry = makeEntry({ value: '0.3', referenceRange: { low: 1 } });
      // 0.3 <= 1 * 0.5, so critical-low
      expect(classifyEntry(entry)).toBe('critical-low');
    });

    it('classifies uncertain entries the same way (uncertainty handled elsewhere)', () => {
      const entry = makeEntry({
        value: '12',
        referenceRange: { low: 1, high: 10 },
        uncertain: true,
        uncertaintyReason: 'Ambiguous unit',
      });
      expect(classifyEntry(entry)).toBe('high');
    });

    it('flag takes priority over numeric comparison', () => {
      // Flag says low, but numeric value is high — flag wins
      const entry = makeEntry({
        value: '12',
        flag: 'L',
        referenceRange: { low: 1, high: 10 },
      });
      expect(classifyEntry(entry)).toBe('low');
    });
  });
});
