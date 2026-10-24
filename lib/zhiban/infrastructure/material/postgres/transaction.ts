import { createHash } from 'node:crypto';
import { v7 } from 'uuid';
import type { PoolClient } from 'pg';
import type { MaterialTransaction, PreparedMaterial } from '../../../application/material/service';
import type { MaterialCommand } from '../../../domain/material/model';
import { requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
export class MaterialPgTransaction implements MaterialTransaction {
  constructor(private readonly client: PoolClient) {}
  async access(a: AcademicActor, o: string, write = false) {
    const result = await new LearningPgTransaction(this.client).access(
      a,
      o,
      write ? 'TEACHER' : undefined,
    );
    if (write) requireAcademic(result.offering.status === 'OPEN', 'INVALID_STATE');
  }
  async list(a: AcademicActor, o: string) {
    const { mode, offering } = await new LearningPgTransaction(this.client).access(a, o);
    const teacher = mode === 'TEACHER';
    const rows = (
      await this.client.query(
        `SELECT r.id,r.revision::text,r.publication_no AS "publicationNo",r.archived,r.source_revision::text AS "sourceRevision",r.published_revision::text AS "publishedRevision",r.created_by=$3 AS "owned",v.title,v.name,v.mime,octet_length(v.bytes) AS size,v.digest,v.parser
   FROM zhiban_material.resources r JOIN zhiban_material.versions v ON v.tenant_id=r.tenant_id AND v.resource_id=r.id AND v.source_revision=CASE WHEN $4 AND r.created_by=$3 THEN r.source_revision ELSE r.published_revision END
   WHERE r.tenant_id=$1 AND r.offering_id=$2 AND (($4 AND r.created_by=$3) OR (NOT r.archived AND r.publication_no>0)) ORDER BY r.id LIMIT 101`,
        [a.tenantId, o, a.membershipId, teacher],
      )
    ).rows;
    requireAcademic(rows.length <= 100, 'UNAVAILABLE');
    return {
      mode,
      canUpload: teacher && offering.status === 'OPEN',
      rows: rows.map((r) => ({
        ...r,
        revision: teacher && r.owned ? r.revision : null,
        sourceRevision: teacher && r.owned ? r.sourceRevision : null,
        status: r.archived ? 'ARCHIVED' : r.publicationNo > 0 ? 'PUBLISHED' : 'DRAFT',
      })),
    };
  }
  async read(
    a: AcademicActor,
    o: string,
    id: string,
    draft: boolean,
    version: string | null,
    bytes: boolean,
  ) {
    const { mode } = await new LearningPgTransaction(this.client).access(a, o);
    const r = (
      await this.client.query(
        'SELECT * FROM zhiban_material.resources WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR SHARE',
        [a.tenantId, o, id],
      )
    ).rows[0];
    requireAcademic(!!r, 'NOT_FOUND');
    if (draft) requireAcademic(mode === 'TEACHER' && r.created_by === a.membershipId, 'FORBIDDEN');
    else requireAcademic(!r.archived && r.publication_no > 0, 'NOT_FOUND');
    const pub = draft
      ? null
      : (
          await this.client.query(
            'SELECT publication_no,source_revision FROM zhiban_material.publications WHERE tenant_id=$1 AND resource_id=$2 AND publication_no=$3',
            [a.tenantId, id, version ?? r.publication_no],
          )
        ).rows[0];
    requireAcademic(draft || !!pub, 'NOT_FOUND');
    const v = (
      await this.client.query(
        `SELECT title,name,mime,digest,extracted_text AS text,parser,octet_length(bytes) AS size${bytes ? ',bytes' : ''} FROM zhiban_material.versions WHERE tenant_id=$1 AND resource_id=$2 AND source_revision=$3`,
        [a.tenantId, id, draft ? r.source_revision : pub.source_revision],
      )
    ).rows[0];
    requireAcademic(!!v, 'NOT_FOUND');
    return {
      ...v,
      id,
      publicationNo: pub?.publication_no ?? null,
      sourceRevision: draft ? String(r.source_revision) : undefined,
    };
  }
  async replay(a: AcademicActor, o: string, c: MaterialCommand, key: string) {
    await this.access(a, o, true);
    const digest = createHash('sha256')
      .update(JSON.stringify({ offering: o, command: c }))
      .digest('hex');
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `material-command:${a.tenantId}:${key}`,
    ]);
    const prior = (
      await this.client.query(
        'SELECT actor_id,payload_digest,result FROM zhiban_material.commands WHERE tenant_id=$1 AND command_key=$2',
        [a.tenantId, key],
      )
    ).rows[0];
    if (prior) {
      requireAcademic(
        prior.actor_id === a.membershipId && prior.payload_digest === digest,
        'CONFLICT',
      );
      return prior.result;
    }
    return null;
  }
  async execute(
    a: AcademicActor,
    o: string,
    c: MaterialCommand,
    key: string,
    p: PreparedMaterial | null,
  ) {
    await this.access(a, o, true);
    const digest = createHash('sha256')
      .update(JSON.stringify({ offering: o, command: c }))
      .digest('hex');
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `material-command:${a.tenantId}:${key}`,
    ]);
    const prior = (
      await this.client.query(
        'SELECT actor_id,payload_digest,result FROM zhiban_material.commands WHERE tenant_id=$1 AND command_key=$2',
        [a.tenantId, key],
      )
    ).rows[0];
    if (prior) {
      requireAcademic(
        prior.actor_id === a.membershipId && prior.payload_digest === digest,
        'CONFLICT',
      );
      return prior.result;
    }
    // Serializes per-offering quota decisions; no other offering is blocked.
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `material-quota:${a.tenantId}:${o}`,
    ]);
    const id = c.id ?? v7();
    let r = (
      await this.client.query(
        'SELECT * FROM zhiban_material.resources WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR UPDATE',
        [a.tenantId, o, id],
      )
    ).rows[0];
    requireAcademic(c.id === null ? !r : !!r, c.id === null ? 'CONFLICT' : 'NOT_FOUND');
    if (r) {
      requireAcademic(r.created_by === a.membershipId, 'FORBIDDEN');
      requireAcademic(!r.archived && String(r.revision) === c.revision, 'CONFLICT');
    }
    if (c.type === 'UPLOAD_MATERIAL') {
      requireAcademic(!!p, 'UNAVAILABLE');
      const usage = (
        await this.client.query(
          'SELECT count(DISTINCT r.id)::int AS count,coalesce(sum(octet_length(v.bytes)),0)::bigint AS bytes FROM zhiban_material.resources r JOIN zhiban_material.versions v ON v.tenant_id=r.tenant_id AND v.resource_id=r.id WHERE r.tenant_id=$1 AND r.offering_id=$2',
          [a.tenantId, o],
        )
      ).rows[0];
      requireAcademic(
        (!!r || usage.count < 100) &&
          Number(usage.bytes) + Buffer.from(c.file.base64, 'base64').length <= 33554432 &&
          (!r || Number(r.source_revision) < 20),
        'INVALID_STATE',
      );
      const revision = r ? Number(r.source_revision) + 1 : 1;
      if (!r)
        await this.client.query(
          'INSERT INTO zhiban_material.resources(tenant_id,id,offering_id,created_by,source_revision) VALUES($1,$2,$3,$4,$5)',
          [a.tenantId, id, o, a.membershipId, revision],
        );
      await this.client.query(
        'INSERT INTO zhiban_material.versions VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          a.tenantId,
          id,
          revision,
          c.title,
          c.file.name,
          c.file.mime,
          Buffer.from(c.file.base64, 'base64'),
          p!.digest,
          p!.text,
          p!.parser,
          p!.scannerReference,
          a.now,
        ],
      );
      if (r)
        await this.client.query(
          'UPDATE zhiban_material.resources SET source_revision=$3,revision=revision+1 WHERE tenant_id=$1 AND id=$2',
          [a.tenantId, id, revision],
        );
    } else if (c.type === 'PUBLISH_MATERIAL') {
      requireAcademic(r.published_revision !== r.source_revision, 'INVALID_STATE');
      await this.client.query(
        'INSERT INTO zhiban_material.publications VALUES($1,$2,$3,$4,$5,$6)',
        [a.tenantId, id, r.publication_no + 1, r.source_revision, a.membershipId, a.now],
      );
      await this.client.query(
        'UPDATE zhiban_material.resources SET published_revision=source_revision,publication_no=publication_no+1,revision=revision+1 WHERE tenant_id=$1 AND id=$2',
        [a.tenantId, id],
      );
    } else
      await this.client.query(
        'UPDATE zhiban_material.resources SET archived=true,revision=revision+1 WHERE tenant_id=$1 AND id=$2',
        [a.tenantId, id],
      );
    r = (
      await this.client.query(
        'SELECT revision::text,publication_no AS "publicationNo" FROM zhiban_material.resources WHERE tenant_id=$1 AND id=$2',
        [a.tenantId, id],
      )
    ).rows[0];
    const result = { id, ...r };
    await this.client.query(
      'INSERT INTO zhiban_material.commands VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [a.tenantId, key, a.membershipId, o, id, digest, c.type, JSON.stringify(result), a.now],
    );
    return result;
  }
}
