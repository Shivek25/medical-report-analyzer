/**
 * src/lib/summarizer/grouper.ts
 *
 * Pure functions that group findings/entries by category and sort
 * them for presentation.
 *
 * Sort order:
 *   - Categories: alphabetical
 *   - Abnormal findings within a category: by severity (critical → high/low → borderline)
 *   - Normal entries within a category: alphabetical by test name
 */

import type {
  SummaryFinding,
  SummaryCategoryGroup,
  FindingSeverity,
  NormalEntry,
  NormalCategoryGroup,
} from '../types/index.js';

/** Severity sort weight — lower = more severe = listed first. */
const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  'critical-high': 0,
  'critical-low': 1,
  high: 2,
  low: 3,
  'borderline-high': 4,
  'borderline-low': 5,
};

/**
 * Group abnormal/uncertain findings by category and sort for presentation.
 *
 * @param findings  Flat array of findings to group.
 * @returns  Sorted array of category groups. Empty input → empty array.
 */
export function groupByCategory(findings: SummaryFinding[]): SummaryCategoryGroup[] {
  if (findings.length === 0) {
    return [];
  }

  const map = new Map<string, SummaryFinding[]>();
  for (const f of findings) {
    const existing = map.get(f.category);
    if (existing !== undefined) {
      existing.push(f);
    } else {
      map.set(f.category, [f]);
    }
  }

  // Sort findings within each group by severity
  for (const group of map.values()) {
    group.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }

  const categories = [...map.keys()].sort((a, b) => a.localeCompare(b));
  return categories.map((category) => ({
    category,
    findings: map.get(category)!,
  }));
}

/**
 * Group normal entries by category and sort for presentation.
 *
 * @param entries  Flat array of normal entries to group.
 * @returns  Sorted array of normal category groups. Empty input → empty array.
 */
export function groupNormalByCategory(entries: NormalEntry[]): NormalCategoryGroup[] {
  if (entries.length === 0) {
    return [];
  }

  const map = new Map<string, NormalEntry[]>();
  for (const e of entries) {
    const existing = map.get(e.category);
    if (existing !== undefined) {
      existing.push(e);
    } else {
      map.set(e.category, [e]);
    }
  }

  // Sort entries within each group alphabetically by test name
  for (const group of map.values()) {
    group.sort((a, b) => a.testName.localeCompare(b.testName));
  }

  const categories = [...map.keys()].sort((a, b) => a.localeCompare(b));
  return categories.map((category) => ({
    category,
    entries: map.get(category)!,
  }));
}
