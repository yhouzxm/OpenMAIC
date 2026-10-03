import { Pool } from 'pg';
import { createIdentityComposition, type IdentityCompositionConfig } from '../composition/root';
import {
  createIdentityHttp,
  type HttpFacade,
  type HttpPolicy,
  type OperationalRecord,
} from './adapter';
import { IdentitySafeQueries } from '@/lib/zhiban/application/identity/use-cases/safe-queries';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { failure, requestId } from './protocol';
import { actions } from './dto';

/** Nonsecret deployment description; real DSNs/keys/corpus live in an approved server store. */
export interface IdentityHttpManifest {
  readonly approvalRef: string;
  readonly networkApprovalRef: string;
  readonly migrationPreflightRef: string;
  readonly operationalAcceptanceRef: string;
  readonly backendPrivate: true;
  readonly fixedOverwritingProxy: true;
  readonly endpoint: {
    readonly hostname: string;
    readonly port: number;
    readonly database: string;
  };
  readonly runtimeSecrets: Readonly<Record<'auth' | 'tenant' | 'control', string>>;
  readonly poolMax: number;
  readonly connectionTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly policy: HttpPolicy;
}
export interface ApprovedIdentityHttpLoader {
  load(): Promise<{
    readonly manifest: IdentityHttpManifest;
    readonly composition: IdentityCompositionConfig;
  }>;
  secret(reference: string): Promise<string>;
  record(record: OperationalRecord): void;
}
interface ProcessState {
  promise: Promise<HttpFacade> | null;
  sealed: boolean;
}
const key = Symbol.for('zhiban.identity.http.process-facade.v1');
const processGlobal = globalThis as typeof globalThis & { [key]?: ProcessState };
const state = (processGlobal[key] ??= { promise: null, sealed: false });
const unavailable = () => {
  throw new IdentityPortError('UNAVAILABLE');
};
const ref = (s: unknown) => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(s)) unavailable();
};
function validate(m: IdentityHttpManifest, c: IdentityCompositionConfig) {
  if (
    typeof window !== 'undefined' ||
    !m ||
    m.backendPrivate !== true ||
    m.fixedOverwritingProxy !== true ||
    c.deployment !== 'SINGLE_PROCESS_HTTPS' ||
    m.policy.origin !== c.origin ||
    Object.keys(m.runtimeSecrets).sort().join(',') !== 'auth,control,tenant'
  )
    unavailable();
  for (const value of [
    m.approvalRef,
    m.networkApprovalRef,
    m.migrationPreflightRef,
    m.operationalAcceptanceRef,
    ...Object.values(m.runtimeSecrets),
  ])
    ref(value);
  if (
    !m.endpoint.hostname ||
    !m.endpoint.database ||
    !Number.isInteger(m.endpoint.port) ||
    m.endpoint.port < 1 ||
    m.endpoint.port > 65535
  )
    unavailable();
  for (const n of [
    m.poolMax,
    m.connectionTimeoutMs,
    m.statementTimeoutMs,
    m.policy.concurrentRequests,
    m.policy.bodyTimeoutMs,
    m.policy.retryAfterSeconds,
  ])
    if (!Number.isSafeInteger(n) || n < 1 || n > 1000000) unavailable();
}
/** Called only by approved server bootstrap. No env/NEXT_PUBLIC/test fallback enables routes. */
export function installApprovedIdentityHttp(loader: ApprovedIdentityHttpLoader) {
  if (state.sealed || state.promise !== null) unavailable();
  state.sealed = true;
  state.promise = (async () => {
    const { manifest, composition: c } = await loader.load();
    const m = Object.freeze({
      ...manifest,
      endpoint: Object.freeze({ ...manifest.endpoint }),
      runtimeSecrets: Object.freeze({ ...manifest.runtimeSecrets }),
      policy: Object.freeze({ ...manifest.policy }),
    });
    validate(m, c);
    const pools: Partial<Record<'auth' | 'tenant' | 'control', Pool>> = {};
    try {
      for (const role of ['auth', 'tenant', 'control'] as const) {
        const dsn = await loader.secret(m.runtimeSecrets[role]),
          url = new URL(dsn);
        if (
          !['postgres:', 'postgresql:'].includes(url.protocol) ||
          url.hostname !== m.endpoint.hostname ||
          Number(url.port || 5432) !== m.endpoint.port ||
          decodeURIComponent(url.pathname.slice(1)) !== m.endpoint.database ||
          url.search
        )
          unavailable();
        if (
          decodeURIComponent(url.username) !==
          {
            auth: 'zhiban_auth_runtime',
            tenant: 'zhiban_runtime',
            control: 'zhiban_control_runtime',
          }[role]
        )
          unavailable();
        pools[role] = new Pool({
          connectionString: dsn,
          max: m.poolMax,
          connectionTimeoutMillis: m.connectionTimeoutMs,
          statement_timeout: m.statementTimeoutMs,
          idle_in_transaction_session_timeout: m.statementTimeoutMs,
        });
      }
      const root = await createIdentityComposition(
        pools as Record<'auth' | 'tenant' | 'control', Pool>,
        c,
      );
      const queries =
        root.queries ??
        new IdentitySafeQueries({
          passwordState: (h) => root.security.passwordState(h),
          member: async () => unavailable(),
          consentContext: async () => unavailable(),
        });
      // Close over root in ONE facade. No private handles/operator/control cross module bundles.
      return createIdentityHttp(
        async () => ({
          security: root.security,
          application: root.application,
          members: root.members,
          queries,
        }),
        m.policy,
        (r) => loader.record(r),
      );
    } catch {
      await Promise.all(Object.values(pools).map((p) => p.end().catch(() => {})));
      return unavailable();
    }
  })();
  void state.promise.catch(() => {});
}
export async function identityHttp(request: Request) {
  const path = new URL(request.url).pathname,
    id = requestId();
  const own = /^\/api\/zhiban\/identity\/(login|logout|logout-all|me|csrf|spaces|password)$/.exec(
    path,
  );
  const scoped =
    /^\/api\/zhiban\/identity\/tenants\/[^/]+\/(consent-context|invitations|consents|admin-transfer|memberships\/[^/]+(?:\/([^/]+))?)$/.exec(
      path,
    );
  if ((!own && !scoped) || (scoped?.[2] && !Object.hasOwn(actions, scoped[2])))
    return failure(id, 404, 'NOT_FOUND');
  const methods = own
    ? own[1] === 'password'
      ? ['GET', 'POST']
      : ['me', 'csrf', 'spaces'].includes(own[1])
        ? ['GET']
        : ['POST']
    : scoped![1] === 'consent-context' || (scoped![1].startsWith('memberships/') && !scoped![2])
      ? ['GET']
      : ['POST'];
  if (!methods.includes(request.method))
    return failure(id, 405, 'METHOD_NOT_ALLOWED', { Allow: methods.join(', ') });
  // First use seals default CLOSED. Later unapproved browser input cannot initialize it.
  state.sealed = true;
  if (state.promise === null) return failure(id, 503, 'SERVICE_UNAVAILABLE');
  try {
    return await (await state.promise).handle(request);
  } catch {
    return failure(id, 503, 'SERVICE_UNAVAILABLE');
  }
}
