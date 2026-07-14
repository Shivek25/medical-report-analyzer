/**
 * src/lib/extraction/llm-client.ts
 *
 * Phase 6 — Provider-agnostic LLM client contract + deterministic stub.
 *
 * The `LlmClient` interface is the ONLY seam between the extraction stage and
 * any concrete model provider. Production adapters (OpenAI, Anthropic, …) will
 * implement this interface; until then, `createStubClient` returns a fully
 * deterministic, network-free classifier that the rest of the system — and the
 * test suite — can run against.
 *
 * Why an interface instead of a concrete class?
 *   - The extraction stage must be unit-testable without a network or an API
 *     key. Tests construct the stub (or an inline fake) and assert behaviour.
 *   - Swapping providers later means implementing one function
 *     (`classifyBlocks`), not rewiring the extraction pipeline.
 *
 * The stub is deliberately conservative: it reuses the deterministic parser's
 * own predicates (value / unit / range / noise / descriptor) so its labels are
 * explainable and never fabricate. It is NOT meant to beat a real LLM at
 * generalisation — it is a safe default that keeps the feature testable while no
 * provider key is configured.
 */

import type {
  CandidateBlock,
  LabeledItem,
  LlmClassificationRequest,
  LlmClassificationResponse,
  NormalizedLabResult,
  MetadataField,
} from './types.js';

// ─── Client contract ─────────────────────────────────────────────────────────

/**
 * Bounded classifier + normalizer contract for Phase 6.
 *
 * Implementations MUST:
 *   - return exactly one {@link LabeledItem} per input block (aligned by
 *     `blockIndex`), or return `{ ok: false }`;
 *   - set `evidence` to a verbatim substring of the block's `text`;
 *   - never invent field values that do not appear in the evidence (the
 *     validation gate re-checks this, but clients should honour it upstream);
 *   - be total: no uncaught exception escapes `classifyBlocks`. Any error is
 *     converted to `{ ok: false, error }` so the caller can fall back.
 *
 * Implementations SHOULD:
 *   - clamp `confidence` to [0, 1];
 *   - keep `reason` structural and PII-free;
 *   - emit `normalized` only for `lab_result` labels.
 */
export interface LlmClient {
  /** Stable identifier for logging / telemetry (e.g. "stub", "openai"). */
  readonly provider: string;
  /**
   * Classify + normalize a batch of candidate blocks. Pure w.r.t. the request:
   * the same request yields the same response for deterministic clients.
   */
  classifyBlocks(request: LlmClassificationRequest): Promise<LlmClassificationResponse>;
}

// ─── Stub client (deterministic, no network) ──────────────────────────────────

/**
 * Configuration for {@link createStubClient}. All fields optional; the defaults
 * produce a conservative classifier that admits only clearly-evidenced lab
 * rows.
 */
export interface StubClientOptions {
  /**
   * When `false`, every call returns `{ ok: false, error: 'stub-disabled' }`,
   * forcing the extraction stage onto the deterministic fallback. This is the
   * production default (no provider wired yet) and is what the route uses until
   * a real adapter is plugged in. Default `false`.
   */
  enabled?: boolean;
}

/**
 * Build a deterministic stub {@link LlmClient}.
 *
 * The stub never touches the network. For each block it re-derives a label
 * using the same predicates the deterministic parser already trusts, so its
 * decisions are explainable and the validation gate almost always confirms them.
 * This makes the full LLM path exercisable end-to-end in tests and in dev
 * without an API key.
 *
 * When `enabled === false` (the default), the stub reports itself as disabled so
 * callers transparently fall back to the deterministic parser.
 */
export function createStubClient(options: StubClientOptions = {}): LlmClient {
  const enabled = options.enabled === true;
  return {
    provider: 'stub',
    // Intentionally `async` without `await`: the LlmClient contract returns a
    // Promise so real (network-backed) adapters are interchangeable with this
    // synchronous stub. The rule is disabled here only because the stub has no
    // I/O to await.
    // eslint-disable-next-line @typescript-eslint/require-await
    async classifyBlocks(request: LlmClassificationRequest): Promise<LlmClassificationResponse> {
      if (!enabled) {
        return { ok: false, items: [], error: 'stub-disabled' };
      }
      const items: LabeledItem[] = request.blocks.map((block, index) =>
        classifyBlock(block, index),
      );
      return { ok: true, items };
    },
  };
}

// ─── Stub predicates ──────────────────────────────────────────────────────────
//
// The stub imports the deterministic parser's predicate vocabulary so it does
// not re-encode lab-report heuristics. This keeps the two paths consistent and
// guarantees the validation gate (which uses the same vocabulary) confirms the
// stub's labels.

import {
  NUMERIC_VALUE,
  NUMERIC_VALUE_ANCHORED,
  QUALITATIVE_VALUE_ANCHORED,
  REFERENCE_RANGE_ANY,
  UNIT_TOKEN_ANCHORED,
  WHITESPACE_ONLY_LINE,
} from '../parser/patterns.js';
import {
  isNoiseRow,
  isGenericDescriptorToken,
  isGenericDescriptorOrLabelLine,
  extractMeaningfulTestName,
} from '../parser/noise-filter.js';

/** True iff `text` contains a numeric or qualitative value token. */
function hasValue(text: string): boolean {
  return NUMERIC_VALUE.test(text) || QUALITATIVE_VALUE_ANCHORED.test(text);
}

/** True iff `text` contains a reference-range shape. */
function hasRange(text: string): boolean {
  return REFERENCE_RANGE_ANY.test(text);
}

/**
 * Best-effort extraction of a normalized lab result from a single block, used
 * only when the block looks like a lab row. Mirrors a simplified version of the
 * Field_Extractor grammar:
 *
 *     <test name> <value> [<unit>] [<flag>] [<reference range>]
 *
 * The point is to surface plausible normalized fields so the LLM path can be
 * exercised; the authoritative normalization still runs through the
 * deterministic `normalize()` in the validation gate.
 */
function tryNormalizeLab(block: CandidateBlock): NormalizedLabResult | undefined {
  const text = block.text.trim();
  if (!hasValue(text)) return undefined;

  const tokens = text.split(/\s+/);
  const valueIdx = tokens.findIndex(
    (t) => NUMERIC_VALUE_ANCHORED.test(t) || QUALITATIVE_VALUE_ANCHORED.test(t),
  );
  if (valueIdx === -1) return undefined;

  const testName = extractMeaningfulTestName(tokens.slice(0, valueIdx).join(' '));
  if (testName.length === 0) return undefined;
  if (isGenericDescriptorToken(testName)) return undefined;
  // An analyte name must contain at least one alphabetic run of 3+ chars.
  if (!/[A-Za-z]{3,}/.test(testName)) return undefined;

  const result: NormalizedLabResult = {
    testName,
    value: tokens[valueIdx],
  };

  const remaining = tokens.slice(valueIdx + 1);
  let i = 0;
  // unit: greedy 1..4 token match (composite units like "X 10^6 / µL")
  const maxSpan = Math.min(4, remaining.length - i);
  for (let span = maxSpan; span >= 1; span -= 1) {
    const candidate = remaining.slice(i, i + span).join(' ');
    if (UNIT_TOKEN_ANCHORED.test(candidate)) {
      result.unit = candidate;
      i += span;
      break;
    }
  }
  // flag
  if (i < remaining.length && /^(?:H|L|HIGH|LOW|CRITICAL|ABNORMAL|\*)$/.test(remaining[i])) {
    result.flag = remaining[i];
    i += 1;
  }
  // reference range: take the first range-shaped slice
  for (let j = i; j < remaining.length; j += 1) {
    const one = remaining.slice(j, j + 1).join(' ');
    const two = remaining.slice(j, j + 2).join(' ');
    const three = remaining.slice(j, j + 3).join(' ');
    if (hasRange(three)) {
      result.referenceRange = { text: three };
      break;
    }
    if (hasRange(two)) {
      result.referenceRange = { text: two };
      break;
    }
    if (hasRange(one)) {
      result.referenceRange = { text: one };
      break;
    }
  }
  return result;
}

/**
 * Recognise a labelled metadata line that should be extracted BEFORE the
 * generic noise predicate runs. Currently the only such marker is the patient
 * `Name :` line, which the noise filter also matches (`name\s*:`); treating it
 * as metadata here preserves the patient name instead of discarding it.
 */
function tryLabelledMetadata(text: string): { field: MetadataField; value: string } | undefined {
  const trimmed = text.trim();
  const nameMatch = /^\s*(?:Patient\s+)?Name\s*:\s*(.+?)\s*$/i.exec(trimmed);
  if (nameMatch && nameMatch[1]) {
    return { field: 'patientName', value: nameMatch[1].trim() };
  }
  return undefined;
}

/**
 * Recognise a lab-name metadata line from a short header (best-effort, runs
 * AFTER the noise predicate so prose containing a lab keyword is not mistaken
 * for the lab name).
 */
function tryLabNameMetadata(text: string): { field: MetadataField; value: string } | undefined {
  const trimmed = text.trim();
  const labMatch = /\b(?:Diagnostics?|Laboratories|Laboratory|Pathology|Pathlab|Healthcare|Lab|Thyrocare)\b/i.exec(trimmed);
  // Only treat a short header line as the lab name; avoid prose sentences.
  if (labMatch && trimmed.split(/\s+/).length <= 6) {
    return { field: 'labName', value: trimmed };
  }
  return undefined;
}

/**
 * Classify a single candidate block deterministically. Returns a {@link
 * LabeledItem} aligned to the block's `blockIndex`.
 *
 * Labelling priority (first match wins):
 *   1. labelled metadata (Name :) → metadata
 *   2. blank/noise row             → noise
 *   3. whole-line descriptor/header/label → noise
 *   4. lab-name header             → metadata
 *   5. lab-shaped row              → lab_result (with normalized payload)
 *   6. everything else             → uncertain
 */
function classifyBlock(block: CandidateBlock, blockIndex: number): LabeledItem {
  const text = block.text.trim();

  // Labelled metadata wins over the generic noise predicate so a patient
  // `Name :` line is captured rather than dropped.
  const labelledMeta = tryLabelledMetadata(text);
  if (labelledMeta !== undefined) {
    return {
      blockIndex,
      label: 'metadata',
      evidence: text,
      confidence: 0.7,
      reason: `matched ${labelledMeta.field} marker`,
      metadataField: labelledMeta.field,
      metadataValue: labelledMeta.value,
    };
  }

  if (WHITESPACE_ONLY_LINE.test(text) || isNoiseRow(text)) {
    return {
      blockIndex,
      label: 'noise',
      evidence: text,
      confidence: 0.95,
      reason: 'blank / boilerplate / address / contact / descriptor / column label',
    };
  }
  if (isGenericDescriptorOrLabelLine(text)) {
    return {
      blockIndex,
      label: 'noise',
      evidence: text,
      confidence: 0.9,
      reason: 'standalone generic descriptor, column label, or section panel header token',
    };
  }

  const labMeta = tryLabNameMetadata(text);
  if (labMeta !== undefined) {
    return {
      blockIndex,
      label: 'metadata',
      evidence: text,
      confidence: 0.7,
      reason: `matched ${labMeta.field} marker`,
      metadataField: labMeta.field,
      metadataValue: labMeta.value,
    };
  }

  const normalized = tryNormalizeLab(block);
  if (normalized !== undefined) {
    return {
      blockIndex,
      label: 'lab_result',
      evidence: text,
      confidence: 0.75,
      reason: 'value + unit/range present and test name is a meaningful analyte',
      normalized,
    };
  }

  return {
    blockIndex,
    label: 'uncertain',
    evidence: text,
    confidence: 0.3,
    reason: 'no reliable marker for metadata / lab_result / noise',
  };
}
