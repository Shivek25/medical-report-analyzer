/**
 * src/lib/exporter/index.ts
 * PDF export utilities — renders a MedicalSummary as a downloadable PDF.
 *
 * Phase 3 implementation will use Puppeteer or pdf-lib.
 */

import type { MedicalSummary } from '../types/index.js';

export interface ExportOptions {
  /** Output file path */
  outputPath: string;
  /** Include branding header */
  branded?: boolean;
}

export interface ExportResult {
  success: boolean;
  outputPath: string;
  sizeBytes: number;
}

/**
 * Render a MedicalSummary as a PDF and save it to disk.
 */
export async function exportSummaryToPdf(
  _summary: MedicalSummary,
  _options: ExportOptions,
): Promise<ExportResult> {
  // TODO (Phase 3): implement PDF generation via Puppeteer
  throw new Error('exportSummaryToPdf: not yet implemented');
}

/**
 * Render a MedicalSummary as an HTML string (for PDF conversion).
 */
export function renderSummaryHtml(_summary: MedicalSummary): string {
  // TODO (Phase 3): implement HTML template
  throw new Error('renderSummaryHtml: not yet implemented');
}
