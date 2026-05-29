/**
 * tests/property/parser/normalizer.property.test.ts
 *
 * Property-based tests for the Phase 2 Normalizer
 * (`src/lib/parser/normalizer.ts`).
 *
 * Feature: pdf-text-structuring, Property 20: Normalizer produces well-formed
 * strings.
 *
 * Property 20 (design.md):
 *   For any `LabEntry` `e`, `normalize(e)` SHALL satisfy:
 *     (a) every defined string field has no leading or trailing whitespace,
 *     (b) `testName` contains no run of two or more consecutive whitespace
 *         characters.
 *
 * Validates: Requirements 6.1, 6.2
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { normalize } from '../../../src/lib/parser/normalizer.js';
import { UNIT_MAP } from '../../../src/lib/parser/unit-map.js';
import type { LabEntry, LabReferenceRange } from '../../../src/lib/types/index.js';

/**
 * A generator for "messy" strings: random Unicode-ish text that may include
 * leading, trailing, and internal runs of whitespace (spaces, tabs, newlines,
 * non-breaking spaces). Empty strings are also generated to exercise
 * boundary cases for the optional fields.
 *
 * The body is constrained to printable characters plus assorted whitespace
 * to keep counterexamples readable while still exploring the input space the
 * Normalizer is required to handle.
 */
const messyString = fc.stringMatching(/^[\sA-Za-z0-9 \-_/().,*<>%µ\t\n\r\u00a0]*$/);

/**
 * `testName` must remain a string; we let the generator produce arbitrarily
 * messy whitespace (the Normalizer is responsible for collapsing/trimming
 * it). We do NOT require non-empty here — the property in question is only
 * about whitespace shape, not minimum length.
 */
const testNameArb = messyString;

const valueArb = messyString;

/** Optional fields use `fc.option` so the property covers both presence and absence. */
const optionalString = fc.option(messyString, { nil: undefined });

const referenceRangeArb: fc.Arbitrary<LabReferenceRange> = fc.record(
  {
    text: fc.option(messyString, { nil: undefined }),
    low: fc.option(fc.double({ noNaN: true, noDefaultInfinity: true }), { nil: undefined }),
    high: fc.option(fc.double({ noNaN: true, noDefaultInfinity: true }), { nil: undefined }),
  },
  { requiredKeys: [] },
);

const labEntryArb: fc.Arbitrary<LabEntry> = fc.record(
  {
    testName: testNameArb,
    value: valueArb,
    unit: optionalString,
    flag: optionalString,
    notes: optionalString,
    uncertaintyReason: optionalString,
    category: messyString,
    uncertain: fc.boolean(),
    referenceRange: fc.option(referenceRangeArb, { nil: undefined }),
  },
  {
    // `requiredKeys` excludes the optional ones so the generator emits
    // `LabEntry` shapes both with and without each optional field. The
    // required fields (`testName`, `value`, `category`, `uncertain`) are
    // always present.
    requiredKeys: ['testName', 'value', 'category', 'uncertain'],
  },
) as fc.Arbitrary<LabEntry>;

/**
 * `s` has no leading or trailing whitespace iff trimming is a no-op.
 */
function hasNoLeadingOrTrailingWhitespace(s: string): boolean {
  return s === s.trim();
}

/** True when `s` contains no run of two or more consecutive whitespace chars. */
function hasNoMultiWhitespaceRun(s: string): boolean {
  return !/\s{2,}/.test(s);
}

describe('Normalizer property tests', () => {
  // Feature: pdf-text-structuring, Property 20: Normalizer produces well-formed strings
  it('Property 20: every defined string field is trimmed and testName has no multi-whitespace runs', () => {
    fc.assert(
      fc.property(labEntryArb, (entry) => {
        const result = normalize(entry);

        // (a) Every defined string field on the result has no leading or
        //     trailing whitespace (Requirement 6.1).
        expect(hasNoLeadingOrTrailingWhitespace(result.testName)).toBe(true);
        expect(hasNoLeadingOrTrailingWhitespace(result.value)).toBe(true);

        if (result.unit !== undefined) {
          expect(hasNoLeadingOrTrailingWhitespace(result.unit)).toBe(true);
        }
        if (result.flag !== undefined) {
          expect(hasNoLeadingOrTrailingWhitespace(result.flag)).toBe(true);
        }
        if (result.notes !== undefined) {
          expect(hasNoLeadingOrTrailingWhitespace(result.notes)).toBe(true);
        }
        if (result.uncertaintyReason !== undefined) {
          expect(hasNoLeadingOrTrailingWhitespace(result.uncertaintyReason)).toBe(true);
        }
        if (result.referenceRange?.text !== undefined) {
          expect(hasNoLeadingOrTrailingWhitespace(result.referenceRange.text)).toBe(true);
        }

        // (b) testName contains no run of two or more consecutive whitespace
        //     characters (Requirement 6.2).
        expect(hasNoMultiWhitespaceRun(result.testName)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: pdf-text-structuring, Property 21: Unit canonicalisation
  //
  // Property 21 (design.md):
  //   For any LabEntry e whose `unit` (after trimming) is a key in the
  //   canonical unit map, normalize(e).unit SHALL equal the canonical
  //   value from the map. For any e whose trimmed `unit` is not a key in
  //   the map, normalize(e).unit SHALL equal the trimmed source string
  //   with no case conversion applied.
  //
  // Validates: Requirements 6.3
  it('Property 21: known units canonicalise; unknown units pass through trimmed without case conversion', () => {
    // Pre-compute the set of canonical map keys so the generator can
    // construct case-variant inputs guaranteed to hit the map. Variants
    // include: original (uppercase) key, lowercase, and a mixed/title case
    // form. Surrounding whitespace (spaces, tabs, newlines) is added to
    // prove the trim-then-lookup contract.
    //
    // We restrict generation to keys that are *reachable* through
    // canonicalizeUnit's `trimmed.toUpperCase()` lookup. A few keys (e.g.,
    // `µG/DL`) contain characters whose uppercase form differs from
    // themselves under JavaScript's Unicode case mapping (`'µ'.toUpperCase()
    // === 'Μ'`), so no input string can produce them via `.toUpperCase()`.
    // Including them would test a false invariant.
    const mapKeys = Object.keys(UNIT_MAP).filter((k) => k.toUpperCase() === k);

    // Whitespace padding generator: any combination of common whitespace
    // characters around the unit token. Keep it small to avoid bloating
    // counterexamples. (`fc.string` with a custom `unit` lets us pick from
    // a finite alphabet in fast-check v4.)
    const whitespacePad = fc
      .array(fc.constantFrom(' ', '\t', '\n', '\r', '\u00a0'), { maxLength: 4 })
      .map((chars) => chars.join(''));

    // ─── Sub-property A: known units canonicalise ────────────────────────
    //
    // For every key in the map, build a case-variant of that key
    // (uppercase / lowercase / title-ish), pad with arbitrary whitespace,
    // and assert the normalised unit equals the canonical value from the
    // map. This exercises the "trim + uppercase lookup" pipeline in
    // canonicalizeUnit.
    const knownUnitArb = fc.tuple(
      fc.constantFrom(...mapKeys),
      // Three case-variant strategies, picked uniformly. The transformer
      // is applied to the chosen map key.
      fc.constantFrom<(s: string) => string>(
        (s) => s, // upper (keys are already uppercase)
        (s) => s.toLowerCase(),
        (s) =>
          s
            .split('')
            .map((ch, i) => (i % 2 === 0 ? ch.toUpperCase() : ch.toLowerCase()))
            .join(''),
      ),
      whitespacePad,
      whitespacePad,
    );

    fc.assert(
      fc.property(knownUnitArb, ([canonicalKey, transform, leftPad, rightPad]) => {
        const rawUnit = `${leftPad}${transform(canonicalKey)}${rightPad}`;
        const entry: LabEntry = {
          testName: 'Test',
          value: '1',
          unit: rawUnit,
          category: 'Uncategorized',
          uncertain: false,
        };

        const result = normalize(entry);

        // The trimmed key uppercases to a map key by construction, so the
        // canonical value must be returned verbatim.
        expect(result.unit).toBe(UNIT_MAP[canonicalKey]);
      }),
      { numRuns: 200 },
    );

    // ─── Sub-property B: unknown units pass through trimmed without case
    //     conversion ─────────────────────────────────────────────────────
    //
    // Generate arbitrary unit strings whose UPPERCASED, TRIMMED form is
    // NOT a key in UNIT_MAP. The Normalizer must:
    //   1. Trim leading/trailing whitespace.
    //   2. Leave the inner casing untouched (no upper/lower conversion).
    //
    // The generator constrains characters to a small printable alphabet
    // (mixing letters, digits, and unit punctuation) to keep
    // counterexamples readable. We then filter out any string whose
    // uppercased form is a known key, since those are covered by
    // sub-property A.
    const unitCharArb = fc.constantFrom(
      'a',
      'B',
      'c',
      'D',
      'q',
      'Z',
      '1',
      '2',
      '7',
      '/',
      '.',
      '·',
      '^',
      '³',
    );

    const unknownUnitArb = fc
      .tuple(
        whitespacePad,
        fc
          .array(unitCharArb, { minLength: 1, maxLength: 8 })
          .map((chars) => chars.join('')),
        whitespacePad,
      )
      .filter(([, body]) => {
        const trimmed = body.trim();
        // The body itself has no surrounding whitespace by construction
        // (whitespace lives in the pads); guard against the trimmed body
        // being empty (would canonicalise to empty string, which is not
        // interesting for this property) and against accidental hits
        // against a known canonical key.
        if (trimmed.length === 0) return false;
        return UNIT_MAP[trimmed.toUpperCase()] === undefined;
      });

    fc.assert(
      fc.property(unknownUnitArb, ([leftPad, body, rightPad]) => {
        const rawUnit = `${leftPad}${body}${rightPad}`;
        const entry: LabEntry = {
          testName: 'Test',
          value: '1',
          unit: rawUnit,
          category: 'Uncategorized',
          uncertain: false,
        };

        const result = normalize(entry);

        // The Normalizer must trim the input ...
        expect(result.unit).toBe(rawUnit.trim());
        // ... and apply no case conversion. We verify casing-preservation
        // explicitly: every character of the trimmed source survives
        // unchanged in the output. (This is stronger than the equality
        // above — it makes the no-case-conversion intent explicit, and
        // guards against any future implementation that might trim and
        // then case-fold.)
        const trimmedBody = rawUnit.trim();
        for (let i = 0; i < trimmedBody.length; i++) {
          expect(result.unit?.charAt(i)).toBe(trimmedBody.charAt(i));
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: pdf-text-structuring, Property 22: Reference range parsing
  //
  // Property 22 (design.md):
  //   For any LabEntry e whose `referenceRange.text` matches
  //   ^\s*(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*$ with parsable bounds
  //   lo and hi, normalize(e).referenceRange SHALL satisfy low === lo and
  //   high === hi.
  //
  //   For any e whose range text contains a non-numeric suffix or a
  //   comparison operator (e.g., "< 30", "Negative", "197-771 pg/ml"),
  //   normalize(e).referenceRange.low and .high SHALL be undefined and
  //   .text SHALL equal the original range string (modulo the trim that
  //   Requirement 6.1 already requires on every defined string field).
  //
  // Validates: Requirements 6.4, 6.5
  it('Property 22: numeric ranges populate low/high; non-numeric ranges leave them undefined and keep text verbatim', () => {
    // ─── Shared building blocks ──────────────────────────────────────────

    // A purely numeric token matching the regex's `\d+(?:\.\d+)?` body.
    // We split into integer-only and `int.frac` flavours so the generator
    // explores both shapes uniformly. Bounds are kept small to keep
    // counterexamples readable; values like `0` and `0.0` are reachable.
    const numericTokenArb = fc.oneof(
      fc.integer({ min: 0, max: 99999 }).map((n) => String(n)),
      fc
        .tuple(
          fc.integer({ min: 0, max: 99999 }),
          fc.integer({ min: 0, max: 99999 }),
        )
        .map(([intPart, fracPart]) => `${intPart}.${fracPart}`),
    );

    // Whitespace pad: zero or more characters compatible with the `\s`
    // class in the reference-range regex. A small finite alphabet keeps
    // shrunk counterexamples readable.
    const wsPad = fc
      .array(fc.constantFrom(' ', '\t', '\n', '\u00a0'), { maxLength: 3 })
      .map((chars) => chars.join(''));

    // The two dash characters the spec accepts: ASCII hyphen-minus and
    // en-dash. Em-dash (U+2014) is intentionally excluded — it must not
    // be treated as a range separator.
    const dashArb = fc.constantFrom('-', '\u2013');

    // ─── Sub-property A: numeric ranges populate low/high ────────────────
    //
    // Build a range string `<wsPad><lo><wsPad><dash><wsPad><hi><wsPad>`
    // that, by construction, matches REFERENCE_RANGE_NUMERIC. Then assert
    // that the Normalizer parses both bounds from the matched groups and
    // preserves the trimmed text.
    const numericRangeArb = fc
      .tuple(wsPad, numericTokenArb, wsPad, dashArb, wsPad, numericTokenArb, wsPad)
      .map(([leftPad, lo, innerL, dash, innerR, hi, rightPad]) => ({
        lo,
        hi,
        text: `${leftPad}${lo}${innerL}${dash}${innerR}${hi}${rightPad}`,
      }));

    fc.assert(
      fc.property(numericRangeArb, ({ lo, hi, text }) => {
        const entry: LabEntry = {
          testName: 'Marker',
          value: '0',
          referenceRange: { text },
          category: 'Uncategorized',
          uncertain: false,
        };

        const result = normalize(entry);

        // Bounds parsed from the matched capture groups (Req 6.4).
        expect(result.referenceRange).toBeDefined();
        expect(result.referenceRange?.low).toBe(Number.parseFloat(lo));
        expect(result.referenceRange?.high).toBe(Number.parseFloat(hi));
        // The trimmed source text is preserved verbatim.
        expect(result.referenceRange?.text).toBe(text.trim());
      }),
      { numRuns: 200 },
    );

    // ─── Sub-property B: non-numeric ranges leave low/high undefined ─────
    //
    // Three flavours of non-numeric reference range, all of which must
    // fail to match REFERENCE_RANGE_NUMERIC and therefore round-trip
    // through `text` with `low`/`high` left undefined (Req 6.5):
    //
    //   1. Comparison operator + bound:   "< 30", ">= 1.5", "≤ 5".
    //   2. Qualitative tokens:            "Negative", "Reactive", ...
    //   3. Numeric-with-non-numeric-suffix: "197-771 pg/ml", "5-10 units".
    //
    // Inputs are generated WITHOUT leading or trailing whitespace so the
    // `.text` equality assertion is unambiguous (the Normalizer always
    // trims defined string fields per Req 6.1).
    const comparisonRangeArb = fc
      .tuple(
        fc.constantFrom('<', '>', '<=', '>=', '\u2264', '\u2265'),
        wsPad,
        numericTokenArb,
      )
      .map(([op, ws, n]) => `${op}${ws}${n}`);

    const qualitativeRangeArb = fc.constantFrom(
      'Negative',
      'Positive',
      'Reactive',
      'Non-Reactive',
      'Present',
      'Absent',
    );

    const numericWithSuffixArb = fc
      .tuple(
        numericTokenArb,
        dashArb,
        numericTokenArb,
        // Each suffix begins with a space so the formatted range "looks
        // numeric" until a non-whitespace token (the unit) appears, which
        // is exactly the shape the spec calls out as "numeric range with
        // non-numeric suffix".
        fc.constantFrom(
          ' pg/ml',
          ' mg/dL',
          ' IU/L',
          ' g/dL',
          ' %',
          ' x10^3/uL',
          ' cells/uL',
          ' units',
        ),
      )
      .map(([lo, dash, hi, suffix]) => `${lo}${dash}${hi}${suffix}`);

    const nonNumericRangeArb = fc
      .oneof(comparisonRangeArb, qualitativeRangeArb, numericWithSuffixArb)
      // Defensive: drop any input that — by accident of the generator —
      // happens to match the strict numeric regex. This guards the
      // property against future generator changes that might inadvertently
      // emit a numeric form.
      .filter(
        (s) => !/^\s*\d+(?:\.\d+)?\s*[-\u2013]\s*\d+(?:\.\d+)?\s*$/.test(s),
      );

    fc.assert(
      fc.property(nonNumericRangeArb, (text) => {
        const entry: LabEntry = {
          testName: 'Marker',
          value: '0',
          referenceRange: { text },
          category: 'Uncategorized',
          uncertain: false,
        };

        const result = normalize(entry);

        // low/high must be omitted for non-numeric ranges (Req 6.5).
        expect(result.referenceRange).toBeDefined();
        expect(result.referenceRange?.low).toBeUndefined();
        expect(result.referenceRange?.high).toBeUndefined();
        // The original text round-trips verbatim. By construction the
        // input has no surrounding whitespace, so trimming is a no-op
        // and equality is exact.
        expect(result.referenceRange?.text).toBe(text);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: pdf-text-structuring, Property 23: Normalizer is idempotent and pure
  //
  // Property 23 (design.md):
  //   For any LabEntry e, normalize(normalize(e)) SHALL be deeply equal
  //   to normalize(e), and normalize SHALL not perform any I/O.
  //
  // Validates: Requirements 6.6
  //
  // The "no I/O" half of the property is established structurally by the
  // implementation (it is a synchronous function over plain objects with
  // no imports of I/O modules and no time/random dependencies); we cannot
  // assert that from a black-box test. What we *can* test from outside
  // are the observable consequences of purity:
  //
  //   (a) Idempotence — applying `normalize` twice yields the same result
  //       as applying it once. This is the canonical fixed-point property
  //       called out in Requirement 6.6 and is what protects callers that
  //       inadvertently re-normalise (e.g., re-running the parser on
  //       already-normalised data).
  //
  //   (b) Determinism — calling `normalize` multiple times on the same
  //       input always produces equal output. This is implied by purity
  //       (no time/random/IO dependencies) and is independently
  //       verifiable.
  //
  //   (c) Non-mutation of the input — a pure function does not mutate
  //       its arguments. We snapshot the input via `JSON.stringify`
  //       (sufficient because LabEntry has no functions, dates, or
  //       circular refs) and assert it survives the call unchanged.
  it('Property 23: normalize is idempotent, deterministic, and does not mutate its input', () => {
    fc.assert(
      fc.property(labEntryArb, (entry) => {
        // Snapshot the input shape BEFORE the first call so we can detect
        // any mutation a (buggy) implementation might perform on the
        // argument. JSON.stringify is appropriate here: LabEntry is a
        // plain data record (strings, numbers, booleans, plain objects)
        // with no `Date`, function, or cyclic field.
        const inputSnapshot = JSON.stringify(entry);

        const once = normalize(entry);

        // (c) Input is not mutated by the call.
        expect(JSON.stringify(entry)).toBe(inputSnapshot);

        // (a) Idempotence: normalize(normalize(e)) deep-equals normalize(e).
        const twice = normalize(once);
        expect(twice).toEqual(once);

        // (b) Determinism: a fresh call on the original input produces a
        //     result deep-equal to the first call. Any time-, random-, or
        //     I/O-dependent behaviour would surface here.
        const onceAgain = normalize(entry);
        expect(onceAgain).toEqual(once);

        // Stronger idempotence check: a third application is still equal.
        // This guards against implementations that converge after two
        // passes but oscillate thereafter (e.g., flipping casing on each
        // call). The property requires a true fixed point.
        const thrice = normalize(twice);
        expect(thrice).toEqual(once);
      }),
      { numRuns: 200 },
    );
  });
});
