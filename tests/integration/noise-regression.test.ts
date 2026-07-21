import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from '../../src/server/index.js';
import { extractTextFromPdf } from '../../src/lib/pdf/extractor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLES_DIR = path.resolve(__dirname, '../../data/samples');

describe('Parser Noise Regression Tests', () => {
  const app = createServer();
  const sampleFiles = ['shivek_June25.pdf', 'shivek_March26.pdf', 'shivek_urm_March26.pdf', 'Saksham_report.pdf'];

  const noiseKeywords = [
    'street', 'floor', 'sector', 'noida', 'ghaziabad', 'delhi', 'road', 'suite', 'address',
    'phone', 'mobile', 'email', 'fax', 'website', 'www.', 'court', 'jurisdiction', 'barcode',
    'processing', 'cancelled', 'ready', 'release', 'received', 'client', 'code', 'self',
    'm sex', 'f sex', 'page ', 'disclaimer', 'specimen', 'visit', 'uhid', 'mr no', 'database',
    'customer details', 'collected on', 'received on', 'released on', 'sct', 'srt', 'rrt',
    '3rd floor', 'sector-63', 'turbhe', 'navi mumbai', 'midc', '400703', '201301', '201010',
    '110085', 'rohini', 'block-e', 'lalpathlabs', 'thyrocare', 'call us', 'metro suites', 'vaishali'
  ];

  const forbiddenExactNames = [
    'calculated', 'calculated pq', 'flow cytometry', 'technology', 'methodology', 'renal', 'lipid', 'units', 'value',
    'ratio', '%', 'mg/dl', '>', 'male:', 'female:', 'male', 'female', 'units', 'value units', 'g/dl', 'pg/ml', 'ng/ml'
  ];

  const forbiddenSubstrings = [
    'tietz nw', 'clinical guide', 'saunders', 'philadelphia', 'benedict’s', 'rothera\'s', 'sulfur granule', 'fouchet', 'ehrlich', 'during interpretation'
  ];

  const genuineLabKeywords = [
    'HEMOGLOBIN',
    'CHOLESTEROL',
    'URIC ACID',
    'Urea',
    'Creatinine',
    'SODIUM',
    'CHLORIDE',
    'GLUCOSE',
    'BILIRUBIN',
    'PROTEIN'
  ];

  for (const fileName of sampleFiles) {
    it(`should suppress noise and retain genuine findings in ${fileName}`, async () => {
      const filePath = path.join(SAMPLES_DIR, fileName);
      const ingestion = await extractTextFromPdf(filePath, fileName);

      const res = await request(app)
        .post('/api/v1/analyze')
        .send(ingestion);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const report = res.body.report;
      const summary = res.body.summary;

      // 0. Assert multi-line merge warnings count is below 35
      const mergeWarnings = (report.extractionQuality.warnings || []).filter((w: string) =>
        w.toLowerCase().includes('multi-line merge')
      );
      expect(mergeWarnings.length, `Too many multi-line merge warnings: ${mergeWarnings.join(', ')}`).toBeLessThan(35);

      // Helper to assert a string or object does not contain any noise keywords
      const assertNoNoise = (value: unknown, context: string, isTestNameField = false) => {
        if (!value) return;
        let text = '';
        if (typeof value === 'string') {
          text = value;
        } else if (typeof value === 'number') {
          text = String(value);
        } else if (typeof value === 'object' && value !== null) {
          // If it is a reference range object, check the text field
          const refRange = value as any;
          if (typeof refRange.text === 'string') {
            text = refRange.text;
          }
        }

        const lowerText = text.trim().toLowerCase();

        // 1. Generic exact name check (for testName fields only)
        if (isTestNameField) {
          for (const generic of forbiddenExactNames) {
            expect(lowerText, `${context} has forbidden generic/orphan name "${generic}"`).not.toBe(generic);
          }
        }

        // 2. Bibliography check
        for (const bib of forbiddenSubstrings) {
          expect(lowerText, `${context} contains forbidden bibliography substring "${bib}"`).not.toContain(bib);
        }

        // 3. Address/contact check
        for (const kw of noiseKeywords) {
          expect(lowerText, `${context} contains address/contact keyword "${kw}"`).not.toContain(kw);
        }
      };

      // 1. Assert no noise in report entries
      for (const entry of report.entries) {
        // Only check exact generic names on confident entries; uncertain entries
        // are already flagged by the parser and excluded from the summary.
        assertNoNoise(entry.testName, `Entry testName ("${entry.testName}")`, !entry.uncertain);
        assertNoNoise(entry.value, `Entry value ("${entry.value}")`);
        assertNoNoise(entry.referenceRange, `Entry referenceRange ("${entry.referenceRange?.text}")`);
        assertNoNoise(entry.notes, `Entry notes ("${entry.notes}")`);
      }

      // 2. Assert no noise in abnormal findings
      for (const finding of summary.abnormalFindings) {
        for (const f of finding.findings) {
          assertNoNoise(f.testName, `Abnormal finding testName ("${f.testName}")`, true);
          assertNoNoise(f.value, `Abnormal finding value ("${f.value}")`);
          assertNoNoise(f.referenceRange, `Abnormal finding referenceRange ("${f.referenceRange?.text}")`);
          assertNoNoise(f.interpretation, `Abnormal finding interpretation ("${f.interpretation}")`);
        }
      }

      // 3. Assert no noise in normal findings
      for (const finding of summary.normalFindings) {
        for (const e of finding.entries) {
          assertNoNoise(e.testName, `Normal finding testName ("${e.testName}")`, true);
          assertNoNoise(e.value, `Normal finding value ("${e.value}")`);
          assertNoNoise(e.referenceRange, `Normal finding referenceRange ("${e.referenceRange?.text}")`);
          assertNoNoise(e.interpretation, `Normal finding interpretation ("${e.interpretation}")`);
        }
      }

      // 4. Assert no noise in uncertain entries
      for (const entry of summary.uncertainEntries) {
        assertNoNoise(entry.testName, `Uncertain entry testName ("${entry.testName}")`, false);
        if (entry.value) {
          assertNoNoise(String(entry.value), `Uncertain entry value ("${entry.value}")`);
        }
      }

      // 5. Assert no noise in overview text
      assertNoNoise(summary.overviewText, 'Overview text');

      // 6. Assert that genuine lab test rows are still extracted
      if (fileName === 'shivek_urm_March26.pdf') {
        // For urine report, check for protein or specific gravity or glucose etc.
        const foundGenuine = report.entries.some((entry: any) =>
          ['PROTEIN', 'GLUCOSE', 'GRAVITY', 'PH'].some(kw => entry.testName.toUpperCase().includes(kw))
        );
        expect(foundGenuine, `Expected to find some genuine lab entries in urine report`).toBe(true);
      } else {
        // Blood report: expect at least one standard blood analyte.
        const foundGenuine = report.entries.some((entry: any) =>
          genuineLabKeywords.some(kw => entry.testName.toUpperCase().includes(kw.toUpperCase()))
        );
        expect(foundGenuine, `Expected to find some genuine lab entries in ${fileName}`).toBe(true);
      }
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// Strict regression: no boilerplate / generic descriptors / metadata fragments
// may ever surface as test names, summary findings, overview text, or metadata.
// These assertions are deliberately token-specific so the regression cannot
// silently return once the parser changes again.
// ────────────────────────────────────────────────────────────────────────────────
describe('Parser Strict Noise Regression (boilerplate / descriptors)', () => {
  const app = createServer();
  const sampleFiles = ['shivek_June25.pdf', 'shivek_March26.pdf', 'shivek_urm_March26.pdf', 'Saksham_report.pdf'];

  /**
   * Per-file cap on multi-line merge warnings.
   * Tuned after capturing the post-fix count for each PDF.
   * Saksham_report.pdf is a larger multi-page report (325 blocks, 154 raw
   * entries before normalization) so proportionally more merges are expected.
   */
  const maxMergeWarnings: Record<string, number> = {
    'shivek_June25.pdf':      5,
    'shivek_March26.pdf':     5,
    'shivek_urm_March26.pdf': 5,
    'Saksham_report.pdf':     15,  // larger report; 9 observed, cap at 15
  };

  const forbiddenTestNameTokens = [
    'Calculated',
    'Flow Cytometry',
    'METHODOLOGY',
    'TECHNOLOGY',
    'RENAL',
    'LIPID',
    'UNITS',
    'VALUE',
    'Test Name',
    'Report Status',
    'Processed At',
    'Methodology',
    'Technology',
    'Bio. Ref. Interval.',
  ];

  /**
   * Demographic / contact / address fragments that must never appear as test
   * names or in findings text.
   */
  const forbiddenFragments = [
    'M Sex: 22Y',
    'Age:',
    'Gender:',
    'Sex:',
    'Report Status',
    'Processed At',
    'phone',
    'mobile',
    'tel:',
    'email',
    'sector-',
    '3rd floor',
    '400703',
    '201301',
    '110085',
  ];

  /**
   * Helper: assert `text` contains none of the `tokens` as whole words
   * (case-insensitive). Whole-word matching avoids false positives where a
   * token is a legitimate substring of a real analyte name.
   */
  const assertNoWholeWordTokens = (
    text: string,
    tokens: readonly string[],
    context: string,
  ) => {
    for (const token of tokens) {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'i');
      expect(re.test(text), `${context}: must not contain forbidden token "${token}" (text was "${text}")`).toBe(false);
    }
  };

  /** Helper: assert `text` does not contain any of the fragments (substring). */
  const assertNoFragments = (
    text: string,
    fragments: readonly string[],
    context: string,
  ) => {
    const lower = text.toLowerCase();
    for (const frag of fragments) {
      expect(lower, `${context}: must not contain fragment "${frag}" (text was "${text}")`).not.toContain(frag.toLowerCase());
    }
  };

  /** True iff a string is a valid ISO `YYYY-MM-DD` calendar date. */
  const isIsoDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

  for (const fileName of sampleFiles) {
    it(`excludes boilerplate/descriptor tokens from findings (${fileName})`, async () => {
      const filePath = path.join(SAMPLES_DIR, fileName);
      const ingestion = await extractTextFromPdf(filePath, fileName);

      const res = await request(app)
        .post('/api/v1/analyze')
        .send(ingestion);

      expect(res.status).toBe(200);
      const report = res.body.report;
      const summary = res.body.summary;

      // ── 1. LabEntry.testName + value must not carry forbidden tokens ──────────
      for (const entry of report.entries as any[]) {
        assertNoWholeWordTokens(entry.testName, forbiddenTestNameTokens, `${fileName} entry testName`);
        assertNoFragments(entry.testName, forbiddenFragments, `${fileName} entry testName`);
        assertNoFragments(String(entry.value ?? ''), forbiddenFragments, `${fileName} entry value`);
        if (entry.notes) assertNoFragments(entry.notes, forbiddenFragments, `${fileName} entry notes`);
      }

      // ── 2. Summary abnormal / normal / uncertain findings ─────────────────────
      for (const group of summary.abnormalFindings as any[]) {
        for (const f of group.findings) {
          assertNoWholeWordTokens(f.testName, forbiddenTestNameTokens, `${fileName} abnormal testName`);
          assertNoFragments(f.testName, forbiddenFragments, `${fileName} abnormal testName`);
        }
      }
      for (const group of summary.normalFindings as any[]) {
        for (const e of group.entries) {
          assertNoWholeWordTokens(e.testName, forbiddenTestNameTokens, `${fileName} normal testName`);
          assertNoFragments(e.testName, forbiddenFragments, `${fileName} normal testName`);
        }
      }
      for (const u of summary.uncertainEntries as any[]) {
        assertNoWholeWordTokens(u.testName, forbiddenTestNameTokens, `${fileName} uncertain testName`);
        assertNoFragments(u.testName, forbiddenFragments, `${fileName} uncertain testName`);
      }

      // ── 3. Overview text must not carry boilerplate/descriptor tokens ─────────
      assertNoWholeWordTokens(String(summary.overviewText ?? ''), forbiddenTestNameTokens, `${fileName} overview`);
      assertNoFragments(String(summary.overviewText ?? ''), forbiddenFragments, `${fileName} overview`);

      // ── 4. Metadata must be clean ─────────────────────────────────────────────
      const meta = report.metadata ?? {};
      // reportDate: either omitted or a strict ISO date (no stray boilerplate).
      if (meta.reportDate !== undefined) {
        expect(isIsoDate(meta.reportDate), `${fileName} reportDate must be ISO, got "${meta.reportDate}"`).toBe(true);
      }
      // labName must not be polluted by stray digits / column labels.
      if (meta.labName !== undefined) {
        assertNoWholeWordTokens(meta.labName, forbiddenTestNameTokens, `${fileName} labName`);
        assertNoFragments(meta.labName, forbiddenFragments, `${fileName} labName`);
        // No bare standalone numeric noise at the start of the lab name.
        expect(/^\d+$/.test(meta.labName.trim()), `${fileName} labName must not be purely numeric`).toBe(false);
      }

      // ── 5. Genuine analytes still survive ─────────────────────────────────────
      if (fileName !== 'shivek_urm_March26.pdf') {
        const survived = (report.entries as any[]).some((e) =>
          ['HEMOGLOBIN', 'GLUCOSE', 'CHOLESTEROL', 'CREATININE', 'UREA', 'URIC ACID']
            .some((kw) => e.testName.toUpperCase().includes(kw)),
        );
        expect(survived, `${fileName}: genuine analytes must still be parsed`).toBe(true);
      } else {
        const survived = (report.entries as any[]).some((e) =>
          ['PROTEIN', 'GLUCOSE', 'GRAVITY', 'PH', 'BILIRUBIN']
            .some((kw) => e.testName.toUpperCase().includes(kw)),
        );
        expect(survived, `${fileName}: genuine urine analytes must still be parsed`).toBe(true);
      }

      // ── 6. Multi-line merge warnings materially reduced & not from boilerplate ─
      const warnings: string[] = report.extractionQuality.warnings ?? [];
      const mergeWarnings = warnings.filter((w) => w.includes('Multi-line merge exceeded'));
      // Baseline: prior to the Phase 8 fix each sample produced dozens of these.
      // Threshold is per-file since Saksham_report.pdf is a larger multi-page document.
      const mergeWarningCap = maxMergeWarnings[fileName] ?? 5;
      expect(
        mergeWarnings.length,
        `${fileName}: multi-line merge warnings must be materially reduced (got ${mergeWarnings.length}, cap=${mergeWarningCap})`,
      ).toBeLessThanOrEqual(mergeWarningCap);
    });
  }
});
