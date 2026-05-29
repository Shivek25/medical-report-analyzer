/**
 * src/lib/validator/index.ts
 * Data validation — ensures parsed report data is structurally correct
 * before it proceeds to summarization or export.
 *
 * Phase 2 introduces `validateStructuredReport` for the new `StructuredReport`
 * data model (see `./schema.ts`). The legacy stubs (`validateReport`,
 * `validateMarker`, `validateMarkerValues`, `isParsedMarker`) are kept as-is
 * for backwards compatibility with Phase 0 callers and will be filled in by
 * a later phase.
 */

import { ZodError } from 'zod';
import type { BloodTestReport, ParsedMarker } from '../types/index.js';
import { StructuredReportSchema } from './schema.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * A single field-level validation error produced by
 * `validateStructuredReport`.
 *
 * `field` is a dot-notation path to the offending value, e.g.
 * `"entries.3.testName"` or `"extractionQuality.confidence"`. Numeric
 * array indices appear as plain numbers within the path.
 */
export interface StructuredReportValidationError {
  field: string;
  message: string;
}

/**
 * Result of validating a `StructuredReport` against
 * `StructuredReportSchema`.
 *
 * Mirrors the contract documented in Requirement 10.3 / 10.4: on success
 * `errors` is an empty array; on failure each Zod issue is mapped to a
 * `{ field, message }` pair with a dot-notation path.
 */
export interface StructuredReportValidationResult {
  valid: boolean;
  errors: StructuredReportValidationError[];
}

/**
 * Validate a `StructuredReport` against the Zod schema in `./schema.ts`.
 *
 * On success returns `{ valid: true, errors: [] }`. On failure converts
 * the `ZodError` into a flat `{ field, message }[]` list where each
 * `field` is the dot-notation path of the issue (e.g. `"entries.3.testName"`,
 * `"metadata.patientGender"`, `"extractionQuality.confidence"`).
 *
 * This function never throws for input shape problems — any non-conforming
 * value is reported as a validation error rather than a runtime exception.
 *
 * Validates: Requirements 10.3, 10.4
 */
export function validateStructuredReport(
  value: unknown,
): StructuredReportValidationResult {
  const result = StructuredReportSchema.safeParse(value);

  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors = zodErrorToFieldErrors(result.error);
  return { valid: false, errors };
}

/**
 * Convert a `ZodError` into the `{ field, message }[]` shape used by
 * `validateStructuredReport`. Each issue's `path` array is joined with
 * `.` to produce a dot-notation path; numeric array indices appear as
 * plain numbers (e.g. `entries.3.testName`).
 */
function zodErrorToFieldErrors(
  error: ZodError,
): StructuredReportValidationError[] {
  return error.issues.map((issue) => ({
    field: issue.path.map((segment) => String(segment)).join('.'),
    message: issue.message,
  }));
}

/**
 * Validate a fully-parsed BloodTestReport.
 */
export function validateReport(_report: unknown): ValidationResult {
  // TODO (Phase 1): implement Zod-based validation
  throw new Error('validateReport: not yet implemented');
}

/**
 * Validate a single parsed marker entry.
 */
export function validateMarker(_marker: unknown): ValidationResult {
  // TODO (Phase 1): implement
  throw new Error('validateMarker: not yet implemented');
}

/**
 * Ensure all markers in a report are within reasonable value ranges.
 */
export function validateMarkerValues(_report: BloodTestReport): ValidationResult {
  // TODO (Phase 1): implement range checks
  throw new Error('validateMarkerValues: not yet implemented');
}

/**
 * Type guard — narrows an unknown value to ParsedMarker.
 */
export function isParsedMarker(_value: unknown): _value is ParsedMarker {
  // TODO (Phase 1): implement
  return false;
}
