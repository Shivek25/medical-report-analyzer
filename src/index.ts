/**
 * Medical Report Analyzer — Application Entry Point
 *
 * Phase 0: Placeholder bootstrap.
 * Phase 1 will wire up the Express/Hono server here.
 */

import { logger } from './shared/logger.js';

logger.info('Medical Report Analyzer starting…');

// Bootstrap server
import { createServer } from './server/index.js';
import { config } from './shared/config.js';

const app = createServer();
app.listen(config.PORT, () => logger.info(`Server ready on port ${config.PORT}`));
