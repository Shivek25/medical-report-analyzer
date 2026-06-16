/**
 * src/views/HomePage/index.ts
 * Landing page — full E2E pipeline UI:
 *   Step 1: Upload & Extract  → POST /api/v1/upload
 *   Step 2: Parse & Summarize → POST /api/v1/analyze
 *   Step 3: Download PDF      → POST /api/v1/export (blob download)
 */

export function renderHomePage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Upload your blood test PDF for instant parsing, summarization, and a downloadable medical report summary.">
  <title>Medical Report Analyzer</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    /* ─── Design Tokens ─────────────────────────────────────────────────── */
    :root {
      --bg:           #0F1117;
      --surface:      #1A1D2E;
      --surface-2:    #232638;
      --border:       #2E3147;
      --primary:      #6366F1;
      --primary-glow: rgba(99,102,241,0.25);
      --primary-hover:#4F52D9;
      --accent:       #22D3EE;
      --success:      #10B981;
      --warning:      #F59E0B;
      --danger:       #EF4444;
      --text:         #E2E8F0;
      --text-muted:   #64748B;
      --text-dim:     #94A3B8;
      --radius-sm:    8px;
      --radius-md:    14px;
      --radius-lg:    20px;
      --shadow:       0 8px 32px rgba(0,0,0,0.4);
      --transition:   0.2s cubic-bezier(0.4,0,0.2,1);
    }

    /* ─── Reset & Base ──────────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem 1rem 4rem;
    }

    /* ─── Header ────────────────────────────────────────────────────────── */
    .app-header {
      text-align: center;
      margin-bottom: 2.5rem;
      max-width: 640px;
    }
    .logo-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--primary-glow);
      border: 1px solid var(--primary);
      border-radius: 999px;
      padding: 0.3rem 0.9rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--primary);
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: clamp(1.75rem, 4vw, 2.5rem);
      font-weight: 700;
      background: linear-gradient(135deg, #E2E8F0 30%, #6366F1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      line-height: 1.2;
      margin-bottom: 0.75rem;
    }
    .subtitle {
      color: var(--text-dim);
      font-size: 1rem;
      line-height: 1.6;
    }

    /* ─── Pipeline Steps ────────────────────────────────────────────────── */
    .pipeline-bar {
      display: flex;
      align-items: center;
      gap: 0;
      margin: 0 auto 2rem;
      max-width: 560px;
      width: 100%;
    }
    .step-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.4rem;
      flex: 1;
      opacity: 0.35;
      transition: opacity var(--transition);
    }
    .step-item.active  { opacity: 1; }
    .step-item.done    { opacity: 0.8; }
    .step-dot {
      width: 36px; height: 36px;
      border-radius: 50%;
      background: var(--surface-2);
      border: 2px solid var(--border);
      display: flex; align-items: center; justify-content: center;
      font-size: 0.85rem; font-weight: 600;
      transition: all var(--transition);
    }
    .step-item.active .step-dot {
      background: var(--primary);
      border-color: var(--primary);
      box-shadow: 0 0 0 4px var(--primary-glow);
    }
    .step-item.done .step-dot {
      background: var(--success);
      border-color: var(--success);
    }
    .step-label {
      font-size: 0.7rem;
      font-weight: 500;
      color: var(--text-muted);
      text-align: center;
    }
    .step-item.active .step-label { color: var(--primary); }
    .step-item.done  .step-label  { color: var(--success);  }
    .step-connector {
      flex: 0.3;
      height: 2px;
      background: var(--border);
      margin-bottom: 1.4rem;
    }

    /* ─── Card ──────────────────────────────────────────────────────────── */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 2rem;
      width: 100%;
      max-width: 680px;
      box-shadow: var(--shadow);
    }

    /* ─── Upload Zone ───────────────────────────────────────────────────── */
    .upload-zone {
      border: 2px dashed var(--border);
      border-radius: var(--radius-md);
      padding: 3rem 2rem;
      text-align: center;
      background: var(--surface-2);
      cursor: pointer;
      transition: all var(--transition);
      position: relative;
    }
    .upload-zone:hover,
    .upload-zone.drag-over {
      border-color: var(--primary);
      background: rgba(99,102,241,0.05);
    }
    .upload-zone input[type="file"] {
      position: absolute; inset: 0; opacity: 0; cursor: pointer;
    }
    .upload-icon {
      font-size: 2.5rem; margin-bottom: 0.75rem;
      display: block;
      transition: transform var(--transition);
    }
    .upload-zone:hover .upload-icon { transform: translateY(-3px); }
    .upload-zone-label  {
      font-weight: 600; font-size: 0.95rem; margin-bottom: 0.25rem;
    }
    .upload-zone-sub { color: var(--text-muted); font-size: 0.8rem; }

    /* ─── Buttons ───────────────────────────────────────────────────────── */
    .btn {
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      padding: 0.8rem 1.5rem;
      border: none; border-radius: var(--radius-sm);
      font-family: inherit; font-size: 0.95rem; font-weight: 600;
      cursor: pointer;
      transition: all var(--transition);
      width: 100%;
    }
    .btn-primary {
      background: var(--primary); color: #fff;
      margin-top: 1.25rem;
    }
    .btn-primary:hover:not(:disabled) { background: var(--primary-hover); transform: translateY(-1px); }
    .btn-primary:disabled { background: var(--text-muted); cursor: not-allowed; opacity: 0.6; }
    .btn-download {
      background: linear-gradient(135deg, var(--success), #059669);
      color: #fff; margin-top: 1rem;
    }
    .btn-download:hover { background: linear-gradient(135deg, #059669, #047857); transform: translateY(-1px); }
    .btn-reset {
      background: transparent; color: var(--text-muted);
      border: 1px solid var(--border);
      margin-top: 0.5rem; font-size: 0.85rem;
    }
    .btn-reset:hover { color: var(--text); border-color: var(--text-muted); }
    .btn .spinner {
      width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff; border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ─── File pill ─────────────────────────────────────────────────────── */
    .file-pill {
      display: flex; align-items: center; gap: 0.75rem;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 0.75rem 1rem;
      margin-top: 1rem;
    }
    .file-pill-icon { font-size: 1.4rem; }
    .file-pill-name { font-size: 0.9rem; font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-pill-size { font-size: 0.75rem; color: var(--text-muted); }

    /* ─── Status Banner ─────────────────────────────────────────────────── */
    .status-banner {
      display: flex; align-items: flex-start; gap: 0.75rem;
      padding: 0.9rem 1rem;
      border-radius: var(--radius-sm);
      font-size: 0.875rem;
      margin-top: 1.25rem;
      display: none;
    }
    .status-banner.show  { display: flex; }
    .status-banner.info  { background: rgba(99,102,241,0.12); border: 1px solid rgba(99,102,241,0.3); color: #a5b4fc; }
    .status-banner.success { background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.35); color: #6EE7B7; }
    .status-banner.warning { background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.35); color: #FCD34D; }
    .status-banner.error   { background: rgba(239,68,68,0.1);  border: 1px solid rgba(239,68,68,0.35);  color: #FCA5A5; }
    .status-banner-icon { font-size: 1rem; flex-shrink: 0; }
    .status-banner-body { display: flex; flex-direction: column; gap: 0.2rem; }
    .status-banner-title { font-weight: 600; }
    .status-banner-detail { opacity: 0.8; font-size: 0.8rem; }

    /* ─── Warning list ──────────────────────────────────────────────────── */
    .warning-list {
      display: none; flex-direction: column; gap: 0.4rem; margin-top: 1rem;
    }
    .warning-list.show { display: flex; }
    .warning-item {
      display: flex; gap: 0.5rem; align-items: flex-start;
      background: rgba(245,158,11,0.08);
      border-left: 3px solid var(--warning);
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      padding: 0.5rem 0.75rem;
      font-size: 0.8rem; color: #FCD34D;
    }

    /* ─── Results ───────────────────────────────────────────────────────── */
    #results-section { display: none; margin-top: 1.5rem; }
    .results-title {
      font-size: 1rem; font-weight: 700;
      display: flex; align-items: center; gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .results-meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }
    .meta-tile {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 0.75rem 1rem;
      text-align: center;
    }
    .meta-tile-value { font-size: 1.5rem; font-weight: 700; }
    .meta-tile-label { font-size: 0.7rem; color: var(--text-muted); margin-top: 0.15rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .meta-tile.abnormal .meta-tile-value { color: var(--danger); }
    .meta-tile.normal   .meta-tile-value { color: var(--success); }
    .meta-tile.uncertain .meta-tile-value { color: var(--warning); }
    .meta-tile.confidence .meta-tile-value { color: var(--accent); }

    /* ─── Findings accordion ────────────────────────────────────────────── */
    .findings-section { margin-top: 1.25rem; }
    .findings-section-title {
      display: flex; align-items: center; justify-content: space-between;
      cursor: pointer;
      padding: 0.6rem 0;
      border-bottom: 1px solid var(--border);
      font-size: 0.85rem; font-weight: 600;
      user-select: none;
    }
    .findings-section-title .badge {
      font-size: 0.7rem; font-weight: 600; padding: 0.15rem 0.5rem;
      border-radius: 999px;
    }
    .badge-red    { background: rgba(239,68,68,0.2);    color: #FCA5A5; }
    .badge-green  { background: rgba(16,185,129,0.2);   color: #6EE7B7; }
    .badge-yellow { background: rgba(245,158,11,0.2);   color: #FCD34D; }
    .findings-body { display: none; padding-top: 0.75rem; }
    .findings-body.open { display: block; }
    .category-group { margin-bottom: 1rem; }
    .category-label {
      font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.07em; color: var(--text-muted);
      margin-bottom: 0.4rem;
    }
    .finding-row {
      display: grid;
      grid-template-columns: 1fr 100px 80px;
      gap: 0.5rem;
      align-items: start;
      padding: 0.5rem 0.75rem;
      border-radius: var(--radius-sm);
      font-size: 0.82rem;
      border: 1px solid var(--border);
      margin-bottom: 0.3rem;
    }
    .finding-row.abnormal { background: rgba(239,68,68,0.06); border-color: rgba(239,68,68,0.2); }
    .finding-row.normal   { background: rgba(16,185,129,0.04); border-color: rgba(16,185,129,0.15); }
    .finding-row.uncertain{ background: rgba(245,158,11,0.05); border-color: rgba(245,158,11,0.2); }
    .finding-name { font-weight: 500; }
    .finding-interp { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.1rem; }
    .finding-value { font-weight: 700; font-size: 0.9rem; text-align: center; }
    .finding-value.abnormal { color: var(--danger); }
    .finding-value.normal   { color: var(--success); }
    .finding-value.uncertain{ color: var(--warning); }
    .finding-ref  { color: var(--text-muted); font-size: 0.75rem; text-align: center; }

    /* ─── Overview box ──────────────────────────────────────────────────── */
    .overview-box {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 1rem 1.25rem;
      font-size: 0.875rem;
      line-height: 1.6;
      color: var(--text-dim);
      margin-bottom: 1.25rem;
    }

    /* ─── Disclaimer ────────────────────────────────────────────────────── */
    .disclaimer {
      font-size: 0.72rem; color: var(--text-muted);
      border-top: 1px solid var(--border);
      margin-top: 1.5rem; padding-top: 1rem;
      line-height: 1.5;
    }

    /* ─── Responsive ────────────────────────────────────────────────────── */
    @media (max-width: 480px) {
      .finding-row { grid-template-columns: 1fr 80px; }
      .finding-ref  { display: none; }
    }
  </style>
</head>
<body>

  <header class="app-header">
    <div class="logo-badge">⚕ Medical AI</div>
    <h1>Medical Report Analyzer</h1>
    <p class="subtitle">
      Upload a blood test PDF — your results will be parsed, summarized,<br>
      and returned as a clean downloadable report.
    </p>
  </header>

  <!-- Pipeline progress bar -->
  <div class="pipeline-bar" id="pipeline-bar" role="progressbar" aria-label="Analysis pipeline steps">
    <div class="step-item active" id="step-1" aria-current="step">
      <div class="step-dot">1</div>
      <span class="step-label">Upload</span>
    </div>
    <div class="step-connector"></div>
    <div class="step-item" id="step-2">
      <div class="step-dot">2</div>
      <span class="step-label">Analyze</span>
    </div>
    <div class="step-connector"></div>
    <div class="step-item" id="step-3">
      <div class="step-dot">3</div>
      <span class="step-label">Export</span>
    </div>
  </div>

  <!-- Main card -->
  <main class="card" role="main" aria-label="Medical report upload and analysis">

    <!-- Upload form (Step 1) -->
    <section id="upload-section" aria-label="Upload PDF report">
      <div class="upload-zone" id="drop-zone" role="button" tabindex="0"
           aria-label="Click or drag to upload a PDF" aria-describedby="upload-hint">
        <span class="upload-icon" aria-hidden="true">📋</span>
        <p class="upload-zone-label" id="file-name-display">Click or drag your PDF here</p>
        <p class="upload-zone-sub" id="upload-hint">Blood test report · PDF only · max 5 MB</p>
        <input type="file" id="file-input" name="report" accept="application/pdf"
               aria-label="Choose PDF file" />
      </div>

      <div class="file-pill" id="file-pill" style="display:none" aria-live="polite">
        <span class="file-pill-icon" aria-hidden="true">📄</span>
        <span class="file-pill-name" id="pill-name">—</span>
        <span class="file-pill-size" id="pill-size">—</span>
      </div>

      <div class="status-banner" id="upload-banner" role="alert" aria-live="polite">
        <span class="status-banner-icon" id="upload-banner-icon" aria-hidden="true"></span>
        <div class="status-banner-body">
          <span class="status-banner-title" id="upload-banner-title"></span>
          <span class="status-banner-detail" id="upload-banner-detail"></span>
        </div>
      </div>

      <button class="btn btn-primary" id="submit-btn" disabled
              aria-label="Upload and analyze the selected PDF">
        <span id="submit-btn-text">Upload &amp; Analyze</span>
      </button>
    </section>

    <!-- Results section (Steps 2+3) -->
    <section id="results-section" aria-label="Analysis results" aria-live="polite">
      <div class="results-title">
        <span aria-hidden="true">✅</span> Analysis Complete
      </div>

      <!-- Warnings -->
      <div class="warning-list" id="warning-list" role="list" aria-label="Pipeline warnings"></div>

      <!-- Key metrics -->
      <div class="results-meta">
        <div class="meta-tile abnormal">
          <div class="meta-tile-value" id="metric-abnormal">—</div>
          <div class="meta-tile-label">Abnormal</div>
        </div>
        <div class="meta-tile normal">
          <div class="meta-tile-value" id="metric-normal">—</div>
          <div class="meta-tile-label">Normal</div>
        </div>
        <div class="meta-tile uncertain">
          <div class="meta-tile-value" id="metric-uncertain">—</div>
          <div class="meta-tile-label">Uncertain</div>
        </div>
        <div class="meta-tile confidence">
          <div class="meta-tile-value" id="metric-confidence">—</div>
          <div class="meta-tile-label">Confidence</div>
        </div>
      </div>

      <!-- Overview -->
      <div class="overview-box" id="overview-box" role="region" aria-label="Overview"></div>

      <!-- Abnormal Findings -->
      <div class="findings-section" id="section-abnormal" role="region">
        <div class="findings-section-title" onclick="toggleSection('abnormal-body')"
             aria-expanded="false" aria-controls="abnormal-body" role="button" tabindex="0">
          <span>⚠️ Abnormal Findings</span>
          <span class="badge badge-red" id="badge-abnormal">0</span>
        </div>
        <div class="findings-body open" id="abnormal-body"></div>
      </div>

      <!-- Uncertain Entries -->
      <div class="findings-section" id="section-uncertain" role="region">
        <div class="findings-section-title" onclick="toggleSection('uncertain-body')"
             aria-expanded="false" aria-controls="uncertain-body" role="button" tabindex="0">
          <span>❓ Uncertain Entries</span>
          <span class="badge badge-yellow" id="badge-uncertain">0</span>
        </div>
        <div class="findings-body" id="uncertain-body"></div>
      </div>

      <!-- Normal Findings -->
      <div class="findings-section" id="section-normal" role="region">
        <div class="findings-section-title" onclick="toggleSection('normal-body')"
             aria-expanded="false" aria-controls="normal-body" role="button" tabindex="0">
          <span>✅ Normal Findings</span>
          <span class="badge badge-green" id="badge-normal">0</span>
        </div>
        <div class="findings-body" id="normal-body"></div>
      </div>

      <!-- Step 3: Download button -->
      <button class="btn btn-download" id="download-btn"
              aria-label="Download the full PDF report summary">
        <span id="download-btn-text">⬇ Download PDF Report</span>
      </button>

      <button class="btn btn-reset" id="reset-btn" aria-label="Start over with a new file">
        ↩ Analyze another report
      </button>

      <!-- Disclaimer -->
      <p class="disclaimer" role="note">
        <strong>Medical Disclaimer:</strong> This report is generated by an automated system and may contain errors.
        It is <strong>not</strong> a substitute for professional medical advice. Always consult a qualified physician
        regarding your laboratory results.
      </p>
    </section>

  </main>

  <script>
    // ─── State ────────────────────────────────────────────────────────────────
    let currentSummary = null;

    // ─── DOM refs ─────────────────────────────────────────────────────────────
    const fileInput      = document.getElementById('file-input');
    const dropZone       = document.getElementById('drop-zone');
    const fileNameDisplay = document.getElementById('file-name-display');
    const filePill       = document.getElementById('file-pill');
    const pillName       = document.getElementById('pill-name');
    const pillSize       = document.getElementById('pill-size');
    const submitBtn      = document.getElementById('submit-btn');
    const submitBtnText  = document.getElementById('submit-btn-text');
    const uploadBanner   = document.getElementById('upload-banner');
    const uploadBannerIcon  = document.getElementById('upload-banner-icon');
    const uploadBannerTitle = document.getElementById('upload-banner-title');
    const uploadBannerDetail = document.getElementById('upload-banner-detail');
    const resultsSection = document.getElementById('results-section');
    const uploadSection  = document.getElementById('upload-section');
    const downloadBtn    = document.getElementById('download-btn');
    const downloadBtnText = document.getElementById('download-btn-text');
    const resetBtn       = document.getElementById('reset-btn');
    const warningList    = document.getElementById('warning-list');

    // ─── Helpers ──────────────────────────────────────────────────────────────
    function fmtSize(bytes) {
      if (bytes < 1024)       return bytes + ' B';
      if (bytes < 1024*1024)  return (bytes/1024).toFixed(1) + ' KB';
      return (bytes/1024/1024).toFixed(2) + ' MB';
    }

    function setStep(active) {
      [1,2,3].forEach(n => {
        const el = document.getElementById('step-' + n);
        el.className = 'step-item';
        if (n < active) el.classList.add('done');
        if (n === active) el.classList.add('active');
      });
    }

    function showBanner(type, title, detail) {
      uploadBanner.className = 'status-banner show ' + type;
      const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
      uploadBannerIcon.textContent  = icons[type] || 'ℹ️';
      uploadBannerTitle.textContent = title;
      uploadBannerDetail.textContent = detail || '';
    }

    function hideBanner() {
      uploadBanner.className = 'status-banner';
    }

    function showWarnings(warnings) {
      if (!warnings || !warnings.length) {
        warningList.className = 'warning-list';
        return;
      }
      warningList.innerHTML = warnings
        .map(w => '<div class="warning-item" role="listitem"><span>⚠</span><span>' + escHtml(w) + '</span></div>')
        .join('');
      warningList.className = 'warning-list show';
    }

    function escHtml(s) {
      return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function setBusy(busy, label) {
      submitBtn.disabled = busy;
      submitBtnText.innerHTML = busy
        ? '<span class="spinner" aria-hidden="true"></span>' + label
        : 'Upload &amp; Analyze';
    }

    function fmtRef(rr) {
      if (!rr) return 'N/A';
      if (rr.text) return escHtml(rr.text);
      if (rr.low !== undefined && rr.high !== undefined) return rr.low + ' – ' + rr.high;
      if (rr.low  !== undefined) return '> ' + rr.low;
      if (rr.high !== undefined) return '< ' + rr.high;
      return 'N/A';
    }

    function buildFindingRow(f, styleClass) {
      const valStr = escHtml(f.value) + (f.unit ? ' <small>' + escHtml(f.unit) + '</small>' : '');
      const refStr = fmtRef(f.referenceRange);
      const interp = escHtml(f.interpretation || f.uncertaintyReason || '');
      return \`<div class="finding-row \${styleClass}" role="listitem">
        <div>
          <div class="finding-name">\${escHtml(f.testName)}</div>
          \${interp ? '<div class="finding-interp">' + interp + '</div>' : ''}
        </div>
        <div class="finding-value \${styleClass}">\${valStr}</div>
        <div class="finding-ref">\${refStr}</div>
      </div>\`;
    }

    function buildNormalRow(e) {
      const valStr = escHtml(e.value) + (e.unit ? ' <small>' + escHtml(e.unit) + '</small>' : '');
      const refStr = fmtRef(e.referenceRange);
      return \`<div class="finding-row normal" role="listitem">
        <div>
          <div class="finding-name">\${escHtml(e.testName)}</div>
        </div>
        <div class="finding-value normal">\${valStr}</div>
        <div class="finding-ref">\${refStr}</div>
      </div>\`;
    }

    function buildGroupedSection(groups, rowBuilder) {
      if (!groups || !groups.length) return '<p style="color:var(--text-muted);font-size:0.8rem;padding:0.5rem 0">None</p>';
      return groups.map(g => \`
        <div class="category-group">
          <div class="category-label">\${escHtml(g.category)}</div>
          <div role="list">\${(g.findings || g.entries || []).map(rowBuilder).join('')}</div>
        </div>\`).join('');
    }

    function renderResults(data) {
      const { summary, warnings } = data;
      currentSummary = summary;

      showWarnings(warnings);

      // Metrics
      document.getElementById('metric-abnormal').textContent   = summary.generationMeta.abnormalCount;
      document.getElementById('metric-normal').textContent     = summary.generationMeta.normalCount;
      document.getElementById('metric-uncertain').textContent  = summary.generationMeta.uncertainCount;
      document.getElementById('metric-confidence').textContent = Math.round(summary.generationMeta.sourceConfidence * 100) + '%';

      // Overview
      document.getElementById('overview-box').textContent = summary.overviewText || '';

      // Abnormal
      document.getElementById('badge-abnormal').textContent = summary.generationMeta.abnormalCount;
      document.getElementById('abnormal-body').innerHTML =
        buildGroupedSection(summary.abnormalFindings, f => buildFindingRow(f, 'abnormal'));

      // Uncertain
      document.getElementById('badge-uncertain').textContent = summary.generationMeta.uncertainCount;
      if (summary.uncertainEntries && summary.uncertainEntries.length) {
        document.getElementById('uncertain-body').innerHTML =
          '<div role="list">' + summary.uncertainEntries.map(f => buildFindingRow(f, 'uncertain')).join('') + '</div>';
      } else {
        document.getElementById('uncertain-body').innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;padding:0.5rem 0">None</p>';
      }

      // Normal
      document.getElementById('badge-normal').textContent = summary.generationMeta.normalCount;
      document.getElementById('normal-body').innerHTML =
        buildGroupedSection(summary.normalFindings, e => buildNormalRow(e));

      // Show results, hide upload
      uploadSection.style.display = 'none';
      resultsSection.style.display = 'block';
      setStep(3);
    }

    function toggleSection(id) {
      const body = document.getElementById(id);
      const title = body.previousElementSibling;
      const isOpen = body.classList.toggle('open');
      title.setAttribute('aria-expanded', isOpen);
    }

    // ─── File selection ────────────────────────────────────────────────────────
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (f) {
        fileNameDisplay.textContent = 'Selected:';
        pillName.textContent = f.name;
        pillSize.textContent = fmtSize(f.size);
        filePill.style.display = 'flex';
        submitBtn.disabled = false;
        hideBanner();
      }
    });

    // Drop zone
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        fileInput.dispatchEvent(new Event('change'));
      }
    });
    dropZone.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });

    // ─── Main submit handler ───────────────────────────────────────────────────
    submitBtn.addEventListener('click', async () => {
      const file = fileInput.files[0];
      if (!file) return;

      hideBanner();

      // ── Step 1: Upload ───────────────────────────────────────────────────
      setStep(1);
      setBusy(true, 'Uploading…');

      const formData = new FormData();
      formData.append('report', file);

      let ingestionResult;
      try {
        const uploadRes = await fetch('/api/v1/upload', { method: 'POST', body: formData });
        const uploadData = await uploadRes.json();

        if (!uploadRes.ok || !uploadData.success) {
          throw new Error(uploadData.error || 'Upload failed');
        }

        ingestionResult = uploadData.result;

        if (ingestionResult.extractionStatus === 'failed') {
          const errs = (ingestionResult.warningsOrErrors || []).join(' ');
          showBanner('error', 'Extraction Failed', errs || 'The PDF could not be read. Please check the file and try again.');
          setBusy(false);
          return;
        }

        if (ingestionResult.extractionStatus === 'scanned_fallback') {
          showBanner('warning', 'Scanned PDF Detected',
            'Very little text was extracted. This may be a scanned image; results may be incomplete.');
        }

      } catch (err) {
        showBanner('error', 'Upload Error', err.message);
        setBusy(false);
        return;
      }

      // ── Step 2: Analyze ──────────────────────────────────────────────────
      setStep(2);
      setBusy(true, 'Analyzing…');

      try {
        const analyzeRes = await fetch('/api/v1/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ingestionResult)
        });
        const analyzeData = await analyzeRes.json();

        if (!analyzeRes.ok || !analyzeData.success) {
          throw new Error(analyzeData.error || 'Analysis failed');
        }

        setBusy(false);
        renderResults(analyzeData);

      } catch (err) {
        showBanner('error', 'Analysis Error', err.message);
        setBusy(false);
        setStep(1);
      }
    });

    // ─── Download handler (Step 3) ─────────────────────────────────────────────
    downloadBtn.addEventListener('click', async () => {
      if (!currentSummary) return;

      downloadBtnText.innerHTML = '<span class="spinner" aria-hidden="true"></span> Generating PDF…';
      downloadBtn.disabled = true;

      try {
        const res = await fetch('/api/v1/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(currentSummary)
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'PDF generation failed');
        }

        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = 'Medical_Report_Summary.pdf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

      } catch (err) {
        // Show error inside results section without hiding results
        showWarnings([...( currentSummary ? [] : []), 'PDF Export failed: ' + err.message]);
        warningList.className = 'warning-list show';
      } finally {
        downloadBtnText.textContent = '⬇ Download PDF Report';
        downloadBtn.disabled = false;
      }
    });

    // ─── Reset ─────────────────────────────────────────────────────────────────
    resetBtn.addEventListener('click', () => {
      currentSummary = null;
      fileInput.value = '';
      fileNameDisplay.textContent = 'Click or drag your PDF here';
      filePill.style.display = 'none';
      submitBtn.disabled = true;
      hideBanner();
      warningList.className = 'warning-list';
      uploadSection.style.display = '';
      resultsSection.style.display = 'none';
      setStep(1);
    });
  </script>
</body>
</html>`;
}
