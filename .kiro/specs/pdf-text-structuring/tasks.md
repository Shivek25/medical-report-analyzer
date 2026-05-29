# Implementation Plan: PDF Text Structuring (Phase 2)

## Overview

This plan converts the Phase 2 design into a sequence of incremental, code-only tasks for a code-generation LLM. The implementation language is **TypeScript** (consistent with the rest of the repo: Vitest, Zod, `pdf-parse`, ESM modules under `src/lib/`). Each task builds on previous ones and ends with end-to-end wiring through the orchestrator and validator. Property-based tests are written next to the sub-modules they validate using `fast-check`, and each one is annotated with its property number from `design.md` and the requirement clause it checks.

Convert the feature design into a series of prompts for a code-generation LLM that will implement each step with incremental progress. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on tasks that involve writing, modifying, or testing code.

## Tasks

- [x] 1. Establish Phase 2 types, shared patterns, and the test harness
  - [x] 1.1 Add Phase 2 types to `src/lib/types/index.ts`
    - Add `ParseOptions`, `ReportMetadata`, `LabReferenceRange`, `LabEntry`, `ExtractionQuality`, `StructuredReport`, and `DetectedRow` exactly as defined in the Data Models section
    - Keep existing `BloodTestReport` / `ParsedMarker` exports untouched for backwards compatibility
    - Re-export these new types from `src/lib/index.ts` only if existing barrels already do so; do not create new public re-exports elsewhere
    - _Requirements: 11.2, 11.3, 11.4_

  - [x] 1.2 Create shared regex patterns module `src/lib/parser/patterns.ts`
    - Define and export regexes for: numeric value tokens, qualitative value tokens (`Negative|Positive|Reactive|Non-Reactive|Present|Absent`), unit tokens, reference-range patterns (`<num>-<num>`, `< <num>`, `> <num>`, qualitative ranges), recognised flag tokens (`H|L|*|HIGH|LOW|CRITICAL|ABNORMAL`), page-marker (`/^Page\s*:?\s*\d+\s+of\s+\d+$/i`), separator-only line, age/gender annotation `/\((\d+)Y\/([A-Za-z])\)\s*$/`, accepted date formats (`DD/MM/YYYY`, `DD-MM-YYYY`, `DD MMM YYYY`, `MMM DD, YYYY`)
    - All exports are `const` regexes / lookup tables; the file performs no I/O
    - _Requirements: 3.2, 4.1, 5.5, 6.4, 6.5, 2.2, 2.3, 2.7_

  - [x] 1.3 Create canonical unit map `src/lib/parser/unit-map.ts`
    - Export a `Record<string, string>` mapping uppercased keys (`MG/DL`, `G/DL`, `IU/L`, `PG/ML`, `MMOL/L`, `%`, etc.) to canonical forms (`mg/dL`, `g/dL`, `IU/L`, `pg/mL`, `mmol/L`, `%`)
    - Export a small helper `canonicalizeUnit(raw: string): string` that trims, uppercases for lookup, returns the canonical form when matched, otherwise returns the trimmed input unchanged (no case conversion)
    - _Requirements: 6.3_

  - [x] 1.4 Install and wire `fast-check` for property tests
    - Add `fast-check` as a dev dependency in `package.json`
    - Create `tests/property/` directory with placeholder `tests/property/.gitkeep`
    - Ensure `vitest.config.ts` (or `vitest` block in `package.json`) discovers `tests/**/*.test.ts`
    - _Requirements: 12.5_

  - [x] 1.5 Smoke test for Phase 2 type and module surface
    - Create `tests/smoke/types.test.ts` asserting `StructuredReport`, `LabEntry`, `ReportMetadata`, `ExtractionQuality`, `ParseOptions` are importable from `src/lib/types/index.ts` and that a hand-written valid object compiles against the types
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 2. Implement Text_Cleaner
  - [x] 2.1 Implement `clean(rawText)` in `src/lib/parser/text-cleaner.ts`
    - Split on `\n`, apply per-line filters in order (page markers, separator/whitespace-only lines, footer/signature/QR lines without numeric/unit tokens, repeated lab/address blocks after first occurrence), preserve section headers verbatim, re-join with `\n`
    - Pure function, no I/O, no shared state
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 2.2 Unit tests for Text_Cleaner
    - Create `tests/unit/parser/text-cleaner.test.ts` with at least one happy-path test (sample-derived header + body) and one edge-case test (footer-with-numeric-token preservation, duplicate lab block deduplication)
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 12.5_

  - [x] 2.3 Property test: cleaner removes noise without removing data lines
    - Create `tests/property/parser/text-cleaner.property.test.ts`
    - **Property 8: Cleaner removes noise without removing data lines**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

  - [x] 2.4 Property test: section headers preserved verbatim
    - Add to `tests/property/parser/text-cleaner.property.test.ts`
    - **Property 9: Section headers are preserved verbatim by the cleaner**
    - **Validates: Requirements 3.5**

  - [x] 2.5 Property test: cleaner is deterministic and pure
    - Add to `tests/property/parser/text-cleaner.property.test.ts`
    - **Property 10: Text_Cleaner is deterministic and pure**
    - **Validates: Requirements 3.6**

- [x] 3. Implement Row_Detector with multi-line merging
  - [x] 3.1 Implement `detect(cleanedText)` in `src/lib/parser/row-detector.ts`
    - Iterate cleaned lines, classify each as `lab`, `ambiguous`, or skip (non-data) using the patterns from `patterns.ts`
    - Implement multi-line merge: test-name-only line followed within 3 lines by a numeric/unit-bearing line is merged with single-space joins; reference-range continuation immediately after value/unit is folded in; merge stops at blank line, section header, page boundary, or 3-line cap
    - When the merge cap is exceeded, queue the structural warning `"Multi-line merge exceeded 3 lines at row N"` to a returned warnings array (alongside `DetectedRow[]`)
    - Skip section headers, `Method:` / `Methodology:` / `Note:` prefixed lines, prose-only lines, and disclaimer keywords (`"not a substitute"`, `"consult your physician"`)
    - Emit unclassifiable lines as `{ classification: 'ambiguous', rawText: <line>, lineIndex }`
    - Preserve source order via strictly increasing `lineIndex`; return `[]` for whitespace-only / empty input
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 3.2 Unit tests for Row_Detector
    - Create `tests/unit/parser/row-detector.test.ts` with at least one happy-path test (single-line lab row classified `lab`) and one edge-case test (multi-line merge with reference-range continuation; ambiguous emission for an unclassifiable line)
    - _Requirements: 4.1, 4.2, 4.5, 7.1, 12.5_

  - [x] 3.3 Property test: lab-row classification rule
    - Create `tests/property/parser/row-detector.property.test.ts`
    - **Property 11: Lab-row classification rule**
    - **Validates: Requirements 4.1**

  - [x] 3.4 Property test: non-data line skipping
    - Add to `tests/property/parser/row-detector.property.test.ts`
    - **Property 12: Non-data line skipping**
    - **Validates: Requirements 4.3**

  - [x] 3.5 Property test: detected rows preserve source order
    - Add to `tests/property/parser/row-detector.property.test.ts`
    - **Property 13: Detected rows preserve source order**
    - **Validates: Requirements 4.4**

  - [x] 3.6 Property test: ambiguous classification
    - Add to `tests/property/parser/row-detector.property.test.ts`
    - **Property 14: Ambiguous classification**
    - **Validates: Requirements 4.5**

  - [x] 3.7 Property test: empty input yields empty row list
    - Add to `tests/property/parser/row-detector.property.test.ts`
    - **Property 15: Empty input yields empty row list**
    - **Validates: Requirements 4.6**

  - [x] 3.8 Property test: multi-line merging within 3-line window
    - Add to `tests/property/parser/row-detector.property.test.ts`
    - **Property 16: Multi-line merging within 3-line window**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**

- [x] 4. Implement Categorizer
  - [x] 4.1 Implement `assignCategories(rows)` in `src/lib/parser/categorizer.ts`
    - Walk `DetectedRow[]` in order, track most-recent section header line as `currentCategory` (using same all-uppercase / title-case + no numeric / no unit predicate)
    - Set `row.category = currentCategory ?? 'Uncategorized'`; preserve verbatim header text (no trim, no case conversion)
    - Whitespace-only / blank header lines do not update `currentCategory`
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 4.2 Property test: category assignment from most recent header
    - Create `tests/property/parser/categorizer.property.test.ts`
    - **Property 24: Category assignment from most recent header**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

- [x] 5. Implement Field_Extractor
  - [x] 5.1 Implement `extract(row)` in `src/lib/parser/field-extractor.ts`
    - Tokenise the merged row text using the row grammar `<name> <value> [<unit>] [<flag>] [<range>] [<notes>]` from `patterns.ts`
    - Populate `LabEntry.testName`, `value`, `unit`, `flag`, `referenceRange` (structured `{ low?, high?, text? }`), `notes`, default `category: 'Uncategorized'` (Categorizer overrides), default `uncertain: false`
    - Recognise only `H | L | * | HIGH | LOW | CRITICAL | ABNORMAL` as flags; route any other token in flag position to `notes`
    - On missing required field (`testName` or `value`) set `uncertain = true` and `uncertaintyReason = "Missing <field>; raw: '<row text>'"`, then continue extracting remaining optional fields
    - On a present-but-unparseable optional field, leave the field `undefined` and append a parse-failure note to `uncertaintyReason`
    - Pure function, no I/O, no shared state
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 12.4_

  - [x] 5.2 Unit tests for Field_Extractor
    - Create `tests/unit/parser/field-extractor.test.ts` with at least one happy-path test (well-formed row → fully populated `LabEntry`) and one edge-case test (missing value triggers `uncertain: true` with raw text in reason; unrecognised flag routed to notes)
    - _Requirements: 5.1, 5.5, 5.7, 12.5_

  - [x] 5.3 Property test: field extraction completeness on well-formed rows
    - Create `tests/property/parser/field-extractor.property.test.ts`
    - **Property 17: Field extraction completeness on well-formed rows**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.6**

  - [x] 5.4 Property test: flag recognition routes unrecognised tokens to notes
    - Add to `tests/property/parser/field-extractor.property.test.ts`
    - **Property 18: Flag recognition routes unrecognised tokens to notes**
    - **Validates: Requirements 5.5**

  - [x] 5.5 Property test: missing required fields imply uncertainty with traceable reason
    - Add to `tests/property/parser/field-extractor.property.test.ts`
    - **Property 19: Missing required fields imply uncertainty with traceable reason**
    - **Validates: Requirements 5.7, 5.8, 12.4**

- [x] 6. Implement Normalizer
  - [x] 6.1 Implement `normalize(entry)` in `src/lib/parser/normalizer.ts`
    - Trim every defined string field (`testName`, `value`, `unit`, `referenceRange.text`, `flag`, `notes`, `uncertaintyReason`)
    - Collapse runs of two or more whitespace characters in `testName` to a single space
    - Canonicalise `unit` via `canonicalizeUnit` from `unit-map.ts`
    - Parse numeric reference-range bounds when `referenceRange.text` matches `^\s*(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*$`; otherwise leave `low`/`high` undefined and keep `text` verbatim
    - Pure and idempotent (`normalize(normalize(e))` deep-equals `normalize(e)`)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 6.2 Unit tests for Normalizer
    - Create `tests/unit/parser/normalizer.test.ts` with at least one happy-path test (canonical unit + numeric range parsed) and one edge-case test (qualitative range like `"< 30"` or `"Negative"` kept in `text` with `low`/`high` undefined)
    - _Requirements: 6.3, 6.4, 6.5, 12.5_

  - [x] 6.3 Property test: normalizer produces well-formed strings
    - Create `tests/property/parser/normalizer.property.test.ts`
    - **Property 20: Normalizer produces well-formed strings**
    - **Validates: Requirements 6.1, 6.2**

  - [x] 6.4 Property test: unit canonicalisation
    - Add to `tests/property/parser/normalizer.property.test.ts`
    - **Property 21: Unit canonicalisation**
    - **Validates: Requirements 6.3**

  - [x] 6.5 Property test: reference range parsing
    - Add to `tests/property/parser/normalizer.property.test.ts`
    - **Property 22: Reference range parsing**
    - **Validates: Requirements 6.4, 6.5**

  - [x] 6.6 Property test: normalizer is idempotent and pure
    - Add to `tests/property/parser/normalizer.property.test.ts`
    - **Property 23: Normalizer is idempotent and pure**
    - **Validates: Requirements 6.6**

- [x] 7. Checkpoint - sub-modules ready
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement Metadata Extractor
  - [x] 8.1 Implement `extract(cleanedText)` in `src/lib/parser/metadata.ts`
    - Operate on the first ~30 lines of cleaned text (header zone)
    - Extract `patientName` from a `Name : <name>` line or stand-alone capitalised name line near the top
    - Parse `(<digits>Y/<single-letter>)` annotation into numeric `patientAge` and `patientGender` mapped to `'M' | 'F' | 'O'`; on mismatch, leave both `undefined`
    - Extract `reportDate` and `sampleDate` from labels (`Report Date`, `Reported on`, `Sample Collected`, `Collection Date`); convert via accepted date formats to ISO `YYYY-MM-DD`, otherwise store verbatim
    - Extract `labName` (first line containing a known lab keyword) and `reportId` (e.g., `Barcode\s*:\s*([A-Z0-9-]+)` or `Report\s*ID\s*:\s*([A-Z0-9-]+)`)
    - Any field not found: leave `undefined`; never fabricate
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 8.2 Property test: patient name extraction
    - Create `tests/property/parser/metadata.property.test.ts`
    - **Property 4: Patient name extraction**
    - **Validates: Requirements 2.1**

  - [x] 8.3 Property test: date extraction is ISO-when-convertible, verbatim-otherwise
    - Add to `tests/property/parser/metadata.property.test.ts`
    - **Property 5: Date extraction is ISO-when-convertible, verbatim-otherwise**
    - **Validates: Requirements 2.2, 2.3**

  - [x] 8.4 Property test: age and gender annotation parsing
    - Add to `tests/property/parser/metadata.property.test.ts`
    - **Property 6: Age and gender annotation parsing**
    - **Validates: Requirements 2.7, 2.8**

  - [x] 8.5 Property test: missing metadata fields are not fabricated
    - Add to `tests/property/parser/metadata.property.test.ts`
    - **Property 7: Missing metadata fields are not fabricated**
    - **Validates: Requirements 2.6**

- [x] 9. Implement Quality Aggregator
  - [x] 9.1 Implement `build(counts, ambiguousLines, warnings, lowConfidence, validationFailed)` in `src/lib/parser/quality.ts`
    - Compute `confidence = totalRowsDetected === 0 ? 0 : successfullyParsed / totalRowsDetected`
    - Assert `successfullyParsed + uncertainRows ≤ totalRowsDetected`; on violation, throw an internal `Error` (caught by orchestrator's outer try/catch) and the violation surfaces as a warning
    - Defensive scrub: remove patient-name and measured-value substrings (derived from the report metadata) from every entry of `warnings` and `ambiguousLines` before returning
    - Pass `lowConfidence` and `validationFailed` through unchanged
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 9.2 Property test: quality count invariant
    - Create `tests/property/parser/quality.property.test.ts`
    - **Property 25: Quality count invariant**
    - **Validates: Requirements 9.2, 9.4**

  - [x] 9.3 Property test: no patient data leaks into quality strings
    - Add to `tests/property/parser/quality.property.test.ts`
    - **Property 26: No patient data leaks into quality strings**
    - **Validates: Requirements 9.6**

- [x] 10. Implement Validator (Zod schemas)
  - [x] 10.1 Define Zod schemas in `src/lib/validator/schema.ts`
    - Define `ReferenceRangeSchema`, `LabEntrySchema` (with `testName: z.string().min(1)`, `value: z.string()`, `uncertain: z.boolean()` and the optional fields from `LabEntry`), `ReportMetadataSchema`, `ExtractionQualitySchema`, and `StructuredReportSchema`
    - Export the schemas and the `LabEntry` / `StructuredReport` inferred types only when not already covered by `src/lib/types/index.ts` (types module remains the single source of truth)
    - _Requirements: 10.1, 10.2_

  - [x] 10.2 Implement `validateStructuredReport` in `src/lib/validator/index.ts`
    - Add `validateStructuredReport(value: unknown): { valid: boolean; errors: { field: string; message: string }[] }`
    - On Zod failure, convert `ZodError` into the `{ field, message }[]` shape using dot-notation paths (e.g., `entries.3.testName`)
    - Leave existing `validateReport` / `validateMarker` exports untouched
    - _Requirements: 10.3, 10.4_

  - [x] 10.3 Unit tests for validator schemas
    - Create `tests/unit/validator/schema.test.ts` with at least one happy-path test (known-valid `StructuredReport` returns `{ valid: true, errors: [] }`) and one edge-case test (missing `testName` produces an error with dot-notation `field` path)
    - _Requirements: 10.3, 10.4, 12.5_

- [x] 11. Implement orchestrator `parseRawText` and wire all sub-modules
  - [x] 11.1 Implement `parseRawText` in `src/lib/parser/orchestrator.ts`
    - Synchronous signature `(input: IngestionResult, options?: ParseOptions) => StructuredReport`
    - Short-circuit when `input.extractionStatus === 'failed'`: return empty `StructuredReport` with `entries: []` and `extractionQuality.warnings` containing `"Extraction failed"`
    - Wrap the pipeline in a try/catch: on internal error, return a fresh `StructuredReport` with `entries: []` and the error message in `warnings`
    - Pipeline order: Text_Cleaner → MetadataExtractor → Row_Detector → Categorizer → (per row) Field_Extractor → Normalizer → Quality Aggregator → Validator
    - Set `lowConfidence = (input.extractionStatus === 'scanned_fallback')`
    - On validator failure, set `extractionQuality.validationFailed = true` and emit a single structural log entry tagged `parser:validation-failed` (no PII)
    - Strip `rawText` key entirely (not set to `undefined`) when `options?.keepRawText !== true`; include cleaned text when `true`
    - Never throw for any of the three recognised `extractionStatus` values
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 9.7, 10.5, 11.1, 11.5_

  - [x] 11.2 Update `src/lib/parser/index.ts` to expose the new public surface
    - Re-export `parseRawText` from `orchestrator.ts`
    - Re-export sub-module functions (`clean`, `detect`, `assignCategories`, `extract` for both Field and Metadata under namespaced exports, `normalize`, `build` from quality) for testing only
    - Leave existing legacy exports (`parseReport`, `extractPatientInfo`, `extractMarkers`) in place for backwards compatibility
    - _Requirements: 11.1_

  - [x] 11.3 Property test: totality on recognised inputs
    - Create `tests/property/parser/orchestrator.property.test.ts`
    - **Property 1: Totality on recognised inputs**
    - **Validates: Requirements 1.1, 1.5, 1.6**

  - [x] 11.4 Property test: failure short-circuit
    - Add to `tests/property/parser/orchestrator.property.test.ts`
    - **Property 2: Failure short-circuit**
    - **Validates: Requirements 1.2**

  - [x] 11.5 Property test: lowConfidence reflects extractionStatus
    - Add to `tests/property/parser/orchestrator.property.test.ts`
    - **Property 3: lowConfidence reflects extractionStatus**
    - **Validates: Requirements 1.3, 1.4, 9.7**

  - [x] 11.6 Property test: validator round-trip on parser output
    - Add to `tests/property/parser/orchestrator.property.test.ts`
    - **Property 27: Validator round-trip on parser output**
    - **Validates: Requirements 10.3, 10.4, 10.5**

  - [x] 11.7 Property test: rawText key presence reflects ParseOptions
    - Add to `tests/property/parser/orchestrator.property.test.ts`
    - **Property 28: rawText key presence reflects ParseOptions**
    - **Validates: Requirements 11.5**

- [x] 12. Integration tests against sample PDFs
  - [x] 12.1 Wire Phase 1 → Phase 2 integration test in `tests/integration/pipeline.test.ts`
    - Run `extractTextFromPdf` then `parseRawText` for each PDF in `data/samples/`
    - Assert `entries.length > 0` for every fixture
    - Assert required `testName` substrings: `shivek_June25.pdf` → `"HEMOGLOBIN"`; `shivek_March26.pdf` → `"HEMOGLOBIN"`; `shivek_urm_March26.pdf` → `"25-OH VITAMIN D (TOTAL)"` (fall back to `extractionQuality.ambiguousLines` only when not in `entries`)
    - Assert `extractionQuality.confidence > 0.5` for `success` PDFs and `> 0.3` for `scanned_fallback` PDFs
    - Assert `entries.every(e => e.uncertain || (e.value !== '' && e.value != null))`
    - Assert `validateStructuredReport(report).valid === true`
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 13. Final checkpoint - end-to-end Phase 2 verified
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP. They cover unit, property-based, and integration tests; core implementation is never optional.
- Each task references specific requirement clauses for traceability.
- Property-based tests use `fast-check` with `numRuns: 100` minimum, and every property test file annotates its tests with the `Feature: pdf-text-structuring, Property N: ...` comment per the design's Testing Strategy.
- One property → one `it(...)` block. Property numbering matches `design.md`.
- Checkpoints (tasks 7 and 13) gate progression and are intentionally non-coding.
- The orchestrator wires sub-modules in the order: Text_Cleaner → MetadataExtractor → Row_Detector → Categorizer → Field_Extractor → Normalizer → Quality Aggregator → Validator.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["1.5", "2.1", "3.1", "4.1", "5.1", "6.1", "8.1", "9.1", "10.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "3.3", "4.2", "5.2", "5.3", "6.2", "6.3", "8.2", "9.2", "10.2", "10.3"] },
    { "id": 3, "tasks": ["2.4", "3.4", "5.4", "6.4", "8.3", "9.3", "11.1"] },
    { "id": 4, "tasks": ["2.5", "3.5", "5.5", "6.5", "8.4", "11.2"] },
    { "id": 5, "tasks": ["3.6", "6.6", "8.5", "11.3", "12.1"] },
    { "id": 6, "tasks": ["3.7", "11.4"] },
    { "id": 7, "tasks": ["3.8", "11.5"] },
    { "id": 8, "tasks": ["11.6"] },
    { "id": 9, "tasks": ["11.7"] }
  ]
}
```
