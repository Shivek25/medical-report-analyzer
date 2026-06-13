import { describe, it, expect } from 'vitest';
import { generatePdfReport } from '../../../src/lib/pdf/generator.js';
import type { ReportSummary } from '../../../src/lib/types/index.js';

describe('PDF Generator', () => {
  const mockSummary: ReportSummary = {
    metadata: {
      patientName: 'John Doe',
      patientAge: 45,
      patientGender: 'M',
      reportDate: '2023-10-01',
      labName: 'Central Lab',
      reportId: 'REP-123',
    },
    generationMeta: {
      generatedAt: '2023-10-02T10:00:00Z',
      sourceConfidence: 0.95,
      totalEntries: 5,
      abnormalCount: 1,
      normalCount: 3,
      uncertainCount: 1,
      skippedCount: 0,
    },
    overviewText: 'Overall, the results indicate normal kidney function but elevated cholesterol.',
    abnormalFindings: [
      {
        category: 'Lipid Profile',
        findings: [
          {
            testName: 'Cholesterol Total',
            value: '240',
            unit: 'mg/dL',
            referenceRange: { low: 0, high: 200 },
            severity: 'high',
            category: 'Lipid Profile',
            interpretation: 'Elevated total cholesterol indicates increased cardiovascular risk.',
            uncertain: false,
          },
        ],
      },
    ],
    normalFindings: [
      {
        category: 'Kidney Function',
        entries: [
          {
            testName: 'Creatinine',
            value: '0.9',
            unit: 'mg/dL',
            referenceRange: { low: 0.6, high: 1.2 },
            category: 'Kidney Function',
            interpretation: 'Normal kidney function.',
          },
        ],
      },
    ],
    uncertainEntries: [
      {
        testName: 'Unknown Marker',
        value: 'N/A',
        severity: 'borderline-high',
        category: 'Uncategorized',
        interpretation: '',
        uncertain: true,
        uncertaintyReason: 'Missing value',
      },
    ],
    disclaimer: 'This is an automated summary.',
  };

  it('should generate a PDF buffer from a valid ReportSummary', async () => {
    const pdfBuffer = await generatePdfReport(mockSummary);
    expect(pdfBuffer).toBeDefined();
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(1000); // PDF files should have some decent size
    
    // Check if it starts with PDF magic number "%PDF-"
    const pdfMagic = pdfBuffer.toString('utf8', 0, 5);
    expect(pdfMagic).toBe('%PDF-');
  });

  it('should generate a PDF buffer even if sections are empty', async () => {
    const emptySummary: ReportSummary = {
      ...mockSummary,
      abnormalFindings: [],
      normalFindings: [],
      uncertainEntries: [],
      overviewText: '',
    };
    
    const pdfBuffer = await generatePdfReport(emptySummary);
    expect(pdfBuffer).toBeDefined();
    expect(pdfBuffer.length).toBeGreaterThan(500);
    expect(pdfBuffer.toString('utf8', 0, 5)).toBe('%PDF-');
  });
});
