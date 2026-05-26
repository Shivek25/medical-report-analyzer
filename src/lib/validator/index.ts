/**
 * src/lib/validator/index.ts
 * Data validation — ensures parsed report data is structurally correct
 * before it proceeds to summarization or export.
 *
 * Phase 1 implementation will use Zod schemas.
 */

import type { BloodTestReport, ParsedMarker } from '../types/index.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
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
