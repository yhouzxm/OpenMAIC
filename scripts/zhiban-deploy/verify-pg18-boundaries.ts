/** Real PG18 negative checks; all faults roll back before normal host readiness. */
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { pg18Reference } from '../zhiban-local/pg-version';
import {
  validateContentDatabaseState,
  validateContentDatabaseStatePg18,
} from '../zhiban-local/content-receipt';
import { businessPg18Catalog } from './pg18-catalog';
import { createBridgeComposition } from '../../lib/zhiban/infrastructure/openmaic/root';
import { createBridgeCompositionPg18 } from '../../lib/zhiban/infrastructure/openmaic/root-pg18';
import type { createIdentityComposition } from '../../lib/zhiban/infrastructure/identity/composition/root';
export async function verifyPg18Boundaries(input: {
  admin: Pool;
  bridge: Pool;
  native: Pool;
  composition: Awaited<ReturnType<typeof createIdentityComposition>>;
  receipt: Parameters<typeof validateContentDatabaseStatePg18>[2];
  record: (s: string) => void;
}) {
  const { admin, bridge, native, composition, receipt, record } = input,
    r = await pg18Reference();
  await assert.rejects(
    validateContentDatabaseState(bridge, native, receipt),
    /Bridge endpoint rejected/,
  );
  await assert.rejects(
    validateContentDatabaseStatePg18(bridge, native, { ...receipt, profile: '0'.repeat(64) }),
    /expected profile mismatch/,
  );
  await admin.query('GRANT MAINTAIN ON zhiban_academic.courses TO zhiban_academic_runtime');
  const c = await admin.connect();
  try {
    await assert.rejects(businessPg18Catalog(c), /MAINTAIN/);
  } finally {
    c.release();
    await admin.query('REVOKE MAINTAIN ON zhiban_academic.courses FROM zhiban_academic_runtime');
  }
  const manifest = {
    approvalRef: 'PG18_LOCAL_CLOSED_BRIDGE_ACCEPTANCE',
    identityDatabase: receipt.database,
    nativeDatabase: receipt.nativeDatabase,
    bridgeFingerprint: r.businessCatalog.catalogs.zhiban_bridge,
    nativeFingerprint: r.nativeFingerprint,
    deploymentId: receipt.deploymentId,
    ...r.provider,
  };
  await assert.rejects(createBridgeComposition(composition, { bridge, native }, manifest));
  const closed = await createBridgeCompositionPg18(
    composition,
    { bridge, native },
    { ...manifest, postgresMajor: 18, profileVersion: 'PG18_V1' },
  );
  assert.deepEqual(await closed.application.execute('PREPARE_CONTENT', undefined as never, {}), {
    status: 'DENIED',
  });
  await assert.rejects(
    createBridgeCompositionPg18(composition, { bridge, native }, {
      ...manifest,
      postgresMajor: 16,
      profileVersion: 'PG18_V1',
    } as never),
  );
  await validateContentDatabaseStatePg18(bridge, native, receipt);
  record(
    'PG18 reference/version substitution and runtime MAINTAIN reject; frozen version-16 root rejects PG18; versioned closed root preserves Native DENIED',
  );
}
