/**
 * tests/unit/parser/row-detector.test.ts
 *
 * Unit tests for the Phase 2 Row_Detector (`src/lib/parser/row-detector.ts`).
 *
 * Covers a happy-path case (a single, self-contained lab row is classified
 * `lab`) and edge cases (a test-name-only line is merged with a value-bearing
 * continuation and a trailing reference-range continuation; a line with a
 * value token but no unit / range / flag is emitted as `ambiguous`).
 *
 * Validates: Requirements 4.1, 4.2, 4.5, 7.1, 12.5
 */

import { describe, it, expect } from 'vitest';

import { detect } from '../../../src/lib/parser/row-detector.js';

describe('detect (happy path)', () => {
  it('classifies a single-line lab row containing value + unit + range as `lab`', () => {
    // Validates: Requirements 4.1, 12.5
    const cleaned = 'HEMOGLOBIN 14.5 g/dL 12.0-16.0';

    const { rows, warnings } = detect(cleaned);

    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(1);

    const [row] = rows;
    expect(row?.classification).toBe('lab');
    // The merged row text equals the source line (no continuations to fold).
    expect(row?.rawText).toBe('HEMOGLOBIN 14.5 g/dL 12.0-16.0');
    // Source order is preserved via lineIndex.
    expect(row?.lineIndex).toBe(0);
  });
});

describe('detect (edge cases)', () => {
  it('merges a test-name-only line with a value continuation and a range continuation into a single `lab` row', () => {
    // Validates: Requirements 4.2, 7.1
    //
    // Line 0: `HEMOGLOBIN`              — test-name-only (no value, no unit)
    // Line 1: `14.5 g/dL`               — value + unit continuation (starts with digit)
    // Line 2: `12.0-16.0`               — reference-range continuation (starts with digit)
    //
    // Expected: one `lab` row whose rawText joins all three fragments with single spaces.
    const cleaned = ['HEMOGLOBIN', '14.5 g/dL', '12.0-16.0'].join('\n');

    const { rows, warnings } = detect(cleaned);

    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(1);

    const [row] = rows;
    expect(row?.classification).toBe('lab');
    expect(row?.rawText).toBe('HEMOGLOBIN 14.5 g/dL 12.0-16.0');
    // lineIndex points at the FIRST source line that contributed (the test name).
    expect(row?.lineIndex).toBe(0);
  });

  it('emits an unclassifiable line (value token only, no unit / range / flag) as `ambiguous`', () => {
    // Validates: Requirements 4.5
    //
    // The line `12.5` has a value token but no unit, no reference range, and
    // no flag. It is not a header / disclaimer / non-data line either, so it
    // must be emitted with classification `ambiguous` so the orchestrator can
    // record it on `extractionQuality.ambiguousLines`.
    const cleaned = ['HEMOGLOBIN 14.5 g/dL 12.0-16.0', '12.5'].join('\n');

    const { rows, warnings } = detect(cleaned);

    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(2);

    // First row: the well-formed lab line.
    expect(rows[0]?.classification).toBe('lab');
    expect(rows[0]?.lineIndex).toBe(0);

    // Second row: the unclassifiable bare-number line.
    expect(rows[1]?.classification).toBe('ambiguous');
    expect(rows[1]?.rawText).toBe('12.5');
    expect(rows[1]?.lineIndex).toBe(1);
  });
});
