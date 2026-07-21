/**
 * src/lib/semantic/ontology.ts
 *
 * Phase 9 — Medical ontology for semantic normalization.
 *
 * Provides:
 *  1. ANALYTE_SYNONYM_MAP  — canonical analyte name → known synonyms/variants.
 *     (Extended from the Phase 8 layout-level ontology in ontology-mapper.ts,
 *     which only annotates LayoutCandidateRows at extraction time. This version
 *     operates on post-extraction LabEntry.testName strings.)
 *
 *  2. resolveCanonicalAnalyte(name) — resolve a raw test name to its canonical
 *     form; returns undefined when no mapping exists.
 *
 *  3. KNOWN_MEDICAL_CATEGORIES — set of lower-cased medical panel/section
 *     names that are considered real clinical categories.
 *
 *  4. NOISE_CATEGORY_PATTERNS — patterns that identify non-medical section
 *     headings (marketing copy, roadmap, boilerplate).
 *
 *  5. PSEUDO_SECTION_PATTERNS — patterns that identify headings which look
 *     like sections but are package/product names, not medical panels.
 *
 * All data structures are deterministic and testable: same input → same output.
 * No I/O, no shared mutable state.
 */

// ─── 1. Canonical analyte synonym map ─────────────────────────────────────────

/**
 * Maps canonical analyte name → lowercase synonyms/abbreviations.
 *
 * Convention:
 *  - Keys are Title Case canonical names.
 *  - Values are lowercase variants (the canonical name itself does not need
 *    to appear in the value array; the lookup map adds it automatically).
 *  - Synonyms should be as specific as possible to avoid false positives.
 *
 * NOTE: Keep in sync with the Phase 8 layout-level SYNONYM_MAP in
 * src/lib/layout/ontology-mapper.ts when adding new entries here.
 * The two maps serve different pipeline layers and may legitimately differ
 * in coverage, but should not contradict each other.
 */
export const ANALYTE_SYNONYM_MAP: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
  // ── Haematology ──────────────────────────────────────────────────────────
  ['Hemoglobin',                             ['hb', 'hgb', 'haemoglobin', 'hemoglobin', 'haemoglobin (hb)', 'hgb (hemoglobin)']],
  ['Hematocrit',                             ['hct', 'pcv', 'packed cell volume', 'haematocrit']],
  ['Red Blood Cells',                        ['rbc', 'red blood cell count', 'erythrocytes', 'rbc count', 'red cell count']],
  ['White Blood Cells',                      ['wbc', 'white blood cell count', 'leukocytes', 'total leukocyte count', 'tlc', 'wbc count', 'total wbc count']],
  ['Platelets',                              ['plt', 'platelet count', 'thrombocytes', 'platelet', 'platelts']],
  ['Mean Corpuscular Volume',                ['mcv', 'mean cell volume']],
  ['Mean Corpuscular Hemoglobin',            ['mch', 'mean cell haemoglobin', 'mean cell hemoglobin']],
  ['Mean Corpuscular Hemoglobin Concentration', ['mchc', 'mean cell haemoglobin concentration', 'mean corpuscular hb concentration']],
  ['Red Cell Distribution Width',            ['rdw', 'rdw-cv', 'rdw-sd', 'red cell distribution width - cv', 'rdw cv', 'rdw sd', 'red cell distribution']],
  ['Neutrophils',                            ['neutrophil', 'polymorphs', 'poly', 'pmn', 'neut', 'neutrophils %', 'neutrophils percent', 'neutrophils.']],
  ['Neutrophil Percentage',                  ['neutrophils (%)', 'neutrophil (%)', '% neutrophils']],
  ['Lymphocytes',                            ['lymphocyte', 'lymph', 'lymphocytes %', 'lymphocytes percent', 'lymphocytes.']],
  ['Lymphocyte Percentage',                  ['lymphocytes (%)', 'lymphocyte (%)', '% lymphocytes']],
  ['Monocytes',                              ['monocyte', 'mono', 'monocytes %', 'monocytes.']],
  ['Monocyte Percentage',                    ['monocytes (%)', 'monocyte (%)', '% monocytes']],
  ['Eosinophils',                            ['eosinophil', 'eos', 'eosino', 'eosinophils %', 'eosinophils.']],
  ['Eosinophil Percentage',                  ['eosinophils (%)', 'eosinophil (%)', '% eosinophils']],
  ['Basophils',                              ['basophil', 'baso', 'basophils %', 'basophils.']],
  ['Basophil Percentage',                    ['basophils (%)', 'basophil (%)', '% basophils']],
  ['Absolute Neutrophil Count',              ['anc', 'absolute neutrophils', 'neutrophil (absolute)', 'neutrophil absolute']],
  ['Absolute Lymphocyte Count',              ['alc', 'absolute lymphocytes', 'lymphocyte (absolute)', 'lymphocyte absolute']],
  ['Absolute Monocyte Count',               ['amc', 'absolute monocytes', 'monocyte (absolute)', 'monocyte absolute']],
  ['Absolute Eosinophil Count',             ['aec', 'absolute eosinophils', 'eosinophil (absolute)', 'eosinophil absolute']],
  ['Absolute Basophil Count',               ['abc', 'absolute basophils', 'basophil (absolute)', 'basophil absolute']],
  ['Immature Granulocytes',                 ['ig', 'immature gran', 'immature granulocyte count']],
  ['Mean Platelet Volume',                  ['mpv', 'mean platelet v']],
  ['Platelet Distribution Width',           ['pdw']],
  ['Platelet Large Cell Ratio',             ['p-lcr', 'platelet large cell ratio', 'plcr']],
  ['Platelet Large Cell Count',             ['p-lcc', 'platelet large cell count', 'plcc']],
  ['Plateletcrit',                          ['pct', 'plateletcrit (pct)']],
  ['Nucleated Red Blood Cells',             ['nrbc', 'nrbc count']],
  // ── Biochemistry / Metabolic ──────────────────────────────────────────────
  ['Glucose (Fasting)',                      ['fbs', 'fasting blood sugar', 'fasting glucose', 'glucose fasting', 'glucose (f)', 'blood glucose (fasting)']],
  ['Glucose (Random)',                       ['rbs', 'random blood sugar', 'random glucose', 'glucose random', 'glucose (r)']],
  ['Glucose (Post Prandial)',                ['pp blood sugar', 'ppbs', 'post prandial glucose', 'glucose (pp)', 'blood glucose (pp)']],
  ['HbA1c',                                 ['hba1c', 'glycated hemoglobin', 'glycosylated hemoglobin', 'hemoglobin a1c', 'haemoglobin a1c', 'a1c', 'glycohaemoglobin', 'glycohemoglobin']],
  ['Estimated Average Glucose',             ['eag', 'estimated average glucose (eag)', 'estimated']],
  ['Blood Urea Nitrogen',                   ['bun', 'urea nitrogen', 'blood urea nitrogen (bun)']],
  ['Urea',                                  ['serum urea', 'blood urea', 'urea (serum)', 's. urea']],
  ['Creatinine',                            ['serum creatinine', 'creatinine (serum)', 's.creatinine', 'sr.creatinine', 'creatinine serum']],
  ['eGFR',                                  ['egfr', 'estimated gfr', 'glomerular filtration rate', 'estimated glomerular filtration rate', 'gfr (estimated)']],
  ['BUN/Creatinine Ratio',                  ['bun/creatinine ratio', 'blood urea nitrogen / creatinine ratio']],
  ['Uric Acid',                             ['uric acid (serum)', 's.uric acid', 'serum uric acid', 'uric acid serum']],
  ['Cystatin C',                            ['serum cystatin c']],
  // ── Lipid profile ─────────────────────────────────────────────────────────
  ['Total Cholesterol',                     ['cholesterol', 'serum cholesterol', 'total cholesterol (serum)', 's. cholesterol', 'cholesterol total']],
  ['HDL Cholesterol',                       ['hdl', 'hdl-c', 'high density lipoprotein', 'hdl cholesterol', 'hdl-cholesterol']],
  ['LDL Cholesterol',                       ['ldl', 'ldl-c', 'low density lipoprotein', 'ldl cholesterol', 'ldl-cholesterol', 'low density lipoprotein cholesterol']],
  ['VLDL Cholesterol',                      ['vldl', 'vldl-c', 'very low density lipoprotein', 'vldl cholesterol', 'v.l.d.l cholesterol']],
  ['Triglycerides',                         ['tg', 'triglyceride', 'serum triglycerides', 's. triglycerides', 'trig', 'trigs']],
  ['Cholesterol/HDL Ratio',                 ['chol/hdl ratio', 'tc/hdl ratio', 'total cholesterol / hdl cholesterol ratio', 'cholesterol hdl ratio', 'chol/hdl']],
  ['LDL/HDL Ratio',                         ['ldl/hdl ratio', 'ldl hdl ratio', 'ldl/hdl']],
  ['HDL/LDL Ratio',                         ['hdl/ldl ratio', 'hdl ldl ratio', 'hdl/ldl', 'hdl/ ldl ratio', 'hdl/ ldl']],
  ['TRIG/HDL Ratio',                        ['trig/hdl ratio', 'trig hdl ratio', 'triglycerides/hdl ratio', 'trig/hdl']],
  ['Non-HDL Cholesterol',                   ['non hdl cholesterol', 'non-hdl', 'non hdl-c', 'non hdl']],
  ['Apolipoprotein A1',                     ['apo a1', 'apolipoprotein a-i', 'apo a-i']],
  ['Apolipoprotein B',                      ['apo b', 'apolipoprotein b-100', 'apo b-100']],
  ['Lipoprotein(a)',                         ['lp(a)', 'lipoprotein a', 'lp (a)']],
  // ── Liver function ────────────────────────────────────────────────────────
  ['Total Bilirubin',                       ['t.bilirubin', 'bilirubin total', 'serum bilirubin total', 'bilirubin (total)', 'bilirubin']],
  ['Direct Bilirubin',                      ['d.bilirubin', 'bilirubin direct', 'conjugated bilirubin', 'bilirubin (direct)']],
  ['Indirect Bilirubin',                    ['i.bilirubin', 'bilirubin indirect', 'unconjugated bilirubin', 'bilirubin (indirect)']],
  ['AST',                                   ['sgot', 'aspartate aminotransferase', 'aspartate transaminase', 'ast/sgot', 'ast (sgot)']],
  ['ALT',                                   ['sgpt', 'alanine aminotransferase', 'alanine transaminase', 'alt/sgpt', 'alt (sgpt)', 'sgpt/alt', 'sgpt/al']],
  ['AST/ALT Ratio',                         ['ast/alt ratio', 'sgot/sgpt ratio', 'ast/alt', 'sgot/sgpt']],
  ['Alkaline Phosphatase',                  ['alp', 'alk. phosphatase', 'serum alp', 'alkaline phosphatase (alp)', 'alk phosphatase']],
  ['GGT',                                   ['ggt', 'gamma gt', 'gamma glutamyl transferase', 'γ-gt', 'gamma-glutamyl transpeptidase', 'ggtp', 'gamma glutamyl']],
  ['Total Protein',                         ['serum total protein', 'protein total', 'total protein (serum)']],
  ['Albumin',                               ['serum albumin', 's. albumin', 'albumin (serum)']],
  ['Globulin',                              ['serum globulin', 'globulin (serum)']],
  ['A/G Ratio',                             ['albumin/globulin ratio', 'a:g ratio', 'alb/glob ratio']],
  ['Prothrombin Time',                      ['pt', 'pt (prothrombin time)']],
  ['INR',                                   ['pt inr', 'inr (pt)']],
  // ── Thyroid ───────────────────────────────────────────────────────────────
  ['TSH',                                   ['thyroid stimulating hormone', 'thyrotropin', 'tsh (ultrasensitive)', 'tsh 3rd generation', 'tsh ultrasensitive']],
  ['T3',                                    ['triiodothyronine', 'total t3', 't3 (total)', 'triiodothyronine (total)', 'total triiodothyronine (t3)']],
  ['T4',                                    ['thyroxine', 'total t4', 't4 (total)', 'thyroxine (total)', 'total thyroxine (t4)']],
  ['Free T3',                               ['ft3', 'free triiodothyronine', 'free t3 (ft3)']],
  ['Free T4',                               ['ft4', 'free thyroxine', 'free t4 (ft4)']],
  // ── Vitamins / Minerals ───────────────────────────────────────────────────
  ['Vitamin D',                             ['25-oh vitamin d', 'vitamin d (25-oh)', '25-hydroxyvitamin d', '25 oh vitamin d', 'vitamin d total', 'vit d', '25(oh) vitamin d', '25 oh vit d', 'vitamin d (25-oh) total']],
  ['Vitamin B12',                           ['cobalamin', 'cyanocobalamin', 'vitamin b12 (cyanocobalamin)', 'vit b12', 'b12', 'vitamin b-12', 'vitamin - b12 pg/ml']],
  ['Folate',                                ['folic acid', 'vitamin b9', 'vit b9', 'serum folate']],
  ['Iron',                                  ['serum iron', 's.iron', 'iron (serum)', 'fe (serum)']],
  ['Ferritin',                              ['serum ferritin', 'ferritin (serum)', 's. ferritin']],
  ['TIBC',                                  ['total iron binding capacity', 'tibc (total iron binding capacity)']],
  ['Transferrin Saturation',                ['transferrin sat', 'iron saturation', 'transferrin saturation (%)']],
  ['Calcium',                               ['serum calcium', 's. calcium', 'calcium (total)', 'calcium total']],
  ['Ionized Calcium',                       ['calcium (ionized)', 'ionised calcium']],
  ['Magnesium',                             ['serum magnesium', 's. magnesium', 'magnesium (serum)']],
  ['Phosphorus',                            ['phosphate', 'serum phosphorus', 'inorganic phosphorus', 'phosphorus (serum)']],
  ['Sodium',                                ['serum sodium', 's. sodium', 'na+', 'sodium (serum)']],
  ['Potassium',                             ['serum potassium', 's. potassium', 'k+', 'potassium (serum)']],
  ['Chloride',                              ['serum chloride', 's. chloride', 'cl-', 'chloride (serum)']],
  ['Bicarbonate',                           ['hco3', 'serum bicarbonate', 'hco3-']],
  ['Zinc',                                  ['serum zinc', 'zinc (serum)']],
  ['Copper',                                ['serum copper']],
  // ── Cardiac ───────────────────────────────────────────────────────────────
  ['hs-CRP',                                ['high sensitivity crp', 'hscrp', 'hs crp', 'c-reactive protein (high sensitivity)', 'crp (high sensitivity)', 'hs-crp', 'high sensitive crp']],
  ['CRP',                                   ['c-reactive protein', 'c reactive protein', 'crp (quantitative)']],
  ['Homocysteine',                          ['hcy', 'plasma homocysteine', 'serum homocysteine', 'total homocysteine']],
  ['Troponin I',                            ['cardiac troponin i', 'ctni', 'troponin-i']],
  ['Troponin T',                            ['cardiac troponin t', 'ctnt', 'troponin-t']],
  ['NT-proBNP',                             ['nt-probnp', 'n-terminal pro-bnp', 'n terminal probnp']],
  ['BNP',                                   ['brain natriuretic peptide', 'b-type natriuretic peptide']],
  // ── Hormones ──────────────────────────────────────────────────────────────
  ['Insulin',                               ['serum insulin', 'fasting insulin', 'insulin (fasting)']],
  ['HOMA-IR',                               ['homa ir', 'insulin resistance (homa-ir)']],
  ['Cortisol',                              ['serum cortisol', 'cortisol (morning)', 'morning cortisol']],
  ['Testosterone',                          ['total testosterone', 'testosterone (total)', 'serum testosterone']],
  ['Free Testosterone',                     ['free testosterone (calculated)']],
  ['Estradiol',                             ['e2', 'oestradiol', '17-beta estradiol']],
  ['LH',                                    ['luteinizing hormone', 'luteinising hormone', 'lutenizing hormone']],
  ['FSH',                                   ['follicle stimulating hormone', 'follicular stimulating hormone']],
  ['Prolactin',                             ['serum prolactin']],
  ['DHEA-S',                                ['dehydroepiandrosterone sulfate', 'dhea sulfate', 'dheas']],
  ['PSA',                                   ['prostate specific antigen', 'psa (total)', 'total psa', 'psa total']],
  ['Free PSA',                              ['free psa', 'free prostate specific antigen']],
  ['AFP',                                   ['alpha fetoprotein', 'alpha-fetoprotein', 'serum afp']],
  ['CEA',                                   ['carcinoembryonic antigen']],
  ['CA-125',                                ['ca 125', 'cancer antigen 125', 'ovarian cancer antigen']],
  ['CA 19-9',                               ['ca19-9', 'cancer antigen 19-9']],
  ['Beta HCG',                              ['beta-hcg', 'human chorionic gonadotropin', 'total bhcg', 'serum beta hcg']],
  // ── Urine routine ─────────────────────────────────────────────────────────
  ['Urine Protein',                         ['urine protein (random)', 'spot urine protein', 'urinary protein', 'protein (urine)']],
  ['Microalbumin',                          ['urine microalbumin', 'microalbuminuria', 'albumin (urine)', 'urine albumin']],
  ['Urine Creatinine',                      ['urine creatinine (random)', 'creatinine (urine)']],
  ['Urine Glucose',                         ['glucose (urine)', 'urine sugar']],
  ['Urine pH',                              ['ph (urine)', 'urine reaction']],
  // ── Infection / Inflammatory ───────────────────────────────────────────────
  ['ESR',                                   ['erythrocyte sedimentation rate', 'westergren method', 'esr (westergren)']],
  ['Procalcitonin',                         ['pct (procalcitonin)', 'serum procalcitonin']],
  ['LDH',                                   ['lactate dehydrogenase', 'serum ldh']],
  ['D-Dimer',                               ['d dimer', 'd-dimer (quantitative)']],
  ['Fibrinogen',                            ['plasma fibrinogen']],
]);

// ─── Reverse lookup (synonym → canonical) ─────────────────────────────────────

function _normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s*\(/g, ' (').replace(/\s+/g, ' ').trim();
}

const _LOOKUP: Map<string, string> = new Map();
for (const [canonical, synonyms] of ANALYTE_SYNONYM_MAP) {
  _LOOKUP.set(_normalize(canonical), canonical);
  for (const syn of synonyms) {
    _LOOKUP.set(_normalize(syn), canonical);
  }
}

/** Immutable view for consumers. */
export const ANALYTE_LOOKUP: ReadonlyMap<string, string> = _LOOKUP;

/**
 * Resolve a raw analyte name to its canonical form.
 *
 * Strategy:
 *  1. Exact match (case-insensitive).
 *  2. Progressive left-prefix match: try dropping rightmost tokens one at a
 *     time (handles trailing units / annotations still embedded in the name,
 *     e.g. "Hemoglobin (Hb) g/dL" → tries "hemoglobin (hb)", then "hemoglobin").
 *
 * Returns undefined when no canonical mapping is found.
 * Pure and deterministic: same input → same output.
 */
export function resolveCanonicalAnalyte(rawName: string): string | undefined {
  const lower = _normalize(rawName);
  if (lower.length === 0) return undefined;

  if (_LOOKUP.has(lower)) return _LOOKUP.get(lower);

  const words = lower.split(/\s+/);
  for (let len = words.length - 1; len >= 1; len--) {
    const prefix = words.slice(0, len).join(' ');
    if (_LOOKUP.has(prefix)) return _LOOKUP.get(prefix);
  }

  return undefined;
}

// ─── 2. True Category Mapping ───────────────────────────────────────────────────

/**
 * Maps a Canonical Analyte Name to its true Canonical Medical Category.
 * This is used during Semantic Normalization to forcefully re-assign analytes
 * that were either missed by the layout engine (falling into "Uncategorized")
 * or assigned to completely incorrect sections due to PDF structure errors.
 */
export const TRUE_CATEGORY_MAP: ReadonlyMap<string, string> = new Map([
  // Diabetes
  ['HbA1c', 'Diabetes'],
  ['Glucose (Fasting)', 'Diabetes'],
  ['Glucose (Random)', 'Diabetes'],
  ['Glucose (Post Prandial)', 'Diabetes'],
  ['Estimated Average Glucose', 'Diabetes'],

  // Lipid Profile
  ['Total Cholesterol', 'Lipid Profile'],
  ['HDL Cholesterol', 'Lipid Profile'],
  ['LDL Cholesterol', 'Lipid Profile'],
  ['VLDL Cholesterol', 'Lipid Profile'],
  ['Triglycerides', 'Lipid Profile'],
  ['Cholesterol/HDL Ratio', 'Lipid Profile'],
  ['LDL/HDL Ratio', 'Lipid Profile'],
  ['HDL/LDL Ratio', 'Lipid Profile'],
  ['TRIG/HDL Ratio', 'Lipid Profile'],
  ['Non-HDL Cholesterol', 'Lipid Profile'],

  // Renal Function
  ['Blood Urea Nitrogen', 'Renal Function Test'],
  ['Urea', 'Renal Function Test'],
  ['Creatinine', 'Renal Function Test'],
  ['eGFR', 'Renal Function Test'],
  ['BUN/Creatinine Ratio', 'Renal Function Test'],
  ['Uric Acid', 'Renal Function Test'],

  // Liver Function
  ['Total Bilirubin', 'Liver Function'],
  ['Direct Bilirubin', 'Liver Function'],
  ['Indirect Bilirubin', 'Liver Function'],
  ['AST', 'Liver Function'],
  ['ALT', 'Liver Function'],
  ['AST/ALT Ratio', 'Liver Function'],
  ['Alkaline Phosphatase', 'Liver Function'],
  ['GGT', 'Liver Function'],
  ['Total Protein', 'Liver Function'],
  ['Albumin', 'Liver Function'],
  ['Globulin', 'Liver Function'],
  ['A/G Ratio', 'Liver Function'],

  // Thyroid Function
  ['TSH', 'Thyroid Function'],
  ['T3', 'Thyroid Function'],
  ['T4', 'Thyroid Function'],
  ['Free T3', 'Thyroid Function'],
  ['Free T4', 'Thyroid Function'],

  // Complete Blood Count
  ['Hemoglobin', 'Complete Blood Count'],
  ['Hematocrit', 'Complete Blood Count'],
  ['Red Blood Cells', 'Complete Blood Count'],
  ['White Blood Cells', 'Complete Blood Count'],
  ['Platelets', 'Complete Blood Count'],
  ['Mean Corpuscular Volume', 'Complete Blood Count'],
  ['Mean Corpuscular Hemoglobin', 'Complete Blood Count'],
  ['Mean Platelet Volume', 'Complete Blood Count'],
  ['P-LCR', 'Complete Blood Count'],
  ['Mean Corpuscular Hemoglobin Concentration', 'Complete Blood Count'],
  ['Red Cell Distribution Width', 'Complete Blood Count'],
  ['Neutrophils', 'Complete Blood Count'],
  ['Lymphocytes', 'Complete Blood Count'],
  ['Monocytes', 'Complete Blood Count'],
  ['Eosinophils', 'Complete Blood Count'],
  ['Basophils', 'Complete Blood Count'],
  ['Absolute Neutrophil Count', 'Complete Blood Count'],
  ['Absolute Lymphocyte Count', 'Complete Blood Count'],
  ['Absolute Monocyte Count', 'Complete Blood Count'],
  ['Absolute Eosinophil Count', 'Complete Blood Count'],
  ['Absolute Basophil Count', 'Complete Blood Count'],
  ['Mean Platelet Volume', 'Complete Blood Count'],
  ['Platelet Distribution Width', 'Complete Blood Count'],
  ['Platelet Large Cell Ratio', 'Complete Blood Count'],
  ['Platelet Large Cell Count', 'Complete Blood Count'],
  ['Plateletcrit', 'Complete Blood Count'],
  ['Nucleated Red Blood Cells', 'Complete Blood Count'],
  ['Immature Granulocytes', 'Complete Blood Count'],

  // Vitamins & Minerals
  ['Vitamin D', 'Vitamins'],
  ['Vitamin B12', 'Vitamins'],
  ['Folate', 'Vitamins'],
  ['Calcium', 'Bone Health'],
  ['Ionized Calcium', 'Bone Health'],
  ['Phosphorus', 'Bone Health'],
  
  // Iron Profile
  ['Iron', 'Iron Profile'],
  ['Ferritin', 'Iron Profile'],
  ['TIBC', 'Iron Profile'],
  ['Transferrin Saturation', 'Iron Profile'],

  // Infection
  ['ESR', 'Infection Panel'],

  // Hormones
  ['Testosterone', 'Hormone Profile'],
  ['Free Testosterone', 'Hormone Profile'],
  ['Estradiol', 'Hormone Profile'],
  ['LH', 'Hormone Profile'],
  ['FSH', 'Hormone Profile'],
  ['Prolactin', 'Hormone Profile']
]);

// ─── 3. Known medical category names ──────────────────────────────────────────

/**
 * Set of lower-cased canonical medical panel/section names.
 * Any category that, after normalisation, matches one of these is classified
 * as `medical` by the section classifier.
 *
 * Title-case variants are also handled at lookup time by lower-casing.
 */
export const KNOWN_MEDICAL_CATEGORIES: ReadonlySet<string> = new Set([
  // Haematology
  'complete blood count',
  'cbc',
  'hemogram',
  'haemogram',
  'complete hemogram',
  'complete haemogram',
  'differential count',
  'differential leukocyte count',
  'dlc',
  'absolute count',
  // Biochemistry
  'biochemistry',
  'metabolic panel',
  'comprehensive metabolic panel',
  'basic metabolic panel',
  'renal function test',
  'renal function',
  'kidney function test',
  'kidney function',
  'rft',
  'kft',
  'liver function test',
  'liver function',
  'lft',
  'thyroid function test',
  'thyroid function',
  'tft',
  // Lipids
  'lipid profile',
  'lipid panel',
  'lipids',
  'cholesterol panel',
  // Vitamins / Minerals
  'vitamins',
  'minerals',
  'electrolytes',
  'serum electrolytes',
  'iron studies',
  'iron profile',
  'bone profile',
  // Hormones
  'hormones',
  'hormone panel',
  'thyroid panel',
  'reproductive hormones',
  'fertility panel',
  'adrenal panel',
  // Cardiac
  'cardiac panel',
  'cardiac markers',
  'cardiac risk markers',
  'heart markers',
  // Diabetes
  'diabetes panel',
  'diabetic profile',
  'glycemic panel',
  // Urine
  'urine routine',
  'urine r/m',
  'urine routine and microscopy',
  'urinalysis',
  'urine analysis',
  // Infection
  'infection panel',
  'inflammation markers',
  'inflammatory markers',
  'coagulation',
  'coagulation profile',
  // Generic
  'uncategorized',
]);

// ─── 3. Noise category patterns ────────────────────────────────────────────────

/**
 * Patterns that identify noise section headings — marketing copy, report
 * boilerplate, roadmap text, or promotional content that was incorrectly
 * promoted to a section heading by the layout engine or row-detector.
 *
 * Entries whose category matches these patterns are suppressed outright.
 */
export const NOISE_CATEGORY_PATTERNS: ReadonlyArray<RegExp> = [
  /^test\s+asked\b/i,
  /^tests?\s+package\b/i,
  /^hba\s+profile\b/i,
  /^package\s+details?\b/i,
  /^report\s+remarks?\b/i,
  /^note\s*:/i,
  /^important\s+note\b/i,
  /^disclaimer\b/i,
  /^test\s+summary\b/i,
  /^vitamins\s*&\s*$/i,
  /\bscan\s+qr\b/i,
  /\bdoctor'?s?\s+note\b/i,
  /^panel\s+name\b/i,
  /\blab\s+info(rmation)?\b/i,
  /^patient\s+information\b/i,
  /^sample\s+information\b/i,
  /\breference\s+lab\b/i,
  /^interpretation\s+guide\b/i,
];

// ─── 4. Pseudo section patterns ────────────────────────────────────────────────

/**
 * Patterns that identify pseudo-section headings — headings that look like
 * section titles but are product / package names, not real medical panels.
 *
 * Entries in pseudo-sections are moved to "Uncategorized" rather than being
 * suppressed, because they may still contain real analytes.
 */
export const PSEUDO_SECTION_PATTERNS: ReadonlyArray<RegExp> = [
  // Branded lab product / package names — their entries contain real analytes.
  /\baarogyam\b/i,               // "Aarogyam Pro", "Aarogyam Basic", "Aarogyam C"
  /\barogyam\b/i,                // common alternate spelling
  /\bpro\s*\d*\b/i,              // "Aarogyam Pro", "Pro 180", etc.
  /\bbasic\s*\d*\b/i,            // "Aarogyam Basic"
  /\badvanced\s*\d*\b/i,         // "Aarogyam Advanced"
  /\bcomprehensive\s*\d*\b/i,    // overly broad product names
  /^\d+\s+tests?\b/i,            // "180 Tests", "72 Tests"
  /\bcheck[\s-]?up\b/i,          // "Full Body Checkup"
  /\bfull\s+body\b/i,
  /\bwellness\s+(package|profile|plan)\b/i,
  /\bmaster\s+health\b/i,
  /\bpremium\s+health\b/i,
  /\bhealth\s+(package|bundle|plan)\b/i,
  /\bspecial\s+package\b/i,
];
