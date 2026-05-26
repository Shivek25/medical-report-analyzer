/**
 * src/shared/constants.ts
 * Application-wide constants. No business logic here.
 */

export const APP_NAME = 'Medical Report Analyzer';
export const APP_VERSION = '0.1.0';

/** Supported MIME types for PDF uploads */
export const ALLOWED_MIME_TYPES = ['application/pdf'] as const;

/** Maximum upload size in bytes (10 MB) */
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

/** API route prefix */
export const API_PREFIX = '/api/v1';

/** Supported marker status labels */
export const MARKER_STATUSES = [
  'normal',
  'high',
  'low',
  'critical-high',
  'critical-low',
  'unknown',
] as const;
