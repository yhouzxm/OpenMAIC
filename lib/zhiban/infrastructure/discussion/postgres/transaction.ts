import { createHash } from 'node:crypto';
import { v7 } from 'uuid';
import type { PoolClient, QueryResultRow } from 'pg';
import type {
  DiscussionPage,
  DiscussionQuery,
  DiscussionTransaction,
} from '../../../application/discussion/service';
import type { DiscussionCommand } from '../../../domain/discussion/model';
import { requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
type Row = QueryResultRow;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class DiscussionPgTransaction implements DiscussionTransaction {
  private readonly learning: LearningPgTransaction;
  constructor(private readonly client: PoolClient) {
    this.learning = new LearningPgTransaction(client);
  }
  async rows(sql: string, args: unknown[] = []): Promise<Row[]> {
    return (await this.client.query(sql, args)).rows;
  }
  async read(actor: AcademicActor, offering: string, q: DiscussionQuery): Promise<DiscussionPage> {
    const access = await this.learning.access(actor, offering),
      teacher = access.mode === 'TEACHER';
    if (!teacher)
      requireAcademic(
        q.kind !== 'events' && ['ALL', 'OPEN', 'CLOSED'].includes(q.state),
        'FORBIDDEN',
      );
    const args = [
      actor.tenantId,
      offering,
      q.topic,
      teacher,
      q.state,
      q.after?.time ?? null,
      q.after?.id ?? null,
      q.limit + 1,
    ];
    let topic: Row | undefined;
    if (q.topic) {
      [topic] = await this.rows(
        'SELECT id,title,description,state,revision::text,created_at::text FROM zhiban_discussion.topics WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR SHARE',
        args.slice(0, 3),
      );
      requireAcademic(topic && (teacher || ['OPEN', 'CLOSED'].includes(topic.state)), 'NOT_FOUND');
    }
    let rows: Row[];
    if (q.kind === 'topics')
      rows = await this.rows(
        `SELECT t.id,t.title,t.description,t.state,t.revision::text,t.created_at::text,coalesce(p.display_name,'历史成员') AS author_name
      FROM zhiban_discussion.topics t LEFT JOIN zhiban_academic.people p ON p.tenant_id=t.tenant_id AND p.membership_id=t.author_id
      WHERE t.tenant_id=$1 AND t.offering_id=$2 AND ($3::uuid IS NULL)
      AND ($4 OR t.state IN('OPEN','CLOSED')) AND ($5='ALL' OR t.state=$5)
      AND ($6::bigint IS NULL OR (t.created_at,t.id)<($6::bigint,$7::uuid)) ORDER BY t.created_at DESC,t.id DESC LIMIT $8`,
        args,
      );
    else if (q.kind === 'posts')
      rows = await this.rows(
        `SELECT z.id,z.state,z.created_at::text,
      CASE WHEN $4 OR z.state='VISIBLE' THEN z.body END AS body,
      CASE WHEN $4 OR z.state='VISIBLE' THEN coalesce(p.display_name,'历史成员') END AS author_name,
      CASE WHEN $4 THEN z.revision::text END AS revision,
      CASE WHEN $4 OR z.state='VISIBLE' THEN z.parent_id END AS parent_id,
      CASE WHEN ($4 OR z.state='VISIBLE') AND parent.state='VISIBLE' THEN coalesce(pp.display_name,'历史成员') END AS parent_author
      FROM zhiban_discussion.posts z LEFT JOIN zhiban_academic.people p ON p.tenant_id=z.tenant_id AND p.membership_id=z.author_id
      LEFT JOIN zhiban_discussion.posts parent ON parent.tenant_id=z.tenant_id AND parent.offering_id=z.offering_id AND parent.topic_id=z.topic_id AND parent.id=z.parent_id
      LEFT JOIN zhiban_academic.people pp ON pp.tenant_id=parent.tenant_id AND pp.membership_id=parent.author_id
      WHERE z.tenant_id=$1 AND z.offering_id=$2 AND z.topic_id=$3 AND ($5::text IS NOT NULL)
      AND ($6::bigint IS NULL OR (z.created_at,z.id)>($6::bigint,$7::uuid)) ORDER BY z.created_at,z.id LIMIT $8`,
        args,
      );
    else
      rows = await this.rows(
        `SELECT z.id,z.post_id,z.action,z.reason,z.from_state,z.to_state,z.created_at::text,coalesce(p.display_name,'历史成员') AS actor_name
      FROM zhiban_discussion.moderation_events z LEFT JOIN zhiban_academic.people p ON p.tenant_id=z.tenant_id AND p.membership_id=z.actor_id
      WHERE z.tenant_id=$1 AND z.offering_id=$2 AND z.topic_id=$3 AND $4 AND ($5::text IS NOT NULL)
      AND ($6::bigint IS NULL OR (z.created_at,z.id)>($6::bigint,$7::uuid)) ORDER BY z.created_at,z.id LIMIT $8`,
        args,
      );
    const more = rows.length > q.limit;
    rows = rows.slice(0, q.limit);
    const last = rows.at(-1);
    return {
      mode: access.mode,
      writable: access.offering.status === 'OPEN',
      ...(topic ? { topic } : {}),
      rows,
      next: more && last ? { time: last.created_at, id: last.id } : null,
    };
  }
  async execute(actor: AcademicActor, offering: string, c: DiscussionCommand, key: string) {
    const access = await this.learning.access(actor, offering),
      teacher = access.mode === 'TEACHER',
      t = actor.tenantId;
    if (c.type !== 'POST_MESSAGE') requireAcademic(teacher, 'FORBIDDEN');
    const digest = hash([offering, c]);
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `discussion:${t}:${key}`,
    ]);
    const [prior] = await this.rows(
      'SELECT actor_id,offering_id,payload_digest,result FROM zhiban_discussion.commands WHERE tenant_id=$1 AND command_key=$2',
      [t, key],
    );
    if (prior) {
      requireAcademic(
        prior.actor_id === actor.membershipId &&
          prior.offering_id === offering &&
          prior.payload_digest === digest,
        'CONFLICT',
      );
      return prior.result as Record<string, unknown>;
    }
    requireAcademic(access.offering.status === 'OPEN', 'INVALID_STATE');
    let topic: Row | undefined;
    if (c.type !== 'CREATE_TOPIC') {
      const topicId = 'topicId' in c ? c.topicId : c.id;
      [topic] = await this.rows(
        'SELECT * FROM zhiban_discussion.topics WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR UPDATE',
        [t, offering, topicId],
      );
      requireAcademic(topic && (teacher || ['OPEN', 'CLOSED'].includes(topic.state)), 'NOT_FOUND');
    }
    const now = String(
      (
        await this.rows('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now')
      )[0].now,
    );
    let result: Row, facts: Row;
    if (c.type === 'CREATE_TOPIC') {
      const id = v7();
      await this.client.query(
        "INSERT INTO zhiban_discussion.topics(tenant_id,offering_id,id,title,description,state,author_id,created_at) VALUES($1,$2,$3,$4,$5,'DRAFT',$6,$7)",
        [t, offering, id, c.title, c.description, actor.membershipId, now],
      );
      result = { id, revision: '1', state: 'DRAFT' };
      facts = { from: null, to: 'DRAFT' };
    } else if (c.type === 'POST_MESSAGE') {
      requireAcademic(topic!.state === 'OPEN', 'INVALID_STATE');
      if (c.parentId) {
        const [parent] = await this.rows(
          'SELECT state FROM zhiban_discussion.posts WHERE tenant_id=$1 AND offering_id=$2 AND topic_id=$3 AND id=$4 FOR SHARE',
          [t, offering, c.topicId, c.parentId],
        );
        requireAcademic(parent?.state === 'VISIBLE', 'NOT_FOUND');
      }
      const id = v7();
      await this.client.query(
        "INSERT INTO zhiban_discussion.posts(tenant_id,offering_id,topic_id,id,parent_id,author_id,body,state,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'VISIBLE',$8)",
        [t, offering, c.topicId, id, c.parentId, actor.membershipId, c.body, now],
      );
      result = { id, topicId: c.topicId, revision: '1', state: 'VISIBLE' };
      facts = { parentId: c.parentId, bodyHash: hash(c.body) };
    } else if (c.type === 'HIDE_POST' || c.type === 'RESTORE_POST') {
      requireAcademic(['OPEN', 'CLOSED'].includes(topic!.state), 'INVALID_STATE');
      const [post] = await this.rows(
        'SELECT state,revision::text FROM zhiban_discussion.posts WHERE tenant_id=$1 AND offering_id=$2 AND topic_id=$3 AND id=$4 FOR UPDATE',
        [t, offering, c.topicId, c.id],
      );
      requireAcademic(post, 'NOT_FOUND');
      requireAcademic(post.revision === c.revision, 'CONFLICT');
      const from = c.type === 'HIDE_POST' ? 'VISIBLE' : 'HIDDEN',
        to = c.type === 'HIDE_POST' ? 'HIDDEN' : 'VISIBLE';
      requireAcademic(post.state === from, 'INVALID_STATE');
      const [updated] = await this.rows(
        'UPDATE zhiban_discussion.posts SET state=$5,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2 AND topic_id=$3 AND id=$4 RETURNING id,revision::text,state',
        [t, offering, c.topicId, c.id, to],
      );
      await this.client.query(
        'INSERT INTO zhiban_discussion.moderation_events(tenant_id,offering_id,topic_id,id,post_id,actor_id,action,reason,from_state,to_state,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [t, offering, c.topicId, v7(), c.id, actor.membershipId, c.type, c.reason, from, to, now],
      );
      result = { ...updated, topicId: c.topicId };
      facts = { from, to, reason: c.reason };
    } else {
      requireAcademic(topic!.revision === c.revision, 'CONFLICT');
      let to = topic!.state;
      if (c.type === 'EDIT_TOPIC') requireAcademic(to === 'DRAFT', 'INVALID_STATE');
      else if (c.type === 'OPEN_TOPIC') {
        requireAcademic(['DRAFT', 'CLOSED'].includes(to), 'INVALID_STATE');
        to = 'OPEN';
      } else if (c.type === 'CLOSE_TOPIC') {
        requireAcademic(to === 'OPEN', 'INVALID_STATE');
        to = 'CLOSED';
      } else {
        requireAcademic(to !== 'ARCHIVED', 'INVALID_STATE');
        to = 'ARCHIVED';
      }
      [result] = await this.rows(
        'UPDATE zhiban_discussion.topics SET title=$4,description=$5,state=$6,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 RETURNING id,revision::text,state',
        [
          t,
          offering,
          c.id,
          c.type === 'EDIT_TOPIC' ? c.title : topic!.title,
          c.type === 'EDIT_TOPIC' ? c.description : topic!.description,
          to,
        ],
      );
      facts = { from: topic!.state, to };
    }
    await this.client.query(
      'INSERT INTO zhiban_discussion.commands(tenant_id,command_key,actor_id,offering_id,payload_digest,result,event_type,facts,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        t,
        key,
        actor.membershipId,
        offering,
        digest,
        JSON.stringify(result),
        c.type,
        JSON.stringify(facts),
        now,
      ],
    );
    return result;
  }
}
