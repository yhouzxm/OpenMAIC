import { connection, connectedPool } from '@/lib/zhiban/infrastructure/production/connection';
/** End-to-end fresh installation with separate source construction, actual PG18 TLS and HTTPS. */
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { request } from 'node:https';
import { request as httpRequest } from 'node:http';
import { renderUbuntu } from './production-ubuntu';
import { generateKeyPairSync, createHash, randomBytes, sign } from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { ownedCluster, prepareOwned, buildProductionSourceProfile } from './production-source';
import {
  runtimeRoles,
  installRoles,
  type RuntimeInput,
  type InstallInput,
  verifiedInstallation,
} from '@/lib/zhiban/infrastructure/production/deployment';
import { setup, setupPlan, type SetupInput } from '@/lib/zhiban/infrastructure/production/setup';
import { installationPlan, installFresh } from '@/lib/zhiban/infrastructure/production/install';
import { saveJson, digest } from '@/lib/zhiban/infrastructure/production/files';
import { type AdmissionPolicyRecord } from '@/lib/zhiban/infrastructure/identity/composition/admission';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import {
  controlManifestDigest,
  type ControlApprovalManifest,
} from '@/lib/zhiban/infrastructure/identity/composition/control-approval';
import { buildHost } from './production-host-build';
import { verifyProductionOperations } from './verify-production-operations';
import { verifyProductionTeaching } from './verify-production-teaching';
import { identityProposal, firstAdministratorProposal } from './production-proposals';
import type { PlatformApproval } from '@/lib/zhiban/infrastructure/identity/composition/operator';
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  let succeeded = false;
  const httpMode = process.env.ZHIBAN_VERIFY_HTTP === '1';
  const publicOrigin = httpMode ? 'http://127.0.0.1:3489' : 'https://127.0.0.1:3491';
  const base = await mkdtemp(join(tmpdir(), 'zhiban-production-journey-'));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined,
    child: ReturnType<typeof spawn> | undefined,
    nginxChild: ReturnType<typeof spawn> | undefined;
  const p = (n: string) => join(base, n),
    secret = async (n: string, b: string | Buffer) => {
      await writeFile(p(n), b, { mode: 0o600, flag: 'wx' });
      return p(n);
    };
  try {
    await buildHost();
    const profileFile = p('source-profile.json'),
      pin = await buildProductionSourceProfile(profileFile);
    const report: Record<string, unknown> = {
      evidenceOrigin: 'LOCAL',
      createdAt: new Date().toISOString(),
      baselineSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      githubActions: false,
      profilePin: pin.sha256,
      scope: httpMode
        ? 'FRESH_THREE_DATABASE_INSTALL_AND_FIRST_ADMIN_HTTP'
        : 'FRESH_THREE_DATABASE_INSTALL_AND_FIRST_ADMIN_HTTPS',
      productionConnected: false,
    };
    const openssl = (args: string[]) => execFileSync('openssl', args, { stdio: 'pipe' });
    openssl([
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      p('ca.key'),
      '-out',
      p('ca.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=Zhiban disposable installation CA',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
    ]);
    openssl([
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      p('server.key'),
      '-out',
      p('server.csr'),
      '-subj',
      '/CN=127.0.0.1',
    ]);
    await writeFile(
      p('server.ext'),
      'subjectAltName=IP:127.0.0.1,DNS:localhost\nextendedKeyUsage=serverAuth\n',
      { mode: 0o600 },
    );
    openssl([
      'x509',
      '-req',
      '-in',
      p('server.csr'),
      '-CA',
      p('ca.pem'),
      '-CAkey',
      p('ca.key'),
      '-CAcreateserial',
      '-out',
      p('server.pem'),
      '-days',
      '1',
      '-extfile',
      p('server.ext'),
    ]);
    const { chmod } = await import('node:fs/promises');
    for (const name of ['ca.key', 'ca.pem', 'server.key', 'server.pem'])
      await chmod(p(name), 0o600);
    await ownedCluster(
      async (x) => {
        const dbs = {
          business: 'zhiban_fresh_business',
          content: 'zhiban_fresh_content',
          authoring: 'zhiban_fresh_authoring',
        };

        // Restart only this owned test cluster with real SCRAM/TLS host connections.
        const data = join(x.root, 'data');
        await writeFile(
          join(data, 'pg_hba.conf'),
          `local all all trust\n${process.env.ZHIBAN_VERIFY_PLAIN_PG === '1' ? 'host' : 'hostssl'} all all 127.0.0.1/32 scram-sha-256\nhost all all 127.0.0.1/32 reject\n`,
          { mode: 0o600 },
        );
        execFileSync(join(x.bin, 'pg_ctl'), ['-D', data, 'reload'], { stdio: 'pipe' });
        const credentials: Record<string, string> = {};
        for (const role of [...Object.values(runtimeRoles), ...Object.values(installRoles)]) {
          const password = randomBytes(32).toString('hex');
          credentials[role] = password;
        }
        const endpoint = async (role: string, database: string) => ({
          host: '127.0.0.1',
          port: 56553,
          database,
          role,
          credentialFile: await secret(
            role + '.env',
            `DATABASE_URL=postgresql://${role}:${credentials[role]}@127.0.0.1:56553/${database}\n`,
          ),
          ...(process.env.ZHIBAN_VERIFY_PLAIN_PG === '1'
            ? { transport: 'plain' as const }
            : { caFile: p('ca.pem') }),
        });
        const connections = {} as RuntimeInput['connections'];
        for (const [key, role] of Object.entries(runtimeRoles))
          connections[key as keyof typeof runtimeRoles] = await endpoint(
            role,
            dbs[key === 'native' ? 'content' : key === 'authoring' ? 'authoring' : 'business'],
          );
        const migrations = {} as InstallInput['migrations'];
        for (const [key, role] of Object.entries(installRoles))
          migrations[key as keyof typeof installRoles] = await endpoint(
            role,
            dbs[key as keyof typeof dbs],
          );
        const issuer = generateKeyPairSync('ed25519'),
          keys = [generateKeyPairSync('ed25519'), generateKeyPairSync('ed25519')];
        const signer = (i: number, reference: string) => ({
          reference,
          publicKey: keys[i].publicKey.export({ type: 'spki', format: 'pem' }).toString(),
          spkiSha256: digest(keys[i].publicKey.export({ type: 'spki', format: 'der' })),
        });
        const receiptPrivateKeyFile = await secret(
          'receipt-private.pem',
          issuer.privateKey.export({ type: 'pkcs8', format: 'pem' }),
        );
        const ids = new IdentityIds(),
          environment = 'ISOLATED_INSTALL_ACCEPTANCE',
          corpus = ['installation-compromised-test-vector'];
        await saveJson(
          p('identity-spec.json'),
          {
            origin: publicOrigin,
            environment,
            approvalRef: 'isolation-test-policy',
            catalogApprovalRecord: 'isolation-approved-catalog',
            corpus: { approvalRef: 'isolation-test', values: corpus },
            sessionPolicy: { absoluteMs: 28800000, idleMs: 1800000 },
            membershipPolicy: {
              tenantRecordCapacity: 10000,
              controlRecordCapacity: 10000,
              sourceTtlMs: 1800000,
            },
            admissionLimits: {
              windowMs: 60000,
              globalLimit: 100,
              ipLimit: 30,
              locatorLimit: 15,
              pairLimit: 15,
              userLimit: 15,
              maxBuckets: 1000,
            },
            transportApprovalRef: 'isolation-direct-TLS',
          },
          true,
        );
        await identityProposal(p('identity-spec.json'), p('identity-proposal.json'));
        const proposed = JSON.parse(await readFile(p('identity-proposal.json'), 'utf8')) as {
          identity: RuntimeInput['identity'];
          admissionPolicies: AdmissionPolicyRecord[];
        };
        const runtime: RuntimeInput = {
          kind: 'ZHIBAN_RUNTIME_INPUT_V1',
          instanceId: ids.nextCommandId(),
          origin: publicOrigin,
          address: '127.0.0.1',
          port: 3491,
          stateDirectory: p('instance'),
          profileFile,
          profilePin: pin.sha256,
          receiptAuthority: {
            publicKey: issuer.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
            spkiSha256: digest(issuer.publicKey.export({ type: 'spki', format: 'der' })),
          },
          tls: { certificateFile: p('server.pem'), privateKeyFile: p('server.key') },
          databases: dbs,
          connections,
          identity: proposed.identity,
        };
        if (httpMode) {
          runtime.tls.serverName = 'localhost';
          runtime.trustedProxy = {
            address: '127.0.0.1',
            tokenFile: await secret('proxy-token', randomBytes(32).toString('hex')),
          };
        }
        const controlDirectory = p('control-approvals');
        await mkdir(controlDirectory, { mode: 0o700 });
        const key = await secret(
          'no-services.json',
          JSON.stringify({
            providers: {},
            slots: { llm: null, image: null, video: null, tts: null, asr: null, document: null },
            allowUserKeys: false,
          }),
        );
        const environmentFile = await secret('services.env', 'OPENMAIC_CONFIG=' + key + '\n');
        runtime.serviceEnvironment = {
          file: environmentFile,
          pin: digest(await readFile(environmentFile)),
          files: { [key]: digest(await readFile(key)) },
        };
        runtime.membershipAuthority = {
          directory: controlDirectory,
          environment,
          operator: signer(0, 'test-installer'),
          approver: signer(1, 'test-approver'),
        };
        const runtimeFile = p('runtime.json');
        await saveJson(runtimeFile, runtime, true);
        await saveJson(
          p('first-admin-spec.json'),
          {
            environment,
            approvalRef: 'first-administrator',
            operatorRef: 'test-installer',
            approverRef: 'test-approver',
            validForSeconds: 1800,
          },
          true,
        );
        await firstAdministratorProposal(
          p('first-admin-spec.json'),
          p('first-admin-manifest.json'),
        );
        const manifest = JSON.parse(
          await readFile(p('first-admin-manifest.json'), 'utf8'),
        ) as PlatformApproval;
        await saveJson(
          p('first-administrator.json'),
          {
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
          },
          true,
        );
        const password = randomBytes(32).toString('base64url'),
          passwordFile = await secret('initial-password.txt', password);
        const installInput: InstallInput = {
          kind: 'ZHIBAN_FRESH_INSTALL_INPUT_V1',
          runtimeFile,
          migrations,
          receiptPrivateKeyFile,
          admissionPolicies: proposed.admissionPolicies,
          firstAdministrator: {
            policy: {
              directory: base,
              environment,
              operator: signer(0, 'test-installer'),
              approver: signer(1, 'test-approver'),
              manifests: { 'first-administrator': manifest.manifestDigest },
            },
            reference: 'first-administrator',
            passwordFile,
          },
        };
        const installFile = p('install.json');
        await saveJson(installFile, installInput, true);
        await assert.rejects(installFresh(installFile, '0'.repeat(64)), /plan pin/);
        const adminPassword = randomBytes(32).toString('hex');
        await x.master.query(`ALTER ROLE postgres PASSWORD '${adminPassword}'`);
        const setupInput: SetupInput = {
          kind: 'ZHIBAN_SETUP_INPUT_V1',
          installationFile: installFile,
          preparation: {
            admin: {
              host: '127.0.0.1',
              port: 56553,
              database: 'postgres',
              role: 'postgres',
              credentialFile: await secret(
                'setup-admin.env',
                `DATABASE_URL=postgresql://postgres:${adminPassword}@127.0.0.1:56553/postgres\n`,
              ),
              ...(process.env.ZHIBAN_VERIFY_PLAIN_PG === '1'
                ? { transport: 'plain' as const }
                : { caFile: p('ca.pem') }),
            },
            psqlBinary: join(x.bin, 'psql'),
            createDatabases: true,
          },
        };
        if (process.env.ZHIBAN_VERIFY_PLAIN_PG === '1') {
          const admin = setupInput.preparation!.admin;
          const pool = await connectedPool(admin);
          try {
            assert.equal(
              (await pool.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0]
                .ssl,
              false,
            );
          } finally {
            await pool.end();
          }
          await assert.rejects(
            connection({ ...admin, transport: 'plain', caFile: p('ca.pem') }),
            /PLAIN_CONNECTION_CA_REJECTED/,
          );
          await assert.rejects(
            connection({ ...admin, transport: 'verify-full' }),
            /DATABASE_CA_REQUIRED/,
          );
          report.databaseTransport =
            'PLAIN_ACTUAL_PG_CONNECTION_AND_INVALID_CONFIGURATION_REJECTED';
        }
        const setupFile = p('setup.json');
        await saveJson(setupFile, setupInput, true);
        const setupApproved = await setupPlan(setupFile);
        await assert.rejects(setup(setupFile, '0'.repeat(64)), /SETUP_REVIEWED_PLAN_PIN_REQUIRED/);
        assert.equal(
          Number(
            (
              await x.master.query('SELECT count(*) FROM pg_database WHERE datname = ANY($1)', [
                Object.values(dbs),
              ])
            ).rows[0].count,
          ),
          0,
        );
        // A genuine pre-existing table must be left untouched, before creating other DBs.
        const rejectedRuntime = structuredClone(runtime);
        rejectedRuntime.instanceId = ids.nextCommandId();
        rejectedRuntime.stateDirectory = p('rejected-instance');
        rejectedRuntime.databases = {
          business: 'zhiban_keep_business',
          content: 'zhiban_keep_content',
          authoring: 'zhiban_keep_authoring',
        };
        for (const [key, c] of Object.entries(rejectedRuntime.connections)) {
          c.database =
            rejectedRuntime.databases[
              key === 'native' ? 'content' : key === 'authoring' ? 'authoring' : 'business'
            ];
          c.credentialFile = await secret(
            'keep-' + key + '.env',
            `DATABASE_URL=postgresql://${c.role}:${credentials[c.role]}@127.0.0.1:56553/${c.database}\n`,
          );
        }
        const rejectedRuntimeFile = p('rejected-runtime.json');
        await saveJson(rejectedRuntimeFile, rejectedRuntime, true);
        const rejectedInstall = structuredClone(installInput);
        rejectedInstall.runtimeFile = rejectedRuntimeFile;
        for (const [key, c] of Object.entries(rejectedInstall.migrations)) {
          c.database = rejectedRuntime.databases[key as keyof typeof dbs];
          c.credentialFile = await secret(
            'keep-migrator-' + key + '.env',
            `DATABASE_URL=postgresql://${c.role}:${credentials[c.role]}@127.0.0.1:56553/${c.database}\n`,
          );
        }
        const rejectedInstallFile = p('rejected-install.json');
        await saveJson(rejectedInstallFile, rejectedInstall, true);
        const rejectedSetupFile = p('rejected-setup.json');
        await saveJson(
          rejectedSetupFile,
          { ...setupInput, installationFile: rejectedInstallFile },
          true,
        );
        await x.master.query('CREATE DATABASE zhiban_keep_business OWNER postgres');
        const keep = x.pool('postgres', 'zhiban_keep_business');
        await keep.query('CREATE TABLE public.existing_data(id int PRIMARY KEY,note text)');
        await keep.query("INSERT INTO public.existing_data VALUES(1,'must remain')");
        const rejectedPlan = await setupPlan(rejectedSetupFile);
        await assert.rejects(
          setup(rejectedSetupFile, rejectedPlan.plan.planSha256),
          /SETUP_NONEMPTY_DATABASE_REJECTED/,
        );
        assert.equal(
          (await keep.query('SELECT note FROM public.existing_data WHERE id=1')).rows[0].note,
          'must remain',
        );
        assert.equal(
          Number(
            (
              await x.master.query(
                "SELECT count(*) FROM pg_database WHERE datname IN ('zhiban_keep_content','zhiban_keep_authoring')",
              )
            ).rows[0].count,
          ),
          0,
        );
        await assert.rejects(verifiedInstallation(rejectedRuntimeFile), /quarantined/);
        // Exercise the real operator CLI for automatic initialization.
        await new Promise<void>((done, reject) => {
          const job = spawn(
            process.execPath,
            [
              'scripts/zhiban-deploy/run-production-tool.cjs',
              'production',
              'setup',
              setupFile,
              setupApproved.plan.planSha256,
            ],
            {
              env: { ...process.env, ZHIBAN_PRODUCTION_PRIVATE_DIAGNOSTIC: p('setup-private.log') },
              stdio: 'ignore',
            },
          );
          job.once('error', reject);
          job.once('exit', (code) =>
            code === 0
              ? done()
              : reject(Error('Unified setup CLI failed; inspect private diagnostic')),
          );
        });
        const journalInstalled = JSON.parse(
          await readFile(join(runtime.stateDirectory, 'INSTALLATION.json'), 'utf8'),
        );
        assert.equal(journalInstalled.status, 'READY');
        assert.equal(journalInstalled.completed[0], 'PREPARE_DATABASES');
        const repeated = await setup(setupFile, setupApproved.plan.planSha256);
        assert.equal(repeated.status, 'ALREADY_INSTALLED');
        assert.equal(repeated.databaseAction, 'VERIFIED_NO_DDL');
        report.setup = {
          status: 'PASS',
          scope: 'ONE_CLI_CREATES_THREE_DATABASES_ROLES_SCHEMAS_AND_FIRST_ADMIN',
          repeat: 'VERIFIED_NO_DDL',
          existingData: 'REFUSED_BEFORE_WRITE_AND_PRESERVED',
          privateAdminNotInRuntime: true,
        };
        const verified = await verifiedInstallation(runtimeFile);
        await Promise.all(Object.values(verified.pools).map((q) => q.end()));
        report.installer = 'PASS';
        if (httpMode) {
          const ops = p('ubuntu-ops.json'),
            spec = p('ubuntu-http.json'),
            out = p('ubuntu-http-templates');
          await saveJson(
            ops,
            { runtimeFile, serviceUid: process.getuid!(), serviceGid: process.getgid!() },
            true,
          );
          await saveJson(
            spec,
            {
              kind: 'ZHIBAN_UBUNTU_HOST_V1',
              runtimeFile,
              operationsFile: ops,
              releaseDirectory: '/var/tmp/zhiban-http-release',
              nodeBinary: '/usr/bin/node',
              serviceUser: 'zhiban',
              serviceGroup: 'zhiban',
              serviceUid: process.getuid!(),
              serviceGid: process.getgid!(),
              temporaryDirectory: p('service-tmp'),
              upstreamCaFile: p('ca.pem'),
            },
            true,
          );
          await renderUbuntu(spec, out);
          const inc = join(out, 'zhiban-proxy.inc');
          const server = (await readFile(join(out, 'zhiban.nginx.conf'), 'utf8')).replaceAll(
            '/etc/nginx/zhiban-proxy.inc',
            inc,
          );
          assert.ok(server.includes('listen 3489;') && !server.includes('ssl_certificate'));
          const config = p('nginx-http.conf');
          await writeFile(
            config,
            `pid ${p('nginx.pid')};\nerror_log ${p('nginx.log')} error;\nevents { worker_connections 64; }\nhttp { client_body_temp_path ${p('body-tmp')}; proxy_temp_path ${p('proxy-tmp')}; fastcgi_temp_path ${p('fastcgi-tmp')}; uwsgi_temp_path ${p('uwsgi-tmp')}; scgi_temp_path ${p('scgi-tmp')}; access_log off; ${server} }\n`,
            { mode: 0o600 },
          );
          const nginx =
            process.env.ZHIBAN_NGINX_BIN ||
            '/home/zxm/.local/share/zhiban-nginx-runtime/root/usr/sbin/nginx';
          execFileSync(nginx, ['-t', '-c', config, '-p', base], { stdio: 'pipe' });
          nginxChild = spawn(nginx, ['-c', config, '-p', base, '-g', 'daemon off;'], {
            stdio: 'ignore',
          });
          report.httpProxy = 'PASS_GENERATED_NGINX_CONFIG_SYNTAX_AND_UPSTREAM_TLS';
        }
        const start = () => {
          const proc = spawn(
            process.execPath,
            ['scripts/zhiban-deploy/run-production-tool.cjs', 'production', 'start', runtimeFile],
            {
              env: {
                ...process.env,
                OPENMAIC_CONFIG: key,
                ZHIBAN_PRODUCTION_PRIVATE_DIAGNOSTIC: p('startup-private.log'),
              },
              stdio: ['ignore', 'pipe', 'pipe'],
            },
          );
          let text = '';
          proc.stdout!.on('data', (b) => (text += b));
          proc.stderr!.on('data', (b) => (text += b));
          proc.once('exit', () => {
            void writeFile(p('host-private.log'), text, { mode: 0o600 });
          });
          return proc;
        };
        const ca = await readFile(p('ca.pem'));
        const call = (
          path: string,
          value?: unknown,
          cookie?: string,
          extra: Record<string, string> = {},
        ) =>
          new Promise<{ status: number; body: string; cookie: string }>((yes, no) => {
            const q = (httpMode ? httpRequest : request)(
              runtime.origin + path,
              {
                ...(httpMode ? {} : { ca }),
                agent: false,
                method: value ? 'POST' : 'GET',
                headers: {
                  'x-zhiban-request': 'identity-v1',
                  ...(value ? { origin: runtime.origin, 'content-type': 'application/json' } : {}),
                  ...(cookie ? { cookie } : {}),
                  ...extra,
                },
              },
              (r) => {
                const b: Buffer[] = [];
                r.on('data', (v) => b.push(v));
                r.on('end', () =>
                  yes({
                    status: r.statusCode!,
                    body: Buffer.concat(b).toString(),
                    cookie: r.headers['set-cookie']?.[0]?.split(';')[0] ?? '',
                  }),
                );
              },
            );
            q.on('error', no);
            q.setTimeout(10000, () => q.destroy(Error('HTTPS timeout')));
            q.end(value ? JSON.stringify(value) : undefined);
          });
        const ready = async () => {
          for (let i = 0; i < 120; i++) {
            if (child!.exitCode !== null)
              throw Error('Formal host exited; inspect private startup log');
            try {
              if ((await call('/zhiban')).status === 200) return;
            } catch {}
            await pause(500);
          }
          throw Error('Formal host readiness timeout');
        };
        child = start();
        await ready();
        const competing = start();
        await new Promise<void>((done, reject) => {
          const timer = setTimeout(() => {
            competing.kill('SIGTERM');
            reject(Error('Competing host did not refuse the held lock'));
          }, 15000);
          competing.once('exit', () => {
            clearTimeout(timer);
            done();
          });
        });
        assert.equal(competing.exitCode, 1);

        assert.equal((await call('/api/zhiban/platform')).status, 401);
        const login = await call('/api/zhiban/identity/login', {
          userId: manifest.userId,
          password,
        });
        assert.equal(login.status, 200);
        const platform = await call('/api/zhiban/platform', undefined, login.cookie);
        assert.equal(platform.status, 200);
        assert.equal(JSON.parse(platform.body).platformAdmin, true);
        assert.equal(JSON.parse(platform.body).controlCommandsEnabled, true);
        const tenantProposal: ControlApprovalManifest = {
          approval_id: ids.nextCommandId(),
          purpose: 'TENANT_CREATE',
          environment_ref: environment,
          approval_ref: 'initial-space',
          operator_ref: 'test-installer',
          approver_ref: 'test-approver',
          operator_user_id: manifest.userId,
          expected_operator_user_revision: '1',
          system_admin_grant_id: manifest.grantId,
          expected_admin_grant_revision: '1',
          command_id: ids.nextCommandId(),
          manifest_digest: '',
          catalog_digest: runtime.identity.catalog.expectedDigest,
          action_version: 'identity-v1',
          delegation_version: 'identity-v1',
          target_user_id: null,
          tenant_id: null,
          planned_user_id: null,
          planned_tenant_id: ids.nextTenantId(),
          target_membership_id: null,
          planned_membership_id: null,
          planned_grant_id: null,
          expected_user_revision: null,
          expected_tenant_revision: null,
          expected_member_revision: null,
          expected_auth_version: null,
          valid_until: null,
          tenant_code: 'signed_space',
          tenant_display_name: '双签名开通空间',
          admission_purpose: null,
          issued_at: String(Date.now() - 1000),
          expires_at: String(Date.now() + 300000),
          reason: 'ADMIN_REQUEST',
        };
        const tenantManifest = {
          ...tenantProposal,
          manifest_digest: controlManifestDigest(tenantProposal),
        };
        await saveJson(
          join(controlDirectory, 'initial-space.json'),
          {
            kind: 'ZHIBAN_CONTROL_APPROVAL_V1',
            manifest: tenantManifest,
            operatorSignature: sign(
              null,
              Buffer.from(JSON.stringify(tenantManifest)),
              keys[0].privateKey,
            ).toString('base64'),
            approverSignature: sign(
              null,
              Buffer.from(JSON.stringify(tenantManifest)),
              keys[1].privateKey,
            ).toString('base64'),
          },
          true,
        );
        const csrf = JSON.parse(
            (await call('/api/zhiban/identity/csrf', undefined, login.cookie)).body,
          ).csrfToken,
          csrfHeaders = { 'x-zhiban-csrf': csrf };
        assert.equal(
          (
            await call(
              '/api/zhiban/platform/approvals/register',
              { approvalRef: 'initial-space', password },
              login.cookie,
              csrfHeaders,
            )
          ).status,
          200,
        );
        const controlRequest = {
          approvalRef: 'initial-space',
          idempotencyKey: tenantManifest.command_id,
          requestId: ids.nextCommandId(),
          expectedUserRevision: null,
          expectedTenantRevision: null,
        };
        const opened = await call(
          '/api/zhiban/platform/commands/execute',
          { command: controlRequest, password },
          login.cookie,
          csrfHeaders,
        );
        assert.equal(opened.status, 200, opened.body);
        assert.equal(JSON.parse(opened.body).status, 'APPLIED');
        assert.equal(
          (
            await call(
              '/api/zhiban/platform/commands/execute',
              { command: { ...controlRequest, idempotencyKey: ids.nextCommandId() }, password },
              login.cookie,
              csrfHeaders,
            )
          ).status,
          403,
        );
        report.control = 'PASS_DUAL_SIGNATURE_REAUTH_CSRF_TENANT_CREATE_AND_COMMAND_BINDING';

        assert.equal((await call('/api/persistence')).status, 404);
        assert.equal(
          (
            await call(
              '/api/zhiban/platform/commands/execute',
              { command: {}, password },
              login.cookie,
            )
          ).status,
          403,
        );
        const pageHtml = await call('/zhiban/platform');
        assert.equal(pageHtml.status, 200);
        assert.equal(pageHtml.body.includes('data-zhiban-environment="production"'), true);
        const spki = execFileSync(
          'openssl',
          ['x509', '-in', p('server.pem'), '-pubkey', '-noout'],
          { encoding: 'utf8' },
        );
        const { createPublicKey } = await import('node:crypto');
        const certPin = createHash('sha256')
          .update(createPublicKey(spki).export({ type: 'spki', format: 'der' }))
          .digest('base64');
        browser = await chromium.launch({
          headless: true,
          args: httpMode ? [] : [`--ignore-certificate-errors-spki-list=${certPin}`],
        });
        const context = await browser.newContext(),
          page = await context.newPage();
        await page.goto(runtime.origin + '/zhiban');
        await page.getByLabel('账号 ID 或 @登录标识').fill(manifest.userId);
        await page.getByLabel('密码', { exact: true }).fill(password);
        await page.getByRole('button', { name: '登录并进入', exact: true }).click();
        await page.getByRole('link', { name: '平台管理', exact: true }).click();
        await page.getByRole('heading', { name: '平台管理', exact: true }).waitFor();
        if (httpMode) {
          const cookies = await context.cookies();
          assert.ok(
            cookies.some((v) => v.name === 'zhiban_session_http' && !v.secure && v.httpOnly),
          );
          await page.reload();
          await page.getByRole('heading', { name: '平台管理', exact: true }).waitFor();
          report.httpBrowser = 'PASS_LOGIN_COOKIE_AND_PAGE_RELOAD';
        }
        if (httpMode) {
          await page.reload();
          await page.getByRole('heading', { name: '平台管理', exact: true }).waitFor();
          const own = await page.evaluate(async () => {
            const common = { 'x-zhiban-request': 'identity-v1' };
            const get = await fetch('/api/zhiban/identity/csrf', { headers: common });
            const { csrfToken } = await get.json();
            const logout = await fetch('/api/zhiban/identity/logout', {
              method: 'POST',
              headers: {
                ...common,
                'content-type': 'application/json',
                'x-zhiban-csrf': csrfToken,
              },
              body: '{}',
            });
            const me = await fetch('/api/zhiban/identity/me', { headers: common });
            return { logout: logout.status, me: me.status };
          });
          assert.deepEqual(own, { logout: 204, me: 401 });
          await page.goto(runtime.origin + '/zhiban');
          await page.getByLabel('账号 ID 或 @登录标识').fill(manifest.userId);
          await page.getByLabel('密码', { exact: true }).fill(password);
          await page.getByRole('button', { name: '登录并进入', exact: true }).click();
          await page.getByRole('link', { name: '平台管理', exact: true }).click();
          await page.getByRole('heading', { name: '平台管理', exact: true }).waitFor();
          const proof = JSON.parse(
            (await call('/api/zhiban/identity/csrf', undefined, login.cookie)).body,
          ).csrfToken;
          assert.equal(
            (
              await call('/api/zhiban/identity/logout', {}, login.cookie, {
                'x-zhiban-csrf': proof,
                origin: 'http://attacker.example',
              })
            ).status,
            403,
          );
          report.httpBrowser = 'PASS_LOGIN_RELOAD_LOGOUT_CSRF_AND_CROSS_ORIGIN_REJECTION';
        }
        assert.equal(await page.getByText('本地体验环境').count(), 0);
        const screenshots = resolve('docs/v2/evidence/persistence-130/production-install-runs');
        await mkdir(screenshots, { recursive: true });
        const shotDir = await mkdtemp(join(screenshots, 'fresh-'));
        await page.screenshot({ path: join(shotDir, 'first-platform-admin.png'), fullPage: true });
        report.browser = {
          status: 'PASS',
          screenshot: join(shotDir, 'first-platform-admin.png'),
          tlsTrust: httpMode
            ? 'HTTP_PUBLIC_NGINX_UPSTREAM_TLS_VERIFIED'
            : 'EXACT_LEAF_SPKI_PIN_PLUS_NODE_HTTPS_CA_VERIFICATION',
        };
        assert.equal(
          Number(
            (
              await x.master.query(
                `SELECT count(*) FROM pg_database WHERE datname LIKE 'zhiban_fresh_%'`,
              )
            ).rows[0].count,
          ),
          3,
        );
        const teaching = await verifyProductionTeaching({
          pool: x.pool,
          database: dbs.business,
          browser,
          origin: runtime.origin,
          call,
          ...(httpMode && process.env.ZHIBAN_HTTP_INTERACTIVE === '1'
            ? {
                deliverAccounts: async (value) => {
                  const dir = join(homedir(), '.local/state/zhiban-http-interactive');
                  await mkdir(dir, { recursive: true, mode: 0o700 });
                  await saveJson(
                    join(dir, 'accounts.json'),
                    { ...value, pid: process.pid, scope: 'LOCAL_DISPOSABLE_HTTP' },
                    false,
                  );
                },
              }
            : {}),
        });
        if (httpMode && process.env.ZHIBAN_HTTP_INTERACTIVE === '1') {
          console.log('HTTP_INTERACTIVE_READY ' + runtime.origin + '/zhiban');
          await new Promise<void>((done) => {
            process.once('SIGTERM', done);
            process.once('SIGINT', done);
          });
          throw Error('HTTP_INTERACTIVE_STOPPED');
        }
        const { student: studentReplay, ...teachingEvidence } = teaching;
        report.teaching = teachingEvidence;
        await copyFile(profileFile, join(shotDir, 'source-profile.json'));
        report.sourceProfile = join(shotDir, 'source-profile.json');
        await browser.close();
        browser = undefined;
        const stop = async () => {
          if (!child || child.exitCode !== null) return;
          child.kill('SIGTERM');
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(Error('Formal host shutdown timeout')), 45000);
            child!.once('exit', () => {
              clearTimeout(timeout);
              resolve();
            });
          });
          assert.equal(child.exitCode, 0);
        };
        await stop();
        child = start();
        await ready();
        const again = await call('/api/zhiban/identity/login', {
          userId: manifest.userId,
          password,
        });
        assert.equal(again.status, 200);
        const studentAgain = await call('/api/zhiban/identity/login', {
          userId: studentReplay.userId,
          password: studentReplay.password,
        });
        assert.equal(studentAgain.status, 200);
        assert.equal(
          (
            await call(
              new URL(studentReplay.progress).pathname + new URL(studentReplay.progress).search,
              undefined,
              studentAgain.cookie,
            )
          ).status,
          200,
        );
        await stop();
        child = undefined;
        report.restart = 'PASS_SAME_ADMINISTRATOR_AND_PASSWORD';
        if (!httpMode)
          report.operations = await verifyProductionOperations({
            base,
            x,
            runtime,
            runtimeFile,
            installInput,
            startSource: start,
            student: studentReplay,
            administrator: { userId: manifest.userId, password },
          });
        const receiptPath = join(runtime.stateDirectory, 'RECEIPT.json'),
          receiptBytes = await readFile(receiptPath);
        const envelope = JSON.parse(receiptBytes.toString());
        envelope.body.deploymentId = ids.nextCommandId();
        await saveJson(receiptPath, envelope);
        await assert.rejects(verifiedInstallation(runtimeFile), /signature rejected/);
        await writeFile(receiptPath, receiptBytes, { mode: 0o600 });
        const journalPath = join(runtime.stateDirectory, 'INSTALLATION.json'),
          journal = JSON.parse(await readFile(journalPath, 'utf8'));
        await saveJson(journalPath, { ...journal, status: 'FAILED' });
        await assert.rejects(verifiedInstallation(runtimeFile), /quarantined/);
        await saveJson(journalPath, journal);
        // A real later-phase connection failure, after committed business DDL.
        const partialDbs = {
          business: 'zhiban_partial_business',
          content: 'zhiban_partial_content',
          authoring: 'zhiban_partial_authoring',
        };
        await prepareOwned(x, partialDbs);
        const partialRuntime = structuredClone(runtime);
        partialRuntime.instanceId = ids.nextCommandId();
        partialRuntime.stateDirectory = p('partial-instance');
        partialRuntime.databases = partialDbs;
        for (const [key, c] of Object.entries(partialRuntime.connections)) {
          const db =
            partialDbs[
              key === 'native' ? 'content' : key === 'authoring' ? 'authoring' : 'business'
            ];
          c.database = db;
          c.credentialFile = await secret(
            'partial-' + key + '.env',
            `DATABASE_URL=postgresql://${c.role}:${credentials[c.role]}@127.0.0.1:56553/${db}\n`,
          );
        }
        const partialRuntimeFile = p('partial-runtime.json');
        await saveJson(partialRuntimeFile, partialRuntime, true);
        const partialInput = structuredClone(installInput);
        partialInput.runtimeFile = partialRuntimeFile;
        for (const [key, c] of Object.entries(partialInput.migrations)) {
          c.database = partialDbs[key as keyof typeof partialDbs];
          c.credentialFile = await secret(
            'partial-migration-' + key + '.env',
            `DATABASE_URL=postgresql://${c.role}:${key === 'content' ? 'intentionally-wrong-disposable-password' : credentials[c.role]}@127.0.0.1:56553/${c.database}\n`,
          );
        }
        const partialFile = p('partial-install.json');
        await saveJson(partialFile, partialInput, true);
        const partialPlan = await installationPlan(partialFile);
        await assert.rejects(installFresh(partialFile, partialPlan.plan.planSha256));
        const partialJournal = JSON.parse(
          await readFile(join(partialRuntime.stateDirectory, 'INSTALLATION.json'), 'utf8'),
        );
        assert.equal(partialJournal.status, 'FAILED');
        assert.equal(partialJournal.phase, 'CONTENT_SCHEMA');
        assert.deepEqual(partialJournal.completed, ['BUSINESS_SCHEMA']);
        assert.ok(
          (
            await x
              .pool('postgres', partialDbs.business)
              .query("SELECT 1 FROM pg_namespace WHERE nspname='zhiban_identity'")
          ).rowCount,
        );
        await assert.rejects(readFile(join(partialRuntime.stateDirectory, 'RECEIPT.json')));
        await assert.rejects(verifiedInstallation(partialRuntimeFile), /quarantined/);
        const authoringAdmin = x.pool('postgres', dbs.authoring);
        await authoringAdmin.query(
          'GRANT MAINTAIN ON public.openmaic_schema_migrations TO zhiban_authoring_runtime',
        );
        await assert.rejects(verifiedInstallation(runtimeFile), /profile rejected/);
        await authoringAdmin.query(
          'REVOKE MAINTAIN ON public.openmaic_schema_migrations FROM zhiban_authoring_runtime',
        );
        const businessAdmin = x.pool('postgres', dbs.business);
        await businessAdmin.query(
          "UPDATE zhiban_identity.schema_migrations SET checksum=repeat('0',64) WHERE version='0001'",
        );
        await assert.rejects(verifiedInstallation(runtimeFile), /ledger rejected/);
        report.negatives = [
          'WRONG_PLAN',
          'SETUP_WRONG_PIN_NO_DATABASE_WRITE',
          'SETUP_NONEMPTY_DATABASE_RETAINED',
          'CONCURRENT_RUNTIME_LOCK',
          'UNAUTHENTICATED',
          'NON_ADMIN',
          'RAW_NATIVE_CLOSED',
          'CSRF',
          'TAMPERED_RECEIPT',
          'ACTUAL_PARTIAL_CONTENT_CONNECTION_FAILURE',
          'ACL_MAINTAIN_DRIFT',
          'IDENTITY_LEDGER_DRIFT',
        ];
        report.partialFailure = {
          status: 'QUARANTINED',
          failedPhase: partialJournal.phase,
          retainedCompletedPhases: partialJournal.completed,
          noReceipt: true,
        };
        report.sourceScope = 'UNCOMMITTED_CANDIDATE';
        report.status = 'PASS';

        const output = resolve('docs/v2/evidence/persistence-130/production-install-runs');
        await mkdir(output, { recursive: true });
        await saveJson(
          join(
            output,
            httpMode
              ? 'latest-http-local.json'
              : process.env.ZHIBAN_VERIFY_PLAIN_PG === '1'
                ? 'latest-plain-local.json'
                : 'latest-local.json',
          ),
          report,
        );
      },
      { owner: 'postgres', grantor: 'postgres' },
      { certificate: p('server.pem'), key: p('server.key') },
    );
    succeeded = true;
    console.log(
      `PASS formal three-database installation, first administrator ${httpMode ? 'HTTP' : 'HTTPS'}/browser management, restart, and receipt/quarantine negatives`,
    );
  } catch (e) {
    const out = join(homedir(), '.local/state/zhiban-production-ab');
    await mkdir(out, { recursive: true, mode: 0o700 });
    await writeFile(join(out, 'journey-error.txt'), String((e as Error).stack ?? e), {
      mode: 0o600,
    });
    await writeFile(join(out, 'failed-input-root.txt'), base, { mode: 0o600 });
    throw e;
  } finally {
    await browser?.close();
    if (nginxChild && nginxChild.exitCode === null) {
      nginxChild.kill('SIGTERM');
      await new Promise<void>((r) => nginxChild!.once('exit', () => r()));
    }
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise<void>((r) => child!.once('exit', () => r()));
    }
    if (succeeded)
      await rm(base, {
        recursive: true,
        force: true,
      }); /* Failed private inputs retained only on failure for directed diagnosis. */
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
