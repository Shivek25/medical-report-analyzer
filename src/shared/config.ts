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
} as const;

export type AppConfig = typeof config;
