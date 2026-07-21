/**
 * src/lib/semantic/section-classifier.ts
 *
 * Phase 9 — Section heading classifier.
 *
 * Classifies a StructuredReport entry's `category` string into:
 *  - `medical`  : a real clinical panel name → keep as-is (normalised to Title Case)
 *  - `pseudo`   : a product/package heading → reclassify entries to "Uncategorized"
 *  - `noise`    : marketing/boilerplate text → suppress entries outright
 *
 * The classifier operates on the category string only — it never re-reads the
 * raw PDF text. This preserves the separation between layout (Phase 8) and
 * semantic normalization (Phase 9).
 *
 * Pure: same input → same output. No I/O, no shared mutable state.
 */

import type { SectionClassification } from './types.js';
import {
  KNOWN_MEDICAL_CATEGORIES,
  NOISE_CATEGORY_PATTERNS,
  PSEUDO_SECTION_PATTERNS,
} from './ontology.js';

// ─── Title-case helper ─────────────────────────────────────────────────────────

/** Common short words that should not be title-cased in medical panel names. */
const LOWERCASE_WORDS = new Set(['and', 'or', 'of', 'the', 'a', 'an', 'in', 'at', 'for', 'to', 'by', 'with']);

/**
 * Convert a string to Title Case, keeping common short words lowercase.
 * E.g. "LIPID PROFILE" → "Lipid Profile", "LIVER FUNCTION TEST" → "Liver Function Test".
 */
function toTitleCase(text: string): string {
  const words = text.toLowerCase().split(/\s+/);
  return words
    .map((word, idx) => {
      if (idx > 0 && LOWERCASE_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

// ─── Category normalisation helpers ───────────────────────────────────────────

/**
 * Map common category aliases to their canonical display form.
 * Applied before the KNOWN_MEDICAL_CATEGORIES lookup.
 */
const CATEGORY_ALIAS_MAP: ReadonlyMap<string, string> = new Map([
  ['cbc',                             'Complete Blood Count'],
  ['hemogram',                        'Complete Blood Count'],
  ['haemogram',                       'Complete Blood Count'],
  ['dlc',                             'Differential Count'],
  ['rft',                             'Renal Function Test'],
  ['kft',                             'Renal Function Test'],
  ['lft',                             'Liver Function Test'],
  ['tft',                             'Thyroid Function Test'],
  ['lipids',                          'Lipid Profile'],
  ['cholesterol panel',               'Lipid Profile'],
  ['kidney function',                 'Renal Function Test'],
  ['kidney function test',            'Renal Function Test'],
  ['renal function',                  'Renal Function Test'],
  ['metabolic panel',                 'Biochemistry'],
  ['comprehensive metabolic panel',   'Biochemistry'],
  ['basic metabolic panel',           'Biochemistry'],
  ['urine r/m',                       'Urine Routine'],
  ['urine routine and microscopy',    'Urine Routine'],
  ['urinalysis',                      'Urine Routine'],
  ['urine analysis',                  'Urine Routine'],
  ['inflammatory markers',            'Inflammation Markers'],
  ['iron studies',                    'Iron Profile'],
]);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify a single category string.
 *
 * Algorithm:
 *  1. Check NOISE_CATEGORY_PATTERNS → `noise`.
 *  2. Check PSEUDO_SECTION_PATTERNS → `pseudo`.
 *  3. Normalize (lower-case, collapse spaces) and look up in KNOWN_MEDICAL_CATEGORIES
 *     or CATEGORY_ALIAS_MAP → `medical` (with canonical name).
 *  4. If none of the above: classify as `pseudo` (unknown heading → don't
 *     suppress entries, but don't trust the heading either).
 *
 * Conservative: we never classify a category as `noise` unless it firmly
 * matches a noise pattern. Unknown headings default to `pseudo` so their
 * entries survive as Uncategorized.
 */
export function classifySection(rawCategory: string): SectionClassification {
  const trimmed = rawCategory.trim();
  const normalized = trimmed.toLowerCase().replace(/\s{2,}/g, ' ');

  // 1. Noise check — marketing / boilerplate headings
  for (const pattern of NOISE_CATEGORY_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        rawCategory,
        kind: 'noise',
        canonicalCategory: rawCategory,
        reason: `Category matches noise pattern: ${pattern.toString()}`,
      };
    }
  }

  // 2. Pseudo check — product/package names that look like sections
  for (const pattern of PSEUDO_SECTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        rawCategory,
        kind: 'pseudo',
        canonicalCategory: rawCategory,
        reason: `Category matches pseudo-section pattern: ${pattern.toString()}`,
      };
    }
  }

  // 3a. Alias map lookup (maps abbreviations/variants to canonical display name)
  if (CATEGORY_ALIAS_MAP.has(normalized)) {
    const canonical = CATEGORY_ALIAS_MAP.get(normalized)!;
    return {
      rawCategory,
      kind: 'medical',
      canonicalCategory: canonical,
      reason: normalized === trimmed.toLowerCase()
        ? 'Category found in alias map'
        : `Category alias mapped: "${normalized}" → "${canonical}"`,
    };
  }

  // 3b. KNOWN_MEDICAL_CATEGORIES lookup (exact match on lower-cased form)
  if (KNOWN_MEDICAL_CATEGORIES.has(normalized)) {
    const canonical = toTitleCase(trimmed);
    return {
      rawCategory,
      kind: 'medical',
      canonicalCategory: canonical,
      reason: 'Category found in known medical categories',
    };
  }

  // 3c. Partial match: if the normalized form CONTAINS a known medical category
  // (e.g. "CARDIAC RISK MARKERS (NON-FASTING)" contains "cardiac risk markers")
  for (const knownCat of KNOWN_MEDICAL_CATEGORIES) {
    if (normalized.includes(knownCat) && knownCat.length > 4) {
      const canonical = toTitleCase(trimmed);
      return {
        rawCategory,
        kind: 'medical',
        canonicalCategory: canonical,
        reason: `Category contains known medical panel: "${knownCat}"`,
      };
    }
  }

  // 4. Unknown heading — conservatively treat as pseudo (not noise).
  //    Entries in unknown sections survive but move to Uncategorized.
  return {
    rawCategory,
    kind: 'pseudo',
    canonicalCategory: rawCategory,
    reason: 'Unknown section heading — treated as pseudo-section; entries moved to Uncategorized',
  };
}

/**
 * Classify multiple categories, returning a Map for fast per-entry lookup.
 * Deduplicates: each unique rawCategory is classified only once.
 */
export function classifySections(
  categories: Iterable<string>,
): Map<string, SectionClassification> {
  const result = new Map<string, SectionClassification>();
  for (const cat of categories) {
    if (!result.has(cat)) {
      result.set(cat, classifySection(cat));
    }
  }
  return result;
}

/**
 * Given a SectionKind, decide what category to assign to entries.
 *  - `medical`  → use the canonicalCategory
 *  - `pseudo`   → 'Uncategorized'
 *  - `noise`    → (entries should be suppressed, this value is not used)
 */
export function effectiveCategoryFor(classification: SectionClassification): string {
  switch (classification.kind) {
    case 'medical': return classification.canonicalCategory;
    case 'pseudo':  return 'Uncategorized';
    case 'noise':   return 'Suppressed';
  }
}
