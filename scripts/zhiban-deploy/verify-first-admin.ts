/** Disposable PG18 only; real frozen bootstrap, two signatures and first-password consumption. */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign, createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { installFreshBusinessSchema } from '@/lib/zhiban/infrastructure/production/business-schema';
import { signedPlatformApprovals } from '@/lib/zhiban/infrastructure/production/platform-approvals';
import { installFirstPlatformAdmin } from '@/lib/zhiban/infrastructure/production/first-admin';
import { createIdentityComposition } from '@/lib/zhiban/infrastructure/identity/composition/root';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import { platformManifestDigest } from '@/lib/zhiban/infrastructure/identity/composition/operator';
import {
  purposes,
  admissionPolicyDigest,
  observedTransport,
} from '@/lib/zhiban/infrastructure/identity/composition/admission';
import { catalogConfig } from '../../tests/zhiban/identity/authorization/fixtures';
async function main() {
  const root = await mkdtemp(join(tmpdir(), 'zhiban-first-admin-')),
    socket = join(root, 'socket'),
    data = join(root, 'data');
  const bin = process.env.ZHIBAN_PG18_BIN || '/usr/lib/postgresql/18/bin',
    database = 'zhiban_install_business';
  const run = (name: string, args: string[]) =>
    execFileSync(join(bin, name), args, { stdio: 'pipe' });
  const pools: Pool[] = [];
  const pool = (user: string, db = database) => {
    const p = new Pool({
      host: socket,
      port: 56552,
      user,
      database: db,
      max: 2,
      connectionTimeoutMillis: 3000,
    });
    pools.push(p);
    return p;
  };
  let started = false;
  try {
    await mkdir(socket, { mode: 0o700 });
    run('initdb', [
      '-D',
      data,
      '-U',
      'postgres',
      '--auth-local=trust',
      '--auth-host=reject',
      '--encoding=UTF8',
      '--no-locale',
    ]);
    run('pg_ctl', [
      '-D',
      data,
      '-l',
      join(root, 'pg.log'),
      '-o',
      `-p 56552 -k ${socket} -c listen_addresses=''`,
      '-w',
      'start',
    ]);
    started = true;
    await pool('postgres', 'postgres').query('CREATE DATABASE ' + database);
    for (const file of [
      'docs/v2/candidates/pg18-provider-v1/bootstrap-roles.pg18.sql',
      'docs/v2/candidates/pg18-provider-v1/bootstrap-bridge-roles.pg18.sql',
      'scripts/zhiban-local/autograde-bootstrap.sql',
    ])
      run('psql', [
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-h',
        socket,
        '-p',
        '56552',
        '-U',
        'postgres',
        '-d',
        database,
        '-f',
        file,
      ]);
    const admin = pool('postgres');
    await admin.query(
      'CREATE ROLE zhiban_academic_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
    );
    await installFreshBusinessSchema(admin);
    const at = Date.now(),
      environment = 'INSTALLATION_TEST_ONLY',
      approvalRef = 'first-admin';
    const policyDigests = {} as Record<(typeof purposes)[number],string>;
    for (const purpose of purposes) {
      const initial = purpose === 'INITIAL_PROVISION';
      const p = {
        purpose,
        approval_ref: 'installation-test',
        environment_ref: environment,
        created_at: String(at),
        window_ms: '60000',
        global_limit: '100',
        ip_limit: initial ? null : '30',
        locator_limit: initial ? null : '15',
        pair_limit: initial ? null : '15',
        user_limit: purpose === 'LOGIN' ? null : '15',
        max_buckets: '1000',
      };
      const d = admissionPolicyDigest(p);
      policyDigests[purpose] = d;
      await admin.query(
        'INSERT INTO zhiban_identity.admission_policies VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [purpose, d, ...Object.values(p).slice(1)],
      );
      await admin.query('INSERT INTO zhiban_identity.admission_gate(purpose) VALUES($1)', [
        purpose,
      ]);
    }
    const ids = new IdentityIds();
    const body = {
      purpose: 'FIRST_PLATFORM_ADMIN' as const,
      approvalId: ids.nextCommandId(),
      commandId: ids.nextCommandId(),
      userId: ids.nextUserId(),
      existingUserRevision: null,
      grantId: ids.nextSystemAdminGrantId(),
      provisionApprovalId: ids.nextCommandId(),
      environment,
      approvalRef,
      operatorRef: 'test-installer',
      approverRef: 'test-approver',
      requestId: ids.nextCommandId(),
      issuedAt: at - 1000,
      expiresAt: at + 600000,
    };
    const manifest = { ...body, manifestDigest: platformManifestDigest(body) };
    const keys = [generateKeyPairSync('ed25519'), generateKeyPairSync('ed25519')];
    const signer = (i: number, reference: string) => ({
      reference,
      publicKey: keys[i].publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      spkiSha256: createHash('sha256')
        .update(keys[i].publicKey.export({ type: 'spki', format: 'der' }))
        .digest('hex'),
    });
    const envelope = {
      kind: 'ZHIBAN_PLATFORM_APPROVAL_V1',
      manifest,
      operatorSignature: sign(
        null,
        Buffer.from(JSON.stringify(manifest)),
        keys[0].privateKey,
      ).toString('base64'),
      approverSignature: sign(
        null,
        Buffer.from(JSON.stringify(manifest)),
        keys[1].privateKey,
      ).toString('base64'),
    };
    const path = join(root, approvalRef + '.json');
    await writeFile(path, JSON.stringify(envelope), { mode: 0o600 });
    const policy = {
      directory: root,
      environment,
      operator: signer(0, body.operatorRef),
      approver: signer(1, body.approverRef),
      manifests: { [approvalRef]: manifest.manifestDigest },
    };
    const store = signedPlatformApprovals(policy);
    assert.equal((await store.load(approvalRef))!.userId, manifest.userId);
    await assert.rejects(store.load('unknown'));
    assert.throws(() => signedPlatformApprovals({ ...policy, approver: policy.operator }));
    await writeFile(
      path,
      JSON.stringify({ ...envelope, operatorSignature: envelope.approverSignature }),
    );
    await assert.rejects(store.load(approvalRef), /signature rejected/);
    await writeFile(path, JSON.stringify(envelope));
    const corpus = ['installation-compromised-test-vector'];
    const identity = await createIdentityComposition(
      {
        auth: pool('zhiban_auth_runtime'),
        tenant: pool('zhiban_runtime'),
        control: pool('zhiban_control_runtime'),
      },
      {
        origin: 'https://127.0.0.1:3449',
        sessionPolicy: { absoluteMs: 28800000, idleMs: 1800000 },
        catalog: catalogConfig(),
        admission: {
          environment,
          approvalRef: 'installation-test',
          hmacKey: randomBytes(32),
          policyDigests,
        },
        corpus: {
          approvalRef: 'installation-test',
          expectedDigest: createHash('sha256').update(JSON.stringify(corpus)).digest('hex'),
          values: corpus,
        },
        operator: store,
        membership: null,
        transportApprovalRef: 'installation-test',
        deployment: 'SINGLE_PROCESS_HTTPS',
      },
    );
    const password = randomBytes(32).toString('base64url');
    const result = await installFirstPlatformAdmin(identity, approvalRef, password);
    assert.equal(result.userId, manifest.userId);
    const login = await identity.security.login(
      manifest.userId as never,
      password,
      observedTransport('127.0.0.1'),
      'first-login',
    );
    assert.equal(login.status, 'ISSUED');
    assert.equal(
      Number((await admin.query('SELECT count(*) FROM zhiban_identity.users')).rows[0].count),
      1,
    );
    const different = randomBytes(32).toString('base64url');
    await installFirstPlatformAdmin(identity, approvalRef, different);
    assert.notEqual(
      (
        await identity.security.login(
          manifest.userId,
          different,
          observedTransport('127.0.0.1'),
          'replayed-password',
        )
      ).status,
      'ISSUED',
    );
    assert.equal(
      (
        await identity.security.login(
          manifest.userId,
          password,
          observedTransport('127.0.0.1'),
          'original-password',
        )
      ).status,
      'ISSUED',
    );
    console.log(
      'PASS fresh PG18 schema + two independent signature pins + frozen first administrator bootstrap/provision + actual authentication + idempotent provision cannot overwrite password',
    );
  } finally {
    for (const p of pools) await p.end();
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    await rm(root, { recursive: true, force: true });
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
