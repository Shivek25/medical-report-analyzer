/**
 * src/lib/summarizer/classifier.ts
 *
 * Pure function that classifies a `LabEntry` into a severity bucket.
 *
 * Classification order:
 *   1. Flag-based (if `entry.flag` is present)
 *   2. Numeric comparison against reference range (with borderline detection)
 *   3. Safe fallback → 'normal' (never fabricate abnormality)
 *
 * Returns 'skipped' when the entry cannot be meaningfully classified
 * (e.g. non-numeric value with no flag).
 */

import type { LabEntry, FindingSeverity } from '../types/index.js';

/** Result of classification: a severity, 'normal', or 'skipped'. */
export type ClassificationResult = FindingSeverity | 'normal' | 'skipped';

/**
 * Borderline threshold: a value within this fraction of a range boundary
 * is classified as borderline rather than strictly normal.
 */
const BORDERLINE_FRACTION = 0.05;

/**
 * Critical multiplier: a value exceeding the high bound by this factor
 * (or falling below the low bound by 1/factor) is classified as critical.
 */
const CRITICAL_HIGH_MULTIPLIER = 2.0;
const CRITICAL_LOW_MULTIPLIER = 0.5;

/** Map of known flag strings → severity. Case-insensitive matching. */
const FLAG_MAP: Record<string, ClassificationResult> = {
  h: 'high',
  high: 'high',
  l: 'low',
  low: 'low',
  hh: 'critical-high',
  ll: 'critical-low',
  '*': 'high', // asterisk typically indicates out-of-range
  '**': 'critical-high',
  a: 'high', // 'A' for abnormal — conservative: treat as high
  abnormal: 'high',
};

/**
 * Classify a single `LabEntry` into a severity bucket.
 *
 * @returns A `FindingSeverity`, `'normal'`, or `'skipped'`.
 */
export function classifyEntry(entry: LabEntry): ClassificationResult {
  // ── 1. Flag-based classification ────────────────────────────────────────
  if (entry.flag !== undefined && entry.flag.trim().length > 0) {
    const normalised = entry.flag.trim().toLowerCase();
    const mapped = FLAG_MAP[normalised];
    if (mapped !== undefined) {
      return mapped;
    }
    // Unknown flag — don't fabricate; treat as normal
  }

  // ── 2. Numeric comparison against reference range ───────────────────────
  const numericValue = parseFloat(entry.value);
  if (Number.isNaN(numericValue)) {
    // Non-numeric value (e.g. "Negative", "Reactive") with no useful flag
    return 'skipped';
  }

  const ref = entry.referenceRange;
  if (ref === undefined) {
    // No reference range — cannot compare; safe default
    return 'normal';
  }

  const hasHigh = ref.high !== undefined;
  const hasLow = ref.low !== undefined;

  if (!hasHigh && !hasLow) {
    // Reference range is text-only (e.g. "Negative") — cannot compare numerically
    return 'normal';
  }

  // Check above high bound
  if (hasHigh) {
    const high = ref.high!;
    if (high > 0 && numericValue >= high * CRITICAL_HIGH_MULTIPLIER) {
      return 'critical-high';
    }
    if (numericValue > high) {
      return 'high';
    }
    // Borderline high: within BORDERLINE_FRACTION of the upper bound, from below
    if (high > 0) {
      const borderlineThreshold = high * (1 - BORDERLINE_FRACTION);
      if (numericValue >= borderlineThreshold && numericValue <= high) {
        return 'borderline-high';
      }
    }
  }

  // Check below low bound
  if (hasLow) {
    const low = ref.low!;
    if (low > 0 && numericValue <= low * CRITICAL_LOW_MULTIPLIER) {
      return 'critical-low';
    }
    if (numericValue < low) {
      return 'low';
    }
    // Borderline low: within BORDERLINE_FRACTION of the lower bound, from above
    if (low > 0) {
      const borderlineThreshold = low * (1 + BORDERLINE_FRACTION);
      if (numericValue >= low && numericValue <= borderlineThreshold) {
        return 'borderline-low';
      }
    }
  }

  return 'normal';
}
