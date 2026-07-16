/**
 * src/lib/layout/block-segmenter.ts
 *
 * Phase 8 — Block segmenter.
 *
 * Takes the per-page LayoutRows (after header/footer removal) and groups them
 * into LayoutBlocks. The segmentation is deterministic:
 *
 *   1. A row is a `section_title` if it matches the section-header shape
 *      (uppercase/title-case, no numeric/unit tokens, short).
 *   2. A run of rows that contain numeric values with units and/or ranges
 *      is grouped into a `lab_table` block.
 *   3. Long prose rows (>= 60 chars with no numeric start) become `paragraph`.
 *   4. Rows that match known boilerplate patterns become `boilerplate`.
 *   5. Remaining rows without clear classification become `unknown`.
 *
 * Blank rows (Y gap > 1.5× typical line height) act as block boundaries.
 *
 * Pure: same input → same output. No I/O, no shared state.
 */

import type { BlockType, LayoutBlock, LayoutRow } from './types.js';

/** Gap between two rows' Y values that signals a block boundary (in PDF units). */
const BLOCK_GAP_THRESHOLD = 14; // ~1.5x a 9pt line

/** Patterns for section header detection (matches existing parser's logic). */
const SECTION_HEADER_PATTERN = /^[A-Z][A-Z0-9 (),\-/&]{1,60}$/;
const NUMERIC_VALUE_RE = /\d/;
const UNIT_RE =
  /\b(?:g\/dL|mg\/dL|mmol\/L|µmol\/L|umol\/L|nmol\/L|ng\/mL|pg\/mL|µg\/mL|ug\/mL|IU\/L|U\/L|mIU\/L|%|cells|million|lakh|thousand|fL|fl|g\/L|mmHg|ratio|mEq\/L)\b/i;

/** Patterns that indicate boilerplate content. */
const BOILERPLATE_PATTERNS = [
  /^conditions\s+of\s+reporting/i,
  /^customer\s+details/i,
  /^tests?\s+done\s*:/i,
  /^barcodes?\s*[:/]/i,
  /^sample\s+type/i,
  /^reference\s*:/i,
  /^disclaimer\s*:/i,
  /^note\s*:/i,
  /^as\s+declared\s+in/i,
  /^as\s+per\s+survey/i,
  /^call\s+us\s+on/i,
  /^clinical\s+significance/i,
  /^bio\.\s*ref\.\s*interval/i,
  /^method\s*:/i,
  /^methodology\s*:/i,
  // Table column headers (various lab report layouts)
  /^test\s+name\b/i,
  /^test\s*name\s+(?:technology|value|units|result|reference|range|low|high)/i,
  /^(?:sr\.?\s*no\.?|s\.?\s*no\.?)\s+test\s+name/i,
  /^investigation\s+result/i,
  /^parameter\s+(?:result|value|units|reference)/i,
  /^analyte\s+(?:result|value|units|reference)/i,
];


/** Patterns that look like lab result rows (value + unit or range). */
const LAB_ROW_RE = /\d+(?:\.\d+)?\s*(?:g\/dL|mg\/dL|mmol|µmol|umol|nmol|ng|pg|IU|U\/L|mIU|%|fL|fl|cells|lakh|million|mEq|mmHg)|[<>]\s*\d|\d+\s*[-–]\s*\d+/i;

let blockCounter = 0;

function nextBlockId(): string {
  return `blk-${(++blockCounter).toString().padStart(4, '0')}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Segment an ordered list of LayoutRows into LayoutBlocks.
 * The `excludedItemIds` set contains IDs of header/footer items to skip.
 *
 * @param rows            - All rows in document order (across all pages).
 * @param excludedItemIds - Item IDs to exclude (headers/footers).
 * @returns An ordered array of LayoutBlocks.
 */
export function segmentBlocks(
  rows: LayoutRow[],
  excludedItemIds: Set<string>,
): LayoutBlock[] {
  // Filter out rows that are entirely header/footer items.
  const dataRows = rows.filter(
    (row) => !row.sourceItemIds.every((id) => excludedItemIds.has(id)),
  );

  if (dataRows.length === 0) return [];

  const blocks: LayoutBlock[] = [];
  let currentRows: LayoutRow[] = [];
  let prevRow: LayoutRow | null = null;

  function flushBlock(rows: LayoutRow[]): void {
    if (rows.length === 0) return;
    const block = buildBlock(rows);
    blocks.push(block);
  }

  for (const row of dataRows) {
    if (prevRow === null) {
      currentRows.push(row);
      prevRow = row;
      continue;
    }

    // Check if this row is on the same page as the previous.
    const samePage = row.page === prevRow.page;
    const yGap = samePage ? Math.abs(prevRow.y - row.y) : Infinity;

    // A large gap or page change starts a new block.
    if (yGap > BLOCK_GAP_THRESHOLD || !samePage) {
      flushBlock(currentRows);
      currentRows = [row];
      prevRow = row;
      continue;
    }

    // A section title or boilerplate row also starts a new block.
    if (isBoilerplateLine(row.text) || isSectionTitle(row.text)) {
      flushBlock(currentRows);
      currentRows = [row];
      prevRow = row;
      continue;
    }

    currentRows.push(row);
    prevRow = row;
  }

  flushBlock(currentRows);
  return blocks;
}

// ─── Block classification ─────────────────────────────────────────────────────

function classifyRows(rows: LayoutRow[]): BlockType {
  if (rows.length === 0) return 'unknown';

  const firstText = rows[0]!.text.trim();

  if (isBoilerplateLine(firstText)) return 'boilerplate';
  if (isSectionTitle(firstText) && rows.length === 1) return 'section_title';

  // Count lab-like rows.
  const labLikeCount = rows.filter((r) => LAB_ROW_RE.test(r.text)).length;
  if (labLikeCount >= 1 && labLikeCount / rows.length >= 0.4) return 'lab_table';

  // Long prose rows.
  const longProseCount = rows.filter(
    (r) => r.text.length >= 60 && !NUMERIC_VALUE_RE.test(r.text.slice(0, 20)),
  ).length;
  if (longProseCount >= 1) return 'paragraph';

  // Metadata patterns.
  if (/^(?:name|patient|ref\.?\s*by|date|sample|age|gender|sex)\s*:/i.test(firstText)) {
    return 'metadata';
  }

  return 'unknown';
}

function buildBlock(rows: LayoutRow[]): LayoutBlock {
  const type = classifyRows(rows);
  const text = rows.map((r) => r.text).join('\n');
  const sourceItemIds = rows.flatMap((r) => r.sourceItemIds);

  return {
    id: nextBlockId(),
    type,
    rows,
    page: rows[0]!.page,
    text,
    sourceItemIds,
  };
}

// ─── Predicates ───────────────────────────────────────────────────────────────

function isSectionTitle(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 70) return false;
  if (!SECTION_HEADER_PATTERN.test(trimmed)) return false;
  if (NUMERIC_VALUE_RE.test(trimmed)) return false;
  if (UNIT_RE.test(trimmed)) return false;
  return true;
}

function isBoilerplateLine(text: string): boolean {
  const trimmed = text.trim();
  return BOILERPLATE_PATTERNS.some((p) => p.test(trimmed));
}
