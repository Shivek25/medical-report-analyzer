/**
 * src/lib/parser/patterns.ts
 *
 * Shared regular expressions and lookup tables used by the Phase 2 parser
 * sub-modules (Text_Cleaner, Row_Detector, Field_Extractor, Normalizer,
 * Metadata Extractor, Categorizer).
 *
 * Design constraints:
 *   - This module performs no I/O and has no runtime side effects.
 *   - Every export is a `const` regex, frozen lookup table, or pure helper
 *     constant. Regexes intended for repeated use without `.lastIndex` state
 *     are NOT declared with the `g` flag, so `.test()` / `.match()` can be
 *     called repeatedly without surprising behavior.
 *   - Downstream callers SHOULD treat these patterns as immutable shared
 *     resources and never mutate flags, source, or `lastIndex`.
 *
 * Requirements covered:
 *   - 2.2, 2.3 (date formats), 2.7 (age/gender annotation)
 *   - 3.2     (page-marker line)
 *   - 4.1     (numeric / qualitative value, unit, range, flag tokens)
 *   - 5.5     (recognised flag tokens)
 *   - 6.4, 6.5 (reference-range parsing patterns)
 */

// ─── Numeric & Qualitative Value Tokens ───────────────────────────────────────

/**
 * A numeric value token: integer or decimal, optionally signed, with optional
 * scientific-notation exponent.
 *
 * NOTE: Uses lookarounds via word boundaries on alphanumerics. Because `\b`
 * does not work cleanly around symbols like `<` or `+`, callers that need
 * positional anchoring should compose this pattern into a larger regex via
 * `NUMERIC_VALUE.source`.
 *
 * Used by: Row_Detector (Req 4.1), Field_Extractor (Req 5.2).
 */
export const NUMERIC_VALUE = /[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/;

/**
 * Same numeric body as {@link NUMERIC_VALUE}, but anchored to the entire
 * string. Useful for "is this token entirely a number?" checks in
 * Field_Extractor / Normalizer.
 */
export const NUMERIC_VALUE_ANCHORED = /^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

/**
 * The full set of recognised qualitative value tokens. Matched
 * case-sensitively per Phase 2 spec — Thyrocare reports use canonical case.
 *
 * Used by: Row_Detector (Req 4.1), Field_Extractor (Req 5.2).
 */
export const QUALITATIVE_VALUES = [
  'Negative',
  'Positive',
  'Reactive',
  'Non-Reactive',
  'Present',
  'Absent',
] as const;

export type QualitativeValue = (typeof QUALITATIVE_VALUES)[number];

/**
 * Matches any qualitative value token as a whole word. Case-insensitive so
 * that downstream callers can be lenient (e.g., `NEGATIVE`, `negative`).
 * The non-Reactive variant tolerates both `Non-Reactive` and `NonReactive`.
 *
 * Used by: Row_Detector (Req 4.1).
 */
export const QUALITATIVE_VALUE = /\b(?:Negative|Positive|Reactive|Non[- ]?Reactive|Present|Absent)\b/i;

/**
 * Anchored variant of {@link QUALITATIVE_VALUE} — for "is this token entirely
 * a recognised qualitative value?" checks.
 */
export const QUALITATIVE_VALUE_ANCHORED =
  /^(?:Negative|Positive|Reactive|Non[- ]?Reactive|Present|Absent)$/i;

// ─── Unit Tokens ──────────────────────────────────────────────────────────────

/**
 * Inner alternation listing every unit-token shape recognised in this
 * file. Kept private so that the loose ({@link UNIT_TOKEN}) and anchored
 * ({@link UNIT_TOKEN_ANCHORED}) variants can share a single source of
 * truth without each having to re-encode the alternation.
 *
 * Covers (non-exhaustive — Field_Extractor still falls back to looser
 * tokenisation when the unit is novel):
 *   - Concentration:      mg/dL, gm/dL, g/dL, g/L, ng/mL, ng/dL, pg/mL,
 *                         pg/dL, µg/dL, ug/dL, mcg/dL, ug/L
 *   - Activity:           IU/L, U/L, mIU/L, mU/L, IU/mL, U/mL, µIU/mL
 *   - Molar:              mmol/L, mol/L, µmol/L, umol/L, nmol/L, pmol/L
 *   - Counts:             /mm³, /mm3, /uL, /µL, /cumm,
 *                         cells/uL, cells/µL, cells/cumm,
 *                         million/cumm, million/µL, lakhs/cumm,
 *                         thousand/cumm, x10^3/uL, x10^6/uL,
 *                         X 10^3 / µL, X 10³ / µL, X 10^6 / µL
 *   - Volume / size:      fL, fl, pg
 *   - Time:               sec, secs, mins, hrs
 *   - Rate:               mm/hr, mm/h, mL/min, mL/min/1.73m²
 *   - Mass:               mg, g, kg, ng, pg
 *   - Percent / ratio:    %, mg%, gm%, ratio (literal), index (literal)
 *
 * Exported so that sub-modules that need to build composite patterns
 * (e.g., the column-block stitcher in Text_Cleaner) can reference the
 * same source of truth.
 */
export const UNIT_TOKEN_BODY =
  /(?:m?gm?\/d[lL]|m?gm?\/m[lL]|gm?\/[lL]|[npµuμ]g\/m[lL]|[npµuμ]g\/d[lL]|[npµuμ]g\/[lL]|m?cg\/d[lL]|m?cg\/m[lL]|m?cg\/[lL]|m?IU\/m[lL]|m?IU\/[lL]|[µuμ]IU\/m[lL]|m?U\/m[lL]|m?U\/[lL]|[npµuμ]?mol\/[lL]|mol\/[lL]|m[Ee]q\/[lL]|cells\/[uµμ]?[lL]|cells\/c?umm|million\/[uµμ][lL]|million\/c?umm|lakhs\/c?umm|thousand\/c?umm|\/cumm|\/mm3|\/mm\u00b3|\/[uµμ][lL]|\/HPF|\/hpf|x\s?10\s?\^?\s?[36]\s?\/[\s]?[uµμ]?[lL]|X\s?10\s?\^?\s?[36]\s?\/[\s]?[uµμ]?[lL]|X\s?10[³⁶]\s?\/?\s?[uµμ]?[lL]|fL|fl|pg|ng|µg|ug|μg|mcg|mg%|gm%|mg|kg|sec(?:onds)?|secs?|mins?|hrs?|hours?|mm\/hr|mm\/h|mL\/min(?:\/1\.73m[²2])?|%)/;

/**
 * Recognises unit tokens commonly seen in Indian pathology reports.
 *
 * The body alternation is bracketed by zero-width assertions
 * `(?<!\w)` and `(?!\w)` rather than `\b...\b`. The two are equivalent
 * for word-character-edged tokens (`mg/dL`, `IU/L`, `pg`, …), but `\b`
 * cannot fire next to symbol-edged tokens such as `%` or `/mm3`,
 * because a transition between two non-word characters (space → `%` or
 * `%` → end-of-line) is not a word boundary. Using lookarounds for
 * "no adjacent word char" lets a token like `%` match correctly when
 * surrounded by whitespace, punctuation, or string edges, while still
 * rejecting it when glued to an alphanumeric (e.g., `5%abc`).
 *
 * Case-sensitive at the regex level; the `[lL]` / `[Ee]` character
 * classes carry the only intended case tolerance. Callers that need
 * full case-insensitivity should use {@link UNIT_TOKEN_ANCHORED}, which
 * keeps the original `i` flag.
 *
 * Used by: Row_Detector (Req 4.1), Field_Extractor (Req 5.3), Normalizer
 * (Req 6.3).
 */
export const UNIT_TOKEN = new RegExp(`(?<!\\w)${UNIT_TOKEN_BODY.source}(?!\\w)`);

/**
 * Anchored variant of {@link UNIT_TOKEN}. Used by Field_Extractor when it
 * needs to confirm that a single token is itself a unit (and not part of a
 * surrounding context).
 */
export const UNIT_TOKEN_ANCHORED = new RegExp(`^${UNIT_TOKEN_BODY.source}$`, 'i');

// ─── Reference-Range Patterns ─────────────────────────────────────────────────

/**
 * Numeric range of the form `lo-hi` or `lo – hi` (en-dash tolerated).
 * Captures `low` (group 1) and `high` (group 2). The whole match must consist
 * solely of the numeric range — any trailing units/text means the range is
 * stored verbatim instead (Req 6.4, 6.5).
 *
 * Used by: Normalizer (Req 6.4).
 */
export const REFERENCE_RANGE_NUMERIC =
  /^\s*(\d+(?:\.\d+)?)\s*[-\u2013]\s*(\d+(?:\.\d+)?)\s*$/;

/**
 * Less strict numeric-range matcher — finds a `lo-hi` substring anywhere
 * inside a row. Used by Field_Extractor when slicing range tokens out of a
 * merged row (Req 5.4).
 */
export const REFERENCE_RANGE_NUMERIC_LOOSE =
  /(\d+(?:\.\d+)?)\s*[-\u2013]\s*(\d+(?:\.\d+)?)/;

/**
 * One-sided comparison range: `< 30`, `> 200`, `≤ 5`, `≥ 1.5`.
 * Captures the operator (group 1) and the bound (group 2).
 *
 * Used by: Field_Extractor (Req 5.4), Normalizer (Req 6.5).
 */
export const REFERENCE_RANGE_COMPARISON =
  /^\s*(<=|>=|<|>|\u2264|\u2265)\s*(\d+(?:\.\d+)?)\s*$/;

/**
 * Loose comparison-range matcher — finds a `< 30` / `> 200` substring inside
 * a row.
 */
export const REFERENCE_RANGE_COMPARISON_LOOSE =
  /(<=|>=|<|>|\u2264|\u2265)\s*(\d+(?:\.\d+)?)/;

/**
 * Qualitative reference range: matches when the entire range text is one of
 * the recognised qualitative tokens (e.g., `Negative`, `Non-Reactive`).
 *
 * Used by: Normalizer (Req 6.5).
 */
export const REFERENCE_RANGE_QUALITATIVE = QUALITATIVE_VALUE_ANCHORED;

/**
 * Convenience predicate: any of the recognised reference-range shapes
 * (numeric, comparison, or qualitative). Useful for Row_Detector's "does this
 * line contain a range?" check (Req 4.1).
 */
export const REFERENCE_RANGE_ANY =
  /(?:\d+(?:\.\d+)?\s*[-\u2013]\s*\d+(?:\.\d+)?|(?:<=|>=|<|>|\u2264|\u2265)\s*\d+(?:\.\d+)?|\b(?:Negative|Positive|Reactive|Non[- ]?Reactive|Present|Absent)\b)/i;

// ─── Flag Tokens ──────────────────────────────────────────────────────────────

/**
 * The full set of recognised flag tokens. Anything in the flag position that
 * is not in this set is routed to `LabEntry.notes` per Req 5.5.
 */
export const FLAG_VALUES = ['H', 'L', '*', 'HIGH', 'LOW', 'CRITICAL', 'ABNORMAL'] as const;

export type FlagValue = (typeof FLAG_VALUES)[number];

/**
 * Anchored flag matcher: matches when an entire token is a recognised flag.
 * Case-sensitive for the single-letter `H`/`L` (uppercase only, to avoid
 * collisions with the lowercase `l` in unit suffixes like `IU/l`); the word
 * variants are case-insensitive.
 *
 * Used by: Field_Extractor (Req 5.5).
 */
export const FLAG_TOKEN_ANCHORED = /^(?:H|L|\*|HIGH|LOW|CRITICAL|ABNORMAL)$/;

/**
 * Loose flag matcher — finds any recognised flag token as a whole word
 * inside a row. Word-boundary enforced so that `H` does not match inside
 * `mg/dL` (and similar). The single-character `*` cannot rely on `\b`, so
 * it is matched explicitly.
 *
 * Used by: Row_Detector (Req 4.1) for "does this line contain a flag?".
 */
export const FLAG_TOKEN = /(?:\b(?:H|L|HIGH|LOW|CRITICAL|ABNORMAL)\b|\*)/;

// ─── Page Marker / Separator / Header-Only Lines ──────────────────────────────

/**
 * A page-counter line such as `Page : 1 of 3` or `Page 2 of 3`. The full line
 * (after trimming) must match — partial matches do not.
 *
 * Used by: Text_Cleaner (Req 3.2), Row_Detector page-boundary check
 * (Req 7.3).
 */
export const PAGE_MARKER_LINE = /^Page\s*:?\s*\d+\s+of\s+\d+$/i;

/**
 * A line composed entirely of separator characters: dashes (`-`), underscores
 * (`_`), equals signs (`=`), and/or whitespace. Used by Text_Cleaner to drop
 * decorative rules (Req 3.4).
 *
 * The pattern accepts the empty string (zero separators after trim) for
 * convenience; Text_Cleaner separately filters whitespace-only lines.
 */
export const SEPARATOR_ONLY_LINE = /^[\s\-_=]*$/;

/**
 * A whitespace-only line (including the empty string).
 */
export const WHITESPACE_ONLY_LINE = /^\s*$/;

// ─── Age / Gender Annotation ──────────────────────────────────────────────────

/**
 * Trailing age/gender annotation on a patient-name line, e.g.,
 * `Shivek Sharma (22Y/M)`. Captures the numeric age (group 1) and the
 * single-letter gender (group 2). The annotation must be at the end of the
 * line (after optional trailing whitespace) per Req 2.7.
 *
 * Used by: Metadata Extractor (Req 2.7, 2.8).
 */
export const AGE_GENDER_ANNOTATION = /\((\d+)Y\/([A-Za-z])\)\s*$/;

/**
 * Mapping from raw single-letter gender tokens to the canonical
 * `'M' | 'F' | 'O'` codes used in `ReportMetadata.patientGender` (Req 2.7).
 *
 * Anything not in this table maps to `'O'` (other) per the spec.
 */
export const GENDER_LETTER_MAP: Readonly<Record<string, 'M' | 'F' | 'O'>> = Object.freeze({
  M: 'M',
  m: 'M',
  F: 'F',
  f: 'F',
  O: 'O',
  o: 'O',
});

// ─── Date Formats ─────────────────────────────────────────────────────────────

/**
 * Three-letter month abbreviation → 1-based month number. Frozen so callers
 * cannot mutate the shared table.
 */
export const MONTH_ABBR_MAP: Readonly<Record<string, number>> = Object.freeze({
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
});

/**
 * Accepted date formats per Req 2.2 / 2.3. Each entry exposes:
 *   - `id`: a stable identifier used in tests / logs.
 *   - `regex`: the matching regex with named-style positional capture groups.
 *   - `parts`: which capture group holds which date component.
 *
 * Date conversion is deliberately not implemented in this module (this file
 * is "regexes / lookup tables only"); the Metadata Extractor performs the
 * actual ISO conversion.
 */
export interface DateFormatSpec {
  readonly id: 'DD/MM/YYYY' | 'DD-MM-YYYY' | 'DD MMM YYYY' | 'MMM DD, YYYY' | 'DD/MMM/YYYY';
  readonly regex: RegExp;
  /** Maps a date component to its 1-based capture-group index in `regex`. */
  readonly parts: {
    readonly day: number;
    readonly month: number;
    readonly year: number;
    /** True when the month capture is a 3-letter abbreviation (Jan, Feb, …). */
    readonly monthIsAbbr: boolean;
  };
}

/**
 * `DD/MM/YYYY` — e.g., `09/03/2026`.
 */
export const DATE_FORMAT_DD_MM_YYYY_SLASH: DateFormatSpec = {
  id: 'DD/MM/YYYY',
  regex: /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+.*)?$/,
  parts: { day: 1, month: 2, year: 3, monthIsAbbr: false },
};

/**
 * `DD-MM-YYYY` — e.g., `09-03-2026`.
 */
export const DATE_FORMAT_DD_MM_YYYY_DASH: DateFormatSpec = {
  id: 'DD-MM-YYYY',
  regex: /^\s*(\d{1,2})-(\d{1,2})-(\d{4})(?:,?\s+.*)?$/,
  parts: { day: 1, month: 2, year: 3, monthIsAbbr: false },
};

/**
 * `DD MMM YYYY` — e.g., `09 Mar 2026` or `9 March 2026` (3+ letters).
 * The comma after the month is optional.
 */
export const DATE_FORMAT_DD_MMM_YYYY: DateFormatSpec = {
  id: 'DD MMM YYYY',
  regex: /^\s*(\d{1,2})\s+([A-Za-z]{3,}),?\s+(\d{4})(?:,?\s+.*)?$/,
  parts: { day: 1, month: 2, year: 3, monthIsAbbr: true },
};

/**
 * `DD/MMM/YYYY` — e.g., `23/Mar/2026`
 */
export const DATE_FORMAT_DD_MMM_YYYY_SLASH: DateFormatSpec = {
  id: 'DD/MMM/YYYY',
  regex: /^\s*(\d{1,2})\/([A-Za-z]{3,})\/(\d{4})(?:,?\s+.*)?$/,
  parts: { day: 1, month: 2, year: 3, monthIsAbbr: true },
};

/**
 * `MMM DD, YYYY` — e.g., `Mar 9, 2026` or `March 09, 2026`. The comma is
 * optional to tolerate copy-paste variants.
 */
export const DATE_FORMAT_MMM_DD_YYYY: DateFormatSpec = {
  id: 'MMM DD, YYYY',
  regex: /^\s*([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+.*)?$/,
  parts: { day: 2, month: 1, year: 3, monthIsAbbr: true },
};

/**
 * Ordered list of all accepted date formats. The Metadata Extractor tries
 * them in order and uses the first match; iteration order matters for
 * determinism (Req 3.6, 6.6).
 */
export const ACCEPTED_DATE_FORMATS: readonly DateFormatSpec[] = Object.freeze([
  DATE_FORMAT_DD_MM_YYYY_SLASH,
  DATE_FORMAT_DD_MM_YYYY_DASH,
  DATE_FORMAT_DD_MMM_YYYY,
  DATE_FORMAT_DD_MMM_YYYY_SLASH,
  DATE_FORMAT_MMM_DD_YYYY,
]);

// ─── Section-Header Predicate ─────────────────────────────────────────────────

/**
 * Heuristic for "this line looks like a section header": all-uppercase or
 * title-case alphabetic words (with optional spaces, hyphens, ampersands,
 * slashes, parentheses, or digits used as panel suffixes), and contains
 * neither a numeric value token nor a unit token.
 *
 * Used by: Text_Cleaner (Req 3.5), Categorizer (Req 8.1).
 *
 * NOTE: This regex matches the structural shape only. Callers must
 * additionally verify (using {@link NUMERIC_VALUE} and {@link UNIT_TOKEN})
 * that the line contains no numeric or unit content — that compound check
 * lives in the consuming sub-module so this file remains tabular.
 */
export const SECTION_HEADER_SHAPE =
  /^[A-Z0-9][A-Z0-9 \-&/()]*$|^[A-Z][a-z]+(?:[ \-&/()][A-Z][a-z]+)*$/;
