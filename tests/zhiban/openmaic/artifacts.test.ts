import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { DSL_VERSION, validateScene } from '@openmaic/dsl';
import { PgDocumentStore, PgAssetStore } from '@openmaic/storage';
import { PgRuntimeStore } from '@openmaic/storage/runtime/pg';
import { document } from './fixtures';

const versions = {
  dsl: '0.11.2',
  storage: '0.31.1',
  generation: '0.3.13',
  editor: '0.0.9',
  renderer: '0.1.11',
  importer: '0.3.0',
};
describe('P01-P06 pinned published artifact evidence', () => {
  test.each(Object.entries(versions))(
    '%s public JS/types export targets exist at pinned version',
    async (name, version) => {
      const base = resolve('packages/@openmaic', name);
      const manifest = JSON.parse(await readFile(resolve(base, 'package.json'), 'utf8')) as {
        version: string;
        exports: Record<string, string | { import: string; types: string }>;
      };
      expect(manifest.version).toBe(version);
      for (const [key, entry] of Object.entries(manifest.exports)) {
        if (key.includes('*')) continue;
        if (typeof entry === 'string') await access(resolve(base, entry));
        else {
          await access(resolve(base, entry.import));
          await access(resolve(base, entry.types));
        }
      }
    },
  );
  test('public DSL and storage constructors actually load without native bootstrap', () => {
    expect(typeof DSL_VERSION).toBe('string');
    expect(validateScene(document('stage').scenes[0]).valid).toBe(true);
    expect(
      [PgDocumentStore, PgAssetStore, PgRuntimeStore].every((item) => typeof item === 'function'),
    ).toBe(true);
  });
  test('browser generation/editor core load; importer entry resolves without unapproved D10 execution', async () => {
    const entries = await Promise.all([
      import('@openmaic/generation/browser'),
      import('@openmaic/editor/core'),
    ]);
    expect(entries.every((entry) => Object.keys(entry).length > 0)).toBe(true);
    expect(import.meta.resolve('@openmaic/importer').endsWith('/dist/index.js')).toBe(true);
  });
  test('test-only consumer import graph has no native/private imports', async () => {
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir('tests/zhiban/openmaic')).filter((file) =>
      /\.(?:ts|tsx)$/.test(file),
    );
    for (const file of files) {
      const source = await readFile(resolve('tests/zhiban/openmaic', file), 'utf8');
      const imports = [...source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)].map(
        (match) => match[2],
      );
      expect(
        imports.some((path) =>
          /(?:^@\/|lib\/|components\/|@openmaic\/[^/]+\/(?:src|dist)|server\/reference)/.test(path),
        ),
      ).toBe(false);
    }
  });
  test.skipIf(process.env.B0_FRESH_REQUIRED !== '1')(
    'fresh build provenance is required in isolated execution',
    async () => {
      const value = JSON.parse(
        await readFile('tests/zhiban/openmaic/artifact-provenance.json', 'utf8'),
      );
      expect(value.freshBuild).toBe(true);
      expect(value.officialTag).toBe('1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce');
      expect(value.lockDigest).toBe(
        createHash('sha256')
          .update(await readFile('pnpm-lock.yaml'))
          .digest('hex'),
      );
      expect(value.node).toBe(process.version);
      expect(value.platform).toBe(process.platform);
    },
  );
});
