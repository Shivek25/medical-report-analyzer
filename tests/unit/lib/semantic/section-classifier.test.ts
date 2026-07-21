/**
 * tests/unit/lib/semantic/section-classifier.test.ts
 *
 * Unit tests for the Phase 9 section classifier.
 */

import { describe, it, expect } from 'vitest';
import { classifySection, effectiveCategoryFor } from '../../../../src/lib/semantic/section-classifier.js';

describe('classifySection', () => {
  // ── Medical sections ──────────────────────────────────────────────────────
  it.each([
    ['Complete Blood Count',        'Complete Blood Count'],
    ['Lipid Profile',               'Lipid Profile'],
    ['Renal Function Test',         'Renal Function Test'],
    ['Liver Function Test',         'Liver Function Test'],
    ['Thyroid Function Test',       'Thyroid Function Test'],
    ['Uncategorized',               'Uncategorized'],
    ['Biochemistry',                'Biochemistry'],
    ['Electrolytes',                'Electrolytes'],
    ['Iron Profile',                'Iron Profile'],
  ])('"%s" is classified as medical', (raw, expectedCanonical) => {
    const result = classifySection(raw);
    expect(result.kind).toBe('medical');
    expect(result.canonicalCategory).toBe(expectedCanonical);
  });

  // ── All-caps medical sections are title-cased ─────────────────────────────
  it.each([
    ['LIPID PROFILE',              'Lipid Profile'],
    ['COMPLETE BLOOD COUNT',       'Complete Blood Count'],
    ['RENAL FUNCTION TEST',        'Renal Function Test'],
    ['THYROID FUNCTION TEST',      'Thyroid Function Test'],
  ])('all-caps "%s" is normalised to title case "%s"', (raw, expected) => {
    const result = classifySection(raw);
    expect(result.kind).toBe('medical');
    expect(result.canonicalCategory).toBe(expected);
  });

  // ── Category aliases ──────────────────────────────────────────────────────
  it.each([
    ['cbc',  'Complete Blood Count'],
    ['CBC',  'Complete Blood Count'],
    ['lft',  'Liver Function Test'],
    ['rft',  'Renal Function Test'],
    ['kft',  'Renal Function Test'],
    ['tft',  'Thyroid Function Test'],
    ['lipids', 'Lipid Profile'],
  ])('alias "%s" maps to canonical "%s"', (alias, expected) => {
    const result = classifySection(alias);
    expect(result.kind).toBe('medical');
    expect(result.canonicalCategory).toBe(expected);
  });

  // ── Noise sections ────────────────────────────────────────────────────────
  it.each([
    ['Test Asked'],
    ['Test Asked By Doctor'],
    ['Report Remarks'],
    ['Note:'],
    ['Disclaimer'],
    ['Patient Information'],
    ['Sample Information'],
    ['Scan QR Code to verify'],
  ])('"%s" is classified as noise', (raw) => {
    const result = classifySection(raw);
    expect(result.kind).toBe('noise');
  });

  // ── Pseudo sections ───────────────────────────────────────────────────────
  it.each([
    ['Aarogyam Pro'],
    ['Aarogyam Basic'],
    ['Full Body Checkup'],
    ['Master Health'],
    ['Wellness Package'],
    ['Premium Health Plan'],
    ['180 Tests'],
  ])('"%s" is classified as pseudo', (raw) => {
    const result = classifySection(raw);
    expect(result.kind).toBe('pseudo');
  });

  // ── Unknown sections fall back to pseudo, not noise ───────────────────────
  it('unknown section heading falls back to pseudo', () => {
    const result = classifySection('Xyzzy Panel');
    expect(result.kind).toBe('pseudo');
    expect(result.reason).toContain('Unknown section heading');
  });

  // ── QA reason is always a non-empty string ────────────────────────────────
  it('always returns a non-empty reason', () => {
    for (const raw of ['LIPID PROFILE', 'Aarogyam Pro', 'Test Asked', 'Xyzzy']) {
      const result = classifySection(raw);
      expect(result.reason).toBeTruthy();
    }
  });
});

describe('effectiveCategoryFor', () => {
  it('returns canonicalCategory for medical sections', () => {
    const cls = classifySection('LIPID PROFILE');
    expect(effectiveCategoryFor(cls)).toBe('Lipid Profile');
  });

  it('returns Uncategorized for pseudo sections', () => {
    const cls = classifySection('Aarogyam Pro');
    expect(effectiveCategoryFor(cls)).toBe('Uncategorized');
  });

  it('returns Suppressed for noise sections', () => {
    const cls = classifySection('Test Asked');
    expect(effectiveCategoryFor(cls)).toBe('Suppressed');
  });
});
