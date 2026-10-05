import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { deliverAsset } from '@/lib/zhiban/infrastructure/openmaic/gateway';
import { Deadline } from '@/lib/zhiban/infrastructure/openmaic/transactions';
import { BridgeError } from '@/lib/zhiban/infrastructure/openmaic/validation';

describe
  .skipIf(process.env.B9_BROWSER_REQUIRED !== '1')
  .sequential('B9 isolated real browser gateway contract, not deployed D01 proof', () => {
    let server: Server,
      browser: Browser,
      context: BrowserContext,
      origin: string,
      enabled = true;
    const bytes = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l5sAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    beforeAll(async () => {
      server = createServer(async (req, res) => {
        if (req.url !== '/mapped.png') {
          res.writeHead(404, { 'Cache-Control': 'no-store' });
          res.end();
          return;
        }
        try {
          const authorize = async () => {
            if (!enabled || req.headers.cookie !== 'synthetic=present') throw new BridgeError();
          };
          await deliverAsset(
            req.method === 'HEAD' ? 'HEAD' : 'GET',
            typeof req.headers.range === 'string' ? req.headers.range : null,
            async () => ({ bytes, mime: 'image/png' }),
            authorize,
            async (chunk) => {
              if (!res.write(chunk)) await once(res, 'drain');
            },
            new Deadline(),
            async (headers) => {
              res.writeHead(req.headers.range ? 206 : 200, headers);
            },
          );
          res.end();
        } catch {
          if (res.headersSent) {
            res.destroy();
            return;
          }
          res.writeHead(403, { 'Cache-Control': 'private, no-store' });
          res.end();
        }
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new BridgeError();
      origin = `http://127.0.0.1:${address.port}`;
      browser = await chromium.launch();
      context = await browser.newContext();
      await context.addCookies([
        { name: 'synthetic', value: 'present', url: origin, httpOnly: true, sameSite: 'Lax' },
      ]);
    });
    afterAll(async () => {
      await context?.close();
      await browser?.close();
      if (server)
        await new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve())),
        );
    });
    it('B9-B01 real HEAD/range/PNG paths are no-store and direct-native routes are absent', async () => {
      const response = await context.request.get(`${origin}/mapped.png`, {
        headers: { Range: 'bytes=0-7' },
      });
      expect(response.status()).toBe(206);
      expect(await response.body()).toEqual(Buffer.from(bytes.slice(0, 8)));
      expect(response.headers()['cache-control']).toBe('private, no-store');
      expect(response.headers()['x-content-type-options']).toBe('nosniff');
      const head = await context.request.head(`${origin}/mapped.png`);
      expect(head.status()).toBe(200);
      expect((await head.body()).length).toBe(0);
      const page = await context.newPage();
      await page.goto(`${origin}/mapped.png`);
      expect(
        await page.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth),
      ).toBe(1);
      await page.close();
      expect((await context.request.get(`${origin}/native/document`)).status()).toBe(404);
    });
    it('B9-B02 revocation rejects conditional/HEAD/range access instead of cached success', async () => {
      enabled = false;
      for (const method of ['GET', 'HEAD'] as const) {
        const response = await context.request.fetch(`${origin}/mapped.png`, {
          method,
          headers: { Range: 'bytes=0-7', 'If-None-Match': '*' },
        });
        expect(response.status()).toBe(403);
        expect(response.headers()['cache-control']).toBe('private, no-store');
      }
      const anonymous = await browser.newContext();
      try {
        expect((await anonymous.request.get(`${origin}/mapped.png`)).status()).toBe(403);
      } finally {
        await anonymous.close();
      }
    });
  });
