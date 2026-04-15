import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/reports/**', '**/runtime/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['02-Ingestion/C-htmlGate/123-system.ts', '02-Ingestion/C-htmlGate/run-dynamic-pool.ts'],
      exclude: ['**/reports/**', '**/runtime/**', '**/node_modules/**'],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
    },
  },
});
