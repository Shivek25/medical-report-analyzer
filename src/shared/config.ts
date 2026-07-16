/**
 * src/shared/config.ts
 * Reads environment variables and exports a strongly-typed config object.
 * Throws at startup if required variables are missing.
 */

import 'dotenv/config';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  NODE_ENV: optionalEnv('NODE_ENV', 'development') as 'development' | 'production' | 'test',
  PORT: parseInt(optionalEnv('PORT', '3000'), 10),

  /** Directory where uploaded PDFs are stored temporarily */
  PDF_UPLOAD_DIR: optionalEnv('PDF_UPLOAD_DIR', './data/uploads'),

  /** Directory where generated output PDFs are saved */
  OUTPUT_DIR: optionalEnv('OUTPUT_DIR', './outputs'),

  /** OpenAI API key — required only in production; stubbed in dev */
  OPENAI_API_KEY: (() => {
    try { return requireEnv('OPENAI_API_KEY'); }
    catch { return ''; }
  })(),

  LOG_LEVEL: optionalEnv('LOG_LEVEL', 'info'),

  // ─── Phase 6 — LLM-assisted extraction ────────────────────────────────────
  /**
   * Enable the LLM-assisted extraction stage. Defaults to `false`: until a real
   * provider adapter is wired in, the route uses the deterministic parser. When
   * `true`, the stub classifier runs first and the deterministic parser is the
   * fallback whenever the LLM path fails or yields too little.
   */
  LLM_EXTRACTION_ENABLED: optionalEnv('LLM_EXTRACTION_ENABLED', 'false') === 'true',
  /**
   * Minimum model confidence (0..1) for admitting a `lab_result` as a finding.
   * Items below the threshold are demoted to `uncertain`.
   */
  LLM_CONFIDENCE_THRESHOLD: Number.parseFloat(
    optionalEnv('LLM_CONFIDENCE_THRESHOLD', '0.5'),
  ),

  // ─── Phase 7 — Ollama adapter ─────────────────────────────────────────────
  /**
   * Base URL of the local Ollama server. The Ollama client will ping this
   * host for a health check before the first extraction request. If
   * unreachable it falls back to the deterministic parser without waiting
   * for the full generate timeout.
   */
  OLLAMA_BASE_URL: optionalEnv('OLLAMA_BASE_URL', 'http://localhost:11434'),
  /**
   * Ollama model tag to use for extraction. Defaults to qwen3:8b.
   * MedGemma is reserved for a later medical interpretation phase.
   */
  OLLAMA_MODEL: optionalEnv('OLLAMA_MODEL', 'qwen3:8b'),
  /**
   * HTTP timeout in milliseconds for Ollama generate calls. The health check
   * uses a shorter timeout (5 s) to fail fast when Ollama is not running.
   */
  OLLAMA_TIMEOUT_MS: Number.parseInt(optionalEnv('OLLAMA_TIMEOUT_MS', '60000'), 10),
} as const;

export type AppConfig = typeof config;
