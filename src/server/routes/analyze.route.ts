/**
 * src/server/routes/analyze.route.ts
 * Route handler for POST /api/v1/analyze
 *
 * Accepts a fileId, runs the full parse → validate → summarize pipeline,
 * and returns a structured AnalyzeResponse.
 */

// TODO (Phase 1): implement parse pipeline
// TODO (Phase 2): integrate LLM summarizer

export const analyzeRoute = {
  method: 'POST',
  path: '/api/v1/analyze',
  handler: (): never => {
    throw new Error('analyzeRoute: not yet implemented');
  },
};
