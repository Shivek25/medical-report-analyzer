/**
 * tests/unit/parser/field-extractor.test.ts
 *
 * Unit tests for the Phase 2 Field_Extractor.
 *
 * Covers:
 *   - Happy path: a well-formed row with every grammar slot populated produces
 *     a `LabEntry` with `testName`, `value`, `unit`, `flag`, `referenceRange`,
 *     and `notes` all set; `uncertain === false` and no `uncertaintyReason`.
 *   - Edge case 1 (Req 5.7): when the row is missing a `value` token, the
 *     resulting entry has `uncertain === true` and `uncertaintyReason`
 *     contains the verbatim raw row text.
 *   - Edge case 2 (Req 5.5): when a token in the flag position is not one of
 *     the recognised flag values (`H | L | * | HIGH | LOW | CRITICAL |
 *     ABNORMAL`), `LabEntry.flag` is `undefined` and the unrecognised token
 *     appears in `LabEntry.notes`.
 *
 * Validates: Requirements 5.1, 5.5, 5.7, 12.5
 */

import { describe, it, expect } from 'vitest';

import { extract } from '../../../src/lib/parser/field-extractor.js';
import type { DetectedRow, LabEntry } from '../../../src/lib/types/index.js';

/** Build a `DetectedRow` for a given line of text. */
function makeRow(rawText: string, category?: string): DetectedRow {
  const row: DetectedRow = {
    classification: 'lab',
    rawText,
    lineIndex: 0,
  };
  if (category !== undefined) row.category = category;
  return row;
}

describe('Field_Extractor.extract — happy path (Req 5.1)', () => {
  it('parses a well-formed row into a fully populated LabEntry', () => {
    // Row grammar: <name> <value> [<unit>] [<flag>] [<range>] [<notes>]
    const row = makeRow('HEMOGLOBIN 14.5 g/dL H 12.0-16.0 venous', 'Hemogram');

    const entry: LabEntry = extract(row);

    expect(entry.testName).toBe('HEMOGLOBIN');
    expect(entry.value).toBe('14.5');
    expect(entry.unit).toBe('g/dL');
    expect(entry.flag).toBe('H');
    expect(entry.referenceRange).toBeDefined();
    expect(entry.referenceRange?.low).toBe(12.0);
    expect(entry.referenceRange?.high).toBe(16.0);
    expect(entry.referenceRange?.text).toBe('12.0-16.0');
    expect(entry.notes).toBe('venous');
    expect(entry.category).toBe('Hemogram');
    expect(entry.uncertain).toBe(false);
    expect(entry.uncertaintyReason).toBeUndefined();
  });
});

describe('Field_Extractor.extract — edge cases (Req 5.5, 5.7)', () => {
  it('flips uncertain=true and embeds the raw row text in uncertaintyReason when value is missing (Req 5.7)', () => {
    // No numeric or qualitative value token anywhere → "value" is missing.
    const rawText = 'UNKNOWN MARKER';
    const row = makeRow(rawText);

    const entry = extract(row);

    expect(entry.uncertain).toBe(true);
    expect(entry.uncertaintyReason).toBeDefined();
    // The reason must identify the missing field and quote the original row
    // text so the failure is traceable back to its source line.
    expect(entry.uncertaintyReason).toContain('Missing value');
    expect(entry.uncertaintyReason).toContain(rawText);
    // The value field defaults to an empty string when extraction fails.
    expect(entry.value).toBe('');
    // Defaults preserved when no header has been assigned.
    expect(entry.category).toBe('Uncategorized');
  });

  it('routes an unrecognised flag-position token to notes and leaves flag undefined (Req 5.5)', () => {
    // "XYZ" is not in { H, L, *, HIGH, LOW, CRITICAL, ABNORMAL } and does not
    // look like the start of a reference range, so it must land in notes.
    const row = makeRow('GLUCOSE 100 mg/dL XYZ 70-100');

    const entry = extract(row);

    expect(entry.testName).toBe('GLUCOSE');
    expect(entry.value).toBe('100');
    expect(entry.unit).toBe('mg/dL');
    expect(entry.flag).toBeUndefined();
    expect(entry.notes).toBeDefined();
    expect(entry.notes).toContain('XYZ');
    // The reference range still parses cleanly even though the flag slot was
    // re-routed to notes.
    expect(entry.referenceRange?.low).toBe(70);
    expect(entry.referenceRange?.high).toBe(100);
    // Misrouted token does not by itself flip the entry to uncertain.
    expect(entry.uncertain).toBe(false);
    expect(entry.uncertaintyReason).toBeUndefined();
  });
});
