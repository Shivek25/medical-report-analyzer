# Requirements Document

## Introduction

Phase 2 of the Medical Report Analyzer converts raw PDF text — produced by Phase 1's extraction pipeline — into a clean, typed, structured report model. The output is a `StructuredReport` object that downstream phases (LLM summarization, PDF export) can consume without touching raw text again.

The scope is strictly structural: no medical interpretations, no summary text, no downloadable PDF. The parser must be deterministic, must never fabricate missing values, and must preserve uncertainty explicitly when data is ambiguous or incomplete.

## Glossary

- **Raw_Text**: The full string returned by `extractTextFromPdf` in Phase 1 (`IngestionResult.extractedText`).
- **Structured_Report**: The typed output object produced by this phase, containing metadata and an array of `LabEntry` items.
- **Lab_Entry**: A single parsed test row containing test name, value, unit, reference range, flag, and optional notes.
- **Report_Metadata**: Patient name, report date, lab name, sample/collection date, and report ID extracted from the report header.
- **Flag**: An explicit abnormality indicator attached to a lab entry (e.g., `H`, `L`, `*`, `HIGH`, `LOW`, `CRITICAL`).
- **Uncertainty_Marker**: A structured field on a `LabEntry` indicating that one or more fields could not be reliably extracted.
- **Extraction_Quality**: A metadata object attached to the `Structured_Report` summarising parse confidence, row counts, and any issues encountered.
- **Text_Cleaner**: The sub-module responsible for removing page headers, footers, repeated lab branding, and other PDF noise before row detection.
- **Row_Detector**: The sub-module responsible for identifying candidate lab-test lines from cleaned text.
- **Field_Extractor**: The sub-module responsible for parsing individual fields (name, value, unit, range, flag) from a detected row.
- **Normalizer**: The sub-module responsible for standardising units, trimming whitespace, and resolving common abbreviations.
- **Parser**: The top-level orchestrator in `src/lib/parser/` that calls Text_Cleaner → Row_Detector → Field_Extractor → Normalizer in sequence.
- **Validator**: The module in `src/lib/validator/` that validates a `Structured_Report` against a Zod schema.

---

## Requirements

### Requirement 1: Accept Phase 1 Output as Input

**User Story:** As a developer integrating Phase 1 and Phase 2, I want the parser to accept the `IngestionResult` produced by Phase 1, so that the two phases compose without manual data transformation.

#### Acceptance Criteria

1. THE Parser SHALL accept an `IngestionResult` object whose `extractionStatus` is one of `'success'`, `'scanned_fallback'`, or `'failed'`, and whose `extractedText` and `originalFilename` are strings, as its primary input.
2. WHEN `extractionStatus` is `'failed'`, THE Parser SHALL return a `Structured_Report` with zero `LabEntry` items and an `Extraction_Quality` field whose `warnings` array contains the string `"Extraction failed"`.
3. WHEN `extractionStatus` is `'scanned_fallback'`, THE Parser SHALL attempt parsing and SHALL set `extractionQuality.lowConfidence` to `true` on the returned `Structured_Report`.
4. WHEN `extractionStatus` is `'success'`, THE Parser SHALL attempt parsing without setting `extractionQuality.lowConfidence`.
5. IF an internal error occurs during parsing, THEN THE Parser SHALL catch it and return a `Structured_Report` with the error message recorded in `extractionQuality.warnings` and `entries` set to an empty array.
6. THE Parser SHALL NOT throw an unhandled exception for any `IngestionResult` whose `extractionStatus` is one of the three recognised values.

---

### Requirement 2: Extract Report Metadata

**User Story:** As a developer building the summarization phase, I want structured patient and lab metadata extracted from the report header, so that downstream phases can display and reference it without re-parsing raw text.

#### Acceptance Criteria

1. WHEN a patient name is present in the Raw_Text header, THE Parser SHALL extract it into `Report_Metadata.patientName`.
2. WHEN a report date is present in the Raw_Text, THE Parser SHALL extract it into `Report_Metadata.reportDate` as an ISO 8601 date string (`YYYY-MM-DD`) when conversion is possible; IF the date cannot be converted to ISO 8601 format, THEN THE Parser SHALL store it as the verbatim date string found in the source text.
3. WHEN a sample collection date is present in the Raw_Text, THE Parser SHALL extract it into `Report_Metadata.sampleDate` as an ISO 8601 date string when conversion is possible; IF the date cannot be converted to ISO 8601 format, THEN THE Parser SHALL store it as the verbatim date string found in the source text.
4. WHEN a lab name is present in the Raw_Text, THE Parser SHALL extract it into `Report_Metadata.labName`.
5. WHEN a report ID or barcode is present in the Raw_Text, THE Parser SHALL extract it into `Report_Metadata.reportId`.
6. IF a metadata field cannot be found in the Raw_Text header, THEN THE Parser SHALL set that field to `undefined` rather than fabricating a value.
7. WHEN the patient name line contains an annotation matching the pattern `(<age>Y/<gender>)` (e.g., `"Shivek Sharma (22Y/M)"`), THE Parser SHALL extract the numeric age into `Report_Metadata.patientAge` as a `number` and the gender token into `Report_Metadata.patientGender` as one of `"M"`, `"F"`, or `"O"`.
8. IF the annotation format does not match `(<digits>Y/<single-letter>)`, THEN THE Parser SHALL set `Report_Metadata.patientAge` and `Report_Metadata.patientGender` to `undefined`.

---

### Requirement 3: Clean Raw Text Before Parsing

**User Story:** As a developer, I want PDF noise removed before row detection, so that repeated headers, footers, page numbers, and lab branding do not produce false lab entries.

#### Acceptance Criteria

1. THE Text_Cleaner SHALL remove page header blocks — defined as the lab name and address block that appears on more than one page — from all occurrences after the first.
2. THE Text_Cleaner SHALL remove lines that match the pattern `/^Page\s*:?\s*\d+\s+of\s+\d+$/i` (e.g., `"Page : 1 of 3"` or `"Page 2 of 3"`).
3. THE Text_Cleaner SHALL remove lines that are full-line matches for doctor signature blocks, barcode label lines, and QR-code instruction lines; a line that also contains a numeric value or unit token SHALL NOT be removed even if it partially matches a footer pattern.
4. THE Text_Cleaner SHALL remove lines that consist entirely of whitespace characters or contain only separator characters (dashes `-`, underscores `_`, equals signs `=`, or combinations thereof).
5. WHEN a section header line is encountered — defined as a line that is all-uppercase or title-case, contains no numeric value token, and contains no unit token — THE Text_Cleaner SHALL preserve it unchanged as a category marker.
6. THE Text_Cleaner SHALL be a pure function: given the same input string, it SHALL always return the same output string.

---

### Requirement 4: Detect Lab Test Rows

**User Story:** As a developer, I want the parser to identify which lines in the cleaned text represent individual lab test results, so that only genuine test rows are passed to field extraction.

#### Acceptance Criteria

1. IF a line contains a token that is either a decimal/integer number or one of the qualitative values `"Negative"`, `"Positive"`, `"Reactive"`, `"Non-Reactive"`, `"Present"`, `"Absent"`, AND the line also contains at least one of: a unit token, a reference range pattern, or a flag token, THEN THE Row_Detector SHALL classify it as a candidate lab row.
2. WHEN a lab row spans multiple lines due to PDF text wrapping, THE Row_Detector SHALL merge continuation lines according to the rules defined in Requirement 7 before passing the merged row to the Field_Extractor.
3. THE Row_Detector SHALL skip lines whose entire content matches one of the following non-data patterns: (a) section header lines as defined in Requirement 3 criterion 5; (b) lines beginning with `"Method:"`, `"Methodology:"`, or `"Note:"`; (c) lines that are entirely prose sentences (no numeric or unit tokens); (d) disclaimer blocks identified by keywords such as `"not a substitute"`, `"consult your physician"`.
4. THE Row_Detector SHALL preserve the order of detected rows as they appear in the cleaned text.
5. WHEN a line cannot be classified as either a candidate lab row or a known non-data pattern, THE Row_Detector SHALL emit it as an `ambiguous` row with `classification: "ambiguous"` and `rawText` set to the line content, so it can be appended to `Extraction_Quality.ambiguousLines`.
6. IF the cleaned text is empty or contains only whitespace, THEN THE Row_Detector SHALL return an empty array of rows without emitting any ambiguous entries.

---

### Requirement 5: Extract Fields from Each Lab Row

**User Story:** As a developer, I want each detected lab row parsed into its constituent fields, so that the structured output contains discrete, typed values rather than raw strings.

#### Acceptance Criteria

1. THE Field_Extractor SHALL extract the test name from each lab row into `LabEntry.testName`.
2. THE Field_Extractor SHALL extract the measured value from each lab row into `LabEntry.value` as a `string` (preserving qualitative values such as `"Negative"` or `"Reactive"`).
3. IF a unit token is present in the lab row, THEN THE Field_Extractor SHALL extract it into `LabEntry.unit`; IF no unit token is present, THEN `LabEntry.unit` SHALL be `undefined`.
4. THE Field_Extractor SHALL extract the reference range from each lab row into `LabEntry.referenceRange` as a structured object with optional `low` (`number`), `high` (`number`), and `text` (`string`) fields; IF no reference range is present, THEN `LabEntry.referenceRange` SHALL be `undefined`.
5. IF a recognised flag token (`H`, `L`, `*`, `HIGH`, `LOW`, `CRITICAL`, `ABNORMAL`) is present in the lab row, THEN THE Field_Extractor SHALL extract it into `LabEntry.flag`; IF the token in the flag position is not a recognised flag value, THEN `LabEntry.flag` SHALL be `undefined` and the unrecognised token SHALL be appended to `LabEntry.notes`.
6. IF inline notes or remarks are present in the lab row after all other fields have been extracted, THEN THE Field_Extractor SHALL extract them into `LabEntry.notes`; IF no notes are present, THEN `LabEntry.notes` SHALL be `undefined`.
7. IF a required field (`testName` or `value`) cannot be extracted from a row, THEN THE Field_Extractor SHALL set `LabEntry.uncertain` to `true`, set `LabEntry.uncertaintyReason` to a string identifying which field is missing and including the raw row text (e.g., `"Missing value; raw: '<row text>'"`) and continue processing the remaining fields of that row rather than discarding it.
8. IF a field is present in the source row but cannot be parsed into its expected type, THEN THE Field_Extractor SHALL leave that field `undefined` rather than storing a malformed value, and SHALL record the parse failure in `LabEntry.uncertaintyReason`.

---

### Requirement 6: Normalize Extracted Fields

**User Story:** As a developer, I want extracted field values normalised to consistent formats, so that downstream phases can compare and display values without additional cleaning.

#### Acceptance Criteria

1. THE Normalizer SHALL trim leading and trailing whitespace from all string fields in a `LabEntry` (`testName`, `value`, `unit`, `referenceRange.text`, `flag`, `notes`, `uncertaintyReason`).
2. THE Normalizer SHALL collapse internal runs of two or more whitespace characters in `testName` to a single space.
3. THE Normalizer SHALL normalise `unit` strings by trimming whitespace and applying a canonical form from a known unit map (e.g., `"MG/DL"` → `"mg/dL"`); units not present in the canonical map SHALL be preserved after trimming without case conversion.
4. THE Normalizer SHALL parse `referenceRange` bounds into `number` type when the range text matches the pattern `<number>[-–]<number>` (with optional surrounding spaces); IF numeric parsing of either bound fails, THEN the entire range SHALL be stored in `referenceRange.text` and `low`/`high` SHALL be `undefined`.
5. THE Normalizer SHALL preserve non-numeric reference ranges (e.g., `"< 30"`, `"Negative"`, `"197-771 pg/ml"`) in `referenceRange.text`; a range is considered non-numeric when it contains a non-numeric suffix or a comparison operator.
6. THE Normalizer SHALL be a pure function: given the same `LabEntry`, it SHALL always return the same normalised `LabEntry`.

---

### Requirement 7: Handle Multi-Line and Wrapped Rows

**User Story:** As a developer, I want the parser to correctly handle lab rows that are split across multiple lines by PDF extraction, so that no test entry is lost or partially parsed.

#### Acceptance Criteria

1. WHEN the line immediately following a test-name-only line (a line with no numeric value token and no unit token) contains a numeric value token or a recognised unit token, and there is no blank line between them, THE Row_Detector SHALL treat the two lines as a single logical row; continuation merging SHALL extend at most 3 lines beyond the initial test-name line.
2. WHEN a reference range pattern appears on a continuation line immediately after the value and unit have been identified, THE Row_Detector SHALL include it in the same logical row.
3. THE Row_Detector SHALL NOT merge lines that are separated by a blank line (a line containing only whitespace characters), a section header line (all-uppercase or title-case line with no numeric or unit tokens), or a page boundary marker (a line produced by the PDF extractor to indicate a page break).
4. WHEN merging continuation lines, THE Row_Detector SHALL insert a single space between the merged fragments.
5. IF a line matches both a test-name pattern and a continuation pattern, THEN THE Row_Detector SHALL treat it as the start of a new row rather than a continuation of the previous row.

---

### Requirement 8: Assign Category to Each Lab Entry

**User Story:** As a developer building the report viewer, I want each lab entry tagged with its test category, so that entries can be grouped by panel (e.g., Hemogram, Lipid Profile, Vitamins) in the UI.

#### Acceptance Criteria

1. THE Parser SHALL assign a `category` string to each `LabEntry` based on the most recent section header encountered before that row in the cleaned text.
2. IF no section header has been encountered before a row, THEN THE Parser SHALL assign `"Uncategorized"` as the category.
3. THE Parser SHALL store the original section header text as the `category` value without applying Normalizer whitespace trimming or case conversion to it.
4. IF a section header line consists entirely of whitespace or is blank, THEN THE Parser SHALL NOT update the current category and SHALL continue using the previously active category (or `"Uncategorized"` if none).

---

### Requirement 9: Produce Extraction Quality Metadata

**User Story:** As a developer debugging parse failures, I want the structured output to include extraction quality metadata, so that I can identify which rows were problematic without re-running the full pipeline.

#### Acceptance Criteria

1. THE Parser SHALL include an `extractionQuality` object on every `Structured_Report`.
2. THE `extractionQuality` object SHALL contain `totalRowsDetected` (count of all rows emitted by Row_Detector, including ambiguous), `successfullyParsed` (count of `LabEntry` items where `uncertain` is `false`), `uncertainRows` (count of `LabEntry` items where `uncertain` is `true`), and `skippedRows` (count of rows classified as non-data and not passed to Field_Extractor); the invariant `successfullyParsed + uncertainRows ≤ totalRowsDetected` SHALL always hold.
3. THE `extractionQuality` object SHALL contain an `ambiguousLines` array of strings, where each string is the raw text of a line that the Row_Detector classified as `ambiguous`.
4. THE `extractionQuality` object SHALL contain a `confidence` score of type `number` in the range `[0.0, 1.0]`, calculated as `successfullyParsed / totalRowsDetected`; WHEN `totalRowsDetected` is `0`, the confidence SHALL be `0.0`.
5. THE `extractionQuality` object SHALL contain a `warnings` array of human-readable strings describing non-fatal issues encountered during parsing (e.g., `"Multi-line merge exceeded 3 lines at row 42"`).
6. THE Parser SHALL NOT include patient name, measured values, or any other patient-identifiable content in the `warnings` or `ambiguousLines` fields; these fields SHALL contain only structural descriptions and row indices.
7. THE `extractionQuality` object SHALL contain a `lowConfidence` boolean field, set to `true` when `extractionStatus` is `'scanned_fallback'` and `false` otherwise.

---

### Requirement 10: Validate the Structured Report

**User Story:** As a developer, I want the structured report validated against a Zod schema before it leaves the parser module, so that downstream phases receive only well-formed data.

#### Acceptance Criteria

1. THE Validator SHALL define a Zod schema for `StructuredReport` that covers all required and optional fields as defined in Requirement 11 criterion 3.
2. THE Validator SHALL define a Zod schema for `LabEntry` that enforces the presence of `testName` (non-empty string), `value` (string), and `uncertain` (boolean).
3. WHEN `validateStructuredReport` is called with a valid `StructuredReport`, THE Validator SHALL return `{ valid: true, errors: [] }`.
4. WHEN `validateStructuredReport` is called with an invalid object, THE Validator SHALL return `{ valid: false, errors: [...] }` where each error object contains a `field` string (dot-notation path to the invalid field) and a `message` string describing the violated constraint.
5. THE Parser SHALL call `validateStructuredReport` on its output before returning; IF validation fails, THEN THE Parser SHALL emit a warning-level log entry (without patient data) and return the report with `extractionQuality.validationFailed` set to `true`; the fully-populated report SHALL always be returned regardless of validation outcome.

---

### Requirement 11: Expose a Typed Output Object for Downstream Use

**User Story:** As a developer building Phase 3 (LLM summarization), I want the parser to return a single, fully-typed `StructuredReport` object, so that I can consume it without casting or re-parsing.

#### Acceptance Criteria

1. THE Parser SHALL export a synchronous `parseRawText` function with the signature `(input: IngestionResult, options?: ParseOptions) => StructuredReport`; both `ParseOptions` and `StructuredReport` SHALL be exported from `src/lib/types/index.ts`.
2. THE `StructuredReport` type SHALL be exported from `src/lib/types/index.ts`; no other module SHALL re-export or redefine this type.
3. THE `StructuredReport` SHALL contain: `metadata` (`ReportMetadata`), `entries` (`LabEntry[]`), `rawText` (optional `string`, controlled by `ParseOptions.keepRawText`), and `extractionQuality` (`ExtractionQuality`).
4. THE `LabEntry` type SHALL contain: `testName` (`string`), `value` (`string`), `unit` (optional `string`), `referenceRange` (optional object with optional `low: number`, `high: number`, `text: string`), `flag` (optional `string`), `notes` (optional `string`), `category` (`string`), `uncertain` (`boolean`), and `uncertaintyReason` (optional `string`).
5. WHERE `ParseOptions.keepRawText` is `false` or omitted, THE Parser SHALL return a `StructuredReport` object in which the `rawText` key is absent (not present as `undefined`).

---

### Requirement 12: Test Against Sample PDFs

**User Story:** As a developer, I want the parser tested against the real sample PDFs in `data/samples/`, so that I have confidence the implementation handles actual Thyrocare report layouts.

#### Acceptance Criteria

1. THE test suite SHALL include at least one integration test per sample PDF in `data/samples/` that runs the full `extractTextFromPdf` → `parseRawText` pipeline and asserts that `entries.length > 0`.
2. THE test suite SHALL assert that the following known test names are found in `entries[].testName` for the corresponding PDF, falling back to checking `extractionQuality.ambiguousLines` only if not found in `entries`: `shivek_June25.pdf` → `"HEMOGLOBIN"`; `shivek_March26.pdf` → `"HEMOGLOBIN"`; `shivek_urm_March26.pdf` → `"25-OH VITAMIN D (TOTAL)"`.
3. THE test suite SHALL assert that `extractionQuality.confidence` is greater than `0.5` for each sample PDF whose `extractionStatus` is `'success'`; for PDFs with `extractionStatus` of `'scanned_fallback'`, the confidence threshold SHALL be `0.3`.
4. THE test suite SHALL assert that no `LabEntry` in the sample output has `uncertain` equal to `false` and `value` equal to `""`, `null`, or `undefined`.
5. THE test suite SHALL include at least 2 unit tests per sub-module (Text_Cleaner, Row_Detector, Field_Extractor, Normalizer) using inline fixture strings derived from the sample PDFs, with at least one test covering a valid/expected input and at least one test covering a noise or edge-case input.
