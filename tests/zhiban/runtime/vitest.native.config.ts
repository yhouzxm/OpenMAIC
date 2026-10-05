import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../../../', import.meta.url)) } },
  test: {
    include: ['tests/zhiban/runtime/native-pg.test.ts'],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
