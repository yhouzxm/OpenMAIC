import { readFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import type { Pool } from 'pg';
import { applySchemaMigrations } from '@openmaic/storage/pg-migrations';
import { hash, requireContent } from '../content/model';
import type { ContentContext } from '../content/service';
import type { ClassroomAiService } from '../classroom-ai/service';
import { LIVE_TTL_MS, liveCommand } from './model';
export async function initializeClassroomLive(pool: Pool) {
  const sql = await readFile('lib/zhiban/infrastructure/classroom-live/schema.sql', 'utf8');
  await applySchemaMigrations(pool, {
    store: 'zhiban-classroom-live',
    migrations: [{ version: 1, name: 'public-presentation-and-course-video', up: sql }],
  });
  const tables = ['zhiban_live_classroom', 'zhiban_live_events', 'zhiban_course_video_jobs'];
  const r = await pool.query(
    `SELECT relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned,
    NOT relrowsecurity AS plain, NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(relacl,acldefault('r',relowner))) a WHERE a.grantee<>relowner) AS closed
    FROM pg_class WHERE oid=ANY($1::regclass[])`,
    [tables],
  );
  requireContent(
    r.rowCount === 3 && r.rows.every((x) => x.owned && x.plain && x.closed),
    'LIVE_SCHEMA_REJECTED',
    503,
  );
  const f = (
    await pool.query(`SELECT p.prosrc,NOT p.prosecdef AS invoker,p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned,
    NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner) AS closed,
    (SELECT count(*)::int FROM pg_trigger WHERE tgrelid='zhiban_live_events'::regclass AND tgfoid=p.oid AND tgtype=27 AND tgenabled='O') AS triggers
    FROM pg_proc p WHERE oid='zhiban_live_audit_immutable()'::regprocedure`)
  ).rows[0];
  requireContent(
    f?.owned &&
      f.closed &&
      f.invoker &&
      f.triggers === 1 &&
      f.prosrc.trim() === sql.match(/AS \$\$([\s\S]*?)\$\$/)![1].trim(),
    'LIVE_SCHEMA_REJECTED',
    503,
  );
}
export class ClassroomLiveService {
  constructor(
    readonly classroom: ClassroomAiService,
    readonly pool: Pool,
  ) {}
  async read(x: ContentContext, resource: string, publication: string) {
    return this.classroom.guard(x, resource, publication, async () => {
      const r = (
        await this.pool.query(
          `SELECT revision::text,actor_id,controller_id,enabled,state,updated_at,
        enabled AND updated_at>clock_timestamp()-interval '15 seconds' AS active FROM zhiban_live_classroom
        WHERE tenant_id=$1 AND offering_id=$2 AND resource_id=$3 AND publication_id=$4`,
          [x.tenant, x.offering, resource, publication],
        )
      ).rows[0];
      return r
        ? {
            revision: r.revision,
            actor: r.actor_id,
            controller: r.controller_id,
            active: r.active,
            state: r.active ? r.state : null,
            updatedAt: r.updated_at,
            ttlMs: LIVE_TTL_MS,
          }
        : { revision: '0', active: false, state: null, controller: null, ttlMs: LIVE_TTL_MS };
    });
  }
  async write(x: ContentContext, resource: string, publication: string, input: unknown) {
    const parsed = liveCommand.safeParse(input);
    requireContent(parsed.success);
    const v = parsed.data;
    const snapshot = await this.classroom.snapshots.published(x, resource, publication);
    const scene = snapshot.document.scenes.find((s) => s.id === v.state.sceneId);
    requireContent(scene && v.state.actionIndex <= Math.max(0, (scene.actions?.length ?? 0) - 1));
    // Current teacher/assignment + publication + policy locks remain held through the short commit.
    return this.classroom.content.authoring(x, () =>
      this.classroom.guard(x, resource, publication, async () => {
        const c = await this.pool.connect();
        try {
          await c.query('BEGIN');
          await c.query("SET LOCAL lock_timeout='2500ms'");
          const keys = [x.tenant, x.offering, resource, publication];
          await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['live:' + keys.join(':')]);
          const old = (
            await c.query(
              'SELECT revision,actor_id,controller_id,enabled FROM zhiban_live_classroom WHERE tenant_id=$1 AND offering_id=$2 AND resource_id=$3 AND publication_id=$4 FOR UPDATE',
              keys,
            )
          ).rows[0];
          requireContent(String(old?.revision ?? 0) === v.revision, 'CONFLICT', 409);
          if (v.kind === 'UPDATE')
            requireContent(
              old?.enabled && old.actor_id === x.member && old.controller_id === v.controller,
              'CONTROLLER_CHANGED',
              409,
            );
          const revision = String(BigInt(v.revision) + BigInt(1)),
            enabled = v.kind !== 'STOP';
          const state = enabled ? v.state : { ...v.state, mode: 'paused', board: '', summary: '' };
          await c.query(
            `INSERT INTO zhiban_live_classroom VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
          ON CONFLICT(tenant_id,offering_id,resource_id,publication_id) DO UPDATE SET revision=excluded.revision,actor_id=excluded.actor_id,controller_id=excluded.controller_id,enabled=excluded.enabled,state=excluded.state,updated_at=excluded.updated_at`,
            [...keys, revision, x.member, v.controller, enabled, state],
          );
          await c.query(
            'INSERT INTO zhiban_live_events(id,tenant_id,offering_id,resource_id,publication_id,revision,actor_id,kind,state_digest)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [v7(), ...keys, revision, x.member, v.kind, hash(JSON.stringify(state))],
          );
          await c.query('COMMIT');
          return {
            revision,
            active: enabled,
            controller: v.controller,
            state: enabled ? state : null,
          };
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        } finally {
          c.release();
        }
      }),
    );
  }
}
