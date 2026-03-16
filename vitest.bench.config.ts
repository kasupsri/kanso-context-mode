import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/kanso-benchmarks/**/*.test.ts'],
    timeout: 30000,
  },
  resolve: {
    conditions: ['node', 'import'],
  },
});
