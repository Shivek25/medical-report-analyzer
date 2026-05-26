import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/*.d.ts'],
    },
    reporter: 'verbose',
  },
  resolve: {
    alias: {
      '@lib': resolve(__dirname, './src/lib'),
      '@server': resolve(__dirname, './src/server'),
      '@shared': resolve(__dirname, './src/shared'),
      '@components': resolve(__dirname, './src/components'),
      '@views': resolve(__dirname, './src/views'),
    },
  },
});
