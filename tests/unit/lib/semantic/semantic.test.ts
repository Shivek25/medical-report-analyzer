/**
 * tests/unit/lib/semantic/semantic.test.ts
 *
 * Integration-style unit tests for the Phase 9 normalizeSemantic() orchestrator.
 *
 * Tests the full pipeline: section classification → canonicalization →
 * deduplication → QA report assembly.
 */

import { describe, it, expect } from 'vitest';
import { normalizeSemantic } from '../../../../src/lib/semantic/index.js';
import type { LabEntry, StructuredReport } from '../../../../src/lib/types/index.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeEntry(testName: string, category: string, overrides: Partial<LabEntry> = {}): LabEntry {
  return {
    testName,
    value: '5.4',
    unit: 'g/dL',
    category,
    uncertain: false,
    ...overrides,
  };
}

function makeReport(entries: LabEntry[], overrides: Partial<StructuredReport> = {}): StructuredReport {
  return {
    metadata: {},
    entries,
    extractionQuality: {
      totalRowsDetected: entries.length,
      successfullyParsed: entries.length,
      uncertainRows: 0,
      skippedRows: 0,
      ambiguousLines: [],
      warnings: [],
      confidence: 1.0,
      lowConfidence: false,
    },
    ...overrides,
  };
}

// ─── Tests: pipeline does not throw ──────────────────────────────────────────

describe('normalizeSemantic — safety contract', () => {
  it('never throws for an empty report', () => {
    const report = makeReport([]);
    expect(() => normalizeSemantic(report)).not.toThrow();
  });

  it('never throws for a healthy report', () => {
    const report = makeReport([
      makeEntry('Hemoglobin', 'Complete Blood Count'),
      makeEntry('Platelets', 'Complete Blood Count'),
    ]);
    expect(() => normalizeSemantic(report)).not.toThrow();
  });

  it('does not mutate the input report', () => {
    const entry = makeEntry('hb', 'Uncategorized');
    const report = makeReport([entry]);
    const originalName = report.entries[0]!.testName;
    normalizeSemantic(report);
    expect(report.entries[0]!.testName).toBe(originalName);
  });
});

// ─── Tests: canonicalization ──────────────────────────────────────────────────

describe('normalizeSemantic — canonicalization', () => {
  it('renames "hb" → "Hemoglobin"', () => {
    const report = makeReport([makeEntry('hb', 'Complete Blood Count')]);
    const { report: out, qa } = normalizeSemantic(report);
    expect(out.entries[0]!.testName).toBe('Hemoglobin');
    expect(qa.namesCanonicalizedCount).toBe(1);
    expect(qa.events.some(e => e.kind === 'name_canonicalized')).toBe(true);
  });

  it('canonicalizes multiple synonyms in one report', () => {
    const report = makeReport([
      makeEntry('hb',    'Complete Blood Count'),
      makeEntry('sgot',  'Liver Function Test'),
      makeEntry('hba1c', 'Biochemistry'),
    ]);
    const { qa } = normalizeSemantic(report);
    expect(qa.namesCanonicalizedCount).toBe(3);
  });

  it('leaves unknown names unchanged', () => {
    const report = makeReport([makeEntry('Total Body Fat', 'Uncategorized')]);
    const { report: out } = normalizeSemantic(report);
    expect(out.entries[0]!.testName).toBe('Total Body Fat');
  });
});

// ─── Tests: deduplication ─────────────────────────────────────────────────────

describe('normalizeSemantic — deduplication', () => {
  it('merges duplicate entries in same section', () => {
    const report = makeReport([
      makeEntry('Hemoglobin', 'Complete Blood Count', { value: '13.5', uncertain: false }),
      makeEntry('Hemoglobin', 'Complete Blood Count', { value: '13.5', uncertain: true }),
    ]);
    const { report: out, qa } = normalizeSemantic(report);
    expect(out.entries.filter(e => e.testName === 'Hemoglobin')).toHaveLength(1);
    expect(qa.duplicatesMergedCount).toBeGreaterThan(0);
  });

  it('suppresses Uncategorized copy when a medical-section copy exists after canonicalization', () => {
    // "hb" in Uncategorized + "Hemoglobin" in CBC → after canonicalization both
    // become "Hemoglobin"; cross-section dedup should keep the CBC one.
    const report = makeReport([
      makeEntry('hb',         'Uncategorized'),
      makeEntry('Hemoglobin', 'Complete Blood Count'),
    ]);
    const { report: out, qa } = normalizeSemantic(report);
    const hbEntries = out.entries.filter(e => e.testName === 'Hemoglobin');
    expect(hbEntries).toHaveLength(1);
    expect(hbEntries[0]!.category).toBe('Complete Blood Count');
    expect(qa.duplicatesMergedCount).toBeGreaterThan(0);
  });
});

// ─── Tests: section classification ───────────────────────────────────────────

describe('normalizeSemantic — section classification', () => {
  it('suppresses entries in noise sections', () => {
    const report = makeReport([
      makeEntry('Hemoglobin',   'Complete Blood Count'),
      makeEntry('Scan QR Code', 'Scan QR Code to verify'),  // noise
    ]);
    const { report: out, qa } = normalizeSemantic(report);
    expect(out.entries.some(e => e.category === 'Scan QR Code to verify')).toBe(false);
    expect(qa.suppressedCount).toBeGreaterThan(0);
  });

  it('moves pseudo-section entries to Uncategorized', () => {
    const report = makeReport([
      makeEntry('Hemoglobin', 'Aarogyam Pro'),
    ]);
    const { report: out, qa } = normalizeSemantic(report);
    expect(out.entries[0]!.category).toBe('Complete Blood Count');
    expect(qa.sectionsReclassifiedCount).toBeGreaterThan(0);
  });

  it('normalises all-caps medical category to title case', () => {
    const report = makeReport([
      makeEntry('Hemoglobin', 'COMPLETE BLOOD COUNT'),
    ]);
    const { report: out, qa } = normalizeSemantic(report);
    expect(out.entries[0]!.category).toBe('Complete Blood Count');
    expect(qa.categoriesNormalizedCount).toBeGreaterThan(0);
  });

  it('expands CBC alias to full name', () => {
    const report = makeReport([makeEntry('Hemoglobin', 'cbc')]);
    const { report: out } = normalizeSemantic(report);
    expect(out.entries[0]!.category).toBe('Complete Blood Count');
  });
});

// ─── Tests: QA report structure ───────────────────────────────────────────────

describe('normalizeSemantic — QA report', () => {
  it('qa.normalizedAt is a valid ISO date string', () => {
    const { qa } = normalizeSemantic(makeReport([]));
    expect(() => new Date(qa.normalizedAt)).not.toThrow();
    expect(new Date(qa.normalizedAt).getTime()).toBeGreaterThan(0);
  });

  it('qa.inputEntryCount matches report.entries.length', () => {
    const entries = [makeEntry('Hemoglobin', 'Complete Blood Count')];
    const { qa } = normalizeSemantic(makeReport(entries));
    expect(qa.inputEntryCount).toBe(1);
  });

  it('qa.outputEntryCount matches the returned report entry count', () => {
    const report = makeReport([makeEntry('Hemoglobin', 'Complete Blood Count')]);
    const { report: out, qa } = normalizeSemantic(report);
    expect(qa.outputEntryCount).toBe(out.entries.length);
  });

  it('every QA event has a non-empty reason', () => {
    const report = makeReport([
      makeEntry('hb',          'Complete Blood Count'),
      makeEntry('Hemoglobin',  'Uncategorized'),
      makeEntry('Marketing',   'Test Asked'),
    ]);
    const { qa } = normalizeSemantic(report);
    for (const event of qa.events) {
      expect(event.reason).toBeTruthy();
    }
  });

  it('name_canonicalized events carry sourceNames and canonicalName', () => {
    const report = makeReport([makeEntry('hb', 'Complete Blood Count')]);
    const { qa } = normalizeSemantic(report);
    const nameEvent = qa.events.find(e => e.kind === 'name_canonicalized');
    expect(nameEvent).toBeDefined();
    expect(nameEvent!.sourceNames).toContain('hb');
    expect(nameEvent!.canonicalName).toBe('Hemoglobin');
  });
});

// ─── Tests: existing clean PDFs still parse correctly (regression) ────────────

describe('normalizeSemantic — regression: clean reports pass through', () => {
  it('a report with no synonyms, no duplicates, and known categories is returned unchanged', () => {
    const entries: LabEntry[] = [
      makeEntry('Hemoglobin',    'Complete Blood Count', { value: '14.2', unit: 'g/dL' }),
      makeEntry('Platelets',     'Complete Blood Count', { value: '250', unit: '10³/µL' }),
      makeEntry('TSH',           'Thyroid Function Test', { value: '2.1', unit: 'mIU/L' }),
      makeEntry('LDL Cholesterol', 'Lipid Profile', { value: '120', unit: 'mg/dL' }),
    ];
    const report = makeReport(entries);
    const { report: out, qa } = normalizeSemantic(report);

    // All entries survive.
    expect(out.entries).toHaveLength(4);
    // No renaming needed.
    expect(qa.namesCanonicalizedCount).toBe(0);
    // No duplicates.
    expect(qa.duplicatesMergedCount).toBe(0);
    // No noise suppression.
    expect(qa.suppressedCount).toBe(0);
  });
});
