/**
 * src/lib/summarizer/interpreter.ts
 *
 * Pure function that generates a human-readable interpretation string
 * for a classified lab entry.
 *
 * Rules:
 *   - No diagnosis. No treatment recommendations.
 *   - Factual observations only ("Above normal range", "Within normal range").
 *   - Include reference range in parentheses when available.
 *   - Preserve uncertainty when ranges are missing.
 */

import type { LabEntry, LabReferenceRange } from '../types/index.js';
import type { ClassificationResult } from './classifier.js';
import { logger } from '../../shared/logger.js';

/**
 * Format a reference range for display.
 *
 * Examples:
 *   - `{ low: 4.0, high: 11.0 }` → `"4 – 11"`
 *   - `{ high: 5.0 }` → `"up to 5"`
 *   - `{ low: 1.5 }` → `"1.5 or above"`
 *   - `{ text: "Negative" }` → `"Negative"`
 *   - `undefined` → `undefined`
 */
export function formatReferenceRange(ref?: LabReferenceRange): string | undefined {
  if (ref === undefined) {
    return undefined;
  }

  const hasLow = ref.low !== undefined;
  const hasHigh = ref.high !== undefined;

  if (hasLow && hasHigh) {
    return `${formatNum(ref.low!)} – ${formatNum(ref.high!)}`;
  }
  if (hasHigh) {
    return `up to ${formatNum(ref.high!)}`;
  }
  if (hasLow) {
    return `${formatNum(ref.low!)} or above`;
  }
  if (ref.text !== undefined && ref.text.trim().length > 0) {
    return ref.text.trim();
  }
  return undefined;
}

/** Format a number for display: strip trailing zeros but keep useful precision. */
function formatNum(n: number): string {
  // Use at most 2 decimal places, then strip trailing zeros
  return parseFloat(n.toFixed(2)).toString();
}

/** Interpretation templates keyed by classification. */
const INTERPRETATION_TEMPLATES: Record<
  Exclude<ClassificationResult, 'skipped'>,
  string
> = {
  'critical-high': 'Significantly above the normal range',
  'critical-low': 'Significantly below the normal range',
  high: 'Above normal range',
  low: 'Below normal range',
  'borderline-high': 'Slightly above the upper reference limit',
  'borderline-low': 'Slightly below the lower reference limit',
  normal: 'Within normal range',
};

let ollamaDisabledUntil = 0;

/**
 * Generate a human-readable interpretation for a lab entry and its classification.
 *
 * @param entry  The lab entry being interpreted.
 * @param classification  The severity classification from `classifyEntry`.
 * @returns A plain-language interpretation string.
 */
export async function interpretFinding(
  entry: LabEntry,
  classification: ClassificationResult,
): Promise<string> {
  if (classification === 'skipped') {
    if (entry.referenceRange === undefined) {
      return 'Unable to interpret — reference range not available';
    }
    return 'Non-numeric result — manual review recommended';
  }

  const base = INTERPRETATION_TEMPLATES[classification];
  const unit = entry.unit !== undefined && entry.unit.trim().length > 0 ? ` ${entry.unit.trim()}` : '';
  const refText = formatReferenceRange(entry.referenceRange);

  const fallbackInterpretation = refText !== undefined
    ? `${base} (ref: ${refText}${unit})`
    : base;

  // For abnormal findings, attempt to get a rich clinical interpretation from local MedGemma
  if (classification !== 'normal' && process.env.NODE_ENV !== 'test' && Date.now() > ollamaDisabledUntil) {
    try {
      const prompt = `You are a clinical AI assistant. A patient's lab test result is abnormal.
Test Name: ${entry.testName}
Value: ${entry.value}${unit}
Reference Range: ${refText ?? 'Unknown'}
Classification: ${classification}

Provide a ONE SENTENCE factual clinical interpretation of this result. Do NOT provide a diagnosis. Do NOT provide treatment recommendations. Keep it extremely brief and factual.`;

      const response = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'medgemma:4b',
          prompt,
          stream: false,
          options: {
            temperature: 0.1,
          },
        }),
        signal: AbortSignal.timeout(120000), // 120-second timeout for local inference batch processing
      });

      if (response.ok) {
        const data = await response.json() as { response: string };
        const text = data.response.trim();
        if (text.length > 0) {
          // Append the reference range for context
          return refText !== undefined ? `${text} (ref: ${refText}${unit})` : text;
        }
      } else {
        logger.warn('interpreter:ollama-error', { status: response.status });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn('interpreter:ollama-failed', { error: msg });
      // Circuit breaker: disable Ollama for 60 seconds if it times out or refuses connection
      ollamaDisabledUntil = Date.now() + 60000;
    }
  }

  return fallbackInterpretation;
}
