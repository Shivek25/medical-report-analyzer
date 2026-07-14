/**
 * src/lib/extraction/validator.ts
 *
 * Phase 6 — Deterministic validation gate for LLM-labelled items.
 *
 * The model is treated as UNTRUSTED. This module is the hard boundary that
 * decides which `LabeledItem`s may become `LabEntry` findings. It enforces the
 * three non-negotiable Phase 6 rules:
 *
 *   1. Evidence traceability — every normalized field must occur (verbatim or
 *      as a clearly attributable token) inside the item's `evidence`, which
 *      must itself be a substring of the source block. This is the
 *      anti-fabrication guard: a fabricated value that does not appear in the
 *      evidence is rejected.
 *   2. Noise / descriptor / boilerplate rejection — reusing the deterministic
 *      parser's own predicates (noise-filter, generic descriptors, unit-only
 *      names) so the LLM path can never leak the same junk the deterministic
 *      parser already filters.
 *   3. No-fabrication on value — an item whose `value` is empty / missing /
 *      non-numeric-and-non-qualitative is rejected or demoted, never padded.
 *
 * The gate produces a normalized `LabEntry` by routing the (already-trusted)
 * normalized fields through the deterministic parser's `normalize()`, so the
 * canonical form (unit map, range parsing, whitespace) is identical to the
 * deterministic path. This is what keeps the final `StructuredReport` schema
 * identical regardless of which path produced it.
 *
 * Pure module: no I/O, no shared mutable state, deterministic per input.
 */

import type { CandidateBlock, LabeledItem } from './types.js';
import type { LabEntry } from '../types/index.js';
import { normalize } from '../parser/normalizer.js';
import {
  NUMERIC_VALUE_ANCHORED,
  QUALITATIVE_VALUE_ANCHORED,
  UNIT_TOKEN_ANCHORED,
} from '../parser/patterns.js';
import {
  isGenericDescriptorToken,
  isGenericDescriptorOrLabelLine,
  isNoiseRow,
} from '../parser/noise-filter.js';

/** Result of validating a single `lab_result`-labelled item. */
export interface ValidatedLabResult {
  /** `true` when the item is admitted as a finding. */
  accepted: boolean;
  /** Present when `accepted`; the normalized, schema-ready entry. */
  entry?: LabEntry;
  /** Present when rejected; a short structural reason. */
  rejectionReason?: string;
}

/**
 * Validate a `lab_result`-labelled `LabeledItem` against its source block.
 *
 * Returns `{ accepted: true, entry }` only when ALL of the following hold:
 *   - the item's `evidence` is a verbatim substring of `block.text`;
 *   - `normalized.testName` is non-empty, not a generic descriptor / unit-only,
 *     contains an alphabetic run of 3+ letters, and occurs (token-wise) in the
 *     evidence;
 *   - `normalized.value` is present, is numeric or qualitative, and occurs in
 *     the evidence;
 *   - any `unit` / `referenceRange.text` / `flag` is traceable into the evidence
 *     when present;
 *   - the evidence is not itself a noise / descriptor / column-label line.
 *
 * On any failure the item is rejected with a structural `rejectionReason`. The
 * caller then routes rejected items to `extractionQuality.ambiguousLines`.
 *
 * The returned `entry` is produced by feeding a transient `LabEntry` through
 * the deterministic `normalize()`, guaranteeing a single canonical form shared
 * with the deterministic parser path.
 */
export function validateLabResult(
  item: LabeledItem,
  block: CandidateBlock,
): ValidatedLabResult {
  if (item.label !== 'lab_result') {
    return { accepted: false, rejectionReason: `not a lab_result label (${item.label})` };
  }
  const normalized = item.normalized;
  if (normalized === undefined) {
    return { accepted: false, rejectionReason: 'lab_result item missing normalized payload' };
  }

  // ── 1. Evidence traceability: evidence must be a verbatim substring of block.
  const evidence = (item.evidence ?? '').trim();
  if (evidence.length === 0) {
    return { accepted: false, rejectionReason: 'empty evidence' };
  }
  if (!block.text.includes(evidence) && !block.text.includes(normalizeWhitespace(evidence))) {
    return { accepted: false, rejectionReason: 'evidence not found verbatim in source block' };
  }

  // ── 2. Evidence itself must not be a noise / descriptor / label line.
  //       (Double defence: even if the model labels a descriptor as lab_result,
  //       we never let it through.)
  if (isNoiseRow(evidence)) {
    return { accepted: false, rejectionReason: 'evidence is a noise row' };
  }
  if (isGenericDescriptorOrLabelLine(evidence)) {
    return { accepted: false, rejectionReason: 'evidence is a descriptor / column label / header' };
  }

  // ── 3. testName checks.
  const testName = normalized.testName.trim();
  if (testName.length === 0) {
    return { accepted: false, rejectionReason: 'empty testName' };
  }
  if (isGenericDescriptorToken(testName)) {
    return { accepted: false, rejectionReason: `generic descriptor testName "${testName}"` };
  }
  // A section / panel header token (RENAL, LIPID, THYROID, …) is never an
  // analyte. These carry no value of their own; when the model extracts a value
  // under such a name it has mis-merged a header with the following row.
  if (isGenericDescriptorOrLabelLine(testName)) {
    return { accepted: false, rejectionReason: `section/header/column-label testName "${testName}"` };
  }
  if (UNIT_TOKEN_ANCHORED.test(testName)) {
    return { accepted: false, rejectionReason: `unit-only testName "${testName}"` };
  }
  if (!/[A-Za-z]{3,}/.test(testName)) {
    return { accepted: false, rejectionReason: 'testName has no 3+ letter alphabetic run' };
  }
  // Plausibility guard (layout-independent): an analyte name must look like a
  // name, not like prose or a glued artefact. This is what generalizes the
  // gate beyond Thyrocare — it catches the novel leakage shapes on unfamiliar
  // layouts that the deterministic, overfit predicates cannot predict.
  const plausibility = analytePlausibility(testName);
  if (plausibility !== null) {
    return { accepted: false, rejectionReason: plausibility };
  }
  // testName token must be traceable into the evidence (case-insensitive token match).
  if (!allTokensOccurIn(testName, evidence)) {
    return { accepted: false, rejectionReason: 'testName tokens not found in evidence' };
  }

  // ── 4. value checks (no fabrication).
  const value = (normalized.value ?? '').trim();
  if (value.length === 0) {
    return { accepted: false, rejectionReason: 'empty value' };
  }
  const isNumeric = NUMERIC_VALUE_ANCHORED.test(value);
  const isQualitative = QUALITATIVE_VALUE_ANCHORED.test(value);
  if (!isNumeric && !isQualitative) {
    return { accepted: false, rejectionReason: `value "${value}" is neither numeric nor qualitative` };
  }
  if (!evidence.includes(value)) {
    return { accepted: false, rejectionReason: 'value not found verbatim in evidence' };
  }

  // ── 5. optional field traceability (unit / range / flag).
  if (normalized.unit !== undefined && normalized.unit.trim().length > 0) {
    if (!evidence.includes(normalized.unit.trim())) {
      return { accepted: false, rejectionReason: 'unit not found verbatim in evidence' };
    }
  }
  if (normalized.referenceRange?.text !== undefined) {
    const rangeText = normalized.referenceRange.text.trim();
    if (rangeText.length > 0 && !evidence.includes(rangeText)) {
      return { accepted: false, rejectionReason: 'referenceRange.text not found verbatim in evidence' };
    }
  }
  if (normalized.flag !== undefined && normalized.flag.trim().length > 0) {
    if (!evidence.includes(normalized.flag.trim())) {
      return { accepted: false, rejectionReason: 'flag not found verbatim in evidence' };
    }
  }

  // ── 5b. Clinical-signal requirement (layout-independent) ───────────────────
  // A genuine lab result carries EITHER a unit OR a reference range. A numeric
  // "value" with neither — e.g. "SUGAR CONTROL 100", "LIVER FUNCTION 81",
  // "NUTRITION 86" — is a wellness/domain SCORE or a count, not an analyte
  // measurement. Requiring this signal is what generalizes the gate to
  // non-Thyrocare layouts: it asks "does this look like a lab result?" rather
  // than "is this token in my noise list?".
  //
  // Qualitative values (Negative/Positive/…) are exempt: their "range" is the
  // qualitative token itself, which is evidence enough.
  const hasUnit = normalized.unit !== undefined && normalized.unit.trim().length > 0;
  const hasRange =
    normalized.referenceRange?.text !== undefined &&
    normalized.referenceRange.text.trim().length > 0;
  if (!hasUnit && !hasRange && !isQualitative) {
    return {
      accepted: false,
      rejectionReason: `numeric value without unit or reference range (not a clinical measurement)`,
    };
  }

  // ── 6. Build the trusted entry and run it through the deterministic
  //       normalizer so the canonical form matches the deterministic path.
  const entry = buildEntry(normalized.testName, value, normalized, block);
  return { accepted: true, entry };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Layout-independent analyte-name plausibility check. Returns a rejection
 * reason string when the name is implausible as a real biomarker, or `null`
 * when it passes. This generalizes the gate beyond any single vendor layout:
 * it catches the *kinds* of garbage that leak on unfamiliar PDFs rather than
 * enumerating specific tokens.
 *
 * Rejection cases (each observed on unseen reports):
 *   - A token repeated ≥ 3 times adjacently ("OptimalOptimalOptimal") — a PDF
 *     column-extraction artefact, never a real analyte.
 *   - Embedded lowercase prose (a lowercase word of 3+ letters anywhere in an
 *     otherwise ALL-CAPS / title-case name) — e.g. "All domain scores are
 *     measured on a scale of", "For any concern regarding this report".
 *     Genuine analyte names are uniformly cased; prose is not.
 *   - A pure status word as the entire name ("Out of Range", "Borderline",
 *     "High", "Normal") — these are result flags, not analytes.
 *   - Too many tokens (≥ 6): long phrases are almost always prose, not names.
 */
function analytePlausibility(name: string): string | null {
  const trimmed = name.trim();
  const lowerSpaced = trimmed.toLowerCase();

  // A trailing colon means this is a labelled field ("Male:", "Female:",
  // "Reference :"), not an analyte name. Real analyte names never end in ":".
  if (/:$/.test(trimmed)) {
    return `label-like testName "${trimmed}" (trailing colon)`;
  }

  // Repeated-token artefact: "FooFooFoo" or "Foo Foo Foo". Compare against the
  // whitespace-collapsed, lower-cased form so spacing/case variants all match.
  const compact = lowerSpaced.replace(/\s+/g, '');
  for (let len = 2; len <= Math.floor(compact.length / 3); len += 1) {
    const head = compact.slice(0, len);
    if (head.length === 0) continue;
    // Does the whole string consist of `head` repeated ≥ 3 times?
    if (head.repeat(3) === compact.slice(0, len * 3) && compact.length >= len * 3) {
      let built = '';
      while (built.length < compact.length) built += head;
      if (compact === built.slice(0, compact.length)) {
        return `repeated-token artefact "${trimmed}"`;
      }
    }
  }

  // Pure status-word names (multi-word phrases compared WITH spaces).
  const STATUS_WORDS = new Set([
    'out of range', 'borderline', 'optimal', 'desirable', 'high', 'low',
    'normal', 'abnormal', 'critical', 'positive', 'negative', 'reactive',
    'monitor', 'high concern', 'physician review', 'male', 'female',
  ]);
  if (STATUS_WORDS.has(lowerSpaced)) {
    return `status-word testName "${trimmed}"`;
  }

  // Embedded lowercase prose: any lowercase word of 3+ letters means the "name"
  // is a sentence fragment. Real analyte names use ALL-CAPS or Title-Case only.
  // Allow single-letter / 2-letter lowercase units (e.g. "Vitamin B-12",
  // "25-OH") through.
  const words = trimmed.split(/\s+/);
  if (words.some((w) => /^[a-z]{3,}$/.test(w))) {
    return `prose-like testName "${trimmed}"`;
  }

  // Too many tokens ⇒ almost certainly prose ("All domain scores are measured
  // on a scale of").
  if (words.length >= 6) {
    return `too-long testName (${words.length} tokens) "${trimmed}"`;
  }

  return null;
}

/** Collapse internal whitespace runs and trim edges. */
function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s{2,}/g, ' ');
}

/**
 * True iff every whitespace-separated token of `needle` appears in `haystack`
 * (case-insensitive). Token-level matching tolerates the model reordering or
 * lightly re-spacing tokens (e.g. "HEMOGLOBIN (PCV)" vs "HEMATOCRIT(PCV)") while
 * still forbidding outright fabrication.
 */
function allTokensOccurIn(needle: string, haystack: string): boolean {
  const hay = haystack.toLowerCase();
  const tokens = needle.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  return tokens.every((t) => hay.includes(t));
}

/**
 * Construct a `LabEntry` from the validated normalized fields and route it
 * through the deterministic `normalize()`. The entry is marked confident
 * (`uncertain: false`) because it has passed evidence + shape checks.
 */
function buildEntry(
  testName: string,
  value: string,
  normalized: NonNullable<LabeledItem['normalized']>,
  block: CandidateBlock,
): LabEntry {
  const category = normalized.category?.trim() || 'Uncategorized';

  // Build a transient LabEntry; optional fields are only set when present
  // (exactOptionalPropertyTypes).
  const transient: LabEntry = {
    testName,
    value,
    category,
    uncertain: false,
  };
  if (normalized.unit !== undefined && normalized.unit.trim().length > 0) {
    transient.unit = normalized.unit.trim();
  }
  if (normalized.flag !== undefined && normalized.flag.trim().length > 0) {
    transient.flag = normalized.flag.trim();
  }
  if (normalized.referenceRange !== undefined) {
    transient.referenceRange = normalized.referenceRange;
  }

  const normalizedEntry = normalize(transient);

  // Attach the source-line provenance as a note (structural; no PII). This keeps
  // the finding debuggable without changing the LabEntry schema.
  const provenance = `phase6:llm; line ${block.lineStart + 1}`;
  normalizedEntry.notes =
    normalizedEntry.notes !== undefined
      ? `${normalizedEntry.notes} | ${provenance}`
      : provenance;

  return normalizedEntry;
}
