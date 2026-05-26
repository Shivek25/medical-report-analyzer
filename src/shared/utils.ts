/**
 * src/shared/utils.ts
 * Generic pure utility functions. No domain logic, no side effects.
 */

import { randomUUID } from 'crypto';

/** Generate a unique identifier */
export function generateId(): string {
  return randomUUID();
}

/** Format a Date as an ISO 8601 string */
export function toISOString(date: Date = new Date()): string {
  return date.toISOString();
}

/** Clamp a number between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Strip leading/trailing whitespace and collapse internal whitespace */
export function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** Return true if a value is a non-empty string */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Safe JSON parse — returns null instead of throwing */
export function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
