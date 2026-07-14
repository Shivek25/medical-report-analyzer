/**
 * src/server/routes/analyze.route.ts
 * Route handler for POST /api/v1/analyze
 *
 * Accepts an IngestionResult (produced by /upload), runs the full
 * parse → summarize pipeline, and returns a structured AnalyzeResponse.
 */

import type { Request, Response, NextFunction } from 'express';
import { parseRawText } from '../../lib/parser/orchestrator.js';
import { buildReportSummary } from '../../lib/summarizer/summary-builder.js';
import { extractWithLlm, createStubClient } from '../../lib/extraction/index.js';
import type { IngestionResult } from '../../lib/types/index.js';
import { config } from '../../shared/config.js';
import { logger } from '../../shared/logger.js';

export interface AnalyzePipelineResponse {
  success: boolean;
  report: ReturnType<typeof parseRawText>;
  summary: ReturnType<typeof buildReportSummary>;
  warnings: string[];
}

export const analyzeRoute = {
  method: 'POST',
  path: '/api/v1/analyze',
  handler: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ingestion = req.body as IngestionResult;

      // Basic validation: must have extractedText and extractionStatus
      if (
        !ingestion ||
        typeof ingestion.extractedText !== 'string' ||
        !['success', 'failed', 'scanned_fallback'].includes(ingestion.extractionStatus)
      ) {
        res.status(400).json({
          success: false,
          error: 'Invalid payload. Expected an IngestionResult with extractedText and extractionStatus.',
          code: 'VALIDATION_ERROR',
        });
        return;
      }

      logger.info('Analyze pipeline starting', {
        status: ingestion.extractionStatus,
        filename: ingestion.originalFilename,
      });

      // Phase 6: LLM-assisted extraction (optional) with deterministic fallback.
      // The deterministic parser is always the final gate: when the LLM path is
      // disabled, fails, or yields too little, we fall back to it.
      let report: ReturnType<typeof parseRawText>;
      let usedLlmPath = false;
      if (config.LLM_EXTRACTION_ENABLED) {
        const outcome = await extractWithLlm(ingestion, createStubClient({ enabled: true }), {
          confidenceThreshold: config.LLM_CONFIDENCE_THRESHOLD,
        });
        if (outcome.usedLlmPath && !outcome.lowYield) {
          report = outcome.report;
          usedLlmPath = true;
        } else {
          logger.info('Analyze pipeline falling back to deterministic parser', {
            reason: outcome.usedLlmPath ? 'low-yield' : 'llm-path-disabled-or-failed',
          });
          report = parseRawText(ingestion);
        }
      } else {
        report = parseRawText(ingestion);
      }

      // Phase 3: Summarize
      const summary = buildReportSummary(report);

      // Collect any quality warnings to surface to the frontend
      const warnings: string[] = [
        ...(ingestion.warningsOrErrors ?? []),
        ...report.extractionQuality.warnings,
      ];

      if (report.extractionQuality.lowConfidence) {
        warnings.push('Low confidence parse: the report may be a scanned image. Results may be incomplete.');
      }
      if (report.extractionQuality.validationFailed) {
        warnings.push('Report structure failed validation. Some data may be missing or incorrect.');
      }

      logger.info('Analyze pipeline complete', {
        entries: report.entries.length,
        abnormal: summary.generationMeta.abnormalCount,
        confidence: report.extractionQuality.confidence,
        usedLlmPath,
      });

      if (usedLlmPath) {
        warnings.unshift('Report parsed via the LLM-assisted extraction stage (Phase 6).');
      }

      const response: AnalyzePipelineResponse = {
        success: true,
        report,
        summary,
        warnings,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  },
};
