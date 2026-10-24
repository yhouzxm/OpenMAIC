import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { v7 } from 'uuid';
import {
  directory,
  database,
  pgPort,
  privateFile,
  loadRuntime,
  digest,
  requirePrivateClusterDirectories,
} from './config';
import { readContentConfiguration, validateContentInstallation } from './content-receipt';
import { createIdentityComposition } from '@/lib/zhiban/infrastructure/identity/composition/root';
import { observeOperation } from '@/lib/zhiban/infrastructure/identity/composition/refusals';
import { observedTransport } from '@/lib/zhiban/infrastructure/identity/composition/admission';
import { bearerForCookie } from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import { PostgresIdentityRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/user';
import { PostgresMembershipRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/membership';
import { PostgresSessionRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/session';
import { PostgresCredentialRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import { Argon2PasswordHasher } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { LocalCompromisedPasswordScreening } from '@/lib/zhiban/infrastructure/identity/credentials/password-screening';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import {
  Membership,
  RoleGrant,
  User,
  instant,
  tenantId,
  tenantScope,
  selfScope,
} from '@/lib/zhiban/domain/identity';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { ContentService } from '@/lib/zhiban/infrastructure/content/service';
import { admittedOperation } from '@/lib/zhiban/infrastructure/openmaic/transactions';

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
async function bounded<T>(p: Promise<T>, ms = 6000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      p,
      new Promise<never>(
        (_, reject) => (timer = setTimeout(() => reject(new Error('Barrier timeout')), ms)),
      ),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
type Kind =
  | 'role'
  | 'membership'
  | 'user'
  | 'owner-membership'
  | 'owner-user'
  | 'session'
  | 'credential'
  | 'assignment';
type Phase = 'before-native' | 'native-commit' | 'settlement-commit';
async function main() {
  await requirePrivateClusterDirectories();
  const runtime = await loadRuntime(),
    { config, receipt } = await readContentConfiguration();
  const fixture = JSON.parse((await privateFile('m5-last-fixture.json')).toString());
  const all: Pool[] = [];
  const pool = (dsn: string, max = 3) => {
    const p = new Pool({
      connectionString: dsn,
      max,
      connectionTimeoutMillis: 3000,
      statement_timeout: 8000,
    });
    all.push(p);
    return p;
  };
  const auth = pool(runtime.secrets.LOCAL_M1_AUTH),
    tenant = pool(runtime.secrets.LOCAL_M1_TENANT),
    control = pool(runtime.secrets.LOCAL_M1_CONTROL);
  const bridge = pool(config.bridge),
    native = pool(config.native);
  const admin = new Pool({
    host: join(directory, 'socket'),
    port: pgPort,
    database,
    user: 'postgres',
    max: 3,
  });
  all.push(admin);
  const results: any[] = [];
  const createdUsers: string[] = [];
  try {
    const endpoint = (
      await admin.query(
        "SELECT current_setting('data_directory') AS dir,current_database() AS db,current_setting('server_version_num')::int AS pg",
      )
    ).rows[0];
    assert.equal(endpoint.dir, join(directory, 'pgdata'));
    assert.equal(endpoint.db, database);
    assert.ok(endpoint.pg >= 160000 && endpoint.pg < 170000);
    await validateContentInstallation(bridge, native, receipt, config);
    const root = await createIdentityComposition({ auth, tenant, control }, runtime.composition);
    const ids = new IdentityIds(),
      users = new PostgresIdentityRepository(control),
      members = new PostgresMembershipRepository(tenant),
      credentials = new PostgresCredentialRepository(auth);
    const hashing = new Argon2PasswordHasher(
      new LocalCompromisedPasswordScreening(runtime.composition.corpus.values),
    );
    const context = tenantScopeContext(tenantId(fixture.tenant));
    const academic = pool(JSON.parse((await privateFile('academic.json')).toString()).academic);
    const freshTeacher = async (role: 'TEACHER' | 'STUDENT' = 'TEACHER') => {
      const uid = ids.nextUserId(),
        password = randomBytes(24).toString('base64url'),
        now = instant(Date.now());
      await users.create(User.create(uid, now));
      createdUsers.push(uid);
      await credentials.createPassword(
        uid,
        ids.nextCredentialId(),
        await hashing.hash(password),
        instant(Date.now()),
        {
          actor: { kind: 'SERVICE', serviceCode: 'local_m5_barrier_seed' },
          requestId: 'LOCAL_M5_BARRIER_SEED',
          reason: 'SYSTEM_MAINTENANCE',
        },
      );
      const grant = RoleGrant.create({
        id: ids.nextRoleGrantId(),
        roleCode: role,
        scope: role === 'TEACHER' ? tenantScope() : selfScope(),
        createdAt: now,
        validFrom: now,
        validUntil: null,
      });
      const member = Membership.create({
        id: ids.nextMembershipId(),
        userId: uid,
        tenantId: tenantId(fixture.tenant),
        now,
      }).activatePending({ expectedAuthorizationVersion: 0, now, approvedGrants: [grant] });
      await members.create(context, member);
      await admin.query(
        `INSERT INTO zhiban_academic.${role === 'TEACHER' ? 'assignments' : 'enrollments'} VALUES($1,$2,$3,$4,'ACTIVE',$5,NULL,1)`,
        [fixture.tenant, v7(), fixture.offering, member.id, Date.now()],
      );
      const loginAttempt = () =>
        observeOperation(() =>
          root.security.login(
            uid,
            password,
            observedTransport('127.0.0.1'),
            'LOCAL_M5_BARRIER_LOGIN',
          ),
        );
      let observed = await loginAttempt();
      if (!observed.ok && observed.refusal === 'ADMISSION_DENIED') {
        // Respect the unchanged 30/IP/minute policy; no fixture reset, alternate IP or bypass.
        console.log('LOCAL fixture login admission window reached; waiting for normal expiry');
        await new Promise((r) => setTimeout(r, 30000));
        await new Promise((r) => setTimeout(r, 31000));
        observed = await loginAttempt();
      }
      assert.ok(observed.ok, 'Synthetic login admission/authentication rejected');
      if (!observed.ok) throw new Error('Synthetic authentication rejected');
      const login = observed.value;
      assert.equal(login.status, 'ISSUED');
      if (login.status !== 'ISSUED') throw new Error('Synthetic login rejected');
      const handle = await root.security.authenticate(bearerForCookie(login.bearer));
      assert.ok(handle);
      return {
        user: uid,
        member: member.id,
        grant: grant.id,
        handle,
        tenant: fixture.tenant,
        offering: fixture.offering,
      };
    };
    // New synthetic actors per case: no mutation of M1/M2 accounts, no reset or grant resurrection.
    for (const kind of [
      'role',
      'membership',
      'user',
      'owner-membership',
      'owner-user',
      'session',
      'credential',
      'assignment',
    ] as Kind[]) {
      for (const phase of ['before-native', 'native-commit', 'settlement-commit'] as Phase[]) {
        const actor = await freshTeacher(),
          owner = kind.startsWith('owner-') ? await freshTeacher() : actor;
        const plain = new ContentService(bridge, native, root.security, config.deploymentId);
        const call = (s: ContentService, x: any, v: any) =>
          admittedOperation((deadline) =>
            s.execute({ ...x, deadline }, v, v7().replaceAll('-', '')),
          );
        const created = await call(plain, owner, {
          type: 'CREATE_CONTENT',
          title: `LOCAL barrier ${kind} ${phase}`,
        });
        let resource = (
          await admin.query('SELECT * FROM zhiban_content.resources WHERE id=$1', [created.id])
        ).rows[0];
        await call(plain, actor, {
          type: 'SAVE_CONTENT',
          id: created.id,
          revision: resource.revision,
          title: resource.title,
          slides: [
            {
              id: v7(),
              elements: [
                { id: v7(), text: 'real native barrier', x: 20, y: 20, width: 600, height: 100 },
              ],
            },
          ],
        });
        resource = (
          await admin.query('SELECT * FROM zhiban_content.resources WHERE id=$1', [created.id])
        ).rows[0];
        const reached = latch(),
          release = latch(),
          writerDone = latch();
        let bridgePid = 0,
          nativeWritten = false,
          nativeCommitted = false,
          hit = false,
          armed = true;
        const wrap = (original: Pool, side: 'bridge' | 'native') =>
          ({
            connect: async () => {
              const c = await original.connect();
              const pid = Number((await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
              let writes = false,
                dispatch = false,
                settlement = false;
              return {
                release: (discard?: boolean) => c.release(discard),
                query: async (sql: string, parameters?: unknown[]) => {
                  if (side === 'bridge' && sql.includes('bridge_identity_context')) bridgePid = pid;
                  if (side === 'native' && /INSERT INTO document_stages/.test(sql)) {
                    writes = true;
                    nativeWritten = true;
                  }
                  if (
                    side === 'bridge' &&
                    sql.startsWith('UPDATE zhiban_bridge.operations SET dispatch_started_at')
                  )
                    dispatch = true;
                  if (side === 'bridge' && sql.includes('INSERT INTO zhiban_content.publications'))
                    settlement = true;
                  if (
                    armed &&
                    !hit &&
                    sql === 'COMMIT' &&
                    ((phase === 'native-commit' && side === 'native' && writes) ||
                      (phase === 'settlement-commit' && side === 'bridge' && settlement))
                  ) {
                    hit = true;
                    reached.resolve();
                    await bounded(release.promise);
                  }
                  const result = await c.query(sql, parameters);
                  if (side === 'native' && sql === 'COMMIT' && writes) nativeCommitted = true;
                  // Between Bridge transactions the revoker can commit; no production hook or SQL is altered.
                  if (armed && sql === 'COMMIT' && side === 'bridge') {
                    if (phase === 'before-native' && dispatch && !hit) {
                      hit = true;
                      reached.resolve();
                      await bounded(release.promise);
                    }
                    if (phase === 'native-commit' && nativeCommitted && hit)
                      await bounded(writerDone.promise);
                  }
                  return result;
                },
              };
            },
          }) as unknown as Pool;
        const service = new ContentService(
          wrap(bridge, 'bridge'),
          wrap(native, 'native'),
          root.security,
          config.deploymentId,
        );
        const writer = await (
          kind.endsWith('user')
            ? control
            : kind === 'session' || kind === 'credential'
              ? auth
              : kind === 'assignment'
                ? academic
                : tenant
        ).connect();
        const credential = kind === 'credential' ? await credentials.findSlot(actor.user) : null;
        const pinned = {
          connect: async () => ({
            query: writer.query.bind(writer),
            release: () => {},
          }),
        };
        const writerPid = Number(
          (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        );
        let mutation: Promise<void> | undefined, publish: Promise<any> | undefined;
        const target = kind.startsWith('owner-') ? owner : actor;
        try {
          publish = call(service, actor, {
            type: 'PUBLISH_CONTENT',
            id: created.id,
            revision: resource.revision,
          }).then(
            (value) => ({ ok: true, value }),
            (error) => ({ ok: false, code: error?.code ?? error?.name }),
          );
          await bounded(reached.promise);
          if (kind !== 'session' && kind !== 'credential') {
            await writer.query('BEGIN');
            await writer.query("SELECT set_config('app.tenant_id',$1,true)", [fixture.tenant]);
          }
          mutation = (async () => {
            // Real runtime writer roles, original row locks and triggers; never superuser revocation.
            const time = Date.now();
            if (kind === 'session') {
              await new PostgresSessionRepository(pinned).revokeAllForUser(
                target.user,
                instant(time),
              );
            } else if (kind === 'credential') {
              assert.ok(credential);
              await new PostgresCredentialRepository(pinned).revokePassword(
                target.user,
                credential.revision,
                credential.value.activeCredentialId,
                instant(time),
                {
                  actor: { kind: 'SERVICE', serviceCode: 'local_m5_barrier' },
                  requestId: 'LOCAL_M5_BARRIER_REVOKE',
                  reason: 'SYSTEM_MAINTENANCE',
                },
              );
            } else if (kind === 'assignment') {
              assert.equal(
                (
                  await writer.query(
                    "UPDATE zhiban_academic.assignments SET status='ENDED',valid_until=$1,revision=revision+1 WHERE tenant_id=$2 AND offering_id=$3 AND membership_id=$4",
                    [time, fixture.tenant, fixture.offering, actor.member],
                  )
                ).rowCount,
                1,
              );
            } else if (kind === 'role') {
              await writer.query(
                'SELECT membership_id FROM zhiban_identity.memberships WHERE membership_id=$1 FOR UPDATE',
                [target.member],
              );
              assert.equal(
                (
                  await writer.query(
                    'UPDATE zhiban_identity.role_grants SET revoked_at=$1 WHERE grant_id=$2',
                    [time, target.grant],
                  )
                ).rowCount,
                1,
              );
              await writer.query(
                'UPDATE zhiban_identity.memberships SET authorization_version=authorization_version+1,repository_revision=repository_revision+1,updated_at=$1 WHERE membership_id=$2',
                [time, target.member],
              );
            } else if (kind.endsWith('membership')) {
              assert.equal(
                (
                  await writer.query(
                    "UPDATE zhiban_identity.memberships SET status='DISABLED',disabled_at=$1,disabled_reason='LOCAL_M5_BARRIER',updated_at=$1,repository_revision=repository_revision+1,authorization_version=authorization_version+1 WHERE membership_id=$2",
                    [time, target.member],
                  )
                ).rowCount,
                1,
              );
            } else {
              assert.equal(
                (
                  await writer.query(
                    "UPDATE zhiban_identity.users SET status='DISABLED',disabled_at=$1,disabled_reason='LOCAL_M5_BARRIER',updated_at=$1,repository_revision=repository_revision+1 WHERE user_id=$2",
                    [time, target.user],
                  )
                ).rowCount,
                1,
              );
            }
            if (kind !== 'session' && kind !== 'credential') await writer.query('COMMIT');
            writerDone.resolve();
          })();
          // Observe rejections immediately, so a fixture error cannot become an unhandled promise.
          void mutation.catch(() => writerDone.resolve());
          let blocked = false;
          if (phase !== 'before-native') {
            const until = Date.now() + 2000;
            while (Date.now() < until) {
              const row = (
                await admin.query('SELECT $1=ANY(pg_blocking_pids($2)) AS blocked', [
                  bridgePid,
                  writerPid,
                ])
              ).rows[0];
              if (row.blocked) {
                blocked = true;
                break;
              }
              await new Promise((r) => setTimeout(r, 10));
            }
            assert.ok(blocked, `real ${kind} writer must wait behind Bridge guard at ${phase}`);
            release.resolve();
          } else {
            await bounded(mutation);
            release.resolve();
          }
          const outcome = await bounded(publish);
          await bounded(mutation);
          armed = false;
          const after = (
            await admin.query(
              'SELECT state,revision,active_publication_id FROM zhiban_content.resources WHERE id=$1',
              [created.id],
            )
          ).rows[0];
          const op = (
            await admin.query(
              "SELECT state FROM zhiban_content.operations WHERE resource_id=$1 AND action='PUBLISH_CONTENT'",
              [created.id],
            )
          ).rows[0];
          const generation = (
            await admin.query(
              'SELECT g.stage_ref FROM zhiban_bridge.resource_generations g JOIN zhiban_bridge.resource_slots s ON s.tenant_id=g.tenant_id AND s.slot_id=g.slot_id WHERE s.activity_id=$1',
              [created.id],
            )
          ).rows;
          assert.equal(generation.length, 1);
          const nativeRows = Number(
            (
              await native.query('SELECT count(*) FROM public.document_stages WHERE id=$1', [
                generation[0].stage_ref,
              ])
            ).rows[0].count,
          );
          assert.equal(nativeRows, phase === 'before-native' ? 0 : 1);
          if (phase === 'settlement-commit') {
            assert.equal(outcome.ok, true);
            assert.equal(after.state, 'PUBLISHED');
            assert.equal(op.state, 'SUCCEEDED');
          } else {
            assert.equal(outcome.ok, false);
            assert.equal(after.state, 'DRAFT');
            assert.equal(after.revision, resource.revision);
            assert.equal(after.active_publication_id, null);
            assert.ok(['RESERVED', 'OUTCOME_UNKNOWN'].includes(op.state));
          }
          assert.equal(nativeWritten, phase !== 'before-native');
          assert.equal(nativeCommitted, phase !== 'before-native');
          // Authentic old handle is denied after the acknowledged revocation, including owner changes.
          await assert.rejects(() =>
            call(plain, actor, {
              type: 'SAVE_CONTENT',
              id: created.id,
              revision: after.revision,
              title: resource.title,
              slides: resource.draft.slides,
            }),
          );
          await assert.rejects(() =>
            admittedOperation((deadline) =>
              plain.preview({ ...actor, deadline }, created.id, 'published'),
            ),
          );
          const evidence = {
            kind,
            phase,
            resource: created.id,
            actor: actor.member,
            owner: owner.member,
            blocked,
            bridgePid,
            writerPid,
            nativeWritten,
            nativeCommitted,
            nativeRows,
            publication: after.state,
            operation: op.state,
            postRevocationDenied: true,
          };
          results.push(evidence);
          console.log(
            `PASS ${kind} / ${phase}: Native=${nativeCommitted}, publication=${after.state}, revokerBlocked=${blocked}`,
          );
        } finally {
          armed = false;
          release.resolve();
          writerDone.resolve();
          await Promise.allSettled([
            ...(publish ? [publish] : []),
            ...(mutation ? [mutation] : []),
          ]);
          await writer.query('ROLLBACK').catch(() => {});
          writer.release();
          // Session/credential cleanup applies only to actors this test created; durable content/fences remain.
          for (const participant of new Map([actor, owner].map((x) => [x.user, x])).values()) {
            await root.security.logout(participant.handle, 'LOCAL_M5_BARRIER_END').catch(() => {});
            await admin.query(
              "UPDATE zhiban_identity.users SET status='DISABLED',disabled_at=$1,disabled_reason='LOCAL_M5_FIXTURE_RETAINED',updated_at=$1,repository_revision=repository_revision+1 WHERE user_id=$2 AND status='ACTIVE'",
              [Date.now(), participant.user],
            );
          }
        }
      }
    }
    for (const phase of ['before-read', 'native-read-commit'] as const) {
      const owner = await freshTeacher(),
        student = await freshTeacher('STUDENT');
      const plain = new ContentService(bridge, native, root.security, config.deploymentId);
      const call = (v: any) =>
        admittedOperation((deadline) =>
          plain.execute({ ...owner, deadline }, v, v7().replaceAll('-', '')),
        );
      const created = await call({
        type: 'CREATE_CONTENT',
        title: 'LOCAL Enrollment read barrier',
      });
      const slides = [
        {
          id: v7(),
          elements: [
            {
              id: v7(),
              text: 'published enrollment barrier',
              x: 20,
              y: 20,
              width: 600,
              height: 100,
            },
          ],
        },
      ];
      await call({
        type: 'SAVE_CONTENT',
        id: created.id,
        revision: '1',
        title: 'LOCAL Enrollment read barrier',
        slides,
      });
      await call({ type: 'PUBLISH_CONTENT', id: created.id, revision: '2' });
      const reached = latch(),
        release = latch();
      let hit = false,
        nativeQueries = 0,
        bridgePid = 0;
      const instrument = (original: Pool, side: 'bridge' | 'native') =>
        ({
          connect: async () => {
            const c = await original.connect();
            const pid = (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
            return {
              release: (discard?: boolean) => c.release(discard),
              query: async (sql: string, params?: unknown[]) => {
                if (side === 'bridge' && sql.includes('bridge_identity_context')) bridgePid = pid;
                if (side === 'native') {
                  nativeQueries++;
                  if (phase === 'native-read-commit' && !hit && sql === 'COMMIT') {
                    hit = true;
                    reached.resolve();
                    await bounded(release.promise);
                  }
                }
                return c.query(sql, params);
              },
            };
          },
        }) as unknown as Pool;
      const service = new ContentService(
        instrument(bridge, 'bridge'),
        instrument(native, 'native'),
        root.security,
        config.deploymentId,
      );
      const preview = () =>
        admittedOperation((deadline) =>
          service.preview({ ...student, deadline }, created.id, 'published'),
        );
      const writer = await academic.connect();
      const writerPid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      let reading: Promise<any> | undefined, mutation: Promise<any> | undefined;
      try {
        await writer.query('BEGIN');
        await writer.query("SELECT set_config('app.tenant_id',$1,true)", [fixture.tenant]);
        if (phase === 'native-read-commit') {
          reading = preview().then(
            (value) => ({ ok: true, value }),
            (error) => ({ ok: false, error }),
          );
          await bounded(reached.promise);
        }
        mutation = (async () => {
          assert.equal(
            (
              await writer.query(
                "UPDATE zhiban_academic.enrollments SET status='WITHDRAWN',valid_until=$1,revision=revision+1 WHERE tenant_id=$2 AND offering_id=$3 AND membership_id=$4",
                [Date.now(), fixture.tenant, fixture.offering, student.member],
              )
            ).rowCount,
            1,
          );
          await writer.query('COMMIT');
        })();
        void mutation.catch(() => {});
        let blocked = false;
        if (phase === 'native-read-commit') {
          const until = Date.now() + 2000;
          while (Date.now() < until) {
            if (
              (
                await admin.query('SELECT $1=ANY(pg_blocking_pids($2)) AS blocked', [
                  bridgePid,
                  writerPid,
                ])
              ).rows[0].blocked
            ) {
              blocked = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 10));
          }
          assert.ok(blocked);
          release.resolve();
          const result = await bounded(reading!);
          assert.equal(result.ok, true);
          assert.equal(result.value.slides[0].elements[0].text, 'published enrollment barrier');
        }
        await bounded(mutation);
        const priorQueries = nativeQueries;
        await assert.rejects(preview);
        assert.equal(nativeQueries, priorQueries);
        if (phase === 'before-read') assert.equal(nativeQueries, 0);
        else assert.ok(nativeQueries > 0);
        results.push({
          kind: 'enrollment',
          phase,
          resource: created.id,
          actor: student.member,
          owner: owner.member,
          blocked,
          bridgePid,
          writerPid,
          nativeQueries,
          postRevocationDenied: true,
        });
        console.log(
          `PASS enrollment / ${phase}: Native queries=${nativeQueries}, revokerBlocked=${blocked}`,
        );
      } finally {
        release.resolve();
        await Promise.allSettled([...(reading ? [reading] : []), ...(mutation ? [mutation] : [])]);
        await writer.query('ROLLBACK').catch(() => {});
        writer.release();
        for (const participant of [owner, student]) {
          await root.security.logout(participant.handle, 'LOCAL_M5_BARRIER_END').catch(() => {});
          await admin.query(
            "UPDATE zhiban_identity.users SET status='DISABLED',disabled_at=$1,disabled_reason='LOCAL_M5_FIXTURE_RETAINED',updated_at=$1,repository_revision=repository_revision+1 WHERE user_id=$2 AND status='ACTIVE'",
            [Date.now(), participant.user],
          );
        }
      }
    }
    await validateContentInstallation(bridge, native, receipt, config);
    await writeFile(
      'docs/v2/evidence/m5-revocation-barriers-local.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          at: new Date().toISOString(),
          scope: 'REAL_CONTENT_SERVICE_REAL_IDENTITY_GUARD_REAL_PG16_NATIVE_PUBLIC_STORE',
          status: 'PASS',
          checkCount: results.length,
          checks: results,
          implementationBindingHash: receipt.bindingHash,
          candidateMigrationSha256: receipt.candidateMigrationSha256,
          runnerSha256: digest(
            await readFile('scripts/zhiban-local/verify-m5-revocation.mts', 'utf8'),
          ),
          method:
            'Fixture-only Pool proxy pauses real SQL at COMMIT or between real transactions; actual runtime writer locks observed via pg_blocking_pids; no fake guard/store or production hooks',
          cleanup:
            'Only new synthetic users; Sessions revoked when possible and users disabled. Durable content/Native documents and RESERVED/UNKNOWN fences retained; no reconcile/reset/delete.',
          remaining: ['UNKNOWN authorized reconciliation operator', 'production release signoff'],
          commitPushCiDispatch: false,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`LOCAL M5 revocation ${results.length}/${results.length} PASS`);
  } finally {
    if (createdUsers.length)
      await admin.query(
        "UPDATE zhiban_identity.users SET status='DISABLED',disabled_at=$1,disabled_reason='LOCAL_M5_FIXTURE_RETAINED',updated_at=$1,repository_revision=repository_revision+1 WHERE user_id=ANY($2::uuid[]) AND status='ACTIVE'",
        [Date.now(), createdUsers],
      );
    await Promise.allSettled(all.map((p) => p.end()));
  }
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Barrier verification failed');
  process.exitCode = 1;
});
