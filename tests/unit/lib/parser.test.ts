/**
 * tests/unit/lib/parser.test.ts
 * Unit tests for the report parser module.
 *
 * Phase 1: replace todo stubs with real test cases as parseReport is implemented.
 */

import { describe, it } from 'vitest';

describe('parseReport', () => {
  it.todo('returns a BloodTestReport with correct patientInfo from a valid header string');
  it.todo('returns an empty markers array when no biomarker rows are present');
  it.todo('sets status=high when a marker value exceeds the reference range high bound');
  it.todo('sets status=low when a marker value is below the reference range low bound');
  it.todo('sets status=normal when a marker value is within the reference range');
  it.todo('throws when rawText is an empty string');
});

describe('extractPatientInfo', () => {
  it.todo('extracts patient name correctly');
  it.todo('extracts patient age correctly');
  it.todo('returns unknown gender when gender field is absent');
});

describe('extractMarkers', () => {
  it.todo('parses a standard table row into a ParsedMarker');
  it.todo('handles qualitative markers (Negative / Positive) correctly');
  it.todo('returns an empty array for body text with no marker rows');
});
