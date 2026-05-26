# data/

## Subdirectories

| Directory | Purpose | Git status |
|---|---|---|
| `samples/` | Reference PDFs used as development fixtures | ✅ Tracked |
| `uploads/` | Runtime upload target — created by setup script | ❌ Ignored |
| `processed/` | Intermediate JSON output from parser | ❌ Ignored |

## Adding Sample Files

Drop anonymized PDF reports in `samples/` and document them in `tests/fixtures/README.md`.
Never commit real patient data.
