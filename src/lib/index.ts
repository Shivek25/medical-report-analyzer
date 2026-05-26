/**
 * src/lib/index.ts
 * Barrel export for all core library modules.
 * Import from '@lib' to access all domain logic.
 */

export * from './types/index.js';
export * as pdf from './pdf/index.js';
export * as parser from './parser/index.js';
export * as validator from './validator/index.js';
export * as summarizer from './summarizer/index.js';
export * as exporter from './exporter/index.js';
