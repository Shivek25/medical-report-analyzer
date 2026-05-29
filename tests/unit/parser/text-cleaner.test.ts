/**
 * tests/unit/parser/text-cleaner.test.ts
 *
 * Unit tests for the Phase 2 Text_Cleaner sub-module
 * (`src/lib/parser/text-cleaner.ts`).
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.5, 12.5
 */

import { describe, it, expect } from 'vitest';
import { clean } from '../../../src/lib/parser/text-cleaner.js';

describe('Text_Cleaner.clean — happy path (sample-derived header + body)', () => {
  it('strips page markers, blank/separator lines, and bare signature lines while preserving section headers and lab rows', () => {
    // Sample-derived fixture loosely modelled on the Thyrocare layout used
    // by the Phase 2 sample PDFs (e.g., shivek_June25.pdf). Mixes a header
    // zone, a section header, a few lab rows, blank/separator decoration,
    // a page-counter line, and a signature footer with no data tokens.
    const input = [
      'THYROCARE',
      'D-37/1, TTC MIDC, Turbhe, Navi Mumbai - 400703',
      'Name : Shivek Sharma (22Y/M)',
      'Report Date : 25/06/2025',
      'Page : 1 of 3',
      '',
      '------------------------------------',
      'HEMOGRAM',
      'HEMOGLOBIN 14.5 g/dL 12.0-16.0',
      'WBC COUNT 7200 /uL 4000-11000',
      '   ',
      '====================================',
      'Dr. Ramesh Kumar',
      'verified by lab analyst',
      'Scan the QR code for report verification',
      'Page : 2 of 3',
    ].join('\n');

    const cleanedLines = clean(input).split('\n');

    // (Req 3.2) — page markers must be gone.
    expect(cleanedLines.some((l) => /^Page\s*:?\s*\d+\s+of\s+\d+$/i.test(l.trim()))).toBe(false);

    // (Req 3.4) — whitespace-only and separator-only lines must be gone.
    expect(cleanedLines.some((l) => /^\s*$/.test(l))).toBe(false);
    expect(cleanedLines.some((l) => /^[\s\-_=]+$/.test(l) && l.length > 0)).toBe(false);

    // (Req 3.3) — bare signature / QR / "verified by" lines (no numeric / unit
    // token, no section-header shape) must be gone.
    expect(cleanedLines).not.toContain('Dr. Ramesh Kumar');
    expect(cleanedLines).not.toContain('verified by lab analyst');
    expect(cleanedLines).not.toContain('Scan the QR code for report verification');

    // (Req 3.5) — section header preserved verbatim.
    expect(cleanedLines).toContain('HEMOGRAM');

    // Lab rows and header metadata lines preserved.
    expect(cleanedLines).toContain('HEMOGLOBIN 14.5 g/dL 12.0-16.0');
    expect(cleanedLines).toContain('WBC COUNT 7200 /uL 4000-11000');
    expect(cleanedLines).toContain('Name : Shivek Sharma (22Y/M)');
    expect(cleanedLines).toContain('Report Date : 25/06/2025');

    // Cleaner is pure / deterministic (Req 3.6 sanity).
    expect(clean(input)).toBe(clean(input));
  });
});

describe('Text_Cleaner.clean — edge cases', () => {
  it('preserves a footer-shaped line that also carries a numeric / unit data token (Req 3.3)', () => {
    // The line literally contains the footer keyword "Reported by", which the
    // cleaner would normally strip, but it also carries a real lab measurement
    // (numeric value + unit), so Req 3.3 requires it to be preserved.
    const input = [
      'GLUCOSE FASTING 92 mg/dL 70-110',
      'Reported by analyzer 5.3 mmol/L',
      'Dr. Ramesh Kumar',
    ].join('\n');

    const cleanedLines = clean(input).split('\n');

    // Footer-shaped line with a unit token survives.
    expect(cleanedLines).toContain('Reported by analyzer 5.3 mmol/L');

    // Pure footer line without data still gets removed.
    expect(cleanedLines).not.toContain('Dr. Ramesh Kumar');

    // The genuine lab row is untouched.
    expect(cleanedLines).toContain('GLUCOSE FASTING 92 mg/dL 70-110');
  });

  it('removes duplicate lab/address page-header blocks after the first occurrence (Req 3.1)', () => {
    // The lab name + address block appears three times (once per page in a
    // 3-page report). Only the first occurrence should remain; the two
    // repeats must be stripped.
    const labBlock = ['THYROCARE', 'D-37/1, TTC MIDC, Turbhe, Navi Mumbai - 400703'];
    const input = [
      ...labBlock,
      'HEMOGLOBIN 14.5 g/dL 12.0-16.0',
      ...labBlock,
      'WBC COUNT 7200 /uL 4000-11000',
      ...labBlock,
      'PLATELET COUNT 250 x10^3/uL 150-410',
    ].join('\n');

    const cleanedLines = clean(input).split('\n');

    // The lab keyword line appears exactly once after dedup.
    const thyrocareCount = cleanedLines.filter((l) => l === 'THYROCARE').length;
    expect(thyrocareCount).toBe(1);

    const addressCount = cleanedLines.filter(
      (l) => l === 'D-37/1, TTC MIDC, Turbhe, Navi Mumbai - 400703',
    ).length;
    expect(addressCount).toBe(1);

    // None of the lab data rows are dropped.
    expect(cleanedLines).toContain('HEMOGLOBIN 14.5 g/dL 12.0-16.0');
    expect(cleanedLines).toContain('WBC COUNT 7200 /uL 4000-11000');
    expect(cleanedLines).toContain('PLATELET COUNT 250 x10^3/uL 150-410');

    // Source order is preserved (the surviving lab block sits before the
    // first lab row, not after).
    const firstThyrocareIdx = cleanedLines.indexOf('THYROCARE');
    const firstHbIdx = cleanedLines.indexOf('HEMOGLOBIN 14.5 g/dL 12.0-16.0');
    expect(firstThyrocareIdx).toBeGreaterThanOrEqual(0);
    expect(firstThyrocareIdx).toBeLessThan(firstHbIdx);
  });
});
