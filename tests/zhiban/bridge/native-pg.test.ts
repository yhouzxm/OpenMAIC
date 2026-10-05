import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client, Pool } from 'pg';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { NativeStorage } from '@/lib/zhiban/infrastructure/openmaic/native-storage';
import {
  provisionNative,
  verifyNativeProvisioning,
} from '@/lib/zhiban/infrastructure/openmaic/provision';
import { catalogFingerprint, official } from '@/lib/zhiban/infrastructure/openmaic/catalog';
import { bridgeTransaction, Deadline } from '@/lib/zhiban/infrastructure/openmaic/transactions';
import { BridgeError, newPrincipal } from '@/lib/zhiban/infrastructure/openmaic/validation';
import { preview, validateDocument } from '@/lib/zhiban/infrastructure/openmaic/content';
import type { MaicDocument } from '@openmaic/storage';
import type { Slide } from '@openmaic/dsl';

const configured = process.env.B9_NATIVE_REQUIRED === '1';
const database = 'zhiban_9b_native_test',
  password = 'synthetic-native-fixture-password';
function adminUrl() {
  const value = process.env.PG_CONTRACT_URL;
  if (!value) throw new Error('Native PG16 CI URL required');
  const url = new URL(value);
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username !== 'postgres' ||
    url.pathname !== '/openmaic'
  )
    throw new Error('Native fixture is not disposable');
  return url;
}
async function administrator<T>(native: boolean, body: (client: Client) => Promise<T>) {
  const url = adminUrl();
  if (native) url.pathname = `/${database}`;
  const c = new Client({ connectionString: url.toString() });
  await c.connect();
  try {
    return await body(c);
  } finally {
    await c.end();
  }
}
const pools: Pool[] = [];
function pool(role: 'zhiban_openmaic_migrator' | 'zhiban_openmaic_runtime') {
  const url = adminUrl();
  url.pathname = `/${database}`;
  url.username = role;
  url.password = password;
  const p = new Pool({ connectionString: url.toString(), max: 2, connectionTimeoutMillis: 1000 });
  pools.push(p);
  return p;
}
describe
  .skipIf(!configured)
  .sequential('B9 native: fresh public artifacts, PG16 minimum-role proof', () => {
    let storage: NativeStorage, runtime: Pool, receipt: Awaited<ReturnType<typeof provisionNative>>;
    let databaseCreated = false,
      rolesCreated = false;
    const isolatedIdentityRoles: string[] = [];
    const principal = newPrincipal(),
      foreign = newPrincipal();
    const png = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l5sAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    let asset: Awaited<ReturnType<NativeStorage['put']>>, doc: MaicDocument;
    let docDigest: string;
    const bindings = () =>
      new Map([
        [asset.ref, { byteDigest: asset.byteDigest, sceneRef: 'scene', purpose: 'IMAGE' as const }],
      ]);
    beforeAll(async () => {
      const proof = JSON.parse(
        await readFile(new URL('../openmaic/artifact-provenance.json', import.meta.url), 'utf8'),
      );
      expect(proof).toMatchObject({
        officialTag: official.sha,
        freshBuild: true,
        platform: 'linux',
        architecture: 'x64',
      });
      expect(proof.baseHead).toBe(process.env.GITHUB_SHA);
      expect(process.version).toMatch(/^v22\./);
      await administrator(false, async (c) => {
        expect((await c.query('SHOW server_version')).rows[0].server_version).toMatch(/^16\./);
        expect(
          (await c.query("SELECT rolname FROM pg_roles WHERE rolname LIKE 'zhiban_openmaic_%'"))
            .rows,
        ).toEqual([]);
        await c.query(`CREATE DATABASE ${database}`);
        databaseCreated = true;
        for (const role of [
          'zhiban_runtime',
          'zhiban_auth_runtime',
          'zhiban_control_runtime',
          'zhiban_bridge_runtime',
        ]) {
          if ((await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount === 0) {
            await c.query(
              `CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD '${password}'`,
            );
            isolatedIdentityRoles.push(role);
          }
        }
      });
      const url = adminUrl();
      const bootstrap = fileURLToPath(
        new URL(
          '../../../lib/zhiban/infrastructure/openmaic/bootstrap-native-roles.pg16.sql',
          import.meta.url,
        ),
      );
      const run = spawnSync('psql', ['-X', '-f', bootstrap], {
        env: {
          ...process.env,
          PGHOST: url.hostname,
          PGPORT: url.port || '5432',
          PGDATABASE: database,
          PGUSER: 'postgres',
          PGPASSWORD: decodeURIComponent(url.password),
        },
        encoding: 'utf8',
      });
      expect(run.status).toBe(0);
      rolesCreated = true;
      await administrator(true, async (c) => {
        for (const role of ['zhiban_openmaic_migrator', 'zhiban_openmaic_runtime'])
          await c.query(`ALTER ROLE ${role} PASSWORD '${password}'`);
      });
      receipt = await provisionNative(
        pool('zhiban_openmaic_migrator'),
        database,
        'synthetic-CI-approval',
      );
      runtime = pool('zhiban_openmaic_runtime');
      storage = new NativeStorage(runtime);
    });
    afterAll(async () => {
      await Promise.all(pools.map((p) => p.end()));
      pools.length = 0;
      await administrator(false, async (c) => {
        if (databaseCreated) await c.query(`DROP DATABASE ${database}`);
        if (rolesCreated)
          for (const role of [
            'zhiban_openmaic_runtime',
            'zhiban_openmaic_migrator',
            'zhiban_openmaic_owner',
          ])
            await c.query(`DROP ROLE ${role}`);
        for (const role of isolatedIdentityRoles) await c.query(`DROP ROLE ${role}`);
      });
    });
    it('B9-N01 receipt records exact public version and owner/runtime fingerprint agrees', async () => {
      expect(receipt).toMatchObject({ ...official, database });
      await bridgeTransaction(runtime, null, new Deadline(), async (c) => {
        await c.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
        expect(await catalogFingerprint(c, 'public')).toBe(receipt.fingerprint);
      });
    });
    it('B9-N02 runtime is non-owner/no role edge/no DDL/TEMP or forbidden delete', async () => {
      await bridgeTransaction(runtime, null, new Deadline(), async (c) => {
        const r = await c.query(
          'SELECT NOT rolsuper AND NOT rolinherit AND NOT rolbypassrls AND NOT rolcreaterole AS safe FROM pg_roles WHERE rolname=session_user',
        );
        expect(r.rows[0].safe).toBe(true);
        expect(
          (
            await c.query(
              "SELECT has_table_privilege(session_user,'document_folders','SELECT') AS folders,has_column_privilege(session_user,'document_stages','owner_id','UPDATE') AS owner,has_table_privilege(session_user,'asset_entries','DELETE') AS delete_allowed,has_database_privilege(session_user,current_database(),'TEMP') AS temp",
            )
          ).rows[0],
        ).toEqual({ folders: false, owner: false, delete_allowed: false, temp: false });
      });
    });
    it('B9-N03 native trigger direct EXECUTE is denied but public put works', async () => {
      await bridgeTransaction(runtime, null, new Deadline(), async (c) => {
        expect(
          (
            await c.query(
              "SELECT has_function_privilege(session_user,'openmaic_bump_stage_revision()','EXECUTE') AS execute",
            )
          ).rows[0].execute,
        ).toBe(false);
      });
      asset = await storage.put(principal, 'image/png', png, new Deadline(), async () => {});
      expect(asset.byteLength).toBe(png.length);
      expect(asset.ref.length).toBeGreaterThan(0);
    });
    it('B9-N04 resolve checks exact principal, digest, MIME and byte length', async () => {
      expect(
        await storage.read(
          principal,
          asset.ref,
          {
            mime: 'image/png',
            byteLength: asset.byteLength,
            digest: asset.byteDigest,
            revision: '1',
          },
          new Deadline(),
          async () => {},
        ),
      ).toEqual(png);
      await expect(
        storage.read(
          foreign,
          asset.ref,
          {
            mime: 'image/png',
            byteLength: asset.byteLength,
            digest: asset.byteDigest,
            revision: '1',
          },
          new Deadline(),
          async () => {},
        ),
      ).rejects.toThrow(BridgeError);
      await expect(
        storage.read(
          principal,
          asset.ref,
          {
            mime: 'image/png',
            byteLength: asset.byteLength,
            digest: '0'.repeat(64),
            revision: '1',
          },
          new Deadline(),
          async () => {},
        ),
      ).rejects.toThrow(BridgeError);
    });
    it('B9-N05 public authoritative save, revision trigger and asset tracking work with exact grants', async () => {
      const stage = v7();
      const canvas = preview(
        {
          id: 'slide',
          viewportSize: 960,
          viewportRatio: 0.5625,
          elements: [
            {
              id: 'image',
              type: 'image',
              left: 0,
              top: 0,
              width: 80,
              height: 80,
              rotate: 0,
              src: `asset:${asset.ref}`,
              fixedRatio: true,
            },
          ],
        } as Slide,
        (id) => `asset:${id}`,
      );
      doc = {
        dslVersion: '0.11.2',
        stage: { id: stage, name: 'Synthetic closed preview', createdAt: 1000, updatedAt: 1000 },
        scenes: [
          {
            id: 'scene',
            stageId: stage,
            title: 'Synthetic',
            order: 0,
            type: 'slide',
            content: { type: 'slide', canvas },
          },
        ],
      };
      const refs = bindings();
      docDigest = validateDocument(doc, stage, refs).digest;
      await storage.saveCandidate(
        principal,
        stage,
        doc,
        refs,
        new Deadline(),
        async () => {},
        docDigest,
      );
      expect(
        await storage.load(principal, stage, refs, new Deadline(), async () => {}, docDigest),
      ).toEqual(doc);
      const manifest = await storage.manifest(principal, stage, new Deadline(), async () => {});
      expect(manifest.rev).toBeGreaterThan(0);
      expect(manifest.scenes).toHaveLength(1);
      await administrator(true, async (c) => {
        expect(
          (
            await c.query('SELECT count(*)::int AS n FROM document_asset_refs WHERE stage_id=$1', [
              stage,
            ])
          ).rows[0].n,
        ).toBe(1);
      });
    });
    it('B9-N06 existing StageRef cannot be overwritten by prepare', async () => {
      await expect(
        storage.saveCandidate(
          principal,
          doc.stage.id,
          doc,
          bindings(),
          new Deadline(),
          async () => {},
          docDigest,
        ),
      ).rejects.toThrow(BridgeError);
    });
    it('B9-N07 failed final current check rolls back native write', async () => {
      const before = await administrator(
        true,
        async (c) => (await c.query('SELECT count(*)::int AS n FROM asset_entries')).rows[0].n,
      );
      await expect(
        storage.put(principal, 'image/png', png, new Deadline(), async () => {
          throw new Error('Session expired');
        }),
      ).rejects.toThrow(BridgeError);
      expect(
        await administrator(
          true,
          async (c) => (await c.query('SELECT count(*)::int AS n FROM asset_entries')).rows[0].n,
        ),
      ).toBe(before);
    });
    it('B9-N08 PUBLIC has no table/column/function access', async () => {
      await administrator(true, async (c) => {
        for (const sql of [
          "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname='public' AND a.grantee=0",
          "SELECT count(*)::int AS n FROM pg_attribute c JOIN pg_class r ON r.oid=c.attrelid JOIN pg_namespace n ON n.oid=r.relnamespace CROSS JOIN LATERAL aclexplode(c.attacl) a WHERE n.nspname='public' AND a.grantee=0",
          "SELECT count(*)::int AS n FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace CROSS JOIN LATERAL aclexplode(c.proacl) a WHERE n.nspname='public' AND a.grantee=0",
        ])
          expect((await c.query(sql)).rows[0].n).toBe(0);
      });
    });
    it('B9-N09 subsequent maintenance verifies the receipt without re-provisioning and detects drift', async () => {
      const migrator = pool('zhiban_openmaic_migrator');
      expect(await verifyNativeProvisioning(migrator, receipt)).toEqual({ status: 'VERIFIED' });
      await expect(provisionNative(migrator, database, 'synthetic-CI-approval')).rejects.toThrow(
        BridgeError,
      );
      await expect(
        verifyNativeProvisioning(migrator, { ...receipt, fingerprint: '0'.repeat(64) }),
      ).rejects.toThrow(BridgeError);
    });
    it('B9-N10 foreign principal cannot load an ID-capable document through the guarded adapter', async () => {
      await expect(
        storage.load(foreign, doc.stage.id, bindings(), new Deadline(), async () => {}, docDigest),
      ).rejects.toThrow(BridgeError);
    });
    it('B9-N11 Identity/Bridge service roles cannot connect to the private native database', async () => {
      await administrator(true, async (c) => {
        for (const role of [
          'zhiban_runtime',
          'zhiban_auth_runtime',
          'zhiban_control_runtime',
          'zhiban_bridge_runtime',
        ]) {
          expect(
            (
              await c.query(
                "SELECT has_database_privilege($1,current_database(),'CONNECT') AS allowed",
                [role],
              )
            ).rows[0].allowed,
          ).toBe(false);
        }
      });
      for (const role of isolatedIdentityRoles) {
        const url = adminUrl();
        url.pathname = `/${database}`;
        url.username = role;
        url.password = password;
        const denied = new Client({
          connectionString: url.toString(),
          connectionTimeoutMillis: 1000,
        });
        try {
          await expect(denied.connect()).rejects.toMatchObject({ code: '42501' });
        } finally {
          await denied.end();
        }
      }
    });
  });
