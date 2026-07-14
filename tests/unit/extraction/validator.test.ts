/**
 * tests/unit/extraction/validator.test.ts
 *
 * Unit tests for the Phase 6 validation gate. The gate is the hard
 * anti-fabrication + noise-rejection boundary, so these tests pin its
 * accept/reject decisions on the exact leakage shapes the deterministic parser
 * was letting through on unfamiliar layouts.
 */

import { describe, it, expect } from 'vitest';
import { validateLabResult } from '../../../src/lib/extraction/validator.js';
import type { CandidateBlock, LabeledItem } from '../../../src/lib/extraction/types.js';

/** Build a lab_result LabeledItem for testing. */
function makeItem(overrides: Partial<LabeledItem>): LabeledItem {
  return {
    blockIndex: 0,
    label: 'lab_result',
    evidence: '',
    confidence: 0.9,
    reason: 'test',
    ...overrides,
  };
}

/** Build a candidate block whose `text` carries the evidence verbatim. */
function makeBlock(text: string, lineStart = 0): CandidateBlock {
  return { text, lineStart, lineEnd: lineStart, page: undefined };
}

describe('validateLabResult', () => {
  // ── Acceptance: genuine evidence-backed rows ──────────────────────────────

  it('accepts a genuine numeric lab row with unit + range', () => {
    const text = 'HEMOGLOBIN 13.2 g/dL 13.0-17.0';
    const res = validateLabResult(
      makeItem({
        evidence: text,
        normalized: { testName: 'HEMOGLOBIN', value: '13.2', unit: 'g/dL', referenceRange: { text: '13.0-17.0' } },
      }),
      makeBlock(text),
    );
    expect(res.accepted).toBe(true);
    expect(res.entry).toBeDefined();
    expect(res.entry!.testName).toBe('HEMOGLOBIN');
    expect(res.entry!.value).toBe('13.2');
    expect(res.entry!.uncertain).toBe(false);
    expect(res.entry!.notes).toMatch(/phase6:llm/);
  });

  it('accepts a qualitative lab row (Negative)', () => {
    const text = 'Hepatitis B Surface Antigen 0.2 Negative';
    const res = validateLabResult(
      makeItem({
        evidence: text,
        normalized: { testName: 'Hepatitis B Surface Antigen', value: 'Negative' },
      }),
      makeBlock(text),
    );
    expect(res.accepted).toBe(true);
    expect(res.entry!.value).toBe('Negative');
  });

  // ── Rejection: anti-fabrication (values not in evidence) ──────────────────

  it('rejects a fabricated value not present in the evidence', () => {
    const text = 'HEMOGLOBIN 13.2 g/dL 13.0-17.0';
    const res = validateLabResult(
      makeItem({
        evidence: text,
        normalized: { testName: 'HEMOGLOBIN', value: '99.9' },
      }),
      makeBlock(text),
    );
    expect(res.accepted).toBe(false);
    expect(res.rejectionReason).toContain('value not found');
  });

  it('rejects a fabricated unit not present in the evidence', () => {
    const text = 'HEMOGLOBIN 13.2 g/dL 13.0-17.0';
    const res = validateLabResult(
      makeItem({
        evidence: text,
        normalized: { testName: 'HEMOGLOBIN', value: '13.2', unit: 'mmol/L' },
      }),
      makeBlock(text),
    );
    expect(res.accepted).toBe(false);
    expect(res.rejectionReason).toContain('unit not found');
  });

  it('rejects an evidence string that does not occur in the block', () => {
    const res = validateLabResult(
      makeItem({
        evidence: 'GLUCOSE 5.4 mmol/L',
        normalized: { testName: 'GLUCOSE', value: '5.4', unit: 'mmol/L' },
      }),
      makeBlock('TOTALLY DIFFERENT LINE'),
    );
    expect(res.accepted).toBe(false);
    expect(res.rejectionReason).toContain('evidence not found');
  });

  // ── Rejection: noise / descriptors / boilerplate leakage ──────────────────

  it('rejects a descriptor testName (Calculated)', () => {
    const res = validateLabResult(
      makeItem({
        evidence: 'Calculated',
        normalized: { testName: 'Calculated', value: '1.5' },
      }),
      makeBlock('Calculated 1.5'),
    );
    expect(res.accepted).toBe(false);
    // Either the noise-row guard or the generic-descriptor guard is acceptable;
    // both correctly keep the descriptor out of findings.
    expect(res.rejectionReason).toMatch(/noise row|generic descriptor/);
  });

  it('rejects a unit-only testName', () => {
    const res = validateLabResult(
      makeItem({
        evidence: 'mg/dL 1.5',
        normalized: { testName: 'mg/dL', value: '1.5' },
      }),
      makeBlock('mg/dL 1.5'),
    );
    expect(res.accepted).toBe(false);
  });

  it('rejects a testName with no 3+ letter alphabetic run', () => {
    const res = validateLabResult(
      makeItem({
        evidence: 'XY 5.2',
        normalized: { testName: 'XY', value: '5.2' },
      }),
      makeBlock('XY 5.2'),
    );
    expect(res.accepted).toBe(false);
    expect(res.rejectionReason).toContain('3+ letter');
  });

  it('rejects when the evidence itself is a noise row', () => {
    const res = validateLabResult(
      makeItem({
        evidence: 'phone 1800-123-4567',
        normalized: { testName: 'phone', value: '1800' },
      }),
      makeBlock('phone 1800-123-4567'),
    );
    expect(res.accepted).toBe(false);
    expect(res.rejectionReason).toContain('noise row');
  });

  it('rejects when the evidence is a descriptor / column label line', () => {
    const res = validateLabResult(
      makeItem({
        evidence: 'TECHNOLOGY',
        normalized: { testName: 'TECHNOLOGY', value: '1.0' },
      }),
      makeBlock('TECHNOLOGY 1.0'),
    );
    expect(res.accepted).toBe(false);
  });

  it('rejects a section/panel header testName (RENAL) even with a value', () => {
    const res = validateLabResult(
      makeItem({
        evidence: 'RENAL 99.9',
        normalized: { testName: 'RENAL', value: '99.9' },
      }),
      makeBlock('RENAL 99.9'),
    );
    expect(res.accepted).toBe(false);
    expect(res.rejectionReason).toContain('section/header/column-label');
  });

  it('rejects a label-like testName with a trailing colon (Male:)', () => {
    const res = validateLabResult(
      makeItem({
        evidence: 'Male: 86-152',
        normalized: { testName: 'Male:', value: '86', referenceRange: { text: '86-152' } },
      }),
      makeBlock('Male: 86-152'),
    );
    expect(res.accepted).toBe(false);
    expect(res.rejectionReason).toContain('trailing colon');
  });

  it('rejects a wellness-domain score (numeric value with no unit/range)', () => {
    const res = validateLabResult(
      makeItem({
        evidence: 'SUGAR CONTROL 100',
        normalized: { testName: 'SUGAR CONTROL', value: '100' },
      }),
      makeBlock('SUGAR CONTROL 100'),
    );
    expect(res.accepted).toBe(false);
    expect(res.rejectionReason).toContain('without unit or reference range');
  });

  it('rejects a repeated-token artefact (OptimalOptimalOptimal)', () => {
    const res = validateLabResult(
      makeItem({
        evidence: 'OptimalOptimalOptimal 13',
        normalized: { testName: 'OptimalOptimalOptimal', value: '13' },
      }),
      makeBlock('OptimalOptimalOptimal 13'),
    );
    expect(res.accepted).toBe(false);
    expect(res.rejectionReason).toContain('repeated-token');
  });

  // ── Rejection: missing value (no fabrication) ─────────────────────────────

  it('rejects an empty value rather than inventing one', () => {
    const res = validateLabResult(
      makeItem({
        evidence: 'HEMOGLOBIN',
        normalized: { testName: 'HEMOGLOBIN', value: '' },
      }),
      makeBlock('HEMOGLOBIN'),
    );
    expect(res.accepted).toBe(false);
    expect(res.rejectionReason).toContain('empty value');
  });

  it('rejects a non-numeric, non-qualitative value', () => {
    const res = validateLabResult(
      makeItem({
        evidence: 'SOME TEST present-ish',
        normalized: { testName: 'SOME TEST', value: 'present-ish' },
      }),
      makeBlock('SOME TEST present-ish'),
    );
    expect(res.accepted).toBe(false);
    expect(res.rejectionReason).toContain('neither numeric nor qualitative');
  });

  // ── Shape guard: not a lab_result label ───────────────────────────────────

  it('rejects an item whose label is not lab_result', () => {
    const res = validateLabResult(
      makeItem({ label: 'noise', evidence: 'x' }),
      makeBlock('x'),
    );
    expect(res.accepted).toBe(false);
  });
});
