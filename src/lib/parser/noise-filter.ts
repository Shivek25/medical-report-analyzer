/**
 * src/lib/parser/noise-filter.ts
 *
 * Deterministic noise filter for suppressing non-medical report boilerplate,
 * addresses, contact info, report status, metadata rows, generic assay
 * descriptors, column labels, and section/panel headers from lab findings.
 *
 * Design constraints:
 *   - Pure module: no I/O, no shared mutable state, no time / random deps.
 *   - Every matcher is deterministic; the same input always yields the same
 *     verdict across calls.
 *
 * Two complementary layers are exported:
 *
 *   1. `isNoiseRow(text)` — coarse whole-line classifier used by the
 *      Row_Detector to drop obviously non-medical lines *before* they can
 *      seed or join a multi-line merge (this is what materially cuts the
 *      "Multi-line merge exceeded 3 lines" warning count).
 *
 *   2. `extractMeaningfulTestName(rawName)` — fine-grained test-name
 *      sanitiser used by the Field_Extractor. It strips leading column-label
 *      prefixes (e.g. `UNITS 25-OH VITAMIN D`) and leading/trailing generic
 *      assay descriptors (e.g. `... RATIO CALCULATED`) so the real analyte
 *      name survives while the noise does not. When nothing meaningful
 *      remains, it returns an empty string so the caller can mark the row
 *      ambiguous.
 */

// ─── Address Fragments / Locations ────────────────────────────────────────────
const ADDRESS_KEYWORDS = [
  /\bsector\b/i,
  /\bfloor\b/i,
  /\broad\b/i,
  /\bstreet\b/i,
  /\bbuilding\b/i,
  /\bmetro suites\b/i,
  /\bvaishali\b/i,
  /\bghaziabad\b/i,
  /\bnoida\b/i,
  /\bnavi mumbai\b/i,
  /\bturbhe\b/i,
  /\bnew delhi\b/i,
  /\bdelhi\b/i,
  /\brohini\b/i,
  /\bmidc\b/i,
  /\bsuite\b/i,
  /\bblock-e\b/i,
  /\bpin-\b/i,
  /\bzip-\b/i,
  /\b\d{6}\b/, // Indian PIN code
];

// ─── Contact Info ─────────────────────────────────────────────────────────────
const CONTACT_KEYWORDS = [
  /\bphone\b/i,
  /\btel\b/i,
  /\bfax\b/i,
  /\bmobile\b/i,
  /\bcall us\b/i,
  /\bcustomer care\b/i,
  /\bwww\./i,
  /\bemail\b/i,
  /\bwebsite\b/i,
  /@thyrocare\b/i,
  /@lalpathlabs\b/i,
  // Common email pattern
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  // Common phone patterns (e.g. +91-..., 1800-..., 022-...)
  /\b\d{10}\b/,
  /\b\d{4}[-\s]\d{3}[-\s]\d{3}\b/,
  /\b1800[-\s]\d{3}[-\s]\d{4}\b/,
];

// ─── Report Status & Metadata ─────────────────────────────────────────────────
const METADATA_KEYWORDS = [
  /\breport status\b/i,
  /\bcomplete report\b/i,
  /\binterim report\b/i,
  /\bprocessed at\b/i,
  /\bcollected at\b/i,
  /\breceived at\b/i,
  /\breleased on\b/i,
  /\bsample collected\b/i,
  /\bsample received\b/i,
  /\bcollected on\b/i,
  /\breceived on\b/i,
  /\bbarcode\b/i,
  /\blabcode\b/i,
  /\buhid\b/i,
  /\bmr no\b/i,
  /\bclient code\b/i,
  /\bclient name\b/i,
  /\bpatient info\b/i,
  /\bvisit id\b/i,
  /\bvisit no\b/i,
  /\b[mf]\s*sex\s*:/i,
  /\b[mf]\s*sex\s*:\s*\d+[yY]/i, // matches "M Sex: 22Y"
  /\bsex\s*:\s*[mfo]\b/i,
  /\bsex\s*:\s*\d+[yY]/i,
  /\bsex\s*:\s*$/i, // matches "Sex:" at the end of line or standalone
  /\bgender\s*:/i, // matches "Gender:" demographic label
  /\bage\s*:\s*/i,
  /\bname\s*:\s*/i,
  /\bdate\s*:\s*/i,
  /\breport\s*date\b/i,
  /\bdate\s+of\s+report\b/i,
  /\b(?:days\s+from\s+)?release\s+time\b/i, // matches "release time", "30 days from release time"
  /\breleased\s+on\b/i,
  /\breceived\s+on\b/i,
  /\bclient\s*code\b/i,
  /\bclient\s*name\b/i,
  /\bpatient\s*info\b/i,
  /\bvisit\s*id\b/i,
  /\bvisit\s*no\b/i,
  /\bdatabase\b/i,
  /\bdata\s*base\b/i,
  /\bcustomer\s+details\b/i,
  /\bcollected\s+on\b/i,
  /\bcollected\s+at\b/i,
  /\breceived\s+at\b/i,
  /\bprocessed\s+at\b/i,
  /\b(?:sct|srt|rrt)\b/i,
  /\b\d+\s+(?:processing|cancelled|ready)\b/i, // matches "0 processing", "14 ready"
  /\bshivek\s+sharma\b/i,
  /\(\d+\s*[yY]\s*[\/|]\s*[a-zA-Z]\)/, // matches age/gender annotation like (24 Y/M)
  /\(\d+\s*[yY]\b/,                    // matches age annotation like (22y
  /\b\d{6,12}\/[a-zA-Z0-9-]+\b/,        // matches lab codes like 2303085999/NCR01
  /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/i, // matches time like 08:00
  /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b/i, // matches date like 23 Mar 2026
  /\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b/, // matches date like 23-03-2026
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i, // matches date like March 23, 2026
  /\b(?:serum|edta|plasma|urine|blood|whole\s+blood)\s*\|\s*[a-z0-9-]+\b/i, // matches SERUM | EQ772837
  /\b[a-z0-9-]+\s*\(\s*(?:serum|edta|plasma|urine|blood)\s*\)/i, // matches EQ772837(SERUM)
  /\b[a-z]{2}\d{6,8}\b/i, // matches EQ772837, EZ595775
  /\b[a-z]{3}\d{2,5}\b/i, // matches NCR01
  /\b(?:edta|serum|plasma|urine|blood)\s*:\s*[a-z]/i, // matches EDTA:HBA PROFILE
];

// ─── Disclaimers & Boilerplate Instructions ───────────────────────────────────
const BOILERPLATE_KEYWORDS = [
  /\bscan qr code\b/i,
  /\bauthenticity of reported results\b/i,
  /\bpertain to the specimen\b/i,
  /\bdependent on the quality\b/i,
  /\bcorrelate with clinical conditions\b/i,
  /\bexclusive jurisdiction\b/i,
  /\bmedico legal purposes\b/i,
  /\bcomputer generated medical\b/i,
  /\bdisclaimer\b/i,
  /\bcourt\b/i,
  /\bjurisdiction\b/i,
  /\bspecimen\b/i,
  /\breference range\b/i,
  // Bibliography / reference guidelines
  /\btietz\s+nw\b/i,
  /\bclinical\s+guide\s+to\s+laboratory\b/i,
  /\bwb\s*saunders\b/i,
  /\bphiladelphia\b/i,
  // Urine method explanation text and guidelines
  /\bbenedict(?:’s|'s)?\s+method\b/i,
  /\brothera(?:’s|'s)?\s+method\b/i,
  /\bsulfur\s+granule\s+method\b/i,
  /\bfouchet\s+method\b/i,
  /\behhrlich\s+method\b/i,
  /\bnitrite\s+by\s+nitrate\s+reduction\b/i,
  /\bduring\s+interpretation\b/i,
  /\bpoints\s+to\s+be\s+considered\b/i,
  // Laboratory detail-view literature / footnote / prose boilerplate
  /\bkit validation reference\b/i,
  /\bspecifications\s*:\b/i,
  /\bintra assay\b/i,
  /\binter assay\b/i,
  /\bclinical significance\b/i,
  /\bmentzer index\b/i,
  /\bthalassemia trait\b/i,
  /\bclinical correlation\b/i,
  /\bclinical management\b/i,
  /\bdiagnostics?\s*:\s*use and assessment\b/i,
  /\bcurr opin endocrinol\b/i,
  /\bbooks-verl\b/i,
  /\bbooks-verlag\b/i,
  /\bpublished\b/i,
  /\bdiagnostic purpose\b/i,
  /\bnormal range is indicative\b/i,
  /\bconjunction with the patients\b/i,
  /\bmedical history, clinical examination\b/i,
  /\bdecreased? in vitamin d\b/i,
  /\bincreased? in vitamin d\b/i,
  /\bhelp the body absorb\b/i,
  /\bcomplex corrinoid compound\b/i,
  /\bnormal dna synthesis\b/i,
  /\berythrocyte maturation\b/i,
  /\bformation of myelin\b/i,
  /\bneurological abnormalities\b/i,
  /\bmacrocytic anemias\b/i,
  /\bindicative of CAD risk\b/i,
  /\bratio of Apo B to A1\b/i,
  /\bplease correlate with clinical\b/i,
  /\breport remarks\s*:\b/i,
  /\b30 days from release time\b/i,
];

// ─── Methodology / Technology Phrase Boilerplate ──────────────────────────────
//
// Multi-line methodology-definition lists and verbose technology descriptors
// that the PDF extractor emits as standalone lines. Each line independently
// seeds a (doomed) multi-line merge and inflates the "Multi-line merge exceeded
// 3 lines" warning count, so they are matched as whole-line noise here and
// dropped before the Row_Detector attempts a merge.
//
// Patterns seen in Thyrocare PDFs:
//   - Method-definition list items:  "CHOL - Cholesterol Oxidase, Esterase, Peroxidase"
//                                     "BILT - Diazonium salt DPD method"
//                                     "<ABBR> - Derived from serum ... values"
//   - Technology descriptors:        "LATEX ENHANCED IMMUNO TURBIDIMETRY"
//                                     "Fully Automated Electrochemiluminescence ... Immunoassay"
//                                     "FULLY AUTOMATED LATEX AGGLUTINATION – ..."
//   - Guideline headers:             "*REFERENCE RANGES AS PER NCEP ATP III GUIDELINES:"
//   - HSCRP risk classification rows: "1.00 - 3.00    -  Average Risk"
const METHODOLOGY_TECHNOLOGY_BOILERPLATE = [
  // Method-definition list item: "<ABBR> - <description>". The abbreviation is
  // 1-6 uppercase letters (optionally with / ), followed by " - " and a
  // description that typically names a method ("Oxidase", "method", "Derived").
  // Anchored so it only matches whole lines, never a real analyte row.
  /^[A-Z]{1,6}(?:\/[A-Z]{1,4})?\s*-\s+.+(?:method|derived|oxidase|esterase|peroxidase|colorimetric|end\s*point|measure|activation|guidelines|indirect|direct)\b/i,
  // "Derived from serum ... values" (trailing clause of method-definition lines).
  /\bderived from serum\b/i,
  // Technology-descriptor phrases (verbose assay descriptions).
  /\blatex\s+enhanced\b/i,
  /\bimmuno\s*turbidimetry\b/i,
  /\bfully\s+automated\b/i,
  /\belectrochemiluminescence\b/i,
  /\bcompetitive\s+immunoassay\b/i,
  /\bcompititive\s+immunoassay\b/i, // tolerate source typo
  /\blatex\s+agglutination\b/i,
  /\bbeckman\s+coulter\b/i,
  /\bion\s+selective\s+electrode\b/i,
  // Guideline / reference-range footnote headers.
  /\breference ranges as per\b/i,
  /\bncep\b/i,
  /\batp\s+iii\b/i,
  // HSCRP / risk-classification table rows of the shape
  //   "<num> - <num>    -  <Risk Label>" or "> <num>  -  <Risk Label>".
  /^\s*(?:[<>]?\s*\d+(?:\.\d+)?\s*[-\u2013]\s*)?\d+(?:\.\d+)?\s*-\s*(?:Low|Average|High|Possibly due to)\b/i,
  // Doctor / reporting-authority signature line (e.g. "Dr.Sneha Singh").
  /^Dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s*$/i,
  // "Report Remarks :" / "Tests Done :" headers (already partially matched by
  // the boilerplate `report remarks` rule; kept here as a whole-line anchor).
  /^tests\s+done\s*:/i,
  // "TEST ASKED" panel-list header that precedes the patient/address block.
  /^test\s+asked\b/i,
  // "HBA PROFILE,HEMOGRAM" / "AAROGYAM C PRO …" panel-list fragment that
  // appears as a standalone line under "TEST ASKED".
  /^hba\s+profile\b/i,
  /^aarogyam\b/i,
  // Standalone colon / separator punctuation lines (orphans left by the
  // column extractor under "TEST ASKED"). These seed doomed multi-line merges.
  /^[:;]+$/,
];

// ─── Generic Assay Descriptors / Technology / Methodology Labels ───────────────
//
// These are assay-technology / methodology descriptors (NOT analyte names). They
// are noise when they appear standalone, OR as a leading/trailing token of a
// test name. They are matched as whole tokens (case-insensitive) so that they
// do not collide with substrings inside genuine analyte names.
//
// Examples suppressed by this list: standalone "Calculated", "Flow Cytometry",
// "TECHNOLOGY", "METHODOLOGY"; and prefixes/suffixes such as
// "UNITS 25-OH VITAMIN D" or "... RATIO CALCULATED".
const GENERIC_DESCRIPTOR_TOKENS: readonly string[] = [
  'Calculated',
  'Calculation',
  'Flow Cytometry',
  'Flowcytometry',
  'Technology',
  'Methodology',
  'Immunoassay',
  'Immunoturbidimetry',
  'Turbidimetry',
  'Nephelometry',
  'Photometry',
  'Colorimetry',
  'Spectrophotometry',
  'Chemiluminescence',
  'Electrochemiluminescence',
  'Elisa',
  'PCR',
  'HPLC',
  'ECLIA',
  'E.C.L.I.A',
  'CLIA',
  'C.L.I.A',
  'H.P.L.C',
  'ISE',
  'I.S.E',
  'Ion Selective Electrode',
  'Latex Agglutination',
  'Agglutination',
  'SLS-Hemoglobin Method',
  'SLD-Hemoglobin Method',
];

// ─── Column-Label Headers ──────────────────────────────────────────────────────
//
// Table column headers that the PDF extractor sometimes emits as standalone
// lines or as a leading prefix glued to the first real test row
// (e.g. "UNITS 25-OH VITAMIN D (TOTAL)"). Matched as whole tokens.
const COLUMN_LABEL_TOKENS: readonly string[] = [
  'Test Name',
  'Testname',
  'Value',
  'Units',
  'Unit',
  'Flag',
  'Result',
  'Bio. Ref. Interval.',
  'Bio. Ref. Interval',
  'Reference Range',
  'Ref. Interval',
];

// ─── Section / Panel Headers (standalone, whole-line only) ─────────────────────
//
// Single-word panel / section headers such as "RENAL", "LIPID", "THYROID". These
// are whole-line noise: the Row_Detector drops a standalone header so it can
// neither seed nor join a merge. They are NEVER stripped as prefixes — that is
// the job of the Categorizer, and stripping them here would corrupt genuine
// analyte names such as "THYROID STIMULATING HORMONE".
const SECTION_PANEL_HEADER_TOKENS: readonly string[] = [
  'Renal',
  'Lipid',
  'Liver',
  'Thyroid',
  'Cardiac',
  'Diabetic',
  'Anaemia',
  'Anemia',
  'Hematology',
  'Haematology',
  'Biochemistry',
  'Electrolytes',
];

/**
 * Compile a list of human-readable tokens into the three positional anchored
 * matchers (leading, trailing, whole-line) used by the sanitiser helpers.
 *
 * Whitespace inside a token (`Flow Cytometry`, `Bio. Ref. Interval.`) is made
 * flexible (`\s+`) so formatting differences in the source PDF do not slip
 * past the filter. Regex metacharacters are escaped.
 */
interface TokenMatchers {
  /** Matches when the name *starts with* the token (followed by space or end). */
  lead: RegExp;
  /** Matches when the name *ends with* the token (preceded by space or start). */
  trail: RegExp;
  /** Matches when the name *is exactly* the token. */
  whole: RegExp;
}

function buildTokenMatchers(tokens: readonly string[]): TokenMatchers[] {
  return tokens.map((tok) => {
    const body = tok
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s+');
    return {
      lead: new RegExp(`^${body}(?:\\s+|$)`, 'i'),
      trail: new RegExp(`(?:^|\\s+)${body}$`, 'i'),
      whole: new RegExp(`^${body}$`, 'i'),
    };
  });
}

const DESCRIPTOR_MATCHERS: readonly TokenMatchers[] = buildTokenMatchers(GENERIC_DESCRIPTOR_TOKENS);
const COLUMN_LABEL_MATCHERS: readonly TokenMatchers[] = buildTokenMatchers(COLUMN_LABEL_TOKENS);
const SECTION_HEADER_MATCHERS: readonly TokenMatchers[] = buildTokenMatchers(SECTION_PANEL_HEADER_TOKENS);

/** All whole-line label/header matchers (used by `isNoiseRow`). */
const WHOLE_LINE_LABEL_MATCHERS: readonly TokenMatchers[] = [
  ...DESCRIPTOR_MATCHERS,
  ...COLUMN_LABEL_MATCHERS,
  ...SECTION_HEADER_MATCHERS,
];

/**
 * Checks if a given row text contains noise.
 * Returns true if the text matches address fragments, contact details,
 * report metadata, disclaimers, OR is a standalone generic descriptor /
 * column label / section header line.
 */
export function isNoiseRow(text: string): boolean {
  if (!text) return false;

  const normalized = text.trim();

  // Standalone generic descriptor / column label / section header line.
  if (isGenericDescriptorOrLabelLine(normalized)) return true;

  // Check Address
  for (const regex of ADDRESS_KEYWORDS) {
    if (regex.test(normalized)) return true;
  }

  // Check Contact Info
  for (const regex of CONTACT_KEYWORDS) {
    if (regex.test(normalized)) return true;
  }

  // Check Report Metadata
  for (const regex of METADATA_KEYWORDS) {
    if (regex.test(normalized)) return true;
  }

  // Check Boilerplate
  for (const regex of BOILERPLATE_KEYWORDS) {
    if (regex.test(normalized)) return true;
  }

  // Check Methodology / Technology phrase boilerplate.
  for (const regex of METHODOLOGY_TECHNOLOGY_BOILERPLATE) {
    if (regex.test(normalized)) return true;
  }

  return false;
}

/**
 * True iff the (trimmed) line is *entirely* a generic assay descriptor, a
 * column-label header, or a section/panel header — e.g. standalone "Calculated",
 * "UNITS", "VALUE", "RENAL", "LIPID", "Flow Cytometry", "TECHNOLOGY".
 *
 * Used by the Row_Detector to drop such lines before they can seed or join a
 * multi-line merge. Whole-line matching is intentional: a real test row such
 * as "UNITS 25-OH VITAMIN D (TOTAL)" does NOT match (it carries extra content)
 * and is instead cleaned by {@link extractMeaningfulTestName}.
 */
export function isGenericDescriptorOrLabelLine(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  return WHOLE_LINE_LABEL_MATCHERS.some((m) => m.whole.test(trimmed));
}

/**
 * True iff the (trimmed) token is exactly a generic assay descriptor such as
 * "Calculated", "Flow Cytometry", "TECHNOLOGY", or "METHODOLOGY". Used by the
 * Field_Extractor / Orchestrator to reject a residual test name that is just a
 * descriptor with no real analyte behind it.
 */
export function isGenericDescriptorToken(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  return DESCRIPTOR_MATCHERS.some((m) => m.whole.test(trimmed));
}

/**
 * Strip leading column-label prefixes and leading/trailing generic assay
 * descriptors from a raw test name, returning the meaningful analyte name.
 *
 * Examples:
 *   "UNITS 25-OH VITAMIN D (TOTAL)"   →  "25-OH VITAMIN D (TOTAL)"
 *   "TC/ HDL CHOLESTEROL RATIO CALCULATED" → "TC/ HDL CHOLESTEROL RATIO"
 *   "Flow Cytometry CD4"              →  "CD4"
 *   "Calculated"                       →  ""   (nothing meaningful remains)
 *
 * Iterates to a fixpoint so repeated prefixes/suffixes are all removed. The
 * function is pure and deterministic: same input ⇒ same output.
 *
 * NOTE: section/panel headers (RENAL, LIPID, THYROID, …) are intentionally
 * NOT stripped here, to avoid corrupting real analyte names such as
 * "THYROID STIMULATING HORMONE". Standalone header lines are handled upstream
 * by {@link isNoiseRow}.
 *
 * @returns The cleaned test name, or an empty string when nothing meaningful
 *          remains (the caller should then treat the row as ambiguous).
 */
export function extractMeaningfulTestName(rawName: string): string {
  let name = rawName.trim().replace(/\s{2,}/g, ' ');
  if (name.length === 0) return '';

  // Leading matchers: column labels + descriptors (NOT section headers).
  const leadMatchers: readonly TokenMatchers[] = [
    ...COLUMN_LABEL_MATCHERS,
    ...DESCRIPTOR_MATCHERS,
  ];
  // Trailing matchers: descriptors only (column labels never trail a test name).
  const trailMatchers: readonly TokenMatchers[] = DESCRIPTOR_MATCHERS;

  // ── Embedded-descriptor merge-leak repair ───────────────────────────────────
  // When the row-detector merges a test-name line with the following line's
  // descriptor + value/range, the result looks like
  //   "TRIG / HDL RATIO CALCULATED< 3.12Ratio"
  //   "LDL / HDL RATIO CALCULATED 1.5-3.5Ratio"
  // i.e. a descriptor token glued to (or immediately followed by) a comparison
  // operator or numeric range that belongs to the *next* row. A genuine analyte
  // name never contains such a pattern, so we truncate the name at the first
  // descriptor token that is followed (with no gap or a single space) by a
  // value/operator/range fragment. This runs before the lead/trail loop so the
  // residual real name (e.g. "TRIG / HDL RATIO") is returned cleanly.
  name = stripEmbeddedDescriptorLeak(name);

  let changed = true;
  while (changed) {
    changed = false;

    // Strip a leading column-label or descriptor token.
    for (const m of leadMatchers) {
      if (m.lead.test(name)) {
        name = name.replace(m.lead, '').trim().replace(/\s{2,}/g, ' ');
        changed = true;
        break;
      }
    }
    if (changed) continue;

    // Strip a trailing descriptor token.
    for (const m of trailMatchers) {
      if (m.trail.test(name)) {
        name = name.replace(m.trail, '').trim().replace(/\s{2,}/g, ' ');
        changed = true;
        break;
      }
    }
  }

  return name;
}

/**
 * Truncate `name` at the first generic descriptor token that appears *after*
 * the leading position — the signature of a merge leak where the following
 * row's descriptor (+ optional value/range) got glued onto this row's test
 * name (e.g. "TRIG / HDL RATIO CALCULATED< 3.12Ratio",
 * "UREA (CALCULATED) CALCULATEDAdult : 17-43mg/dL").
 *
 * Generic descriptor tokens (Calculated, Technology, Methodology, Flow
 * Cytometry, …) are never part of a genuine biomarker name, so any embedded
 * occurrence can be safely treated as the start of leaked boilerplate. The
 * leading position is handled by the caller's lead-stripping loop, so this
 * function only fires for mid-name occurrences.
 *
 * Pure and deterministic.
 */
function stripEmbeddedDescriptorLeak(name: string): string {
  const alt = GENERIC_DESCRIPTOR_TOKENS.map((tok) =>
    tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'),
  ).join('|');
  // Match a descriptor token that is NOT at the very start of the name: it must
  // be preceded by at least one character (a space, "(", or any name char).
  // Capture the prefix so we can return everything before the descriptor.
  const m = new RegExp(`^(.+?(?:\\s|\\())(?:${alt})\\b`, 'i').exec(name);
  if (m === null) return name;
  return m[1]!.replace(/[\s(]+$/, '').trim().replace(/\s{2,}/g, ' ');
}
