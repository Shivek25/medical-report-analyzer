/**
 * src/lib/parser/unit-map.ts
 *
 * Canonical unit map for the Phase 2 parser's Normalizer.
 *
 * The map keys are uppercased forms of the units commonly seen in Indian lab
 * reports (Thyrocare and similar) and the values are the canonical, mixed-case
 * representations used downstream (Requirement 6.3).
 *
 * Lookups are performed against the *uppercased* trimmed input string so that
 * variants such as `mg/dl`, `MG/DL`, `Mg/Dl`, and `mg/dL` all collapse to a
 * single canonical form (`mg/dL`).
 *
 * Pure data + a single pure helper. No I/O, no shared mutable state.
 */

/**
 * Map from uppercased unit token to its canonical mixed-case form.
 *
 * Keys MUST be uppercase (the helper uppercases input before lookup).
 * Values are the canonical strings to emit in `LabEntry.unit`.
 */
export const UNIT_MAP: Record<string, string> = {
  // Concentration — mass / volume
  'MG/DL': 'mg/dL',
  'GM/DL': 'g/dL',
  'G/DL': 'g/dL',
  'UG/DL': 'µg/dL',
  'µG/DL': 'µg/dL',
  'ΜG/DL': 'µg/dL',
  'MCG/DL': 'µg/dL',
  'NG/DL': 'ng/dL',
  'NG/ML': 'ng/mL',
  'PG/ML': 'pg/mL',
  'UG/ML': 'µg/mL',
  'µG/ML': 'µg/mL',
  'ΜG/ML': 'µg/mL',
  'MCG/ML': 'µg/mL',
  'MG/L': 'mg/L',
  'GM/L': 'g/L',
  'G/L': 'g/L',
  'UG/L': 'µg/L',
  'µG/L': 'µg/L',
  'ΜG/L': 'µg/L',
  'NG/L': 'ng/L',
  'PG/DL': 'pg/dL',
  'MG%': 'mg%',
  'GM%': 'g%',

  // Concentration — molar
  'MMOL/L': 'mmol/L',
  'UMOL/L': 'µmol/L',
  'µMOL/L': 'µmol/L',
  'ΜMOL/L': 'µmol/L',
  'MCMOL/L': 'µmol/L',
  'NMOL/L': 'nmol/L',
  'PMOL/L': 'pmol/L',
  'MOL/L': 'mol/L',
  'MEQ/L': 'mEq/L',

  // Enzyme / activity units
  'IU/L': 'IU/L',
  'U/L': 'U/L',
  'IU/ML': 'IU/mL',
  'U/ML': 'U/mL',
  'MIU/L': 'mIU/L',
  'MIU/ML': 'mIU/mL',
  'UIU/ML': 'µIU/mL',
  'µIU/ML': 'µIU/mL',
  'ΜIU/ML': 'µIU/mL',
  'MCIU/ML': 'µIU/mL',

  // Cell counts and haematology
  'CELLS/CUMM': 'cells/cumm',
  '/CUMM': '/cumm',
  'CELLS/UL': 'cells/µL',
  'CELLS/µL': 'cells/µL',
  'CELLS/ΜL': 'cells/µL',
  '/UL': '/µL',
  '/µL': '/µL',
  '/ΜL': '/µL',
  '/HPF': '/HPF',
  'MILLION/CUMM': 'million/cumm',
  'MILLION/UL': 'million/µL',
  'MILLION/µL': 'million/µL',
  'LAKHS/CUMM': 'lakhs/cumm',
  'THOUSAND/CUMM': 'thousand/cumm',
  '10^3/UL': '10^3/µL',
  '10^6/UL': '10^6/µL',
  '10^9/L': '10^9/L',
  '10^12/L': '10^12/L',
  'X 10^3/UL': '10^3/µL',
  'X 10^6/UL': '10^6/µL',
  'X 10^3 / UL': '10^3/µL',
  'X 10^6 / UL': '10^6/µL',
  'X 10³ / UL': '10^3/µL',
  'X 10⁶ / UL': '10^6/µL',
  'X 10³/UL': '10^3/µL',
  'X 10⁶/UL': '10^6/µL',
  'X 10³ / µL': '10^3/µL',
  'X 10⁶ / µL': '10^6/µL',
  'X 10³ / ΜL': '10^3/µL',
  'X 10⁶ / ΜL': '10^6/µL',
  'X 10^6/ΜL': '10^6/µL',
  'X 10^6/µL': '10^6/µL',
  'X 10^3/ΜL': '10^3/µL',
  'X 10^3/µL': '10^3/µL',

  // Volume / size
  'FL': 'fL',
  'PG': 'pg',
  // Thyrocare sometimes prints `pq` for `pg` (OCR / font glitch)
  'PQ': 'pg',

  // Rate / time
  'MM/HR': 'mm/hr',
  'MM/H': 'mm/hr',
  'ML/MIN': 'mL/min',
  'ML/MIN/1.73M2': 'mL/min/1.73m²',

  // Dimensionless
  '%': '%',
  'RATIO': 'ratio',
  'INDEX': 'index',
};

/**
 * Canonicalise a raw unit token.
 *
 * Behaviour (per Requirement 6.3):
 *   1. Trim leading/trailing whitespace from the input.
 *   2. Look the trimmed value up in `UNIT_MAP` using its uppercased form.
 *   3. If a match is found, return the canonical mixed-case value.
 *   4. Otherwise, return the trimmed input unchanged (no case conversion).
 *
 * This function is pure and has no side effects.
 *
 * @param raw - The raw unit string as captured by the Field_Extractor.
 * @returns The canonical unit string, or the trimmed input when no canonical
 *          form is known.
 */
export function canonicalizeUnit(raw: string): string {
  const trimmed = raw.trim();
  const canonical = UNIT_MAP[trimmed.toUpperCase()];
  return canonical !== undefined ? canonical : trimmed;
}
