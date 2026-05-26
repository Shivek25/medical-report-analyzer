# tests/fixtures/

This directory contains sample PDF files used as test fixtures.

## Contents

| File | Description |
|---|---|
| `sample.pdf` | Generic lab report — baseline extraction test |
| `shivek_June25.pdf` | Full blood panel with multiple categories |
| `shivek_March26.pdf` | Multi-page report with extended markers |
| `shivek_urm_March26.pdf` | URM format report for format-variance testing |

## Usage

Reference these files in unit and integration tests:

```typescript
import { resolve } from 'path';

const FIXTURES_DIR = resolve(import.meta.dirname, '../fixtures');
const samplePdf = resolve(FIXTURES_DIR, 'sample.pdf');
```

## Adding Fixtures

- Add new PDFs here when testing edge cases
- Anonymize any real patient data before committing
- Document each fixture's purpose in the table above
