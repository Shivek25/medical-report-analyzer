/**
 * src/views/HomePage/index.ts
 * Landing page — presents the upload interface.
 * Phase 1 (UI): implemented using static HTML and vanilla JS for simplicity.
 */

export function renderHomePage(): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Medical Report Analyzer</title>
  <style>
    :root {
      --primary: #4F46E5;
      --primary-hover: #4338CA;
      --bg: #F3F4F6;
      --card-bg: #FFFFFF;
      --text-main: #1F2937;
      --text-muted: #6B7280;
      --border: #E5E7EB;
      --success: #10B981;
      --error: #EF4444;
    }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      margin: 0;
      padding: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .container {
      background: var(--card-bg);
      padding: 2.5rem;
      border-radius: 16px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05);
      width: 100%;
      max-width: 600px;
    }
    h1 {
      margin-top: 0;
      font-size: 1.75rem;
      color: var(--text-main);
      text-align: center;
    }
    p.subtitle {
      text-align: center;
      color: var(--text-muted);
      margin-bottom: 2rem;
    }
    .upload-zone {
      border: 2px dashed var(--primary);
      border-radius: 12px;
      padding: 3rem 2rem;
      text-align: center;
      background: #F8FAFC;
      transition: all 0.2s ease-in-out;
      cursor: pointer;
    }
    .upload-zone:hover {
      background: #EFF6FF;
      border-color: var(--primary-hover);
    }
    .upload-zone input[type="file"] {
      display: none;
    }
    .upload-label {
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
    }
    .upload-icon {
      font-size: 3rem;
      color: var(--primary);
    }
    .btn {
      background: var(--primary);
      color: white;
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 1rem;
      cursor: pointer;
      width: 100%;
      margin-top: 1.5rem;
      transition: background 0.2s;
    }
    .btn:hover {
      background: var(--primary-hover);
    }
    .btn:disabled {
      background: var(--text-muted);
      cursor: not-allowed;
    }
    #result-view {
      display: none;
      margin-top: 2rem;
      padding-top: 2rem;
      border-top: 1px solid var(--border);
    }
    .result-card {
      background: #F9FAFB;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.5rem;
    }
    pre {
      background: #111827;
      color: #E5E7EB;
      padding: 1rem;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 0.875rem;
    }
    .status-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      background: var(--success);
      color: white;
    }
    .status-badge.error {
      background: var(--error);
    }
    .status-badge.warning {
      background: #F59E0B;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Medical Report Analyzer</h1>
    <p class="subtitle">Upload your blood test PDF for secure parsing and analysis.</p>

    <form id="upload-form">
      <div class="upload-zone" id="drop-zone">
        <label class="upload-label">
          <span class="upload-icon">📄</span>
          <span id="file-name-display">Click or drag PDF to select</span>
          <input type="file" id="file-input" name="file" accept="application/pdf" required />
        </label>
      </div>
      <button type="submit" class="btn" id="submit-btn" disabled>Upload and Analyze</button>
    </form>

    <div id="result-view">
      <h3>Extraction Result</h3>
      <div class="result-card">
        <p><strong>File:</strong> <span id="res-filename"></span></p>
        <p><strong>Status:</strong> <span id="res-status" class="status-badge"></span></p>
        <p id="res-notes" style="color: var(--error); font-size: 0.875rem;"></p>
        <h4>Raw Extracted Text:</h4>
        <pre id="res-text"></pre>
      </div>
    </div>
  </div>

  <script>
    const form = document.getElementById('upload-form');
    const fileInput = document.getElementById('file-input');
    const fileNameDisplay = document.getElementById('file-name-display');
    const submitBtn = document.getElementById('submit-btn');
    const dropZone = document.getElementById('drop-zone');
    const resultView = document.getElementById('result-view');

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        fileNameDisplay.textContent = file.name;
        submitBtn.disabled = false;
      } else {
        fileNameDisplay.textContent = 'Click or drag PDF to select';
        submitBtn.disabled = true;
      }
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--primary-hover)';
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--primary)';
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--primary)';
      if (e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        fileInput.dispatchEvent(new Event('change'));
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (!fileInput.files[0]) return;

      submitBtn.textContent = 'Uploading...';
      submitBtn.disabled = true;

      const formData = new FormData();
      formData.append('report', fileInput.files[0]);

      try {
        const response = await fetch('/api/v1/upload', {
          method: 'POST',
          body: formData
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.success) {
          throw new Error(data.error || data.message || 'Upload failed');
        }

        const result = data.result;
        
        document.getElementById('res-filename').textContent = result.originalFilename;
        
        const statusBadge = document.getElementById('res-status');
        statusBadge.textContent = result.extractionStatus;
        statusBadge.className = 'status-badge'; // reset
        if (result.extractionStatus === 'failed') statusBadge.classList.add('error');
        if (result.extractionStatus === 'scanned_fallback') statusBadge.classList.add('warning');

        const notesText = result.extractionNotes || '';
        const errorsText = result.warningsOrErrors ? result.warningsOrErrors.join('\\n') : '';
        document.getElementById('res-notes').innerText = [notesText, errorsText].filter(Boolean).join('\\n\\n');
        
        document.getElementById('res-text').textContent = result.extractedText || 'No text extracted.';
        
        resultView.style.display = 'block';

      } catch (err) {
        alert('Error: ' + err.message);
      } finally {
        submitBtn.textContent = 'Upload and Analyze';
        submitBtn.disabled = false;
      }
    });
  </script>
</body>
</html>
  `;
}
