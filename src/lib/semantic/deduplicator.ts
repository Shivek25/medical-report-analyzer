/**
 * src/lib/semantic/deduplicator.ts
 *
 * Phase 9 — Duplicate analyte finder and merger.
 *
 * After canonicalization, two or more entries may now share the same testName
 * (e.g. "Hemoglobin" appeared on page 1 and again on page 3 with the same
 * value). This module:
 *
 *  1. Groups entries by (canonicalTestName, category) key.
 *  2. Within each group, selects the single best entry.
 *  3. Emits a `duplicate_merged` QAEvent for every group that had >1 entry.
 *
 * Tie-breaking rules (applied in order):
 *  a. Prefer non-uncertain over uncertain.
 *  b. Prefer the entry with a referenceRange.
 *  c. Prefer the entry with a unit.
 *  d. Prefer the entry with a non-empty value.
 *  e. Prefer the entry that appeared earlier (lower index) as a tiebreaker.
 *
 * Cross-category deduplication (same analyte in different sections):
 *  When the same canonical name appears in two DIFFERENT categories, we treat
 *  the cross-category pair as a separate case:
 *  - If one is "Uncategorized" and the other is a real medical category, we
 *    keep the medical-category entry and suppress the Uncategorized one.
 *  - If both have real (different) medical categories, we keep both — they
 *    may be legitimately separate panels (e.g. "Calcium" in Renal and in
 *    Bone Profile).
 *
 * Pure: same input → same output. No I/O, no shared mutable state.
 */

import type { LabEntry } from '../types/index.js';
import type { QAEvent } from './types.js';

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Compute a quality score for an entry.
 * Higher is better. Used to pick the best entry within a duplicate group.
 */
function scoreEntry(e: LabEntry): number {
  let score = 0;
  if (!e.uncertain)                    score += 8;
  if (e.referenceRange !== undefined)  score += 4;
  if (e.unit !== undefined && e.unit !== '') score += 2;
  if (e.value !== '' && e.value !== undefined) score += 1;
  return score;
}

// ─── Grouping key ─────────────────────────────────────────────────────────────

/**
 * The deduplication key for same-section duplicates.
 * We normalise testName to lower-case so minor casing differences after
 * canonicalization do not prevent merging.
 */
function sameGroupKey(e: LabEntry): string {
  return `${e.testName.toLowerCase()}::${e.category.toLowerCase()}`;
}

/**
 * A cross-section key (ignores category) — used to detect the
 * same analyte appearing in a real section AND in "Uncategorized".
 */
function crossGroupKey(e: LabEntry): string {
  return e.testName.toLowerCase();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface DeduplicateResult {
  entries: LabEntry[];
  events: QAEvent[];
}

/**
 * Deduplicate a list of LabEntries.
 *
 * Two passes:
 *  Pass 1 — Within-section deduplication: same (testName, category) → keep best.
 *  Pass 2 — Cross-section deduplication: same testName in real section + in
 *            "Uncategorized" → keep the real-section copy.
 *
 * @param entries - Canonicalized entries (testNames already normalised).
 * @returns `{ entries, events }` where events describes every merge.
 */
export function deduplicateEntries(entries: ReadonlyArray<LabEntry>): DeduplicateResult {
  const events: QAEvent[] = [];

  // ── Pass 1: Within-section deduplication ──────────────────────────────────
  // Group by (testName, category). For each group with > 1 member, pick the
  // best and suppress the rest.
  const sameGroupMap = new Map<string, LabEntry[]>();
  for (const e of entries) {
    const key = sameGroupKey(e);
    const bucket = sameGroupMap.get(key);
    if (bucket) {
      bucket.push(e);
    } else {
      sameGroupMap.set(key, [e]);
    }
  }

  const afterPass1: LabEntry[] = [];
  for (const group of sameGroupMap.values()) {
    if (group.length === 1) {
      afterPass1.push(group[0]!);
      continue;
    }

    // Sort descending by score; stable sort preserves original order as tiebreaker.
    const sorted = group.slice().sort((a, b) => scoreEntry(b) - scoreEntry(a));
    const kept = sorted[0]!;
    const dropped = sorted.slice(1);

    afterPass1.push(kept);

    // Emit one merge event per dropped entry.
    for (const d of dropped) {
      events.push({
        kind: 'duplicate_merged',
        reason: `Duplicate analyte "${d.testName}" in section "${d.category}" (kept higher-quality entry; score: kept=${scoreEntry(kept)}, dropped=${scoreEntry(d)})`,
        sourceNames: [d.testName, kept.testName],
        canonicalName: kept.testName,
        suppressedEntry: d,
      });
    }
  }

  // ── Pass 2: Cross-section Uncategorized suppression ───────────────────────
  // If the same analyte appears in a real medical section AND in Uncategorized,
  // the Uncategorized copy is likely a layout artifact — suppress it.
  const crossGroupMap = new Map<string, LabEntry[]>();
  for (const e of afterPass1) {
    const key = crossGroupKey(e);
    const bucket = crossGroupMap.get(key);
    if (bucket) {
      bucket.push(e);
    } else {
      crossGroupMap.set(key, [e]);
    }
  }

  const afterPass2: LabEntry[] = [];
  const UNCATEGORIZED = 'uncategorized';

  for (const group of crossGroupMap.values()) {
    if (group.length === 1) {
      afterPass2.push(group[0]!);
      continue;
    }

    // Separate Uncategorized copies from categorized copies.
    const categorized   = group.filter(e => e.category.toLowerCase() !== UNCATEGORIZED);
    const uncategorized = group.filter(e => e.category.toLowerCase() === UNCATEGORIZED);

    if (categorized.length > 0 && uncategorized.length > 0) {
      // Keep all categorized copies; suppress the Uncategorized ones.
      afterPass2.push(...categorized);

      for (const u of uncategorized) {
        events.push({
          kind: 'duplicate_merged',
          reason: `Analyte "${u.testName}" already exists in a medical section "${categorized[0]!.category}"; Uncategorized copy suppressed as layout artifact`,
          sourceNames: [u.testName, categorized[0]!.testName],
          canonicalName: categorized[0]!.testName,
          suppressedEntry: u,
        });
      }
    } else {
      // All copies are in the same effective category-class; keep all.
      afterPass2.push(...group);
    }
  }

  return { entries: afterPass2, events };
}
