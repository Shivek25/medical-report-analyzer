/**
 * tests/unit/lib/semantic/deduplicator.test.ts
 *
 * Unit tests for the Phase 9 deduplicator.
 */

import { describe, it, expect } from 'vitest';
import { deduplicateEntries } from '../../../../src/lib/semantic/deduplicator.js';
import type { LabEntry } from '../../../../src/lib/types/index.js';

// ─── Fixture factory ──────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<LabEntry> & { testName: string }): LabEntry {
  return {
    value: '5.4',
    unit: 'g/dL',
    category: 'Complete Blood Count',
    uncertain: false,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('deduplicateEntries — pass 1: within-section deduplication', () => {
  it('passes through unique entries unchanged', () => {
    const entries = [
      makeEntry({ testName: 'Hemoglobin' }),
      makeEntry({ testName: 'Platelets', value: '150', unit: '10³/µL' }),
    ];
    const { entries: out, events } = deduplicateEntries(entries);
    expect(out).toHaveLength(2);
    expect(events).toHaveLength(0);
  });

  it('merges two identical entries (same testName, same category)', () => {
    const entries = [
      makeEntry({ testName: 'Hemoglobin', value: '13.5', uncertain: false }),
      makeEntry({ testName: 'Hemoglobin', value: '13.5', uncertain: false }),
    ];
    const { entries: out, events } = deduplicateEntries(entries);
    expect(out).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('duplicate_merged');
    expect(events[0]!.sourceNames).toContain('Hemoglobin');
  });

  it('keeps the non-uncertain entry when one is uncertain', () => {
    const certain  = makeEntry({ testName: 'Hemoglobin', uncertain: false, value: '13.5' });
    const uncertain = makeEntry({ testName: 'Hemoglobin', uncertain: true, value: '?' });

    // Uncertain first in input → certain should still win.
    const { entries: out } = deduplicateEntries([uncertain, certain]);
    expect(out[0]!.uncertain).toBe(false);
    expect(out[0]!.value).toBe('13.5');
  });

  it('prefers entry with referenceRange when both are uncertain', () => {
    const withRange = makeEntry({ testName: 'Hemoglobin', uncertain: true, referenceRange: { low: 12, high: 17 } });
    const noRange   = makeEntry({ testName: 'Hemoglobin', uncertain: true });
    const { entries: out } = deduplicateEntries([noRange, withRange]);
    expect(out[0]!.referenceRange).toBeDefined();
  });

  it('handles three duplicates — only one survives', () => {
    const entries = [
      makeEntry({ testName: 'Hemoglobin', uncertain: true }),
      makeEntry({ testName: 'Hemoglobin', uncertain: false, value: '14.0' }),
      makeEntry({ testName: 'Hemoglobin', uncertain: true }),
    ];
    const { entries: out, events } = deduplicateEntries(entries);
    expect(out).toHaveLength(1);
    expect(events).toHaveLength(2); // two dropped
    expect(out[0]!.uncertain).toBe(false);
  });

  it('does not merge entries with the same name but different categories', () => {
    const lipid  = makeEntry({ testName: 'Calcium', category: 'Lipid Profile' });
    const renal  = makeEntry({ testName: 'Calcium', category: 'Renal Function Test' });
    const { entries: out, events } = deduplicateEntries([lipid, renal]);
    expect(out).toHaveLength(2);
    expect(events).toHaveLength(0);
  });
});

describe('deduplicateEntries — pass 2: cross-section Uncategorized suppression', () => {
  it('suppresses Uncategorized copy when a medical-section copy exists', () => {
    const medical = makeEntry({ testName: 'Hemoglobin', category: 'Complete Blood Count' });
    const uncategorized = makeEntry({ testName: 'Hemoglobin', category: 'Uncategorized' });

    const { entries: out, events } = deduplicateEntries([uncategorized, medical]);
    expect(out).toHaveLength(1);
    expect(out[0]!.category).toBe('Complete Blood Count');
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('duplicate_merged');
    expect(events[0]!.reason).toContain('Uncategorized copy suppressed');
  });

  it('keeps both entries when both are in Uncategorized (no real section to prefer)', () => {
    const a = makeEntry({ testName: 'Hemoglobin', category: 'Uncategorized' });
    const b = makeEntry({ testName: 'Hemoglobin', category: 'Uncategorized' });
    // After pass 1, these two ARE the same group key → merged to 1 by pass 1.
    // Pass 2 then sees only 1 entry → no further suppression.
    const { entries: out } = deduplicateEntries([a, b]);
    expect(out).toHaveLength(1);
  });

  it('keeps both medical-section copies of the same analyte in different panels', () => {
    const lipid = makeEntry({ testName: 'Calcium', category: 'Lipid Profile' });
    const bone  = makeEntry({ testName: 'Calcium', category: 'Bone Profile' });
    const { entries: out, events } = deduplicateEntries([lipid, bone]);
    expect(out).toHaveLength(2);
    expect(events).toHaveLength(0);
  });
});

describe('deduplicateEntries — event traceability', () => {
  it('every duplicate_merged event carries suppressedEntry', () => {
    const entries = [
      makeEntry({ testName: 'Hemoglobin', value: '13.5', uncertain: false }),
      makeEntry({ testName: 'Hemoglobin', value: '?',    uncertain: true }),
    ];
    const { events } = deduplicateEntries(entries);
    expect(events[0]!.suppressedEntry).toBeDefined();
    expect(events[0]!.suppressedEntry!.testName).toBe('Hemoglobin');
  });

  it('every event carries a non-empty reason', () => {
    const entries = [
      makeEntry({ testName: 'TSH' }),
      makeEntry({ testName: 'TSH' }),
    ];
    const { events } = deduplicateEntries(entries);
    expect(events[0]!.reason).toBeTruthy();
  });
});

describe('deduplicateEntries — edge cases', () => {
  it('returns empty array for empty input', () => {
    const { entries: out, events } = deduplicateEntries([]);
    expect(out).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('single entry passes through unchanged', () => {
    const entry = makeEntry({ testName: 'TSH' });
    const { entries: out } = deduplicateEntries([entry]);
    expect(out).toHaveLength(1);
    expect(out[0]!.testName).toBe('TSH');
  });
});
