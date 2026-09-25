import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminClient,
  configured,
  provisionRolePasswords,
  resetDisposableIdentity,
  runBootstrap,
  runtimeClient,
  verifyPg16,
} from './pg16-harness';

const safeAttrs = 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT';
const roleNames = [
  'zhiban_identity_owner',
  'zhiban_migrator',
  'zhiban_runtime',
  'zhiban_auth_runtime',
  'zhiban_control_runtime',
];

async function adminSql(sql: string): Promise<void> {
  const client = adminClient();
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function roles(): Promise<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]> {
  const client = adminClient();
  await client.connect();
  try {
    const result = await client.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>('SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname', [roleNames]);
    return result.rows;
  } finally {
    await client.end();
  }
}

describe.skipIf(!configured).sequential('real PostgreSQL 16 role bootstrap R01–R10', () => {
  beforeAll(async () => {
    expect(await verifyPg16()).toMatch(/^16\./);
  });
  beforeEach(resetDisposableIdentity);
  afterAll(resetDisposableIdentity);

  it('R01: creates exactly five safe roles from an empty disposable cluster', async () => {
    expect(runBootstrap().success).toBe(true);
    const found = await roles();
    expect(found.map((role) => role.rolname)).toEqual([...roleNames].sort());
    expect(found.every((role) => !role.rolsuper && !role.rolbypassrls)).toBe(true);
  });

  it('R02: accepts safe pre-existing roles without changing security attributes', async () => {
    for (const role of roleNames) {
      await adminSql(`CREATE ROLE ${role} ${role === 'zhiban_identity_owner' ? 'NOLOGIN' : 'LOGIN'} ${safeAttrs}`);
    }
    await adminSql(
      'GRANT zhiban_identity_owner TO zhiban_migrator WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
    );
    const before = await roles();
    expect(runBootstrap().success).toBe(true);
    expect(await roles()).toEqual(before);
  });

  it('R03: rejects a pre-existing SUPERUSER runtime without repairing it', async () => {
    await adminSql('CREATE ROLE zhiban_runtime LOGIN SUPERUSER NOINHERIT');
    const result = runBootstrap();
    expect(result.success).toBe(false);
    expect(result.output).toContain('Unsafe existing Identity role attributes');
    expect((await roles()).find((role) => role.rolname === 'zhiban_runtime')?.rolsuper).toBe(true);
  });

  it('R04: rejects a pre-existing BYPASSRLS runtime', async () => {
    await adminSql('CREATE ROLE zhiban_runtime LOGIN BYPASSRLS NOINHERIT');
    expect(runBootstrap().success).toBe(false);
    expect((await roles()).find((role) => role.rolname === 'zhiban_runtime')?.rolbypassrls).toBe(true);
  });

  it('R05: rejects a direct runtime-to-owner role grant', async () => {
    await adminSql(`CREATE ROLE zhiban_identity_owner NOLOGIN ${safeAttrs}`);
    await adminSql(`CREATE ROLE zhiban_runtime LOGIN ${safeAttrs}`);
    await adminSql('GRANT zhiban_identity_owner TO zhiban_runtime WITH SET TRUE');
    expect(runBootstrap().success).toBe(false);
  });

  it('R06: rejects runtime → intermediate → migrator → owner', async () => {
    await adminSql(`CREATE ROLE zhiban_identity_owner NOLOGIN ${safeAttrs}`);
    await adminSql(`CREATE ROLE zhiban_migrator LOGIN ${safeAttrs}`);
    await adminSql(`CREATE ROLE zhiban_runtime LOGIN ${safeAttrs}`);
    await adminSql(`CREATE ROLE zhiban_pg16_intermediate NOLOGIN ${safeAttrs}`);
    await adminSql('GRANT zhiban_identity_owner TO zhiban_migrator WITH SET TRUE');
    await adminSql('GRANT zhiban_migrator TO zhiban_pg16_intermediate WITH SET TRUE');
    await adminSql('GRANT zhiban_pg16_intermediate TO zhiban_runtime WITH SET TRUE');
    expect(runBootstrap().success).toBe(false);
  });

  it('R07: rejects auth-runtime membership in control-runtime', async () => {
    await adminSql(`CREATE ROLE zhiban_auth_runtime LOGIN ${safeAttrs}`);
    await adminSql(`CREATE ROLE zhiban_control_runtime LOGIN ${safeAttrs}`);
    await adminSql('GRANT zhiban_control_runtime TO zhiban_auth_runtime WITH SET TRUE');
    expect(runBootstrap().success).toBe(false);
  });

  it('R08: rolls back owner and migrator created before finding an unsafe runtime', async () => {
    await adminSql('CREATE ROLE zhiban_runtime LOGIN SUPERUSER NOINHERIT');
    expect(runBootstrap().success).toBe(false);
    expect((await roles()).map((role) => role.rolname)).toEqual(['zhiban_runtime']);
    const client = adminClient();
    await client.connect();
    try {
      const schema = await client.query("SELECT to_regnamespace('zhiban_identity') AS identity_schema");
      expect(schema.rows[0].identity_schema).toBeNull();
    } finally {
      await client.end();
    }
  });

  it('R09: a successful rerun neither drifts roles nor duplicates owner membership', async () => {
    expect(runBootstrap().success).toBe(true);
    const before = await roles();
    expect(runBootstrap().success).toBe(true);
    expect(await roles()).toEqual(before);
    const client = adminClient();
    await client.connect();
    try {
      const edge = await client.query(
        "SELECT count(*)::int AS count FROM pg_auth_members WHERE member = 'zhiban_migrator'::regrole AND roleid = 'zhiban_identity_owner'::regrole",
      );
      expect(edge.rows[0].count).toBe(1);
    } finally {
      await client.end();
    }
  });

  it('R10: migrator can SET ROLE owner while all actual runtime logins cannot elevate', async () => {
    expect(runBootstrap().success).toBe(true);
    await provisionRolePasswords();
    const migrator = runtimeClient('zhiban_migrator');
    await migrator.connect();
    try {
      await migrator.query('SET ROLE zhiban_identity_owner');
      const identity = await migrator.query('SELECT current_user, session_user');
      expect(identity.rows[0]).toMatchObject({
        current_user: 'zhiban_identity_owner',
        session_user: 'zhiban_migrator',
      });
      await migrator.query('RESET ROLE');
    } finally {
      await migrator.end();
    }
    for (const runtime of [
      'zhiban_runtime',
      'zhiban_auth_runtime',
      'zhiban_control_runtime',
    ] as const) {
      const client = runtimeClient(runtime);
      await client.connect();
      try {
        const identity = await client.query('SELECT current_user, session_user');
        expect(identity.rows[0]).toMatchObject({ current_user: runtime, session_user: runtime });
        for (const target of roleNames.filter((role) => role !== runtime)) {
          await expect(client.query(`SET ROLE ${target}`)).rejects.toMatchObject({ code: '42501' });
        }
      } finally {
        await client.end();
      }
    }
  });
});
