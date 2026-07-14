/**
 * src/lib/extraction/types.ts
 *
 * Phase 6 — LLM-assisted structured extraction.
 *
 * Provider-agnostic type definitions for the bounded classification +
 * normalization layer that sits between PDF text extraction (Phase 1) and the
 * deterministic parser (Phase 2).
 *
 * Design philosophy (see prompts/phase-06-llm-extraction.md):
 *   - The model is used ONLY as a bounded classifier and normalizer. It never
 *     writes free-form report content.
 *   - Every model output MUST carry verbatim `evidence` text traced back to
 *     the source block. The deterministic validation gate
 *     (src/lib/extraction/validator.ts) rejects any item whose normalized
 *     fields cannot be found inside its evidence — this is the anti-fabrication
 *     guard (Requirement: "do not fabricate missing values").
 *   - The five labels are exhaustive: a candidate block is exactly one of
 *     metadata / section_header / lab_result / noise / uncertain.
 *
 * This module is pure types — no I/O, no runtime logic, no shared mutable
 * state. It depends only on the shared `LabReferenceRange` contract so the
 * final output remains schema-compatible with the deterministic parser.
 */

import type { LabReferenceRange, ReportMetadata, StructuredReport } from '../types/index.js';

// ─── Block labels (exhaustive) ────────────────────────────────────────────────

/**
 * The five mutually-exclusive labels a candidate block can receive.
 *
 * - `metadata`       : patient / lab / report-date boilerplate. Never a finding.
 * - `section_header` : a panel / category heading (e.g. "LIPID PROFILE"). Used
 *                      only to assign `category` to subsequent lab results.
 * - `lab_result`     : a genuine, evidence-backed lab result row. The ONLY label
 *                      that may produce a `LabEntry`.
 * - `noise`          : address, contact, disclaimer, status line, generic
 *                      descriptor, column label, risk-classification table, etc.
 * - `uncertain`      : the model could not confidently place the block in any of
 *                      the above. Surfaced via `extractionQuality.ambiguousLines`
 *                      and never emitted as a finding.
 */
export type BlockLabel =
  | 'metadata'
  | 'section_header'
  | 'lab_result'
  | 'noise'
  | 'uncertain';

// ─── Candidate blocks ─────────────────────────────────────────────────────────

/**
 * A unit of source text presented to the classifier. A candidate is typically a
 * single cleaned line, but may span a short window of consecutive lines when
 * the candidate generator suspects a multi-line lab row.
 *
 * `lineStart` / `lineEnd` are 0-based indices into the cleaned-text line array
 * (inclusive on both ends). They are the primary traceability key: the
 * validation gate uses them to confirm that a model's `evidence` string actually
 * occurs in the source. `page` is best-effort — pdf-parse does not expose page
 * boundaries for many reports, so it is `undefined` rather than fabricated.
 */
export interface CandidateBlock {
  /** Verbatim source text of the block (trimmed of surrounding whitespace). */
  text: string;
  /** 0-based index of the first source line contributing to this block. */
  lineStart: number;
  /** 0-based index of the last source line contributing to this block (inclusive). */
  lineEnd: number;
  /** Best-effort 1-based page number; `undefined` when the extractor exposes none. */
  page: number | undefined;
}

// ─── Normalized lab result (model output shape) ───────────────────────────────

/**
 * The normalized form a model emits for a `lab_result` block. Mirrors the
 * relevant subset of `LabEntry` but is UNTRUSTED until the validation gate has
 * confirmed every field is traceable to the block's `evidence` text.
 *
 * `value` is a string so qualitative results ("Negative", "Reactive") survive
 * the round trip, exactly as in the deterministic parser's `LabEntry`.
 */
export interface NormalizedLabResult {
  testName: string;
  value: string;
  unit?: string;
  referenceRange?: LabReferenceRange;
  flag?: string;
  /**
   * Optional category suggested by the model. The extraction stage prefers a
   * category derived from the most recent `section_header` block (deterministic
   * walk) and only falls back to this suggestion when no header was seen.
   */
  category?: string;
}

// ─── Labeled item (one model decision per candidate block) ────────────────────

/**
 * The metadata-field families the model may attribute to a `metadata`-labelled
 * block. Kept as a closed set so the extraction stage can route values into the
 * existing `ReportMetadata` shape without free-form keys.
 */
export type MetadataField =
  | 'patientName'
  | 'patientAge'
  | 'patientGender'
  | 'reportDate'
  | 'sampleDate'
  | 'labName'
  | 'reportId';

/**
 * A single classification decision for one `CandidateBlock`.
 *
 * `evidence` MUST be a verbatim substring of the candidate block's `text`. The
 * validation gate enforces this; a decision whose evidence is absent from the
 * block is rejected as untrustworthy.
 *
 * `normalized` is present only when `label === 'lab_result'`. `category` is
 * present only for `section_header`. `metadataField` + `metadataValue` are
 * present only for `metadata`.
 */
export interface LabeledItem {
  /** Reference back to the source block (index into the request's `blocks`). */
  blockIndex: number;
  label: BlockLabel;
  /** Verbatim substring of the block justifying the label (anti-fabrication). */
  evidence: string;
  /** Model confidence in the label, clamped to [0, 1]. */
  confidence: number;
  /** Short human-readable justification (structural only; no PII assumed). */
  reason: string;

  // ── Label-specific payloads (present only for the matching label) ──────────
  /** Present iff `label === 'lab_result'`. */
  normalized?: NormalizedLabResult;
  /** Present iff `label === 'section_header'` — the verbatim category heading. */
  category?: string;
  /** Present iff `label === 'metadata'` — which field this block supplies. */
  metadataField?: MetadataField;
  /** Present iff `label === 'metadata'` — the raw value string for the field. */
  metadataValue?: string;
}

// ─── LLM client transport contract ────────────────────────────────────────────

/**
 * Request handed to an `LlmClient.classifyBlocks` implementation.
 *
 * `blocks` is already windowed / batched by the caller so a provider never
 * receives more than the configured `LLM_MAX_BLOCKS_PER_CALL` candidates at
 * once. `reportContext` gives minimal, de-identified structural hints (e.g.
 * detected lab name) that improve classification without leaking patient data.
 */
export interface LlmClassificationRequest {
  blocks: CandidateBlock[];
  /** De-identified structural hints (never patient name / ID / contact). */
  reportContext?: {
    labName?: string;
    detectedLanguage?: string;
  };
}

/**
 * Response returned by an `LlmClient`. `items` MUST be one-to-one with the
 * request's `blocks` (same length, aligned by `blockIndex`). When a client
 * cannot fulfil the contract it returns `ok: false` so the caller falls back to
 * the deterministic parser rather than trusting a partial result.
 */
export interface LlmClassificationResponse {
  ok: boolean;
  items: LabeledItem[];
  /** Structural note when `ok === false` (e.g. "stub-disabled", "rate-limited"). */
  error?: string;
}

// ─── Extraction-stage options & result ────────────────────────────────────────

/**
 * Knobs for the extraction stage. All have safe defaults so callers can invoke
 * `extractWithLlm(input, client)` with no options.
 */
export interface ExtractionOptions {
  /**
   * Minimum confidence for a `lab_result` item to be admitted as a finding.
   * Items below the threshold are demoted to `uncertain` and surfaced on
   * `extractionQuality.ambiguousLines`. Default `0.5`.
   */
  confidenceThreshold?: number;
  /** When true, the cleaned text is attached as `rawText`. Default `false`. */
  keepRawText?: boolean;
}

/**
 * Outcome of the extraction stage, used by the route to decide whether the LLM
 * path produced a trustworthy result or whether the deterministic fallback
 * should be used instead.
 */
export interface ExtractionOutcome {
  report: StructuredReport;
  /** True when the LLM path ran to completion and passed the validation gate. */
  usedLlmPath: boolean;
  /**
   * True when the LLM path ran but its yield was too low to trust, signalling
   * the caller to fall back to the deterministic parser.
   */
  lowYield: boolean;
}

/**
 * Metadata accumulated from `metadata`-labelled blocks. Each field is optional;
 * the extraction stage merges this with the deterministic metadata extractor's
 * output (deterministic wins on conflict — it is the more conservative source).
 */
export type CollectedMetadata = Partial<ReportMetadata>;
