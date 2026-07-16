/**
 * src/lib/layout/table-reconstructor.ts
 *
 * Phase 8 — Table reconstructor.
 *
 * For LayoutBlocks classified as `lab_table`, this module:
 *   1. Detects column bands by clustering item X-coordinates across all rows.
 *   2. Assigns each item to a column role (testName / value / unit / referenceRange / flag).
 *   3. Groups spatially adjacent rows that belong to the same logical lab entry
 *      (handles wrapped test names and split reference ranges).
 *   4. Emits ReconstructedTableRow objects with full sourceItemIds traceability.
 *
 * Column detection uses a simple 1D X-coordinate clustering approach:
 *   - Collect all item left-edge X values across the block's rows.
 *   - Sort them and identify gaps (clusters are separated by gaps > GAP_THRESHOLD).
 *   - Each cluster of X-starts defines one column band.
 *
 * This is a deterministic approach that generalizes well to tables where
 * columns have consistent X alignment across rows.
 *
 * Pure: same input → same output. No I/O, no shared state.
 */

import type {
  ColumnBand,
  LayoutBlock,
  LayoutRow,
  ReconstructedTableRow,
  SpatialItem,
} from './types.js';

/** Minimum X gap (in PDF units) to consider two items in different columns. */
const COLUMN_GAP_THRESHOLD = 18;

/** Maximum Y distance between two rows to consider them part of the same logical entry. */
const ROW_CONTINUATION_Y_GAP = 14;

/** X-position threshold for "far right" column (flag/status columns). */
const FAR_RIGHT_THRESHOLD_RATIO = 0.75; // relative to page width estimate

// Regex patterns for column role detection.
const VALUE_RE = /^[<>≤≥]?\s*\d+(?:[.,]\d+)?(?:\s*[eE][+-]?\d+)?$/;
const QUALITATIVE_VALUE_RE = /^(?:Negative|Positive|Reactive|Non[- ]?Reactive|Present|Absent|Normal|Abnormal)\b/i;
const UNIT_RE = /^(?:g\/dL|mg\/dL|mmol\/L|µmol\/L|umol\/L|nmol\/L|ng\/mL|pg\/mL|µg\/mL|ug\/mL|mcg\/mL|IU\/L|U\/L|mIU\/L|mIU\/mL|%|cells\/µL|cells\/uL|million\/µL|lakh\/µL|thousand\/µL|fL|fl|g\/L|mmHg|mEq\/L|ratio|x10|×10|\d+\^)/i;
const RANGE_RE = /^\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?$|^[<>≤≥]\s*\d/;
const FLAG_RE = /^[HhLl]$|^(?:HIGH|LOW|NORMAL|CRITICAL|BORDERLINE|ABNORMAL)\b/i;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reconstruct table rows from a lab_table LayoutBlock.
 *
 * @param block - A LayoutBlock with type === 'lab_table'.
 * @returns An array of ReconstructedTableRow objects.
 */
export function reconstructTable(block: LayoutBlock): ReconstructedTableRow[] {
  if (block.rows.length === 0) return [];

  // Detect column bands across all items in this block.
  const allItems = block.rows.flatMap((r) => r.items);
  const bands = detectColumnBands(allItems);

  if (bands.length === 0) {
    // No column structure detected — treat each row as a single text row.
    return block.rows.map((row) => rawRowToTableRow(row));
  }

  // Group rows into logical entries (handles multi-line test names).
  const logicalEntries = groupRowsIntoEntries(block.rows);

  // Map each logical entry to a ReconstructedTableRow.
  return logicalEntries.map((rows) => mapToTableRow(rows, bands));
}

// ─── Column detection ─────────────────────────────────────────────────────────

function detectColumnBands(items: SpatialItem[]): ColumnBand[] {
  if (items.length === 0) return [];

  // Collect all left-edge X values.
  const xStarts = items.map((it) => it.x).sort((a, b) => a - b);

  // Identify clusters by finding gaps > COLUMN_GAP_THRESHOLD.
  const clusters: number[][] = [];
  let current: number[] = [xStarts[0]!];

  for (let i = 1; i < xStarts.length; i++) {
    if (xStarts[i]! - xStarts[i - 1]! > COLUMN_GAP_THRESHOLD) {
      clusters.push(current);
      current = [];
    }
    current.push(xStarts[i]!);
  }
  clusters.push(current);

  if (clusters.length < 2) return []; // No meaningful column structure.

  // Build bands from clusters.
  const bands: ColumnBand[] = clusters.map((cluster) => ({
    xMin: Math.min(...cluster),
    xMax: Math.max(...cluster),
    role: 'unknown' as ColumnBand['role'],
  }));

  // Assign roles based on position and typical lab report column order.
  assignColumnRoles(bands, items);
  return bands;
}

function assignColumnRoles(bands: ColumnBand[], items: SpatialItem[]): void {
  if (bands.length === 0) return;

  // Estimate page width from max item right edge.
  const pageWidth = Math.max(...items.map((it) => it.x + it.width));

  // Heuristic: leftmost band is always the test name.
  bands[0]!.role = 'testName';

  // For each subsequent band, sample items and infer role from content.
  for (let i = 1; i < bands.length; i++) {
    const band = bands[i]!;
    const bandItems = items.filter(
      (it) => it.x >= band.xMin - 5 && it.x <= band.xMax + 5,
    );
    const sample = bandItems.slice(0, 10);
    band.role = inferRoleFromSample(sample, band, pageWidth, i, bands.length);
  }
}

function inferRoleFromSample(
  sample: SpatialItem[],
  band: ColumnBand,
  pageWidth: number,
  bandIndex: number,
  totalBands: number,
): ColumnBand['role'] {
  if (sample.length === 0) return 'unknown';

  const texts = sample.map((it) => it.text.trim()).filter((t) => t.length > 0);

  const valueMatches = texts.filter((t) => VALUE_RE.test(t) || QUALITATIVE_VALUE_RE.test(t)).length;
  const unitMatches = texts.filter((t) => UNIT_RE.test(t)).length;
  const rangeMatches = texts.filter((t) => RANGE_RE.test(t)).length;
  const flagMatches = texts.filter((t) => FLAG_RE.test(t)).length;

  const isFarRight = band.xMin > pageWidth * FAR_RIGHT_THRESHOLD_RATIO;

  if (flagMatches > valueMatches && flagMatches > rangeMatches && isFarRight) return 'flag';
  if (rangeMatches >= valueMatches && bandIndex >= totalBands - 2) return 'referenceRange';
  if (unitMatches > valueMatches) return 'unit';
  if (valueMatches > 0) return 'value';
  return 'unknown';
}

// ─── Row grouping (multi-line test names) ─────────────────────────────────────

/**
 * Group consecutive LayoutRows into logical entries.
 * A continuation row is one that:
 *   - Has a small Y gap from the previous row.
 *   - Does NOT look like it starts a new test name (i.e. starts with a digit
 *     or operator, or its first-column text is empty).
 */
function groupRowsIntoEntries(rows: LayoutRow[]): LayoutRow[][] {
  const entries: LayoutRow[][] = [];
  let current: LayoutRow[] = [];

  for (const row of rows) {
    if (current.length === 0) {
      current.push(row);
      continue;
    }

    const prev = current[current.length - 1]!;
    const samePage = row.page === prev.page;
    const yGap = samePage ? Math.abs(prev.y - row.y) : Infinity;
    const isContinuation = yGap <= ROW_CONTINUATION_Y_GAP && isContinuationRow(row);

    if (isContinuation) {
      current.push(row);
    } else {
      entries.push(current);
      current = [row];
    }
  }

  if (current.length > 0) entries.push(current);
  return entries;
}

function isContinuationRow(row: LayoutRow): boolean {
  const text = row.text.trim();
  // A continuation row starts with a numeric/operator character.
  return /^[\d<>≤≥+\-.±]/.test(text);
}

// ─── Column-to-field mapping ───────────────────────────────────────────────────

function mapToTableRow(rows: LayoutRow[], bands: ColumnBand[]): ReconstructedTableRow {
  const allItems = rows.flatMap((r) => r.items);
  const sourceItemIds = allItems.map((it) => it.id);
  const sourceRowIds = rows.map((r) => r.sourceItemIds[0] ?? '');

  // Assign each item to its nearest column band.
  const byRole: Record<ColumnBand['role'], string[]> = {
    testName: [],
    value: [],
    unit: [],
    referenceRange: [],
    flag: [],
    unknown: [],
  };

  for (const item of allItems) {
    const band = findNearestBand(item.x, bands);
    const role = band?.role ?? 'unknown';
    byRole[role].push(item.text.trim());
  }

  const row: ReconstructedTableRow = {
    testName: byRole.testName.join(' ').trim(),
    value: byRole.value.join(' ').trim(),
    sourceRowIds,
    sourceItemIds,
    page: rows[0]!.page,
  };
  const unit = byRole.unit.join(' ').trim();
  if (unit) row.unit = unit;
  const referenceRange = byRole.referenceRange.join(' ').trim();
  if (referenceRange) row.referenceRange = referenceRange;
  const flag = byRole.flag.join(' ').trim();
  if (flag) row.flag = flag;
  return row;

}

function rawRowToTableRow(row: LayoutRow): ReconstructedTableRow {
  return {
    testName: row.text,
    value: '',
    sourceRowIds: [row.sourceItemIds[0] ?? ''],
    sourceItemIds: row.sourceItemIds,
    page: row.page,
  };
}

function findNearestBand(x: number, bands: ColumnBand[]): ColumnBand | undefined {
  let best: ColumnBand | undefined;
  let bestDist = Infinity;

  for (const band of bands) {
    const dist = x < band.xMin
      ? band.xMin - x
      : x > band.xMax
      ? x - band.xMax
      : 0;
    if (dist < bestDist) {
      bestDist = dist;
      best = band;
    }
  }

  // Only assign if within reasonable distance (1 column width ~80 units).
  return bestDist <= 80 ? best : undefined;
}
