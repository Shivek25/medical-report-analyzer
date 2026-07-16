/**
 * src/lib/layout/header-footer-detector.ts
 *
 * Phase 8 — Header and footer detector.
 *
 * Identifies repeated blocks at the top and bottom of pages across the document.
 * A block is considered a header/footer if it appears at approximately the same
 * Y coordinate on multiple pages AND its text is either identical or matches a
 * known boilerplate pattern (e.g. "Page X of Y").
 *
 * Strategy:
 *   1. Collect the top-N and bottom-N rows from each page.
 *   2. Hash their text and Y position (bucketed to nearest 10 units).
 *   3. Mark rows that repeat on 2+ pages as header/footer candidates.
 *   4. Additionally, flag rows that match known boilerplate patterns.
 *
 * Pure: same input → same output. No I/O, no shared state.
 */

import type { LayoutRow } from './types.js';

/** Number of rows from the top/bottom of each page to inspect. */
const HEADER_FOOTER_DEPTH = 4;

/**
 * Y-bucket width for grouping rows across pages.
 * Rows within this many Y units of each other are treated as the "same position".
 */
const Y_BUCKET = 15;

/** Minimum number of pages a row must repeat on to be flagged as header/footer. */
const MIN_REPEAT_PAGES = 2;

/** Patterns that unconditionally identify a row as a page footer. */
const FOOTER_TEXT_PATTERNS = [
  /^page\s+\d+\s+of\s+\d+/i,
  /^\d+\s+of\s+\d+$/i,
  /^-\s*\d+\s*-$/,
  /^printed\s+on\b/i,
  /^this\s+report\s+is\s+not\s+valid/i,
  /^not\s+a\s+substitute\b/i,
  /^consult\s+your\s+physician/i,
  /^www\./i,
  /^https?:\/\//i,
  /^\(\d{3}\)/,           // phone number pattern
  /^[+]\d{1,3}\s*[-\s]\d/, // international phone
];

/** Patterns that unconditionally identify a row as a page header. */
const HEADER_TEXT_PATTERNS = [
  /^processed\s+at\s*:/i,
  /^thyrocare\b/i,
  /^nabl\b/i,
  /^report\s+status\s*:/i,
  /^report\s+availability/i,
];

// ─── Public API ───────────────────────────────────────────────────────────────

/** Result of header/footer detection. */
export interface HeaderFooterSets {
  /** Set of LayoutRow sourceItemIds that belong to headers. */
  headerItemIds: Set<string>;
  /** Set of LayoutRow sourceItemIds that belong to footers. */
  footerItemIds: Set<string>;
  /** The detected header rows (for inspection/testing). */
  headerRows: LayoutRow[];
  /** The detected footer rows (for inspection/testing). */
  footerRows: LayoutRow[];
}

/**
 * Detect header and footer rows across all pages of the document.
 *
 * @param rowsByPage - Map from 0-based page index to the page's LayoutRows
 *                    (top-to-bottom order).
 * @returns Sets of item IDs belonging to headers and footers.
 */
export function detectHeadersAndFooters(
  rowsByPage: Map<number, LayoutRow[]>,
): HeaderFooterSets {
  const headerItemIds = new Set<string>();
  const footerItemIds = new Set<string>();
  const headerRows: LayoutRow[] = [];
  const footerRows: LayoutRow[] = [];

  const pages = [...rowsByPage.keys()].sort((a, b) => a - b);
  if (pages.length === 0) {
    return { headerItemIds, footerItemIds, headerRows, footerRows };
  }

  // ── Pattern-based detection (unconditional) ───────────────────────────────
  for (const page of pages) {
    const rows = rowsByPage.get(page) ?? [];
    for (const row of rows) {
      const text = row.text.trim();
      if (HEADER_TEXT_PATTERNS.some((p) => p.test(text))) {
        row.sourceItemIds.forEach((id) => headerItemIds.add(id));
        headerRows.push(row);
      } else if (FOOTER_TEXT_PATTERNS.some((p) => p.test(text))) {
        row.sourceItemIds.forEach((id) => footerItemIds.add(id));
        footerRows.push(row);
      }
    }
  }

  // ── Repetition-based detection (heuristic) ────────────────────────────────
  // Build a map from (yBucket, normalizedText) → [rows across pages].
  const topCandidates = collectEdgeRows(rowsByPage, pages, 'top');
  const bottomCandidates = collectEdgeRows(rowsByPage, pages, 'bottom');

  markRepeatedRows(topCandidates, pages.length, headerItemIds, headerRows);
  markRepeatedRows(bottomCandidates, pages.length, footerItemIds, footerRows);

  return { headerItemIds, footerItemIds, headerRows, footerRows };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

type EdgeMap = Map<string, LayoutRow[]>;

/**
 * Collect candidate rows from the top/bottom edge of each page.
 * Returns a map keyed by `{yBucket}:{normalizedText}`.
 */
function collectEdgeRows(
  rowsByPage: Map<number, LayoutRow[]>,
  pages: number[],
  edge: 'top' | 'bottom',
): EdgeMap {
  const map: EdgeMap = new Map();

  for (const page of pages) {
    const rows = rowsByPage.get(page) ?? [];
    if (rows.length === 0) continue;

    const candidates =
      edge === 'top'
        ? rows.slice(0, HEADER_FOOTER_DEPTH)
        : rows.slice(-HEADER_FOOTER_DEPTH);

    for (const row of candidates) {
      const key = rowKey(row);
      const bucket = map.get(key) ?? [];
      bucket.push(row);
      map.set(key, bucket);
    }
  }

  return map;
}

/**
 * For any key in the EdgeMap whose rows span MIN_REPEAT_PAGES+ pages,
 * mark all those rows' item IDs as header/footer.
 */
function markRepeatedRows(
  edgeMap: EdgeMap,
  totalPages: number,
  targetSet: Set<string>,
  targetArr: LayoutRow[],
): void {
  if (totalPages < MIN_REPEAT_PAGES) return; // single-page docs: skip repetition check

  for (const rows of edgeMap.values()) {
    // Deduplicate by page — one row per page only.
    const uniquePages = new Set(rows.map((r) => r.page));
    if (uniquePages.size >= MIN_REPEAT_PAGES) {
      for (const row of rows) {
        row.sourceItemIds.forEach((id) => targetSet.add(id));
        targetArr.push(row);
      }
    }
  }
}

/**
 * Stable key for a LayoutRow: bucket Y to nearest Y_BUCKET and normalise text.
 */
function rowKey(row: LayoutRow): string {
  const yBucket = Math.round(row.y / Y_BUCKET) * Y_BUCKET;
  const normalized = row.text.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
  return `${yBucket}:${normalized}`;
}
