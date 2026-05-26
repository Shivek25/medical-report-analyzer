# Architecture — Medical Report Analyzer

## Overview

The Medical Report Analyzer is a single-repository TypeScript application that:
1. Accepts a blood test PDF upload from the user
2. Extracts and structures the report data
3. Generates a human-readable medical summary via an LLM
4. Exports the summary as a downloadable PDF

---

## Directory Map

```
medical-report-analyzer/
├── src/                      # All application source code
│   ├── index.ts              # Application entry point
│   ├── components/           # Reusable UI widgets
│   │   ├── UploadZone/       # Drag-and-drop file picker
│   │   ├── ReportViewer/     # Structured marker display
│   │   ├── SummaryPanel/     # LLM summary display
│   │   └── DownloadButton/   # Export trigger
│   ├── views/                # Page-level compositions
│   │   ├── HomePage/         # Upload entry page
│   │   ├── AnalysisPage/     # Processing progress page
│   │   └── ResultsPage/      # Report + summary display
│   ├── lib/                  # Core domain logic (no HTTP coupling)
│   │   ├── types/            # All TypeScript interfaces
│   │   ├── pdf/              # PDF reading (text extraction)
│   │   ├── parser/           # Raw text → BloodTestReport
│   │   ├── validator/        # Schema + range validation
│   │   ├── summarizer/       # LLM summary generation
│   │   └── exporter/         # Summary → downloadable PDF
│   ├── server/               # HTTP API layer
│   │   ├── routes/           # Route definitions (upload, analyze, export)
│   │   ├── middleware/       # Error handling, auth (future)
│   │   └── controllers/      # Orchestration per route
│   └── shared/               # Cross-cutting utilities
│       ├── logger.ts         # Structured JSON logger
│       ├── config.ts         # Environment variable reader
│       ├── constants.ts      # App-wide constants
│       └── utils.ts          # Pure utility functions
├── tests/
│   ├── unit/                 # Pure function tests
│   ├── integration/          # HTTP route tests
│   └── fixtures/             # Sample PDFs for testing
├── data/
│   ├── samples/              # Reference PDFs (checked in)
│   ├── uploads/              # Runtime upload target (git-ignored)
│   └── processed/            # Intermediate JSON output (git-ignored)
├── docs/                     # Design documentation
├── prompts/                  # LLM prompt specs
├── scripts/                  # Developer utilities
├── outputs/                  # Generated report PDFs (git-ignored)
├── config/                   # Runtime configuration schema
└── [root files]              # package.json, tsconfig, .env.example, etc.
```

---

## Data Flow

```
User uploads PDF
      │
      ▼
server/routes/upload.route.ts
      │  stores file → data/uploads/
      ▼
server/controllers/analyze.controller.ts
      │
      ├─► lib/pdf          → extract raw text
      ├─► lib/parser       → BloodTestReport
      ├─► lib/validator    → validate structure & ranges
      ├─► lib/summarizer   → MedicalSummary  (calls LLM)
      └─► lib/exporter     → PDF file → outputs/
```

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| `lib/` has zero HTTP dependency | Keeps domain logic independently testable |
| All types in `lib/types/index.ts` | Single source of truth — no type drift between layers |
| Barrel exports on every module | Clean `@lib`, `@server`, `@shared` path imports |
| `shared/config.ts` reads env once | Config is validated at startup; downstream modules receive typed values |
| `it.todo()` stubs in tests | Documents expected behavior before implementation; runs green on Day 0 |

---

## Module Coupling Rules

- `lib/*` must NOT import from `server/*` or `components/*`
- `server/*` may import from `lib/*` and `shared/*`
- `components/*` and `views/*` may import from `lib/types/*` and `shared/*`
- `shared/*` has no internal dependencies
