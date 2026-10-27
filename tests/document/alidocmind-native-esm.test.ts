import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

it('constructs the actual external CommonJS SDK from the LOCAL host ESM bundle', async () => {
  const root = await mkdtemp(join(process.cwd(), '.zhiban-sdk-interop-'));
  try {
    const outfile = join(root, 'client.mjs');
    await build({
      entryPoints: ['lib/pdf/alidocmind-client.ts'],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      packages: 'external',
      logLevel: 'silent',
    });
    // Real package/constructor, deterministic method: no credentials or network.
    const script = `
      import sdk from '@alicloud/docmind-api20220711';
      const Client = sdk.default ?? sdk;
      Client.prototype.queryDocParserStatus = async () => ({
        body: {code:'BizIdNotExistOrResultExpired'}
      });
      const {verifyAliDocMindCredentials} = await import(${JSON.stringify(outfile)});
      const result = await verifyAliDocMindCredentials({accessKeyId:'test-only',accessKeySecret:'test-only'});
      if (!result.ok) throw Error('SDK constructor/probe failed');
      console.log('PASS_NATIVE_ESM_CONSTRUCTOR');
    `;
    expect(
      execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 15000,
      }),
    ).toContain('PASS_NATIVE_ESM_CONSTRUCTOR');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
