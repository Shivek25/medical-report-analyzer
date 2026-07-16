/**
 * tests/unit/layout/ontology-mapper.test.ts
 *
 * Phase 8 — Unit tests for the ontology mapper (analyte name normalization).
 */

import { describe, it, expect } from 'vitest';
import {
  resolveCanonical,
  annotateCanonicalNames,
} from '../../../src/lib/layout/ontology-mapper.js';
import type { LayoutCandidateRow } from '../../../src/lib/layout/types.js';

function makeCandidate(text: string): LayoutCandidateRow {
  return {
    text,
    page: 1,
    regionType: 'lab_table',
    sourceItemIds: ['test-id'],
    sourceBlockId: 'blk-0001',
  };
}

describe('resolveCanonical', () => {
  // ── Exact abbreviation matches ─────────────────────────────────────────────
  it('resolves "Hb" to "Hemoglobin"', () => {
    expect(resolveCanonical('Hb')).toBe('Hemoglobin');
  });

  it('resolves "HGB" to "Hemoglobin" (case-insensitive)', () => {
    expect(resolveCanonical('HGB')).toBe('Hemoglobin');
  });

  it('resolves "haemoglobin" to "Hemoglobin"', () => {
    expect(resolveCanonical('haemoglobin')).toBe('Hemoglobin');
  });

  it('resolves "HbA1c" to "HbA1c" (canonical resolves to itself)', () => {
    expect(resolveCanonical('hba1c')).toBe('HbA1c');
  });

  it('resolves "SGOT" to "AST"', () => {
    expect(resolveCanonical('SGOT')).toBe('AST');
  });

  it('resolves "SGPT" to "ALT"', () => {
    expect(resolveCanonical('sgpt')).toBe('ALT');
  });

  it('resolves "TSH" to "TSH"', () => {
    expect(resolveCanonical('TSH')).toBe('TSH');
  });

  it('resolves "25-OH Vitamin D" to "Vitamin D"', () => {
    expect(resolveCanonical('25-oh vitamin d')).toBe('Vitamin D');
  });

  it('resolves "FBS" to "Glucose (Fasting)"', () => {
    expect(resolveCanonical('FBS')).toBe('Glucose (Fasting)');
  });

  it('resolves "Platelet Count" to "Platelets"', () => {
    expect(resolveCanonical('platelet count')).toBe('Platelets');
  });

  it('resolves "TLC" to "White Blood Cells"', () => {
    expect(resolveCanonical('TLC')).toBe('White Blood Cells');
  });

  it('resolves "Sr.Creatinine" to "Creatinine" via prefix match', () => {
    expect(resolveCanonical('sr.creatinine')).toBe('Creatinine');
  });

  // ── Unknown names ──────────────────────────────────────────────────────────
  it('returns undefined for unrecognised name', () => {
    expect(resolveCanonical('RandomUnknownTest')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(resolveCanonical('')).toBeUndefined();
  });
});

describe('annotateCanonicalNames', () => {
  it('annotates a matched candidate with canonicalTestName and rawTestName', () => {
    const candidates = [makeCandidate('Haemoglobin 14.5 g/dL 13.0-17.0')];
    annotateCanonicalNames(candidates);
    expect(candidates[0]!.canonicalTestName).toBe('Hemoglobin');
    expect(candidates[0]!.rawTestName).toBeDefined();
  });

  it('does not modify the text field', () => {
    const originalText = 'HbA1c 5.4 % 4.0-5.7';
    const candidates = [makeCandidate(originalText)];
    annotateCanonicalNames(candidates);
    expect(candidates[0]!.text).toBe(originalText);
  });

  it('leaves unmatched candidates without canonicalTestName', () => {
    const candidates = [makeCandidate('Some Unknown Assay 42 units')];
    annotateCanonicalNames(candidates);
    expect(candidates[0]!.canonicalTestName).toBeUndefined();
  });

  it('handles multiple candidates', () => {
    const candidates = [
      makeCandidate('Hb 14.5 g/dL'),
      makeCandidate('WBC 7.2 x10^3/µL'),
      makeCandidate('RandomTest 99 XU'),
    ];
    annotateCanonicalNames(candidates);
    expect(candidates[0]!.canonicalTestName).toBe('Hemoglobin');
    expect(candidates[1]!.canonicalTestName).toBe('White Blood Cells');
    expect(candidates[2]!.canonicalTestName).toBeUndefined();
  });

  it('annotates after reconstruction (text field unchanged)', () => {
    const candidates = [makeCandidate('SGOT 24 U/L 0-40')];
    annotateCanonicalNames(candidates);
    expect(candidates[0]!.text).toBe('SGOT 24 U/L 0-40');
    expect(candidates[0]!.canonicalTestName).toBe('AST');
  });
});
