/**
 * tests/unit/shared/utils.test.ts
 * Unit tests for shared utility functions — these CAN run today.
 */

import { describe, it, expect } from 'vitest';
import {
  generateId,
  toISOString,
  clamp,
  normalizeWhitespace,
  isNonEmptyString,
  safeJsonParse,
} from '../../../src/shared/utils.js';

describe('generateId', () => {
  it('returns a non-empty string', () => {
    expect(typeof generateId()).toBe('string');
    expect(generateId().length).toBeGreaterThan(0);
  });

  it('returns a unique value on each call', () => {
    expect(generateId()).not.toBe(generateId());
  });
});

describe('toISOString', () => {
  it('returns a valid ISO 8601 string', () => {
    const result = toISOString(new Date('2026-01-15T10:00:00.000Z'));
    expect(result).toBe('2026-01-15T10:00:00.000Z');
  });

  it('defaults to current time when no argument passed', () => {
    const before = Date.now();
    const result = toISOString();
    const after = Date.now();
    const ts = new Date(result).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('returns min when value is below range', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('returns max when value is above range', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('normalizeWhitespace', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeWhitespace('  hello  ')).toBe('hello');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeWhitespace('hello   world')).toBe('hello world');
  });
});

describe('isNonEmptyString', () => {
  it('returns true for a non-empty string', () => {
    expect(isNonEmptyString('hello')).toBe(true);
  });

  it('returns false for an empty string', () => {
    expect(isNonEmptyString('')).toBe(false);
  });

  it('returns false for whitespace-only string', () => {
    expect(isNonEmptyString('   ')).toBe(false);
  });

  it('returns false for non-string values', () => {
    expect(isNonEmptyString(42)).toBe(false);
    expect(isNonEmptyString(null)).toBe(false);
  });
});

describe('safeJsonParse', () => {
  it('returns parsed object for valid JSON', () => {
    expect(safeJsonParse<{ name: string }>('{"name":"test"}')).toEqual({ name: 'test' });
  });

  it('returns null for invalid JSON', () => {
    expect(safeJsonParse('not json')).toBeNull();
  });
});
