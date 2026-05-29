/**
 * tests/property/parser/field-extractor.property.test.ts
 *
 * Property-based tests for the Phase 2 Field_Extractor
 * (`src/lib/parser/field-extractor.ts`).
 *
 * Each `it(...)` block corresponds to one numbered property from the design
 * document; tests are added incrementally as their tasks are implemented.
 *
 * Feature: pdf-text-structuring
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { extract } from '../../../src/lib/parser/field-extractor.js';
import type { DetectedRow } from '../../../src/lib/types/index.js';

describe('Field_Extractor — property tests', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 17: Field extraction completeness on well-formed rows
  // Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.6
  //
  // For any synthetic lab-row string of the form
  //
  //     <name> <value> [<unit>] [<flag>] [<range>] [<notes>]
  //
  // generated from the row grammar, `Field_Extractor.extract` SHALL:
  //   1. Set every present field on the resulting `LabEntry` to its source
  //      token (Req 5.1, 5.2, 5.3, 5.4, 5.6).
  //   2. Set every absent optional field to `undefined`.
  //   3. Set `uncertain` to `false` (and emit no `uncertaintyReason`).
  //
  // The generator below carefully constrains each grammar slot so the
  // synthesised row is *unambiguously* parseable: name tokens are uppercase
  // alphabetic words that cannot collide with the value/qualitative/unit/
  // flag/range token sets; units come from a curated list known to satisfy
  // `UNIT_TOKEN_ANCHORED`; flags use canonical case (`FLAG_TOKEN_ANCHORED` is
  // case-sensitive); ranges use single-token shapes (numeric `lo-hi`,
  // comparison `<N`/`>N`, or qualitative); and note tokens are lowercase
  // English words drawn from a list disjoint from every other slot's vocab.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'every present field is set to its source token, every absent optional field is undefined, and uncertain is false on well-formed rows',
    () => {
      // ── Generators ───────────────────────────────────────────────────────

      // Test-name tokens. Uppercase alphabetic words drawn from a fixed list
      // chosen to be disjoint from the qualitative/flag/unit token sets. The
      // anchored value patterns reject all of these, so they will never be
      // misclassified as the row's `value`.
      const arbNameToken = fc.constantFrom(
        'HEMOGLOBIN',
        'GLUCOSE',
        'CHOLESTEROL',
        'TRIGLYCERIDES',
        'CALCIUM',
        'SODIUM',
        'POTASSIUM',
        'CREATININE',
        'UREA',
        'BILIRUBIN',
        'ALBUMIN',
        'PROTEIN',
        'IRON',
        'FERRITIN',
        'INSULIN',
        'GLOBULIN',
        'PLATELETS',
      );
      const arbName = fc.array(arbNameToken, { minLength: 1, maxLength: 3 });

      // Numeric value token. Whole numbers and one-decimal forms only — both
      // are exact under `parseFloat` so equality comparisons in the body do
      // not have floating-point traps.
      const arbNumericValue = fc.oneof(
        fc.integer({ min: 0, max: 9999 }).map((n) => String(n)),
        fc
          .tuple(fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 0, max: 99 }))
          .map(([w, d]) => `${w}.${d}`),
      );

      // Qualitative value token (canonical case as the parser expects).
      const arbQualitativeValue = fc.constantFrom(
        'Negative',
        'Positive',
        'Reactive',
        'Non-Reactive',
        'Present',
        'Absent',
      );

      const arbValue = fc.oneof(arbNumericValue, arbQualitativeValue);

      // Unit token. Curated to match `UNIT_TOKEN_ANCHORED` exactly.
      const arbUnit = fc.option(
        fc.constantFrom(
          'mg/dL',
          'g/dL',
          'pg/mL',
          'ng/mL',
          'IU/L',
          'U/L',
          'mIU/L',
          'mol/L',
          'nmol/L',
          'fL',
          '%',
          'mg',
          'kg',
          'pg',
          'ng',
        ),
        { nil: undefined },
      );

      // Flag token. `FLAG_TOKEN_ANCHORED` is case-sensitive, so we use the
      // canonical spellings only.
      const arbFlag = fc.option(
        fc.constantFrom('H', 'L', '*', 'HIGH', 'LOW', 'CRITICAL', 'ABNORMAL'),
        { nil: undefined },
      );

      // Reference-range token. Three single-token shapes (numeric `lo-hi`,
      // comparison `<N` / `>N` / `<=N` / `>=N`, and qualitative). Single
      // tokens keep `text` deterministic — multi-token forms re-join with
      // single spaces inside the parser, which would still be testable but
      // adds noise unrelated to Property 17.
      type RangeSpec =
        | { kind: 'numeric'; token: string; low: number; high: number }
        | { kind: 'comparison'; token: string }
        | { kind: 'qualitative'; token: string };

      const arbNumericRange: fc.Arbitrary<RangeSpec> = fc
        .tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 1, max: 100 }))
        .map(([low, gap]) => {
          const high = low + gap;
          return { kind: 'numeric', token: `${low}-${high}`, low, high };
        });

      const arbComparisonRange: fc.Arbitrary<RangeSpec> = fc
        .tuple(fc.constantFrom('<', '>', '<=', '>='), fc.integer({ min: 0, max: 9999 }))
        .map(([op, n]) => ({ kind: 'comparison', token: `${op}${n}` }));

      const arbQualitativeRange: fc.Arbitrary<RangeSpec> = fc
        .constantFrom('Negative', 'Positive', 'Reactive', 'Non-Reactive', 'Present', 'Absent')
        .map((token) => ({ kind: 'qualitative', token }));

      const arbRange = fc.option(
        fc.oneof(arbNumericRange, arbComparisonRange, arbQualitativeRange),
        { nil: undefined },
      );

      // Notes tokens. Lowercase alphabetic words chosen to be disjoint from
      // every other slot's vocabulary: not units (`fl`, `pg`, `ng`, `mg`,
      // `kg`, `sec`, `min`, `hr`, `hour`, `%`), not flags (`H`, `L`, `*`,
      // `HIGH`, ...), not range starts (no leading digit / sign / comparison
      // operator / qualitative token, since `QUALITATIVE_VALUE_ANCHORED` is
      // case-insensitive).
      const arbNoteToken = fc.constantFrom(
        'venous',
        'fasting',
        'capillary',
        'arterial',
        'manual',
        'auto',
        'rerun',
        'verified',
        'comment',
        'see',
      );
      const arbNotes = fc.array(arbNoteToken, { minLength: 0, maxLength: 3 });

      // ── Property body ────────────────────────────────────────────────────
      fc.assert(
        fc.property(
          arbName,
          arbValue,
          arbUnit,
          arbFlag,
          arbRange,
          arbNotes,
          (nameTokens, value, unit, flag, range, notesTokens) => {
            // Assemble the row text in grammar order.
            const parts: string[] = [...nameTokens, value];
            if (unit !== undefined) parts.push(unit);
            if (flag !== undefined) parts.push(flag);
            if (range !== undefined) parts.push(range.token);
            parts.push(...notesTokens);
            const rawText = parts.join(' ');

            const row: DetectedRow = {
              classification: 'lab',
              rawText,
              lineIndex: 0,
            };

            const entry = extract(row);

            // ── Required fields preserved verbatim (Req 5.1, 5.2) ─────────
            if (entry.testName !== nameTokens.join(' ')) return false;
            if (entry.value !== value) return false;

            // ── Optional fields preserved or undefined (Req 5.3, 5.4, 5.6) ─
            if (entry.unit !== unit) return false;
            if (entry.flag !== flag) return false;

            if (range === undefined) {
              if (entry.referenceRange !== undefined) return false;
            } else {
              if (entry.referenceRange === undefined) return false;
              if (entry.referenceRange.text !== range.token) return false;
              if (range.kind === 'numeric') {
                if (entry.referenceRange.low !== range.low) return false;
                if (entry.referenceRange.high !== range.high) return false;
              } else {
                // Comparison and qualitative ranges leave bounds undefined.
                if (entry.referenceRange.low !== undefined) return false;
                if (entry.referenceRange.high !== undefined) return false;
              }
            }

            const expectedNotes =
              notesTokens.length === 0 ? undefined : notesTokens.join(' ');
            if (entry.notes !== expectedNotes) return false;

            // ── Default category and certainty flags ──────────────────────
            if (entry.category !== 'Uncategorized') return false;
            if (entry.uncertain !== false) return false;
            if (entry.uncertaintyReason !== undefined) return false;

            return true;
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 18: Flag recognition routes unrecognised tokens to notes
  // Validates: Requirements 5.5
  //
  // For any lab-row string in which the flag-position token is not one of
  // `H | L | * | HIGH | LOW | CRITICAL | ABNORMAL`, `LabEntry.flag` SHALL be
  // `undefined` and the unrecognised token SHALL appear as a substring of
  // `LabEntry.notes`.
  //
  // Generator strategy:
  //   - The "flag position" is the slot the parser inspects after the unit
  //     slot (or after the value when no unit is present). To make the
  //     unrecognised token reliably land in flag position, the generator
  //     must produce a token that the parser will NOT consume as a unit
  //     (slot 1) or treat as a range start (which would defer it to
  //     slot 3). It must also not be a recognised flag and not be a
  //     qualitative range value (case-insensitive).
  //   - The curated `arbUnrecognisedFlagToken` list satisfies all these
  //     constraints so the parser deterministically routes each generated
  //     token through the "unrecognised flag-position" branch.
  //   - Surrounding optional fields (unit, range, trailing notes) are
  //     varied to exercise the routing under different field combinations,
  //     while staying inside the row grammar so testName / value remain
  //     unambiguous.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'unrecognised flag-position tokens leave flag undefined and appear in notes',
    () => {
      // ── Generators ───────────────────────────────────────────────────────

      // Test-name tokens: uppercase scientific names, disjoint from every
      // other token vocabulary used here.
      const arbNameToken = fc.constantFrom(
        'HEMOGLOBIN',
        'GLUCOSE',
        'CHOLESTEROL',
        'TRIGLYCERIDES',
        'CALCIUM',
        'CREATININE',
        'UREA',
        'BILIRUBIN',
      );
      const arbName = fc.array(arbNameToken, { minLength: 1, maxLength: 3 });

      // Value: numeric (whole or one-decimal) or canonical-case qualitative.
      const arbValue = fc.oneof(
        fc.integer({ min: 0, max: 9999 }).map((n) => String(n)),
        fc
          .tuple(fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 0, max: 99 }))
          .map(([w, d]) => `${w}.${d}`),
        fc.constantFrom('Negative', 'Positive', 'Reactive', 'Non-Reactive', 'Present', 'Absent'),
      );

      // Optional unit. Tokens curated to match `UNIT_TOKEN_ANCHORED`.
      const arbUnit = fc.option(
        fc.constantFrom('mg/dL', 'g/dL', 'pg/mL', 'IU/L', 'U/L', '%', 'mg', 'fL'),
        { nil: undefined },
      );

      // Unrecognised flag-position token. Each entry is verified to:
      //   - NOT match `FLAG_TOKEN_ANCHORED` (i.e., not `H|L|*|HIGH|LOW|
      //     CRITICAL|ABNORMAL`),
      //   - NOT match `UNIT_TOKEN_ANCHORED` (so slot 1 won't consume it),
      //   - NOT start with `[-+0-9<>≤≥]` and not be a qualitative
      //     range token (so `looksLikeRangeStart` returns false and the
      //     parser falls into the "route to notes" branch),
      //   - NOT be a qualitative VALUE (so `findValueIndex` does not pick
      //     it up earlier in the token list).
      const arbUnrecognisedFlagToken = fc.constantFrom(
        'NORMAL',
        'OK',
        'FOO',
        'BAR',
        'BAZ',
        'QUUX',
        'ZEBRA',
        'KAPPA',
        'WEIRD',
        'UNKNOWN',
        'QUESTIONABLE',
        'OMICRON',
        'ALPHA',
        'BETA',
      );

      // Optional reference range placed AFTER the unrecognised flag-position
      // token. Single-token shapes only (numeric `lo-hi` or comparison
      // `<N`/`>N`/`<=N`/`>=N`) so `tryParseRange` consumes them in one step.
      type RangeSpec =
        | { kind: 'numeric'; token: string }
        | { kind: 'comparison'; token: string };

      const arbNumericRange: fc.Arbitrary<RangeSpec> = fc
        .tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 1, max: 100 }))
        .map(([low, gap]) => ({ kind: 'numeric', token: `${low}-${low + gap}` }));

      const arbComparisonRange: fc.Arbitrary<RangeSpec> = fc
        .tuple(fc.constantFrom('<', '>', '<=', '>='), fc.integer({ min: 0, max: 9999 }))
        .map(([op, n]) => ({ kind: 'comparison', token: `${op}${n}` }));

      const arbRange = fc.option(fc.oneof(arbNumericRange, arbComparisonRange), {
        nil: undefined,
      });

      // Trailing notes tokens. Lowercase English words that are disjoint
      // from every other slot's vocabulary (not units, not flags, not
      // qualitative values, no leading digits).
      const arbNoteToken = fc.constantFrom(
        'venous',
        'fasting',
        'capillary',
        'manual',
        'verified',
        'rerun',
      );
      const arbTailNotes = fc.array(arbNoteToken, { minLength: 0, maxLength: 2 });

      // ── Property body ────────────────────────────────────────────────────
      fc.assert(
        fc.property(
          arbName,
          arbValue,
          arbUnit,
          arbUnrecognisedFlagToken,
          arbRange,
          arbTailNotes,
          (nameTokens, value, unit, unrecToken, range, tailTokens) => {
            // Assemble: <name> <value> [<unit>] <unrecToken> [<range>] [<tail notes>]
            const parts: string[] = [...nameTokens, value];
            if (unit !== undefined) parts.push(unit);
            parts.push(unrecToken);
            if (range !== undefined) parts.push(range.token);
            parts.push(...tailTokens);
            const rawText = parts.join(' ');

            const row: DetectedRow = {
              classification: 'lab',
              rawText,
              lineIndex: 0,
            };

            const entry = extract(row);

            // ── Flag must be undefined ────────────────────────────────────
            if (entry.flag !== undefined) return false;

            // ── Unrecognised token must appear as a substring of notes ────
            if (entry.notes === undefined) return false;
            if (!entry.notes.includes(unrecToken)) return false;

            return true;
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 19: Missing required fields imply uncertainty with traceable reason
  // Validates: Requirements 5.7, 5.8, 12.4
  //
  // Two directions are checked inside the same `it(...)` block:
  //
  //   (1) Forward direction (Req 5.7, 5.8) — for any row from which
  //       `testName` or `value` cannot be extracted, the resulting
  //       `LabEntry` SHALL have:
  //         - `uncertain === true`,
  //         - `uncertaintyReason` is a non-empty string,
  //         - `uncertaintyReason` contains the original raw row text as a
  //           substring (so the parse failure is traceable back to the
  //           source line).
  //
  //   (2) Contrapositive direction (Req 12.4) — for any input string at
  //       all, the `LabEntry` produced by `extract` SHALL satisfy:
  //         `entry.uncertain === true` || (typeof entry.value === 'string'
  //                                         && entry.value.length > 0)
  //       i.e., empty / null / undefined values never coexist with
  //       `uncertain === false`.
  //
  // Generator strategy for (1): three independent sub-cases that each force
  // either `testName` or `value` (or both) to be unextractable:
  //
  //   (1a) Whitespace-only / empty rows — `trimmed === ''` triggers the
  //        "both required fields missing" branch in `extract`.
  //   (1b) Rows containing only non-value tokens — uppercase alphabetic
  //        names that match neither `NUMERIC_VALUE_ANCHORED` nor
  //        `QUALITATIVE_VALUE_ANCHORED`, forcing `findValueIndex` to
  //        return -1 (value missing).
  //   (1c) Rows whose first token is itself a value — `valueIdx === 0`,
  //        so `slice(0, 0)` yields an empty `testName`.
  //
  // For (2) we use unconstrained `fc.string()` to assert the universal
  // contrapositive across the full string space (printable + non-printable
  // characters), since `extract` must be total over `DetectedRow`.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'missing required fields produce uncertain=true with raw text traceable in reason; every produced entry satisfies uncertain || non-empty value',
    () => {
      // ── Generators (Direction 1) ─────────────────────────────────────────

      // Uppercase alphabetic name tokens. Disjoint from the recognised
      // numeric value pattern (no digits) and the recognised qualitative
      // value tokens (`Negative`, `Positive`, `Reactive`, `Non-Reactive`,
      // `Present`, `Absent`), so the parser cannot mistakenly treat any of
      // them as a value.
      const arbNonValueToken = fc.constantFrom(
        'HEMOGLOBIN',
        'GLUCOSE',
        'CHOLESTEROL',
        'CALCIUM',
        'CREATININE',
        'UREA',
        'BILIRUBIN',
        'IRON',
        'FERRITIN',
        'ALBUMIN',
        'PROTEIN',
        'INSULIN',
      );

      // Numeric value token (whole or one-decimal). Used only in sub-case
      // (1c) to force `valueIdx === 0`.
      const arbNumericValue = fc.oneof(
        fc.integer({ min: 0, max: 9999 }).map((n) => String(n)),
        fc
          .tuple(fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 0, max: 99 }))
          .map(([w, d]) => `${w}.${d}`),
      );

      // (1a) Whitespace-only rows (including the empty string). After
      //      `trim()` this becomes '', triggering both-fields-missing.
      const arbWhitespaceOnlyRow = fc
        .array(fc.constantFrom(' ', '\t'), { minLength: 0, maxLength: 8 })
        .map((parts) => parts.join(''));

      // (1b) Rows containing only non-value tokens — value cannot be found.
      const arbNoValueRow = fc
        .array(arbNonValueToken, { minLength: 1, maxLength: 4 })
        .map((tokens) => tokens.join(' '));

      // (1c) Rows starting with a value token — testName slice is empty.
      const arbStartsWithValueRow = fc
        .tuple(arbNumericValue, fc.array(arbNonValueToken, { minLength: 0, maxLength: 3 }))
        .map(([val, rest]) => [val, ...rest].join(' '));

      const arbMissingRequiredRow = fc.oneof(
        arbWhitespaceOnlyRow,
        arbNoValueRow,
        arbStartsWithValueRow,
      );

      // ── Property body — Direction 1 ──────────────────────────────────────
      fc.assert(
        fc.property(arbMissingRequiredRow, (rawText) => {
          const row: DetectedRow = {
            classification: 'lab',
            rawText,
            lineIndex: 0,
          };
          const entry = extract(row);

          // Required-field absence flips uncertainty (Req 5.7).
          if (entry.uncertain !== true) return false;

          // The reason must be a non-empty string (Req 5.7, 5.8).
          if (typeof entry.uncertaintyReason !== 'string') return false;
          if (entry.uncertaintyReason.length === 0) return false;

          // The original raw row text must be embedded in the reason so the
          // failure is traceable to its source line (Req 5.7).
          if (!entry.uncertaintyReason.includes(rawText)) return false;

          return true;
        }),
        { numRuns: 200 },
      );

      // ── Property body — Direction 2 (Req 12.4 contrapositive) ────────────
      // Use unconstrained `fc.string()` so the universal claim is exercised
      // across the full input space — well-formed rows, malformed rows,
      // empty strings, and arbitrary unicode all included.
      fc.assert(
        fc.property(fc.string(), (rawText) => {
          const row: DetectedRow = {
            classification: 'lab',
            rawText,
            lineIndex: 0,
          };
          const entry = extract(row);

          // The contrapositive: a non-uncertain entry MUST have a non-empty
          // string value. Equivalently, `uncertain === false` ⇒ `value`
          // is a non-empty string.
          if (entry.uncertain) return true;
          if (typeof entry.value !== 'string') return false;
          if (entry.value.length === 0) return false;
          return true;
        }),
        { numRuns: 200 },
      );
    },
  );
});
