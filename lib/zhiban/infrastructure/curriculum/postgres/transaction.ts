import { progressBarrier, progressSnapshot } from './progress';
import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { v7 } from 'uuid';
import { requireAcademic, type AcademicActor } from '@/lib/zhiban/domain/academic/model';
import {
  curriculumCommand,
  type CurriculumChapter,
  type CurriculumCommand,
} from '@/lib/zhiban/domain/curriculum/model';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
export class CurriculumPgTransaction {
  constructor(private readonly client: PoolClient) {}
  async read(actor: AcademicActor, offering: string) {
    await progressBarrier(this.client, actor, offering);
    const { mode } = await new LearningPgTransaction(this.client).access(actor, offering);
    const row = (
      await this.client.query(
        'SELECT revision::text,publication_no,draft,published FROM zhiban_curriculum.outlines WHERE tenant_id=$1 AND offering_id=$2',
        [actor.tenantId, offering],
      )
    ).rows[0];
    const activities = (await new LearningPgTransaction(this.client).read(actor, offering))
      .activities;
    const chapters: CurriculumChapter[] = row
      ? row[mode === 'TEACHER' ? 'draft' : 'published']
      : [];
    return {
      mode,
      revision: mode === 'TEACHER' ? (row?.revision ?? '1') : null,
      publicationNo: row?.publication_no ?? 0,
      chapters,
      progress: mode === 'STUDENT' ? await progressSnapshot(this.client, actor, offering) : null,
      activities: activities.map((a) => ({
        id: a.id,
        title: a.title,
        status: a.status,
        publishedVersion: a.published_version,
      })),
      published: mode === 'TEACHER' ? (row?.published ?? []) : undefined,
    };
  }
  async execute(
    actor: AcademicActor,
    offering: string,
    command: CurriculumCommand,
    key: string,
    lectureIds: Set<string>,
  ) {
    await progressBarrier(this.client, actor, offering);
    const { offering: o } = await new LearningPgTransaction(this.client).access(
      actor,
      offering,
      'TEACHER',
    );
    requireAcademic(o.status === 'OPEN', 'INVALID_STATE');
    const digest = createHash('sha256').update(JSON.stringify({ offering, command })).digest('hex');
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `academic-command:${actor.tenantId}:${key}`,
    ]);
    const old = (
      await this.client.query(
        'SELECT c.actor_id,c.payload_digest,a.facts FROM zhiban_academic.commands c JOIN zhiban_academic.audit_events a ON a.tenant_id=c.tenant_id AND a.command_key=c.command_key WHERE c.tenant_id=$1 AND c.command_key=$2',
        [actor.tenantId, key],
      )
    ).rows[0];
    if (old) {
      requireAcademic(
        old.actor_id === actor.membershipId && old.payload_digest === digest,
        'CONFLICT',
      );
      return old.facts.result;
    }
    await this.client.query(
      'INSERT INTO zhiban_curriculum.outlines(tenant_id,offering_id,updated_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [actor.tenantId, offering, actor.now],
    );
    const row = (
      await this.client.query(
        'SELECT revision::text,draft FROM zhiban_curriculum.outlines WHERE tenant_id=$1 AND offering_id=$2 FOR UPDATE',
        [actor.tenantId, offering],
      )
    ).rows[0];
    requireAcademic(row.revision === command.revision, 'CONFLICT');
    const chapters: CurriculumChapter[] =
      command.type === 'SAVE_OUTLINE' ? command.chapters : row.draft;
    curriculumCommand({ type: 'SAVE_OUTLINE', revision: command.revision, chapters });
    if (command.type === 'PUBLISH_OUTLINE') {
      for (const unit of chapters.flatMap((c) => c.units).filter((u) => u.progress)) {
        const a = (
          await this.client.query(
            `SELECT a.status,a.published_version,q.mode FROM zhiban_learning.activities a LEFT JOIN zhiban_learning.quiz_definitions q ON q.tenant_id=a.tenant_id AND q.activity_id=a.id WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.id=$3`,
            [actor.tenantId, offering, unit.target],
          )
        ).rows[0];
        requireAcademic(
          !!a &&
            a.status === 'PUBLISHED' &&
            Number(a.published_version) === unit.progress!.version &&
            a.mode !== 'PRACTICE',
          'INVALID_STATE',
        );
      }
    }
    for (const chapter of chapters)
      for (const unit of chapter.units) {
        if (unit.kind === 'LECTURE') requireAcademic(lectureIds.has(unit.target), 'INVALID_STATE');
        else if (unit.kind === 'MATERIAL') {
          const material = (
            await this.client.query(
              'SELECT created_by,published_revision,archived FROM zhiban_material.resources WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR SHARE',
              [actor.tenantId, offering, unit.target],
            )
          ).rows[0];
          requireAcademic(
            !!material &&
              !material.archived &&
              (command.type === 'PUBLISH_OUTLINE'
                ? material.published_revision !== null
                : material.created_by === actor.membershipId ||
                  material.published_revision !== null),
            'INVALID_STATE',
          );
        } else {
          const a = (
            await this.client.query(
              'SELECT status FROM zhiban_learning.activities WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR SHARE',
              [actor.tenantId, offering, unit.target],
            )
          ).rows[0];
          requireAcademic(
            !!a && (command.type !== 'PUBLISH_OUTLINE' || a.status === 'PUBLISHED'),
            'INVALID_STATE',
          );
        }
      }
    const result = (
      await this.client.query(
        command.type === 'SAVE_OUTLINE'
          ? 'UPDATE zhiban_curriculum.outlines SET draft=$4,revision=revision+1,updated_at=$3 WHERE tenant_id=$1 AND offering_id=$2 RETURNING revision::text,publication_no AS "publicationNo"'
          : 'UPDATE zhiban_curriculum.outlines SET published=draft,publication_no=publication_no+1,revision=revision+1,updated_at=$3 WHERE tenant_id=$1 AND offering_id=$2 RETURNING revision::text,publication_no AS "publicationNo"',
        command.type === 'SAVE_OUTLINE'
          ? [actor.tenantId, offering, actor.now, JSON.stringify(chapters)]
          : [actor.tenantId, offering, actor.now],
      )
    ).rows[0];
    await this.client.query('INSERT INTO zhiban_academic.commands VALUES($1,$2,$3,$4,$5)', [
      actor.tenantId,
      key,
      actor.membershipId,
      digest,
      actor.now,
    ]);
    await this.client.query(
      'INSERT INTO zhiban_academic.audit_events(tenant_id,id,actor_id,command_key,event_type,occurred_at,facts) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        actor.tenantId,
        v7(),
        actor.membershipId,
        key,
        `CURRICULUM_${command.type}`,
        actor.now,
        JSON.stringify({
          offeringId: offering,
          result,
          ...(command.type === 'PUBLISH_OUTLINE' ? { publishedChapters: chapters } : {}),
        }),
      ],
    );
    return result;
  }
}
