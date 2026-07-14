/**
 * tests/unit/extraction/llm-client.test.ts
 *
 * Unit tests for the deterministic stub LlmClient and the candidate generator.
 * The stub is network-free; these tests pin its labels, evidence, and the
 * enabled/disabled contract so the full LLM path is exercisable without an API
 * key.
 */

import { describe, it, expect } from 'vitest';
import { createStubClient } from '../../../src/lib/extraction/llm-client.js';
import { generateCandidates } from '../../../src/lib/extraction/candidate-generator.js';
import type { CandidateBlock } from '../../../src/lib/extraction/types.js';

function block(text: string, lineStart = 0): CandidateBlock {
  return { text, lineStart, lineEnd: lineStart, page: undefined };
}

describe('createStubClient', () => {
  describe('enabled contract', () => {
    it('returns ok:false when disabled (the default)', async () => {
      const client = createStubClient();
      const res = await client.classifyBlocks({ blocks: [block('HEMOGLOBIN 13.2 g/dL')] });
      expect(res.ok).toBe(false);
      expect(res.error).toBe('stub-disabled');
      expect(res.items).toHaveLength(0);
    });

    it('returns ok:true with one item per block when enabled', async () => {
      const client = createStubClient({ enabled: true });
      const res = await client.classifyBlocks({
        blocks: [block('HEMOGLOBIN 13.2 g/dL 13.0-17.0', 0), block('phone 1800', 1)],
      });
      expect(res.ok).toBe(true);
      expect(res.items).toHaveLength(2);
      expect(res.items[0]!.blockIndex).toBe(0);
      expect(res.items[1]!.blockIndex).toBe(1);
    });
  });

  describe('label determinism', () => {
    const client = createStubClient({ enabled: true });

    it('labels a genuine lab row as lab_result with normalized fields', async () => {
      const text = 'HEMOGLOBIN 13.2 g/dL 13.0-17.0';
      const res = await client.classifyBlocks({ blocks: [block(text)] });
      const item = res.items[0]!;
      expect(item.label).toBe('lab_result');
      expect(item.evidence).toBe(text);
      expect(item.normalized?.testName).toBe('HEMOGLOBIN');
      expect(item.normalized?.value).toBe('13.2');
      expect(item.confidence).toBeGreaterThan(0);
      expect(item.reason.length).toBeGreaterThan(0);
    });

    it('labels a noise row (address/contact) as noise', async () => {
      const res = await client.classifyBlocks({ blocks: [block('phone 1800-123-4567')] });
      expect(res.items[0]!.label).toBe('noise');
    });

    it('labels a standalone descriptor as noise', async () => {
      const res = await client.classifyBlocks({ blocks: [block('Calculated')] });
      expect(res.items[0]!.label).toBe('noise');
    });

    it('labels a column label as noise', async () => {
      const res = await client.classifyBlocks({ blocks: [block('TECHNOLOGY')] });
      expect(res.items[0]!.label).toBe('noise');
    });

    it('labels a patient-name line as metadata', async () => {
      const res = await client.classifyBlocks({ blocks: [block('Name : Shivek Sharma')] });
      const item = res.items[0]!;
      expect(item.label).toBe('metadata');
      expect(item.metadataField).toBe('patientName');
      expect(item.metadataValue).toBe('Shivek Sharma');
    });

    it('labels a value-less prose line as uncertain', async () => {
      const res = await client.classifyBlocks({ blocks: [block('This is a random prose sentence')] });
      expect(res.items[0]!.label).toBe('uncertain');
    });

    it('is deterministic: same input yields identical output across calls', async () => {
      const a = await client.classifyBlocks({ blocks: [block('GLUCOSE 5.4 mmol/L 4.1-5.9')] });
      const b = await client.classifyBlocks({ blocks: [block('GLUCOSE 5.4 mmol/L 4.1-5.9')] });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('never fabricates a testName absent from the block', async () => {
      const text = 'GLUCOSE 5.4 mmol/L 4.1-5.9';
      const res = await client.classifyBlocks({ blocks: [block(text)] });
      const name = res.items[0]!.normalized?.testName ?? '';
      expect(text).toContain(name);
    });
  });
});

describe('generateCandidates', () => {
  it('skips blank lines and emits one candidate per non-blank line', () => {
    const text = 'HEMOGLOBIN 13.2\n\nGLUCOSE 5.4';
    const cands = generateCandidates(text);
    expect(cands).toHaveLength(2);
    expect(cands[0]!.lineStart).toBe(0);
    expect(cands[1]!.lineStart).toBe(2);
  });

  it('folds a test-name-only line with a following value-only line into one block', () => {
    const text = 'HEMOGLOBIN\n13.2';
    const cands = generateCandidates(text);
    expect(cands).toHaveLength(1);
    expect(cands[0]!.text).toBe('HEMOGLOBIN 13.2');
    expect(cands[0]!.lineStart).toBe(0);
    expect(cands[0]!.lineEnd).toBe(1);
  });

  it('does NOT fold when the second line is not value-only', () => {
    const text = 'HEMOGLOBIN\nGLUCOSE 5.4';
    const cands = generateCandidates(text);
    expect(cands).toHaveLength(2);
  });

  it('returns page=undefined when no page map is supplied', () => {
    const cands = generateCandidates('GLUCOSE 5.4');
    expect(cands[0]!.page).toBeUndefined();
  });

  it('carries the page number from the page map when consistent', () => {
    const cands = generateCandidates('GLUCOSE 5.4', [1]);
    expect(cands[0]!.page).toBe(1);
  });
});
