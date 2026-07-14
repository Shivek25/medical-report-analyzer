/**
 * src/lib/extraction/extractor.ts
 *
 * Phase 6 — Extraction stage orchestrator.
 *
 * Wires the candidate generator → LLM client (batched) → validation gate into a
 * single function that produces a `StructuredReport`, the SAME output contract
 * the deterministic parser emits. Summary generation and PDF export therefore
 * remain unchanged.
 *
 * Behavioural contract:
 *
 *   - Never throws. Any error (client failure, validation panic, …) is trapped
 *     and surfaced via `lowYield: true` / `usedLlmPath: false` so the caller
 *     falls back to the deterministic parser.
 *   - Conservative admission: only `lab_result` items that PASS the validation
 *     gate AND meet the confidence threshold become entries. Everything else is
 *     either a section header (category tracking), metadata (merged with the
 *     deterministic metadata extractor), or routed to
 *     `extractionQuality.ambiguousLines`.
 *   - Category assignment prefers the deterministic section-header walk over the
 *     model's `category` suggestion, so categories stay layout-stable.
 *   - When the LLM path's yield is implausibly low relative to the number of
 *     candidate blocks, `lowYield: true` signals the caller to fall back. This
 *     guards against a misbehaving client returning mostly `uncertain`.
 */

import type {
  ExtractionOptions,
  ExtractionOutcome,
  LabeledItem,
  CandidateBlock,
  CollectedMetadata,
  MetadataField,
} from './types.js';
import type { LlmClient } from './llm-client.js';
import type {
  ExtractionQuality,
  IngestionResult,
  LabEntry,
  ReportMetadata,
  StructuredReport,
} from '../types/index.js';
import { clean as cleanText } from '../parser/text-cleaner.js';
import { extract as extractMetadata } from '../parser/metadata.js';
import { isSectionHeaderLine } from '../parser/categorizer.js';
import { validateStructuredReport } from '../validator/index.js';
import { generateCandidates } from './candidate-generator.js';
import { validateLabResult } from './validator.js';
import { logger } from '../../shared/logger.js';

/** Default minimum confidence for admitting a lab_result as a finding. */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;
/** Blocks per classification call. Keeps request size bounded. */
const MAX_BLOCKS_PER_CALL = 60;
/**
 * If the LLM path admits fewer findings than this fraction of candidates, the
 * run is treated as low-yield and the caller should fall back. 5% is generous
 * enough to admit sparse-but-real reports while catching a broken client.
 */
const LOW_YIELD_FRACTION = 0.05;
/** Absolute floor: even for tiny reports, fewer than this is low-yield. */
const LOW_YIELD_MIN_CANDIDATES = 8;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the LLM-assisted extraction stage over an `IngestionResult`.
 *
 * The deterministic Phase 2 parser remains the fallback: this function never
 * throws — on any failure it returns an outcome with `usedLlmPath: false` and a
 * `lowYield: true` hint, leaving the caller to call `parseRawText`.
 *
 * @param input   Phase 1 extraction result.
 * @param client  An `LlmClient` (stub or real adapter).
 * @param options Knobs (confidence threshold, keepRawText).
 */
export async function extractWithLlm(
  input: IngestionResult,
  client: LlmClient,
  options?: ExtractionOptions,
): Promise<ExtractionOutcome> {
  const keepRawText = options?.keepRawText === true;
  const confidenceThreshold = options?.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

  // Short-circuit on upstream extraction failure — mirror the deterministic
  // parser's contract.
  if (input.extractionStatus === 'failed') {
    return {
      report: buildEmptyReport(true, keepRawText, ['Extraction failed']),
      usedLlmPath: false,
      lowYield: true,
    };
  }

  try {
    const cleanedText = cleanText(input.extractedText);
    const blocks = generateCandidates(cleanedText);

    if (blocks.length === 0) {
      return {
        report: buildEmptyReport(
          input.extractionStatus === 'scanned_fallback',
          keepRawText,
          [],
        ),
        usedLlmPath: true,
        lowYield: false,
      };
    }

    // ── Batched classification ──────────────────────────────────────────────
    const items: LabeledItem[] = [];
    for (let i = 0; i < blocks.length; i += MAX_BLOCKS_PER_CALL) {
      const batch = blocks.slice(i, i + MAX_BLOCKS_PER_CALL);
      const resp = await client.classifyBlocks({ blocks: batch });
      if (!resp.ok) {
        // Client signalled failure → fall back. Stop immediately.
        logger.info('phase6:llm-client-failed', {
          provider: client.provider,
          error: resp.error,
        });
        return {
          report: buildEmptyReport(
            input.extractionStatus === 'scanned_fallback',
            keepRawText,
            [`LLM client reported failure: ${resp.error ?? 'unknown'}`],
          ),
          usedLlmPath: false,
          lowYield: true,
        };
      }
      // Re-align blockIndex to the global index (the client indexed within batch).
      const offset = i;
      for (const item of resp.items) {
        items.push({ ...item, blockIndex: item.blockIndex + offset });
      }
    }

    // ── Deterministic section-header walk (category tracking) ───────────────
    // Walk candidate lines in order; whenever a block is a section header,
    // update the active category. Lab results inherit the active category.
    const report = assembleReport(
      items,
      blocks,
      cleanedText,
      confidenceThreshold,
      keepRawText,
      input.extractionStatus === 'scanned_fallback',
    );

    const validation = validateStructuredReport(report);
    if (!validation.valid) {
      logger.warn('phase6:validation-failed', {
        provider: client.provider,
        errorCount: validation.errors.length,
      });
      report.extractionQuality = {
        ...report.extractionQuality,
        validationFailed: true,
      };
    }

    // ── Low-yield heuristic ─────────────────────────────────────────────────
    const yieldCount = report.entries.length;
    const lowYield =
      yieldCount === 0 ||
      yieldCount / blocks.length < LOW_YIELD_FRACTION ||
      (blocks.length >= LOW_YIELD_MIN_CANDIDATES && yieldCount < 2);

    return { report, usedLlmPath: true, lowYield };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('phase6:extraction-error', { provider: client.provider, message });
    return {
      report: buildEmptyReport(
        input.extractionStatus === 'scanned_fallback',
        keepRawText,
        [message],
      ),
      usedLlmPath: false,
      lowYield: true,
    };
  }
}

// ─── Report assembly ──────────────────────────────────────────────────────────

/**
 * Convert labelled items + candidate blocks into a `StructuredReport`.
 *
 * Category assignment: walk the blocks in source order; whenever a block is a
 * section header, the active category updates. Lab results inherit the active
 * category at their position (falling back to the model's suggestion, then
 * 'Uncategorized'). This deterministic walk is preferred over trusting the
 * model's `category` because section headers are cheap to detect structurally.
 */
function assembleReport(
  items: LabeledItem[],
  blocks: CandidateBlock[],
  cleanedText: string,
  confidenceThreshold: number,
  keepRawText: boolean,
  lowConfidence: boolean,
): StructuredReport {
  const entries: LabEntry[] = [];
  const ambiguousLines: string[] = [];
  const warnings: string[] = [];
  const collectedMeta: CollectedMetadata = {};

  let activeCategory = 'Uncategorized';
  let totalRowsDetected = 0;
  let successfullyParsed = 0;
  let uncertainRows = 0;
  let skippedRows = 0;

  // Pre-compute, for each block, whether the underlying source line is a
  // section header so the category walk stays deterministic and independent of
  // the model's section_header label. We use the parser's own predicate.
  const cleanedLines = cleanedText.split('\n');
  const blockIsHeader = blocks.map((b) => {
    const line = cleanedLines[b.lineStart] ?? '';
    return isSectionHeaderLine(line);
  });

  for (let idx = 0; idx < items.length; idx += 1) {
    const item = items[idx];
    const block = blocks[idx];
    if (block === undefined) continue;

    // Category walk: update before processing so this block's lab results (if
    // any) inherit the header that opened their section.
    if (blockIsHeader[idx]) {
      activeCategory = block.text.trim();
    }

    totalRowsDetected += 1;

    switch (item.label) {
      case 'noise': {
        skippedRows += 1;
        break;
      }
      case 'metadata': {
        skippedRows += 1;
        mergeMetadata(collectedMeta, item.metadataField, item.metadataValue);
        break;
      }
      case 'section_header': {
        // Header-only block: nothing to emit; activeCategory already updated.
        skippedRows += 1;
        break;
      }
      case 'uncertain': {
        uncertainRows += 1;
        ambiguousLines.push(block.text);
        break;
      }
      case 'lab_result': {
        // Confidence demotion: below threshold → uncertain, not a finding.
        if (item.confidence < confidenceThreshold) {
          uncertainRows += 1;
          ambiguousLines.push(block.text);
          warnings.push(
            `Low-confidence lab_result demoted (conf=${item.confidence.toFixed(2)}; line ${block.lineStart + 1})`,
          );
          break;
        }
        const result = validateLabResult(item, block);
        if (result.accepted && result.entry !== undefined) {
          // Apply the deterministic category walk (preferred over model guess).
          result.entry.category =
            activeCategory !== 'Uncategorized'
              ? activeCategory
              : result.entry.category;
          entries.push(result.entry);
          successfullyParsed += 1;
        } else {
          uncertainRows += 1;
          ambiguousLines.push(block.text);
          warnings.push(
            `Rejected lab_result: ${result.rejectionReason ?? 'unknown'} (line ${block.lineStart + 1})`,
          );
        }
        break;
      }
    }
  }

  // Merge model metadata with the deterministic metadata extractor; the
  // deterministic extractor is more conservative and wins on conflict.
  const deterministicMeta = extractMetadata(cleanedText);
  const metadata: ReportMetadata = { ...collectedMeta, ...deterministicMeta };

  const confidence =
    totalRowsDetected === 0 ? 0 : successfullyParsed / totalRowsDetected;

  const extractionQuality: ExtractionQuality = {
    totalRowsDetected,
    successfullyParsed,
    uncertainRows,
    skippedRows,
    ambiguousLines,
    warnings,
    confidence,
    lowConfidence,
  };

  const report: StructuredReport = {
    metadata,
    entries,
    extractionQuality,
  };
  if (keepRawText) {
    report.rawText = cleanedText;
  }
  return report;
}

// ─── Metadata merge ───────────────────────────────────────────────────────────

/**
 * Merge a model-supplied metadata field into the collected set. Only string /
 * number values that are non-empty are kept; gender is canonicalized to the
 * single-letter form. Never overwrites an existing value (deterministic path
 * wins via spread order in `assembleReport`).
 */
function mergeMetadata(
  meta: CollectedMetadata,
  field: MetadataField | undefined,
  value: string | undefined,
): void {
  if (field === undefined || value === undefined) return;
  const trimmed = value.trim();
  if (trimmed.length === 0) return;

  switch (field) {
    case 'patientName':
    case 'labName':
    case 'reportDate':
    case 'sampleDate':
    case 'reportId':
      meta[field] = trimmed;
      break;
    case 'patientAge': {
      const n = Number.parseInt(trimmed, 10);
      if (Number.isFinite(n) && n > 0) meta.patientAge = n;
      break;
    }
    case 'patientGender': {
      const g = trimmed.charAt(0).toUpperCase();
      if (g === 'M' || g === 'F' || g === 'O') meta.patientGender = g;
      break;
    }
  }
}

// ─── Empty report helper ──────────────────────────────────────────────────────

function buildEmptyReport(
  lowConfidence: boolean,
  keepRawText: boolean,
  warnings: string[],
): StructuredReport {
  const report: StructuredReport = {
    metadata: {},
    entries: [],
    extractionQuality: {
      totalRowsDetected: 0,
      successfullyParsed: 0,
      uncertainRows: 0,
      skippedRows: 0,
      ambiguousLines: [],
      warnings: [...warnings],
      confidence: 0,
      lowConfidence,
    },
  };
  if (keepRawText) {
    report.rawText = '';
  }
  return report;
}
