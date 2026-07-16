/**
 * src/lib/layout/ontology-mapper.ts
 *
 * Phase 8 — Ontology mapper (analyte name normalization).
 *
 * Maps raw analyte names (and their common synonyms/abbreviations) to a
 * canonical name. This runs AFTER row reconstruction and candidate building,
 * so it can never mask layout engine fidelity issues.
 *
 * The mapper annotates `LayoutCandidateRow.canonicalTestName` and
 * `LayoutCandidateRow.rawTestName` without mutating the `text` field, so
 * the original text remains available for evidence tracing and debugging.
 *
 * The synonym dictionary is organized as:
 *   canonical name → array of synonyms/abbreviations (all lowercase).
 *
 * Pure: same input → same output. No I/O, no shared state.
 */

import type { LayoutCandidateRow } from './types.js';

// ─── Synonym dictionary ────────────────────────────────────────────────────────

/**
 * Maps canonical analyte name → lowercase synonyms/abbreviations.
 * All lookups are case-insensitive.
 */
const SYNONYM_MAP: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
  // ── Haematology ──────────────────────────────────────────────────────────
  ['Hemoglobin', ['hb', 'hgb', 'haemoglobin', 'hemoglobin', 'haemoglobin (hb)']],
  ['Hematocrit', ['hct', 'pcv', 'packed cell volume', 'haematocrit']],
  ['Red Blood Cells', ['rbc', 'red blood cell count', 'erythrocytes', 'rbc count']],
  ['White Blood Cells', ['wbc', 'white blood cell count', 'leukocytes', 'total leukocyte count', 'tlc', 'wbc count']],
  ['Platelets', ['plt', 'platelet count', 'thrombocytes', 'platelet']],
  ['Mean Corpuscular Volume', ['mcv', 'mean cell volume']],
  ['Mean Corpuscular Hemoglobin', ['mch', 'mean cell haemoglobin', 'mean cell hemoglobin']],
  ['Mean Corpuscular Hemoglobin Concentration', ['mchc', 'mean cell haemoglobin concentration']],
  ['Red Cell Distribution Width', ['rdw', 'rdw-cv', 'rdw-sd', 'red cell distribution width - cv']],
  ['Neutrophils', ['neutrophil', 'polymorphs', 'poly', 'pmn', 'neut']],
  ['Lymphocytes', ['lymphocyte', 'lymph']],
  ['Monocytes', ['monocyte', 'mono']],
  ['Eosinophils', ['eosinophil', 'eos', 'eosino']],
  ['Basophils', ['basophil', 'baso']],
  ['Absolute Neutrophil Count', ['anc', 'absolute neutrophils', 'neutrophil (absolute)']],
  ['Absolute Lymphocyte Count', ['alc', 'absolute lymphocytes', 'lymphocyte (absolute)']],
  ['Absolute Monocyte Count', ['amc', 'absolute monocytes', 'monocyte (absolute)']],
  ['Absolute Eosinophil Count', ['aec', 'absolute eosinophils', 'eosinophil (absolute)']],
  ['Absolute Basophil Count', ['abc', 'absolute basophils', 'basophil (absolute)']],
  ['Immature Granulocytes', ['ig', 'immature gran']],
  // ── Biochemistry / Metabolic ──────────────────────────────────────────────
  ['Glucose (Fasting)', ['fbs', 'fasting blood sugar', 'fasting glucose', 'glucose fasting']],
  ['Glucose (Random)', ['rbs', 'random blood sugar', 'random glucose', 'glucose random']],
  ['HbA1c', ['hba1c', 'glycated hemoglobin', 'glycosylated hemoglobin', 'hemoglobin a1c', 'haemoglobin a1c', 'a1c']],
  ['Blood Urea Nitrogen', ['bun', 'blood urea nitrogen', 'urea nitrogen']],
  ['Urea', ['serum urea', 'blood urea', 'urea (serum)']],
  ['Creatinine', ['serum creatinine', 'creatinine (serum)', 's.creatinine', 'sr.creatinine']],
  ['eGFR', ['egfr', 'estimated gfr', 'glomerular filtration rate', 'estimated glomerular filtration rate']],
  ['Uric Acid', ['uric acid (serum)', 's.uric acid', 'serum uric acid']],
  // ── Lipid profile ─────────────────────────────────────────────────────────
  ['Total Cholesterol', ['cholesterol', 'serum cholesterol', 'total cholesterol (serum)', 's. cholesterol']],
  ['HDL Cholesterol', ['hdl', 'hdl-c', 'high density lipoprotein', 'hdl cholesterol']],
  ['LDL Cholesterol', ['ldl', 'ldl-c', 'low density lipoprotein', 'ldl cholesterol']],
  ['VLDL Cholesterol', ['vldl', 'vldl-c', 'very low density lipoprotein']],
  ['Triglycerides', ['tg', 'triglyceride', 'serum triglycerides', 's. triglycerides']],
  ['Cholesterol/HDL Ratio', ['chol/hdl ratio', 'tc/hdl ratio', 'total cholesterol / hdl cholesterol ratio']],
  ['LDL/HDL Ratio', ['ldl/hdl ratio']],
  ['Non-HDL Cholesterol', ['non hdl cholesterol', 'non-hdl']],
  // ── Liver function ────────────────────────────────────────────────────────
  ['Total Bilirubin', ['t.bilirubin', 'bilirubin total', 'serum bilirubin total']],
  ['Direct Bilirubin', ['d.bilirubin', 'bilirubin direct', 'conjugated bilirubin']],
  ['Indirect Bilirubin', ['i.bilirubin', 'bilirubin indirect', 'unconjugated bilirubin']],
  ['AST', ['sgot', 'aspartate aminotransferase', 'aspartate transaminase', 'ast/sgot']],
  ['ALT', ['sgpt', 'alanine aminotransferase', 'alanine transaminase', 'alt/sgpt']],
  ['Alkaline Phosphatase', ['alp', 'alk. phosphatase', 'serum alp', 'alkaline phosphatase (alp)']],
  ['GGT', ['ggt', 'gamma gt', 'gamma glutamyl transferase', 'γ-gt', 'gamma-glutamyl transpeptidase']],
  ['Total Protein', ['serum total protein', 'protein total']],
  ['Albumin', ['serum albumin', 's. albumin']],
  ['Globulin', ['serum globulin']],
  ['A/G Ratio', ['albumin/globulin ratio', 'a:g ratio']],
  // ── Thyroid ───────────────────────────────────────────────────────────────
  ['TSH', ['thyroid stimulating hormone', 'thyrotropin', 'tsh (ultrasensitive)', 'tsh 3rd generation']],
  ['T3', ['triiodothyronine', 'total t3', 't3 (total)']],
  ['T4', ['thyroxine', 'total t4', 't4 (total)']],
  ['Free T3', ['ft3', 'free triiodothyronine']],
  ['Free T4', ['ft4', 'free thyroxine']],
  // ── Vitamins / Minerals ───────────────────────────────────────────────────
  ['Vitamin D', ['25-oh vitamin d', 'vitamin d (25-oh)', '25-hydroxyvitamin d', '25 oh vitamin d', 'vitamin d total', 'vit d']],
  ['Vitamin B12', ['cobalamin', 'cyanocobalamin', 'vitamin b12 (cyanocobalamin)', 'vit b12']],
  ['Folate', ['folic acid', 'vitamin b9', 'vit b9']],
  ['Iron', ['serum iron', 's.iron', 'iron (serum)']],
  ['Ferritin', ['serum ferritin', 'ferritin (serum)']],
  ['TIBC', ['total iron binding capacity', 'tibc']],
  ['Calcium', ['serum calcium', 's. calcium', 'calcium (total)']],
  ['Magnesium', ['serum magnesium', 's. magnesium']],
  ['Phosphorus', ['phosphate', 'serum phosphorus', 'inorganic phosphorus']],
  ['Sodium', ['serum sodium', 's. sodium', 'na+']],
  ['Potassium', ['serum potassium', 's. potassium', 'k+']],
  ['Chloride', ['serum chloride', 's. chloride', 'cl-']],
  // ── Cardiac ───────────────────────────────────────────────────────────────
  ['hs-CRP', ['high sensitivity crp', 'hscrp', 'hs crp', 'c-reactive protein (high sensitivity)', 'crp (high sensitivity)']],
  ['CRP', ['c-reactive protein', 'c reactive protein']],
  ['Lipoprotein(a)', ['lp(a)', 'lipoprotein a']],
  ['Apolipoprotein A1', ['apo a1', 'apolipoprotein a-i']],
  ['Apolipoprotein B', ['apo b', 'apolipoprotein b-100']],
  ['Homocysteine', ['hcy', 'plasma homocysteine', 'serum homocysteine']],
  // ── Hormones ──────────────────────────────────────────────────────────────
  ['Insulin', ['serum insulin', 'fasting insulin']],
  ['Cortisol', ['serum cortisol', 'cortisol (morning)']],
  ['Testosterone', ['total testosterone', 'testosterone (total)']],
  ['PSA', ['prostate specific antigen', 'psa (total)', 'total psa']],
  // ── Urine ─────────────────────────────────────────────────────────────────
  ['Urine Protein', ['urine protein (random)', 'spot urine protein', 'urinary protein']],
  ['Microalbumin', ['urine microalbumin', 'microalbuminuria', 'albumin (urine)']],
  ['Urine Creatinine', ['urine creatinine (random)']],
]);

// ─── Reverse lookup (synonym → canonical) ─────────────────────────────────────

const LOOKUP: Map<string, string> = new Map();
for (const [canonical, synonyms] of SYNONYM_MAP) {
  // The canonical name itself should also resolve to itself.
  LOOKUP.set(canonical.toLowerCase(), canonical);
  for (const syn of synonyms) {
    LOOKUP.set(syn.toLowerCase(), canonical);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Annotate an array of LayoutCandidateRows with canonical test names.
 * Mutates `canonicalTestName` and `rawTestName` on matched rows.
 * Never modifies the `text` field.
 *
 * @param candidates - The candidates produced by candidate-builder.ts.
 * @returns           The same array (mutated in place) for chaining.
 */
export function annotateCanonicalNames(
  candidates: LayoutCandidateRow[],
): LayoutCandidateRow[] {
  for (const candidate of candidates) {
    const rawName = extractTestName(candidate.text);
    if (!rawName) continue;

    const canonical = resolveCanonical(rawName);
    if (canonical) {
      candidate.rawTestName = rawName;
      candidate.canonicalTestName = canonical;
    }
  }
  return candidates;
}

/**
 * Resolve a raw test name string to its canonical form.
 * Returns undefined if no mapping is found.
 */
export function resolveCanonical(rawName: string): string | undefined {
  const lower = rawName.trim().toLowerCase();
  if (lower.length === 0) return undefined;

  // Exact match first.
  if (LOOKUP.has(lower)) return LOOKUP.get(lower);

  // Prefix match: try progressively shorter substrings (handles trailing units/annotations).
  // E.g. "Hemoglobin (HB) 14.5 g/dL" → strip right side tokens.
  const words = lower.split(/\s+/);
  for (let len = words.length - 1; len >= 1; len--) {
    const prefix = words.slice(0, len).join(' ');
    if (LOOKUP.has(prefix)) return LOOKUP.get(prefix);
  }

  return undefined;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Extract the test name portion from a reconstructed line.
 * For layout-reconstructed lines, the test name appears before the first
 * numeric token. For plain lines, returns the whole string (the ontology
 * mapper will try prefix matching).
 */
function extractTestName(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  // Split at first numeric token (handles "HbA1c 5.4 % 4.0-5.7").
  const match = /^([A-Za-z][^<>0-9\n]*)(?=[\d<>≤≥])/.exec(trimmed);
  if (match) {
    return match[1].trim();
  }

  // If no numeric token found, try returning the whole string (may be a section header).
  return trimmed;
}
