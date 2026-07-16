/**
 * tests/unit/layout/candidate-builder.test.ts
 *
 * Phase 8 — Unit tests for the candidate builder.
 */

import { describe, it, expect } from 'vitest';
import { buildCandidates, candidatesToText } from '../../../src/lib/layout/candidate-builder.js';
import type { LayoutBlock, LayoutDocument, LayoutRow } from '../../../src/lib/layout/types.js';

function makeRow(text: string, page = 0, ids: string[] = ['id-0']): LayoutRow {
  return { text, y: 400, xStart: 70, xEnd: 400, page, sourceItemIds: ids, items: [] };
}

function makeBlock(
  type: LayoutBlock['type'],
  rows: LayoutRow[],
  id = 'blk-0001',
): LayoutBlock {
  return {
    id,
    type,
    rows,
    page: rows[0]?.page ?? 0,
    text: rows.map((r) => r.text).join('\n'),
    sourceItemIds: rows.flatMap((r) => r.sourceItemIds),
  };
}

function makeDoc(blocks: LayoutBlock[]): LayoutDocument {
  return {
    pageCount: 1,
    itemsById: new Map(),
    blocks,
    candidates: [],
    isFullySpatial: true,
    rowsByPage: new Map(),
  };
}

describe('buildCandidates', () => {
  it('returns empty array for empty document', () => {
    expect(buildCandidates(makeDoc([]))).toEqual([]);
  });

  it('excludes header blocks', () => {
    const doc = makeDoc([makeBlock('header', [makeRow('Lab Name')])]);
    expect(buildCandidates(doc)).toHaveLength(0);
  });

  it('excludes footer blocks', () => {
    const doc = makeDoc([makeBlock('footer', [makeRow('Page 1 of 5')])]);
    expect(buildCandidates(doc)).toHaveLength(0);
  });

  it('excludes boilerplate blocks', () => {
    const doc = makeDoc([makeBlock('boilerplate', [makeRow('Conditions of Reporting')])]);
    expect(buildCandidates(doc)).toHaveLength(0);
  });

  it('excludes paragraph blocks', () => {
    const doc = makeDoc([makeBlock('paragraph', [makeRow('This report is a long prose section that should be excluded.')])]);
    expect(buildCandidates(doc)).toHaveLength(0);
  });

  it('includes section_title blocks as candidates', () => {
    const doc = makeDoc([makeBlock('section_title', [makeRow('LIPID PROFILE')])]);
    const candidates = buildCandidates(doc);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.regionType).toBe('section_title');
    expect(candidates[0]!.text).toBe('LIPID PROFILE');
  });

  it('includes lab_table rows using raw row text when no tableRows', () => {
    const doc = makeDoc([
      makeBlock('lab_table', [makeRow('Hemoglobin 14.5 g/dL 13.0-17.0')]),
    ]);
    const candidates = buildCandidates(doc);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.text).toBe('Hemoglobin 14.5 g/dL 13.0-17.0');
    expect(candidates[0]!.regionType).toBe('lab_table');
  });

  it('uses reconstructed tableRows when present', () => {
    const block = makeBlock('lab_table', [makeRow('Hemoglobin 14.5 g/dL')]);
    block.tableRows = [
      {
        testName: 'Hemoglobin',
        value: '14.5',
        unit: 'g/dL',
        referenceRange: '13.0-17.0',
        sourceRowIds: ['id-0'],
        sourceItemIds: ['id-0'],
        page: 0,
      },
    ];
    const doc = makeDoc([block]);
    const candidates = buildCandidates(doc);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.text).toBe('Hemoglobin 14.5 g/dL 13.0-17.0');
    expect(candidates[0]!.rawTestName).toBe('Hemoglobin');
  });

  it('sets sourceItemIds on each candidate', () => {
    const doc = makeDoc([makeBlock('lab_table', [makeRow('WBC 7.2', 0, ['p0-i1', 'p0-i2'])])]);
    const candidates = buildCandidates(doc);
    expect(candidates[0]!.sourceItemIds).toEqual(['p0-i1', 'p0-i2']);
  });

  it('sets page as 1-based on candidates', () => {
    const doc = makeDoc([makeBlock('lab_table', [makeRow('WBC 7.2', 2)])]);
    const candidates = buildCandidates(doc);
    expect(candidates[0]!.page).toBe(3); // 0-based page 2 → 1-based page 3
  });
});

describe('candidatesToText', () => {
  it('joins candidates into newline-separated text', () => {
    const candidates = [
      { text: 'Line 1', page: 1, regionType: 'lab_table' as const, sourceItemIds: [], sourceBlockId: 'b1' },
      { text: 'Line 2', page: 1, regionType: 'lab_table' as const, sourceItemIds: [], sourceBlockId: 'b1' },
    ];
    expect(candidatesToText(candidates)).toBe('Line 1\nLine 2');
  });
});
