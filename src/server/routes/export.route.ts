/**
 * src/server/routes/export.route.ts
 * Route handler for POST /api/v1/export
 *
 * Accepts a ReportSummary, generates a PDF summary, and streams the file
 * back to the client as a download.
 */

import { Request, Response } from 'express';
import { generatePdfReport } from '../../lib/pdf/generator.js';
import type { ReportSummary } from '../../lib/types/index.js';
import { logger } from '../../shared/logger.js';

export const exportRoute = {
  method: 'POST',
  path: '/api/v1/export',
  handler: async (req: Request, res: Response): Promise<void> => {
    try {
      const summary = req.body as ReportSummary;
      
      if (!summary || !summary.metadata) {
        res.status(400).json({
          success: false,
          error: 'Invalid or missing ReportSummary payload',
          code: 'VALIDATION_ERROR'
        });
        return;
      }

      logger.info('Generating PDF for report', { reportId: summary.metadata.reportId });

      const pdfBuffer = await generatePdfReport(summary);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="Medical_Report_Summary.pdf"');
      res.setHeader('Content-Length', pdfBuffer.length);
      
      res.status(200).send(pdfBuffer);
    } catch (error: any) {
      logger.error('Failed to generate PDF', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to generate PDF report',
        code: 'PDF_GENERATION_ERROR'
      });
    }
  },
};
