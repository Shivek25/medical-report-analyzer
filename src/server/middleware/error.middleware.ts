/**
 * src/server/middleware/error.middleware.ts
 * Global error handler — catches all unhandled errors and returns
 * a consistent ApiError JSON response.
 *
 * Phase 1 will implement this for the chosen HTTP framework.
 */

import type { ApiError } from '../../lib/types/index.js';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

/**
 * Format any caught error as a standard ApiError envelope.
 */
export function formatErrorResponse(err: AppError): ApiError {
  return {
    success: false,
    error: err.message ?? 'An unexpected error occurred',
    code: err.code ?? 'INTERNAL_SERVER_ERROR',
    details: process.env['NODE_ENV'] === 'development' ? err.stack : undefined,
  };
}

// TODO (Phase 1): export Express / Hono error middleware function
