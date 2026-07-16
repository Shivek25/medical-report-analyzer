/**
 * src/lib/layout/index.ts
 *
 * Phase 8 — Layout engine orchestrator.
 *
 * Public entry point: `analyzeLayout(pages)`.
 *
 * Pipeline:
 *   1. page-analyzer   : SpatialItems → LayoutRows (per page, grouped by Y)
 *   2. header-footer-detector : mark repeated header/footer item IDs
 *   3. block-segmenter : LayoutRows → LayoutBlocks (typed segments)
 *   4. table-reconstructor : lab_table blocks → ReconstructedTableRows
 *   5. candidate-builder   : LayoutDocument → LayoutCandidateRows
 *   6. ontology-mapper     : annotate canonicalTestName (post-reconstruction)
 *
 * The function always returns a LayoutDocument. The `isFullySpatial` flag
 * signals whether all pages yielded coordinate data.
 */

import type { LayoutDocument, PageSpatialData, SpatialItem } from './types.js';

import { groupItemsIntoRows } from './page-analyzer.js';
import { detectHeadersAndFooters } from './header-footer-detector.js';
import { segmentBlocks } from './block-segmenter.js';
import { reconstructTable } from './table-reconstructor.js';
import { buildCandidates } from './candidate-builder.js';
import { annotateCanonicalNames } from './ontology-mapper.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Analyze a document's spatial data and produce a structured LayoutDocument.
 *
 * @param pages           - Per-page spatial data from the PDF extractor.
 * @param isFullySpatial  - Whether all pages were successfully captured.
 * @returns               A LayoutDocument with all blocks and candidates.
 */
export function analyzeLayout(
  pages: PageSpatialData[],
  isFullySpatial: boolean,
): LayoutDocument {
  // ── Step 0: Assign stable IDs and build SpatialItems ─────────────────────
  const itemsById = new Map<string, SpatialItem>();
  const rawItemsByPage = new Map<number, SpatialItem[]>();

  for (const pageData of pages) {
    const pageItems: SpatialItem[] = pageData.items
      .filter((raw) => raw.str.length > 0)
      .map((raw, idx) => {
        const id = `p${pageData.page}-i${idx}`;
        const item: SpatialItem = {
          id,
          text: raw.str,
          x: raw.transform[4] ?? 0,
          y: raw.transform[5] ?? 0,
          width: raw.width,
          height: raw.height,
          page: pageData.page,
        };
        itemsById.set(id, item);
        return item;
      });
    rawItemsByPage.set(pageData.page, pageItems);
  }

  // ── Step 1: Group items into rows per page ────────────────────────────────
  const rowsByPage = new Map<number, ReturnType<typeof groupItemsIntoRows>>();
  for (const [page, items] of rawItemsByPage) {
    rowsByPage.set(page, groupItemsIntoRows(items, page));
  }

  // ── Step 2: Detect headers and footers ────────────────────────────────────
  const { headerItemIds, footerItemIds } = detectHeadersAndFooters(rowsByPage);
  const excludedItemIds = new Set([...headerItemIds, ...footerItemIds]);

  // ── Step 3: Flatten rows and segment into blocks ──────────────────────────
  const allRows = flattenRows(rowsByPage);
  const blocks = segmentBlocks(allRows, excludedItemIds);

  // ── Step 4: Reconstruct tables ────────────────────────────────────────────
  for (const block of blocks) {
    if (block.type === 'lab_table') {
      block.tableRows = reconstructTable(block);
    }
  }

  // ── Step 5 & 6: Build candidates, then annotate canonical names ───────────
  const docWithoutCandidates: Omit<LayoutDocument, 'candidates'> = {
    pageCount: pages.length,
    itemsById,
    blocks,
    isFullySpatial,
    rowsByPage,
  };

  const candidates = buildCandidates(docWithoutCandidates as LayoutDocument);
  annotateCanonicalNames(candidates);

  return {
    pageCount: pages.length,
    itemsById,
    blocks,
    candidates,
    isFullySpatial,
    rowsByPage,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function flattenRows(
  rowsByPage: Map<number, ReturnType<typeof groupItemsIntoRows>>,
): ReturnType<typeof groupItemsIntoRows> {
  const result = [];
  const sortedPages = [...rowsByPage.keys()].sort((a, b) => a - b);
  for (const page of sortedPages) {
    result.push(...(rowsByPage.get(page) ?? []));
  }
  return result;
}

// ─── Re-exports for consumers ─────────────────────────────────────────────────

export type { LayoutDocument, LayoutCandidateRow, SpatialItem, PageSpatialData, RawSpatialItem } from './types.js';

export { annotateCanonicalNames, resolveCanonical } from './ontology-mapper.js';
export { candidatesToText } from './candidate-builder.js';

