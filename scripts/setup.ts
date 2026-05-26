/**
 * scripts/setup.ts
 * Development environment sanity check.
 * Run with: npm run setup
 *
 * Checks:
 *   1. Node.js version is >= 20
 *   2. Required directories exist
 *   3. .env file is present (warns if missing)
 */

import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

const ROOT = resolve(import.meta.dirname, '..');

function check(label: string, pass: boolean, hint?: string): void {
  const icon = pass ? '✅' : '❌';
  console.info(`${icon} ${label}`);
  if (!pass && hint) console.info(`   → ${hint}`);
}

// 1. Node version
const nodeVersion = parseInt(process.versions.node.split('.')[0]!, 10);
check('Node.js >= 20', nodeVersion >= 20, `Current version: ${process.versions.node}. Upgrade to v20+.`);

// 2. Required runtime directories
const REQUIRED_DIRS = [
  'data/samples',
  'data/uploads',
  'data/processed',
  'outputs',
];

for (const dir of REQUIRED_DIRS) {
  const fullPath = resolve(ROOT, dir);
  if (!existsSync(fullPath)) {
    mkdirSync(fullPath, { recursive: true });
    check(`Created ${dir}`, true);
  } else {
    check(`Directory exists: ${dir}`, true);
  }
}

// 3. .env file
const envPath = resolve(ROOT, '.env');
check(
  '.env file present',
  existsSync(envPath),
  'Copy .env.example to .env and fill in your values.',
);

// 4. TypeScript check
try {
  execSync('npx tsc --noEmit', { cwd: ROOT, stdio: 'pipe' });
  check('TypeScript compiles without errors', true);
} catch {
  check('TypeScript compiles without errors', false, 'Run `npx tsc --noEmit` to see errors.');
}

console.info('\n🚀 Setup complete. Run `npm test` to verify the test suite.');
