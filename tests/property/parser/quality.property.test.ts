/**
 * tests/property/parser/quality.property.test.ts
 *
 * Property-based tests for the Phase 2 Quality Aggregator
 * (`src/lib/parser/quality.ts`).
 *
 * Each `it(...)` block corresponds to one numbered property from the
 * design document; tests are added incrementally as their tasks are
 * implemented.
 *
 * Feature: pdf-text-structuring
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { build, type QualityCounts } from '../../../src/lib/parser/quality.js';
import type { ReportMetadata } from '../../../src/lib/types/index.js';

describe('Quality Aggregator — property tests', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 25: Quality count invariant
  // Validates: Requirements 9.2, 9.4
  //
  // For any `ExtractionQuality` produced by `build` from a `QualityCounts`
  // input that satisfies the call-site precondition (all four counts are
  // non-negative integers and `successfullyParsed + uncertainRows ≤
  // totalRowsDetected`), the returned object SHALL satisfy:
  //
  //   1. successfullyParsed + uncertainRows ≤ totalRowsDetected   (Req 9.2)
  //   2. all four counts are non-negative integers               (Req 9.2)
  //   3. confidence === totalRowsDetected === 0
  //                       ? 0
  //                       : successfullyParsed / totalRowsDetected (Req 9.4)
  //   4. confidence ∈ [0, 1]                                      (Req 9.4)
  //
  // The property is checked only on inputs that satisfy the invariant;
  // violating inputs are a separate contract (`build` throws), exercised
  // by unit tests rather than this property.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'preserves the count invariant and computes confidence as the parsed/detected ratio in [0, 1]',
    () => {
      // Generate four non-negative integers (totalRowsDetected, successfullyParsed,
      // uncertainRows, skippedRows) such that the structural invariant holds.
      // We sample three independent slot sizes (parsed / uncertain / leftover)
      // so that totalRowsDetected = parsed + uncertain + leftover is always
      // ≥ parsed + uncertain by construction. `skippedRows` is independent of
      // the invariant (the design only constrains the parsed-vs-detected sum)
      // so it is generated independently.
      const countsArb = fc
        .tuple(
          fc.nat({ max: 1_000 }), // successfullyParsed
          fc.nat({ max: 1_000 }), // uncertainRows
          fc.nat({ max: 1_000 }), // leftover ambiguous/unaccounted slots
          fc.nat({ max: 1_000 }), // skippedRows (independent)
        )
        .map(
          ([successfullyParsed, uncertainRows, leftover, skippedRows]): QualityCounts => ({
            totalRowsDetected: successfullyParsed + uncertainRows + leftover,
            successfullyParsed,
            uncertainRows,
            skippedRows,
          }),
        );

      // Structural strings that the aggregator copies into the result. The
      // content is irrelevant to Property 25; an empty pair keeps the
      // generator focused on the count/confidence invariant.
      const structuralStringsArb = fc.array(
        fc.string({ minLength: 0, maxLength: 40 }),
        { minLength: 0, maxLength: 5 },
      );

      fc.assert(
        fc.property(
          countsArb,
          structuralStringsArb,
          structuralStringsArb,
          fc.boolean(),
          fc.boolean(),
          (counts, ambiguousLines, warnings, lowConfidence, validationFailed) => {
            const quality = build(
              counts,
              ambiguousLines,
              warnings,
              lowConfidence,
              validationFailed,
            );

            // ── 1. Structural count invariant (Req 9.2) ─────────────────────
            if (
              quality.successfullyParsed + quality.uncertainRows >
              quality.totalRowsDetected
            ) {
              return false;
            }

            // ── 2. All four counts are non-negative integers (Req 9.2) ──────
            for (const n of [
              quality.totalRowsDetected,
              quality.successfullyParsed,
              quality.uncertainRows,
              quality.skippedRows,
            ]) {
              if (!Number.isInteger(n) || n < 0) return false;
            }

            // ── 3. Confidence formula (Req 9.4) ─────────────────────────────
            //
            // `build` defines confidence as the same expression on the
            // right-hand side, so structural equality (===) is exact for
            // every input — there is no floating-point rounding gap to
            // tolerate.
            const expectedConfidence =
              quality.totalRowsDetected === 0
                ? 0
                : quality.successfullyParsed / quality.totalRowsDetected;
            if (quality.confidence !== expectedConfidence) return false;

            // ── 4. Confidence range (Req 9.4) ───────────────────────────────
            if (
              !Number.isFinite(quality.confidence) ||
              quality.confidence < 0 ||
              quality.confidence > 1
            ) {
              return false;
            }

            return true;
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 26: No patient data leaks into
  //   quality strings
  // Validates: Requirements 9.6
  //
  // For any `ReportMetadata` produced upstream and any `warnings` /
  // `ambiguousLines` arrays passed into `build` — even when those arrays
  // intentionally embed every patient-identifiable token from the metadata
  // (simulating an upstream leak that the defensive scrub is designed to
  // catch) — none of the metadata-derived "forbidden" substrings SHALL
  // appear as a substring of any element of `extractionQuality.warnings` or
  // `extractionQuality.ambiguousLines` in the returned object.
  //
  // The scrub-eligible tokens are exactly those used by `quality.ts` itself:
  // every value of `patientName`, `patientAge`, `reportDate`, `sampleDate`,
  // `labName`, and `reportId`, after `String(...).trim()`, that is at least
  // three characters long. Tokens shorter than three characters are
  // intentionally NOT scrubbed by the implementation (single-character
  // values like `patientGender ∈ {M,F,O}` would over-redact unrelated text)
  // and are therefore excluded from the property's "forbidden" set. This
  // mirrors the `MIN_SCRUB_TOKEN_LENGTH` contract documented in
  // `src/lib/parser/quality.ts`.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'never leaks any metadata-derived patient token (≥3 chars) into warnings or ambiguousLines',
    () => {
      // Counts are irrelevant to Property 26; supply any quadruple satisfying
      // the structural invariant so `build` does not throw and the focus
      // stays on the scrub.
      const countsArb = fc
        .tuple(fc.nat({ max: 50 }), fc.nat({ max: 50 }), fc.nat({ max: 50 }), fc.nat({ max: 50 }))
        .map(
          ([successfullyParsed, uncertainRows, leftover, skippedRows]): QualityCounts => ({
            totalRowsDetected: successfullyParsed + uncertainRows + leftover,
            successfullyParsed,
            uncertainRows,
            skippedRows,
          }),
        );

      // Token generator: short, printable, non-empty strings drawn from a
      // mixed alphabet so generated tokens look like realistic PII fragments
      // (names, IDs, lab names, dates). Length 1-20 covers both
      // sub-threshold values (length 1-2, NOT scrubbed by the implementation)
      // and scrub-eligible values (length ≥3).
      const arbTokenString = fc
        .stringMatching(/^[A-Za-z0-9\-/ .]{1,20}$/)
        .filter((s) => s.trim().length > 0);

      // Each metadata field is independently optional. `patientAge` is a
      // number in `ReportMetadata`, so it is generated as a number; the
      // rest are optional strings. `patientGender` is intentionally omitted
      // here because single-letter values are below the scrub threshold and
      // the property does not assert anything about them.
      const arbMetadata: fc.Arbitrary<ReportMetadata> = fc
        .record(
          {
            patientName: fc.option(arbTokenString, { nil: undefined }),
            patientAge: fc.option(fc.nat({ max: 120 }), { nil: undefined }),
            reportDate: fc.option(arbTokenString, { nil: undefined }),
            sampleDate: fc.option(arbTokenString, { nil: undefined }),
            labName: fc.option(arbTokenString, { nil: undefined }),
            reportId: fc.option(arbTokenString, { nil: undefined }),
          },
          { requiredKeys: [] },
        )
        .map((m) => m as ReportMetadata);

      // Compute the set of forbidden tokens exactly as `quality.ts` does:
      // stringify, trim, drop entries shorter than 3 chars. This is the
      // ground-truth set of substrings that MUST NOT appear in the output.
      const forbiddenFrom = (metadata: ReportMetadata): string[] => {
        const tokens: string[] = [];
        const candidates: Array<string | number | undefined> = [
          metadata.patientName,
          metadata.patientAge,
          metadata.reportDate,
          metadata.sampleDate,
          metadata.labName,
          metadata.reportId,
        ];
        for (const raw of candidates) {
          if (raw === undefined) continue;
          const v = String(raw).trim();
          if (v.length < 3) continue;
          tokens.push(v);
        }
        return tokens;
      };

      // Neutral fragment generator: visible characters that may appear in
      // structural strings (`"Multi-line merge exceeded 3 lines at row 42"`,
      // raw ambiguous lines, etc.).
      const neutralFragmentArb = fc.stringMatching(/^[ A-Za-z0-9.,;:_/()\-]{0,30}$/);

      // Build a structural string that may contain any subset of the
      // forbidden tokens, interleaved with neutral fragments. This
      // simulates an upstream leak — the defensive scrub MUST remove every
      // embedded token regardless of position.
      const arbContaminatedLine = (forbidden: readonly string[]): fc.Arbitrary<string> => {
        if (forbidden.length === 0) return neutralFragmentArb;
        const tokenFragmentArb = fc.constantFrom(...forbidden);
        return fc
          .tuple(
            fc.array(neutralFragmentArb, { minLength: 1, maxLength: 4 }),
            fc.array(tokenFragmentArb, { minLength: 0, maxLength: 3 }),
          )
          .map(([neutrals, tokens]) => {
            // Interleave: neutral, token, neutral, token, ...
            const parts: string[] = [];
            const max = Math.max(neutrals.length, tokens.length);
            for (let i = 0; i < max; i++) {
              if (i < neutrals.length) parts.push(neutrals[i]);
              if (i < tokens.length) parts.push(tokens[i]);
            }
            return parts.join('');
          });
      };

      // Build a metadata-dependent arbitrary that yields contaminated
      // ambiguousLines and warnings arrays for each iteration's metadata,
      // using `.chain()` for full seedability (no `fc.sample` inside the
      // predicate).
      const arbScenario = arbMetadata.chain((metadata) => {
        const forbidden = forbiddenFrom(metadata);
        const linesArb = fc.array(arbContaminatedLine(forbidden), {
          minLength: 0,
          maxLength: 6,
        });
        return fc.tuple(
          fc.constant(metadata),
          fc.constant(forbidden),
          linesArb, // ambiguousLines
          linesArb, // warnings
        );
      });

      fc.assert(
        fc.property(
          countsArb,
          arbScenario,
          fc.boolean(),
          fc.boolean(),
          (counts, [metadata, forbidden, ambiguousLines, warnings], lowConfidence, validationFailed) => {
            const quality = build(
              counts,
              ambiguousLines,
              warnings,
              lowConfidence,
              validationFailed,
              metadata,
            );

            // Core assertion (Req 9.6): no forbidden substring appears in
            // any returned warnings/ambiguousLines entry.
            for (const token of forbidden) {
              for (const line of quality.ambiguousLines) {
                if (line.includes(token)) return false;
              }
              for (const line of quality.warnings) {
                if (line.includes(token)) return false;
              }
            }

            return true;
          },
        ),
        { numRuns: 200 },
      );
    },
  );
});
