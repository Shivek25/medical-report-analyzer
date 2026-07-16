/**
 * src/lib/extraction/index.ts
 *
 * Phase 6/7 — LLM-assisted structured extraction barrel.
 *
 * Public surface:
 *   - `extractWithLlm`          — the extraction stage entry point.
 *   - `createStubClient`        — deterministic, network-free `LlmClient`.
 *   - `createOllamaClient`      — Ollama-backed `LlmClient` (qwen3:8b).
 *   - `createExtractionClient`  — factory: selects Ollama vs stub from config.
 *   - `LlmClient` interface + supporting types — for plugging in a real
 *     provider adapter later.
 *   - `generateCandidates`, `validateLabResult` — re-exported for unit tests.
 *
 * Production code should call `extractWithLlm` (or the route-level wrapper) and
 * depend only on this barrel + the shared types in `src/lib/types/index.ts`.
 */

export { extractWithLlm } from './extractor.js';
export { createStubClient, type LlmClient, type StubClientOptions } from './llm-client.js';
export { createOllamaClient, type OllamaClientOptions } from './ollama-client.js';
export { createExtractionClient } from './client-factory.js';
export { generateCandidates } from './candidate-generator.js';
export { validateLabResult, type ValidatedLabResult } from './validator.js';
export type {
  BlockLabel,
  CandidateBlock,
  CollectedMetadata,
  ExtractionOptions,
  ExtractionOutcome,
  LabeledItem,
  LlmClassificationRequest,
  LlmClassificationResponse,
  MetadataField,
  NormalizedLabResult,
} from './types.js';

