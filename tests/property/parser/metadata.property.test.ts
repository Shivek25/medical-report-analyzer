/**
 * tests/property/parser/metadata.property.test.ts
 *
 * Property-based tests for the Phase 2 Metadata Extractor
 * (`src/lib/parser/metadata.ts`).
 *
 * Each `it(...)` block corresponds to one numbered property from the
 * design document; tests are added incrementally as their tasks are
 * implemented.
 *
 * Feature: pdf-text-structuring
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { extract } from '../../../src/lib/parser/metadata.js';

describe('Metadata Extractor — property tests', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 4: Patient name extraction
  // Validates: Requirements 2.1
  //
  // For any synthetic header text containing a `Name : <name>` line where
  // `<name>` is a non-empty string of printable characters, the extracted
  // `metadata.patientName` SHALL equal `<name>` after trimming.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'extracts patientName from a `Name : <name>` line equal to <name> after trimming',
    () => {
      // Printable alphabet, deliberately constrained to keep the property
      // focused on Requirement 2.1:
      //   - excludes newline / carriage-return so the name stays on one line.
      //   - excludes `(` and `)` so the trailing `(<digits>Y/<letter>)`
      //     age/gender annotation (Req 2.7, covered by Property 6) cannot
      //     accidentally fire and strip part of the name.
      //   - excludes `:` to keep the labelled-line regex unambiguous (the
      //     property is about Name extraction, not colon handling).
      const nameChar = fc.constantFrom(
        ...Array.from(
          'abcdefghijklmnopqrstuvwxyz' +
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
            '0123456789' +
            " .'-",
        ),
      );

      const nameArb = fc
        .string({ unit: nameChar, minLength: 1, maxLength: 60 })
        // The property requires `<name>` to be a non-empty string after
        // trimming (otherwise there is no name to extract).
        .filter((s) => s.trim().length > 0);

      fc.assert(
        fc.property(nameArb, (name) => {
          // Synthetic header that places the labelled name line within the
          // first ~30 lines (the header zone the extractor inspects).
          const headerText = [
            'Thyrocare Technologies Ltd.',
            '123 Some Address, Mumbai',
            `Name : ${name}`,
            'Report Date : 09/03/2026',
            'Sample Collected : 08/03/2026',
          ].join('\n');

          const metadata = extract(headerText);

          return metadata.patientName === name.trim();
        }),
        { numRuns: 200 },
      );
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 5: Date extraction is
  // ISO-when-convertible, verbatim-otherwise
  // Validates: Requirements 2.2, 2.3
  //
  // For any date string `d` placed after a `Report Date` or
  // `Sample Collected` label, the corresponding `metadata` field SHALL equal
  // the ISO `YYYY-MM-DD` form of `d` when `d` matches one of the accepted
  // patterns (`DD/MM/YYYY`, `DD-MM-YYYY`, `DD MMM YYYY`, `MMM DD, YYYY`),
  // and SHALL equal the verbatim (trimmed) source string otherwise.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'extracts dates as ISO YYYY-MM-DD when convertible and as the verbatim source string otherwise',
    () => {
      // ── Helpers ────────────────────────────────────────────────────────────
      const monthAbbrs = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ] as const;

      const padded = (n: number): string => String(n).padStart(2, '0');
      const isoFor = (y: number, m: number, d: number): string =>
        `${y}-${padded(m)}-${padded(d)}`;

      // Valid calendar parts. Day capped at 28 so every month/year combination
      // is a real date (sidesteps leap-year / month-length edge cases — those
      // are exercised by the metadata unit tests, not this property).
      const validDateParts = fc.tuple(
        fc.integer({ min: 2000, max: 2099 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
      );

      // ── Convertible-date generators ────────────────────────────────────────
      // Each emits the source string the parser will see plus the ISO form
      // it must produce. Together they cover all four accepted patterns.
      const ddSlash = validDateParts.map(([y, m, d]) => ({
        input: `${padded(d)}/${padded(m)}/${y}`,
        expected: isoFor(y, m, d),
      }));
      const ddDash = validDateParts.map(([y, m, d]) => ({
        input: `${padded(d)}-${padded(m)}-${y}`,
        expected: isoFor(y, m, d),
      }));
      const ddMmmYyyy = validDateParts.map(([y, m, d]) => ({
        input: `${d} ${monthAbbrs[m - 1]} ${y}`,
        expected: isoFor(y, m, d),
      }));
      const mmmDdYyyy = validDateParts.map(([y, m, d]) => ({
        input: `${monthAbbrs[m - 1]} ${d}, ${y}`,
        expected: isoFor(y, m, d),
      }));

      const convertibleArb = fc.oneof(ddSlash, ddDash, ddMmmYyyy, mmmDdYyyy);

      // ── Non-convertible generator ──────────────────────────────────────────
      // The alphabet is deliberately tiny: letters that cannot spell any of
      //   - the date patterns (no digits, no `-`, no `/`, no `,`)
      //   - the label keywords (`Report`, `Reported`, `Sample`, `Collected`,
      //     `Collection`, `Date`)
      // so the generated strings are guaranteed to fall through to the
      // verbatim branch and cannot accidentally cross-match the other
      // labelled line in the synthetic header.
      const safeChar = fc.constantFrom(...Array.from('qwxyzQWXYZ '));
      const nonConvertibleArb = fc
        .string({ unit: safeChar, minLength: 1, maxLength: 30 })
        .filter((s) => s.trim().length > 0)
        .map((s) => ({ input: s, expected: s.trim() }));

      // A single date case may be either convertible or verbatim.
      const dateCase = fc.oneof(convertibleArb, nonConvertibleArb);

      fc.assert(
        // Run reportDate (Req 2.2) and sampleDate (Req 2.3) in lockstep —
        // the two requirements specify identical behaviour, so a single
        // property pins them both down.
        fc.property(dateCase, dateCase, (reportCase, sampleCase) => {
          const headerText = [
            'Thyrocare Technologies Ltd.',
            '123 Some Address, Mumbai',
            'Name : Jane Doe',
            `Report Date : ${reportCase.input}`,
            `Sample Collected : ${sampleCase.input}`,
          ].join('\n');

          const metadata = extract(headerText);

          return (
            metadata.reportDate === reportCase.expected &&
            metadata.sampleDate === sampleCase.expected
          );
        }),
        { numRuns: 200 },
      );
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 6: Age and gender annotation parsing
  // Validates: Requirements 2.7, 2.8
  //
  // For any patient name line, when the line ends with an annotation matching
  // `(<digits>Y/<single-letter>)`, `metadata.patientAge` SHALL be the numeric
  // value of `<digits>` and `metadata.patientGender` SHALL be the
  // corresponding letter mapped to one of `'M'`, `'F'`, `'O'`. When the
  // annotation does not match this exact format, both `patientAge` and
  // `patientGender` SHALL be `undefined`.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'parses age/gender from `(<digits>Y/<letter>)` annotations and omits both fields when the annotation is absent or malformed',
    () => {
      // Printable name characters, deliberately excluding:
      //   - newline / carriage return so the name stays on a single line.
      //   - `(` and `)` so the only annotation-shaped substring on the line
      //     is the one this property explicitly appends (or none).
      //   - `:` to keep the labelled `Name :` regex unambiguous.
      //   - digits and `/` so a stray substring cannot form the
      //     `<digits>Y/<letter>` shape inside the base name itself.
      const baseNameChar = fc.constantFrom(
        ...Array.from(
          'abcdefghijklmnopqrstuvwxyz' +
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
            " .'-",
        ),
      );

      const baseNameArb = fc
        .string({ unit: baseNameChar, minLength: 1, maxLength: 40 })
        // Need at least one non-whitespace character so the name extractor
        // sees a non-empty captured value.
        .filter((s) => s.trim().length > 0);

      // Restrict the matching direction to gender letters that have a defined
      // mapping in `GENDER_LETTER_MAP` (`M | F | O`, case-insensitive). The
      // canonical mapping for these letters is exactly `letter.toUpperCase()`.
      const matchingGenderArb = fc.constantFrom('M', 'm', 'F', 'f', 'O', 'o');
      const ageArb = fc.integer({ min: 0, max: 150 });

      // ── Matching direction (Req 2.7) ─────────────────────────────────────
      // For every well-formed `(<digits>Y/<M|F|O>)` annotation, `patientAge`
      // is the numeric digits and `patientGender` is the letter uppercased.
      fc.assert(
        fc.property(
          baseNameArb,
          ageArb,
          matchingGenderArb,
          (baseName, age, genderLetter) => {
            const headerText = [
              'Thyrocare Technologies Ltd.',
              '123 Some Address, Mumbai',
              `Name : ${baseName} (${age}Y/${genderLetter})`,
              'Report Date : 09/03/2026',
            ].join('\n');

            const metadata = extract(headerText);
            const expectedGender = genderLetter.toUpperCase() as 'M' | 'F' | 'O';

            return (
              metadata.patientAge === age &&
              metadata.patientGender === expectedGender
            );
          },
        ),
        { numRuns: 100 },
      );

      // ── Non-matching direction (Req 2.8) ─────────────────────────────────
      // Any name line whose trailing content does not form the exact
      // `(<digits>Y/<single-letter>)` annotation must leave both fields
      // omitted. The trailing-suffix alphabet excludes `(` and `)` so no
      // generated suffix can ever satisfy the annotation regex, regardless of
      // what comes before it.
      const nonAnnotationChar = baseNameChar; // identical safe alphabet
      const nonAnnotationSuffix = fc.string({
        unit: nonAnnotationChar,
        minLength: 0,
        maxLength: 30,
      });

      fc.assert(
        fc.property(baseNameArb, nonAnnotationSuffix, (baseName, suffix) => {
          const trailing = suffix.length === 0 ? '' : ` ${suffix}`;
          const headerText = [
            'Thyrocare Technologies Ltd.',
            '123 Some Address, Mumbai',
            `Name : ${baseName}${trailing}`,
            'Report Date : 09/03/2026',
          ].join('\n');

          const metadata = extract(headerText);
          return (
            metadata.patientAge === undefined &&
            metadata.patientGender === undefined
          );
        }),
        { numRuns: 100 },
      );
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 7: Missing metadata fields are
  // not fabricated
  // Validates: Requirements 2.6
  //
  // For any header text that does not contain markers for a given metadata
  // field (`patientName`, `reportDate`, `sampleDate`, `labName`, `reportId`),
  // the corresponding field on `metadata` SHALL be `undefined`.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'omits metadata fields whose markers are absent from the header text',
    () => {
      // Safe alphabet: digits, whitespace, and benign punctuation that cannot
      // form any marker the extractor recognises. Excludes:
      //   - all letters — kills every labelled keyword the extractor looks
      //     for (`Name`, `Patient Name`, `Report Date`, `Reported on`,
      //     `Sample Collected`, `Collection Date`, `Barcode`, `Report ID`)
      //     and every lab-keyword (`Thyrocare`, `Diagnostics`, `Laboratory`,
      //     `Pathology`, `Pathlab`, `Healthcare`, `Lab`); also makes it
      //     impossible for the stand-alone title-case name fallback (two
      //     consecutive `[A-Z][a-z]+` words) to fire.
      //   - `:` — labelled-line regexes all require `:` after the keyword,
      //     so dropping the colon is a defence-in-depth guarantee against
      //     any accidental match.
      //   - `(` / `)` — keeps the `(<digits>Y/<letter>)` annotation from
      //     ever forming, so `patientAge` / `patientGender` cannot be
      //     populated even by accident.
      //
      // Any string drawn from this alphabet is guaranteed marker-free, so
      // every metadata field MUST be omitted (Req 2.6).
      const safeChar = fc.constantFrom(...Array.from('0123456789 .,;!?'));

      const safeLine = fc.string({ unit: safeChar, minLength: 0, maxLength: 60 });
      const safeLines = fc.array(safeLine, { minLength: 0, maxLength: 30 });

      fc.assert(
        fc.property(safeLines, (lines) => {
          const headerText = lines.join('\n');
          const metadata = extract(headerText);

          return (
            metadata.patientName === undefined &&
            metadata.patientAge === undefined &&
            metadata.patientGender === undefined &&
            metadata.reportDate === undefined &&
            metadata.sampleDate === undefined &&
            metadata.labName === undefined &&
            metadata.reportId === undefined
          );
        }),
        { numRuns: 200 },
      );
    },
  );
});
