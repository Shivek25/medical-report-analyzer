/**
 * src/lib/extraction/client-factory.ts
 *
 * Phase 7 — Extraction client factory.
 *
 * Single entry point for selecting the right `LlmClient` based on runtime
 * configuration. The logic is intentionally simple — a single if/else on
 * `LLM_EXTRACTION_ENABLED`:
 *
 *   true  → OllamaClient (qwen3:8b by default). The client's built-in health
 *            check handles the case where Ollama is not running, returning
 *            { ok: false } so the extractor falls back to the deterministic parser.
 *
 *   false → StubClient with enabled:false. The stub immediately returns
 *            { ok: false, error: 'stub-disabled' }, causing the extractor to
 *            use the deterministic parser exclusively.
 *
 * There is no conditional on OLLAMA_BASE_URL: the config always supplies
 * `http://localhost:11434` as the default, so checking whether the URL is set
 * would create a confusing third branch with no benefit. Reachability is the
 * Ollama client's concern, not the factory's.
 */

import type { AppConfig } from '../../shared/config.js';
import type { LlmClient } from './llm-client.js';
import { createStubClient } from './llm-client.js';
import { createOllamaClient } from './ollama-client.js';

/**
 * Return the appropriate `LlmClient` for the current configuration.
 *
 * @param config - The application config object (from `src/shared/config.ts`).
 *
 * When `LLM_EXTRACTION_ENABLED` is `true` the returned Ollama client will
 * automatically fall back on the first call if the local Ollama server is not
 * reachable. The `extractWithLlm` orchestrator then falls back to the
 * deterministic parser via the `lowYield` / `usedLlmPath` flags.
 */
export function createExtractionClient(config: AppConfig): LlmClient {
  if (config.LLM_EXTRACTION_ENABLED) {
    return createOllamaClient({
      baseUrl: config.OLLAMA_BASE_URL,
      model: config.OLLAMA_MODEL,
      requestTimeoutMs: config.OLLAMA_TIMEOUT_MS,
    });
  }
  return createStubClient({ enabled: false });
}
