# prompts/

This directory holds prompt specifications used by `lib/summarizer` to call the LLM.

## Naming Convention

`phase-<N>-<feature>.md`

## Files

| File | Status | Purpose |
|---|---|---|
| `phase-01-pdf-extraction.md` | Phase 1 | Instructions for extracting markers from raw text |
| `phase-02-summary-generation.md` | Phase 2 | Instructions for generating a MedicalSummary |

---

## Usage

Prompt files are read at runtime by `lib/summarizer/index.ts` and injected as the system prompt or user message depending on the LLM provider's convention.

Keep prompts as plain Markdown or text — no code logic inside prompt files.
