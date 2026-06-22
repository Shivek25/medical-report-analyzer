import path from 'path';
import { fileURLToPath } from 'url';
import { extractTextFromPdf } from './src/lib/pdf/extractor.js';
import { parseRawText } from './src/lib/parser/orchestrator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLES_DIR = path.resolve(__dirname, './data/samples');

async function check() {
  const sampleFiles = ['shivek_March26.pdf'];
  for (const file of sampleFiles) {
    const filePath = path.join(SAMPLES_DIR, file);
    const ingestion = await extractTextFromPdf(filePath, file);
    const report = parseRawText(ingestion);
    console.log(`\n=== QUALITY COUNTS for ${file} ===`);
    console.log(`totalRowsDetected:`, report.extractionQuality.totalRowsDetected);
    console.log(`successfullyParsed:`, report.extractionQuality.successfullyParsed);
    console.log(`uncertainRows:`, report.extractionQuality.uncertainRows);
    console.log(`skippedRows:`, report.extractionQuality.skippedRows);
    console.log(`confidence:`, report.extractionQuality.confidence);
    console.log(`warnings:`, report.extractionQuality.warnings);
    
    // Print all ambiguous rows
    console.log(`\n=== AMBIGUOUS ROWS (${report.extractionQuality.ambiguousLines.length}) ===`);
    report.extractionQuality.ambiguousLines.forEach((line, idx) => {
      console.log(`- [${idx}]: "${line}"`);
    });

    // Print all uncertain entries
    console.log(`\n=== UNCERTAIN ENTRIES (${report.entries.filter(e => e.uncertain).length}) ===`);
    report.entries.forEach((entry, idx) => {
      if (entry.uncertain) {
        console.log(`- [${idx}]: name="${entry.testName}", value="${entry.value}", reason="${entry.uncertaintyReason}"`);
      }
    });
  }
}

check().catch(console.error);
