/**
 * src/lib/layout/candidate-builder.ts
 *
 * Phase 8 — Candidate builder.
 *
 * Converts a LayoutDocument into an array of LayoutCandidateRow objects.
 * Each candidate carries:
 *   - `text`          : a single string with test name, value, unit, and range
 *                       on the same line (backward-compatible with Row_Detector).
 *   - `page`          : 1-based page number for display/debugging.
 *   - `regionType`    : the LayoutBlock type this row came from.
 *   - `sourceItemIds` : direct links back to the original SpatialItems.
 *   - `sourceBlockId` : the block this row came from.
 *
 * Filtering rules applied here (before ontology mapping):
 *   - header, footer, boilerplate, paragraph blocks are excluded entirely.
 *   - Rows with empty testName and empty value are excluded.
 *   - Section title blocks are passed through as-is (they carry category info).
 *   - lab_table blocks use the ReconstructedTableRow data if available;
 *     otherwise fall back to the raw row text.
 *
 * Pure: same input → same output. No I/O, no shared state.
 */

import type { LayoutBlock, LayoutCandidateRow, LayoutDocument } from './types.js';

/**
 * Patterns that identify a table column header row.
 * These rows should never be emitted as candidates because they contain
 * only structural labels (TEST NAME, TECHNOLOGY, VALUE, UNITS, etc.)
 * and no actual analyte data.
 */
const COLUMN_HEADER_RE =
  /\b(?:test\s*name|technology|bio\.\s*ref|reference\s+interval|result\s+value|result\s+unit)\b/i;



// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build an ordered list of LayoutCandidateRow objects from a LayoutDocument.
 *
 * @param doc - The layout document produced by analyzeLayout().
 * @returns   Ordered candidate rows ready for downstream extraction.
 */
export function buildCandidates(doc: LayoutDocument): LayoutCandidateRow[] {
  const candidates: LayoutCandidateRow[] = [];

  for (const block of doc.blocks) {
    const blockCandidates = buildFromBlock(block);
    candidates.push(...blockCandidates);
  }

  return candidates;
}

/**
 * Derive a plain string array from the candidates for backward-compatible
 * use in the deterministic row-detector (which operates on flat text).
 */
export function candidatesToText(candidates: LayoutCandidateRow[]): string {
  return candidates.map((c) => c.text).join('\n');
}

// ─── Block → candidates ───────────────────────────────────────────────────────

function buildFromBlock(block: LayoutBlock): LayoutCandidateRow[] {
  // Exclude non-data block types entirely.
  if (
    block.type === 'header' ||
    block.type === 'footer' ||
    block.type === 'boilerplate' ||
    block.type === 'paragraph'
  ) {
    return [];
  }

  // Section titles pass through as a single candidate (for category tracking).
  if (block.type === 'section_title') {
    const row = block.rows[0];
    if (!row) return [];
    return [
      {
        text: row.text.trim(),
        page: block.page + 1,
        regionType: 'section_title',
        sourceItemIds: row.sourceItemIds,
        sourceBlockId: block.id,
      },
    ];
  }

  // Lab table blocks: prefer reconstructed table rows.
  if (block.type === 'lab_table' && block.tableRows && block.tableRows.length > 0) {
    return block.tableRows
      .map((tr): LayoutCandidateRow | null => {
        const text = reconstructLine(tr.testName, tr.value, tr.unit, tr.referenceRange, tr.flag);
        if (!text) return null;
        const candidate: LayoutCandidateRow = {
          text,
          page: tr.page + 1,
          regionType: 'lab_table',
          sourceItemIds: tr.sourceItemIds,
          sourceBlockId: block.id,
        };
        if (tr.testName) {
          candidate.rawTestName = tr.testName;
        }
        return candidate;
      })
      .filter((c): c is LayoutCandidateRow => c !== null);
  }

  // Metadata, unknown, and unreconstructed lab_table blocks:
  // emit each row as its own candidate.
  return block.rows
    .map((row): LayoutCandidateRow | null => {
      let text = row.text.trim();
      if (!text) return null;
      // Strip column header prefix. When the column headers (TEST NAME, TECHNOLOGY,
      // VALUE, UNITS) appear on the same Y-line as the first data row, the page
      // analyzer merges them into one string. We strip up to and including the
      // last column header token.
      text = stripColumnHeaderPrefix(text);
      if (!text) return null;
      return {
        text,
        page: row.page + 1,
        regionType: block.type,
        sourceItemIds: row.sourceItemIds,
        sourceBlockId: block.id,
      };
    })
    .filter((c): c is LayoutCandidateRow => c !== null);
}



// ─── Line reconstruction ──────────────────────────────────────────────────────

/**
 * Reconstruct a single-line string from the five lab row fields.
 * If testName is empty and value is also empty, returns null (row is useless).
 *
 * The output format is compatible with the deterministic Row_Detector:
 *   "HbA1c 5.4 % 4.0-5.7 H"
 */
function reconstructLine(
  testName: string,
  value: string,
  unit?: string,
  referenceRange?: string,
  flag?: string,
): string | null {
  const parts = [testName.trim(), value.trim(), unit?.trim(), referenceRange?.trim(), flag?.trim()]
    .filter(Boolean);

  if (parts.length === 0) return null;
  if (!testName.trim() && !value.trim()) return null;

  return parts.join(' ');
}

// ─── Column header stripping ──────────────────────────────────────────────────

/**
 * Column header tokens found in lab report tables.
 * When the page analyzer merges a column header row with the first data row,
 * we strip these tokens from the beginning of the text.
 */
const COLUMN_HEADER_TOKENS_RE =
  /^(?:(?:test\s*name|technology|value|units|result|reference\s+interval|bio\.?\s*ref\.?\s*interval|low|high|flag|s\.?\s*no\.?|sr\.?\s*no\.?|investigation|parameter|analyte)\s+)+/i;

/**
 * Strip any column header token prefix from a merged row string.
 * If the entire string is header tokens (no data remains), returns ''.
 * If nothing matches, returns the original string unchanged.
 */
function stripColumnHeaderPrefix(text: string): string {
  // Only try to strip if the row contains column header markers.
  if (!COLUMN_HEADER_RE.test(text)) return text;

  const stripped = text.replace(COLUMN_HEADER_TOKENS_RE, '').trim();
  return stripped;
}
