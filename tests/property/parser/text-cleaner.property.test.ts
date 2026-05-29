/**
 * tests/property/parser/text-cleaner.property.test.ts
 *
 * Property-based tests for the Phase 2 Text_Cleaner
 * (`src/lib/parser/text-cleaner.ts`).
 *
 * Each `it(...)` block corresponds to one numbered property from the
 * design document; tests are added incrementally as their tasks are
 * implemented.
 *
 * Feature: pdf-text-structuring
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { clean } from '../../../src/lib/parser/text-cleaner.js';
import {
  NUMERIC_VALUE,
  PAGE_MARKER_LINE,
  SECTION_HEADER_SHAPE,
  SEPARATOR_ONLY_LINE,
  UNIT_TOKEN,
  WHITESPACE_ONLY_LINE,
} from '../../../src/lib/parser/patterns.js';

/**
 * Local mirror of the (un-exported) `LAB_KEYWORD` regex used by
 * `text-cleaner.ts` to identify the leading line of a repeated lab/address
 * block. The Property 9 generator excludes any candidate header whose
 * trimmed body contains a lab keyword, so the cleaner's dedup pass cannot
 * remove repeated headers — that behaviour is governed by Requirement 3.1
 * and is out of scope for the section-header preservation property.
 */
const LAB_KEYWORD =
  /\b(?:THYROCARE|METROPOLIS|SRL|REDCLIFFE|HEALTHIANS|HEALTHCARE|DIAGNOSTICS?|LABORATOR(?:Y|IES)|PATHOLOGY|PATHLABS?|MEDICAL\s+LAB)\b/i;

describe('Text_Cleaner — property tests', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 8: Cleaner removes noise without
  // removing data lines
  // Validates: Requirements 3.1, 3.2, 3.3, 3.4
  //
  // For any cleaned-text input, the output of `Text_Cleaner.clean` SHALL
  // contain:
  //   (a) no lines matching `/^Page\s*:?\s*\d+\s+of\s+\d+$/i`,
  //   (b) no whitespace-only lines,
  //   (c) no separator-only lines (composed entirely of `-`, `_`, `=`, or
  //       whitespace),
  //   (d) at most one occurrence of any contiguous repeated lab/address
  //       block;
  // AND any line containing a numeric value token or a unit token SHALL be
  // preserved in the output even when it partially matches a footer pattern.
  //
  // The generator below composes a sequence of "tagged" lines where each
  // tag records whether the property-level contract requires the line to be
  // preserved in the output. Tagged categories:
  //
  //   - page marker          → no preservation claim (input only exists to
  //                             exercise sub-claim (a))
  //   - whitespace-only      → no preservation claim (sub-claim (b))
  //   - separator-only       → no preservation claim (sub-claim (c))
  //   - footer w/o data      → no preservation claim (cleaner is allowed to
  //                             remove these; not part of Property 8's
  //                             preservation rule)
  //   - footer WITH data     → MUST be preserved (Req 3.3 — partial-match
  //                             of a footer pattern is overridden by the
  //                             presence of a numeric/unit token)
  //   - plain data line      → MUST be preserved (no removal rule applies)
  //   - section header line  → MUST be preserved (Req 3.5; never removed
  //                             by per-line noise filters)
  //
  // To exercise sub-claim (d), the input is optionally augmented with a
  // contiguous lab/address block that repeats verbatim. The block lines
  // are deliberately chosen so they (i) start with a recognised lab
  // keyword (so the cleaner's dedup logic engages) and (ii) do not match
  // any of the categories above (so the line-level filters never remove
  // them, leaving the dedup pass as the sole removal mechanism).
  //
  // Constants used as data/header/footer/lab-block sources never contain
  // a lab keyword unless they are intentional lab-block lines, so the
  // detector cannot accidentally treat random middle/prefix/suffix lines
  // as additional repeated blocks.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'Property 8: removes page markers, whitespace and separator lines, and dedupes repeated lab blocks while preserving data and header lines',
    () => {
      // ── Single-line generators ───────────────────────────────────────────

      // Page-marker line: matches PAGE_MARKER_LINE both with and without
      // the optional colon variant.
      const pageMarkerArb = fc
        .tuple(
          fc.integer({ min: 1, max: 99 }),
          fc.integer({ min: 1, max: 99 }),
          fc.boolean(), // include the optional ` : ` separator
        )
        .map(([n, m, withColon]) => `Page${withColon ? ' : ' : ' '}${n} of ${m}`);

      // Whitespace-only line: a (possibly empty) run of spaces and tabs.
      const whitespaceLineArb = fc
        .array(fc.constantFrom(' ', '\t'), { minLength: 0, maxLength: 12 })
        .map((arr) => arr.join(''));

      // Separator-only line: composed entirely of `-`, `_`, `=`, and
      // whitespace, with at least one actual separator character so the
      // line is non-trivially a separator (and not just whitespace, which
      // sub-claim (b) already covers).
      const separatorLineArb = fc
        .array(fc.constantFrom('-', '_', '=', ' ', '\t'), {
          minLength: 1,
          maxLength: 30,
        })
        .filter((arr) => arr.some((c) => c === '-' || c === '_' || c === '='))
        .map((arr) => arr.join(''));

      // Footer / signature / QR lines that contain NO numeric value token
      // and NO unit token. The cleaner is allowed (and expected) to remove
      // these, but Property 8 makes no preservation claim about them.
      const footerNoDataArb = fc.constantFrom(
        'Dr. Foo Bar',
        'Dr Smith Singh',
        'Doctor John',
        'Pathologist',
        'Microbiologist',
        'Biochemist',
        'Consultant Pathologist',
        'Verified by Reviewer',
        'Reported by Lab',
        'Approved by Authority',
        'Authorised Signatory',
        'Scan the QR code below',
        'QR Code',
        'Barcode label',
        'End of Report',
      );

      // Footer-pattern lines that ALSO contain a numeric value or unit
      // token. Per Req 3.3, these must NOT be removed even though they
      // partially match a footer pattern.
      const footerWithDataArb = fc.constantFrom(
        'Dr. Foo Bar 14.5 mg/dL',
        'Pathologist Reading 100 IU/L',
        'Verified Range 0-200 mg/dL',
        'Microbiologist 25 ng/mL',
        'Reported value 5.5 g/dL',
      );

      // Plain Thyrocare-style data lines — none match any noise pattern
      // and none start with a lab keyword, so they always survive cleaning.
      const dataLineArb = fc.constantFrom(
        'HEMOGLOBIN 14.5 g/dL',
        'GLUCOSE 90 mg/dL',
        'CHOLESTEROL 180 mg/dL',
        'TSH 2.5 mIU/L',
        'VITAMIN D 30 ng/mL',
        'CALCIUM 9.5 mg/dL 8.5-10.5',
      );

      // Section-header lines — recognised by the cleaner's `isSectionHeader`
      // predicate, so they bypass every per-line noise filter. None of
      // these contain a recognised lab keyword, so they cannot be removed
      // by the dedup pass either.
      const sectionHeaderArb = fc.constantFrom(
        'HEMOGRAM',
        'LIPID PROFILE',
        'VITAMINS',
        'COMPLETE BLOOD COUNT',
        'Liver Function Test',
        'Renal Function',
      );

      type Tagged = { text: string; preserved: boolean };

      const taggedLineArb: fc.Arbitrary<Tagged> = fc.oneof(
        pageMarkerArb.map((text) => ({ text, preserved: false })),
        whitespaceLineArb.map((text) => ({ text, preserved: false })),
        separatorLineArb.map((text) => ({ text, preserved: false })),
        footerNoDataArb.map((text) => ({ text, preserved: false })),
        footerWithDataArb.map((text) => ({ text, preserved: true })),
        dataLineArb.map((text) => ({ text, preserved: true })),
        sectionHeaderArb.map((text) => ({ text, preserved: true })),
      );

      // ── Lab/address block (optional, exercises sub-claim (d)) ────────────

      // Each block starts with a line containing a recognised lab keyword
      // (`Thyrocare`, `Metropolis`, `Diagnostics`, `Healthcare`, `SRL`),
      // so the cleaner's `detectRepeatedLabBlock` will identify it. Block
      // lengths are in the 2-3 range, comfortably inside the cleaner's
      // 2-5-line detection window.
      const labBlockArb: fc.Arbitrary<readonly string[]> = fc.constantFrom(
        ['Thyrocare Technologies Ltd', 'D-37 TTC MIDC, Turbhe', 'Navi Mumbai 400703'],
        ['Metropolis Healthcare Diagnostics', '250 D Udyog Bhavan', 'Mumbai 400025'],
        ['SRL Diagnostics', '13 New Delhi 110001'],
      );

      // Composite input spec: a prefix sequence, an optional repeated
      // lab block sandwiched around a small middle, and a suffix sequence.
      // When the optional block triple is present, sub-claim (d) is
      // exercised; when absent, the input is a flat tagged-line stream.
      const inputSpecArb = fc
        .tuple(
          fc.array(taggedLineArb, { minLength: 0, maxLength: 10 }),
          fc.option(
            fc.tuple(
              labBlockArb,
              fc.array(taggedLineArb, { minLength: 0, maxLength: 5 }),
            ),
            { nil: undefined },
          ),
          fc.array(taggedLineArb, { minLength: 0, maxLength: 10 }),
        )
        .map(([prefix, repeated, suffix]) => {
          const lines: string[] = [];
          const preserveLines: string[] = [];
          let repeatedBlock: readonly string[] | undefined;

          const append = (t: Tagged) => {
            lines.push(t.text);
            if (t.preserved) preserveLines.push(t.text);
          };

          for (const t of prefix) append(t);
          if (repeated !== undefined) {
            const [block, middle] = repeated;
            repeatedBlock = block;
            for (const b of block) lines.push(b);
            for (const t of middle) append(t);
            for (const b of block) lines.push(b);
          }
          for (const t of suffix) append(t);

          return { lines, preserveLines, repeatedBlock };
        });

      // ── Property assertion ───────────────────────────────────────────────
      fc.assert(
        fc.property(inputSpecArb, ({ lines, preserveLines, repeatedBlock }) => {
          const input = lines.join('\n');
          const output = clean(input);
          // `''.split('\n')` returns `['']`, which would spuriously fail the
          // whitespace-only check; treat empty output as an empty list.
          const outputLines = output === '' ? [] : output.split('\n');

          // (a) No page-marker lines remain (Req 3.2).
          for (const l of outputLines) {
            if (PAGE_MARKER_LINE.test(l.trim())) return false;
          }

          // (b) No whitespace-only lines remain (Req 3.4, first half).
          for (const l of outputLines) {
            if (WHITESPACE_ONLY_LINE.test(l)) return false;
          }

          // (c) No separator-only lines remain (Req 3.4, second half) —
          //     composed entirely of `-`, `_`, `=`, and whitespace, with
          //     at least one actual separator character. Pure whitespace
          //     is already covered by sub-claim (b).
          for (const l of outputLines) {
            if (/^[\s\-_=]*$/.test(l) && /[-_=]/.test(l)) return false;
          }

          // (d) At most one contiguous occurrence of the repeated lab block
          //     remains (Req 3.1).
          if (repeatedBlock !== undefined && repeatedBlock.length > 0) {
            let occurrences = 0;
            for (
              let i = 0;
              i + repeatedBlock.length <= outputLines.length;
              i++
            ) {
              let matched = true;
              for (let j = 0; j < repeatedBlock.length; j++) {
                if (outputLines[i + j] !== repeatedBlock[j]) {
                  matched = false;
                  break;
                }
              }
              if (matched) occurrences++;
            }
            if (occurrences > 1) return false;
          }

          // Preservation rule: every line tagged `preserved` (data lines,
          // footer-with-data lines, section headers) must appear in the
          // output. This covers Req 3.3 (partial-footer-match preservation
          // when a numeric/unit token is present) and the implicit
          // preservation of plain data lines and section headers.
          for (const line of preserveLines) {
            if (!outputLines.includes(line)) return false;
          }

          return true;
        }),
        { numRuns: 200 },
      );
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 9: Section headers are preserved
  // verbatim by the cleaner
  // Validates: Requirements 3.5
  //
  // For any line that is all-uppercase or title-case and contains neither a
  // numeric value token nor a unit token, the line SHALL appear in
  // `Text_Cleaner.clean(input)` exactly as in `input` (no whitespace
  // trimming, no case conversion).
  //
  // The generator constructs candidate header bodies that match the
  // structural shape `SECTION_HEADER_SHAPE` from `patterns.ts`, then asserts
  // the resulting line satisfies the cleaner's full section-header
  // predicate (shape + no numeric token + no unit token). Each header is
  // wrapped with arbitrary unrelated context lines on either side to prove
  // that surrounding content does not influence the preservation guarantee.
  //
  // Lab keywords are explicitly excluded from header bodies so the
  // cleaner's repeated-lab-block deduplication (Req 3.1) cannot remove a
  // header — that behaviour is governed by a different requirement and is
  // out of scope for Property 9.
  //
  // Whitespace prefix/suffix on the header line is intentional: the
  // section-header predicate trims before shape-matching but the cleaner
  // must still preserve the original line verbatim — including any leading
  // or trailing whitespace — when the line qualifies as a header. The
  // generator therefore varies the surrounding whitespace and asserts
  // exact-string membership in the cleaner's output.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'Property 9: section headers (all-uppercase or title-case, no numeric/unit tokens) are preserved verbatim by the cleaner',
    () => {
      // ── Header-body generators ───────────────────────────────────────────

      // Words built from upper / lower-case ASCII letters only, kept short
      // to avoid combinatorial blow-up. Word length is at least 2 so a
      // single stray letter (which would still be all-uppercase and pass
      // the shape) never collides with the recognised flag tokens
      // `H` / `L` / `*` matched by other parser sub-modules.
      const upperWordArb = fc
        .stringMatching(/^[A-Z]{2,8}$/);
      const titleWordArb = fc
        .stringMatching(/^[A-Z][a-z]{1,7}$/);

      // All-uppercase shape: `[A-Z0-9][A-Z0-9 \-&/()]*`. The leading
      // character is a letter (not a digit) because a single lone digit
      // would also be a numeric token and disqualify the line under the
      // cleaner's compound predicate. Subsequent characters are drawn
      // from the shape's permitted alphabet but exclude bare digits, so
      // the line never contains a numeric value token.
      const upperHeaderArb = fc
        .array(upperWordArb, { minLength: 1, maxLength: 5 })
        .chain((words) =>
          fc
            .array(fc.constantFrom(' ', '-', '&', '/', '(', ')'), {
              minLength: words.length - 1,
              maxLength: words.length - 1,
            })
            .map((seps) => {
              let out = words[0]!;
              for (let i = 1; i < words.length; i++) {
                out += seps[i - 1]! + words[i]!;
              }
              return out;
            }),
        );

      // Title-case shape: `[A-Z][a-z]+(?:[ \-&/()][A-Z][a-z]+)*`. Each
      // word is `Capitalised` and joined by one of the shape's permitted
      // separators.
      const titleHeaderArb = fc
        .array(titleWordArb, { minLength: 1, maxLength: 5 })
        .chain((words) =>
          fc
            .array(fc.constantFrom(' ', '-', '&', '/', '(', ')'), {
              minLength: words.length - 1,
              maxLength: words.length - 1,
            })
            .map((seps) => {
              let out = words[0]!;
              for (let i = 1; i < words.length; i++) {
                out += seps[i - 1]! + words[i]!;
              }
              return out;
            }),
        );

      // Optional leading / trailing whitespace, drawn from spaces and
      // tabs. Length up to 4 keeps inputs small while still exercising
      // the "preserve verbatim, including outer whitespace" guarantee.
      const surroundingWhitespaceArb = fc
        .array(fc.constantFrom(' ', '\t'), { minLength: 0, maxLength: 4 })
        .map((arr) => arr.join(''));

      // A candidate header line: a body that matches the shape regex,
      // optionally padded with leading and trailing whitespace, that
      // additionally satisfies the cleaner's full predicate (shape match
      // on the trimmed body, no numeric token, no unit token, no lab
      // keyword that would trigger dedup).
      const headerLineArb = fc
        .tuple(
          surroundingWhitespaceArb,
          fc.oneof(upperHeaderArb, titleHeaderArb),
          surroundingWhitespaceArb,
        )
        .map(([lead, body, trail]) => `${lead}${body}${trail}`)
        .filter((line) => {
          const trimmed = line.trim();
          if (trimmed.length === 0) return false;
          if (NUMERIC_VALUE.test(trimmed)) return false;
          if (UNIT_TOKEN.test(trimmed)) return false;
          if (!SECTION_HEADER_SHAPE.test(trimmed)) return false;
          // Exclude lab keywords so the dedup pass (Req 3.1) cannot
          // touch the header even when the surrounding context happens
          // to repeat it.
          if (LAB_KEYWORD.test(line)) return false;
          // Exclude lines that are also full-line page markers,
          // separator-only, or whitespace-only — those are caught by
          // earlier filters and are not the subject of this property.
          if (PAGE_MARKER_LINE.test(trimmed)) return false;
          if (SEPARATOR_ONLY_LINE.test(line)) return false;
          if (WHITESPACE_ONLY_LINE.test(line)) return false;
          return true;
        });

      // ── Surrounding-context generator ────────────────────────────────────

      // Plain unrelated text lines used to wrap the header. None match
      // the section-header shape, none contain a lab keyword, and none
      // match a footer pattern — so the cleaner's per-line filters and
      // dedup pass leave them as-is. Their only role is to demonstrate
      // that the preservation guarantee for headers is independent of
      // surrounding content.
      const contextLineArb = fc.constantFrom(
        'HEMOGLOBIN 14.5 g/dL',
        'GLUCOSE 90 mg/dL',
        'CHOLESTEROL 180 mg/dL',
        'TSH 2.5 mIU/L',
        'VITAMIN D 30 ng/mL',
        'CALCIUM 9.5 mg/dL 8.5-10.5',
        'Patient name : Jane Doe',
        'Sample collected at clinic',
      );

      // Composite spec: a prefix block, the header line under test, and
      // a suffix block. The header is positioned at a known index so the
      // assertion can locate it precisely in the cleaner's output.
      const inputSpecArb = fc.tuple(
        fc.array(contextLineArb, { minLength: 0, maxLength: 6 }),
        headerLineArb,
        fc.array(contextLineArb, { minLength: 0, maxLength: 6 }),
      );

      // ── Property assertion ───────────────────────────────────────────────
      fc.assert(
        fc.property(inputSpecArb, ([prefix, header, suffix]) => {
          const lines = [...prefix, header, ...suffix];
          const input = lines.join('\n');
          const output = clean(input);
          const outputLines = output === '' ? [] : output.split('\n');

          // The header line must appear in the output exactly as it did
          // in the input — no whitespace trimming, no case conversion,
          // no substring rewriting. Strict equality on a full output
          // line is the cleanest way to encode "verbatim preservation".
          return outputLines.includes(header);
        }),
        { numRuns: 200 },
      );
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 10: Text_Cleaner is deterministic
  // and pure
  // Validates: Requirements 3.6
  //
  // For any input string `s`, `clean(s) === clean(s)` (referential
  // transparency) and `clean` SHALL not perform any I/O, time-dependent, or
  // random operation.
  //
  // Referential transparency is the directly testable face of this contract:
  // repeated invocations on the same input must produce the same output, and
  // the input string itself must not be mutated by the call. The absence of
  // I/O / time / random operations is enforced structurally by the
  // implementation (no `Date`, `Math.random`, or filesystem usage); the
  // property test asserts the observable consequence of that structural
  // guarantee — namely, that the function is a deterministic transformation
  // from input string to output string.
  //
  // The generator is intentionally broad so the property exercises every
  // code path inside `clean`:
  //
  //   - Arbitrary unicode-ish strings (with embedded newlines stripped so
  //     the line count of each fragment is well-defined) drive the
  //     "fuzz any input" half of the contract.
  //   - A curated mix of lines that are known to trigger specific cleaner
  //     branches (page markers, separator-only / whitespace-only lines,
  //     footer-with-data and footer-without-data lines, section headers,
  //     plain data rows, and lab-block lines that engage the dedup pass)
  //     drives the "every branch is deterministic" half of the contract.
  //
  // The two arbitraries are mixed via `fc.oneof`, then assembled into a
  // multi-line input by joining with `\n`. The input length is bounded
  // (≤ 25 lines, ≤ 80 chars per arbitrary line) to keep individual runs
  // fast while still producing meaningful cross-branch coverage.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'Property 10: clean is deterministic and pure — repeated invocations on the same input produce the same output, and the input is not mutated',
    () => {
      // ── Single-line generators ───────────────────────────────────────────

      // Arbitrary strings up to 80 chars, with any embedded `\n` stripped
      // so a single arbitrary draw represents exactly one line. The full
      // newline structure of the input is governed by the array join below.
      const arbitraryLineArb = fc
        .string({ minLength: 0, maxLength: 80 })
        .map((s) => s.replace(/\n/g, ' '));

      // Curated lines that are known to trigger specific cleaner branches.
      // Each entry maps to one of:
      //   - page-marker filter (Req 3.2)
      //   - whitespace-only / separator-only filter (Req 3.4)
      //   - footer-without-data filter (Req 3.3, removable)
      //   - footer-with-data preservation (Req 3.3, preserved)
      //   - section-header preservation (Req 3.5)
      //   - plain data line (no removal rule applies)
      //   - lab-block line (engages dedup pass — Req 3.1)
      const branchedLineArb = fc.constantFrom(
        // page markers
        'Page : 1 of 3',
        'Page 2 of 5',
        'PAGE 7 OF 10',
        // whitespace-only / separator-only
        '',
        '   ',
        '\t  \t',
        '----',
        '___===',
        '- - = _',
        // footers without data
        'Dr. Foo Bar',
        'Pathologist',
        'Consultant Microbiologist',
        'Verified by Reviewer',
        'Scan the QR code below',
        'End of Report',
        // footers WITH data (must be preserved)
        'Dr. Smith 14.5 mg/dL',
        'Verified Range 0-200 mg/dL',
        // plain data rows
        'HEMOGLOBIN 14.5 g/dL',
        'GLUCOSE 90 mg/dL',
        'TSH 2.5 mIU/L',
        'CALCIUM 9.5 mg/dL 8.5-10.5',
        // section headers
        'HEMOGRAM',
        'LIPID PROFILE',
        'Liver Function Test',
        // lab/address block lines (engage dedup)
        'Thyrocare Technologies Ltd',
        'D-37 TTC MIDC, Turbhe',
        'Navi Mumbai 400703',
        'Metropolis Healthcare Diagnostics',
        '250 D Udyog Bhavan',
        'SRL Diagnostics',
      );

      const lineArb = fc.oneof(arbitraryLineArb, branchedLineArb);

      const inputArb = fc
        .array(lineArb, { minLength: 0, maxLength: 25 })
        .map((lines) => lines.join('\n'));

      // ── Property assertion ───────────────────────────────────────────────
      fc.assert(
        fc.property(inputArb, (input) => {
          // Referential transparency — three independent invocations on the
          // same input must all produce the exact same output. Three calls
          // (rather than two) catches any "first-call vs steady-state"
          // memoisation bug as well as the simpler "result depends on call
          // count" failure mode.
          const first = clean(input);
          const second = clean(input);
          const third = clean(input);
          if (first !== second) return false;
          if (second !== third) return false;

          // Input non-mutation — JavaScript strings are immutable
          // primitives, so this check is structural rather than runtime
          // (it guards against any future change that swaps `input` for a
          // mutable carrier such as a `string[]` or `Buffer`). Capturing
          // the snapshot before the additional call documents intent.
          const inputSnapshot = input;
          clean(input);
          if (input !== inputSnapshot) return false;

          // Equivalent-but-distinct input strings must yield equal output —
          // this catches any accidental reliance on string identity (e.g.,
          // a `WeakMap`-based cache keyed by reference). `String(input)`
          // and `input.slice()` both produce a value-equal string that is
          // not guaranteed to be reference-identical to `input`.
          const aliased = `${input}`;
          if (clean(aliased) !== first) return false;

          return true;
        }),
        { numRuns: 200 },
      );
    },
  );
});
