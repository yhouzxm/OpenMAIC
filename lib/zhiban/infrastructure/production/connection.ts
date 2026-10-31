import { Pool, type PoolConfig } from 'pg';
import { parseEnv } from 'node:util';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { privateBytes, check } from './files';
export type ConnectionInput = {
  host: string;
  port: number;
  database: string;
  role: string;
  credentialFile: string;
  caFile?: string;
  transport?: 'plain' | 'verify-full';
};
export async function connection(input: ConnectionInput): Promise<PoolConfig> {
  const { DATABASE_URL } = parseEnv((await privateBytes(input.credentialFile)).toString());
  check(typeof DATABASE_URL === 'string' && DATABASE_URL.length > 0, 'DATABASE_URL required');
  const u = new URL(DATABASE_URL);
  check(
    ['postgres:', 'postgresql:'].includes(u.protocol) && !u.search && !u.hash,
    'Plain PostgreSQL URL required',
  );
  check(
    u.hostname === input.host &&
      Number(u.port || 5432) === input.port &&
      decodeURIComponent(u.username) === input.role &&
      decodeURIComponent(u.pathname.slice(1)) === input.database &&
      u.password,
    'Deployment database endpoint mismatch',
  );
  check(
    input.transport === undefined ||
      input.transport === 'plain' ||
      input.transport === 'verify-full',
    'DATABASE_TRANSPORT_REJECTED',
  );
  check(input.transport !== 'plain' || !input.caFile, 'PLAIN_CONNECTION_CA_REJECTED');
  check(input.transport === 'plain' || input.caFile, 'DATABASE_CA_REQUIRED');
  const ca =
    input.transport === 'plain' ? undefined : (await privateBytes(input.caFile!)).toString();
  return {
    host: input.host,
    port: input.port,
    database: input.database,
    user: input.role,
    password: decodeURIComponent(u.password),
    ssl:
      input.transport === 'plain'
        ? false
        : {
            ca,
            rejectUnauthorized: true,
            ...(!isIP(input.host) ? { servername: input.host } : {}),
            checkServerIdentity: (_host, cert) => checkServerIdentity(input.host, cert),
          },
    max: 3,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 15000,
    options: '-c search_path=public,pg_catalog',
  };
}
export async function connectedPool(input: ConnectionInput) {
  const p = new Pool(await connection(input));
  p.on('error', () => console.warn('PG_IDLE_CONNECTION_UNAVAILABLE'));
  return p;
}
/** SDK lazy pools receive the same CA/hostname enforcement through an explicit factory. */
export function boundedFactory(expected: PoolConfig, url: string) {
  return (candidate: string) => {
    check(candidate === url, 'Authoring connection substitution rejected');
    const p = new Pool({ ...expected, max: 3 });
    p.on('error', () => console.warn('PG_IDLE_CONNECTION_UNAVAILABLE'));
    return p;
  };
}
