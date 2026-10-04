import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'browser.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 10_000,
  globalTimeout: 120_000,
  reporter: 'list',
  outputDir: process.env.B0_OUTPUT_DIR || 'tests/zhiban/openmaic/.results',
  use: {
    browserName: 'chromium',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: {
      executablePath: process.env.B0_BROWSER_EXECUTABLE || undefined,
      args: [
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--no-first-run',
      ],
    },
  },
});
