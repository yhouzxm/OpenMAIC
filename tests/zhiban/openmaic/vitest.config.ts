import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/zhiban/openmaic/**/*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    // Intentionally no root setup, dotenv, Next or native application host.
  },
});
