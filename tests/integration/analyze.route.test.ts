/**
 * tests/integration/analyze.route.test.ts
 *
 * Integration tests for POST /api/v1/analyze
 *
 * Tests the full parse → summarize pipeline endpoint:
 *   - Valid IngestionResult produces a ReportSummary
 *   - 'failed' extractionStatus returns a valid (empty) summary
 *   - Invalid payload returns 400
 *   - Response shape includes success, report, summary, warnings
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from '../../src/server/index.js';
import { extractTextFromPdf } from '../../src/lib/pdf/extractor.js';
import type { IngestionResult } from '../../src/lib/types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const SAMPLES_DIR = path.resolve(__dirname, '../../data/samples');

describe('POST /api/v1/analyze', () => {
  const app = createServer();

  // ─── Invalid payload ──────────────────────────────────────────────────────

  it('returns 400 for a missing body', async () => {
    const res = await request(app)
      .post('/api/v1/analyze')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when extractionStatus is not a known enum value', async () => {
    const payload = {
      originalFilename: 'test.pdf',
      storedFilePath: '/tmp/test.pdf',
      extractionStatus: 'unknown_status',
      extractedText: 'some text',
    };
    const res = await request(app)
      .post('/api/v1/analyze')
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // ─── 'failed' extraction short-circuits cleanly ───────────────────────────

  it('returns 200 with an empty summary for a failed IngestionResult', async () => {
    const failedIngestion: IngestionResult = {
      originalFilename: 'corrupt.pdf',
      storedFilePath: '/tmp/corrupt.pdf',
      extractionStatus: 'failed',
      extractedText: '',
      warningsOrErrors: ['File read error: ENOENT'],
    };

    const res = await request(app)
      .post('/api/v1/analyze')
      .send(failedIngestion);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary).toBeDefined();
    expect(res.body.report).toBeDefined();
    // Empty report has 0 entries
    expect(res.body.report.entries).toHaveLength(0);
    // Warnings surface the upstream error
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.warnings.some((w: string) => w.includes('File read error'))).toBe(true);
  });

  // ─── Full pipeline with a real PDF ───────────────────────────────────────

  it('returns 200 with a populated ReportSummary for a real PDF', async () => {
    const pdfPath = path.join(SAMPLES_DIR, 'shivek_June25.pdf');
    const ingestion = await extractTextFromPdf(pdfPath, 'shivek_June25.pdf');

    const res = await request(app)
      .post('/api/v1/analyze')
      .send(ingestion);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Report shape
    const report = res.body.report;
    expect(report.entries).toBeDefined();
    expect(report.extractionQuality).toBeDefined();
    expect(typeof report.extractionQuality.confidence).toBe('number');

    // Summary shape
    const summary = res.body.summary;
    expect(summary.generationMeta).toBeDefined();
    expect(summary.overviewText).toBeDefined();
    expect(Array.isArray(summary.abnormalFindings)).toBe(true);
    expect(Array.isArray(summary.normalFindings)).toBe(true);
    expect(Array.isArray(summary.uncertainEntries)).toBe(true);
    expect(typeof summary.disclaimer).toBe('string');

    // Metadata preserved
    expect(summary.metadata).toBeDefined();

    // Warnings array always present (may be empty)
    expect(Array.isArray(res.body.warnings)).toBe(true);
  });

  // ─── Response includes total counts ──────────────────────────────────────

  it('generationMeta totalEntries equals entries.length in the report', async () => {
    const pdfPath = path.join(SAMPLES_DIR, 'shivek_June25.pdf');
    const ingestion = await extractTextFromPdf(pdfPath, 'shivek_June25.pdf');

    const res = await request(app)
      .post('/api/v1/analyze')
      .send(ingestion);

    expect(res.status).toBe(200);
    const { report, summary } = res.body;
    expect(summary.generationMeta.totalEntries).toBe(report.entries.length);
  });
});
