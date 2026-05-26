# outputs/

Generated PDF summaries are saved here at runtime.

**This directory is git-ignored** — do not commit generated files.

## Structure

```
outputs/
└── <reportId>.pdf     # Generated summary PDF per analyzed report
```

Files are named by their report ID (UUID) and overwritten if re-analyzed.
