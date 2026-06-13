/**
 * tests/unit/summarizer/grouper.test.ts
 *
 * Unit tests for category grouping functions.
 */

import { describe, it, expect } from 'vitest';
import { groupByCategory, groupNormalByCategory } from '../../../src/lib/summarizer/grouper.js';
import type { SummaryFinding, NormalEntry } from '../../../src/lib/types/index.js';

/** Helper: build a minimal SummaryFinding with overrides. */
function makeFinding(overrides: Partial<SummaryFinding> = {}): SummaryFinding {
  return {
    testName: 'Test',
    value: '10',
    severity: 'high',
    category: 'General',
    interpretation: 'Above normal range',
    uncertain: false,
    ...overrides,
  };
}

/** Helper: build a minimal NormalEntry with overrides. */
function makeNormal(overrides: Partial<NormalEntry> = {}): NormalEntry {
  return {
    testName: 'Test',
    value: '5',
    category: 'General',
    interpretation: 'Within normal range',
    ...overrides,
  };
}

describe('groupByCategory', () => {
  it('returns empty array for empty input', () => {
    expect(groupByCategory([])).toEqual([]);
  });

  it('groups findings by category', () => {
    const findings = [
      makeFinding({ testName: 'A', category: 'Lipid' }),
      makeFinding({ testName: 'B', category: 'Renal' }),
      makeFinding({ testName: 'C', category: 'Lipid' }),
    ];

    const result = groupByCategory(findings);
    expect(result).toHaveLength(2);
    expect(result[0].category).toBe('Lipid');
    expect(result[0].findings).toHaveLength(2);
    expect(result[1].category).toBe('Renal');
    expect(result[1].findings).toHaveLength(1);
  });

  it('sorts categories alphabetically', () => {
    const findings = [
      makeFinding({ category: 'Zebra' }),
      makeFinding({ category: 'Alpha' }),
      makeFinding({ category: 'Middle' }),
    ];

    const result = groupByCategory(findings);
    expect(result.map((g) => g.category)).toEqual(['Alpha', 'Middle', 'Zebra']);
  });

  it('sorts findings within a group by severity (critical first)', () => {
    const findings = [
      makeFinding({ testName: 'Borderline', category: 'Cat', severity: 'borderline-high' }),
      makeFinding({ testName: 'Critical', category: 'Cat', severity: 'critical-high' }),
      makeFinding({ testName: 'High', category: 'Cat', severity: 'high' }),
    ];

    const result = groupByCategory(findings);
    expect(result[0].findings.map((f) => f.testName)).toEqual([
      'Critical',
      'High',
      'Borderline',
    ]);
  });

  it('handles single category', () => {
    const findings = [
      makeFinding({ category: 'Solo' }),
      makeFinding({ category: 'Solo' }),
    ];

    const result = groupByCategory(findings);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('Solo');
    expect(result[0].findings).toHaveLength(2);
  });
});

describe('groupNormalByCategory', () => {
  it('returns empty array for empty input', () => {
    expect(groupNormalByCategory([])).toEqual([]);
  });

  it('groups normal entries by category', () => {
    const entries = [
      makeNormal({ testName: 'A', category: 'Lipid' }),
      makeNormal({ testName: 'B', category: 'Renal' }),
      makeNormal({ testName: 'C', category: 'Lipid' }),
    ];

    const result = groupNormalByCategory(entries);
    expect(result).toHaveLength(2);
    expect(result[0].category).toBe('Lipid');
    expect(result[0].entries).toHaveLength(2);
  });

  it('sorts entries within a group alphabetically by test name', () => {
    const entries = [
      makeNormal({ testName: 'Zinc', category: 'Vitamins' }),
      makeNormal({ testName: 'Ascorbic Acid', category: 'Vitamins' }),
      makeNormal({ testName: 'Folate', category: 'Vitamins' }),
    ];

    const result = groupNormalByCategory(entries);
    expect(result[0].entries.map((e) => e.testName)).toEqual([
      'Ascorbic Acid',
      'Folate',
      'Zinc',
    ]);
  });
});
