/**
 * tests/property/parser/row-detector.property.test.ts
 *
 * Property-based tests for the Phase 2 Row_Detector
 * (`src/lib/parser/row-detector.ts`).
 *
 * Each `it(...)` block corresponds to one numbered property from the design
 * document; tests are added incrementally as their tasks are implemented.
 *
 * Feature: pdf-text-structuring
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { detect } from '../../../src/lib/parser/row-detector.js';

describe('Row_Detector — property tests', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 11: Lab-row classification rule
  // Validates: Requirements 4.1
  //
  // For any line L that contains both
  //   (a) a numeric token or one of the qualitative tokens
  //       `Negative | Positive | Reactive | Non-Reactive | Present | Absent`,
  //       and
  //   (b) at least one of a unit token, a reference-range pattern, or a
  //       flag token,
  // `Row_Detector.detect` SHALL emit a row whose `classification === 'lab'`
  // and whose `rawText` (after merge) contains L.
  //
  // The generators below carefully constrain each slot so the synthesised
  // line is unambiguously a lab row:
  //   - Test-name tokens are uppercase alphabetic words that do not collide
  //     with the qualitative-value vocabulary or the unit/flag token sets,
  //     and whose lowercase forms can never start with the non-data
  //     prefixes "method:", "methodology:", or "note:" (the prefix check is
  //     followed by a colon, which the generator never produces).
  //   - Values are either positive numeric tokens (integer or decimal) or
  //     one of the recognised qualitative tokens in their canonical case.
  //   - Units come from a curated list known to satisfy `UNIT_TOKEN`.
  //   - Ranges use distinct, non-qualitative shapes (numeric `lo-hi` or
  //     comparison `<N` / `>N`) so that criterion (b) is satisfied by a
  //     token that is not also the value token.
  //   - Flags use the canonical-case set recognised by `FLAG_TOKEN`.
  //   - At least one of {unit, range, flag} is always included so (b) is
  //     satisfied independently of the value token.
  //
  // The property feeds the synthesised line as the entire `cleanedText`
  // (no surrounding lines and no leading/trailing whitespace), so no
  // continuation merge can fire. The merged `rawText` therefore equals
  // `line.trim() === line`, and `rawText.includes(line)` is the natural
  // post-merge containment check called for by Property 11.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'classifies a line containing a value token and at least one of (unit, range, flag) as lab',
    () => {
      // ── Generators ───────────────────────────────────────────────────────

      // Single uppercase alphabetic word (3-12 letters). Uppercase-only keeps
      // the token disjoint from the qualitative-value vocabulary (which is
      // matched in canonical case by the qualitative regex but only in
      // standalone form here we are wrapping it in a longer line) and avoids
      // accidental collisions with unit/flag tokens.
      const upperLetter = fc.constantFrom(
        ...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
      );
      const nameTokenArb = fc
        .string({ unit: upperLetter, minLength: 3, maxLength: 12 })
        // Avoid producing tokens that would themselves register as
        // qualitative values (case-insensitive match) or recognised flag
        // words. The unit pattern is anchored to lowercase letter-after-`/`
        // shapes, so uppercase-only names cannot collide with it.
        .filter((w) => {
          const lower = w.toLowerCase();
          if (
            lower === 'negative' ||
            lower === 'positive' ||
            lower === 'reactive' ||
            lower === 'present' ||
            lower === 'absent'
          ) {
            return false;
          }
          if (
            w === 'H' ||
            w === 'L' ||
            w === 'HIGH' ||
            w === 'LOW' ||
            w === 'CRITICAL' ||
            w === 'ABNORMAL'
          ) {
            return false;
          }
          return true;
        });

      // 1-3 name tokens joined by single spaces. Always non-empty so the
      // line never collapses to "<value> <unit>" alone (though such a line
      // would still be classified as a lab row per Req 4.1).
      const nameArb = fc
        .array(nameTokenArb, { minLength: 1, maxLength: 3 })
        .map((tokens) => tokens.join(' '));

      // Positive numeric value: either an integer or a decimal with a
      // single dot. Excludes scientific-notation and signed forms to keep
      // the generated line visually obvious.
      const numericArb = fc.oneof(
        fc.integer({ min: 0, max: 9999 }).map((n) => String(n)),
        fc
          .tuple(
            fc.integer({ min: 0, max: 999 }),
            fc.integer({ min: 1, max: 99 }),
          )
          .map(([i, d]) => `${i}.${d}`),
      );

      // Qualitative value in canonical case (matches the qualitative regex
      // unambiguously).
      const qualitativeArb = fc.constantFrom(
        'Negative',
        'Positive',
        'Reactive',
        'Non-Reactive',
        'Present',
        'Absent',
      );

      const valueArb = fc.oneof(numericArb, qualitativeArb);

      // Curated unit list — every entry is recognised by UNIT_TOKEN.
      const unitArb = fc.constantFrom(
        'mg/dL',
        'g/dL',
        'IU/L',
        'pg/mL',
        'mmol/L',
        'ng/mL',
        '%',
      );

      // Numeric reference range `lo-hi` with `lo < hi`.
      const numericRangeArb = fc
        .tuple(
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 101, max: 500 }),
        )
        .map(([lo, hi]) => `${lo}-${hi}`);

      // One-sided comparison range — chooses an operator and a numeric
      // bound. The space between operator and bound matches the loose
      // comparison-range matcher used by REFERENCE_RANGE_ANY.
      const comparisonRangeArb = fc
        .tuple(fc.constantFrom('<', '>'), fc.integer({ min: 1, max: 999 }))
        .map(([op, n]) => `${op} ${n}`);

      // Use only non-qualitative range shapes here so that criterion (b)
      // is satisfied by a token distinct from the qualitative value.
      const rangeArb = fc.oneof(numericRangeArb, comparisonRangeArb);

      const flagArb = fc.constantFrom(
        'H',
        'L',
        '*',
        'HIGH',
        'LOW',
        'CRITICAL',
        'ABNORMAL',
      );

      // At least one of {unit, range, flag} must be present (criterion b).
      const extrasArb = fc
        .tuple(
          fc.option(unitArb, { nil: undefined }),
          fc.option(rangeArb, { nil: undefined }),
          fc.option(flagArb, { nil: undefined }),
        )
        .filter(
          ([u, r, f]) =>
            u !== undefined || r !== undefined || f !== undefined,
        );

      const lineArb = fc
        .tuple(nameArb, valueArb, extrasArb)
        .map(([name, value, [unit, range, flag]]) => {
          // Order: name, value, unit, flag, range. The Row_Detector's
          // classification predicate is order-insensitive, so any
          // permutation would also be valid; this layout simply matches
          // the canonical Thyrocare row shape.
          const parts: string[] = [name, value];
          if (unit !== undefined) parts.push(unit);
          if (flag !== undefined) parts.push(flag);
          if (range !== undefined) parts.push(range);
          return parts.join(' ');
        });

      fc.assert(
        fc.property(lineArb, (line) => {
          const { rows } = detect(line);
          // Property 11: at least one emitted row must be classified `lab`
          // and its merged rawText must contain the original line.
          return rows.some(
            (r) => r.classification === 'lab' && r.rawText.includes(line),
          );
        }),
        { numRuns: 200 },
      );
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 12: Non-data line skipping
  // Validates: Requirements 4.3
  //
  // For any line whose entire content matches one of:
  //   (a) a section header (per the predicate in Property 9: all-uppercase
  //       or title-case, no numeric or unit tokens),
  //   (b) a `Method:` / `Methodology:` / `Note:` prefix line,
  //   (c) a prose-only line with no numeric or unit tokens,
  //   (d) a disclaimer line containing the keywords `not a substitute` or
  //       `consult your physician`,
  // that line SHALL NOT appear as a `'lab'` row in the detector output.
  //
  // Each line is fed to `detect` in isolation (no surrounding context), so
  // multi-line merging cannot fire — the test isolates the classification
  // decision for the single line in question. We assert that NO emitted row
  // carries `classification === 'lab'`. Ambiguous rows are permitted because
  // the property only restricts the `'lab'` outcome.
  //
  // Generator design notes:
  //   - (a) Section headers: pure-uppercase letter words joined by single
  //     spaces. The all-letters constraint guarantees the line satisfies
  //     `SECTION_HEADER_SHAPE`'s first alternation, contains no
  //     `NUMERIC_VALUE` (no digits), and does not match a `UNIT_TOKEN`
  //     (every recognised unit body uses lowercase letters somewhere
  //     except `IU/L` which requires a `/`). A post-filter rejects words
  //     that happen to spell a qualitative value in uppercase
  //     (`NEGATIVE`, `POSITIVE`, …) so the line cannot inadvertently
  //     register a value token.
  //   - (b) Method/Note lines: prefix chosen from the recognised set
  //     (`method:` / `methodology:` / `note:`), with arbitrary alphanumeric
  //     and punctuation tail. The detector's check (`trimmed.toLowerCase()
  //     .startsWith(prefix)`) is order-insensitive to case, so the prefix
  //     casing is varied freely.
  //   - (c) Prose-only lines: drawn from a curated lowercase word list
  //     that contains no digits and no unit-token substrings. A
  //     post-filter additionally rejects any sample that happens to
  //     contain a qualitative value or method/disclaimer phrase, so the
  //     line never accidentally falls into a different non-data category.
  //   - (d) Disclaimer lines: built by sandwiching one of the two
  //     recognised phrases between arbitrary lowercase prefix/suffix
  //     fragments. The detector matches via case-insensitive substring,
  //     so the phrase casing is also varied.
  //
  // None of the generators introduce newline characters (every unit
  // arbitrary draws from a printable, newline-free character set), so each
  // generated line maps to a single source line when passed to `detect`.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'never emits a lab row for section headers, method/note prefixes, prose-only lines, or disclaimers',
    () => {
      // ── Generator (a): section header ────────────────────────────────────
      const upperLetter = fc.constantFrom(
        ...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
      );
      const headerWordArb = fc.string({
        unit: upperLetter,
        minLength: 2,
        maxLength: 10,
      });
      const sectionHeaderArb = fc
        .array(headerWordArb, { minLength: 1, maxLength: 4 })
        .map((words) => words.join(' '))
        .filter((line) => {
          // Reject lines that happen to spell a qualitative value token
          // (which would make `hasValueToken` true and disqualify the line
          // from `looksLikeHeaderShape`). The qualitative regex is
          // case-insensitive, so the uppercase forms must be excluded.
          if (/\b(?:NEGATIVE|POSITIVE|REACTIVE|PRESENT|ABSENT)\b/.test(line)) {
            return false;
          }
          if (/\bNON[- ]?REACTIVE\b/.test(line)) return false;
          // Reject empty / whitespace-only edge cases produced by joining.
          return line.trim().length > 0;
        });

      // ── Generator (b): Method / Methodology / Note prefix line ───────────
      const lowerLetter = fc.constantFrom(
        ...Array.from('abcdefghijklmnopqrstuvwxyz '),
      );
      const methodPrefixArb = fc.constantFrom(
        'Method',
        'method',
        'METHOD',
        'Methodology',
        'methodology',
        'METHODOLOGY',
        'Note',
        'note',
        'NOTE',
      );
      const methodTailArb = fc
        .string({ unit: lowerLetter, minLength: 0, maxLength: 30 })
        .map((s) => s.replace(/[\r\n]/g, ''));
      const methodNoteArb = fc
        .tuple(methodPrefixArb, methodTailArb)
        .map(([prefix, tail]) => `${prefix}: ${tail}`);

      // ── Generator (c): prose-only line (no numeric / unit tokens) ────────
      // Curated word list — all-lowercase, no digits, none of the words
      // contain a unit-token substring (`mg`, `ng`, `pg`, `kg`, `mol`,
      // `fl`, etc. are excluded), and none coincide with a qualitative
      // value or with the Method/Note prefixes.
      const proseWordArb = fc.constantFrom(
        'this',
        'is',
        'some',
        'descriptive',
        'text',
        'about',
        'the',
        'report',
        'patient',
        'specimen',
        'analysis',
        'results',
        'will',
        'should',
        'have',
        'been',
        'reviewed',
        'thoroughly',
        'before',
        'further',
        'evaluation',
      );
      const proseArb = fc
        .array(proseWordArb, { minLength: 3, maxLength: 12 })
        .map((words) => words.join(' '))
        .filter((line) => {
          // Defensive filters — should never trigger given the curated word
          // list, but keep them so changes to the list cannot silently
          // break the property.
          if (/\d/.test(line)) return false;
          if (
            /\b(?:negative|positive|reactive|non[- ]?reactive|present|absent)\b/i.test(
              line,
            )
          ) {
            return false;
          }
          if (/^\s*(?:method|methodology|note)\s*:/i.test(line)) return false;
          if (/not a substitute|consult your physician/i.test(line)) {
            return false;
          }
          return line.trim().length > 0;
        });

      // ── Generator (d): disclaimer line ───────────────────────────────────
      const disclaimerPhraseArb = fc.constantFrom(
        'not a substitute',
        'NOT A SUBSTITUTE',
        'Not A Substitute',
        'consult your physician',
        'CONSULT YOUR PHYSICIAN',
        'Consult Your Physician',
      );
      const disclaimerFragmentArb = fc
        .string({ unit: lowerLetter, minLength: 0, maxLength: 25 })
        .map((s) => s.replace(/[\r\n]/g, ''));
      const disclaimerArb = fc
        .tuple(disclaimerFragmentArb, disclaimerPhraseArb, disclaimerFragmentArb)
        .map(
          ([prefix, phrase, suffix]) =>
            `${prefix}${prefix.length > 0 ? ' ' : ''}${phrase}${
              suffix.length > 0 ? ' ' : ''
            }${suffix}`.trim(),
        )
        .filter((line) => line.length > 0);

      // ── Combined generator ────────────────────────────────────────────────
      const nonDataLineArb = fc.oneof(
        sectionHeaderArb,
        methodNoteArb,
        proseArb,
        disclaimerArb,
      );

      fc.assert(
        fc.property(nonDataLineArb, (line) => {
          const { rows } = detect(line);
          // Property 12: NO emitted row may be classified `lab`.
          // Ambiguous rows are permitted (the property does not constrain
          // them), but a `lab` classification for a non-data line is a
          // violation of Requirement 4.3.
          return rows.every((r) => r.classification !== 'lab');
        }),
        { numRuns: 200 },
      );
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 13: Detected rows preserve source order
  // Validates: Requirements 4.4
  //
  // For any cleaned-text input, the `lineIndex` values of the rows returned
  // by `Row_Detector.detect` SHALL be strictly monotonically increasing.
  //
  // The detector advances a single cursor `i` through the source lines and
  // sets each emitted row's `lineIndex` to the index of the FIRST source
  // line that contributed to that row. After emitting a row (whether a
  // self-contained lab row, a merged multi-line row, or an ambiguous line)
  // the cursor moves to a strictly greater index — so by construction the
  // sequence of `lineIndex` values must be strictly monotonically
  // increasing. This property pins that contract regardless of which mix
  // of lab rows, headers, prose, blank lines, page markers, merges, or
  // ambiguous lines the input contains.
  //
  // Generator design: we build the input by joining 0–30 randomly chosen
  // single-line fragments with `\n`. Each fragment is drawn from a curated
  // set covering every classification path the detector exercises:
  //
  //   - complete lab rows (Case A in detect)
  //   - test-name-only lines (Case B; trigger merge attempts)
  //   - value/range continuation lines (consumed during merges)
  //   - blank, separator, page-marker lines (skipped non-data)
  //   - section-header-shaped lines (skipped or merge boundary)
  //   - method/note prefix lines and disclaimer lines (skipped non-data)
  //   - ambiguous lines (value token but no unit/range/flag) (Case C)
  //   - arbitrary printable strings with newlines stripped (fuzz)
  //
  // No fragment contains a `\n` character, so each fragment maps to
  // exactly one source line in the joined input. This keeps the property
  // assertion (`lineIndex` strictly increases) directly meaningful: every
  // emitted row's `lineIndex` corresponds to a unique fragment position.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'returns rows whose lineIndex values are strictly monotonically increasing',
    () => {
      // ── Single-line fragment generators (no embedded newlines) ───────────

      // Complete lab rows — exercise Case A (self-contained lab line).
      const labLineArb = fc.constantFrom(
        'HEMOGLOBIN 14.5 g/dL 13.0-17.0',
        'GLUCOSE FASTING 95 mg/dL 70-100',
        'TSH 2.34 IU/L 0.4-4.5',
        'CHOLESTEROL TOTAL 220 mg/dL H 0-200',
        '25-OH VITAMIN D (TOTAL) 32 ng/mL 30-100',
        'CREATININE 1.1 mg/dL L 0.7-1.3',
        'TRIGLYCERIDES 180 mg/dL * < 150',
      );

      // Test-name-only lines — exercise Case B (merge-from-name attempts).
      const nameOnlyArb = fc.constantFrom(
        'HEMOGLOBIN',
        'COMPLETE BLOOD COUNT',
        'SERUM CREATININE',
        'VITAMIN B12',
        'THYROID STIMULATING HORMONE',
      );

      // Value / range continuation lines — leading character is digit,
      // operator, or qualitative token, so they are recognised as
      // continuations rather than fresh rows.
      const continuationArb = fc.constantFrom(
        '14.5 g/dL 13.0-17.0',
        '95 mg/dL',
        '< 30',
        '> 200',
        'Negative',
        '197-771 pg/mL',
        '0.7-1.3',
      );

      // Skipped / boundary lines.
      const blankArb = fc.constantFrom('', '   ', '\t');
      const separatorArb = fc.constantFrom('---', '___', '====', '- - -', '_-_-_-');
      const pageMarkerArb = fc.constantFrom(
        'Page 1 of 4',
        'Page: 2 of 5',
        'page 3 of 10',
      );
      const sectionHeaderArb = fc.constantFrom(
        'BIOCHEMISTRY',
        'HEMATOLOGY',
        'IMMUNOASSAY',
        'LIVER FUNCTION TESTS',
      );
      const methodNoteArb = fc.constantFrom(
        'Method: Hexokinase',
        'Methodology: Photometric',
        'Note: Fasting recommended',
        'note: sample collected after fasting',
      );
      const disclaimerArb = fc.constantFrom(
        'This report is not a substitute for medical advice',
        'Please consult your physician for further guidance',
        'NOT A SUBSTITUTE for clinical diagnosis',
      );
      const proseArb = fc.constantFrom(
        'this is some descriptive prose about the report',
        'analysis was performed under standard conditions',
        'patient specimen reviewed before further evaluation',
      );

      // Ambiguous lines — carry a value token but lack the
      // unit/range/flag needed for a `lab` classification, so they hit
      // Case C in the detector.
      const ambiguousArb = fc.constantFrom(
        'unrelated 42',
        'TEST 100',
        'something Positive',
        'random qualitative Reactive',
      );

      // Free-form fuzz — any printable string with embedded newlines
      // stripped to keep the fragment a single source line.
      const fuzzArb = fc
        .string({ maxLength: 40 })
        .map((s) => s.replace(/[\r\n]/g, ' '));

      const lineArb = fc.oneof(
        labLineArb,
        nameOnlyArb,
        continuationArb,
        blankArb,
        separatorArb,
        pageMarkerArb,
        sectionHeaderArb,
        methodNoteArb,
        disclaimerArb,
        proseArb,
        ambiguousArb,
        fuzzArb,
      );

      // 0–30 fragments joined with `\n`. The 0-length case produces the
      // empty string, which Property 15 also covers — here it simply
      // satisfies the strictly-monotonic property vacuously.
      const cleanedTextArb = fc
        .array(lineArb, { minLength: 0, maxLength: 30 })
        .map((fragments) => fragments.join('\n'));

      fc.assert(
        fc.property(cleanedTextArb, (cleanedText) => {
          const { rows } = detect(cleanedText);
          for (let k = 1; k < rows.length; k += 1) {
            if (rows[k]!.lineIndex <= rows[k - 1]!.lineIndex) {
              return false;
            }
          }
          return true;
        }),
        { numRuns: 200 },
      );
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 14: Ambiguous classification
  // Validates: Requirements 4.5
  //
  // For any line that is neither a clear lab row (per Property 11 — i.e., a
  // value token together with at least one of unit / range / flag) nor a
  // clear non-data pattern (per Property 12 — section header, method/note
  // prefix, prose-only, or disclaimer), `Row_Detector.detect` SHALL emit a
  // row with `classification === 'ambiguous'` whose `rawText` equals the
  // source line.
  //
  // The detector's three classification paths are:
  //   - Case A: `isLabLine(line)` (value AND (unit OR range OR flag))
  //             → classification 'lab'.
  //   - Case B: `!hasValueToken && !hasUnitToken` (no data tokens at all)
  //             → attempts merge from a test-name-only line; on no
  //               continuation the line is silently skipped (header / prose).
  //   - Case C: anything else (line carries either a value token or a unit
  //             token but is not a complete lab row)
  //             → classification 'ambiguous', `rawText` set to the bare
  //               source line (no trim).
  //
  // Property 14 pins Case C: any line that carries some data signal (value
  // OR unit) but does not satisfy the lab predicate, and is not pre-empted
  // by a non-data filter (blank / separator / page-marker / method-note /
  // disclaimer), MUST surface as a single ambiguous row.
  //
  // Each generated line is fed as the entire `cleanedText` (no surrounding
  // context), so multi-line merging cannot fire. The detector therefore
  // emits exactly one row per generated line, and that row's `rawText` must
  // equal the input line verbatim.
  //
  // Generator design — two complementary strategies, each carefully
  // constrained so the generated line cannot accidentally satisfy the
  // lab-row predicate or any non-data filter:
  //
  //   Strategy 1: value-without-extras line
  //     Layout: `[<NAME tokens>] <numeric value>`
  //     - Name tokens are uppercase A-Z words (length 3-10) joined by single
  //       spaces. Uppercase-only keeps every token disjoint from the
  //       lowercase-bodied unit alternation in `UNIT_TOKEN`, ensures no
  //       digit can sneak in (so no NUMERIC_VALUE match outside the value
  //       slot), and prevents accidental matches on unit / range tokens.
  //       Tokens that would themselves register as a recognised flag
  //       (H, L, HIGH, LOW, CRITICAL, ABNORMAL) are filtered out, as are
  //       uppercase forms of qualitative-value tokens — keeping these
  //       inside the name would otherwise add a flag-token or a second
  //       value-token to the line.
  //     - The numeric value is a non-negative integer or a decimal with a
  //       single dot. No signs, no scientific notation, no embedded dashes
  //       — so the line cannot accidentally form a `lo-hi` range pattern.
  //     - Number of name tokens: 0-3. The 0-token case yields a bare value
  //       like `"42"`, which is a valid (and important) ambiguous shape.
  //
  //   Strategy 2: unit-only line
  //     Layout: a single recognised unit token alone on the line.
  //     - Drawn from a curated list — every entry matches `UNIT_TOKEN` and
  //       carries no NUMERIC_VALUE, no QUALITATIVE_VALUE, no range pattern,
  //       and no flag token. The line has a unit signal but no value
  //       signal, so `isLabLine` is false (value missing) and Case B is not
  //       taken (`hasUnitToken` is true). Case C therefore fires.
  //
  // Cross-cutting safety:
  //   - No generator inserts a `:` character, so the `Method:` /
  //     `Methodology:` / `Note:` prefix check (which is anchored on the
  //     colon) cannot fire.
  //   - No generator inserts the disclaimer keywords `not a substitute` or
  //     `consult your physician` (case-insensitive) — both phrases are
  //     lowercase multi-word, none of our uppercase name tokens / unit
  //     tokens contain them.
  //   - Generated lines contain no leading or trailing whitespace and no
  //     embedded newlines, so the line is fed as a single source line and
  //     the `rawText === line` check is unambiguous.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'emits an ambiguous row with rawText equal to the source line for value-only or unit-only lines',
    () => {
      // ── Strategy 1: value-without-extras line ────────────────────────────
      const upperLetter = fc.constantFrom(
        ...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
      );
      const nameTokenArb = fc
        .string({ unit: upperLetter, minLength: 3, maxLength: 10 })
        .filter((w) => {
          // Reject tokens that match a recognised flag word (FLAG_TOKEN
          // would then fire on the line and push it into Case A).
          if (
            w === 'H' ||
            w === 'L' ||
            w === 'HIGH' ||
            w === 'LOW' ||
            w === 'CRITICAL' ||
            w === 'ABNORMAL'
          ) {
            return false;
          }
          // Reject uppercase forms of qualitative values to keep the
          // value-token count to one (the numeric slot). Including these
          // inside the name does not break Case C in practice, but it
          // makes the generator harder to reason about.
          if (
            w === 'NEGATIVE' ||
            w === 'POSITIVE' ||
            w === 'REACTIVE' ||
            w === 'PRESENT' ||
            w === 'ABSENT'
          ) {
            return false;
          }
          return true;
        });

      // 0-3 name tokens. The 0-token case produces a bare-value line.
      const nameArb = fc
        .array(nameTokenArb, { minLength: 0, maxLength: 3 })
        .map((tokens) => tokens.join(' '));

      // Non-negative integer or decimal value. No signs, no scientific
      // notation, no dashes — none of which could be matched by the lab
      // predicate's range / flag checks.
      const numericArb = fc.oneof(
        fc.integer({ min: 0, max: 9999 }).map((n) => String(n)),
        fc
          .tuple(
            fc.integer({ min: 0, max: 999 }),
            fc.integer({ min: 1, max: 99 }),
          )
          .map(([i, d]) => `${i}.${d}`),
      );

      const valueOnlyLineArb = fc
        .tuple(nameArb, numericArb)
        .map(([name, value]) => (name.length === 0 ? value : `${name} ${value}`));

      // ── Strategy 2: unit-only line ───────────────────────────────────────
      // Curated list — each entry matches `UNIT_TOKEN` and carries no
      // numeric / qualitative / range / flag content. Verified against the
      // body alternation in `patterns.ts`: each token survives the
      // `(?<!\w)…(?!\w)` lookarounds and matches one of the listed unit
      // shapes. `mmol/L` is intentionally NOT included because the
      // `[npµu]?mol/[lL]` alternation does not admit a leading `m` (so
      // `mmol/L` would silently fall through Case B as a "test-name-only"
      // line with no continuation, producing zero rows — that is a known
      // gap in the unit-token alternation, orthogonal to this property).
      const unitOnlyLineArb = fc.constantFrom(
        'mg/dL',
        'g/dL',
        'IU/L',
        'pg/mL',
        'ng/mL',
        '%',
        'fL',
      );

      // Combined ambiguous-line generator.
      const ambiguousLineArb = fc.oneof(valueOnlyLineArb, unitOnlyLineArb);

      fc.assert(
        fc.property(ambiguousLineArb, (line) => {
          const { rows } = detect(line);
          // Property 14: exactly one row, classified ambiguous, with
          // rawText equal to the source line. The "exactly one" check is
          // a stronger pin than the property strictly demands but is
          // justified for a single-line input — Case C fires once and no
          // other classification path applies. Any deviation (silent
          // skip, lab classification, or rawText mutation) is a bug.
          return (
            rows.length === 1 &&
            rows[0]!.classification === 'ambiguous' &&
            rows[0]!.rawText === line
          );
        }),
        { numRuns: 200 },
      );
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 15: Empty input yields empty row list
  // Validates: Requirements 4.6
  //
  // For any string `s` composed entirely of whitespace characters (including
  // the empty string), `Row_Detector.detect(s).rows` SHALL be `[]` with no
  // ambiguous entries.
  //
  // The detector implements this guarantee with a top-level short-circuit:
  // when `cleanedText.length === 0` or the entire input matches
  // `WHITESPACE_ONLY_LINE` (`/^\s*$/`), it returns `{ rows: [], warnings: []
  // }` without iterating. This property pins that contract across the full
  // `\s` character class — JavaScript's `\s` covers ASCII spaces, tabs,
  // newlines, carriage returns, form feeds, vertical tabs, and Unicode
  // whitespace (e.g., U+00A0 NBSP, U+2028 line separator, U+3000
  // ideographic space). The generator below samples representative members
  // of each category, including multi-line whitespace runs, so the test
  // exercises both the empty-string edge case and the multi-line all-blank
  // edge case.
  //
  // Generator design:
  //   - Per-character unit: a small fixed alphabet of whitespace code
  //     points covering ASCII (space, tab, LF, CR, FF, VT) and a handful
  //     of Unicode whitespace characters that browsers and PDF extractors
  //     occasionally emit (NBSP, en/em quad, ideographic space, line
  //     separator). All of these match `\s` in JavaScript regex.
  //   - String length: 0 to 64. Length 0 (the empty string) is the
  //     primary edge case for Requirement 4.6 and must be exercised
  //     explicitly; longer strings exercise the multi-line case where
  //     `cleanedText.split('\n')` would yield several whitespace-only
  //     fragments. The short-circuit must catch both.
  //   - Assertion: `rows.length === 0` is sufficient to capture "no
  //     ambiguous entries" — an empty array trivially contains no entries
  //     of any classification. We also assert the same fact via
  //     `rows.every(r => r.classification !== 'ambiguous')` as a defensive
  //     redundancy: if a regression ever changed the short-circuit to
  //     emit an ambiguous row for whitespace, the second clause would
  //     also fire and produce a clearer failure signal in the
  //     counter-example output.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'returns no rows for any whitespace-only or empty input',
    () => {
      const whitespaceCharArb = fc.constantFrom(
        ' ', // U+0020 space
        '\t', // U+0009 tab
        '\n', // U+000A line feed
        '\r', // U+000D carriage return
        '\f', // U+000C form feed
        '\v', // U+000B vertical tab
        '\u00A0', // no-break space
        '\u2028', // line separator
        '\u2029', // paragraph separator
        '\u3000', // ideographic space
      );

      const whitespaceStringArb = fc.string({
        unit: whitespaceCharArb,
        minLength: 0,
        maxLength: 64,
      });

      fc.assert(
        fc.property(whitespaceStringArb, (s) => {
          const { rows } = detect(s);
          // Property 15: rows must be empty AND contain no ambiguous
          // entries. The second clause is implied by the first but is
          // checked explicitly so a regression that emits ambiguous rows
          // for whitespace input surfaces as a distinct counter-example.
          return (
            rows.length === 0 &&
            rows.every((r) => r.classification !== 'ambiguous')
          );
        }),
        { numRuns: 200 },
      );
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 16: Multi-line merging within 3-line window
  // Validates: Requirements 7.1, 7.2, 7.3, 7.4
  //
  // For any sequence of cleaned-text lines where a test-name-only line `T`
  // is followed within the 3-line merge window by a continuation line `C`
  // containing a numeric or unit token, with no blank / separator /
  // section-header / page-boundary line between them, `Row_Detector.detect`
  // SHALL emit a single logical row whose `rawText` equals `T + ' ' + C`
  // (single-space joins, Req 7.4); reference-range continuations
  // immediately following `C` SHALL be folded into the same row
  // (Req 7.2). When a boundary line interposes between `T` and `C`, no
  // merge SHALL occur and `T` SHALL NOT appear as a `'lab'` row
  // (Req 7.3); the test-name-only line is silently treated as a header /
  // prose-only line per Req 4.3.
  //
  // The detector encodes "no row at lineIndex k" structurally: when a
  // test-name-only line at source index `k` fails to find a continuation
  // within window, the merge returns `merged: false`, the line is
  // silently skipped, and no `DetectedRow` carries `lineIndex === k`. We
  // exploit this in the negative-case assertion: `rows.every(r =>
  // r.lineIndex !== 0)`. This is structurally unambiguous and avoids
  // substring-collision pitfalls (e.g., when the boundary line is itself
  // a section header that gets merged with the trailing continuation).
  //
  // Generator strategy — discriminated union over three sub-strategies,
  // each producing an input cleanedText (joined with `\n`) along with
  // the field values needed to compute the expected merged form:
  //
  //   Strategy A — Direct merge `(T, C)`: T immediately followed by C.
  //     Expectation: exactly one row at lineIndex 0, classification
  //     'lab', `rawText === T + ' ' + C`.
  //
  //   Strategy B — Range continuation `(T, C, R)`: T, C, then a
  //     reference-range continuation R. Expectation: exactly one row at
  //     lineIndex 0, classification 'lab', `rawText === T + ' ' + C +
  //     ' ' + R`.
  //
  //   Strategy C — Boundary blocks merge `(T, B, C)`: a boundary line B
  //     interposes between T and C. Expectation: no row carries
  //     `lineIndex === 0` (T was silently skipped because the merge
  //     could not cross the boundary).
  //
  // Test-name `T` generator:
  //   - 1-3 uppercase A-Z words (length 3-10 each), joined by single
  //     spaces. Uppercase-only and digit-free by construction means T
  //     cannot satisfy NUMERIC_VALUE; the absence of `/` / lowercase
  //     letters means it cannot satisfy any UNIT_TOKEN body alternation
  //     (every recognised unit shape carries either a `/`, a lowercase
  //     letter run, or `%`). T therefore enters Case B
  //     (`!hasValueToken && !hasUnitToken`) and is eligible for the
  //     test-name merge path.
  //   - Filtered to exclude tokens that match a recognised flag
  //     (`H`, `L`, `HIGH`, `LOW`, `CRITICAL`, `ABNORMAL`) or an
  //     uppercase form of a qualitative value (`NEGATIVE`, `POSITIVE`,
  //     …). Substring matches inside longer tokens (e.g.,
  //     `"HEMOPOSITIVE"`) are inert because both regexes are anchored
  //     by `\b`, which does not fire between two alphanumerics.
  //
  // Continuation `C` generator:
  //   - Layout: `<digits>[.<digits>] <unit>`. Starts with a digit
  //     (so `CONTINUATION_LEADING` fires in `startsWithValueOrOp`),
  //     carries a numeric value AND a unit token, so
  //     `isValueContinuationLine` returns true and the merge fires on
  //     the first iteration of `mergeFromTestName`.
  //   - Unit drawn from a curated list whose every entry is recognised
  //     by `UNIT_TOKEN`.
  //
  // Range continuation `R` generator (Strategy B only):
  //   - Either `lo-hi` numeric range with `lo < hi`, or one-sided
  //     comparison `< n` / `> n`. Both shapes start with a digit or
  //     comparison operator (matching `CONTINUATION_LEADING`) and
  //     match `REFERENCE_RANGE_ANY`, so `isRangeContinuationLine`
  //     returns true and `foldRangeContinuations` absorbs R into the
  //     row.
  //
  // Boundary `B` generator (Strategy C only):
  //   - One of:
  //       (a) blank / whitespace-only line (matches
  //           `WHITESPACE_ONLY_LINE` ⇒ `isBlankLine`),
  //       (b) separator-only line composed of dashes / underscores /
  //           equals signs (matches `SEPARATOR_ONLY_LINE` and is not
  //           whitespace-only ⇒ `isSeparatorLine`),
  //       (c) page-marker line `Page N of M` with optional colon
  //           (matches `PAGE_MARKER_LINE` ⇒ `isPageMarkerLine`),
  //       (d) section-header-shaped line (uppercase letter words,
  //           no digits, no unit token; matches
  //           `SECTION_HEADER_SHAPE` ⇒ `looksLikeHeaderShape`).
  //     Each of these satisfies `isMergeBoundary` in the detector and
  //     therefore stops the merge attempt at line 0.
  //
  // None of the generators introduce embedded newlines, so each
  // fragment maps to exactly one source line when joined with `\n`.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'merges test-name-only lines with adjacent value/range continuations within the 3-line window and never merges across boundaries',
    () => {
      // ── Test-name `T` generator ──────────────────────────────────────────
      const upperLetter = fc.constantFrom(
        ...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
      );
      const nameTokenArb = fc
        .string({ unit: upperLetter, minLength: 3, maxLength: 10 })
        .filter((w) => {
          // Exclude tokens that match a recognised flag word; otherwise
          // T would carry a flag token and the line, while still
          // entering Case B, would risk being interpreted as containing
          // structural data on closer inspection.
          if (
            w === 'H' ||
            w === 'L' ||
            w === 'HIGH' ||
            w === 'LOW' ||
            w === 'CRITICAL' ||
            w === 'ABNORMAL'
          ) {
            return false;
          }
          // Exclude uppercase forms of qualitative-value tokens; these
          // would make `hasValueToken(T)` true (matched by the
          // case-insensitive `QUALITATIVE_VALUE` regex) and force T out
          // of Case B.
          if (
            w === 'NEGATIVE' ||
            w === 'POSITIVE' ||
            w === 'REACTIVE' ||
            w === 'PRESENT' ||
            w === 'ABSENT'
          ) {
            return false;
          }
          return true;
        });
      const nameArb = fc
        .array(nameTokenArb, { minLength: 1, maxLength: 3 })
        .map((tokens) => tokens.join(' '));

      // ── Continuation `C` generator: `<numeric> <unit>` ───────────────────
      const numericArb = fc.oneof(
        fc.integer({ min: 0, max: 9999 }).map((n) => String(n)),
        fc
          .tuple(
            fc.integer({ min: 0, max: 999 }),
            fc.integer({ min: 1, max: 99 }),
          )
          .map(([i, d]) => `${i}.${d}`),
      );
      const unitArb = fc.constantFrom(
        'mg/dL',
        'g/dL',
        'IU/L',
        'pg/mL',
        'ng/mL',
        '%',
      );
      const continuationArb = fc
        .tuple(numericArb, unitArb)
        .map(([n, u]) => `${n} ${u}`);

      // ── Range continuation `R` generator (Strategy B) ────────────────────
      const numericRangeArb = fc
        .tuple(
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 101, max: 500 }),
        )
        .map(([lo, hi]) => `${lo}-${hi}`);
      const comparisonRangeArb = fc
        .tuple(fc.constantFrom('<', '>'), fc.integer({ min: 1, max: 999 }))
        .map(([op, n]) => `${op} ${n}`);
      const rangeContinuationArb = fc.oneof(
        numericRangeArb,
        comparisonRangeArb,
      );

      // ── Boundary `B` generator (Strategy C) ──────────────────────────────
      const blankBoundaryArb = fc.constantFrom('', '   ', '\t', '  \t  ');
      const separatorBoundaryArb = fc.constantFrom(
        '---',
        '___',
        '====',
        '- - -',
        '_-_-_-',
      );
      const pageMarkerBoundaryArb = fc.constantFrom(
        'Page 1 of 3',
        'Page : 2 of 5',
        'page 3 of 10',
        'Page 7 of 9',
      );
      const headerBoundaryArb = fc.constantFrom(
        'BIOCHEMISTRY',
        'HEMATOLOGY',
        'IMMUNOASSAY',
        'LIVER FUNCTION TESTS',
        'LIPID PROFILE',
      );
      const boundaryArb = fc.oneof(
        blankBoundaryArb,
        separatorBoundaryArb,
        pageMarkerBoundaryArb,
        headerBoundaryArb,
      );

      // ── Strategy A: direct merge T, C ────────────────────────────────────
      const strategyA = fc.tuple(nameArb, continuationArb).map(([t, c]) => ({
        kind: 'A' as const,
        input: `${t}\n${c}`,
        t,
        c,
      }));

      // ── Strategy B: range continuation T, C, R ───────────────────────────
      const strategyB = fc
        .tuple(nameArb, continuationArb, rangeContinuationArb)
        .map(([t, c, r]) => ({
          kind: 'B' as const,
          input: `${t}\n${c}\n${r}`,
          t,
          c,
          r,
        }));

      // ── Strategy C: boundary blocks merge T, B, C ────────────────────────
      const strategyC = fc
        .tuple(nameArb, boundaryArb, continuationArb)
        .map(([t, b, c]) => ({
          kind: 'C' as const,
          input: `${t}\n${b}\n${c}`,
          t,
          b,
          c,
        }));

      const caseArb = fc.oneof(strategyA, strategyB, strategyC);

      fc.assert(
        fc.property(caseArb, (testCase) => {
          const { rows } = detect(testCase.input);

          if (testCase.kind === 'A') {
            // Property 16, positive (immediate merge): the detector
            // must emit exactly one row, originating at source line 0,
            // classified `lab`, with rawText equal to the single-space
            // join of T and C. The "exactly one row" check is stronger
            // than the property strictly requires, but is justified
            // because the input is a single test-name-only line plus a
            // single self-contained continuation; any extra row
            // indicates a merge or classification bug.
            return (
              rows.length === 1 &&
              rows[0]!.lineIndex === 0 &&
              rows[0]!.classification === 'lab' &&
              rows[0]!.rawText === `${testCase.t} ${testCase.c}`
            );
          }

          if (testCase.kind === 'B') {
            // Property 16, positive (with range continuation): exactly
            // one row, lineIndex 0, classification 'lab', rawText
            // equal to T + ' ' + C + ' ' + R. The fold-in is performed
            // by `foldRangeContinuations` immediately after the value
            // line is consumed, so the row absorbs all three source
            // lines into a single fragment list.
            return (
              rows.length === 1 &&
              rows[0]!.lineIndex === 0 &&
              rows[0]!.classification === 'lab' &&
              rows[0]!.rawText ===
                `${testCase.t} ${testCase.c} ${testCase.r}`
            );
          }

          // Property 16, negative (boundary blocks merge): no row may
          // originate at source line 0, because a boundary at line 1
          // forced `mergeFromTestName(0)` to return `merged: false`,
          // which silently drops T (Req 4.3). Other rows may still be
          // emitted further down (e.g., when B is itself a section
          // header that subsequently merges with C), but none can
          // carry `lineIndex === 0` — that would mean the merge
          // crossed the boundary, violating Req 7.3.
          return rows.every((r) => r.lineIndex !== 0);
        }),
        { numRuns: 200 },
      );
    },
  );
});
