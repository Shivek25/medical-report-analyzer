/**
 * src/server/routes/export.route.ts
 * Route handler for POST /api/v1/export
 *
 * Accepts a reportId, generates a PDF summary, and streams the file
 * back to the client as a download.
 */

// TODO (Phase 3): implement PDF generation and response streaming

export const exportRoute = {
  method: 'POST',
  path: '/api/v1/export',
  handler: (): never => {
    throw new Error('exportRoute: not yet implemented');
  },
};
