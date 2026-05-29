/**
 * tests/property/parser/orchestrator.property.test.ts
 *
 * Property-based tests for the Phase 2 top-level parser orchestrator
 * (`src/lib/parser/orchestrator.ts`).
 *
 * Each `it(...)` block corresponds to one numbered property from the
 * design document; tests are added incrementally as their tasks are
 * implemented.
 *
 * Feature: pdf-text-structuring
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { parseRawText } from '../../../src/lib/parser/orchestrator.js';
import { validateStructuredReport } from '../../../src/lib/validator/index.js';
import type { IngestionResult, ParseOptions } from '../../../src/lib/types/index.js';

describe('Orchestrator (parseRawText) — property tests', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 1: Totality on recognised inputs
  // Validates: Requirements 1.1, 1.5, 1.6
  //
  // For any `IngestionResult` whose `extractionStatus` is one of
  // `'success'`, `'scanned_fallback'`, or `'failed'`, and whose
  // `extractedText` and `originalFilename` are strings, `parseRawText(input)`
  // SHALL return a `StructuredReport` without throwing an exception.
  //
  // The property pins down three things at once:
  //   - Req 1.1: the orchestrator accepts an `IngestionResult` with any of
  //     the three recognised statuses as its primary input.
  //   - Req 1.5: any internal error during parsing is caught and surfaced
  //     through `extractionQuality.warnings` rather than thrown.
  //   - Req 1.6: no unhandled exception escapes for any recognised status.
  //
  // To keep the property focused on totality (and not on the structural
  // contents already covered by Properties 2 / 3 / 27 / 28), each iteration
  // only verifies that:
  //   (a) the call returns without throwing, and
  //   (b) the returned value has the minimal `StructuredReport` shape:
  //       `metadata` object, `entries` array, `extractionQuality` object.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'returns a StructuredReport without throwing for any IngestionResult with a recognised extractionStatus',
    () => {
      // The three recognised extraction statuses, exactly as defined by
      // `IngestionResult` in `src/lib/types/index.ts`. Property 1 must hold
      // for every one of them (Req 1.1).
      const extractionStatusArb = fc.constantFrom<
        IngestionResult['extractionStatus']
      >('success', 'scanned_fallback', 'failed');

      // `extractedText` is a fully arbitrary string. The unicode generator
      // exercises the pipeline on noisy, multibyte inputs as well as on
      // empty strings — Property 1 only requires that no input causes an
      // unhandled throw.
      const extractedTextArb = fc.string();

      // `originalFilename` is likewise an arbitrary string. We do not
      // restrict to filename-shaped strings because Req 1.1 only constrains
      // the field's static type (`string`), not its content.
      const originalFilenameArb = fc.string();

      // `storedFilePath` is a required field on `IngestionResult` but its
      // value is irrelevant to Property 1. A constant placeholder keeps the
      // generator focused on the three fields the property cares about.
      const ingestionArb: fc.Arbitrary<IngestionResult> = fc
        .record({
          originalFilename: originalFilenameArb,
          storedFilePath: fc.constant('/tmp/placeholder.pdf'),
          extractionStatus: extractionStatusArb,
          extractedText: extractedTextArb,
        })
        .map((r) => r as IngestionResult);

      fc.assert(
        fc.property(ingestionArb, (input) => {
          // (a) The call must not throw. Any thrown exception fails the
          //     property — `fc.assert` will surface the offending counter-
          //     example automatically.
          const report = parseRawText(input);

          // (b) Minimal shape check. We deliberately do NOT assert anything
          //     about the contents of `entries` or `extractionQuality` here;
          //     those are pinned down by Properties 2, 3, 27, 28.
          if (report === null || typeof report !== 'object') return false;
          if (
            report.metadata === null ||
            typeof report.metadata !== 'object'
          ) {
            return false;
          }
          if (!Array.isArray(report.entries)) return false;
          if (
            report.extractionQuality === null ||
            typeof report.extractionQuality !== 'object'
          ) {
            return false;
          }

          return true;
        }),
        { numRuns: 200 },
      );
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 2: Failure short-circuit
  // Validates: Requirements 1.2
  //
  // For any `IngestionResult` with `extractionStatus === 'failed'`, the
  // returned `StructuredReport` SHALL have `entries.length === 0` AND
  // `extractionQuality.warnings` SHALL contain the string `"Extraction failed"`.
  //
  // The short-circuit must hold regardless of:
  //   - the contents of `extractedText` (including text that, on a non-failed
  //     status, would otherwise produce many lab rows);
  //   - the value of `originalFilename`;
  //   - the presence/absence of `extractionNotes` / `warningsOrErrors`;
  //   - any `ParseOptions` the caller passes (e.g., `keepRawText: true`).
  //
  // This property pins down the upstream-failure contract: when Phase 1
  // signals that extraction failed, Phase 2 must not attempt to parse the
  // (potentially garbage) text and must surface the failure structurally.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'short-circuits with empty entries and an "Extraction failed" warning when extractionStatus is "failed"',
    () => {
      // `extractedText` is fully arbitrary — the property must hold even
      // when the upstream extractor handed us text that *looks* parseable.
      // The point of Req 1.2 is that the orchestrator does not even try.
      const extractedTextArb = fc.string();
      const originalFilenameArb = fc.string();

      // Optional fields on `IngestionResult` are exercised so the property
      // covers the realistic shape Phase 1 can produce on failure.
      const extractionNotesArb = fc.option(fc.string(), { nil: undefined });
      const warningsOrErrorsArb = fc.option(fc.array(fc.string()), {
        nil: undefined,
      });

      // `keepRawText` is varied because the short-circuit path also has to
      // honour `ParseOptions.keepRawText` (Property 28). Property 2 itself
      // only checks entries + warnings, but we vary the option to confirm
      // the contract holds across both branches.
      const optionsArb = fc.option(
        fc.record({ keepRawText: fc.boolean() }),
        { nil: undefined },
      );

      const failedIngestionArb: fc.Arbitrary<IngestionResult> = fc
        .record(
          {
            originalFilename: originalFilenameArb,
            storedFilePath: fc.constant('/tmp/placeholder.pdf'),
            extractionStatus: fc.constant<IngestionResult['extractionStatus']>(
              'failed',
            ),
            extractedText: extractedTextArb,
            extractionNotes: extractionNotesArb,
            warningsOrErrors: warningsOrErrorsArb,
          },
          { requiredKeys: ['originalFilename', 'storedFilePath', 'extractionStatus', 'extractedText'] },
        )
        .map((r) => r as IngestionResult);

      fc.assert(
        fc.property(failedIngestionArb, optionsArb, (input, options) => {
          // The call must not throw (covered transitively by Property 1,
          // re-asserted here so a counter-example to Property 2 surfaces
          // cleanly without a separate "throws" failure mode).
          const report =
            options === undefined
              ? parseRawText(input)
              : parseRawText(input, options);

          // (1) entries must be an empty array — no parsing was attempted.
          if (!Array.isArray(report.entries)) return false;
          if (report.entries.length !== 0) return false;

          // (2) extractionQuality.warnings must contain the literal
          //     "Extraction failed" string verbatim. We check via
          //     `Array.includes` rather than substring match because the
          //     contract is an exact warning entry, not a substring.
          const warnings = report.extractionQuality?.warnings;
          if (!Array.isArray(warnings)) return false;
          if (!warnings.includes('Extraction failed')) return false;

          return true;
        }),
        { numRuns: 200 },
      );
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 3: lowConfidence reflects extractionStatus
  // Validates: Requirements 1.3, 1.4, 9.7
  //
  // For any `IngestionResult`, the returned report's
  // `extractionQuality.lowConfidence` SHALL be exactly equal to
  // `input.extractionStatus === 'scanned_fallback'`.
  //
  // The biconditional pins down all three requirement clauses at once:
  //   - Req 1.3: when status is `'scanned_fallback'`, parsing proceeds AND
  //     `lowConfidence` is `true`.
  //   - Req 1.4: when status is `'success'`, parsing proceeds AND
  //     `lowConfidence` is NOT set to `true` (i.e., it is `false`).
  //   - Req 9.7: the `lowConfidence` field is exactly the boolean
  //     `extractionStatus === 'scanned_fallback'`, also covering the
  //     `'failed'` short-circuit branch where the status is neither
  //     `'success'` nor `'scanned_fallback'` and `lowConfidence` must be
  //     `false`.
  //
  // The property must hold across all three orchestrator code paths:
  //   (a) the `'failed'` short-circuit (Req 1.2 path);
  //   (b) the normal success/scanned-fallback pipeline;
  //   (c) the catch-block path (an internal throw must still produce a
  //       report whose `lowConfidence` correctly reflects the input).
  //
  // To exercise (b) and (c) in addition to (a), `extractedText` is fully
  // arbitrary — the cleaner and downstream sub-modules will see noisy
  // unicode strings, empty strings, and accidentally-row-shaped strings,
  // which is the same input space as Property 1.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'sets extractionQuality.lowConfidence to (extractionStatus === "scanned_fallback") for any recognised input',
    () => {
      const extractionStatusArb = fc.constantFrom<
        IngestionResult['extractionStatus']
      >('success', 'scanned_fallback', 'failed');

      const ingestionArb: fc.Arbitrary<IngestionResult> = fc
        .record({
          originalFilename: fc.string(),
          storedFilePath: fc.constant('/tmp/placeholder.pdf'),
          extractionStatus: extractionStatusArb,
          extractedText: fc.string(),
        })
        .map((r) => r as IngestionResult);

      // `keepRawText` is varied because Req 9.7's `lowConfidence` contract
      // must hold independently of any `ParseOptions` the caller passes.
      const optionsArb = fc.option(
        fc.record({ keepRawText: fc.boolean() }),
        { nil: undefined },
      );

      fc.assert(
        fc.property(ingestionArb, optionsArb, (input, options) => {
          const report =
            options === undefined
              ? parseRawText(input)
              : parseRawText(input, options);

          // Shape guard — Property 1 already covers totality, but if the
          // quality object is missing we cannot evaluate the biconditional.
          if (
            report.extractionQuality === null ||
            typeof report.extractionQuality !== 'object'
          ) {
            return false;
          }

          const expected = input.extractionStatus === 'scanned_fallback';
          const actual = report.extractionQuality.lowConfidence;

          // Exact equality on the boolean — Req 9.7 specifies a strict
          // boolean field, so we reject `undefined`, truthy non-booleans,
          // and any value that is not the exact expected boolean.
          if (typeof actual !== 'boolean') return false;
          return actual === expected;
        }),
        { numRuns: 200 },
      );
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 27: Validator round-trip on parser output
  // Validates: Requirements 10.3, 10.4, 10.5
  //
  // For any `IngestionResult` whose `extractionStatus` is one of the three
  // recognised values, the `StructuredReport` returned by `parseRawText`
  // either:
  //   (a) is flagged as validation-failed (`extractionQuality.validationFailed
  //       === true`), in which case the validator is permitted to reject the
  //       report — the parser still returned the fully-populated structure,
  //       per Req 10.5; or
  //   (b) round-trips successfully through `validateStructuredReport`, which
  //       SHALL return `{ valid: true, errors: [] }`.
  //
  // Equivalently: every parser output that is *not* flagged as
  // validation-failed must validate as a well-formed `StructuredReport`.
  //
  // This pins down the contract between parser and validator across all
  // orchestrator code paths:
  //   - the `'failed'` short-circuit (returns an empty, schema-valid report);
  //   - the normal `'success'` / `'scanned_fallback'` pipeline (returns a
  //     populated report that the parser commits to making schema-valid);
  //   - the catch-block path (returns an empty, schema-valid report whose
  //     warnings field carries the error message).
  //
  // The `validationFailed` escape hatch exists only because Req 10.5
  // explicitly allows the parser to surface a failed-validation report
  // rather than throw; the property therefore disjoins it with the
  // round-trip success rather than asserting unconditional validity.
  //
  // Inputs are drawn from the same fully-arbitrary string space used by
  // Properties 1–3 so that the cleaner, row-detector, field-extractor, and
  // normalizer are exercised on noisy, unicode-bearing, accidentally-row-
  // shaped, and empty texts.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'guarantees parser output is either flagged validationFailed or passes validateStructuredReport with no errors',
    () => {
      const extractionStatusArb = fc.constantFrom<
        IngestionResult['extractionStatus']
      >('success', 'scanned_fallback', 'failed');

      const ingestionArb: fc.Arbitrary<IngestionResult> = fc
        .record({
          originalFilename: fc.string(),
          storedFilePath: fc.constant('/tmp/placeholder.pdf'),
          extractionStatus: extractionStatusArb,
          extractedText: fc.string(),
        })
        .map((r) => r as IngestionResult);

      // `keepRawText` is varied because Property 27's contract must hold
      // independently of `ParseOptions` — both the rawText-bearing and the
      // rawText-stripped report shapes must satisfy the schema.
      const optionsArb = fc.option(
        fc.record({ keepRawText: fc.boolean() }),
        { nil: undefined },
      );

      fc.assert(
        fc.property(ingestionArb, optionsArb, (input, options) => {
          const report =
            options === undefined
              ? parseRawText(input)
              : parseRawText(input, options);

          const result = validateStructuredReport(report);

          // Shape guard on the validator return type — Req 10.3 / 10.4
          // require `{ valid: boolean; errors: { field, message }[] }`.
          if (typeof result.valid !== 'boolean') return false;
          if (!Array.isArray(result.errors)) return false;
          for (const err of result.errors) {
            if (err === null || typeof err !== 'object') return false;
            if (typeof err.field !== 'string') return false;
            if (typeof err.message !== 'string') return false;
          }

          // Branch on the parser's own self-assessment. Req 10.5 permits
          // the parser to return a report it knows is invalid, provided
          // `validationFailed` is set.
          const flaggedInvalid =
            report.extractionQuality?.validationFailed === true;

          if (flaggedInvalid) {
            // When the parser admits validation failure, the validator is
            // permitted to either accept or reject. Either way, the
            // contract held: the report was returned, fully-populated, and
            // the failure was surfaced structurally rather than thrown.
            return true;
          }

          // Otherwise the parser is asserting the report is schema-valid.
          // The validator MUST agree: `{ valid: true, errors: [] }`.
          if (result.valid !== true) return false;
          if (result.errors.length !== 0) return false;
          return true;
        }),
        { numRuns: 200 },
      );
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: pdf-text-structuring, Property 28: rawText key presence reflects ParseOptions
  // Validates: Requirements 11.5
  //
  // For any `IngestionResult` and any `options`, the returned report
  // satisfies the biconditional:
  //
  //     ('rawText' in parseRawText(input, options)) === Boolean(options?.keepRawText)
  //
  // Two stronger sub-claims, both required by Req 11.5:
  //
  //   (a) When `options?.keepRawText !== true` (i.e., `options` is
  //       `undefined`, the field is omitted, the field is `undefined`, or
  //       the field is `false`), the `rawText` key SHALL be absent from
  //       the returned object — `'rawText' in report === false`. The key
  //       must not be present as `undefined`; that would still satisfy
  //       `report.rawText === undefined` but violate the contract.
  //
  //   (b) When `options.keepRawText === true`, the `rawText` key SHALL be
  //       present (`'rawText' in report === true`) and its value SHALL be
  //       a `string`.
  //
  // The property must hold across all three orchestrator code paths so that
  // the contract is uniform regardless of which branch produced the report:
  //   - the `'failed'` short-circuit (Req 1.2);
  //   - the normal `'success'` / `'scanned_fallback'` pipeline;
  //   - the catch-block path (an internal throw must still honour
  //     `keepRawText`).
  //
  // To exercise all three branches, `extractionStatus` is drawn from the
  // full recognised set and `extractedText` is fully arbitrary unicode —
  // the same input space used by Properties 1–3 and 27.
  // ───────────────────────────────────────────────────────────────────────────
  it(
    'has the rawText key present iff options.keepRawText === true, regardless of extractionStatus',
    () => {
      const extractionStatusArb = fc.constantFrom<
        IngestionResult['extractionStatus']
      >('success', 'scanned_fallback', 'failed');

      const ingestionArb: fc.Arbitrary<IngestionResult> = fc
        .record({
          originalFilename: fc.string(),
          storedFilePath: fc.constant('/tmp/placeholder.pdf'),
          extractionStatus: extractionStatusArb,
          extractedText: fc.string(),
        })
        .map((r) => r as IngestionResult);

      // Generate the full space of `options` shapes Req 11.5 cares about:
      //   - `undefined`                       → keepRawText effectively absent
      //   - `{}`                              → field omitted entirely
      //   - `{ keepRawText: false }`          → explicit opt-out
      //   - `{ keepRawText: undefined }`      → field present but not `true`
      //   - `{ keepRawText: true }`           → opt-in (the only "present" case)
      //
      // The first four shapes must all produce a report with no `rawText`
      // key; only the fifth produces a report whose `rawText` is a string.
      const optionsArb: fc.Arbitrary<ParseOptions | undefined> =
        fc.oneof(
          fc.constant<undefined>(undefined),
          fc.constant<ParseOptions>({}),
          fc.constant<ParseOptions>({ keepRawText: false }),
          fc.constant<ParseOptions>({ keepRawText: undefined }),
          fc.constant<ParseOptions>({ keepRawText: true }),
        );

      fc.assert(
        fc.property(ingestionArb, optionsArb, (input, options) => {
          const report =
            options === undefined
              ? parseRawText(input)
              : parseRawText(input, options);

          // Compute the expected presence of the key. The biconditional in
          // the property docstring is `Boolean(options?.keepRawText)`, but
          // we intentionally use strict `=== true` here to reject any
          // accidental truthy-but-non-boolean values (e.g., `1`, `"yes"`)
          // that could slip through TypeScript at runtime — Req 11.5 ties
          // presence specifically to the boolean `true`.
          const expectKey = options?.keepRawText === true;

          // (a) Key-presence biconditional. We use the `in` operator
          //     (NOT `report.rawText !== undefined`) because the requirement
          //     is about the *property's existence*, not its value.
          const hasKey = 'rawText' in report;
          if (hasKey !== expectKey) return false;

          // (b) When the key is present, the value must be a string. When
          //     absent, the value must literally be unreadable as a defined
          //     property — `report.rawText` will read as `undefined`, but
          //     that's a consequence of absence, not a separate assertion.
          if (expectKey) {
            if (typeof report.rawText !== 'string') return false;
          }

          return true;
        }),
        { numRuns: 200 },
      );
    },
  );
});
