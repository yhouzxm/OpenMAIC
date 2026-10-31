import { verifyInstalledSchema } from '@/lib/persistence/installed-schema';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { v7 } from 'uuid';
import { slideMediaReferenceSlots } from '@/lib/media/slide-media-slots';
import { isSlideContent } from '@openmaic/dsl';
import { BUILT_IN_AGENTS } from '@/lib/orchestration/registry/built-in';
import { getActionsForRole } from '@/lib/orchestration/registry/types';
import type { AppDocumentOutline } from '@/lib/document-store/persistence-types';
import { AuthoringSnapshots } from '../authoring/snapshot';
import type { ContentService, ContentContext } from '../content/service';
import { hash, requireContent } from '../content/model';
import type { ClassroomBinding } from './bindings';
import { initializePublishedPbl } from './pbl';

export async function initializeClassroomAi(pool: Pool) {
  process.env.OPENMAIC_ENABLE_PI_NATIVE_CHILD_RUNTIME = 'true';
  process.env.OPENMAIC_ENABLE_PI_NATIVE_CHILD_SPOTLIGHT = 'true';
  process.env.NEXT_PUBLIC_COURSEWARE_REFERENCE_ENABLED = 'true';
  if (await verifyInstalledSchema(pool)) {
    await initializePublishedPbl(pool);
    return;
  }
  const sql = await readFile('lib/zhiban/infrastructure/classroom-ai/schema.sql', 'utf8');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(hashtext('zhiban-classroom-ai-schema'))");
    const exists = (
      await c.query(
        "SELECT to_regclass('public.zhiban_classroom_ai_schema_receipt') AS receipt,to_regclass('public.zhiban_classroom_ai_policy') AS policy,to_regclass('public.zhiban_classroom_ai_policy_events') AS events",
      )
    ).rows[0];
    if (!exists.receipt) {
      requireContent(!exists.policy && !exists.events, 'CLASSROOM_SCHEMA_REJECTED', 503);
      await c.query(sql);
      await c.query('INSERT INTO zhiban_classroom_ai_schema_receipt VALUES(true,$1)', [hash(sql)]);
    } else
      requireContent(
        (await c.query('SELECT digest FROM zhiban_classroom_ai_schema_receipt WHERE id=true'))
          .rows[0]?.digest === hash(sql),
        'CLASSROOM_SCHEMA_REJECTED',
        503,
      );
    const columns: Record<string, string[]> = {
      zhiban_classroom_ai_policy: [
        'tenant_id:uuid',
        'offering_id:uuid',
        'resource_id:uuid',
        'publication_id:uuid',
        'enabled:boolean',
        'revision:bigint',
        'updated_by:uuid',
        'updated_at:timestamp with time zone',
      ],
      zhiban_classroom_ai_policy_events: [
        'id:uuid',
        'tenant_id:uuid',
        'offering_id:uuid',
        'resource_id:uuid',
        'publication_id:uuid',
        'actor_id:uuid',
        'enabled:boolean',
        'revision:bigint',
        'created_at:timestamp with time zone',
      ],
      zhiban_classroom_ai_schema_receipt: ['id:boolean', 'digest:text'],
    };
    for (const [table, expected] of Object.entries(columns)) {
      const actual = (
        await c.query(
          'SELECT attname,format_type(atttypid,atttypmod) AS type,attnotnull FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum',
          ['public.' + table],
        )
      ).rows;
      const acl = (
        await c.query(
          "SELECT relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned,NOT relrowsecurity AS plain,NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(relacl,acldefault('r',relowner))) a WHERE a.grantee<>relowner) AS closed FROM pg_class WHERE oid=$1::regclass",
          ['public.' + table],
        )
      ).rows[0];
      requireContent(
        actual.every((a) => a.attnotnull) &&
          JSON.stringify(actual.map((a) => a.attname + ':' + a.type)) ===
            JSON.stringify(expected) &&
          acl?.owned &&
          acl.plain &&
          acl.closed,
        'CLASSROOM_SCHEMA_REJECTED',
        503,
      );
    }
    const guard = (
      await c.query(
        "SELECT p.prosrc,p.prosecdef,p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned,NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner) AS closed,(SELECT count(*) FROM pg_trigger t WHERE t.tgrelid='public.zhiban_classroom_ai_policy_events'::regclass AND t.tgfoid=p.oid AND t.tgtype=27 AND t.tgenabled='O')::integer AS triggers FROM pg_proc p WHERE p.oid='public.zhiban_classroom_ai_audit_immutable()'::regprocedure",
      )
    ).rows[0];
    requireContent(
      guard?.owned &&
        guard.closed &&
        !guard.prosecdef &&
        guard.triggers === 1 &&
        guard.prosrc.trim() === sql.match(/AS \$\$([\s\S]*?)\$\$/)![1].trim(),
      'CLASSROOM_SCHEMA_REJECTED',
      503,
    );
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await initializePublishedPbl(pool);
}

export class ClassroomAiService {
  readonly snapshots: AuthoringSnapshots;
  constructor(
    readonly content: ContentService,
    readonly pool: Pool,
  ) {
    this.snapshots = new AuthoringSnapshots(pool, content);
  }
  private keys(x: ContentContext, resource: string, publication: string) {
    return [x.tenant, x.offering, resource, publication];
  }
  async policy(x: ContentContext, resource: string, publication: string) {
    const r = (
      await this.pool.query(
        'SELECT enabled,revision FROM zhiban_classroom_ai_policy WHERE tenant_id=$1 AND offering_id=$2 AND resource_id=$3 AND publication_id=$4',
        this.keys(x, resource, publication),
      )
    ).rows[0];
    return { enabled: r?.enabled === true, revision: String(r?.revision ?? 0) };
  }
  async changePolicy(
    x: ContentContext,
    resource: string,
    publication: string,
    enabled: boolean,
    revision: string,
  ) {
    await this.snapshots.published(x, resource, publication);
    return this.content.authoring(x, () =>
      this.content.withPublishedAccess(x, resource, publication, async () => {
        const c = await this.pool.connect();
        try {
          await c.query('BEGIN');
          await c.query("SET LOCAL lock_timeout='2500ms'");
          await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            this.keys(x, resource, publication).join(':'),
          ]);
          const old = (
            await c.query(
              'SELECT revision FROM zhiban_classroom_ai_policy WHERE tenant_id=$1 AND offering_id=$2 AND resource_id=$3 AND publication_id=$4 FOR UPDATE',
              this.keys(x, resource, publication),
            )
          ).rows[0];
          requireContent(String(old?.revision ?? 0) === revision, 'CONFLICT', 409);
          const next = String(BigInt(revision) + BigInt(1));
          await c.query(
            'INSERT INTO zhiban_classroom_ai_policy VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT(tenant_id,offering_id,resource_id,publication_id) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at',
            [...this.keys(x, resource, publication), enabled, next, x.member],
          );
          await c.query(
            'INSERT INTO zhiban_classroom_ai_policy_events(id,tenant_id,offering_id,resource_id,publication_id,actor_id,enabled,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [v7(), ...this.keys(x, resource, publication), x.member, enabled, next],
          );
          await c.query('COMMIT');
          return { enabled, revision: next };
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        } finally {
          c.release();
        }
      }),
    );
  }
  async guard<T>(
    x: ContentContext,
    resource: string,
    publication: string,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.content.withPublishedAccess(x, resource, publication, async () => {
      const c = await this.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query("SET LOCAL lock_timeout='2500ms'");
        const row = (
          await c.query(
            'SELECT enabled FROM zhiban_classroom_ai_policy WHERE tenant_id=$1 AND offering_id=$2 AND resource_id=$3 AND publication_id=$4 FOR SHARE',
            this.keys(x, resource, publication),
          )
        ).rows[0];
        requireContent(row?.enabled === true, 'CLASSROOM_DISABLED', 403);
        const result = await work();
        await c.query('COMMIT');
        return result;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    });
  }
  async context(x: ContentContext, resource: string, publication: string) {
    const snapshot = await this.snapshots.published(x, resource, publication);
    const scope = hash([...this.keys(x, resource, publication), x.member].join(':'));
    const owner = 'course-learner-' + scope,
      stage = 'zhiban-class-' + scope.slice(0, 48);
    const doc = structuredClone(snapshot.document);
    doc.stage.id = stage;
    const configs = doc.stage.generatedAgentConfigs;
    const assetBase = `/api/zhiban/authoring/${x.tenant}/offerings/${x.offering}/published/${resource}/asset?publication=${publication}&ref=`;
    const refs = new Map(
      snapshot.assets.map((a) => [a.ref, assetBase + encodeURIComponent(a.ref)]),
    );
    const rewrite = (slide: Parameters<typeof slideMediaReferenceSlots>[0]) => {
      for (const slot of slideMediaReferenceSlots(slide)) {
        const ref = slot.read();
        if (ref && refs.has(ref)) slot.write(refs.get(ref));
      }
    };
    for (const b of doc.stage.whiteboard ?? []) rewrite(b);
    for (const scene of doc.scenes) {
      scene.stageId = stage;
      if (isSlideContent(scene.content)) rewrite(scene.content.canvas);
      for (const b of scene.whiteboards ?? []) rewrite(b);
    }
    const outline: AppDocumentOutline = {
      outlines: doc.scenes.map((s) => ({
        id: s.outlineId ?? s.id,
        order: s.order,
        type: s.type,
        title: s.title,
        description: s.title,
        keyPoints: [],
      })),
      generationComplete: true,
      createdAt: 0,
      updatedAt: 0,
    };
    doc.outline = outline;
    const agents = [
      ...Object.values(BUILT_IN_AGENTS),
      ...(configs ?? []).map((a) => ({ ...a, allowedActions: getActionsForRole(a.role) })),
    ].map((a) => ({
      ...a,
      boundStageId: stage,
    }));
    const binding: ClassroomBinding = {
      tenant: x.tenant,
      owner,
      stage,
      guard: (work) => this.guard({ ...x, deadline: undefined }, resource, publication, work),
    };
    return { snapshot, doc, agents, binding, outline };
  }
}
