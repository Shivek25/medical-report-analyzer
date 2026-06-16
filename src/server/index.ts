/**
 * src/server/index.ts
 * HTTP server factory — bootstraps middleware, routes, and error handling.
 */

import express, { Express } from 'express';
import cors from 'cors';
import { uploadRoute } from './routes/upload.route.js';
import { analyzeRoute } from './routes/analyze.route.js';
import { exportRoute } from './routes/export.route.js';
import { viewRoute } from './routes/view.route.js';
import { logger } from '../shared/logger.js';

export function createServer(): Express {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Mount API Routes
  app.use('/api/v1', uploadRoute);
  app.post('/api/v1/analyze', analyzeRoute.handler);
  app.post('/api/v1/export', exportRoute.handler);

  // Mount UI Routes
  app.use('/', viewRoute);

  // Global Error Handler
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error('Unhandled request error', { error: err.message });
    if (err.message && err.message.includes('Only PDF files')) {
       res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
       return;
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ success: false, error: 'File too large (limit is 5MB)', code: 'VALIDATION_ERROR' });
        return;
    }
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
      details: err.message,
    });
  });

  return app;
}
