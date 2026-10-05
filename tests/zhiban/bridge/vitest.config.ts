import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@': resolve(process.cwd()) } },
  test: {
    include: ['tests/zhiban/bridge/native-pg.test.ts', 'tests/zhiban/bridge/browser.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
