import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool, ZhibanQueryable } from '@/lib/zhiban/db/types';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';

async function auditDeletion(
  client: ZhibanQueryable,
  principal: AuthorizedPrincipal,
  batchId: string,
  batchType: string,
  status: string,
) {
  return client.query(
    `INSERT INTO zhiban.audit_log
        (tenant_id,actor_type,actor_account_id,action,resource_type,resource_id,metadata)
       VALUES($1,'account',$2,'import.batch.deleted','import_batch',$3,$4::jsonb)`,
    [
      principal.tenantId,
      principal.id,
      batchId,
      JSON.stringify({ batchType, status, businessDataRetained: status === 'completed' }),
    ],
  );
}

export async function deleteIdentityImportBatch(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  batchId: string,
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const batch = (
      await client.query<{ status: string }>(
        `SELECT status FROM zhiban.identity_import_batches
         WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [batchId, principal.tenantId],
      )
    ).rows[0];
    if (!batch) throw new Error('导入批次不存在');
    if (batch.status === 'running') throw new Error('正在执行的批次不能删除');
    await client.query(`DELETE FROM zhiban.identity_import_batches WHERE id=$1 AND tenant_id=$2`, [
      batchId,
      principal.tenantId,
    ]);
    await auditDeletion(client, principal, batchId, 'identity', batch.status);
    return { batchId, deleted: true, businessDataRetained: batch.status === 'completed' };
  });
}

export async function deleteAcademicImportBatch(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  batchId: string,
  importType: 'administrative_class' | 'course_registration',
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const batch = (
      await client.query<{ status: string }>(
        `SELECT status FROM zhiban.academic_import_batches
         WHERE id=$1 AND tenant_id=$2 AND import_type=$3 FOR UPDATE`,
        [batchId, principal.tenantId, importType],
      )
    ).rows[0];
    if (!batch) throw new Error('导入批次不存在');
    if (batch.status === 'running') throw new Error('正在执行的批次不能删除');
    await client.query(`DELETE FROM zhiban.academic_import_batches WHERE id=$1 AND tenant_id=$2`, [
      batchId,
      principal.tenantId,
    ]);
    await auditDeletion(client, principal, batchId, importType, batch.status);
    return { batchId, deleted: true, businessDataRetained: batch.status === 'completed' };
  });
}
