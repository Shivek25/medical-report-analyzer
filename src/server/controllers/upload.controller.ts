/**
 * src/server/controllers/upload.controller.ts
 * Orchestrates the upload flow: validate → store → respond.
 *
 * Phase 1 implementation will call lib/pdf and return UploadResponse.
 */

import type { UploadResponse } from '../../lib/types/index.js';

export async function handleUpload(_file: unknown): Promise<UploadResponse> {
  // TODO (Phase 1): validate MIME type and size
  // TODO (Phase 1): persist file to PDF_UPLOAD_DIR
  // TODO (Phase 1): return UploadResponse
  throw new Error('handleUpload: not yet implemented');
}
