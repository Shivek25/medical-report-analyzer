/**
 * tests/unit/lib/semantic/ontology.test.ts
 *
 * Unit tests for the Phase 9 analyte ontology.
 *
 * Tests:
 *  - Known synonyms resolve to the correct canonical name.
 *  - Canonical names resolve to themselves.
 *  - Unknown strings return undefined.
 *  - Case-insensitive resolution works.
 *  - Prefix matching works for names with trailing annotations.
 */

import { describe, it, expect } from 'vitest';
import { resolveCanonicalAnalyte, ANALYTE_SYNONYM_MAP } from '../../../../src/lib/semantic/ontology.js';

describe('resolveCanonicalAnalyte', () => {
  // ── Canonical names resolve to themselves ──────────────────────────────────
  it.each([
    ['Hemoglobin'],
    ['HbA1c'],
    ['LDL Cholesterol'],
    ['TSH'],
    ['Vitamin D'],
  ])('canonical name "%s" resolves to itself', (name) => {
    expect(resolveCanonicalAnalyte(name)).toBe(name);
  });

  // ── Abbreviations ──────────────────────────────────────────────────────────
  it.each([
    ['hb',   'Hemoglobin'],
    ['hgb',  'Hemoglobin'],
    ['rbc',  'Red Blood Cells'],
    ['wbc',  'White Blood Cells'],
    ['plt',  'Platelets'],
    ['mcv',  'Mean Corpuscular Volume'],
    ['mch',  'Mean Corpuscular Hemoglobin'],
    ['mchc', 'Mean Corpuscular Hemoglobin Concentration'],
    ['rdw',  'Red Cell Distribution Width'],
    ['fbs',  'Glucose (Fasting)'],
    ['rbs',  'Glucose (Random)'],
    ['hba1c','HbA1c'],
    ['a1c',  'HbA1c'],
    ['hdl',  'HDL Cholesterol'],
    ['ldl',  'LDL Cholesterol'],
    ['tg',   'Triglycerides'],
    ['sgot', 'AST'],
    ['sgpt', 'ALT'],
    ['alp',  'Alkaline Phosphatase'],
    ['tsh',  'TSH'],
    ['ft3',  'Free T3'],
    ['ft4',  'Free T4'],
    ['egfr', 'eGFR'],
    ['bun',  'Blood Urea Nitrogen'],
    ['ggt',  'GGT'],
    ['anc',  'Absolute Neutrophil Count'],
    ['alc',  'Absolute Lymphocyte Count'],
    ['esR',  'ESR'],  // case-insensitive
  ])('abbreviation "%s" → "%s"', (abbr, expected) => {
    expect(resolveCanonicalAnalyte(abbr)).toBe(expected);
  });

  // ── Full synonym phrases ──────────────────────────────────────────────────
  it.each([
    ['haemoglobin',                   'Hemoglobin'],
    ['haematocrit',                   'Hematocrit'],
    ['packed cell volume',            'Hematocrit'],
    ['total leukocyte count',         'White Blood Cells'],
    ['fasting blood sugar',           'Glucose (Fasting)'],
    ['glycated hemoglobin',           'HbA1c'],
    ['high density lipoprotein',      'HDL Cholesterol'],
    ['low density lipoprotein',       'LDL Cholesterol'],
    ['serum creatinine',              'Creatinine'],
    ['aspartate aminotransferase',    'AST'],
    ['alanine aminotransferase',      'ALT'],
    ['gamma glutamyl transferase',    'GGT'],
    ['thyroid stimulating hormone',   'TSH'],
    ['25-oh vitamin d',               'Vitamin D'],
    ['25 oh vitamin d',               'Vitamin D'],
    ['high sensitivity crp',          'hs-CRP'],
    ['lipoprotein a',                 'Lipoprotein(a)'],
    ['prostate specific antigen',     'PSA'],
    ['erythrocyte sedimentation rate','ESR'],
  ])('full synonym "%s" → "%s"', (syn, expected) => {
    expect(resolveCanonicalAnalyte(syn)).toBe(expected);
  });

  // ── Case insensitivity ────────────────────────────────────────────────────
  it('resolves regardless of input case', () => {
    expect(resolveCanonicalAnalyte('HEMOGLOBIN')).toBe('Hemoglobin');
    expect(resolveCanonicalAnalyte('Hba1C')).toBe('HbA1c');
    expect(resolveCanonicalAnalyte('LDL CHOLESTEROL')).toBe('LDL Cholesterol');
  });

  // ── Prefix match (trailing annotations) ──────────────────────────────────
  it('resolves "Hemoglobin (Hb)" via prefix match', () => {
    // "haemoglobin (hb)" is an exact synonym; also test a generic trailing annotation
    expect(resolveCanonicalAnalyte('hemoglobin (hb)')).toBe('Hemoglobin');
  });

  it('resolves "25-OH Vitamin D (Total)" via prefix matching', () => {
    expect(resolveCanonicalAnalyte('25-OH Vitamin D (Total)')).toBe('Vitamin D');
  });

  // ── Unknown names → undefined ─────────────────────────────────────────────
  it.each([
    [''],
    ['   '],
    ['Total Body Fat'],
    ['XYZZY'],
  ])('unknown name "%s" → undefined', (name) => {
    expect(resolveCanonicalAnalyte(name)).toBeUndefined();
  });

  // ── Map coverage: every synonym in the dictionary resolves correctly ──────
  it('every synonym in ANALYTE_SYNONYM_MAP resolves to its canonical', () => {
    for (const [canonical, synonyms] of ANALYTE_SYNONYM_MAP) {
      for (const syn of synonyms) {
        const result = resolveCanonicalAnalyte(syn);
        expect(result, `Synonym "${syn}" should resolve to "${canonical}"`).toBe(canonical);
      }
    }
  });
});
