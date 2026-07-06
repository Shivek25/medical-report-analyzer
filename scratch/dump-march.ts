import path from 'path';
import { fileURLToPath } from 'url';
import { extractTextFromPdf } from '../src/lib/pdf/extractor.js';
import { clean } from '../src/lib/parser/text-cleaner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLES_DIR = path.resolve(__dirname, '../data/samples');

async function dump() {
  const filePath = path.join(SAMPLES_DIR, 'shivek_March26.pdf');
  const ingestion = await extractTextFromPdf(filePath, 'shivek_March26.pdf');
  const cleanedText = clean(ingestion.extractedText);
  const cleanedLines = cleanedText.split('\n');
  
  console.log("=== SEARCHING LINES OF shivek_March26.pdf ===");
  cleanedLines.forEach((line, idx) => {
    if (line.includes('112') || line.includes('86') || line.includes('94')) {
      console.log(`[${idx}]: "${line}"`);
      // Print 2 lines before and after
      for (let offset = -2; offset <= 2; offset++) {
        if (offset === 0) continue;
        const targetIdx = idx + offset;
        if (cleanedLines[targetIdx] !== undefined) {
          console.log(`   [${targetIdx}]: "${cleanedLines[targetIdx]}"`);
        }
      }
    }
  });
}

dump().catch(console.error);
