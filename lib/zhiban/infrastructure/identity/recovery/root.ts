import { createHash } from 'node:crypto';
import { createServer, type ServerOptions } from 'node:https';
import { RecoveryEvidence, type TrustedRecoveryKey } from './evidence';
import type { RecoveryEvidenceStore } from '@/lib/zhiban/application/identity/ports/manual-recovery';
import type { PasswordScreeningPort } from '@/lib/zhiban/application/identity/ports/password-screening';
import type { TransactionPool } from '../postgres/transactions';
import { PostgresCredentialRepository } from '../postgres/repositories/credential';
import { Argon2PasswordHasher } from '../credentials/argon2-password-hasher';
import { RecoverySecurity } from './security';
import { RecoveryRegistry } from './registry';
import { ManualRecovery } from './composition';
import { PrivateRecoveryTransport, type RecoveryTransportConfig } from './private-transport';
import { policy, policyDigest, type RecoveryPolicy } from './policy';
import { must, safeError, time } from './values';
export function transportDigest(config: RecoveryTransportConfig) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'manual-recovery-transport-v1',
        config.origin,
        config.environment,
        config.proxyCertificate,
        config.deploymentApprovalRef,
        [...config.terminals]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((t) => [t.id, t.site, t.lane, t.certificate, t.pairedTerminal]),
      ]),
    )
    .digest('hex');
}
export interface ApprovedRecoveryDependencies {
  readonly authPool: TransactionPool;
  readonly evidenceStore: RecoveryEvidenceStore;
  readonly keys: readonly TrustedRecoveryKey[];
  readonly screening: PasswordScreeningPort;
  readonly policy: RecoveryPolicy;
  readonly transport: RecoveryTransportConfig;
  readonly approvalReference: string;
  readonly admissionKey: Uint8Array;
}
let configured: Promise<PrivateRecoveryTransport> | undefined;
/** Explicit private service composition. No routes, environment-default store or enabled seed. */
export async function buildPrivateRecovery(deps: ApprovedRecoveryDependencies) {
  try {
    const p = policy(deps.policy),
      evidence = new RecoveryEvidence(deps.evidenceStore, p.environment_ref, deps.keys);
    const approval = await evidence.load(deps.approvalReference, 'POLICY');
    must(
      approval.fields.policy_digest === policyDigest(p) &&
        approval.fields.approval_ref === p.approval_ref &&
        approval.fields.transport_digest === transportDigest(deps.transport) &&
        deps.transport.deploymentApprovalRef === p.approval_ref,
    );
    must(deps.screening !== undefined);
    const hashing = new Argon2PasswordHasher(deps.screening),
      credentials = new PostgresCredentialRepository(deps.authPool);
    const registry = new RecoveryRegistry(
        p.max_submissions,
        p.ceremony_ttl_ms,
        p.submission_ttl_ms,
      ),
      security = new RecoverySecurity(deps.authPool, credentials, hashing, p.max_submissions),
      service = new ManualRecovery(
        deps.authPool,
        evidence,
        hashing,
        security,
        registry,
        p,
        deps.admissionKey,
      );
    return new PrivateRecoveryTransport(service, deps.transport, () => {
      must(Date.now() >= time(approval.fields.issued_at) && Date.now() < approval.deadline);
      evidence.keyDeadline(approval.keyRef);
    });
  } catch (e) {
    throw safeError(e);
  }
}
export function configurePrivateRecovery(deps: ApprovedRecoveryDependencies) {
  must(configured === undefined);
  return (configured = buildPrivateRecovery(deps));
}
/** Separate backend listener, never auto-started or mounted by the public Next root.
 * The approved proxy must strip/replace terminal assertions and deny the public prefix.
 */
export function privateRecoveryServer(
  transport: PrivateRecoveryTransport,
  tls: Pick<ServerOptions, 'key' | 'cert' | 'ca'>,
) {
  must(tls.key !== undefined && tls.cert !== undefined && tls.ca !== undefined);
  const server = createServer(
    {
      ...tls,
      minVersion: 'TLSv1.2',
      requestCert: true,
      rejectUnauthorized: true,
      maxHeaderSize: 8192,
    },
    (req, res) => {
      void transport.handle(req, res);
    },
  );
  server.headersTimeout = 10000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 32;
  server.on('clientError', (_error, socket) => {
    socket.destroy();
  });
  return server;
}
