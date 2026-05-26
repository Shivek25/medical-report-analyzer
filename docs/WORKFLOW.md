# Feature Workflow — Medical Report Analyzer

## End-to-End Flow

### Step 1 — Upload
1. User opens the app at `/` (HomePage view)
2. Drags a PDF onto the `UploadZone` component, or clicks to browse
3. Client validates file type (`application/pdf`) and size (≤ 10 MB)
4. App sends `POST /api/v1/upload` with `multipart/form-data`
5. Server stores the file in `data/uploads/` and returns an `UploadResponse` with a `fileId`

### Step 2 — Parse
1. Client sends `POST /api/v1/analyze` with `{ fileId }`
2. `analyze.controller.ts` calls `lib/pdf.readPdf(filePath)` → raw text
3. `lib/parser.parseReport(rawText)` → `BloodTestReport`
4. `lib/validator.validateReport(report)` → throws if invalid
5. `BloodTestReport` is persisted to `data/processed/<fileId>.json`

### Step 3 — Summarize
1. `lib/summarizer.generateSummary(report)` builds a prompt from `prompts/`
2. LLM API call returns structured analysis
3. `MedicalSummary` is returned alongside `BloodTestReport` in the `AnalyzeResponse`

### Step 4 — Display
1. App navigates to `ResultsPage`
2. `ReportViewer` renders the structured markers grouped by category
3. `SummaryPanel` displays key findings and recommendations
4. Abnormal markers are highlighted

### Step 5 — Export
1. User clicks `DownloadButton`
2. Client sends `POST /api/v1/export` with `{ reportId }`
3. `lib/exporter.exportSummaryToPdf(summary)` renders HTML → PDF via Puppeteer
4. Server streams the PDF back; browser triggers download
5. Output is also saved to `outputs/<reportId>.pdf`

---

## Error Handling Contract

All API errors return a standard `ApiError` envelope:

```json
{
  "success": false,
  "error": "Human-readable message",
  "code": "SNAKE_CASE_CODE",
  "details": "Stack trace (dev only)"
}
```

| Code | HTTP Status | Meaning |
|---|---|---|
| `INVALID_FILE_TYPE` | 415 | Uploaded file is not a PDF |
| `FILE_TOO_LARGE` | 413 | Upload exceeds 10 MB |
| `PARSE_FAILURE` | 422 | Could not extract markers from PDF |
| `VALIDATION_ERROR` | 422 | Parsed data failed schema validation |
| `SUMMARIZER_ERROR` | 502 | LLM API returned an error |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected error |
