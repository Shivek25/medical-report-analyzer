/**
 * src/lib/pdf/extractor.ts
 *
 * Phase 1 (updated in Phase 8) — PDF text and spatial extraction.
 *
 * Phase 8 adds a custom `pagerender` hook that captures the underlying pdfjs
 * text items (with spatial coordinates) per page. These are stored in the
 * returned `IngestionResult.layoutPages` field for the layout engine.
 *
 * FALLBACK CONTRACT:
 *   - If spatial capture fails for any page or throws, the extractor catches
 *     the error and continues using the existing flat-text path.
 *   - `layoutPages` will contain only the pages that succeeded.
 *   - `isFullySpatial` on the result will be false if any page failed.
 *   - This ensures the existing ingestion output is ALWAYS produced, even when
 *     spatial reconstruction is incomplete.
 */

import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Bypass broken index.js in pdf-parse@1.1.1 that crashes under ESM
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

import type { IngestionResult } from '../types/index.js';
import type { PageSpatialData, RawSpatialItem } from '../layout/types.js';


// ─── Public API ───────────────────────────────────────────────────────────────

export async function extractTextFromPdf(
  filePath: string,
  originalFilename: string,
): Promise<IngestionResult> {
  let dataBuffer: Buffer;
  try {
    dataBuffer = fs.readFileSync(filePath);
  } catch (error: any) {
    return {
      originalFilename,
      storedFilePath: filePath,
      extractionStatus: 'failed',
      extractedText: '',
      warningsOrErrors: [`Failed to read file: ${error.message}`],
    };
  }

  try {
    // ── Phase 8: spatial capture with per-page fallback ───────────────────
    const capturedPages: PageSpatialData[] = [];
    const spatialFailures: string[] = [];

    /**
     * Custom pagerender function: intercepts pdfjs rendering to capture
     * spatial items before collapsing them to a string.
     * This function runs once per page; errors are caught and the page is
     * treated as a spatial failure (falling back to the flat text).
     */
    async function capturePageRender(pageData: any): Promise<string> {
      const pageIndex: number = pageData.pageIndex ?? 0;
      try {
        const textContent = await pageData.getTextContent();
        const rawItems: RawSpatialItem[] = (textContent.items as any[])
          .filter((item) => typeof item.str === 'string' && item.str.length > 0)
          .map((item) => ({
            str: item.str as string,
            transform: item.transform as number[],
            width: typeof item.width === 'number' ? item.width : 0,
            height: typeof item.height === 'number' ? item.height : 0,
          }));

        capturedPages.push({ page: pageIndex, items: rawItems });

        // Reconstruct the text for this page (used by flat-text path).
        return reconstructPageText(rawItems);
      } catch (pageErr: any) {
        spatialFailures.push(
          `Page ${pageIndex + 1}: spatial capture failed — ${pageErr?.message ?? String(pageErr)}`,
        );
        // Return empty string for this page; pdf-parse will still use data.text.
        return '';
      }
    }

    const data = await pdfParse(dataBuffer, { pagerender: capturePageRender });
    const text: string = data.text || '';

    // Determine if spatial capture was complete.
    const totalPages: number = data.numpages ?? capturedPages.length;
    const isFullySpatial =
      spatialFailures.length === 0 && capturedPages.length === totalPages;

    // ── Scanned PDF detection (unchanged from Phase 1) ────────────────────
    if (text.trim().length < 50) {
      const scannedResult: IngestionResult = {
        originalFilename,
        storedFilePath: filePath,
        extractionStatus: 'scanned_fallback',
        extractedText: text,
        extractionNotes:
          'Warning: Very little text extracted. This might be a scanned PDF or mostly an image.',
        warningsOrErrors: ['Scanned PDF detected. OCR is not implemented in Phase 1.'],
      };
      // Still provide any spatial pages we managed to capture.
      if (capturedPages.length > 0) {
        scannedResult.layoutPages = capturedPages;
        scannedResult.isFullySpatial = false;
      }
      return scannedResult;

    }

    const result: IngestionResult = {
      originalFilename,
      storedFilePath: filePath,
      extractionStatus: 'success',
      extractedText: text,
    };

    // Attach spatial layout data when available.
    if (capturedPages.length > 0) {
      result.layoutPages = capturedPages;
      result.isFullySpatial = isFullySpatial;
    }

    if (spatialFailures.length > 0) {
      result.warningsOrErrors = spatialFailures;
    }

    return result;
  } catch (error: any) {
    return {
      originalFilename,
      storedFilePath: filePath,
      extractionStatus: 'failed',
      extractedText: '',
      warningsOrErrors: [`Failed to parse PDF: ${error.message}`],
    };
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Reconstruct a page's text from raw spatial items, preserving line breaks
 * by grouping items with similar Y coordinates (tolerance = 4 units).
 */
function reconstructPageText(items: RawSpatialItem[]): string {
  if (items.length === 0) return '';

  const Y_TOLERANCE = 4;
  // Sort by Y descending (top of page first), then X ascending.
  const sorted = [...items].sort((a, b) => {
    const ay = a.transform[5] ?? 0;
    const by_ = b.transform[5] ?? 0;
    if (Math.abs(ay - by_) > Y_TOLERANCE) return by_ - ay;
    return (a.transform[4] ?? 0) - (b.transform[4] ?? 0);
  });

  const lines: string[] = [];
  let currentLine: string[] = [];
  let lineY = (sorted[0]?.transform[5]) ?? 0;

  for (const item of sorted) {
    const y = item.transform[5] ?? 0;
    if (Math.abs(y - lineY) <= Y_TOLERANCE) {
      currentLine.push(item.str);
    } else {
      lines.push(currentLine.join(' ').trim());
      currentLine = [item.str];
      lineY = y;
    }
  }
  if (currentLine.length > 0) lines.push(currentLine.join(' ').trim());

  return lines.filter(Boolean).join('\n');
}
