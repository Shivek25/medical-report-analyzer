/**
 * tests/unit/extraction/ollama-client.test.ts
 *
 * Phase 7 — Unit tests for the Ollama LlmClient adapter.
 *
 * All tests are hermetic: fetch is mocked via vi.stubGlobal so no real Ollama
 * process is required. Tests cover:
 *   - Valid response path (happy path)
 *   - Every error-code in the strict response-contract chain
 *   - Upstream evidence guard demotion
 *   - Integration with extractWithLlm (fallback on client failure)
 *   - Boilerplate blocked by the validation gate even when the model labels it lab_result
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createOllamaClient } from '../../../src/lib/extraction/ollama-client.js';
import { extractWithLlm } from '../../../src/lib/extraction/extractor.js';
import type { CandidateBlock } from '../../../src/lib/extraction/types.js';
import type { IngestionResult } from '../../../src/lib/types/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function block(text: string, lineStart = 0): CandidateBlock {
  return { text, lineStart, lineEnd: lineStart, page: undefined };
}

function ingestion(text: string): IngestionResult {
  return {
    originalFilename: 'test.pdf',
    storedFilePath: 'test.pdf',
    extractionStatus: 'success',
    extractedText: text,
  };
}

/**
 * Build a mock fetch that:
 *   - Returns HTTP 200 + JSON { "ok": true } for the health check (GET /api/tags)
 *   - Returns HTTP 200 + Ollama envelope with `responseBody` for the generate call
 */
function mockFetchWithResponse(responseBody: string): typeof fetch {
  return vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    if (u.endsWith('/api/tags')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      } as unknown as Response);
    }
    // generate endpoint
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ response: responseBody }),
    } as unknown as Response);
  }) as unknown as typeof fetch;
}

/** Mock fetch that returns HTTP status `status` for the generate endpoint. */
function mockFetchWithStatus(status: number): typeof fetch {
  return vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    if (u.endsWith('/api/tags')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    }
    return Promise.resolve({ ok: false, status } as unknown as Response);
  }) as unknown as typeof fetch;
}

/** Mock fetch that throws a network error for every call. */
function mockFetchNetworkError(): typeof fetch {
  return vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
}

/** Mock fetch where the health check fails (unreachable Ollama). */
function mockFetchHealthFail(): typeof fetch {
  return vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    if (u.endsWith('/api/tags')) {
      return Promise.reject(new Error('ECONNREFUSED'));
    }
    return Promise.resolve({ ok: true } as unknown as Response);
  }) as unknown as typeof fetch;
}

/** Mock fetch that aborts (simulates timeout). */
function mockFetchAbort(): typeof fetch {
  return vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = opts?.signal;
      if (signal) {
        signal.addEventListener('abort', () => {
          const err = new DOMException('Aborted', 'AbortError');
          reject(err);
        });
      }
      // Never resolves — caller must abort via the signal.
    });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createOllamaClient', () => {
  // ── Happy path ─────────────────────────────────────────────────────────────

  it('parses a valid Ollama response and returns ok:true with aligned items', async () => {
    const blocks = [block('HEMOGLOBIN 13.2 g/dL 13.0-17.0')];
    const modelOutput = JSON.stringify({
      items: [
        {
          blockIndex: 0,
          label: 'lab_result',
          evidence: 'HEMOGLOBIN 13.2 g/dL 13.0-17.0',
          confidence: 0.92,
          reason: 'analyte + value + unit + range',
          normalized: {
            testName: 'HEMOGLOBIN',
            value: '13.2',
            unit: 'g/dL',
            referenceRange: { text: '13.0-17.0' },
          },
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetchWithResponse(modelOutput));

    const client = createOllamaClient({ baseUrl: 'http://localhost:11434', model: 'qwen3:8b' });
    const res = await client.classifyBlocks({ blocks });

    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.label).toBe('lab_result');
    expect(res.items[0]?.normalized?.testName).toBe('HEMOGLOBIN');
    expect(res.items[0]?.normalized?.value).toBe('13.2');
    expect(res.items[0]?.blockIndex).toBe(0);
  });

  it('strips accidental markdown fences before parsing', async () => {
    const blocks = [block('GLUCOSE 5.4 mmol/L 4.1-5.9')];
    const withFences =
      '```json\n' +
      JSON.stringify({
        items: [
          {
            blockIndex: 0,
            label: 'lab_result',
            evidence: 'GLUCOSE 5.4 mmol/L 4.1-5.9',
            confidence: 0.9,
            reason: 'lab row',
            normalized: { testName: 'GLUCOSE', value: '5.4', unit: 'mmol/L' },
          },
        ],
      }) +
      '\n```';
    vi.stubGlobal('fetch', mockFetchWithResponse(withFences));

    const client = createOllamaClient();
    const res = await client.classifyBlocks({ blocks });

    expect(res.ok).toBe(true);
    expect(res.items[0]?.label).toBe('lab_result');
  });

  // ── Error chain ────────────────────────────────────────────────────────────

  it('returns ok:false with ollama-unavailable when health check fails', async () => {
    vi.stubGlobal('fetch', mockFetchHealthFail());
    const client = createOllamaClient();
    const res = await client.classifyBlocks({ blocks: [block('GLUCOSE 5.4 mmol/L')] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('ollama-unavailable');
  });

  it('returns ok:false with ollama-unavailable on network error during generate', async () => {
    // Health check succeeds, generate call throws.
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.endsWith('/api/tags')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
      }
      return Promise.reject(new Error('ECONNREFUSED'));
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = createOllamaClient();
    const res = await client.classifyBlocks({ blocks: [block('GLUCOSE 5.4 mmol/L')] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('ollama-unavailable');
  });

  it('returns ok:false with ollama-unavailable on AbortError (timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.endsWith('/api/tags')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
      }
      const err = new DOMException('Aborted', 'AbortError');
      return Promise.reject(err);
    }));

    const client = createOllamaClient({ requestTimeoutMs: 50 });
    const res = await client.classifyBlocks({ blocks: [block('GLUCOSE 5.4 mmol/L')] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('ollama-unavailable');
  });

  it('returns ok:false with ollama-http-500 on HTTP 500 response', async () => {
    vi.stubGlobal('fetch', mockFetchWithStatus(500));
    const client = createOllamaClient();
    const res = await client.classifyBlocks({ blocks: [block('GLUCOSE 5.4 mmol/L')] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('ollama-http-500');
  });

  it('returns ok:false with ollama-invalid-json when model returns non-JSON', async () => {
    vi.stubGlobal('fetch', mockFetchWithResponse('this is not json'));
    const client = createOllamaClient();
    const res = await client.classifyBlocks({ blocks: [block('GLUCOSE 5.4 mmol/L')] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('ollama-invalid-json');
  });

  it('returns ok:false with ollama-shape-error when items array is missing', async () => {
    vi.stubGlobal('fetch', mockFetchWithResponse(JSON.stringify({ result: [] })));
    const client = createOllamaClient();
    const res = await client.classifyBlocks({ blocks: [block('GLUCOSE 5.4 mmol/L')] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('ollama-shape-error');
  });

  it('returns ok:false with ollama-shape-error when root is an array, not an object', async () => {
    vi.stubGlobal('fetch', mockFetchWithResponse(JSON.stringify([{ blockIndex: 0 }])));
    const client = createOllamaClient();
    const res = await client.classifyBlocks({ blocks: [block('GLUCOSE 5.4 mmol/L')] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('ollama-shape-error');
  });

  it('returns ok:false with ollama-item-count-mismatch when item count does not match blocks', async () => {
    const twoBlockResponse = JSON.stringify({ items: [
      { blockIndex: 0, label: 'noise', evidence: 'x', confidence: 0.9, reason: 'r' },
      { blockIndex: 1, label: 'noise', evidence: 'y', confidence: 0.9, reason: 'r' },
    ]});
    vi.stubGlobal('fetch', mockFetchWithResponse(twoBlockResponse));

    const client = createOllamaClient();
    // Only one block, but response has two items.
    const res = await client.classifyBlocks({ blocks: [block('GLUCOSE 5.4 mmol/L')] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('ollama-item-count-mismatch');
  });

  it('returns ok:false with ollama-malformed-envelope when Ollama envelope has no response field', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.endsWith('/api/tags')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        // Missing `response` field — model_id is returned instead (wrong shape).
        json: () => Promise.resolve({ model: 'qwen3:8b', done: true }),
      } as unknown as Response);
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = createOllamaClient();
    const res = await client.classifyBlocks({ blocks: [block('GLUCOSE 5.4 mmol/L')] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('ollama-malformed-envelope');
  });

  // ── Upstream evidence guard ────────────────────────────────────────────────

  it('demotes an item to uncertain when evidence is not a substring of the block', async () => {
    const blockText = 'HEMOGLOBIN 13.2 g/dL 13.0-17.0';
    const modelOutput = JSON.stringify({
      items: [
        {
          blockIndex: 0,
          label: 'lab_result',
          // Fabricated evidence — not in blockText
          evidence: 'INVENTED 99.9 mg/dL',
          confidence: 0.9,
          reason: 'test',
          normalized: { testName: 'INVENTED', value: '99.9', unit: 'mg/dL' },
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetchWithResponse(modelOutput));

    const client = createOllamaClient();
    const res = await client.classifyBlocks({ blocks: [block(blockText)] });

    expect(res.ok).toBe(true);
    // The upstream guard must demote it before it reaches the extractor.
    expect(res.items[0]?.label).toBe('uncertain');
    expect(res.items[0]?.confidence).toBe(0);
  });

  it('does not demote an item whose evidence IS a substring of the block', async () => {
    const blockText = 'GLUCOSE 5.4 mmol/L 4.1-5.9';
    const modelOutput = JSON.stringify({
      items: [
        {
          blockIndex: 0,
          label: 'lab_result',
          evidence: 'GLUCOSE 5.4 mmol/L 4.1-5.9',
          confidence: 0.88,
          reason: 'lab row',
          normalized: { testName: 'GLUCOSE', value: '5.4', unit: 'mmol/L', referenceRange: { text: '4.1-5.9' } },
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetchWithResponse(modelOutput));

    const client = createOllamaClient();
    const res = await client.classifyBlocks({ blocks: [block(blockText)] });

    expect(res.ok).toBe(true);
    expect(res.items[0]?.label).toBe('lab_result');
  });

  // ── Fallback integration ───────────────────────────────────────────────────

  it('extractWithLlm falls back (usedLlmPath:false) when Ollama is unavailable', async () => {
    vi.stubGlobal('fetch', mockFetchNetworkError());
    const client = createOllamaClient();
    const outcome = await extractWithLlm(ingestion('GLUCOSE 5.4 mmol/L 4.1-5.9'), client);
    expect(outcome.usedLlmPath).toBe(false);
    expect(outcome.lowYield).toBe(true);
  });

  // ── Validation gate blocks boilerplate even when model mislabels it ────────

  it('blocks a descriptor mislabeled as lab_result (validation gate still rejects)', async () => {
    // The model labels "Calculated" as a lab_result with a fabricated value.
    // Even though evidence IS in the block, the gate must reject it because
    // "Calculated" is a generic descriptor and has no unit/range.
    const blockText = 'Calculated';
    const modelOutput = JSON.stringify({
      items: [
        {
          blockIndex: 0,
          label: 'lab_result',
          evidence: 'Calculated',
          confidence: 0.7,
          reason: 'model error',
          normalized: { testName: 'Calculated', value: '42' },
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetchWithResponse(modelOutput));

    const client = createOllamaClient();
    const outcome = await extractWithLlm(ingestion(blockText), client);

    // The entry must NOT appear in findings.
    expect(outcome.report.entries.map((e) => e.testName)).not.toContain('Calculated');
    // It should be routed to ambiguousLines.
    expect(
      outcome.report.extractionQuality.ambiguousLines.some((l) => l.includes('Calculated')),
    ).toBe(true);
  });
});
