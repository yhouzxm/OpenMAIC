import { defineConfig, devices } from '@playwright/test';

const systemBrowser = process.env.PLAYWRIGHT_USE_SYSTEM_EDGE === 'true' ? { channel: 'msedge' as const } : {};

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'html' : 'list',
  use: {
    baseURL: 'http://localhost:3002',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...systemBrowser },
    },
  ],
  webServer: {
    command: process.env.CI ? 'pnpm build && pnpm start' : 'pnpm exec next dev --webpack',
    url: 'http://localhost:3002/zhiban/login',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    // Enable the MAIC Editor (Pro mode) so editor e2e can reach it. This is a
    // build-time NEXT_PUBLIC_* flag, so it must be set when the webServer runs
    // `pnpm build` (CI) or `pnpm dev` (local).
    env: { PORT: '3002', NEXT_DIST_DIR: '.next-e2e', NEXT_PUBLIC_MAIC_EDITOR_ENABLED: 'true' },
  },
});
