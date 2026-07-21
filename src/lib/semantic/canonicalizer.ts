/**
 * src/lib/semantic/canonicalizer.ts
 *
 * Phase 9 — Analyte name canonicalizer.
 *
 * Maps raw LabEntry.testName values to their canonical forms using the
 * ANALYTE_SYNONYM_MAP defined in ontology.ts. Also strips stray trailing
 * noise that slips through the field-extractor (e.g. embedded method
 * descriptors that the ontology knows about by prefix matching).
 *
 * Design rules:
 *  - Conservative: only rename when the match is unambiguous.
 *  - Never invent or infer a value — only the name is touched.
 *  - If no canonical mapping exists, the entry is returned unchanged.
 *  - Emits a QAEvent for every rename.
 *
 * Pure: same input → same output. No I/O, no shared mutable state.
 */

import type { LabEntry } from '../types/index.js';
import type { QAEvent } from './types.js';
import { resolveCanonicalAnalyte } from './ontology.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CanonicalizeResult {
  /** Updated entry (may be the same object if no change was made). */
  entry: LabEntry;
  /** QA event describing the rename, or undefined if no change. */
  event: QAEvent | undefined;
}

/**
 * Attempt to canonicalize the `testName` of a single LabEntry.
 *
 * @param entry - The input LabEntry (not mutated).
 * @returns A new entry with the canonical name (or the original if no mapping
 *          found), and an optional QAEvent for the change.
 */
export function canonicalizeEntry(entry: LabEntry): CanonicalizeResult {
  const rawName = entry.testName.trim();
  const canonical = resolveCanonicalAnalyte(rawName);

  if (!canonical || canonical === rawName) {
    return { entry, event: undefined };
  }

  const updated: LabEntry = { ...entry, testName: canonical };
  const event: QAEvent = {
    kind: 'name_canonicalized',
    reason: `Mapped "${rawName}" → "${canonical}" via analyte ontology`,
    sourceNames: [rawName],
    canonicalName: canonical,
  };

  return { entry: updated, event };
}

/**
 * Canonicalize an array of LabEntries in place (returns new entries array).
 *
 * @param entries - Input entries.
 * @returns `{ entries, events }` where events contains one event per rename.
 */
export function canonicalizeEntries(entries: ReadonlyArray<LabEntry>): {
  entries: LabEntry[];
  events: QAEvent[];
} {
  const resultEntries: LabEntry[] = [];
  const events: QAEvent[] = [];

  for (const entry of entries) {
    const { entry: updated, event } = canonicalizeEntry(entry);
    resultEntries.push(updated);
    if (event !== undefined) {
      events.push(event);
    }
  }

  return { entries: resultEntries, events };
}
