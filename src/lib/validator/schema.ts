/**
 * src/lib/validator/schema.ts
 *
 * Zod schemas for the Phase 2 `StructuredReport` data model.
 *
 * The TypeScript interfaces (`LabEntry`, `StructuredReport`, `ReportMetadata`,
 * `ExtractionQuality`, `LabReferenceRange`) live in `src/lib/types/index.ts`
 * and remain the single source of truth. This module only exports the runtime
 * Zod schemas used by `validateStructuredReport` (see `./index.ts`).
 *
 * The shapes here mirror the field-by-field definitions in `requirements.md`
 * §10 and `design.md` "Validator" so that any well-formed `StructuredReport`
 * built by the parser passes validation.
 */

import { z } from 'zod';

/**
 * Reference range for a lab entry.
 *
 * Mirrors `LabReferenceRange` in `src/lib/types/index.ts`. All bounds are
 * optional because the parser may have only the verbatim `text` form (e.g.,
 * `"< 30"`, `"Negative"`) when the range is qualitative or non-numeric.
 */
export const ReferenceRangeSchema = z
  .object({
    low: z.number().optional(),
    high: z.number().optional(),
    text: z.string().optional(),
  })
  .strict();

/**
 * A single parsed lab test row.
 *
 * Mirrors `LabEntry` in `src/lib/types/index.ts`. `testName` must be a
 * non-empty string; `value` is always stored as a string so that qualitative
 * results (`"Negative"`, `"Reactive"`) survive the round-trip. `uncertain`
 * is required so that callers can never confuse "field absent" with
 * "field known-good".
 */
export const LabEntrySchema = z
  .object({
    testName: z.string().min(1),
    value: z.string(),
    unit: z.string().optional(),
    referenceRange: ReferenceRangeSchema.optional(),
    flag: z.string().optional(),
    notes: z.string().optional(),
    category: z.string(),
    uncertain: z.boolean(),
    uncertaintyReason: z.string().optional(),
  })
  .strict();

/**
 * Patient and lab metadata extracted from the report header.
 *
 * Mirrors `ReportMetadata` in `src/lib/types/index.ts`. Every field is
 * optional because the parser refuses to fabricate values when a marker is
 * not present in the source text (Requirement 2.6).
 */
export const ReportMetadataSchema = z
  .object({
    patientName: z.string().optional(),
    patientAge: z.number().optional(),
    patientGender: z.enum(['M', 'F', 'O']).optional(),
    reportDate: z.string().optional(),
    sampleDate: z.string().optional(),
    labName: z.string().optional(),
    reportId: z.string().optional(),
  })
  .strict();

/**
 * Quality metadata describing how reliably the report was parsed.
 *
 * Mirrors `ExtractionQuality` in `src/lib/types/index.ts`. The structural
 * invariant `successfullyParsed + uncertainRows ≤ totalRowsDetected`
 * (Requirement 9.2) is enforced by the Quality Aggregator at runtime, not
 * by Zod, since it is a cross-field constraint.
 */
export const ExtractionQualitySchema = z
  .object({
    totalRowsDetected: z.number().int().nonnegative(),
    successfullyParsed: z.number().int().nonnegative(),
    uncertainRows: z.number().int().nonnegative(),
    skippedRows: z.number().int().nonnegative(),
    ambiguousLines: z.array(z.string()),
    warnings: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    lowConfidence: z.boolean(),
    validationFailed: z.boolean().optional(),
  })
  .strict();

/**
 * Top-level Phase 2 output: a typed, validated structured report.
 *
 * Mirrors `StructuredReport` in `src/lib/types/index.ts`. `rawText` is
 * optional and its presence/absence is controlled by `ParseOptions.keepRawText`
 * (Requirement 11.5).
 */
export const StructuredReportSchema = z
  .object({
    metadata: ReportMetadataSchema,
    entries: z.array(LabEntrySchema),
    rawText: z.string().optional(),
    extractionQuality: ExtractionQualitySchema,
  })
  .strict();
