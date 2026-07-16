/**
 * tests/unit/layout/header-footer-detector.test.ts
 *
 * Phase 8 — Unit tests for the header-footer detector.
 */

import { describe, it, expect } from 'vitest';
import { detectHeadersAndFooters } from '../../../src/lib/layout/header-footer-detector.js';
import type { LayoutRow } from '../../../src/lib/layout/types.js';

function makeRow(text: string, y: number, page: number, ids: string[]): LayoutRow {
  return {
    text,
    y,
    xStart: 70,
    xEnd: 400,
    page,
    sourceItemIds: ids,
    items: [],
  };
}

describe('detectHeadersAndFooters', () => {
  it('returns empty sets for empty input', () => {
    const result = detectHeadersAndFooters(new Map());
    expect(result.headerItemIds.size).toBe(0);
    expect(result.footerItemIds.size).toBe(0);
  });

  it('detects known header patterns by text', () => {
    const rows = [makeRow('PROCESSED AT :', 745, 0, ['p0-i0'])];
    const rowsByPage = new Map([[0, rows]]);
    const result = detectHeadersAndFooters(rowsByPage);
    expect(result.headerItemIds.has('p0-i0')).toBe(true);
  });

  it('detects known footer patterns by text', () => {
    const rows = [makeRow('Page 1 of 5', 20, 0, ['p0-i1'])];
    const rowsByPage = new Map([[0, rows]]);
    const result = detectHeadersAndFooters(rowsByPage);
    expect(result.footerItemIds.has('p0-i1')).toBe(true);
  });

  it('detects repeated rows at same Y as headers', () => {
    const rows0 = [makeRow('Lab Name Inc', 740, 0, ['p0-header'])];
    const rows1 = [makeRow('Lab Name Inc', 740, 1, ['p1-header'])];
    const rowsByPage = new Map([
      [0, rows0],
      [1, rows1],
    ]);
    const result = detectHeadersAndFooters(rowsByPage);
    // Both pages have the same text at the same Y → repeated header
    expect(result.headerItemIds.has('p0-header')).toBe(true);
    expect(result.headerItemIds.has('p1-header')).toBe(true);
  });

  it('does not flag unique rows as headers/footers', () => {
    const rows0 = [makeRow('Hemoglobin 14.5 g/dL', 400, 0, ['p0-data'])];
    const rows1 = [makeRow('Platelets 250 thousand/µL', 400, 1, ['p1-data'])];
    const rowsByPage = new Map([
      [0, rows0],
      [1, rows1],
    ]);
    const result = detectHeadersAndFooters(rowsByPage);
    expect(result.headerItemIds.has('p0-data')).toBe(false);
    expect(result.footerItemIds.has('p1-data')).toBe(false);
  });

  it('detects "not a substitute" as footer boilerplate', () => {
    const rows = [makeRow('Not a substitute for clinical diagnosis', 10, 0, ['f0'])];
    const rowsByPage = new Map([[0, rows]]);
    const result = detectHeadersAndFooters(rowsByPage);
    expect(result.footerItemIds.has('f0')).toBe(true);
  });
});
