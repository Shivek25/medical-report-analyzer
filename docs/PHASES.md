# Implementation Phases

## Phase 0 — Foundation (current) ✅
- TypeScript project scaffold
- Directory structure
- Type definitions (`BloodTestReport`, `ParsedMarker`, `MedicalSummary`)
- Shared utilities (logger, config, constants)
- Test infrastructure with vitest
- Documentation and workflow specs

## Phase 1 — PDF Extraction & Parsing
- Choose and integrate HTTP framework (Express or Hono)
- Implement `lib/pdf` using `pdf-parse` or `pdfjs-dist`
- Implement `lib/parser` — regex-based marker extraction
- Implement `lib/validator` — Zod schemas
- Wire upload and analyze routes end-to-end
- Build basic frontend upload form

## Phase 2 — LLM Summarization
- Finalize prompt engineering in `prompts/`
- Implement `lib/summarizer` with OpenAI / Gemini SDK
- Add retry and error handling for LLM calls
- Build `SummaryPanel` component

## Phase 3 — PDF Export
- Implement `lib/exporter` using Puppeteer or `pdf-lib`
- Design HTML report template
- Wire export route
- Build `DownloadButton` component

## Phase 4 — Polish & Production
- Authentication / rate limiting
- Cloud storage for uploads and outputs
- Deployment (Docker / Netlify / Railway)
- End-to-end browser tests with Playwright
- Performance optimization and error telemetry
