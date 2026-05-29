/**
 * tests/property/parser/categorizer.property.test.ts
 *
 * Feature: pdf-text-structuring, Property 24: Category assignment from most recent header
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4
 *
 * For any sequence of cleaned-text lines containing an interleaving of section
 * headers, lab rows, and blank lines, every emitted `DetectedRow.category`
 * SHALL equal the verbatim text of the most recent section header preceding
 * the row in source order, or `'Uncategorized'` when no header has yet been
 * encountered. Whitespace-only / blank lines SHALL NOT update the active
 * category.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  assignCategories,
  UNCATEGORIZED,
} from '../../../src/lib/parser/categorizer.js';
import type { DetectedRow } from '../../../src/lib/types/index.js';

// ─── Pools chosen so each line's "kind" is unambiguous under the spec
// (Requirement 3.5 / 8.1 header predicate: shape match + no numeric and no
// unit token). All entries below have been hand-verified against
// `src/lib/parser/patterns.ts`.

/** Lines guaranteed to qualify as section headers. */
const HEADER_POOL = [
  'HEMOGRAM',
  'LIPID PROFILE',
  'VITAMINS',
  'KIDNEY PROFILE',
  'LIVER FUNCTION',
  'THYROID',
  'COMPLETE BLOOD COUNT',
  'Hemogram',
  'Lipid Profile',
  'Liver Function',
] as const;

/**
 * Lines guaranteed NOT to qualify as section headers (each contains digits
 * and/or punctuation that breaks `SECTION_HEADER_SHAPE`, plus unit/numeric
 * tokens which themselves disqualify a line per Req 3.5).
 */
const LAB_ROW_POOL = [
  'HEMOGLOBIN 14.5 g/dL',
  'Glucose Fasting 92 mg/dL 70-110',
  'Cholesterol Total 180 mg/dL',
  'Triglycerides 120 mg/dL',
  'TSH 2.5 mIU/L 0.4-4.0',
  'Vitamin D 32 ng/mL',
  'Creatinine 0.9 mg/dL',
] as const;

/** Whitespace-only / blank lines (Req 8.4): must not update category. */
const BLANK_POOL = ['', ' ', '   ', '\t', '\t  '] as const;

type LineKind = 'header' | 'lab' | 'blank';
interface TaggedLine {
  readonly kind: LineKind;
  readonly text: string;
}

const headerArb: fc.Arbitrary<TaggedLine> = fc
  .constantFrom(...HEADER_POOL)
  .map((text) => ({ kind: 'header', text }));

const labArb: fc.Arbitrary<TaggedLine> = fc
  .constantFrom(...LAB_ROW_POOL)
  .map((text) => ({ kind: 'lab', text }));

const blankArb: fc.Arbitrary<TaggedLine> = fc
  .constantFrom(...BLANK_POOL)
  .map((text) => ({ kind: 'blank', text }));

/**
 * Weighted line arbitrary: lab rows are most common, headers and blanks
 * appear regularly so most generated cases mix all three kinds.
 */
const lineArb: fc.Arbitrary<TaggedLine> = fc.oneof(
  { weight: 2, arbitrary: headerArb },
  { weight: 5, arbitrary: labArb },
  { weight: 2, arbitrary: blankArb },
);

/**
 * Reference oracle: walks the tagged lines and returns the category that
 * the Categorizer ought to assign to a row at `lineIndex`, per the spec:
 *   - the verbatim text of the most recent header line strictly before
 *     `lineIndex` (Req 8.1, 8.3),
 *   - or `'Uncategorized'` when no header precedes (Req 8.2),
 *   - blank / whitespace-only lines never update the active category
 *     (Req 8.4) — handled implicitly because they are tagged 'blank'.
 */
function expectedCategoryFor(tagged: readonly TaggedLine[], lineIndex: number): string {
  for (let i = lineIndex - 1; i >= 0; i--) {
    if (tagged[i]?.kind === 'header') {
      return tagged[i]!.text;
    }
  }
  return UNCATEGORIZED;
}

describe('Categorizer property tests', () => {
  // Feature: pdf-text-structuring, Property 24: Category assignment from most recent header
  it('assigns each row the verbatim text of the most recent preceding header (or "Uncategorized")', () => {
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 0, maxLength: 60 }), (tagged) => {
        const lines = tagged.map((t) => t.text);
        const cleanedText = lines.join('\n');

        // Build DetectedRow[] from every line tagged as a lab row, preserving
        // source order via lineIndex (Categorizer relies on lineIndex to look
        // up the active category at that point in the cleaned text).
        const rows: DetectedRow[] = tagged
          .map((t, i) =>
            t.kind === 'lab'
              ? ({ classification: 'lab', rawText: t.text, lineIndex: i } satisfies DetectedRow)
              : null,
          )
          .filter((r): r is DetectedRow => r !== null);

        const result = assignCategories(rows, cleanedText);

        // Same cardinality and order as the input rows.
        expect(result).toHaveLength(rows.length);
        for (let k = 0; k < rows.length; k++) {
          expect(result[k]?.lineIndex).toBe(rows[k]!.lineIndex);
          expect(result[k]?.rawText).toBe(rows[k]!.rawText);
          expect(result[k]?.classification).toBe(rows[k]!.classification);
        }

        // Every row's category equals the spec-defined expectation.
        for (const r of result) {
          const expected = expectedCategoryFor(tagged, r.lineIndex);
          expect(r.category).toBe(expected);
        }
      }),
      { numRuns: 200 },
    );
  });
});
