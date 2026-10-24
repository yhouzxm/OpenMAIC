import { createHash } from 'node:crypto';
import { v7 } from 'uuid';
import type { PoolClient } from 'pg';
import type { SubmissionFileAssetPort } from '../../../application/learning/attachment-assets';
import { requireAcademic } from '../../../domain/academic/model';
import { writableAttempt } from '../../../domain/learning/model';
export class PostgresSubmissionFileAssets implements SubmissionFileAssetPort {
  constructor(private readonly client: PoolClient) {}
  async read(tenant: string, submission: string, file?: string) {
    return (
      await this.client.query(
        `SELECT id,name,mime,digest,size,created_at,clearance_status,clearance_ref${file ? ',bytes' : ''} FROM zhiban_learning_files.files WHERE tenant_id=$1 AND submission_id=$2 ${file ? 'AND id=$3' : ''} ORDER BY id LIMIT 1`,
        file ? [tenant, submission, file] : [tenant, submission],
      )
    ).rows as Record<string, unknown>[];
  }
  async append(
    scope: Parameters<SubmissionFileAssetPort['append']>[0],
    file: Parameters<SubmissionFileAssetPort['append']>[1],
    clearance?: Parameters<SubmissionFileAssetPort['append']>[2],
  ) {
    const { tenant, offering, member, attempt, submission, now } = scope;
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `submission-files:${tenant}:${offering}:${member}`,
    ]);
    const [{ file_now }] = (
      await this.client.query(
        'SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS file_now',
      )
    ).rows;
    writableAttempt(scope.status, scope.allowResubmit, scope.deadline, Number(file_now));
    const bytes = Buffer.from(file.base64, 'base64');
    const digest = createHash('sha256').update(bytes).digest('hex');
    requireAcademic(!!clearance && clearance.digest === digest, 'ATTACHMENT_NOT_CLEARED');
    const [usage] = (
      await this.client.query(
        `SELECT coalesce(sum(f.size),0)::text AS total,coalesce(sum(f.size) FILTER(WHERE f.attempt_id=$4),0)::text AS attempt,count(*)::int AS files,count(*) FILTER(WHERE f.attempt_id=$4)::int AS attempt_files
    FROM zhiban_learning_files.files f JOIN zhiban_learning.attempts t ON t.tenant_id=f.tenant_id AND t.id=f.attempt_id WHERE f.tenant_id=$1 AND t.offering_id=$2 AND t.membership_id=$3`,
        [tenant, offering, member, attempt],
      )
    ).rows;
    requireAcademic(
      Number(usage.total) + bytes.length <= 104857600 &&
        Number(usage.attempt) + bytes.length <= 10485760 &&
        Number(usage.files) < 1000 &&
        Number(usage.attempt_files) < 100,
      'ATTACHMENT_LIMIT',
    );
    await this.client.query(
      'INSERT INTO zhiban_learning_files.files(tenant_id,id,submission_id,attempt_id,name,mime,digest,size,bytes,created_at,clearance_status,clearance_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        tenant,
        v7(),
        submission,
        attempt,
        file.name,
        file.mime,
        createHash('sha256').update(bytes).digest('hex'),
        bytes.length,
        bytes,
        now,
        clearance!.mode,
        clearance!.reference,
      ],
    );
  }
}
