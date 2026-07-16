/**
 * src/lib/layout/page-analyzer.ts
 *
 * Phase 8 — Page analyzer.
 *
 * Groups raw SpatialItems (from the pdfjs pagerender hook) into LayoutRows,
 * where each row contains items that share approximately the same Y coordinate.
 * Items within a row are sorted left-to-right by X coordinate.
 *
 * The grouping tolerance (Y_TOLERANCE) accounts for minor baseline variation
 * between items in the same visual line (e.g., superscripts, mixed font sizes).
 *
 * Pure function: same input → same output. No I/O, no shared mutable state.
 */

import type { LayoutRow, SpatialItem } from './types.js';

/**
 * Maximum vertical distance (in PDF user units) between two items that
 * should still be considered part of the same visual line.
 * Typical body text height is ~8-10 units; 4 is a safe 40% tolerance.
 */
const Y_TOLERANCE = 4;

/**
 * Minimum number of characters for an item to be considered non-trivial.
 * Pure whitespace items with width > 0 are still kept (they separate words),
 * but zero-length strings are dropped.
 */
const MIN_TEXT_LENGTH = 1;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Group a flat array of SpatialItems from a single page into LayoutRows.
 *
 * @param items - SpatialItems from one page, in any order.
 * @param page  - 0-based page index (used to populate LayoutRow.page).
 * @returns     An array of LayoutRows in top-to-bottom, left-to-right order.
 */
export function groupItemsIntoRows(items: SpatialItem[], page: number): LayoutRow[] {
  // Filter trivially empty items.
  const validItems = items.filter((item) => item.text.length >= MIN_TEXT_LENGTH);
  if (validItems.length === 0) return [];

  // Sort by Y descending (PDF Y increases upward, so higher Y = higher on page)
  // then X ascending for stable grouping.
  const sorted = [...validItems].sort((a, b) => {
    if (Math.abs(a.y - b.y) > Y_TOLERANCE) return b.y - a.y; // top to bottom
    return a.x - b.x; // left to right within same line
  });

  const rows: LayoutRow[] = [];
  let currentBucket: SpatialItem[] = [];
  let bucketY = sorted[0]!.y;

  for (const item of sorted) {
    if (Math.abs(item.y - bucketY) <= Y_TOLERANCE) {
      // Same visual line — add to bucket.
      currentBucket.push(item);
    } else {
      // New line — flush current bucket.
      if (currentBucket.length > 0) {
        rows.push(buildRow(currentBucket, page));
      }
      currentBucket = [item];
      bucketY = item.y;
    }
  }

  // Flush the last bucket.
  if (currentBucket.length > 0) {
    rows.push(buildRow(currentBucket, page));
  }

  return rows;
}

/**
 * Combine per-page row arrays into a single document-ordered list.
 *
 * @param rowsByPage - Map from 0-based page index to its LayoutRows.
 * @returns All rows in document order (page 0 first, top-to-bottom within page).
 */
export function flattenRows(rowsByPage: Map<number, LayoutRow[]>): LayoutRow[] {
  const result: LayoutRow[] = [];
  const sortedPages = [...rowsByPage.keys()].sort((a, b) => a - b);
  for (const page of sortedPages) {
    const rows = rowsByPage.get(page) ?? [];
    result.push(...rows);
  }
  return result;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build a LayoutRow from a sorted (left-to-right) bucket of SpatialItems.
 * Items are already sorted by X at this point.
 */
function buildRow(items: SpatialItem[], page: number): LayoutRow {
  // Sort items left-to-right within the row.
  const sorted = [...items].sort((a, b) => a.x - b.x);

  // Reconstruct text: concatenate item texts. Use a single space between items
  // unless the item itself is already a space character.
  const textParts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i]!;
    const text = item.text;
    if (i === 0) {
      textParts.push(text);
    } else {
      const prev = sorted[i - 1]!;
      // If there's a visible gap between items (gap > 1/3 of average height),
      // insert a space. Otherwise concatenate directly (handles split words).
      const gap = item.x - (prev.x + prev.width);
      const avgHeight = (item.height + prev.height) / 2;
      if (gap > avgHeight * 0.33 || text.startsWith(' ') || prev.text.endsWith(' ')) {
        textParts.push(' ' + text.trim());
      } else {
        textParts.push(text);
      }
    }
  }

  const text = textParts.join('').trim();
  const yValues = sorted.map((it) => it.y);
  const medianY = yValues[Math.floor(yValues.length / 2)]!;
  const xStart = sorted[0]!.x;
  const lastItem = sorted[sorted.length - 1]!;
  const xEnd = lastItem.x + lastItem.width;

  return {
    text,
    y: medianY,
    xStart,
    xEnd,
    page,
    sourceItemIds: sorted.map((it) => it.id),
    items: sorted,
  };
}
