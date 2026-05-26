/**
 * src/lib/pdf/index.ts
 * PDF reading utilities — extracts raw text and metadata from uploaded PDFs.
 *
 * Phase 1 implementation will use pdf-parse or pdfjs-dist.
 */

import type { BloodTestReport } from '../types/index.js';

export interface PdfReadResult {
  rawText: string;
  pageCount: number;
  fileName: string;
}

/**
 * Read a PDF file from disk and return its raw text content.
 * @param filePath - Absolute path to the PDF file
 */
export async function readPdf(_filePath: string): Promise<PdfReadResult> {
  // TODO (Phase 1): implement PDF text extraction
  throw new Error('readPdf: not yet implemented');
}

/**
 * Extract a BloodTestReport skeleton from raw PDF text.
 * Full parsing logic delegated to src/lib/parser.
 */
export async function extractReportFromPdf(_filePath: string): Promise<Partial<BloodTestReport>> {
  // TODO (Phase 1): implement end-to-end extraction
  throw new Error('extractReportFromPdf: not yet implemented');
}
