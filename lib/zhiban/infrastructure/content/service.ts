import {
  interactivePolicy,
  interactiveDraft,
  newInteractiveDraft,
  interactiveDocument,
  checkInteractiveDocument,
  type InteractiveDraft,
} from './interactive';
import { bridgeTransaction, Deadline } from '../openmaic/transactions';
import { v7 } from 'uuid';
import type { Pool, PoolClient } from 'pg';
import type { IdentityAuthentication } from '../identity/composition/authentication';
import { membershipId, tenantId } from '@/lib/zhiban/domain/identity';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { academicTeacher, academicStudent } from '@/lib/zhiban/domain/academic/model';
import { BridgeRepository, type Actor } from '../openmaic/repository';
import { planCandidate } from '../openmaic/candidate';
import { TextNative } from './native';
import { NativeStorage } from '../openmaic/native-storage';
import { type AssetExpectations } from '../openmaic/content';
import { admittedOperation } from '../openmaic/transactions';
import { gatewayHeaders, singleRange } from '../openmaic/gateway';
import { validatePng, pngPolicy, validatePngDocument } from './png';
import {
  hash,
  canonical,
  draft,
  emptyDraft,
  document,
  command,
  requireContent,
  ContentError,
} from './model';
export type ContentContext = {
  handle: any;
  tenant: string;
  member: string;
  offering: string;
  deadline?: Deadline;
  studentRead?: boolean;
};
class StudentReadFallback extends ContentError {
  constructor() {
    super('FORBIDDEN', 403);
  }
}
export class ContentService {
  private native: TextNative;
  private pngNative: NativeStorage;
  constructor(
    private pool: Pool,
    native: Pool,
    private security: IdentityAuthentication,
    private deployment: string,
    private observe: (record: Record<string, unknown>) => void = () => {},
    readonly pngEnabled = false,
    readonly interactiveEnabled = false,
    readonly attemptRuntimeEnabled = false,
    readonly jointClassroomEnabled = false,
  ) {
    this.native = new TextNative(native);
    this.pngNative = new NativeStorage(native);
  }
  private async authorize(
    c: PoolClient,
    x: ContentContext,
    resource: string | null,
    action: string,
  ) {
    const locator = resource
      ? (
          await c.query(
            'SELECT created_by FROM zhiban_content.resources WHERE tenant_id=$1 AND id=$2 AND offering_id=$3',
            [x.tenant, resource, x.offering],
          )
        ).rows[0]
      : null;
    requireContent(!resource || locator, 'FORBIDDEN', 403);
    const owner = locator?.created_by ?? x.member;
    const facts = await this.security
      .bridgeSecurity()
      .assertCurrent(
        c,
        x.handle,
        tenantScopeContext(tenantId(x.tenant)),
        membershipId(x.member),
        owner === x.member ? [] : [membershipId(owner)],
      );
    requireContent(
      facts.members.every((m) => m.userStatus === 'ACTIVE' && m.membershipStatus === 'ACTIVE'),
      'FORBIDDEN',
      403,
    );
    const actorFacts = facts.members.find((m) => m.membershipId === x.member)!;
    const actor: any = {
      tenantId: x.tenant,
      membershipId: x.member,
      now: facts.evaluatedAt,
      grants: actorFacts.grants,
    };
    const student =
      action === 'READ' &&
      (x.studentRead || !actor.grants.some((g: any) => g.roleCode === 'TEACHER'));
    requireContent(!student || (resource && academicStudent(actor)), 'FORBIDDEN', 403);
    const purpose = student
      ? 'STUDENT_READ'
      : action === 'READ'
        ? 'TEACHER_READ'
        : action === 'WITHDRAW_CONTENT'
          ? 'TEACHER_WITHDRAW'
          : 'TEACHER_WRITE';
    let business: any;
    try {
      business = (
        await c.query('SELECT * FROM zhiban_content.lock_business_context($1,$2,$3,$4,$5)', [
          x.tenant,
          resource,
          x.offering,
          x.member,
          purpose,
        ])
      ).rows[0];
      requireContent(
        business &&
          (student
            ? academicStudent(actor)
            : academicTeacher(actor, business.course_id, x.offering)),
        'FORBIDDEN',
        403,
      );
    } catch (error) {
      // Retry only a denied teacher READ as an eligible student. The outer
      // transaction rolls back first; the new transaction reasserts all guards.
      if (
        action === 'READ' &&
        resource &&
        !student &&
        academicStudent(actor) &&
        ((error as any)?.code === '42501' ||
          (error instanceof ContentError && error.status === 403))
      )
        throw new StudentReadFallback();
      throw error;
    }
    return {
      teacher: !student,
      actor: {
        user: actorFacts.userId,
        member: x.member,
        authorizationVersion: facts.authorizationVersion,
        requestId: 'content_' + v7(),
      } as Actor,
    };
  }
  private async tx<T>(
    x: ContentContext,
    resource: string | null,
    action: string,
    body: (
      c: PoolClient,
      repo: BridgeRepository,
      auth: any,
      final: () => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    const deadline = x.deadline ?? new Deadline();
    let original: any;
    try {
      return await bridgeTransaction(
        this.pool,
        tenantScopeContext(tenantId(x.tenant)),
        deadline,
        async (client) => {
          const c = client as unknown as PoolClient;
          try {
            const auth = await this.authorize(c, x, resource, action);
            const final = async () => {
              const current = await this.authorize(c, x, resource, action);
              requireContent(
                current.actor.authorizationVersion === auth.actor.authorizationVersion,
                'FORBIDDEN',
                403,
              );
            };
            const result = await body(c, new BridgeRepository(c, x.tenant), auth, final);
            await final();
            return result;
          } catch (e) {
            original = e;
            throw e;
          }
        },
      );
    } catch (error) {
      const e = original ?? error;
      if (e instanceof StudentReadFallback && !x.studentRead)
        return this.tx({ ...x, deadline, studentRead: true }, resource, action, body);
      this.observe({
        phase: action,
        code: e.code ?? e.name,
        table: e.table ?? null,
        constraint: e.constraint ?? null,
      });
      if (e instanceof ContentError) throw e;
      if (e.code === '42501' || e.name === 'BridgeError') throw new ContentError('FORBIDDEN', 403);
      if (['23514', '23505', '55P03', '40001', '40P01'].includes(e.code))
        throw new ContentError('CONFLICT', 409);
      throw new ContentError('UNAVAILABLE', 503);
    }
  }

  private async row(c: PoolClient, x: ContentContext, resource: string, lock = false) {
    const r = (
      await c.query(
        `SELECT * FROM zhiban_content.resources WHERE tenant_id=$1 AND id=$2 AND offering_id=$3${lock ? ' FOR UPDATE' : ''}`,
        [x.tenant, resource, x.offering],
      )
    ).rows[0];
    requireContent(r, 'FORBIDDEN', 403);
    return r;
  }
  private async audit(
    c: PoolClient,
    x: ContentContext,
    resource: string,
    operation: string,
    event: string,
    before: string | null,
    after: string,
    t: number,
  ) {
    await c.query('INSERT INTO zhiban_content.audit_events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
      x.tenant,
      v7(),
      resource,
      operation,
      x.member,
      event,
      before,
      after,
      t,
    ]);
  }
  private async op(
    c: PoolClient,
    x: ContentContext,
    r: any,
    type: string,
    key: string,
    intent: string,
    t: number,
    result: string | null,
    expected: string | null = null,
    bridge: string | null = null,
  ) {
    const oid = v7();
    await c.query(
      `INSERT INTO zhiban_content.operations(tenant_id,id,resource_id,actor_id,action,key_digest,intent_digest,state,source_revision,source_digest,expected_native_digest,bridge_operation_id,result_revision,created_at,completed_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,zhiban_content.draft_digest($10),$11,$12,$13,$14,$15)`,
      [
        x.tenant,
        oid,
        r.id,
        x.member,
        type,
        hash(key),
        intent,
        type === 'PUBLISH_CONTENT' ? 'RESERVED' : 'SUCCEEDED',
        r.revision,
        r.draft,
        expected,
        bridge,
        result,
        t,
        type === 'PUBLISH_CONTENT' ? null : t,
      ],
    );
    return oid;
  }
  async list(x: ContentContext) {
    const c = await this.pool.connect();
    let rows: any[];
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.tenant_id',$1,true)", [x.tenant]);
      await this.security
        .bridgeSecurity()
        .assertCurrent(
          c,
          x.handle,
          tenantScopeContext(tenantId(x.tenant)),
          membershipId(x.member),
          [],
        );
      rows = (
        await c.query(
          'SELECT id FROM zhiban_content.resources WHERE tenant_id=$1 AND offering_id=$2 ORDER BY created_at,id LIMIT 101',
          [x.tenant, x.offering],
        )
      ).rows;
      await c.query('COMMIT');
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
    requireContent(rows.length <= 100, 'UNAVAILABLE', 503);
    const resources: any[] = [];
    let canEdit = false;
    for (const row of rows) {
      try {
        const value = await this.tx(x, row.id, 'READ', async (c, _repo, auth) => {
          const r = await this.row(c, x, row.id);
          const runtimeHistory =
            this.attemptRuntimeEnabled &&
            r.policy_version === interactivePolicy &&
            !!(
              await c.query(
                'SELECT 1 FROM zhiban_content.attempt_runtime_bindings WHERE tenant_id=$1 AND resource_id=$2 AND ($3::uuid IS NULL OR learner_membership_id=$3) LIMIT 1',
                [x.tenant, r.id, auth.teacher ? null : x.member],
              )
            ).rowCount;
          if (!auth.teacher && r.state !== 'PUBLISHED' && !runtimeHistory) return null;
          const p = r.active_publication_id
            ? (
                await c.query(
                  'SELECT p.id,p.title,p.publication_no,(SELECT count(*)::int FROM zhiban_bridge.scene_bindings b WHERE b.tenant_id=p.tenant_id AND b.generation_id=p.bridge_generation_id) AS page_count FROM zhiban_content.publications p WHERE p.tenant_id=$1 AND p.id=$2',
                  [x.tenant, r.active_publication_id],
                )
              ).rows[0]
            : null;
          return {
            id: r.id,
            title: auth.teacher ? r.title : p.title,
            state: r.state,
            quarantined: auth.teacher
              ? !!(
                  await c.query(
                    "SELECT 1 FROM zhiban_content.operations WHERE tenant_id=$1 AND resource_id=$2 AND state IN ('RESERVED','OUTCOME_UNKNOWN') LIMIT 1",
                    [x.tenant, r.id],
                  )
                ).rowCount
              : false,
            ...(auth.teacher ? { revision: r.revision, draft: r.draft } : {}),
            publication: p,
            teacher: auth.teacher,
            interactive: r.policy_version === interactivePolicy,
            runtimeHistory,
            pngEnabled: this.pngEnabled && r.policy_version === pngPolicy,
          };
        });
        if (value) {
          canEdit ||= value.teacher;
          resources.push(value);
        }
      } catch (e) {
        if (!(e instanceof ContentError) || e.status !== 403) throw e;
      }
    }
    if (!rows.length) {
      try {
        canEdit = await this.tx(x, null, 'CREATE_CONTENT', async () => true);
      } catch (e) {
        if (!(e instanceof ContentError) || e.status !== 403) throw e;
      }
    }
    return {
      resources,
      canEdit,
      pngEnabled: this.pngEnabled,
      interactiveEnabled: this.interactiveEnabled,
    };
  }
  /** Read lease across the guarded business commit; both connections take SHARE
   * resource/slot locks, so the nested transaction cannot wait on its own lease. */
  async withJointPublication<T>(
    x: ContentContext,
    resource: string,
    publication: string,
    work: () => Promise<T>,
  ): Promise<T> {
    requireContent(this.jointClassroomEnabled, 'UNAVAILABLE', 503);
    let refused: unknown;
    try {
      return await this.tx(x, resource, 'READ', async (c, repo, _auth, final) => {
        const r = (
          await c.query(
            'SELECT * FROM zhiban_content.resources WHERE tenant_id=$1 AND id=$2 AND offering_id=$3 FOR SHARE',
            [x.tenant, resource, x.offering],
          )
        ).rows[0];
        requireContent(
          r &&
            r.state === 'PUBLISHED' &&
            r.policy_version === interactivePolicy &&
            r.active_publication_id === publication,
          'INVALID_STATE',
          409,
        );
        const p = (
          await c.query(
            'SELECT * FROM zhiban_content.publications WHERE tenant_id=$1 AND id=$2 AND resource_id=$3',
            [x.tenant, publication, resource],
          )
        ).rows[0];
        requireContent(p, 'INVALID_STATE', 409);
        requireContent(
          !(
            await c.query(
              "SELECT 1 FROM zhiban_content.operations WHERE tenant_id=$1 AND resource_id=$2 AND state IN ('RESERVED','OUTCOME_UNKNOWN') LIMIT 1",
              [x.tenant, resource],
            )
          ).rowCount,
          'INVALID_STATE',
          409,
        );
        const slot = await repo.loadSlot(p.bridge_slot_id, 'SHARE'),
          g = await repo.loadGeneration(p.bridge_generation_id);
        requireContent(
          slot.state === 'ENABLED' &&
            slot.active_generation_id === g.generation_id &&
            g.state === 'ACTIVE',
          'INVALID_STATE',
          409,
        );
        await this.native.readInteractive(
          String(g.owner_handle),
          String(g.stage_ref),
          p.content_digest,
          final,
          x.deadline ?? new Deadline(),
        );
        try {
          return await work();
        } catch (error) {
          refused = error;
          throw error;
        }
      });
    } catch (error) {
      throw refused ?? error;
    }
  }
  async jointEntry(x: ContentContext, resource: string, publication: string, dispatch: string) {
    requireContent(this.jointClassroomEnabled, 'UNAVAILABLE', 503);
    return this.tx(
      { ...x, studentRead: true },
      resource,
      'READ',
      async (c) =>
        (
          await c.query('SELECT zhiban_content.read_joint_entry($1,$2,$3,$4,$5,$6) AS result', [
            x.tenant,
            resource,
            x.offering,
            publication,
            dispatch,
            x.member,
          ])
        ).rows[0].result as {
          attemptId: string;
          activityId: string;
          activityVersion: string;
          sessionId: string;
          dispatchId: string;
          bindingId: string;
        },
    );
  }
  async attemptRuntimeAccess(x: ContentContext, resource: string) {
    requireContent(this.attemptRuntimeEnabled, 'UNAVAILABLE', 503);
    return this.tx(x, resource, 'READ', async (c) => {
      const r = await this.row(c, x, resource);
      requireContent(r.policy_version === interactivePolicy, 'FORBIDDEN', 403);
      // Historical documents expose no withdrawn content or teacher draft title.
      return { title: '作答关联与可信记录' };
    });
  }
  /** Server facts only. This never enables the frozen Native chat Runtime port. */
  async attemptRuntime(x: ContentContext, resource: string, attempt: string, publication?: string) {
    requireContent(this.attemptRuntimeEnabled, 'UNAVAILABLE', 503);
    // A new binding also proves the immutable Native document through the normal
    // public provider. The following transaction rechecks and holds its publication.
    if (publication)
      await this.preview(
        { ...x, studentRead: true },
        resource,
        'published',
        undefined,
        publication,
      );
    return this.tx(
      publication ? { ...x, studentRead: true } : x,
      resource,
      'READ',
      async (c, repo, auth) => {
        if (publication) {
          const r = await this.row(c, x, resource, true);
          requireContent(
            r.state === 'PUBLISHED' &&
              r.active_publication_id === publication &&
              r.policy_version === interactivePolicy,
            'INVALID_STATE',
            409,
          );
          const p = (
            await c.query(
              'SELECT * FROM zhiban_content.publications WHERE tenant_id=$1 AND id=$2 AND resource_id=$3',
              [x.tenant, publication, resource],
            )
          ).rows[0];
          requireContent(p, 'INVALID_STATE', 409);
          const slot = await repo.loadSlot(p.bridge_slot_id, 'SHARE'),
            g = await repo.loadGeneration(p.bridge_generation_id);
          requireContent(
            slot.state === 'ENABLED' &&
              slot.active_generation_id === g.generation_id &&
              g.state === 'ACTIVE',
            'INVALID_STATE',
            409,
          );
        }
        return (
          await c.query(
            'SELECT zhiban_content.attempt_runtime($1,$2,$3,$4,$5,$6,$7,$8) AS result',
            [
              x.tenant,
              resource,
              x.offering,
              x.member,
              attempt,
              auth.teacher,
              publication ?? null,
              publication ? v7() : null,
            ],
          )
        ).rows[0].result;
      },
    );
  }
  /** Short delivery barrier for the read-only Tutor: no provider I/O under these locks. */
  async withTutorPublication<T>(
    x: ContentContext,
    resource: string,
    publication: string,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.tx(x, resource, 'READ', async (c, repo, _auth, final) => {
      const r = await this.row(c, x, resource, true);
      requireContent(
        r.state === 'PUBLISHED' && r.active_publication_id === publication,
        'INVALID_STATE',
        409,
      );
      const p = (
        await c.query(
          'SELECT bridge_slot_id,bridge_generation_id FROM zhiban_content.publications WHERE tenant_id=$1 AND resource_id=$2 AND id=$3',
          [x.tenant, resource, publication],
        )
      ).rows[0];
      requireContent(p, 'NOT_FOUND', 404);
      const slot = await repo.loadSlot(p.bridge_slot_id, 'SHARE'),
        generation = await repo.loadGeneration(p.bridge_generation_id);
      requireContent(
        slot.state === 'ENABLED' &&
          slot.active_generation_id === generation.generation_id &&
          generation.state === 'ACTIVE',
        'UNAVAILABLE',
        503,
      );
      await final();
      return work();
    });
  }
  async preview(
    x: ContentContext,
    resource: string,
    source: string,
    expectedPublicationNo?: string,
    expectedPublicationId?: string,
  ) {
    return this.tx(x, resource, 'READ', async (c, repo, auth, final) => {
      const r = await this.row(c, x, resource, true);
      if (source === 'draft') {
        if (r.policy_version === interactivePolicy) {
          requireContent(this.interactiveEnabled && auth.teacher, 'FORBIDDEN', 403);
          return { ...interactiveDraft(r.draft), revision: r.revision, interactive: true };
        }
        requireContent(auth.teacher, 'FORBIDDEN', 403);
        return { title: r.title, slides: draft(r.draft).slides, revision: r.revision };
      }
      requireContent(source === 'published' && r.state === 'PUBLISHED', 'INVALID_STATE', 409);
      const p = (
        await c.query('SELECT * FROM zhiban_content.publications WHERE tenant_id=$1 AND id=$2', [
          x.tenant,
          r.active_publication_id,
        ])
      ).rows[0];
      if (expectedPublicationNo !== undefined)
        requireContent(String(p.publication_no) === expectedPublicationNo, 'INVALID_STATE', 409);
      if (expectedPublicationId !== undefined)
        requireContent(p.id === expectedPublicationId, 'INVALID_STATE', 409);
      const slot = await repo.loadSlot(p.bridge_slot_id, 'SHARE'),
        g = await repo.loadGeneration(p.bridge_generation_id);
      requireContent(
        slot.state === 'ENABLED' &&
          slot.active_generation_id === g.generation_id &&
          g.state === 'ACTIVE',
        'UNAVAILABLE',
        503,
      );
      if (r.policy_version === interactivePolicy) {
        requireContent(this.interactiveEnabled, 'UNAVAILABLE', 503);
        const doc = await this.native.readInteractive(
          String(g.owner_handle),
          String(g.stage_ref),
          p.content_digest,
          final,
          x.deadline ?? new Deadline(),
        );
        return {
          title: p.title,
          slides: [{ id: doc.scenes[0].id, elements: [] }],
          html: doc.scenes[0].content.html,
          interactive: true,
          publicationId: p.id,
          publicationNo: Number(p.publication_no),
        };
      }
      const bindings =
        r.policy_version === pngPolicy
          ? await repo.candidateBindings(String(g.generation_id))
          : null;
      const expectedRefs: AssetExpectations = new Map(
        bindings?.assets.map((a) => [
          String(a.asset_ref),
          {
            byteDigest: String(a.byte_digest),
            sceneRef: String(
              bindings.scenes.find((s) => s.scene_binding_id === a.scene_binding_id)!.scene_ref,
            ),
            purpose: 'IMAGE' as const,
          },
        ]) ?? [],
      );
      const doc = bindings
        ? await this.native.readPng(
            String(g.owner_handle),
            String(g.stage_ref),
            expectedRefs,
            p.content_digest,
            final,
            x.deadline ?? new Deadline(),
          )
        : await this.native.read(
            String(g.owner_handle),
            String(g.stage_ref),
            p.content_digest,
            final,
            x.deadline ?? new Deadline(),
          );
      const loaded = draft({
        title: p.title,
        slides: doc.scenes.map((s: any) => ({
          id: s.content.canvas.id,
          elements: s.content.canvas.elements.map((e: any) => ({
            id: e.id,
            ...(e.type === 'image'
              ? {
                  assetId: String(
                    bindings!.assets.find((a) => `asset:${a.asset_ref}` === e.src)!
                      .asset_binding_id,
                  ),
                }
              : { text: e.content }),
            x: e.left,
            y: e.top,
            width: e.width,
            height: e.height,
          })),
        })),
      });
      return { ...loaded, publicationId: p.id, publicationNo: Number(p.publication_no) };
    });
  }
  private async pngInputs(c: PoolClient, x: ContentContext, r: any, d: ReturnType<typeof draft>) {
    const result: {
      elementId: string;
      slideId: string;
      slideIndex: number;
      uploadId: string;
      bytes: Buffer;
      digest: string;
    }[] = [];
    let total = 0;
    for (const [slideIndex, s] of d.slides.entries())
      for (const e of s.elements) {
        if (!e.assetId) {
          continue;
        }
        requireContent(this.pngEnabled && r.policy_version === pngPolicy, 'FORBIDDEN', 403);
        const u = (
          await c.query(
            'SELECT bytes,byte_digest FROM zhiban_content.png_uploads WHERE tenant_id=$1 AND resource_id=$2 AND id=$3',
            [x.tenant, r.id, e.assetId],
          )
        ).rows[0];
        requireContent(u, 'FORBIDDEN', 403);
        const checked = validatePng(u.bytes);
        requireContent(checked.digest === u.byte_digest, 'UNAVAILABLE', 503);
        total += checked.bytes.length;
        requireContent(total <= 33554432, 'TOO_LARGE', 413);
        result.push({
          elementId: e.id,
          slideId: s.id,
          slideIndex,
          uploadId: e.assetId,
          bytes: checked.bytes,
          digest: checked.digest,
        });
      }
    return result;
  }
  async uploads(x: ContentContext, resource: string) {
    requireContent(this.pngEnabled, 'UNAVAILABLE', 503);
    return this.tx(x, resource, 'SAVE_CONTENT', async (c) => {
      const r = await this.row(c, x, resource, true);
      requireContent(r.policy_version === pngPolicy, 'INVALID_STATE', 409);
      return {
        assets: (
          await c.query(
            'SELECT id,width,height,octet_length(bytes) AS size FROM zhiban_content.png_uploads WHERE tenant_id=$1 AND resource_id=$2 ORDER BY created_at,id LIMIT 128',
            [x.tenant, resource],
          )
        ).rows,
      };
    });
  }
  async upload(
    x: ContentContext,
    resource: string,
    revision: string,
    key: string,
    bytes: Uint8Array,
  ) {
    requireContent(this.pngEnabled && /^[A-Za-z0-9_-]{16,80}$/.test(key));
    // Authenticate/lock before decompression. The same guard remains held through registration.
    return this.tx(x, resource, 'SAVE_CONTENT', async (c) => {
      const r = await this.row(c, x, resource, true);
      requireContent(r.policy_version === pngPolicy && r.revision === revision, 'CONFLICT', 409);
      const u = validatePng(bytes);
      const old = (
        await c.query(
          'SELECT id,byte_digest,width,height,octet_length(bytes) AS size FROM zhiban_content.png_uploads WHERE tenant_id=$1 AND resource_id=$2 AND actor_id=$3 AND key_digest=$4',
          [x.tenant, resource, x.member, hash(key)],
        )
      ).rows[0];
      if (old) {
        requireContent(old.byte_digest === u.digest, 'CONFLICT', 409);
        return { id: old.id, width: old.width, height: old.height, size: old.size };
      }
      const quota = (
        await c.query(
          'SELECT count(*) AS count,coalesce(sum(octet_length(bytes)),0) AS bytes FROM zhiban_content.png_uploads WHERE tenant_id=$1 AND resource_id=$2',
          [x.tenant, resource],
        )
      ).rows[0];
      requireContent(
        Number(quota.count) < 128 && Number(quota.bytes) + u.bytes.length <= 33554432,
        'TOO_LARGE',
        413,
      );
      const uid = v7();
      await c.query(
        'INSERT INTO zhiban_content.png_uploads VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          x.tenant,
          uid,
          resource,
          x.member,
          hash(key),
          u.digest,
          u.bytes,
          u.width,
          u.height,
          Date.now(),
        ],
      );
      return { id: uid, width: u.width, height: u.height, size: u.bytes.length };
    });
  }
  private async preparePngImages(x: ContentContext, p: any, key: string) {
    p.expectedRefs = new Map();
    for (const image of p.images) {
      const reserved = await this.tx(x, p.id, 'PUBLISH_CONTENT', async (c, repo, auth) => {
        requireContent(auth.actor.authorizationVersion === p.actorVersion, 'FORBIDDEN', 403);
        const slot = await repo.loadSlot(p.slot, 'UPDATE');
        const b = await repo.reserve(
          {
            slotId: p.slot,
            expectedRevision: slot.revision,
            operation: 'PREPARE_ASSET',
            generationId: p.generation,
            keyDigest: hash(`${key}:${image.elementId}`),
            intentDigest: hash(
              canonical({ parent: p.prep, element: image.elementId, digest: image.digest }),
            ),
          },
          auth.actor,
          Date.now(),
        );
        await c.query(
          'INSERT INTO zhiban_content.png_asset_operations VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            x.tenant,
            b.operation.operation_id,
            p.prep,
            p.generation,
            p.id,
            image.elementId,
            image.uploadId,
          ],
        );
        return String(b.operation.operation_id);
      });
      await this.tx(x, p.id, 'PUBLISH_CONTENT', async (_c, repo, auth) => {
        requireContent(auth.actor.authorizationVersion === p.actorVersion, 'FORBIDDEN', 403);
        await repo.markDispatch(await repo.loadOperation(reserved), Date.now());
      });
      try {
        const stored = await this.tx(x, p.id, 'PUBLISH_CONTENT', async (c, repo, auth, final) => {
          requireContent(auth.actor.authorizationVersion === p.actorVersion, 'FORBIDDEN', 403);
          const put = await this.pngNative.put(
            p.owner,
            'image/png',
            image.bytes,
            x.deadline ?? new Deadline(),
            final,
          );
          requireContent(put.byteDigest === image.digest, 'UNAVAILABLE', 503);
          const slot = await repo.loadSlot(p.slot, 'UPDATE');
          const bindings = await repo.candidateBindings(p.generation),
            scene = bindings.scenes.find((s) => s.scene_ref === image.sceneRef)!;
          const binding = await repo.attachAsset(
            p.slot,
            p.generation,
            String(scene.scene_binding_id),
            slot.revision,
            {
              ref: put.ref,
              purpose: 'IMAGE',
              mime: 'image/png',
              length: put.byteLength,
              digest: put.byteDigest,
              revision: put.providerRevision,
            },
            Date.now(),
          );
          await repo.finish(
            await repo.loadOperation(reserved),
            'SUCCEEDED',
            'NONE',
            'GENERATION_PREPARED',
            auth.actor.requestId,
            Date.now(),
            put.ref,
          );
          await c.query(
            'INSERT INTO zhiban_content.png_publication_refs VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [
              x.tenant,
              p.generation,
              binding,
              p.id,
              image.uploadId,
              image.slideId,
              image.elementId,
              reserved,
            ],
          );
          return put;
        });
        p.expectedRefs.set(stored.ref, {
          byteDigest: image.digest,
          sceneRef: image.sceneRef,
          purpose: 'IMAGE',
        });
        p.doc.scenes[image.slideIndex].content.canvas.elements.find(
          (e: any) => e.id === image.elementId,
        ).src = `asset:${stored.ref}`;
      } catch (error) {
        await this.tx(x, p.id, 'PUBLISH_CONTENT', async (_c, repo, auth) => {
          const op = await repo.loadOperation(reserved);
          if (op.state === 'RESERVED')
            await repo.finish(
              op,
              'OUTCOME_UNKNOWN',
              'UNKNOWN_OUTCOME',
              'OUTCOME_QUARANTINED',
              auth.actor.requestId,
              Date.now(),
            );
        }).catch(() => {});
        throw error;
      }
    }
  }
  /** PNG-only parent settlement after its exact serialized asset suboperations.
   * Frozen repository.finish remains unchanged; no reconciliation/UNKNOWN->terminal path. */
  private async finishPngPreparation(
    c: PoolClient,
    repo: BridgeRepository,
    p: any,
    auth: any,
    state: 'SUCCEEDED' | 'OUTCOME_UNKNOWN',
    t: number,
  ) {
    const op = await repo.loadOperation(p.prep),
      slot = await repo.loadSlot(p.slot, 'UPDATE'),
      g = await repo.loadGeneration(p.generation);
    requireContent(
      op.state === 'RESERVED' &&
        op.dispatch_started_at !== null &&
        g.state === 'PENDING' &&
        op.generation_id === p.generation &&
        op.actor_membership_id === auth.actor.member &&
        op.expected_authorization_version === String(auth.actor.authorizationVersion),
      'CONFLICT',
      409,
    );
    const children = (
      await c.query(
        'SELECT o.* FROM zhiban_content.png_asset_operations a JOIN zhiban_bridge.operations o ON o.tenant_id=a.tenant_id AND o.operation_id=a.operation_id WHERE a.tenant_id=$1 AND a.parent_operation_id=$2 ORDER BY o.reserved_slot_revision',
        [repo.tenant, p.prep],
      )
    ).rows;
    requireContent(
      children.length <= p.images.length &&
        BigInt(slot.revision) ===
          BigInt(String(op.reserved_slot_revision)) + BigInt(children.length),
      'CONFLICT',
      409,
    );
    children.forEach((child, i) =>
      requireContent(
        child.operation === 'PREPARE_ASSET' &&
          child.slot_id === p.slot &&
          child.generation_id === p.generation &&
          child.actor_membership_id === op.actor_membership_id &&
          child.expected_authorization_version === op.expected_authorization_version &&
          BigInt(child.reserved_slot_revision) ===
            BigInt(String(op.reserved_slot_revision)) + BigInt(i + 1),
        'CONFLICT',
        409,
      ),
    );
    if (state === 'SUCCEEDED')
      requireContent(
        children.length === p.images.length &&
          children.every((child) => child.state === 'SUCCEEDED'),
        'CONFLICT',
        409,
      );
    const reason = state === 'SUCCEEDED' ? 'NONE' : 'UNKNOWN_OUTCOME';
    const changed = await c.query(
      `UPDATE zhiban_bridge.operations SET state=$1,reason=$2,updated_at=$3,completed_at=$4,result_generation_id=$5,result_slot_revision=$6,repository_revision=repository_revision+1 WHERE tenant_id=$7 AND operation_id=$8 AND repository_revision=$9 AND state='RESERVED'`,
      [
        state,
        reason,
        t,
        state === 'SUCCEEDED' ? t : null,
        state === 'SUCCEEDED' ? p.generation : null,
        state === 'SUCCEEDED' ? slot.revision : null,
        repo.tenant,
        p.prep,
        op.revision,
      ],
    );
    requireContent(changed.rowCount === 1, 'CONFLICT', 409);
    await c.query(
      'INSERT INTO zhiban_bridge.audit_events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
      [
        repo.tenant,
        v7(),
        p.slot,
        p.prep,
        state === 'SUCCEEDED' ? 'GENERATION_PREPARED' : 'OUTCOME_QUARANTINED',
        'USER',
        op.actor_user_id,
        op.actor_membership_id,
        null,
        auth.actor.requestId,
        slot.revision,
        slot.revision,
        t,
        reason,
      ],
    );
  }
  async assetResponse(
    x: ContentContext,
    resource: string,
    asset: string,
    source: string,
    version: string,
    slide: string,
    mode: 'GET' | 'HEAD',
    range: string | null,
    signal: AbortSignal,
    done: () => void,
  ) {
    requireContent(this.pngEnabled, 'UNAVAILABLE', 503);
    const locate = async (load = false): Promise<Uint8Array | null> =>
      this.tx(x, resource, 'READ', async (c, repo, auth, final) => {
        const r = await this.row(c, x, resource, true);
        requireContent(r.policy_version === pngPolicy, 'FORBIDDEN', 403);
        if (source === 'draft') {
          requireContent(auth.teacher && r.revision === version, 'FORBIDDEN', 403);
          requireContent(
            draft(r.draft).slides.some(
              (s) => s.id === slide && s.elements.some((e) => e.assetId === asset),
            ),
            'FORBIDDEN',
            403,
          );
          const u = (
            await c.query(
              'SELECT bytes,byte_digest FROM zhiban_content.png_uploads WHERE tenant_id=$1 AND resource_id=$2 AND id=$3',
              [x.tenant, resource, asset],
            )
          ).rows[0];
          requireContent(u, 'FORBIDDEN', 403);
          if (!load) return null;
          const checked = validatePng(u.bytes);
          requireContent(checked.digest === u.byte_digest, 'UNAVAILABLE', 503);
          return checked.bytes;
        }
        requireContent(
          source === 'published' && r.state === 'PUBLISHED' && r.active_publication_id === version,
          'FORBIDDEN',
          403,
        );
        const a = (
          await c.query(
            `SELECT a.*,g.owner_handle,s.state AS slot_state,s.active_generation_id,g.state AS generation_state FROM zhiban_content.publications p
        JOIN zhiban_content.png_publication_refs f ON f.tenant_id=p.tenant_id AND f.generation_id=p.bridge_generation_id AND f.resource_id=p.resource_id
        JOIN zhiban_bridge.asset_bindings a ON a.tenant_id=f.tenant_id AND a.asset_binding_id=f.asset_binding_id
        JOIN zhiban_bridge.resource_generations g ON g.tenant_id=p.tenant_id AND g.generation_id=p.bridge_generation_id
        JOIN zhiban_bridge.resource_slots s ON s.tenant_id=p.tenant_id AND s.slot_id=p.bridge_slot_id
        WHERE p.tenant_id=$1 AND p.id=$2 AND f.asset_binding_id=$3 AND f.slide_id=$4 AND p.resource_id=$5`,
            [x.tenant, version, asset, slide, resource],
          )
        ).rows[0];
        requireContent(
          a &&
            a.slot_state === 'ENABLED' &&
            a.active_generation_id === a.generation_id &&
            a.generation_state === 'ACTIVE' &&
            a.purpose === 'IMAGE' &&
            a.mime === 'image/png' &&
            a.principal_handle === a.owner_handle,
          'FORBIDDEN',
          403,
        );
        if (!load) return null;
        const bytes = await this.pngNative.read(
          a.owner_handle,
          a.asset_ref,
          {
            mime: a.mime,
            byteLength: Number(a.byte_length),
            digest: a.byte_digest,
            revision: a.provider_revision,
          },
          x.deadline ?? new Deadline(),
          final,
        );
        const checked = validatePng(bytes);
        requireContent(checked.digest === a.byte_digest, 'UNAVAILABLE', 503);
        return bytes;
      });
    const admitted = async <T>(work: () => Promise<T>) => {
      let refusal: unknown;
      try {
        return await admittedOperation(async () => {
          try {
            return await work();
          } catch (e) {
            refusal = e;
            throw e;
          }
        });
      } catch (e) {
        throw refusal ?? e;
      }
    };
    const bytes = await admitted(() => locate(true));
    requireContent(bytes, 'UNAVAILABLE', 503);
    let start: number, end: number;
    try {
      [start, end] = singleRange(range, bytes.length);
    } catch {
      throw new ContentError('RANGE_NOT_SATISFIABLE', 416);
    }
    const responseHeaders = {
      ...gatewayHeaders,
      'Content-Type': 'image/png',
      'Content-Length': String(end - start + 1),
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}),
    };
    if (mode === 'HEAD') {
      await admitted(() => locate());
      done();
      return new Response(null, { status: range ? 206 : 200, headers: responseHeaders });
    }
    let at = start,
      closed = false;
    const close = () => {
      if (!closed) {
        closed = true;
        done();
      }
    };
    const deadline = x.deadline ?? new Deadline();
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const abort = () => {
      if (!closed) {
        controller.error(new ContentError('UNAVAILABLE', 503));
        finish();
      }
    };
    const timer = setTimeout(abort, deadline.remaining());
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      close();
    };
    const stream = new ReadableStream<Uint8Array>(
      {
        start(c) {
          controller = c;
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        },
        async pull(c) {
          try {
            deadline.assert();
            requireContent(!signal.aborted, 'UNAVAILABLE', 503);
            await admitted(() => locate());
            deadline.assert();
            const next = Math.min(at + 65536, end + 1);
            c.enqueue(bytes.slice(at, next));
            at = next;
            if (at > end) {
              c.close();
              finish();
            }
          } catch (e) {
            if (!closed) c.error(e);
            finish();
          }
        },
        cancel() {
          finish();
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(stream, { status: range ? 206 : 200, headers: responseHeaders });
  }
  /** Private host seam: current Identity + actual assignment locks cover short staging commands. */
  async authoring<T>(x: ContentContext, work: () => Promise<T>): Promise<T> {
    return this.tx(x, null, 'CREATE_CONTENT', work);
  }
  /** Short host operation: hold current Identity/Enrollment and fixed publication through its commit. */
  async withPublishedAccess<T>(
    x: ContentContext,
    resource: string,
    publication: string,
    work: () => Promise<T>,
  ) {
    return this.tx({ ...x, deadline: undefined }, resource, 'READ', async (c, repo) => {
      const r = (
        await c.query(
          'SELECT * FROM zhiban_content.resources WHERE tenant_id=$1 AND id=$2 AND offering_id=$3 FOR SHARE',
          [x.tenant, resource, x.offering],
        )
      ).rows[0];
      requireContent(
        r?.state === 'PUBLISHED' && r.active_publication_id === publication,
        'INVALID_STATE',
        409,
      );
      const p = (
        await c.query(
          'SELECT bridge_slot_id,bridge_generation_id FROM zhiban_content.publications WHERE tenant_id=$1 AND id=$2',
          [x.tenant, publication],
        )
      ).rows[0];
      requireContent(p, 'UNAVAILABLE', 503);
      const slot = await repo.loadSlot(p.bridge_slot_id, 'SHARE'),
        generation = await repo.loadGeneration(p.bridge_generation_id);
      requireContent(
        slot.state === 'ENABLED' &&
          slot.active_generation_id === generation.generation_id &&
          generation.state === 'ACTIVE',
        'UNAVAILABLE',
        503,
      );
      return work();
    });
  }
  /** Server-produced projection only; not accepted by the ordinary content command endpoint. */
  async adoptGenerated(x: ContentContext, runId: string, value: unknown) {
    const content = draft(value);
    const key = hash(`lesson-adopt:${x.tenant}:${x.offering}:${x.member}:${runId}`);
    const intent = hash(canonical({ offering: x.offering, sourceRun: runId, content }));
    return this.createDraft(x, content, key, intent);
  }
  private async createDraft(
    x: ContentContext,
    content: ReturnType<typeof draft> | InteractiveDraft,
    key: string,
    intent: string,
  ) {
    return this.tx(x, null, 'CREATE_CONTENT', async (c) => {
      // Serialize same-key creation before the first lookup; resource-local uniqueness cannot
      // prevent two new resources for the same generated source under concurrent replays.
      const lock = BigInt.asIntN(
        64,
        BigInt(
          '0x' + hash(`content-create:${x.tenant}:${x.offering}:${x.member}:${key}`).slice(0, 16),
        ),
      );
      await c.query('SELECT pg_advisory_xact_lock($1::bigint)', [lock.toString()]);
      const old = (
        await c.query(
          "SELECT o.resource_id,o.intent_digest FROM zhiban_content.operations o JOIN zhiban_content.resources r ON r.tenant_id=o.tenant_id AND r.id=o.resource_id WHERE o.tenant_id=$1 AND o.actor_id=$2 AND o.key_digest=$3 AND o.action='CREATE_CONTENT' AND r.offering_id=$4 LIMIT 2",
          [x.tenant, x.member, hash(key), x.offering],
        )
      ).rows;
      if (old.length) {
        requireContent(old.length === 1 && old[0].intent_digest === intent, 'CONFLICT', 409);
        return { id: old[0].resource_id };
      }
      const t = Date.now(),
        d = content,
        resource = v7();
      await c.query(
        "INSERT INTO zhiban_content.resources(tenant_id,id,offering_id,kind,policy_version,title,draft,state,revision,active_publication_id,last_publication_no,created_by,updated_by,created_at,updated_at) VALUES($1,$2,$3,'SLIDE_CONTENT',$8,$4,$5,'DRAFT',1,NULL,0,$6,$6,$7,$7)",
        [
          x.tenant,
          resource,
          x.offering,
          d.title,
          d,
          x.member,
          t,
          'html' in content ? interactivePolicy : this.pngEnabled ? pngPolicy : 'content-text-v1',
        ],
      );
      const r = await this.row(c, x, resource, true),
        co = await this.op(c, x, r, 'CREATE_CONTENT', key, intent, t, '1');
      await this.audit(c, x, resource, co, 'CONTENT_CREATED', null, '1', t);
      return { id: resource };
    });
  }
  async execute(x: ContentContext, value: any, key: string) {
    const raw = command(value);
    const interactiveCommand = ['CREATE_INTERACTIVE', 'SAVE_INTERACTIVE'].includes(raw.type);
    if (interactiveCommand) requireContent(this.interactiveEnabled, 'UNAVAILABLE', 503);
    const v = {
      ...raw,
      type:
        raw.type === 'CREATE_INTERACTIVE'
          ? 'CREATE_CONTENT'
          : raw.type === 'SAVE_INTERACTIVE'
            ? 'SAVE_CONTENT'
            : raw.type,
    };
    requireContent(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    const intent = hash(canonical({ offering: x.offering, ...v }));
    if (v.type === 'CREATE_CONTENT')
      return this.createDraft(
        x,
        interactiveCommand ? newInteractiveDraft(v.title, v.html) : emptyDraft(v.title),
        key,
        intent,
      );
    const reserved = await this.tx(x, v.id, v.type, async (c, repo, auth) => {
      const r = await this.row(c, x, v.id, true);
      const old = (
        await c.query(
          'SELECT * FROM zhiban_content.operations WHERE tenant_id=$1 AND actor_id=$2 AND resource_id=$3 AND key_digest=$4',
          [x.tenant, x.member, r.id, hash(key)],
        )
      ).rows[0];
      if (old) {
        requireContent(old.intent_digest === intent, 'CONFLICT', 409);
        requireContent(old.state === 'SUCCEEDED', 'OUTCOME_UNKNOWN', 409);
        return { replay: true, id: r.id };
      }
      requireContent(r.revision === v.revision, 'CONFLICT', 409);
      requireContent(BigInt(r.revision) < BigInt('9223372036854775807'), 'INVALID_STATE', 409);
      const t = Date.now(),
        next = (BigInt(r.revision) + BigInt(1)).toString();
      if (v.type === 'SAVE_CONTENT') {
        requireContent(
          (r.policy_version === interactivePolicy) === interactiveCommand,
          'INVALID_INPUT',
          400,
        );
        const d = interactiveCommand
            ? newInteractiveDraft(v.title, v.html, r.draft.slides[0].id)
            : draft({ title: v.title, slides: v.slides }),
          noop = canonical(d) === canonical(r.draft),
          rev = noop ? r.revision : next;
        if (!interactiveCommand) await this.pngInputs(c, x, r, d);
        const co = await this.op(c, x, r, v.type, key, intent, t, rev);
        if (!noop)
          await c.query(
            'UPDATE zhiban_content.resources SET title=$1,draft=$2,revision=$3,updated_by=$4,updated_at=$5 WHERE tenant_id=$6 AND id=$7',
            [d.title, d, rev, x.member, t, x.tenant, r.id],
          );
        await this.audit(c, x, r.id, co, noop ? 'COMMAND_NOOP' : 'DRAFT_SAVED', r.revision, rev, t);
        return { replay: true, id: r.id };
      }
      if (v.type === 'WITHDRAW_CONTENT') {
        requireContent(['PUBLISHED', 'WITHDRAWN'].includes(r.state), 'INVALID_STATE', 409);
        let b: any = null;
        if (r.state === 'PUBLISHED') {
          const p = (
              await c.query(
                'SELECT * FROM zhiban_content.publications WHERE tenant_id=$1 AND id=$2',
                [x.tenant, r.active_publication_id],
              )
            ).rows[0],
            slot = await repo.loadSlot(p.bridge_slot_id, 'UPDATE');
          b = await repo.reserve(
            {
              slotId: p.bridge_slot_id,
              expectedRevision: slot.revision,
              operation: 'SUSPEND',
              generationId: p.bridge_generation_id,
              keyDigest: hash(key),
              intentDigest: intent,
            },
            auth.actor,
            t,
          );
          await repo.setState(
            p.bridge_slot_id,
            String(b.operation.reserved_slot_revision),
            'SUSPENDED',
            t,
          );
          await repo.finish(
            b.operation,
            'SUCCEEDED',
            'NONE',
            'MAPPING_SUSPENDED',
            auth.actor.requestId,
            t,
          );
        }
        const rev = b ? next : r.revision,
          co = await this.op(
            c,
            x,
            r,
            v.type,
            key,
            intent,
            t,
            rev,
            null,
            b ? String(b.operation.operation_id) : null,
          );
        if (b)
          await c.query(
            "UPDATE zhiban_content.resources SET state='WITHDRAWN',revision=$1,updated_by=$2,updated_at=$3 WHERE tenant_id=$4 AND id=$5",
            [next, x.member, t, x.tenant, r.id],
          );
        await this.audit(
          c,
          x,
          r.id,
          co,
          b ? 'CONTENT_WITHDRAWN' : 'COMMAND_NOOP',
          r.revision,
          rev,
          t,
        );
        return { replay: true, id: r.id };
      }
      const interactive = r.policy_version === interactivePolicy;
      if (interactive) requireContent(this.interactiveEnabled, 'UNAVAILABLE', 503);
      const d = interactive ? interactiveDraft(r.draft) : draft(r.draft);
      requireContent(
        interactive || d.slides.some((s) => s.elements.some((e) => e.assetId || e.text?.trim())),
        'INVALID_INPUT',
        400,
      );
      const png = r.policy_version === pngPolicy;
      const inputs = interactive ? [] : await this.pngInputs(c, x, r, d);
      const plan = planCandidate(),
        refs = d.slides.map(() => v7()),
        doc = interactive
          ? interactiveDocument(d as InteractiveDraft, plan.stageRef, refs, t)
          : document(d, plan.stageRef, refs, t);
      const images = inputs.map((i) => ({ ...i, sceneRef: refs[i.slideIndex] }));
      for (const scene of interactive ? [] : doc.scenes)
        for (const e of scene.content.canvas.elements)
          if (e.type === 'image') e.src = `asset:${e.id}`;
      const expectedRefs: AssetExpectations = new Map(
        images.map((i) => [
          i.elementId,
          { byteDigest: i.digest, sceneRef: i.sceneRef, purpose: 'IMAGE' as const },
        ]),
      );
      const checked = interactive
        ? checkInteractiveDocument(doc, plan.stageRef)
        : png
          ? validatePngDocument(doc, plan.stageRef, expectedRefs)
          : null;
      const digest = checked?.digest ?? hash(canonical(doc));
      const co = await this.op(c, x, r, v.type, key, intent, t, null, digest);
      await this.audit(c, x, r.id, co, 'PUBLISH_RESERVED', r.revision, r.revision, t);
      const slots = (
        await c.query(
          'SELECT slot_id FROM zhiban_bridge.resource_slots WHERE tenant_id=$1 AND activity_id=$2 AND deployment_id=$3',
          [x.tenant, r.id, this.deployment],
        )
      ).rows;
      const slotId =
          slots[0]?.slot_id ?? (await repo.createSlot(r.id, this.deployment, r.created_by, t)),
        slot = await repo.loadSlot(slotId, 'UPDATE');
      const b = await repo.reserve(
        {
          slotId,
          expectedRevision: slot.revision,
          operation: 'PREPARE_CONTENT',
          keyDigest: hash(key),
          intentDigest: intent,
          contentDigest: digest,
          sceneIntents:
            checked?.scenes ??
            doc.scenes.map((s: any) => ({
              ref: s.id,
              ordinal: s.order,
              digest: hash(canonical(s)),
            })),
          candidate: plan,
        },
        auth.actor,
        t,
      );
      await c.query(
        'UPDATE zhiban_content.operations SET prepare_operation_id=$1 WHERE tenant_id=$2 AND id=$3',
        [b.operation.operation_id, x.tenant, co],
      );
      return {
        id: r.id,
        co,
        prep: String(b.operation.operation_id),
        generation: plan.generationId,
        slot: slotId,
        doc,
        digest,
        owner: plan.ownerHandle,
        actorVersion: auth.actor.authorizationVersion,
        images,
        png,
        interactive,
      };
    });
    if (reserved.replay) return { id: reserved.id };
    const p: any = reserved;
    try {
      await this.tx(x, p.id, v.type, async (_c, repo, auth) => {
        requireContent(auth.actor.authorizationVersion === p.actorVersion, 'FORBIDDEN', 403);
        await repo.markDispatch(await repo.loadOperation(p.prep), Date.now());
      });
      if (p.png) await this.preparePngImages(x, p, key);
      await this.tx(x, p.id, v.type, async (_c, _repo, auth, final) => {
        requireContent(auth.actor.authorizationVersion === p.actorVersion, 'FORBIDDEN', 403);
        if (p.interactive) {
          await this.native.saveInteractive(
            p.owner,
            p.doc,
            p.digest,
            final,
            x.deadline ?? new Deadline(),
          );
          await this.native.readInteractive(
            p.owner,
            p.doc.stage.id,
            p.digest,
            final,
            x.deadline ?? new Deadline(),
          );
        } else if (p.png) {
          await this.native.savePng(
            p.owner,
            p.doc,
            p.expectedRefs,
            p.digest,
            final,
            x.deadline ?? new Deadline(),
          );
          await this.native.readPng(
            p.owner,
            p.doc.stage.id,
            p.expectedRefs,
            p.digest,
            final,
            x.deadline ?? new Deadline(),
          );
        } else {
          await this.native.save(p.owner, p.doc, final, x.deadline ?? new Deadline());
          await this.native.read(
            p.owner,
            p.doc.stage.id,
            p.digest,
            final,
            x.deadline ?? new Deadline(),
          );
        }
      });
      return await this.tx(x, p.id, v.type, async (c, repo, auth) => {
        requireContent(auth.actor.authorizationVersion === p.actorVersion, 'FORBIDDEN', 403);
        const r = await this.row(c, x, p.id, true);
        requireContent(r.revision === v.revision, 'CONFLICT', 409);
        const t = Date.now();
        if (p.png) await this.finishPngPreparation(c, repo, p, auth, 'SUCCEEDED', t);
        else
          await repo.finish(
            await repo.loadOperation(p.prep),
            'SUCCEEDED',
            'NONE',
            'GENERATION_PREPARED',
            auth.actor.requestId,
            t,
          );
        const slot = await repo.loadSlot(p.slot, 'UPDATE'),
          b = await repo.reserve(
            {
              slotId: p.slot,
              expectedRevision: slot.revision,
              operation: 'ACTIVATE_GENERATION',
              generationId: p.generation,
              keyDigest: hash(key),
              intentDigest: intent,
            },
            auth.actor,
            t,
          );
        await c.query(
          'UPDATE zhiban_content.operations SET bridge_operation_id=$1 WHERE tenant_id=$2 AND id=$3',
          [b.operation.operation_id, x.tenant, p.co],
        );
        await repo.activate(p.slot, p.generation, String(b.operation.reserved_slot_revision), t);
        await repo.finish(
          b.operation,
          'SUCCEEDED',
          'NONE',
          'GENERATION_ACTIVATED',
          auth.actor.requestId,
          t,
        );
        const pub = v7(),
          rev = (BigInt(r.revision) + BigInt(1)).toString();
        await c.query(
          'INSERT INTO zhiban_content.publications VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
          [
            x.tenant,
            pub,
            p.id,
            x.offering,
            r.last_publication_no + 1,
            r.revision,
            p.slot,
            p.generation,
            p.prep,
            b.operation.operation_id,
            r.title,
            p.digest,
            r.policy_version,
            x.member,
            t,
          ],
        );
        await c.query(
          "UPDATE zhiban_content.operations SET state='SUCCEEDED',result_publication_id=$1,result_revision=$2,completed_at=$3 WHERE tenant_id=$4 AND id=$5",
          [pub, rev, t, x.tenant, p.co],
        );
        await c.query(
          "UPDATE zhiban_content.resources SET state='PUBLISHED',active_publication_id=$1,last_publication_no=last_publication_no+1,revision=$2,updated_by=$3,updated_at=$4 WHERE tenant_id=$5 AND id=$6",
          [pub, rev, x.member, t, x.tenant, p.id],
        );
        await this.audit(c, x, p.id, p.co, 'CONTENT_PUBLISHED', r.revision, rev, t);
        return { id: p.id };
      });
    } catch {
      // A failed call is not proof the Native commit failed. Keep the durable fence.
      await this.tx(x, p.id, v.type, async (c, repo, auth) => {
        const t = Date.now(),
          b = await repo.loadOperation(p.prep);
        if (b.state === 'RESERVED' && p.png)
          await this.finishPngPreparation(c, repo, p, auth, 'OUTCOME_UNKNOWN', t);
        else if (b.state === 'RESERVED')
          await repo.finish(
            b,
            'OUTCOME_UNKNOWN',
            'UNKNOWN_OUTCOME',
            'OUTCOME_QUARANTINED',
            auth.actor.requestId,
            t,
          );
        await c.query(
          "UPDATE zhiban_content.operations SET state='OUTCOME_UNKNOWN' WHERE tenant_id=$1 AND id=$2 AND state='RESERVED'",
          [x.tenant, p.co],
        );
        await this.audit(c, x, p.id, p.co, 'OUTCOME_QUARANTINED', v.revision, v.revision, t);
      }).catch(() => {});
      throw new ContentError('OUTCOME_UNKNOWN', 409);
    }
  }
}
