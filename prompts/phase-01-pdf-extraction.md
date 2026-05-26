# Phase 1 — PDF Extraction Prompt Spec

> **Status:** Draft — implement in Phase 1

## Objective

Given raw text extracted from a blood test PDF report, extract all biomarker rows into structured JSON.

## Input

```
{raw_text}
```

## Required Output Format

Return a JSON array of objects matching this schema:

```json
[
  {
    "name": "Haemoglobin",
    "value": 13.5,
    "unit": "g/dL",
    "referenceRange": { "low": 12.0, "high": 16.0 },
    "status": "normal",
    "category": "Complete Blood Count"
  }
]
```

## Rules

1. Extract only rows that represent clinical biomarkers (ignore headers, footers, lab info)
2. `status` must be one of: `normal`, `high`, `low`, `critical-high`, `critical-low`, `unknown`
3. Determine status by comparing `value` to `referenceRange`
4. If a reference range is text-only (e.g. "Negative"), set `referenceRange.text` and status to `normal` or `unknown`
5. Preserve the original `unit` string exactly as printed
6. Group markers by `category` if the report contains section headings

## Edge Cases to Handle

- Values reported as `< 0.5` or `> 120` — parse as boundary strings
- Missing reference range — set `referenceRange: {}` and `status: "unknown"`
- Qualitative results (Positive / Negative / Reactive) — set value as string
