/**
 * Core TypeScript interfaces for the Medical Report Analyzer.
 * All domain types are defined here and imported by lib, server, and tests.
 */

// ─── Raw Parsed Data ──────────────────────────────────────────────────────────

/** A single biomarker extracted from a blood test report */
export interface ParsedMarker {
  name: string;
  value: number | string;
  unit: string;
  referenceRange: ReferenceRange;
  status: MarkerStatus;
  category: string;
}

/** Normal reference range for a biomarker */
export interface ReferenceRange {
  low?: number;
  high?: number;
  text?: string; // e.g. "Negative" for qualitative tests
}

/** Whether a marker is within, above, or below the reference range */
export type MarkerStatus = 'normal' | 'high' | 'low' | 'critical-high' | 'critical-low' | 'unknown';

// ─── Report Structure ─────────────────────────────────────────────────────────

/** Top-level representation of a parsed blood test report */
export interface BloodTestReport {
  id: string;
  patientInfo: PatientInfo;
  labInfo: LabInfo;
  collectionDate: string; // ISO 8601
  reportDate: string;     // ISO 8601
  markers: ParsedMarker[];
  rawText?: string;       // Full extracted text, kept for debugging
}

/** Patient demographic details extracted from the report */
export interface PatientInfo {
  name?: string;
  age?: number;
  gender?: 'male' | 'female' | 'other' | 'unknown';
  patientId?: string;
}

/** Lab / clinic details extracted from the report */
export interface LabInfo {
  name?: string;
  address?: string;
  accreditation?: string;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

/** LLM-generated medical summary produced from a BloodTestReport */
export interface MedicalSummary {
  reportId: string;
  generatedAt: string; // ISO 8601
  overallAssessment: string;
  keyFindings: KeyFinding[];
  recommendations: string[];
  disclaimer: string;
}

/** A notable finding included in the medical summary */
export interface KeyFinding {
  markerName: string;
  value: string;
  status: MarkerStatus;
  interpretation: string;
}

// ─── API DTOs ─────────────────────────────────────────────────────────────────

/** Response shape for /api/upload */
export interface UploadResponse {
  success: boolean;
  fileId: string;
  fileName: string;
  sizeBytes: number; // fixed typo from sizeByes
  message: string;
  result?: IngestionResult; // newly added structured result
}

/** Structured result representing the extracted PDF data */
export interface IngestionResult {
  originalFilename: string;
  storedFilePath: string;
  extractionStatus: 'success' | 'failed' | 'scanned_fallback';
  extractedText: string;
  extractionNotes?: string;
  warningsOrErrors?: string[];
}

/** Response shape for /api/analyze */
export interface AnalyzeResponse {
  success: boolean;
  report: BloodTestReport;
  summary: MedicalSummary;
}

/** Generic API error envelope */
export interface ApiError {
  success: false;
  error: string;
  code: string;
  details?: unknown;
}
