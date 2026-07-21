/**
 * src/lib/parser/metadata.ts
 *
 * Metadata Extractor for the Phase 2 parser.
 *
 * Operates on the head (~first 30 lines) of cleaned text and pulls out the
 * `ReportMetadata` fields that downstream phases need without re-touching the
 * report body. The extractor is a pure function — no I/O, no mutable shared
 * state, deterministic given the same input string.
 *
 * Behaviour summary (per Requirements 2.1 – 2.8):
 *
 *   - `patientName` is read from a `Name : <name>` (or `Patient Name : <name>`)
 *     line; if no labelled line is present, a stand-alone title-case line near
 *     the top is used as a fallback. The trailing age/gender annotation
 *     `(<digits>Y/<letter>)` is stripped from the stored name.
 *
 *   - `patientAge` and `patientGender` are populated only when the name line
 *     ends with the exact `(<digits>Y/<single-letter>)` annotation; on any
 *     mismatch both fields are left omitted (Req 2.7, 2.8).
 *
 *   - `reportDate` is taken from `Report Date` / `Reported on` labels;
 *     `sampleDate` from `Sample Collected` / `Collection Date`. Each value is
 *     converted to ISO `YYYY-MM-DD` when it matches one of the accepted date
 *     formats; otherwise the verbatim source string is stored (Req 2.2, 2.3).
 *
 *   - `labName` is the first header-zone line containing a known lab keyword
 *     (Thyrocare, Diagnostics, Laboratory, Pathology, Lab, Healthcare).
 *
 *   - `reportId` is the first match of `Barcode : <id>` or `Report ID : <id>`.
 *
 *   - Any field that cannot be located is left omitted from the returned
 *     object — the parser never fabricates metadata (Req 2.6). Because
 *     `exactOptionalPropertyTypes` is enabled, optional properties are
 *     omitted rather than set to `undefined`.
 */

import type { ReportMetadata } from '../types/index.js';
import { isNoiseRow } from './noise-filter.js';
import {
  ACCEPTED_DATE_FORMATS,
  AGE_GENDER_ANNOTATION,
  GENDER_LETTER_MAP,
  MONTH_ABBR_MAP,
  type DateFormatSpec,
} from './patterns.js';

// ─── Local Patterns ───────────────────────────────────────────────────────────

/** Number of leading lines treated as the header zone (Req 2.x). */
const HEADER_ZONE_LINES = 30;

/**
 * Recognises the labelled patient-name line. Allows an optional `Patient `
 * prefix (e.g., `Patient Name : Shivek Sharma`) and tolerates ` :` or `:`.
 * Stops capturing if it hits another known column like `Specimen Drawn ON` or `Tests Done`.
 */
const NAME_LABEL_LINE = /^\s*(?:Patient\s+)?Name\s*:\s*(.+?)(?=\s+(?:Specimen|Age|Gender|Date|UHID|Barcode|Ref|Report|Tests|Client)\b|$)/i;

/**
 * Stand-alone title-case name line used as a fallback when no labelled line
 * is present. Requires at least two *title-case* words — each word starts
 * uppercase and contains at least one lowercase letter (`Shivek`, `Sharma`,
 * `De Silva`) — with an optional trailing `(...)` annotation. All-caps words
 * (`BY`, `REF`, `URINE`, `ROUTINE`) are rejected so column headers
 * (`REF. BY`) and report titles (`URINE EXAMINATION ROUTINE`) are not
 * mistaken for a patient name.
 */
const STANDALONE_NAME_LINE =
  /^([A-Z][a-z][a-zA-Z.'-]*(?:\s+[A-Z][a-z][a-zA-Z.'-]*)+(?:\s*\([^)]*\))?)$/;

/** 
 * Titled patient name line. E.g., ` Mr Saksham Upadhyay`
 * `\uE000-\uF8FF` matches Private Use Area icons emitted by the PDF extractor.
 */
const TITLED_NAME_LINE = /^[\uE000-\uF8FF]\s*(Mr|Ms|Mrs|Master|Miss|Dr)\.?\s+(.+)$/i;

/** Demographic line (e.g. Redcliffe Labs: `Gender: Male Age: 26 Yrs Patient ID: 17446833`) */
const DEMOGRAPHIC_LINE = /Gender:\s*(Male|Female|M|F)\s*Age:\s*(\d+)\s*(?:Yrs|Y|Years).*?(?:Patient\s*ID|Report\s*ID|ID):\s*([A-Z0-9-]+)/i;

/** Isolated Age/Gender line (e.g. `Age/Gender : 24 YRS  /M`) */
const AGE_GENDER_LINE = /(?:Age\s*\/\s*Gender|Age|Gender)\s*:\s*(\d+)\s*(?:YRS|Y|Years|Year|Months|Days)?\s*\/?\s*(Male|Female|M|F)/i;

/** Labelled report-date line (`Report Date` or `Reported on`). */
const REPORT_DATE_LABEL =
  /(?:Report\s*Date|Reported\s*on|^\s*Date)\b\s*[:\-]?\s*(.+?(?=\s+Sample\s*Collected\b)|.+)/i;

/** Labelled sample-collection-date line (`Sample Collected` or `Collection Date`). */
const SAMPLE_DATE_LABEL =
  /(?:Sample\s*Collected|Collection\s*Date|Specimen\s*Drawn\s*ON|Specimen\s*Received\s*ON|^\s*Sample)\b\s*[:\-]?\s*(.+?(?=\s+Report\s*Date\b)|.+)/i;

/**
 * Known lab-name keywords. The first header-zone line containing any of
 * these keywords is treated as the lab name (Req 2.4).
 */
const LAB_KEYWORD_LINE =
  /\b(?:Thyrocare|Redcliffe|Diagnostics?|Laboratories|Laboratory|Pathology|Pathlab|Healthcare|Labs?)\b/i;

/** Barcode label (e.g., `Barcode : BC-12345`). */
const BARCODE_LABEL = /(?:Barcode|Lab\s*No\.?)\s*:\s*([A-Z0-9-]+)/i;

/** Report ID label (e.g., `Report ID : RPT-00123`). */
const REPORT_ID_LABEL = /(?:Report\s*ID|Visit\s*ID|Visit\s*No\.?)\s*:\s*([A-Z0-9-]+)/i;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract `ReportMetadata` from the head of a cleaned report text.
 *
 * Pure: same input string → same `ReportMetadata` object shape. No I/O.
 *
 * @param cleanedText - Output of `Text_Cleaner.clean(...)`.
 * @returns A `ReportMetadata` object containing only the fields the extractor
 *          could locate; absent fields are omitted (not set to `undefined`).
 */
export function extract(cleanedText: string): ReportMetadata {
  const allLines = cleanedText.split('\n');
  const lines = allLines.slice(0, HEADER_ZONE_LINES);
  const metadata: ReportMetadata = {};

  // ── Patient name + annotation ───────────────────────────────────────────────
  const nameInfo = extractName(lines);
  if (nameInfo !== undefined) {
    if (nameInfo.name !== undefined) metadata.patientName = nameInfo.name;
    if (nameInfo.age !== undefined) metadata.patientAge = nameInfo.age;
    if (nameInfo.gender !== undefined) metadata.patientGender = nameInfo.gender;
  }

  // ── Demographic line (Gender / Age / ID) ───────────────────────────────────
  for (const line of lines) {
    const m = DEMOGRAPHIC_LINE.exec(line);
    if (m) {
      if (!metadata.patientGender && m[1] !== undefined) {
        const g = m[1].toUpperCase();
        if (g.startsWith('M')) metadata.patientGender = 'M';
        else if (g.startsWith('F')) metadata.patientGender = 'F';
      }
      if (!metadata.patientAge && m[2] !== undefined) {
        metadata.patientAge = parseInt(m[2], 10);
      }
      if (!metadata.reportId && m[3] !== undefined) {
        metadata.reportId = m[3];
      }
      break;
    }
  }

  // ── Isolated Age/Gender Line ────────────────────────────────────────────────
  for (const line of lines) {
    const m = AGE_GENDER_LINE.exec(line);
    if (m) {
      if (!metadata.patientAge && m[1] !== undefined) {
        metadata.patientAge = parseInt(m[1], 10);
      }
      if (!metadata.patientGender && m[2] !== undefined) {
        const g = m[2].toUpperCase();
        if (g.startsWith('M')) metadata.patientGender = 'M';
        else if (g.startsWith('F')) metadata.patientGender = 'F';
      }
      break;
    }
  }

  // ── Report / sample dates ───────────────────────────────────────────────────
  // Only store a date when it parses to a clean ISO `YYYY-MM-DD`. A labelled
  // value that does not match an accepted calendar-date format (stray numeric
  // fragments, boilerplate, multi-value gluing) is left omitted rather than
  // stored verbatim —Req 2.6: the parser never fabricates metadata, and a
  // non-ISO reportDate would pollute downstream consumers.
  // Note: Dates often appear at the very bottom of pages (footers), so we search allLines.
  const reportDateRaw = findLabelledValue(allLines, REPORT_DATE_LABEL);
  if (reportDateRaw !== undefined) {
    const iso = convertToIso(reportDateRaw);
    if (iso !== undefined) metadata.reportDate = iso;
  }

  const sampleDateRaw = findLabelledValue(allLines, SAMPLE_DATE_LABEL);
  if (sampleDateRaw !== undefined) {
    const iso = convertToIso(sampleDateRaw);
    if (iso !== undefined) metadata.sampleDate = iso;
  }

  // ── Lab name ────────────────────────────────────────────────────────────────
  // The first header-zone line containing a known lab keyword (Thyrocare,
  // Diagnostics, Laboratory, Pathology, Lab, Healthcare) is treated as the lab
  // name — but only if it is not itself a noise line (report status, address,
  // contact, metadata, boilerplate). This guards against lines like
  // "0 Cancelled in Lab" or "Sample processed in the laboratory" being mistaken
  // for the lab name just because they contain the substring "lab".
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    
    // Hardcode fallback for Redcliffe Labs OCR artifacts
    if (/redclif\s*f?e?labs/i.test(trimmed)) {
      metadata.labName = 'Redcliffe Labs';
      break;
    }

    if (!LAB_KEYWORD_LINE.test(trimmed)) continue;
    if (isNoiseRow(trimmed)) continue;
    metadata.labName = trimmed;
    break;
  }

  // ── Report ID (Barcode preferred, then Report ID) ───────────────────────────
  const reportId =
    findFirstCapture(lines, BARCODE_LABEL) ?? findFirstCapture(lines, REPORT_ID_LABEL);
  if (reportId !== undefined) {
    metadata.reportId = reportId;
  }

  return metadata;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

interface NameInfo {
  name?: string;
  age?: number;
  gender?: 'M' | 'F' | 'O';
}

/**
 * Locate the patient name line and parse its optional age/gender annotation.
 *
 * Strategy:
 *   1. Prefer a labelled `Name :` line anywhere in the header zone.
 *   2. Fall back to the first stand-alone title-case line that does not look
 *      like a lab-name line.
 *
 * Returns `undefined` when neither pattern matches.
 */
function extractName(lines: string[]): NameInfo | undefined {
  // Strategy 1: a labelled `Name :` / `Patient Name :` line is the reliable
  // signal. Prefer it everywhere in the header zone.
  for (const line of lines) {
    const m = NAME_LABEL_LINE.exec(line);
    if (m && m[1] !== undefined) {
      return parseNameAndAnnotation(m[1]);
    }
  }

  // Strategy 2 (conservative fallback): a stand-alone title-case line that
  // ALSO carries the `(NNY/M)` age-gender annotation. The annotation is a
  // near-perfect signal that the line is a patient name (e.g.
  // "Shivek Sharma (22Y/M)"). Plain title-case phrases like "Report
  // Availability Summary" or "Gross Examination" never carry it, so they are
  // not mistaken for a name. Per Req 2.6 the parser never fabricates metadata,
  // so when neither strategy matches the patient name is left omitted.
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (LAB_KEYWORD_LINE.test(trimmed)) continue;
    if (isNoiseRow(trimmed)) continue;
    if (!AGE_GENDER_ANNOTATION.test(trimmed)) continue;
    const m = STANDALONE_NAME_LINE.exec(trimmed);
    if (m && m[1] !== undefined) {
      return parseNameAndAnnotation(m[1]);
    }
  }

  // Strategy 3 (Titled name fallback): Title-case name preceded by an optional
  // PUA emoji and a title (Mr/Ms/Mrs/Master/Miss/Dr). E.g., ` Mr Saksham Upadhyay`.
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (LAB_KEYWORD_LINE.test(trimmed)) continue;
    if (isNoiseRow(trimmed)) continue;

    const m = TITLED_NAME_LINE.exec(trimmed);
    if (m && m[2] !== undefined) {
      return parseNameAndAnnotation(m[2]);
    }
  }

  return undefined;
}

/**
 * Split a raw name string into (cleaned name, age, gender). The annotation is
 * stripped from the returned name when present so the patient name is stored
 * without the `(22Y/M)` suffix.
 */
function parseNameAndAnnotation(rawValue: string): NameInfo {
  const info: NameInfo = {};
  let nameOnly = rawValue.trim();

  const annotation = AGE_GENDER_ANNOTATION.exec(nameOnly);
  if (annotation !== null) {
    const ageStr = annotation[1];
    const genderLetter = annotation[2];
    if (ageStr !== undefined) {
      const ageNum = Number.parseInt(ageStr, 10);
      if (Number.isFinite(ageNum)) info.age = ageNum;
    }
    if (genderLetter !== undefined) {
      const mapped = GENDER_LETTER_MAP[genderLetter];
      if (mapped !== undefined) info.gender = mapped;
    }
    // Remove the annotation from the name (Req 2.1: store name only).
    nameOnly = nameOnly.slice(0, annotation.index).trim();
  }

  if (nameOnly.length > 0) info.name = nameOnly;
  return info;
}

/**
 * Find the first non-empty captured value for a labelled-line pattern (the
 * pattern's first capture group is the value).
 */
function findLabelledValue(lines: string[], pattern: RegExp): string | undefined {
  for (const line of lines) {
    const m = pattern.exec(line);
    if (m && m[1] !== undefined) {
      const value = m[1].trim();
      if (value.length > 0) return value;
    }
  }
  return undefined;
}

/**
 * Find the first non-empty captured value for an inline pattern (the pattern's
 * first capture group is the desired token).
 */
function findFirstCapture(lines: string[], pattern: RegExp): string | undefined {
  for (const line of lines) {
    const m = pattern.exec(line);
    if (m && m[1] !== undefined && m[1].length > 0) {
      return m[1];
    }
  }
  return undefined;
}

/**
 * Convert a raw date string to ISO `YYYY-MM-DD` if it matches one of the
 * accepted formats; otherwise return `undefined`.
 *
 * Conversion only succeeds when the parsed year/month/day form a real
 * calendar date (e.g., `31/02/2026` fails, not silently rolled over). A
 * non-parseable value returns `undefined` so the caller can omit the field
 * rather than store verbatim noise.
 */
function convertToIso(rawDate: string): string | undefined {
  const trimmed = rawDate.trim();
  for (const spec of ACCEPTED_DATE_FORMATS) {
    const iso = tryFormat(trimmed, spec);
    if (iso !== undefined) return iso;
  }
  return undefined;
}

function tryFormat(value: string, spec: DateFormatSpec): string | undefined {
  const m = spec.regex.exec(value);
  if (m === null) return undefined;

  const dayStr = m[spec.parts.day];
  const monthRaw = m[spec.parts.month];
  const yearStr = m[spec.parts.year];
  if (dayStr === undefined || monthRaw === undefined || yearStr === undefined) {
    return undefined;
  }

  const day = Number.parseInt(dayStr, 10);
  const year = Number.parseInt(yearStr, 10);
  let month: number;

  if (spec.parts.monthIsAbbr) {
    const key = monthRaw.toLowerCase().slice(0, 3);
    const resolved = MONTH_ABBR_MAP[key];
    if (resolved === undefined) return undefined;
    month = resolved;
  } else {
    month = Number.parseInt(monthRaw, 10);
  }

  if (!isValidCalendarDate(year, month, day)) return undefined;

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  // Use UTC to avoid timezone drift; reject dates that JS rolled over
  // (e.g., Feb 31 → Mar 3).
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
