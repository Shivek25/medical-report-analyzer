/**
 * tests/integration/upload.test.ts
 * Integration tests for the upload API route.
 *
 * Phase 1: implement once the HTTP server layer is wired up.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import { createServer } from '../../src/server/index.js';

describe('POST /api/v1/upload', () => {
  const app = createServer();
  const samplePdfPath = path.resolve(__dirname, '../../../data/samples/shivek_June25.pdf');
  // Wait, __dirname is .../tests/integration/
  // __dirname/../../data/samples
  const correctPdfPath = path.resolve(__dirname, '../../data/samples/shivek_June25.pdf');

  it('returns 200 with an UploadResponse for a valid PDF file', async () => {
    const response = await request(app)
      .post('/api/v1/upload')
      .attach('report', correctPdfPath);
      
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.result).toBeDefined();
    expect(response.body.result.extractionStatus).toBeDefined();
    expect(response.body.result.extractedText).toBeDefined();
  });

  it('returns 400 when no file is attached to the request', async () => {
    const response = await request(app)
      .post('/api/v1/upload');
      
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('No file uploaded');
  });

  it('returns 400 when the uploaded file is not a PDF', async () => {
    const response = await request(app)
      .post('/api/v1/upload')
      .attach('report', Buffer.from('this is not a pdf'), 'dummy.txt');
      
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('Only PDF files are allowed!');
  });

  it('returns 400 when the uploaded file exceeds the 5 MB limit', async () => {
    // Generate a 6MB dummy PDF payload
    const largeBuffer = Buffer.alloc(6 * 1024 * 1024, '0');
    const response = await request(app)
      .post('/api/v1/upload')
      .attach('report', largeBuffer, 'large.pdf');
      
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('File too large');
  });
});
