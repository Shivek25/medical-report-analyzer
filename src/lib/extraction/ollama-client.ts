/**
 * src/lib/extraction/ollama-client.ts
 *
 * Phase 7 — Ollama-backed LlmClient adapter.
 *
 * Implements the provider-agnostic `LlmClient` interface using Ollama's local
 * REST API (`POST /api/generate`) with qwen3:8b as the default model. No paid
 * API, no external network — local Ollama only.
 *
 * Safety design (conservative, replaceable):
 *
 *   1. Health check  — `GET /api/tags` is called before the first generate
 *      request and the result is cached. If Ollama is unreachable, the client
 *      immediately returns `{ ok: false }` so the caller falls back to the
 *      deterministic parser without waiting for a full generate timeout.
 *
 *   2. Strict response contract — the Ollama envelope and the inner JSON are
 *      validated in a strict, ordered chain. Any shape drift returns
 *      `{ ok: false }` rather than guessing. Content-level validation (evidence
 *      traceability, analyte plausibility) is left to the validation gate.
 *
 *   3. Upstream evidence guard — before items are returned to the extractor,
 *      any item whose `evidence` is not a substring of the source block is
 *      demoted to `uncertain`. This is a cheap early signal; the authoritative
 *      check remains in `validator.ts` and must NOT be removed.
 *
 *   4. Never throws — every code path is wrapped; network errors, JSON parse
 *      errors, and unexpected shapes all return `{ ok: false, error }`.
 *
 * The model is configurable via `OllamaClientOptions`; the default is
 * `qwen3:8b`. MedGemma is explicitly reserved for a later interpretation phase
 * and must not be used here.
 */

import type {
  LlmClassificationRequest,
  LlmClassificationResponse,
  LabeledItem,
  CandidateBlock,
} from './types.js';
import type { LlmClient } from './llm-client.js';
import { logger } from '../../shared/logger.js';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface OllamaClientOptions {
  /** Base URL of the local Ollama server. Default: http://localhost:11434 */
  baseUrl?: string;
  /** Model tag to request. Default: qwen3:8b */
  model?: string;
  /** Timeout in ms for generate calls. Default: 60 000. */
  requestTimeoutMs?: number;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Build an `LlmClient` backed by a local Ollama instance.
 *
 * The returned client:
 *   - Performs a one-shot health check on the first `classifyBlocks` call and
 *     caches the result for the lifetime of the client object.
 *   - Returns `{ ok: false }` on any network error, bad status, or malformed
 *     response — never throws.
 *   - Demotes items with evidence not found in the source block to `uncertain`
 *     before returning (upstream guard; the validation gate re-checks).
 */
export function createOllamaClient(options: OllamaClientOptions = {}): LlmClient {
  const baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
  const model = options.model ?? 'qwen3:8b';
  const requestTimeoutMs = options.requestTimeoutMs ?? 60_000;

  // Health-check cache: undefined = not yet checked, true = reachable, false = unreachable.
  let healthCache: boolean | undefined = undefined;

  return {
    provider: `ollama/${model}`,

    async classifyBlocks(request: LlmClassificationRequest): Promise<LlmClassificationResponse> {
      // ── 1. Health check (cached after first call) ─────────────────────────
      if (healthCache === undefined) {
        healthCache = await checkHealth(baseUrl);
        logger.info('phase7:ollama-health', { baseUrl, reachable: healthCache });
      }
      if (!healthCache) {
        return { ok: false, items: [], error: 'ollama-unavailable' };
      }

      // ── 2. Generate call ──────────────────────────────────────────────────
      const raw = await callGenerate(baseUrl, model, requestTimeoutMs, request);
      if (!raw.ok) {
        logger.warn('phase7:ollama-generate-error', { model, error: raw.error });
        return { ok: false, items: [], error: raw.error };
      }

      // ── 3. Parse + contract validation ───────────────────────────────────
      const parsed = parseResponse(raw.text, request.blocks.length);
      if (!parsed.ok) {
        logger.warn('phase7:ollama-parse-error', { model, error: parsed.error });
        return { ok: false, items: [], error: parsed.error };
      }

      // ── 4. Upstream evidence guard ────────────────────────────────────────
      const guarded = applyEvidenceGuard(parsed.items, request.blocks);

      const demotedCount = guarded.filter(
        (item, i) => item.label === 'uncertain' && parsed.items[i]?.label !== 'uncertain',
      ).length;
      logger.info('phase7:ollama-classified', {
        model,
        blocks: request.blocks.length,
        demotedByGuard: demotedCount,
      });

      return { ok: true, items: guarded };
    },
  };
}

// ─── Health check ─────────────────────────────────────────────────────────────

/** Ping Ollama's tags endpoint with a short fixed timeout. Returns true iff reachable. */
async function checkHealth(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Generate call ────────────────────────────────────────────────────────────

type GenerateResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * Call Ollama's `/api/generate` endpoint.
 *
 * Returns the raw `response` string from the Ollama envelope, or
 * `{ ok: false, error }` for any HTTP or network failure.
 */
async function callGenerate(
  baseUrl: string,
  model: string,
  timeoutMs: number,
  request: LlmClassificationRequest,
): Promise<GenerateResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const prompt = buildPrompt(request);
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { ok: false, error: `ollama-http-${res.status}` };
    }

    // Ollama wraps the model output in an envelope: { response: string, ... }
    let envelope: unknown;
    try {
      envelope = await res.json() as unknown;
    } catch {
      return { ok: false, error: 'ollama-malformed-envelope' };
    }

    if (
      envelope === null ||
      typeof envelope !== 'object' ||
      typeof (envelope as Record<string, unknown>)['response'] !== 'string'
    ) {
      return { ok: false, error: 'ollama-malformed-envelope' };
    }

    return { ok: true, text: (envelope as Record<string, string>)['response'] };
  } catch (err) {
    // AbortError from timeout or any network failure — treat uniformly.
    void err;
    return { ok: false, error: 'ollama-unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Response parsing + contract validation ───────────────────────────────────

type ParseResult =
  | { ok: true; items: LabeledItem[] }
  | { ok: false; error: string };

/**
 * Parse and validate the raw model output string.
 *
 * Validation order (strict, deterministic):
 *   1. Strip accidental markdown fences.
 *   2. JSON.parse — invalid JSON → `ollama-invalid-json`.
 *   3. Top-level shape: must be `{ items: [...] }` → `ollama-shape-error`.
 *   4. Item count must match `expectedCount` → `ollama-item-count-mismatch`.
 *   5. Per-item coercion: missing/unrecognised fields get safe defaults.
 *      Content checks (analyte plausibility, evidence traceability) are the
 *      validation gate's responsibility, not this function's.
 */
function parseResponse(raw: string, expectedCount: number): ParseResult {
  // Strip markdown code fences the model may emit despite instructions.
  const stripped = raw.trim().replace(/^```(?:json)?\n?|\n?```$/gm, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return { ok: false, error: 'ollama-invalid-json' };
  }

  // Top-level shape: must be an object with an `items` array.
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as Record<string, unknown>)['items'])
  ) {
    return { ok: false, error: 'ollama-shape-error' };
  }

  const rawItems = (parsed as { items: unknown[] }).items;

  if (rawItems.length !== expectedCount) {
    return { ok: false, error: 'ollama-item-count-mismatch' };
  }

  const items: LabeledItem[] = rawItems.map((r, idx) => coerceItem(r, idx));
  return { ok: true, items };
}

/**
 * Coerce a single raw model item into a `LabeledItem`.
 *
 * Unknown/missing label → `uncertain`. Confidence clamped to [0, 1].
 * `normalized` is only kept when label is `lab_result`. All content-level
 * checks are the validation gate's responsibility.
 */
function coerceItem(raw: unknown, blockIndex: number): LabeledItem {
  const SAFE_UNCERTAIN: LabeledItem = {
    blockIndex,
    label: 'uncertain',
    evidence: '',
    confidence: 0,
    reason: 'coerced-from-malformed-item',
  };

  if (raw === null || typeof raw !== 'object') return SAFE_UNCERTAIN;

  const r = raw as Record<string, unknown>;

  const VALID_LABELS = new Set<string>(['metadata', 'section_header', 'lab_result', 'noise', 'uncertain']);
  const label = VALID_LABELS.has(String(r['label'] ?? ''))
    ? (r['label'] as LabeledItem['label'])
    : 'uncertain';

  const evidence = typeof r['evidence'] === 'string' ? r['evidence'] : '';
  const confidence =
    typeof r['confidence'] === 'number' ? Math.max(0, Math.min(1, r['confidence'])) : 0;
  const reason = typeof r['reason'] === 'string' ? r['reason'] : 'no-reason';

  const item: LabeledItem = { blockIndex, label, evidence, confidence, reason };

  if (label === 'lab_result' && r['normalized'] !== null && typeof r['normalized'] === 'object') {
    const n = r['normalized'] as Record<string, unknown>;
    const normalized: LabeledItem['normalized'] = {
      testName: typeof n['testName'] === 'string' ? n['testName'] : '',
      value: typeof n['value'] === 'string' ? n['value'] : '',
    };
    if (typeof n['unit'] === 'string') normalized!.unit = n['unit'];
    if (typeof n['flag'] === 'string') normalized!.flag = n['flag'];
    if (typeof n['category'] === 'string') normalized!.category = n['category'];
    if (
      n['referenceRange'] !== null &&
      typeof n['referenceRange'] === 'object' &&
      typeof (n['referenceRange'] as Record<string, unknown>)['text'] === 'string'
    ) {
      normalized!.referenceRange = { text: (n['referenceRange'] as Record<string, string>)['text'] };
    }
    item.normalized = normalized;
  }

  if (label === 'section_header' && typeof r['category'] === 'string') {
    item.category = r['category'];
  }

  if (label === 'metadata') {
    const VALID_META_FIELDS = new Set<string>([
      'patientName', 'patientAge', 'patientGender', 'reportDate',
      'sampleDate', 'labName', 'reportId',
    ]);
    if (typeof r['metadataField'] === 'string' && VALID_META_FIELDS.has(r['metadataField'])) {
      // The Set membership check already narrows this to a valid MetadataField.
      item.metadataField = r['metadataField'] as NonNullable<LabeledItem['metadataField']>;
    }
    if (typeof r['metadataValue'] === 'string') {
      item.metadataValue = r['metadataValue'];
    }
  }

  return item;
}

// ─── Upstream evidence guard ──────────────────────────────────────────────────

/**
 * Demote any item whose `evidence` is not a substring of the corresponding
 * source block's `text`.
 *
 * Purpose: cheap early signal against obviously-fabricated evidence before
 * items reach the extractor loop. The authoritative enforcement is in
 * `validator.ts` (`validateLabResult`) and MUST remain there regardless of
 * this guard — so the safety rule holds if this client is replaced.
 */
function applyEvidenceGuard(items: LabeledItem[], blocks: CandidateBlock[]): LabeledItem[] {
  return items.map((item, i) => {
    const block = blocks[i];
    if (block === undefined) return item;
    // Empty evidence is harmless here — the gate rejects it downstream.
    if (item.evidence.length === 0) return item;
    if (!block.text.includes(item.evidence)) {
      logger.debug('phase7:evidence-guard-demote', {
        blockIndex: i,
        label: item.label,
        evidencePrefix: item.evidence.slice(0, 60),
      });
      return {
        blockIndex: item.blockIndex,
        label: 'uncertain' as const,
        evidence: item.evidence,
        confidence: 0,
        reason: 'upstream-guard: evidence not found in source block',
      };
    }
    return item;
  });
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

/**
 * Build the Ollama generate prompt from the Phase 6 spec.
 *
 * The system section embeds the classification rules verbatim so the model
 * sees the same contract as `prompts/phase-06-llm-extraction.md`. The user
 * section is the JSON payload it must classify.
 */
function buildPrompt(request: LlmClassificationRequest): string {
  const systemSection = `You are a medical lab report classifier. Your ONLY job is to classify candidate text blocks from a PDF medical report into structured JSON.

OUTPUT: Return a JSON object with a single "items" array — one entry per input block, aligned by blockIndex. Output JSON only. No markdown fences. No commentary.

LABELS (mutually exclusive, exhaustive):
  "metadata"       — patient / lab / date boilerplate. No finding.
  "section_header" — panel / category heading (e.g. "LIPID PROFILE"). No finding.
  "lab_result"     — a genuine, evidence-backed lab result row. May produce a finding.
  "noise"          — address, contact, disclaimer, descriptor, column label. No finding.
  "uncertain"      — cannot confidently classify. No finding.

RULES:
1. Emit exactly one item per input block, in input order, with matching blockIndex.
2. "evidence" MUST be a verbatim substring of the block's "text". Never paraphrase.
3. Set "normalized" only for "lab_result". Set "category" only for "section_header".
4. "confidence" in [0, 1]. When unsure, lower it and prefer "uncertain".
5. Never fabricate missing values. If a block has a test name but no value, label it "uncertain".
6. Label as "noise": bare descriptors ("Calculated"), column labels ("UNITS", "VALUE"),
   addresses, contacts, risk-classification table rows ("Physician Review 80-89").
7. A genuine lab result must have EITHER a unit OR a reference range (qualitative values exempt).
8. Output JSON only — no markdown fences, no commentary.

REQUIRED OUTPUT FORMAT (one item per block):
{
  "items": [
    {
      "blockIndex": 0,
      "label": "lab_result",
      "evidence": "<verbatim substring of block text>",
      "confidence": 0.9,
      "reason": "<short structural reason>",
      "normalized": {
        "testName": "HEMOGLOBIN",
        "value": "13.2",
        "unit": "g/dL",
        "referenceRange": { "text": "13.0-17.0" }
      }
    }
  ]
}`;

  const userPayload = JSON.stringify(
    {
      blocks: request.blocks.map((b, i) => ({
        blockIndex: i,
        text: b.text,
        page: b.page,
      })),
      reportContext: request.reportContext ?? {},
    },
    null,
    2,
  );

  return `${systemSection}\n\nCLASSIFY THE FOLLOWING BLOCKS:\n${userPayload}`;
}
