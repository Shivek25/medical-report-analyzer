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
  const sampleFiles = ['shivek_June25.pdf', 'shivek_March26.pdf', 'shivek_urm_March26.pdf'];

  const noiseKeywords = [
    'street', 'floor', 'sector', 'noida', 'ghaziabad', 'delhi', 'road', 'suite', 'address',
    'phone', 'mobile', 'email', 'fax', 'website', 'www.', 'court', 'jurisdiction', 'barcode',
    'processing', 'cancelled', 'ready', 'release', 'received', 'client', 'code', 'self',
    'm sex', 'f sex', 'page ', 'disclaimer', 'specimen', 'visit', 'uhid', 'mr no', 'database',
    'customer details', 'collected on', 'received on', 'released on', 'sct', 'srt', 'rrt',
    '3rd floor', 'sector-63', 'turbhe', 'navi mumbai', 'midc', '400703', '201301', '201010',
    '110085', 'rohini', 'block-e', 'lalpathlabs', 'thyrocare', 'call us', 'metro suites', 'vaishali'
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

      // Helper to assert a string or object does not contain any noise keywords
      const assertNoNoise = (value: unknown, context: string) => {
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

        const lowerText = text.toLowerCase();
        for (const kw of noiseKeywords) {
          expect(lowerText, `${context} contains noise keyword "${kw}"`).not.toContain(kw);
        }
      };

      // 1. Assert no noise in report entries
      for (const entry of report.entries) {
        assertNoNoise(entry.testName, `Entry testName ("${entry.testName}")`);
        assertNoNoise(entry.value, `Entry value ("${entry.value}")`);
        assertNoNoise(entry.referenceRange, `Entry referenceRange ("${entry.referenceRange?.text}")`);
        assertNoNoise(entry.notes, `Entry notes ("${entry.notes}")`);
      }

      // 2. Assert no noise in abnormal findings
      for (const finding of summary.abnormalFindings) {
        for (const f of finding.findings) {
          assertNoNoise(f.testName, `Abnormal finding testName ("${f.testName}")`);
          assertNoNoise(f.value, `Abnormal finding value ("${f.value}")`);
          assertNoNoise(f.referenceRange, `Abnormal finding referenceRange ("${f.referenceRange?.text}")`);
          assertNoNoise(f.interpretation, `Abnormal finding interpretation ("${f.interpretation}")`);
        }
      }

      // 3. Assert no noise in normal findings
      for (const finding of summary.normalFindings) {
        for (const e of finding.entries) {
          assertNoNoise(e.testName, `Normal finding testName ("${e.testName}")`);
          assertNoNoise(e.value, `Normal finding value ("${e.value}")`);
          assertNoNoise(e.referenceRange, `Normal finding referenceRange ("${e.referenceRange?.text}")`);
          assertNoNoise(e.interpretation, `Normal finding interpretation ("${e.interpretation}")`);
        }
      }

      // 4. Assert no noise in uncertain entries
      for (const entry of summary.uncertainEntries) {
        assertNoNoise(entry.testName, `Uncertain entry testName ("${entry.testName}")`);
        if (entry.value) {
          assertNoNoise(String(entry.value), `Uncertain entry value ("${entry.value}")`);
        }
      }

      // 5. Assert no noise in overview text
      assertNoNoise(summary.overviewText, 'Overview text');

      // 6. Assert that genuine lab test rows are still extracted
      if (fileName !== 'shivek_urm_March26.pdf') {
        const foundGenuine = report.entries.some((entry: any) =>
          genuineLabKeywords.some(kw => entry.testName.toUpperCase().includes(kw.toUpperCase()))
        );
        expect(foundGenuine, `Expected to find some genuine lab entries in ${fileName}`).toBe(true);
      } else {
        // For urine report, check for protein or specific gravity or glucose etc.
        const foundGenuine = report.entries.some((entry: any) =>
          ['PROTEIN', 'GLUCOSE', 'GRAVITY', 'PH'].some(kw => entry.testName.toUpperCase().includes(kw))
        );
        expect(foundGenuine, `Expected to find some genuine lab entries in urine report`).toBe(true);
      }
    });
  }
});
