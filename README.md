# Medical Report Analyzer

> Upload a blood test PDF → get a structured, readable medical summary → download as PDF.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node.js-20+-green)](https://nodejs.org/)
[![Vitest](https://img.shields.io/badge/Tests-Vitest-yellow)](https://vitest.dev/)

---

## What It Does

1. **Upload** a blood test report PDF
2. **Extract** biomarker values, reference ranges, and patient metadata
3. **Summarize** findings using an LLM (key findings, recommendations)
4. **Export** the summary as a clean, downloadable PDF

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Fill in OPENAI_API_KEY and adjust paths if needed

# 3. Run the dev environment sanity check
npm run setup

# 4. Run tests
npm test

# 5. Type-check
npm run typecheck

# 6. Start the dev server (Phase 1+)
npm run dev
```

---

## Project Structure

```
src/
├── components/        # Reusable UI widgets
├── views/             # Page-level compositions
├── lib/               # Core domain logic (no HTTP)
│   ├── types/         #   TypeScript interfaces
│   ├── pdf/           #   PDF text extraction
│   ├── parser/        #   Raw text → BloodTestReport
│   ├── validator/     #   Zod schema validation
│   ├── summarizer/    #   LLM-powered summary
│   └── exporter/      #   Summary → PDF
├── server/            # HTTP API layer
│   ├── routes/        #   /api/v1/upload, /analyze, /export
│   ├── middleware/    #   Error handling
│   └── controllers/   #   Route orchestrators
└── shared/            # Logger, config, constants, utils

tests/
├── unit/              # Pure function tests
├── integration/       # HTTP route tests
└── fixtures/          # Sample PDFs

data/samples/          # Reference PDFs (checked in)
docs/                  # Architecture, workflow, phases
prompts/               # LLM prompt specifications
outputs/               # Generated PDFs (git-ignored)
```

→ Full architecture details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
→ Step-by-step workflow: [`docs/WORKFLOW.md`](docs/WORKFLOW.md)
→ Phase roadmap: [`docs/PHASES.md`](docs/PHASES.md)

---

## Implementation Phases

| Phase | Status | Description |
|---|---|---|
| **0** | ✅ Complete | Project scaffold, types, shared utilities |
| **1** | 🔜 Next | PDF extraction, parsing, validation, upload API |
| **2** | ⬜ Planned | LLM summarization |
| **3** | ⬜ Planned | PDF export |
| **4** | ⬜ Planned | Auth, cloud storage, deployment |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.x |
| Runtime | Node.js 20+ |
| Testing | Vitest |
| Linting | ESLint + TypeScript ESLint |
| Formatting | Prettier |
| PDF Reading | pdf-parse / pdfjs-dist (Phase 1) |
| LLM | OpenAI / Gemini SDK (Phase 2) |
| PDF Export | Puppeteer / pdf-lib (Phase 3) |

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm test` | Run test suite |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Lint `src/` and `tests/` |
| `npm run format` | Format all TypeScript files |
| `npm run setup` | Environment sanity check |

---

## License

MIT
