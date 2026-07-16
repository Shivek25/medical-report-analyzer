/**
 * tests/unit/layout/page-analyzer.test.ts
 *
 * Phase 8 — Unit tests for the page-analyzer module.
 */

import { describe, it, expect } from 'vitest';
import { groupItemsIntoRows } from '../../../src/lib/layout/page-analyzer.js';
import type { SpatialItem } from '../../../src/lib/layout/types.js';

function makeItem(id: string, text: string, x: number, y: number, width = 40, height = 8): SpatialItem {
  return { id, text, x, y, width, height, page: 0 };
}

describe('groupItemsIntoRows', () => {
  it('returns empty array for empty input', () => {
    expect(groupItemsIntoRows([], 0)).toEqual([]);
  });

  it('groups items at the same Y into one row', () => {
    const items = [
      makeItem('a', 'Hemoglobin', 70, 500),
      makeItem('b', '14.5', 200, 500),
      makeItem('c', 'g/dL', 250, 500),
    ];
    const rows = groupItemsIntoRows(items, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toContain('Hemoglobin');
    expect(rows[0]!.sourceItemIds).toEqual(['a', 'b', 'c']);
  });

  it('creates separate rows for items with Y difference > tolerance', () => {
    const items = [
      makeItem('a', 'Row 1', 70, 500),
      makeItem('b', 'Row 2', 70, 485), // 15 units apart — different rows
    ];
    const rows = groupItemsIntoRows(items, 0);
    expect(rows).toHaveLength(2);
  });

  it('groups items within Y tolerance (4 units) into same row', () => {
    const items = [
      makeItem('a', 'Part1', 70, 500),
      makeItem('b', 'Part2', 130, 502), // 2 units apart — same row
    ];
    const rows = groupItemsIntoRows(items, 0);
    expect(rows).toHaveLength(1);
  });

  it('sorts items left-to-right within a row', () => {
    const items = [
      makeItem('c', 'C-item', 300, 500),
      makeItem('a', 'A-item', 70, 500),
      makeItem('b', 'B-item', 180, 500),
    ];
    const rows = groupItemsIntoRows(items, 0);
    expect(rows[0]!.sourceItemIds).toEqual(['a', 'b', 'c']);
  });

  it('preserves page index on output rows', () => {
    const items = [makeItem('a', 'Test', 70, 500)];
    const rows = groupItemsIntoRows(items, 3);
    expect(rows[0]!.page).toBe(3);
  });

  it('excludes items with empty text', () => {
    const items = [
      makeItem('a', '', 70, 500),
      makeItem('b', 'Value', 200, 500),
    ];
    const rows = groupItemsIntoRows(items, 0);
    // Only 'Value' survives; empty string is below MIN_TEXT_LENGTH=1
    expect(rows[0]!.sourceItemIds).not.toContain('a');
  });
});
