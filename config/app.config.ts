/**
 * config/app.config.ts
 * Runtime application configuration schema.
 *
 * This file is intentionally standalone (no imports from src/).
 * It documents the config shape and is loaded by src/shared/config.ts at runtime.
 *
 * Phase 1: optionally add Zod schema validation here and import it from src/shared/config.ts.
 */

/** All environment variables consumed by the application */
export interface AppConfigSchema {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  /** Directory where uploaded PDFs are stored temporarily */
  PDF_UPLOAD_DIR: string;
  /** Directory where generated output PDFs are saved */
  OUTPUT_DIR: string;
  /** OpenAI API key — required in production */
  OPENAI_API_KEY: string;
  LOG_LEVEL: string;
}

/** Required keys that must be set for the app to start */
export const REQUIRED_CONFIG_KEYS: ReadonlyArray<keyof AppConfigSchema> = [
  'PORT',
  'PDF_UPLOAD_DIR',
  'OUTPUT_DIR',
];

/**
 * Validate that all required config values are present.
 * Call this at application startup before the server begins accepting requests.
 */
export function assertConfig(config: Partial<AppConfigSchema>): void {
  const missing = REQUIRED_CONFIG_KEYS.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required config keys: ${missing.join(', ')}`);
  }
}
