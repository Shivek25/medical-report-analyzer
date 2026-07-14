# Phase 6 — LLM-Assisted Structured Extraction Prompt Spec

> **Status:** Implemented (provider-agnostic). No external provider is wired yet;
> the system ships a deterministic stub `LlmClient` and falls back to the Phase 2
> deterministic parser. This document is the contract any future provider
> adapter (OpenAI, Anthropic, …) MUST honour.

## Objective

Classify candidate text blocks from a medical-report PDF into exactly one of
five labels and, for lab results only, emit a normalized field set. The model
is used **only** as a bounded classifier + normalizer — never as a free-form
writer. The deterministic Phase 2 parser remains the fallback and the final
validation gate.

## Input (per batch)

```json
{
  "blocks": [
    { "text": "HEMOGLOBIN 13.2 g/dL 13.0-17.0", "lineStart": 41, "lineEnd": 41, "page": 1 }
  ],
  "reportContext": { "labName": "Thyrocare", "detectedLanguage": "en" }
}
```

## Required Output Format (strict JSON)

Return a JSON object with a single `items` array, one entry per input block,
aligned by `blockIndex`:

```json
{
  "items": [
    {
      "blockIndex": 0,
      "label": "lab_result",
      "evidence": "HEMOGLOBIN 13.2 g/dL 13.0-17.0",
      "confidence": 0.9,
      "reason": "analyte + value + unit + numeric range",
      "normalized": {
        "testName": "HEMOGLOBIN",
        "value": "13.2",
        "unit": "g/dL",
        "referenceRange": { "text": "13.0-17.0" }
      }
    }
  ]
}
```

## Labels (exhaustive, mutually exclusive)

| label            | meaning                                            | may produce a finding? |
|------------------|----------------------------------------------------|------------------------|
| `metadata`       | patient / lab / date boilerplate                   | no                     |
| `section_header` | panel / category heading (e.g. "LIPID PROFILE")    | no (used for category) |
| `lab_result`     | a genuine, evidence-backed lab result row          | **yes**                |
| `noise`          | address, contact, disclaimer, descriptor, label    | no                     |
| `uncertain`      | cannot confidently place the block                 | no                     |

## Rules

1. Emit **exactly one** item per input block, in input order, with the matching
   `blockIndex`.
2. `evidence` MUST be a verbatim substring of the block's `text`. Do not
   paraphrase, translate, or invent. The validation gate rejects any item whose
   `normalized` fields are not traceable into `evidence`.
3. Set `normalized` **only** for `lab_result`. Set `category` only for
   `section_header`. Set `metadataField` + `metadataValue` only for `metadata`.
4. `confidence` is a number in `[0, 1]`. When unsure, lower it and prefer the
   `uncertain` label over a guess.
5. **Never fabricate missing values.** If a block has a test name but no value,
   label it `uncertain` — do not invent a value.
6. Reject as `noise`: bare descriptors ("Calculated", "Flow Cytometry"),
   column labels ("UNITS", "VALUE"), report-status lines, addresses, contacts,
   risk-classification tables ("Physician Review 80-89"), and boilerplate.
7. Do not redact or summarize the evidence; copy it verbatim.
8. Output JSON only — no markdown fences, no commentary.

## Conservative behaviour

- When confidence < the configured threshold (default `0.5`), the extraction
  stage demotes the item to `uncertain` rather than emitting it as a finding.
- When the LLM batch fails or yields too few findings, the route falls back to
  the deterministic parser.
