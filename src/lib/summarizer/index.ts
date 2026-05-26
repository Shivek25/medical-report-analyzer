/**
 * src/lib/summarizer/index.ts
 * Summary generator — produces a human-readable MedicalSummary from
 * a validated BloodTestReport using an LLM.
 *
 * Phase 2 implementation will call the OpenAI / Gemini API.
 */

import type { BloodTestReport, MedicalSummary } from '../types/index.js';

export interface SummaryOptions {
  /** Language for the summary (default: 'en') */
  language?: string;
  /** Include raw LLM response for debugging */
  debug?: boolean;
}

/**
 * Generate a MedicalSummary from a validated BloodTestReport.
 */
export async function generateSummary(
  _report: BloodTestReport,
  _options?: SummaryOptions,
): Promise<MedicalSummary> {
  // TODO (Phase 2): call LLM with structured prompt from prompts/
  throw new Error('generateSummary: not yet implemented');
}

/**
 * Build the prompt string sent to the LLM.
 * Kept as a pure function for easy testing.
 */
export function buildSummaryPrompt(_report: BloodTestReport): string {
  // TODO (Phase 2): implement
  throw new Error('buildSummaryPrompt: not yet implemented');
}
