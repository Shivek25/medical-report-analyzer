import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from '../../src/server/index.js';
import type { ReportSummary } from '../../src/lib/types/index.js';

describe('POST /api/v1/export', () => {
  const app = createServer();

  const mockSummary: ReportSummary = {
    metadata: {
      patientName: 'Jane Doe',
      patientAge: 30,
      patientGender: 'F',
      reportId: 'REP-999',
    },
    generationMeta: {
      generatedAt: '2023-10-02T10:00:00Z',
      sourceConfidence: 0.9,
      totalEntries: 2,
      abnormalCount: 0,
      normalCount: 2,
      uncertainCount: 0,
      skippedCount: 0,
    },
    overviewText: 'All good.',
    abnormalFindings: [],
    normalFindings: [],
    uncertainEntries: [],
    disclaimer: 'Disclaimer test',
  };

  it('should return a 400 if payload is missing or invalid', async () => {
    const res = await request(app)
      .post('/api/v1/export')
      .send({ invalid: 'payload' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('should generate and return a PDF file for a valid ReportSummary', async () => {
    const res = await request(app)
      .post('/api/v1/export')
      .send(mockSummary);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment; filename="Medical_Report_Summary.pdf"');
    
    // The body should be a buffer representing the PDF
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(500);
    expect(res.body.toString('utf8', 0, 5)).toBe('%PDF-');
  });
});
