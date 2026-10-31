/** Private installation command over the frozen bootstrap + FIRST_PASSWORD contracts. */
import type { createIdentityComposition } from '../identity/composition/root';
export async function installFirstPlatformAdmin(
  identity: Awaited<ReturnType<typeof createIdentityComposition>>,
  approvalReference: string,
  password: string,
) {
  if (!identity.operator) throw Error('Approved platform authority required');
  // Frozen bootstrap is serialized, command-bound and independently audited.
  const created = await identity.operator.bootstrap(approvalReference);
  await identity.operator.provision(approvalReference, password);
  return Object.freeze({ userId: created.userId, grantId: created.grantId });
}
