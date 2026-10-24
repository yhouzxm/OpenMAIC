import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import {
  directory,
  database,
  pgPort,
  digest,
  privateFile,
  loadRuntime,
  requirePrivateClusterDirectories,
} from './config';
import { academicPolicy } from '@/lib/zhiban/domain/academic/model';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import { PostgresIdentityRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/user';
import { PostgresMembershipRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/membership';
import { PostgresCredentialRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import { Argon2PasswordHasher } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { LocalCompromisedPasswordScreening } from '@/lib/zhiban/infrastructure/identity/credentials/password-screening';
import {
  Membership,
  RoleGrant,
  User,
  instant,
  tenantId,
  userId,
  tenantScope,
  selfScope,
  type RoleCode,
} from '@/lib/zhiban/domain/identity';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';

async function main() {
  const runtime = await loadRuntime();
  await requirePrivateClusterDirectories();
  const accountsFile = JSON.parse((await privateFile('accounts.json')).toString());
  const admin = new Pool({
    host: join(directory, 'socket'),
    port: pgPort,
    database,
    user: 'postgres',
    max: 1,
  });
  const pools: Pool[] = [];
  try {
    const endpoint = (
      await admin.query(
        "SELECT current_setting('data_directory') AS directory,current_setting('server_version_num')::integer AS version",
      )
    ).rows[0];
    if (
      endpoint.directory !== join(directory, 'pgdata') ||
      endpoint.version < 160000 ||
      endpoint.version > 169999
    )
      throw new Error('Owned PG16 cluster required.');
    const existing =
      (await admin.query("SELECT to_regnamespace('zhiban_academic') AS schema")).rows[0].schema !==
      null;
    if (accountsFile.accounts.length !== 2) throw new Error('Refuse account reseed.');
    try {
      await privateFile('academic.json');
      throw new Error('M2 already prepared; refuse reset or reseed.');
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
    }
    const rolePassword = randomBytes(32).toString('base64url');
    const bridgePassword = randomBytes(32).toString('base64url');
    await admin.query(
      `${existing ? 'ALTER' : 'CREATE'} ROLE zhiban_academic_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD '${rolePassword}'`,
    );
    await admin.query(`ALTER ROLE zhiban_bridge_runtime PASSWORD '${bridgePassword}'`);
    await admin.query(`GRANT CONNECT ON DATABASE ${database} TO zhiban_academic_runtime`);
    await admin.query(
      `ALTER ROLE zhiban_academic_runtime IN DATABASE ${database} SET search_path=pg_catalog,zhiban_academic,pg_temp`,
    );
    const migration = await readFile(
      resolve('lib/zhiban/infrastructure/academic/postgres/migrations/0001_academic.sql'),
      'utf8',
    );
    if (existing) {
      const ledger = (
        await admin.query('SELECT version,checksum FROM zhiban_academic.schema_migrations')
      ).rows;
      if (
        ledger.length !== 1 ||
        ledger[0].version !== '0001' ||
        ledger[0].checksum !== digest(migration)
      )
        throw new Error('Cannot resume unknown academic schema.');
      if (
        Number(
          (await admin.query('SELECT count(*) AS count FROM zhiban_academic.people')).rows[0].count,
        ) !== 0
      )
        throw new Error('Cannot resume partially seeded accounts.');
    } else {
      await admin.query('BEGIN');
      await admin.query('SET LOCAL ROLE zhiban_identity_owner');
      await admin.query(migration);
      await admin.query(
        'INSERT INTO zhiban_academic.schema_migrations(version,checksum) VALUES($1,$2)',
        ['0001', digest(migration)],
      );
      await admin.query('COMMIT');
    }
    const control = new Pool({ connectionString: runtime.secrets.LOCAL_M1_CONTROL, max: 1 });
    const tenant = new Pool({ connectionString: runtime.secrets.LOCAL_M1_TENANT, max: 1 });
    const auth = new Pool({ connectionString: runtime.secrets.LOCAL_M1_AUTH, max: 1 });
    pools.push(control, tenant, auth);
    const ids = new IdentityIds(),
      users = new PostgresIdentityRepository(control),
      members = new PostgresMembershipRepository(tenant),
      credentials = new PostgresCredentialRepository(auth),
      hashing = new Argon2PasswordHasher(
        new LocalCompromisedPasswordScreening(runtime.composition.corpus.values),
      );
    const primary = tenantId(accountsFile.spaces[0].tenantId),
      other = tenantId(accountsFile.spaces[1].tenantId);
    const grant = (code: RoleCode, now: ReturnType<typeof instant>) =>
      RoleGrant.create({
        id: ids.nextRoleGrantId(),
        roleCode: code,
        scope: code === 'STUDENT' ? selfScope() : tenantScope(),
        createdAt: now,
        validFrom: now,
        validUntil: null,
      });
    const firstRows = (
      await admin.query(
        'SELECT membership_id FROM zhiban_identity.memberships WHERE tenant_id=$1 AND user_id=$2',
        [primary, accountsFile.accounts[0].userId],
      )
    ).rows;
    const first = await members.findById(tenantScopeContext(primary), firstRows[0].membership_id);
    if (!first) throw new Error('M1 member missing.');
    const authorizationTime = instant(Date.now());
    await members.save(
      tenantScopeContext(primary),
      first.value.grantRole({
        expectedAuthorizationVersion: first.value.authorizationVersion,
        now: authorizationTime,
        approvedGrant: grant('TENANT_ADMIN', authorizationTime),
      }),
      first.revision,
    );
    const profile = async (tenantValue: string, member: string, label: string) =>
      admin.query(
        'INSERT INTO zhiban_academic.people(tenant_id,membership_id,display_name) VALUES($1,$2,$3)',
        [tenantValue, member, label],
      );
    await profile(primary, first.value.id, '本地教务管理员');
    accountsFile.accounts[0].label = '本地教务管理员';
    accountsFile.accounts[0].membershipId = first.value.id;
    accountsFile.accounts[0].tenantId = primary;
    for (const [label, role, tenantValue] of [
      ['任教教师', 'TEACHER', primary],
      ['学生甲', 'STUDENT', primary],
      ['学生乙', 'STUDENT', primary],
      ['非任教教师', 'TEACHER', primary],
      ['其他空间管理员', 'TENANT_ADMIN', other],
    ] as const) {
      const id = ids.nextUserId(),
        password = randomBytes(24).toString('base64url');
      await users.create(User.create(id, instant(Date.now())));
      await credentials.createPassword(
        id,
        ids.nextCredentialId(),
        await hashing.hash(password),
        instant(Date.now()),
        {
          actor: { kind: 'SERVICE', serviceCode: 'local_m2_seed' },
          requestId: 'LOCAL_M2_SEED',
          reason: 'SYSTEM_MAINTENANCE',
        },
      );
      const memberTime = instant(Date.now());
      const member = Membership.create({
        id: ids.nextMembershipId(),
        userId: userId(id),
        tenantId: tenantValue,
        now: memberTime,
      }).activatePending({
        expectedAuthorizationVersion: 0,
        now: memberTime,
        approvedGrants: [grant(role, memberTime)],
      });
      await members.create(tenantScopeContext(tenantValue), member);
      await profile(tenantValue, member.id, label);
      accountsFile.accounts.push({
        label,
        userId: id,
        password,
        membershipId: member.id,
        tenantId: tenantValue,
      });
    }
    await writeFile(
      join(directory, 'accounts-before-m2.json'),
      await privateFile('accounts.json'),
      { mode: 0o600, flag: 'wx' },
    );
    await writeFile(
      join(directory, 'accounts.json'),
      JSON.stringify(accountsFile, null, 2) + '\n',
      { mode: 0o600 },
    );
    const config = {
      mode: 'LOCAL_SYNTHETIC_M2',
      endpoint: { hostname: '127.0.0.1', port: pgPort, database },
      academic: `postgresql://zhiban_academic_runtime:${rolePassword}@127.0.0.1:${pgPort}/${database}`,
      bridge: `postgresql://zhiban_bridge_runtime:${bridgePassword}@127.0.0.1:${pgPort}/${database}`,
      migrationHash: digest(migration),
      policyHash: digest(JSON.stringify(academicPolicy)),
    };
    const raw = JSON.stringify(config, null, 2) + '\n';
    await writeFile(join(directory, 'academic.json'), raw, { mode: 0o600, flag: 'wx' });
    await writeFile(
      join(directory, 'academic-receipt.json'),
      JSON.stringify(
        {
          mode: 'LOCAL_SYNTHETIC_M2',
          configHash: digest(raw),
          migrationHash: config.migrationHash,
          policyHash: config.policyHash,
          scope: 'LOCAL synthetic academic schema/accounts only; no FIRST or production signoff',
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    console.log(
      'LOCAL M2 prepared: independent academic schema/runtime; accounts.json updated. No courses or enrollments fabricated.',
    );
  } finally {
    await Promise.all(pools.map((pool) => pool.end()));
    await admin.end();
  }
}
void main().catch((error) => {
  console.error(
    error instanceof Error ? `M2 maintenance stopped: ${error.message}` : 'M2 maintenance stopped.',
  );
  process.exitCode = 1;
});
