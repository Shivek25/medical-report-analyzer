import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Bypass broken index.js in pdf-parse@1.1.1 that crashes under ESM
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
import { IngestionResult } from '../types/index.js';

export async function extractTextFromPdf(filePath: string, originalFilename: string): Promise<IngestionResult> {
  let dataBuffer: Buffer;
  try {
    dataBuffer = fs.readFileSync(filePath);
  } catch (error: any) {
    return {
      originalFilename,
      storedFilePath: filePath,
      extractionStatus: 'failed',
      extractedText: '',
      warningsOrErrors: [`Failed to read file: ${error.message}`]
    };
  }

  try {
    const data = await pdfParse(dataBuffer);
    const text = data.text || '';
    
    // Fallback stringent detection logic for scanned PDFs
    // If there are less than 50 characters, it's very likely a scanned document.
    if (text.trim().length < 50) {
      return {
        originalFilename,
        storedFilePath: filePath,
        extractionStatus: 'scanned_fallback',
        extractedText: text,
        extractionNotes: 'Warning: Very little text extracted. This might be a scanned PDF or mostly an image.',
        warningsOrErrors: ['Scanned PDF detected. OCR is not implemented in Phase 1.']
      };
    }
    
    return {
      originalFilename,
      storedFilePath: filePath,
      extractionStatus: 'success',
      extractedText: text,
    };
  } catch (error: any) {
    return {
      originalFilename,
      storedFilePath: filePath,
      extractionStatus: 'failed',
      extractedText: '',
      warningsOrErrors: [`Failed to parse PDF: ${error.message}`]
    };
  }
}
