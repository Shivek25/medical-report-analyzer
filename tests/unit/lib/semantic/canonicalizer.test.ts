/**
 * tests/unit/lib/semantic/canonicalizer.test.ts
 *
 * Unit tests for the Phase 9 analyte canonicalizer.
 */

import { describe, it, expect } from 'vitest';
import { canonicalizeEntry, canonicalizeEntries } from '../../../../src/lib/semantic/canonicalizer.js';
import type { LabEntry } from '../../../../src/lib/types/index.js';

// ─── Fixture factory ──────────────────────────────────────────────────────────

function makeEntry(testName: string, overrides: Partial<LabEntry> = {}): LabEntry {
  return {
    testName,
    value: '5.4',
    unit: 'g/dL',
    category: 'Uncategorized',
    uncertain: false,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('canonicalizeEntry', () => {
  it('renames a known synonym to canonical name', () => {
    const entry = makeEntry('hb');
    const { entry: out, event } = canonicalizeEntry(entry);
    expect(out.testName).toBe('Hemoglobin');
    expect(event).toBeDefined();
    expect(event!.kind).toBe('name_canonicalized');
    expect(event!.sourceNames).toContain('hb');
    expect(event!.canonicalName).toBe('Hemoglobin');
    expect(event!.reason).toContain('"hb" → "Hemoglobin"');
  });

  it('does not mutate the input entry', () => {
    const entry = makeEntry('sgot');
    canonicalizeEntry(entry);
    expect(entry.testName).toBe('sgot'); // unchanged
  });

  it('preserves all other fields when renaming', () => {
    const entry = makeEntry('sgot', { value: '42', unit: 'U/L', uncertain: true, category: 'Liver Function Test' });
    const { entry: out } = canonicalizeEntry(entry);
    expect(out.testName).toBe('AST');
    expect(out.value).toBe('42');
    expect(out.unit).toBe('U/L');
    expect(out.uncertain).toBe(true);
    expect(out.category).toBe('Liver Function Test');
  });

  it('returns original entry and no event for an unknown name', () => {
    const entry = makeEntry('Total Body Fat');
    const { entry: out, event } = canonicalizeEntry(entry);
    expect(out.testName).toBe('Total Body Fat');
    expect(event).toBeUndefined();
  });

  it('returns original entry and no event when name is already canonical', () => {
    const entry = makeEntry('Hemoglobin');
    const { entry: out, event } = canonicalizeEntry(entry);
    expect(out).toBe(entry); // same reference — not copied unnecessarily
    expect(event).toBeUndefined();
  });

  it('handles case-insensitive resolution', () => {
    const entry = makeEntry('HBa1C');
    const { entry: out } = canonicalizeEntry(entry);
    expect(out.testName).toBe('HbA1c');
  });
});

describe('canonicalizeEntries', () => {
  it('processes a mixed array correctly', () => {
    const entries = [
      makeEntry('hb'),
      makeEntry('Total Body Fat'),
      makeEntry('sgot'),
      makeEntry('Platelets'),
    ];

    const { entries: out, events } = canonicalizeEntries(entries);
    expect(out.map(e => e.testName)).toEqual(['Hemoglobin', 'Total Body Fat', 'AST', 'Platelets']);
    // Only 2 renames (hb → Hemoglobin, sgot → AST)
    expect(events).toHaveLength(2);
    expect(events.every(ev => ev.kind === 'name_canonicalized')).toBe(true);
  });

  it('returns an empty events array when no renames occur', () => {
    const entries = [makeEntry('Unknown Test A'), makeEntry('Unknown Test B')];
    const { events } = canonicalizeEntries(entries);
    expect(events).toHaveLength(0);
  });

  it('does not mutate input entries', () => {
    const entries = [makeEntry('hb'), makeEntry('sgot')];
    canonicalizeEntries(entries);
    expect(entries[0]!.testName).toBe('hb');
    expect(entries[1]!.testName).toBe('sgot');
  });
});
