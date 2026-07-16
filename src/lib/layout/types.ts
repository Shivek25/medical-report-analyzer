/**
 * src/lib/layout/types.ts
 *
 * Phase 8 — Layout Engine type definitions.
 *
 * Defines the intermediate representation for the document layout engine.
 * Every item carries explicit source traceability back to the original
 * SpatialItem ids, ensuring that any downstream mis-classification can be
 * traced to specific page coordinates.
 *
 * Design principles:
 *   - Immutable value objects — no shared mutable state.
 *   - All ids are stable strings derived from page + index.
 *   - regionType mirrors the BlockLabel taxonomy from extraction/types.ts
 *     but is extended with layout-specific variants.
 */

// ─── PDF extraction data (declared here to avoid circular deps) ────────────────

/**
 * Raw item from pdfjs getTextContent (before ID assignment).
 * Declared in layout/types.ts so that IngestionResult can reference it
 * without creating a circular dependency through layout/index.ts.
 */
export interface RawSpatialItem {
  str: string;
  transform: number[];  // [scaleX, skewX, skewY, scaleY, x, y]
  width: number;
  height: number;
}

/**
 * Per-page raw spatial data as returned by the PDF extractor's pagerender hook.
 */
export interface PageSpatialData {
  page: number;  // 0-based page index
  items: RawSpatialItem[];
}

// ─── Primitive spatial unit ────────────────────────────────────────────────────

/**
 * A single text item extracted from pdfjs with full spatial context.
 * The `id` is a stable opaque key used for traceability through the pipeline.
 */
export interface SpatialItem {
  /** Stable opaque key: `p{page}-i{index}` */
  id: string;
  /** The raw text of this item (may be a single word, phrase, or even a space). */
  text: string;
  /** X coordinate of the left edge in PDF user units. */
  x: number;
  /** Y coordinate of the baseline in PDF user units (decreasing top-to-bottom). */
  y: number;
  /** Width of the text bounding box. */
  width: number;
  /** Font height in PDF user units. */
  height: number;
  /** 0-based page index. */
  page: number;
}

// ─── Layout rows ───────────────────────────────────────────────────────────────

/**
 * A group of SpatialItems that share approximately the same Y coordinate
 * (within a configurable Y-tolerance). Items are sorted left-to-right by X.
 *
 * The `sourceItemIds` array preserves traceability back to the original items.
 */
export interface LayoutRow {
  /** Reconstructed text of the row (items joined with a single space). */
  text: string;
  /** Representative Y coordinate of this row (median of item Y values). */
  y: number;
  /** X coordinate of the leftmost item on this row. */
  xStart: number;
  /** X coordinate of the right edge of the rightmost item. */
  xEnd: number;
  /** 0-based page index. */
  page: number;
  /** Ordered list of SpatialItem ids that make up this row. */
  sourceItemIds: string[];
  /** Constituent spatial items (denormalized for direct access). */
  items: SpatialItem[];
}

// ─── Column detection ─────────────────────────────────────────────────────────

/**
 * Detected column band within a table region. X bands are identified by
 * clustering item X-coordinates across all rows.
 */
export interface ColumnBand {
  /** Approximate X coordinate of the column's left edge. */
  xMin: number;
  /** Approximate X coordinate of the column's right edge. */
  xMax: number;
  /** Semantic role inferred from content analysis (best-effort). */
  role: 'testName' | 'value' | 'unit' | 'referenceRange' | 'flag' | 'unknown';
}

// ─── Reconstructed table row ───────────────────────────────────────────────────

/**
 * A single data row reconstructed from a table block. Columns are aligned to
 * detected column bands. All fields are optional because not every lab table
 * has all five columns.
 */
export interface ReconstructedTableRow {
  testName: string;
  value: string;
  unit?: string;
  referenceRange?: string;
  flag?: string;
  /** Source LayoutRow ids for this reconstructed row. */
  sourceRowIds: string[];
  /** Flattened list of all SpatialItem ids. */
  sourceItemIds: string[];
  /** 0-based page index. */
  page: number;
}

// ─── Layout blocks ─────────────────────────────────────────────────────────────

/**
 * The semantic type of a layout block.
 *   - `header`        : repeated block at the top of each page (lab name, logo text, etc.)
 *   - `footer`        : repeated block at the bottom of each page (page numbers, disclaimers)
 *   - `section_title` : a panel or category heading (e.g. "LIPID PROFILE")
 *   - `lab_table`     : a table of lab result rows
 *   - `paragraph`     : free-form prose (clinical significance, notes, etc.)
 *   - `boilerplate`   : known non-data content (conditions of reporting, etc.)
 *   - `metadata`      : patient / lab / date header information
 *   - `unknown`       : could not be classified
 */
export type BlockType =
  | 'header'
  | 'footer'
  | 'section_title'
  | 'lab_table'
  | 'paragraph'
  | 'boilerplate'
  | 'metadata'
  | 'unknown';

/**
 * A logical block of content on a page.
 * Blocks are the primary segmentation unit produced by the layout engine.
 */
export interface LayoutBlock {
  /** Unique id for this block. */
  id: string;
  type: BlockType;
  /** All rows belonging to this block, in document order. */
  rows: LayoutRow[];
  /** Reconstructed table rows (present only when type === 'lab_table'). */
  tableRows?: ReconstructedTableRow[];
  /** 0-based page index this block originated on. */
  page: number;
  /** Combined text of all rows (newline-separated). */
  text: string;
  /** All SpatialItem ids contributed by this block. */
  sourceItemIds: string[];
}

// ─── Candidate row (output of candidate-builder) ──────────────────────────────

/**
 * A structured candidate unit ready for downstream extraction.
 *
 * Unlike the flat-text CandidateBlock in extraction/types.ts, this carries
 * full layout metadata so that any extraction failure can be traced back to
 * the original spatial items. The `text` field provides a string view that
 * is backward-compatible with the deterministic Row_Detector.
 *
 * The `canonicalTestName` field is populated by the ontology mapper (after
 * reconstruction), and remains undefined if the test name cannot be resolved.
 */
export interface LayoutCandidateRow {
  /** String view — test name, value, unit, range all on one line. */
  text: string;
  /** 1-based page number. */
  page: number;
  /** The block type this row came from. */
  regionType: BlockType;
  /** SpatialItem ids that produced this candidate (for debugging). */
  sourceItemIds: string[];
  /** Layout block id this row originated from. */
  sourceBlockId: string;
  /**
   * Canonical analyte name after ontology mapping (undefined if unmapped).
   * Populated by ontology-mapper.ts after reconstruction is complete.
   */
  canonicalTestName?: string;
  /** Original raw test name before canonicalization (preserved for debugging). */
  rawTestName?: string;
}

// ─── Document-level output ────────────────────────────────────────────────────

/**
 * The full structured representation of a PDF document as produced by the
 * layout engine. This is the primary output of analyzeLayout().
 */
export interface LayoutDocument {
  /** Total number of pages in the document. */
  pageCount: number;
  /** All spatial items, keyed by id for O(1) lookup. */
  itemsById: Map<string, SpatialItem>;
  /** All blocks, in document order. */
  blocks: LayoutBlock[];
  /** Candidate rows ready for deterministic or LLM extraction. */
  candidates: LayoutCandidateRow[];
  /**
   * True when spatial capture was complete (all pages yielded coordinates).
   * False when the layout engine fell back to partial or flat-text extraction.
   */
  isFullySpatial: boolean;
  /** Per-page raw rows (before block segmentation), keyed by 0-based page. */
  rowsByPage: Map<number, LayoutRow[]>;
}
