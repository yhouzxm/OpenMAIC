import { test, expect } from '@playwright/test';
import { browserBundle } from './browser-bundle';
import { createMemoryFixture } from './memory-harness';
import { createPgFixture } from './pg-harness';
import { startHost } from './host';
import { installEgressFence } from './egress';

let bundle = '';
test.beforeAll(async ({ browserName }, testInfo) => {
  if (browserName !== 'chromium') throw new Error('DIAGNOSTIC_BROWSER_CONFIGURATION');
  testInfo.setTimeout(120_000);
  bundle = await browserBundle();
});
test('D05 actual public SlideCanvas routes background/image/audio/video/poster through current-authority gateway', async ({
  page,
}) => {
  if (!process.env.B0_PG16_URL && process.env.B0_BROWSER_MEMORY !== '1')
    throw new Error('DIAGNOSTIC_PG16_REQUIRED');
  const f = process.env.B0_PG16_URL ? await createPgFixture() : await createMemoryFixture();
  const host = await startHost(f.boundary, bundle).catch(async () => {
    if ('close' in f) await f.close();
    throw new Error('DIAGNOSTIC_HOST_SETUP_FAILED');
  });
  const port = Number(new URL(host.origin).port);
  const allowedPorts = [port];
  if (process.env.B0_PG16_URL)
    allowedPorts.push(Number(new URL(process.env.B0_PG16_URL).port || 5432));
  let fence: ReturnType<typeof installEgressFence> | undefined;
  const paths = new Set<string>();
  let rejectedNetwork = 0;
  const errors: string[] = [];
  try {
    fence = installEgressFence(allowedPorts);
    await page.context().setExtraHTTPHeaders({ authorization: `Bearer ${f.credential.studentA1}` });
    await page.context().route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== host.origin) {
        rejectedNetwork++;
        return route.abort();
      }
      paths.add(url.pathname);
      return route.continue();
    });
    page.on('pageerror', (error) =>
      errors.push(
        error.message.includes('process is not defined')
          ? 'BROWSER_PROCESS_UNDEFINED'
          : 'BROWSER_ERROR',
      ),
    );
    await page.goto(`${host.origin}/diag/preview/${f.stages.A}`);
    expect(errors).toEqual([]);
    await expect(page.locator('.diagnostic-slide')).toBeVisible();
    await expect(page.getByText('Synthetic preview')).toBeVisible();
    await expect(page.locator('img').first()).toBeVisible();
    await page.getByRole('button', { name: 'Play audio' }).click();
    await expect.poll(() => paths.size).toBeGreaterThanOrEqual(5);
    const assets =
      'media' in f ? f.media.get(f.stages.A)! : { image: 'png', audio: 'wav', video: 'webm' };
    for (const asset of [assets.image, assets.audio, assets.video]) {
      expect(paths.has(`/diag/assets/${f.stages.A}/${asset}`)).toBe(true);
    }
    expect(await page.locator('iframe').count()).toBe(0);
    expect(errors.length).toBe(0);
    expect(rejectedNetwork).toBe(0);
    expect(
      await page.evaluate(() =>
        fetch('https://outside.invalid/x').then(
          () => false,
          () => true,
        ),
      ),
    ).toBe(true);
    f.authority.mappings.get(f.stages.A)!.state = 'REVOKED';
    const status = await page.evaluate(
      async (path) => (await fetch(path)).status,
      `/diag/assets/${f.stages.A}/${assets.image}`,
    );
    expect(status).toBe(403);
  } finally {
    fence?.close();
    try {
      await host.close();
    } finally {
      if ('close' in f) await f.close();
    }
  }
});
