/**
 * tests/unit/extraction/extractor.test.ts
 *
 * Unit tests for the extraction-stage orchestrator. These cover the
 * behavioural contract: never throws, conservative admission, confidence
 * demotion, low-yield fallback hint, and the disabled/failed client path.
 *
 * Uses an inline fake `LlmClient` so the stage is exercised without any
 * external dependency, plus the stub client for an end-to-end smoke.
 */

import { describe, it, expect } from 'vitest';
import { extractWithLlm } from '../../../src/lib/extraction/extractor.js';
import type { LlmClient } from '../../../src/lib/extraction/llm-client.js';
import type {
  CandidateBlock,
  LabeledItem,
  LlmClassificationRequest,
  LlmClassificationResponse,
} from '../../../src/lib/extraction/types.js';
import type { IngestionResult } from '../../../src/lib/types/index.js';
import { validateStructuredReport } from '../../../src/lib/validator/index.js';

/** Build an IngestionResult from raw extracted text. */
function ingestion(text: string, status: IngestionResult['extractionStatus'] = 'success'): IngestionResult {
  return {
    originalFilename: 'test.pdf',
    storedFilePath: 'test.pdf',
    extractionStatus: status,
    extractedText: text,
  };
}

/** Build a fake client from a mapping function over the request blocks. */
function fakeClient(
  classify: (req: LlmClassificationRequest) => LlmClassificationResponse,
  provider = 'fake',
): LlmClient {
  return {
    provider,
    classifyBlocks: async (req: LlmClassificationRequest) => classify(req),
  };
}

/** Build a lab_result item aligned to a block. */
function labItem(blockIndex: number, evidence: string, normalized: LabeledItem['normalized'], confidence = 0.9): LabeledItem {
  return { blockIndex, label: 'lab_result', evidence, confidence, reason: 'test', normalized };
}

describe('extractWithLlm', () => {
  // ── Robustness: never throws ──────────────────────────────────────────────

  it('returns a low-yield outcome when the client throws', async () => {
    const client = fakeClient(() => {
      throw new Error('boom');
    });
    const outcome = await extractWithLlm(ingestion('GLUCOSE 5.4 mmol/L'), client);
    expect(outcome.usedLlmPath).toBe(false);
    expect(outcome.lowYield).toBe(true);
  });

  it('returns a low-yield outcome when the client reports ok:false', async () => {
    const client = fakeClient(() => ({ ok: false, items: [], error: 'stub-disabled' }));
    const outcome = await extractWithLlm(ingestion('GLUCOSE 5.4 mmol/L'), client);
    expect(outcome.usedLlmPath).toBe(false);
    expect(outcome.lowYield).toBe(true);
  });

  it('short-circuits with low-yield on a failed extraction', async () => {
    const client = fakeClient(() => ({ ok: true, items: [] }));
    const outcome = await extractWithLlm(ingestion('', 'failed'), client);
    expect(outcome.usedLlmPath).toBe(false);
    expect(outcome.lowYield).toBe(true);
    expect(outcome.report.entries).toHaveLength(0);
  });

  // ── Admission + validation gate ───────────────────────────────────────────

  it('admits an evidence-backed lab row and rejects a fabricated one in the same batch', async () => {
    const good = 'HEMOGLOBIN 13.2 g/dL 13.0-17.0';
    const bad = 'RENAL 99.9'; // 'RENAL' is a section header token → noise/descriptor
    const client = fakeClient((req) => ({
      ok: true,
      items: req.blocks.map((b: CandidateBlock, i) =>
        i === 0
          ? labItem(i, good, { testName: 'HEMOGLOBIN', value: '13.2', unit: 'g/dL', referenceRange: { text: '13.0-17.0' } })
          : labItem(i, bad, { testName: 'RENAL', value: '99.9' }),
      ),
    }));
    const outcome = await extractWithLlm(ingestion(`${good}\n${bad}`), client);
    expect(outcome.usedLlmPath).toBe(true);
    const names = outcome.report.entries.map((e) => e.testName);
    expect(names).toContain('HEMOGLOBIN');
    expect(names).not.toContain('RENAL');
  });

  it('produces a schema-valid StructuredReport', async () => {
    const client = fakeClient((req) => ({
      ok: true,
      items: req.blocks.map((b: CandidateBlock, i) =>
        labItem(i, b.text, { testName: 'GLUCOSE', value: '5.4', unit: 'mmol/L' }),
      ),
    }));
    const outcome = await extractWithLlm(ingestion('GLUCOSE 5.4 mmol/L 4.1-5.9'), client);
    expect(validateStructuredReport(outcome.report).valid).toBe(true);
  });

  // ── Confidence demotion ───────────────────────────────────────────────────

  it('demotes a lab_result below the confidence threshold to uncertain (not a finding)', async () => {
    const text = 'GLUCOSE 5.4 mmol/L 4.1-5.9';
    const client = fakeClient((req) => ({
      ok: true,
      items: req.blocks.map((_: CandidateBlock, i: number) =>
        labItem(i, text, { testName: 'GLUCOSE', value: '5.4', unit: 'mmol/L' }, 0.2),
      ),
    }));
    const outcome = await extractWithLlm(ingestion(text), client, { confidenceThreshold: 0.5 });
    expect(outcome.report.entries).toHaveLength(0);
    expect(outcome.report.extractionQuality.uncertainRows).toBeGreaterThan(0);
  });

  // ── Low-yield heuristic ───────────────────────────────────────────────────

  it('flags lowYield when the client admits almost nothing across many blocks', async () => {
    // 10 candidate blocks, all labelled uncertain → 0 admitted findings.
    const text = Array.from({ length: 10 }, (_, i) => `prose line number ${i}`).join('\n');
    const client = fakeClient((req) => ({
      ok: true,
      items: req.blocks.map((_: CandidateBlock, i: number) => ({
        blockIndex: i,
        label: 'uncertain' as const,
        evidence: 'x',
        confidence: 0.1,
        reason: 'unsure',
      })),
    }));
    const outcome = await extractWithLlm(ingestion(text), client);
    expect(outcome.usedLlmPath).toBe(true);
    expect(outcome.lowYield).toBe(true);
  });

  it('does not flag lowYield for a sparse but real report', async () => {
    const text = 'GLUCOSE 5.4 mmol/L 4.1-5.9';
    const client = fakeClient((req) => ({
      ok: true,
      items: req.blocks.map((b: CandidateBlock, i) =>
        labItem(i, b.text, { testName: 'GLUCOSE', value: '5.4', unit: 'mmol/L' }),
      ),
    }));
    const outcome = await extractWithLlm(ingestion(text), client);
    expect(outcome.lowYield).toBe(false);
  });

  // ── Metadata + category tracking ──────────────────────────────────────────

  it('tracks categories via section headers and routes metadata out of findings', async () => {
    const text = 'Name : Test Patient\nLIPID PROFILE\nCHOLESTEROL 220 mg/dL 150-200';
    const client = fakeClient((req) => {
      const items: LabeledItem[] = [];
      let headerSeen = false;
      req.blocks.forEach((b: CandidateBlock, i: number) => {
        if (b.text.startsWith('Name')) {
          items.push({ blockIndex: i, label: 'metadata', evidence: b.text, confidence: 0.8, reason: 'name', metadataField: 'patientName', metadataValue: 'Test Patient' });
        } else if (b.text === 'LIPID PROFILE') {
          headerSeen = true;
          items.push({ blockIndex: i, label: 'section_header', evidence: b.text, confidence: 0.9, reason: 'header', category: 'LIPID PROFILE' });
        } else {
          const isLab = headerSeen;
          items.push(
            isLab
              ? labItem(i, b.text, { testName: 'CHOLESTEROL', value: '220', unit: 'mg/dL', referenceRange: { text: '150-200' } })
              : { blockIndex: i, label: 'uncertain', evidence: b.text, confidence: 0.2, reason: 'unsure' },
          );
        }
      });
      return { ok: true, items };
    });
    const outcome = await extractWithLlm(ingestion(text), client);
    expect(outcome.report.metadata.patientName).toBe('Test Patient');
    const entry = outcome.report.entries.find((e) => e.testName === 'CHOLESTEROL');
    expect(entry).toBeDefined();
    expect(entry!.category).toBe('LIPID PROFILE');
    // metadata block must not leak as a finding
    expect(outcome.report.entries.some((e) => e.testName.includes('Name'))).toBe(false);
  });

  // ── End-to-end smoke with the deterministic stub client ───────────────────

  it('runs end-to-end with the enabled stub client without throwing', async () => {
    const { createStubClient } = await import('../../../src/lib/extraction/llm-client.js');
    const client = createStubClient({ enabled: true });
    const outcome = await extractWithLlm(
      ingestion('HEMOGLOBIN 13.2 g/dL 13.0-17.0\nphone 1800-123-4567\nCalculated'),
      client,
    );
    expect(outcome.usedLlmPath).toBe(true);
    // Only the real analyte survives; noise/descriptors are excluded.
    expect(outcome.report.entries.map((e) => e.testName)).toEqual(['HEMOGLOBIN']);
  });
});
