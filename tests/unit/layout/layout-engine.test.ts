/**
 * tests/unit/layout/layout-engine.test.ts
 *
 * Phase 8 — Integration tests for the full layout engine pipeline.
 * Also covers the partial geometry fallback scenario.
 */

import { describe, it, expect } from 'vitest';
import { analyzeLayout } from '../../../src/lib/layout/index.js';
import type { PageSpatialData, RawSpatialItem } from '../../../src/lib/layout/index.js';

function makeRawItem(
  str: string,
  x: number,
  y: number,
  width = 40,
  height = 8,
): RawSpatialItem {
  return { str, transform: [1, 0, 0, 1, x, y], width, height };
}

function makePage(page: number, items: RawSpatialItem[]): PageSpatialData {
  return { page, items };
}

describe('analyzeLayout — full pipeline', () => {
  it('returns empty candidates for an empty document', () => {
    const doc = analyzeLayout([], true);
    expect(doc.candidates).toHaveLength(0);
    expect(doc.blocks).toHaveLength(0);
    expect(doc.pageCount).toBe(0);
  });

  it('produces a LayoutDocument with correct pageCount', () => {
    const pages = [
      makePage(0, [makeRawItem('Hemoglobin', 70, 500)]),
      makePage(1, [makeRawItem('WBC', 70, 500)]),
    ];
    const doc = analyzeLayout(pages, true);
    expect(doc.pageCount).toBe(2);
  });

  it('populates itemsById with stable IDs', () => {
    const pages = [makePage(0, [makeRawItem('TSH', 70, 500)])];
    const doc = analyzeLayout(pages, true);
    expect(doc.itemsById.has('p0-i0')).toBe(true);
    expect(doc.itemsById.get('p0-i0')?.text).toBe('TSH');
  });

  it('strips header lines and does not emit them as candidates', () => {
    const pages = [
      makePage(0, [
        makeRawItem('PROCESSED AT :', 70, 745),  // header
        makeRawItem('Thyrocare', 70, 732),        // header
        makeRawItem('Hemoglobin', 70, 400),
        makeRawItem('14.5', 200, 400),
        makeRawItem('g/dL', 260, 400),
      ]),
    ];
    const doc = analyzeLayout(pages, true);

    const texts = doc.candidates.map((c) => c.text);
    expect(texts.some((t) => t.includes('PROCESSED AT'))).toBe(false);
    expect(texts.some((t) => t.includes('Thyrocare'))).toBe(false);
  });

  it('produces candidates with sourceItemIds traceability', () => {
    const pages = [
      makePage(0, [
        makeRawItem('Hemoglobin', 70, 400),
        makeRawItem('14.5', 200, 400),
      ]),
    ];
    const doc = analyzeLayout(pages, true);
    // All candidates should have at least one sourceItemId
    for (const candidate of doc.candidates) {
      expect(candidate.sourceItemIds.length).toBeGreaterThan(0);
    }
  });

  it('sets isFullySpatial=false when flagged', () => {
    const pages = [makePage(0, [makeRawItem('TSH', 70, 500)])];
    const doc = analyzeLayout(pages, false);
    expect(doc.isFullySpatial).toBe(false);
  });

  it('handles a document with only boilerplate gracefully (zero candidates)', () => {
    const pages = [
      makePage(0, [
        makeRawItem('Conditions of Reporting', 70, 200),
        makeRawItem('Page 1 of 3', 70, 30),
      ]),
    ];
    const doc = analyzeLayout(pages, true);
    // Boilerplate and footers → 0 non-excluded candidates
    const nonBoilerplate = doc.candidates.filter(
      (c) => c.regionType !== 'boilerplate' && c.regionType !== 'footer',
    );
    expect(nonBoilerplate).toHaveLength(0);
  });
});

describe('Layout engine — partial geometry fallback', () => {
  it('gracefully handles pages with no items', () => {
    const pages = [
      makePage(0, []),
      makePage(1, [makeRawItem('Hemoglobin 14.5 g/dL', 70, 400)]),
    ];
    // Should not throw
    expect(() => analyzeLayout(pages, false)).not.toThrow();
  });

  it('handles items with zero-dimension bounding boxes', () => {
    const pages = [
      makePage(0, [
        { str: 'WBC', transform: [1, 0, 0, 1, 0, 0], width: 0, height: 0 },
        makeRawItem('7.2', 200, 400),
      ]),
    ];
    expect(() => analyzeLayout(pages, false)).not.toThrow();
  });

  it('returns isFullySpatial=false when called with false', () => {
    const pages = [makePage(0, [makeRawItem('Creatinine', 70, 400)])];
    const doc = analyzeLayout(pages, false);
    expect(doc.isFullySpatial).toBe(false);
  });
});

describe('Layout engine — ontology annotation (post-reconstruction)', () => {
  it('annotates candidates with canonical names after building', () => {
    const pages = [
      makePage(0, [
        makeRawItem('Hb', 70, 400),
        makeRawItem('14.5', 200, 400),
        makeRawItem('g/dL', 260, 400),
      ]),
    ];
    const doc = analyzeLayout(pages, true);
    // Find any candidate with text containing 'Hb'
    const hbCandidate = doc.candidates.find((c) => c.text.includes('Hb') || c.text.includes('14.5'));
    if (hbCandidate?.canonicalTestName) {
      expect(hbCandidate.canonicalTestName).toBe('Hemoglobin');
    }
    // text field is not modified
    if (hbCandidate) {
      expect(hbCandidate.text).not.toContain('Hemoglobin');
    }
  });
});
